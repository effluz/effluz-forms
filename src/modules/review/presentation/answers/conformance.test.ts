import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  asKey,
  fieldTypeIds,
  fieldTypes,
  type Field,
  type FieldTypeId,
} from "@/shared/domain/form-model";
import type { AnswerView } from "../../application";
import { reviewDisplays } from "./index";

function view(type: FieldTypeId, overrides: Partial<AnswerView> & { settings?: unknown } = {}) {
  const { settings, ...rest } = overrides;
  const field: Field = {
    key: asKey("field_one"),
    type,
    label: { en: "Label", es: "Etiqueta" },
    required: false,
    personal: false,
    validation: [],
    settings: settings ?? fieldTypes[type].fixtures.settings[0],
  };
  const answer: AnswerView = {
    field,
    languages: "bilingual",
    answer: undefined,
    corrected: null,
    curatable: false,
    maxLength: null,
    ...rest,
  };
  return answer;
}

function render(answerView: AnswerView): string {
  return renderToStaticMarkup(
    createElement(reviewDisplays[answerView.field.type].Component, { view: answerView }),
  );
}

const textOf = (html: string) => html.replace(/<[^>]*>/g, "").trim();

const YES_OPTION_SETTINGS = {
  options: [
    { key: asKey("yes_opt"), label: { en: "Yes", es: "Sí" } },
    { key: asKey("no_opt"), label: { en: "No", es: "No" } },
  ],
  display: "radio",
};

describe("review displays", () => {
  it("has a review display for every registered field type", () => {
    expect(Object.keys(reviewDisplays).sort()).toEqual([...fieldTypeIds].sort());
  });

  describe.each(fieldTypeIds)("%s", (type) => {
    const answers = fieldTypes[type].fixtures.validAnswers;
    it.each(answers.map((answer, i) => [i, answer] as const))(
      `shows answer %i with something to read`,
      (_i, answer) => {
        const html = render(view(type, { answer }));
        if (type === "section") {
          expect(html).toMatch(/^<h3[ >]/);
          expect(textOf(html)).toContain("Information");
        } else {
          expect(textOf(html)).not.toBe("");
          expect(textOf(html)).not.toContain("No answer");
        }
      },
    );
  });

  it("shows an unanswered field as No answer", () => {
    const inputTypes = fieldTypeIds.filter((type) => fieldTypes[type].isInput);
    expect(inputTypes.length).toBeGreaterThan(0);
    for (const type of inputTypes) {
      const html = render(view(type));
      expect(html, type).toContain("No answer");
      expect(html, type).toContain("Sin respuesta");
    }
  });

  it("escapes answers", () => {
    const html = render(view("short_text", { answer: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("shows the corrected text of a text answer and keeps line breaks", () => {
    const html = render(
      view("long_text", {
        answer: "Linea 1 Linea 2",
        corrected: { text: "Línea 1\nLínea 2", by: null, at: null },
        curatable: true,
      }),
    );
    expect(html).toMatch(/<[a-z]+ class="[^"]*answerText[^"]*">Línea 1\nLínea 2</);
    expect(html).not.toContain("Linea 1 Linea 2");
  });

  it("shows choices by their labels in both languages", () => {
    const known = render(
      view("single_choice", { answer: "yes_opt", settings: YES_OPTION_SETTINGS }),
    );
    expect(known).toContain("Yes");
    expect(known).toContain("Sí");
    const unknown = render(
      view("single_choice", { answer: "gone_opt", settings: YES_OPTION_SETTINGS }),
    );
    expect(unknown).toContain("gone_opt");
  });

  it("shows several choices as a list of labels", () => {
    const html = render(
      view("multiple_choice", {
        answer: ["yes_opt", "gone_opt"],
        settings: YES_OPTION_SETTINGS,
      }),
    );
    expect(html).toContain("<ul");
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).toContain("Sí");
    expect(html).toContain("gone_opt");
  });

  it("shows a choice in one language once on a single-language form", () => {
    const html = render(
      view("single_choice", {
        answer: "yes_opt",
        languages: "en",
        settings: {
          options: [{ key: asKey("yes_opt"), label: { en: "Yes" } }],
          display: "radio",
        },
      }),
    );
    expect(textOf(html)).toBe("Yes");
    expect(html).not.toContain('lang="es"');
  });

  it("shows files as a count with a link to the photos", () => {
    const two = render(view("file_upload", { answer: ["m_aaaaaaaa", "m_bbbbbbbb"] }));
    expect(two).toContain("2 files, shown under Photos and videos");
    expect(two).toContain("2 archivos, en Fotos y videos");
    expect(two).toContain('href="#photos"');
    const one = render(view("file_upload", { answer: ["m_aaaaaaaa"] }));
    expect(one).toContain("1 file, shown under Photos and videos");
    expect(one).not.toContain("1 files");
  });

  it("shows a checkbox as Yes or No, and an unticked one as an answer", () => {
    expect(textOf(render(view("checkbox", { answer: true })))).toContain("Yes");
    const unticked = render(view("checkbox", { answer: false }));
    expect(unticked).toContain("No");
    expect(unticked).not.toContain("No answer");
  });

  it("shows consent as Yes with the text version it accepted", () => {
    const html = render(
      view("consent", { answer: { accepted: true, textVersion: "0123456789abcdef" } }),
    );
    expect(html).toContain("Yes");
    expect(html).toContain("0123456789abcdef");
  });

  it("shows a number and a date as stored", () => {
    expect(textOf(render(view("number", { answer: 12.5 })))).toBe("12.5");
    expect(textOf(render(view("number", { answer: 0 })))).toBe("0");
    expect(textOf(render(view("date", { answer: "2024-02-29" })))).toBe("2024-02-29");
  });

  it("escapes a section title", () => {
    const html = render(
      view("section", { settings: { title: { en: "<b>Hi</b>", es: "<b>Hola</b>" } } }),
    );
    expect(html).not.toContain("<b>");
  });
});
