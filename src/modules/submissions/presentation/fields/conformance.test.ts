import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  asKey,
  type Field,
  type FieldTypeDefinition,
  fieldTypeIds,
  fieldTypes,
} from "@/shared/domain/form-model";
import { type FieldInput, fieldRenderers } from "./index";

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

function fieldOf(id: (typeof fieldTypeIds)[number], settings: unknown): Field {
  return {
    key: asKey("f_probe"),
    type: id,
    label: { en: "Probe", es: "Sonda" },
    required: true,
    personal: false,
    validation: [],
    settings,
  };
}

describe("renderer conformance", () => {
  it("has a renderer for every registered field type", () => {
    expect(Object.keys(fieldRenderers).sort()).toEqual([...fieldTypeIds].sort());
  });

  for (const id of fieldTypeIds) {
    const def: FieldTypeDefinition = fieldTypes[id];
    for (const [i, settings] of def.fixtures.settings.entries()) {
      for (const locale of ["en", "es"] as const) {
        it(`${id} renders settings fixture ${String(i)} in ${locale}, labelled and with an error slot`, () => {
          const html = renderToStaticMarkup(
            createElement(fieldRenderers[id].Component, {
              field: fieldOf(id, settings),
              locale,
              languages: "bilingual",
              slug: "probe-form",
              label: locale === "en" ? "Probe" : "Sonda",
              help: null,
              required: def.isInput,
              values: {},
              error: def.isInput ? "Probe is required" : null,
              files: [],
            }),
          );
          if (!def.isInput) {
            expect(html).toMatch(/<h2/);
            return;
          }
          expect(html).toMatch(/<label[^>]*for="f-f_probe"|<legend/);
          expect(html).toContain('id="f_probe-error"');
          expect(html).toContain('aria-invalid="true"');
          expect(html).toContain("Probe is required");
          expect(html).not.toMatch(/type="number"|type="date"/);
        });
      }
      it(`${id} decodes what it encodes for every valid answer fixture ${String(i)}`, () => {
        const field = fieldOf(id, def.settingsSchema.parse(settings));
        const renderer = fieldRenderers[id];
        for (const answer of def.fixtures.validAnswers) {
          const encoded = renderer.encode(answer, field);
          if (Object.keys(encoded).length === 0) continue; // file_upload and section carry no form value
          const decoded = renderer.decode(input({ ...encoded }), field);
          expect(decoded.issue).toBeNull();
          expect(def.normalize(def.answerSchema.parse(decoded.value), field.settings)).toEqual(
            def.normalize(answer, field.settings),
          );
        }
      });
    }
  }
});
