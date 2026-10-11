import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { asKey, consentTextVersion, type Field } from "@/shared/domain/form-model";
import { type FieldInput, type FieldProps, fieldRenderers } from "./index";

const FILE_ID = "00000000-0000-4000-8000-000000000001";

function base(field: Partial<Field> & Pick<Field, "type">): Field {
  return {
    key: asKey("f_probe"),
    label: { en: "Probe", es: "Sonda" },
    required: false,
    personal: false,
    validation: [],
    settings: {},
    ...field,
  };
}

function render(field: Field, props: Partial<FieldProps> = {}): string {
  return renderToStaticMarkup(
    createElement(fieldRenderers[field.type].Component, {
      field,
      locale: "en",
      languages: "bilingual",
      slug: "probe-form",
      label: "Probe",
      help: null,
      required: false,
      values: {},
      error: null,
      files: [],
      ...props,
    }),
  );
}

const input = (values: Record<string, string | string[]>): FieldInput => ({
  get: (n) => {
    const v = values[n];
    return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? null) : null;
  },
  getAll: (n) => {
    const v = values[n];
    return v === undefined ? [] : Array.isArray(v) ? v : [v];
  },
});

describe("field renderers", () => {
  it("number: text input with a decimal keypad, unit after it, and not_a_number for words", () => {
    const field = base({
      type: "number",
      settings: { integerOnly: false, unit: { en: "weeks", es: "semanas" } },
    });
    const html = render(field);
    // React writes the camel-cased attribute names, which HTML reads case-insensitively.
    expect(html).toMatch(/inputmode="decimal"/i);
    expect(html).toContain("weeks");
    const { decode } = fieldRenderers.number;
    expect(decode(input({ f_probe: "2,5" }), field)).toEqual({ value: 2.5, issue: null });
    expect(decode(input({ f_probe: "thirty" }), field)).toEqual({
      value: undefined,
      issue: "not_a_number",
    });
    expect(decode(input({ f_probe: " " }), field)).toEqual({ value: undefined, issue: null });
  });

  it("date: day, month and year in the locale's order inside a fieldset, impossible input is date_invalid", () => {
    const field = base({ type: "date" });
    const en = render(field, { locale: "en" });
    expect(en.indexOf("f_probe.month")).toBeGreaterThan(-1);
    expect(en.indexOf("f_probe.month")).toBeLessThan(en.indexOf("f_probe.day"));
    const es = render(field, { locale: "es" });
    expect(es.indexOf("f_probe.day")).toBeGreaterThan(-1);
    expect(es.indexOf("f_probe.day")).toBeLessThan(es.indexOf("f_probe.month"));
    expect(en).toMatch(/<fieldset[^>]*>\s*<legend/);
    const { decode } = fieldRenderers.date;
    expect(
      decode(input({ "f_probe.day": "9", "f_probe.month": "11", "f_probe.year": "2026" }), field),
    ).toEqual({ value: "2026-11-09", issue: null });
    expect(decode(input({ "f_probe.day": "9", "f_probe.year": "2026" }), field)).toEqual({
      value: undefined,
      issue: "date_invalid",
    });
  });

  it("single choice: radio by default, dropdown only from seven options, with the Choose one placeholder", () => {
    const options = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        key: asKey(`opt_${String(i)}`),
        label: { en: `Option ${String(i)}`, es: `Opción ${String(i)}` },
      }));
    const six = base({
      type: "single_choice",
      settings: { options: options(6), display: "dropdown" },
    });
    expect(render(six)).toContain('type="radio"');
    expect(render(six)).not.toContain("<select");
    const seven = base({
      type: "single_choice",
      settings: { options: options(7), display: "dropdown" },
    });
    const html = render(seven);
    expect(html).toContain("<select");
    expect(html).toContain("Choose one");
  });

  it("consent: the text as legend in plain paragraphs, never pre-checked, decoded with the pinned text version", () => {
    const text = {
      en: "I agree to **synthetic** terms.\n\nSecond paragraph.",
      es: "Acepto términos sintéticos.",
    };
    const field = base({ type: "consent", settings: { text, coveredItems: [] } });
    const html = render(field, { required: true });
    expect(html).toContain("<legend");
    expect(html).toContain("I agree to **synthetic** terms.");
    expect(html).not.toContain("<strong>");
    expect(html).toContain("Second paragraph.");
    expect(html).toContain("I have read and agree");
    expect(html).not.toContain("checked");
    expect(fieldRenderers.consent.decode(input({ f_probe: "accepted" }), field)).toEqual({
      value: { accepted: true, textVersion: consentTextVersion(text) },
      issue: null,
    });
  });

  it("long text: counter only with a max length", () => {
    const plain = base({ type: "long_text", settings: { rows: 4 } });
    expect(render(plain)).not.toContain("characters");
    const limited = base({
      type: "long_text",
      settings: { rows: 4 },
      validation: [{ rule: "max_length", value: 500 }],
    });
    expect(render(limited, { values: { f_probe: "abc" } })).toContain("3 of 500 characters");
  });

  it("file upload: the video notice before the input, limits as help, rows with Remove, and the count", () => {
    const field = base({
      type: "file_upload",
      settings: { kinds: ["image", "video"], maxFiles: 10, maxSizeMb: 10 },
    });
    const html = render(field, {
      files: [{ id: FILE_ID, kind: "image", label: "File 1, 12 kB", size: "12 kB" }],
    });
    expect(html.indexOf("Videos are stored exactly as sent")).toBeGreaterThan(-1);
    expect(html.indexOf("Videos are stored exactly as sent")).toBeLessThan(
      html.indexOf('type="file"'),
    );
    expect(html).toContain("Photos and videos up to 10 MB each.");
    // React writes `name` after the other attributes of a button, so the order is not asserted.
    const remove = /<button[^>]*>/.exec(html)?.[0] ?? "";
    expect(remove).toContain('name="_action"');
    expect(remove).toContain(`value="remove:${FILE_ID}"`);
    expect(html).toContain("1 of 10 files");
    expect(html).toContain(
      'accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,video/mp4,video/quicktime"',
    );
  });

  it("short text infers autocomplete only where safe", () => {
    const field = base({ type: "short_text" });
    expect(render(field, { label: "Full name" })).toMatch(/autocomplete="name"/i);
    expect(render(field, { label: "Hospital" })).toMatch(/autocomplete="off"/i);
  });
});
