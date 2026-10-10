import { describe, expect, it } from "vitest";
import { buildDefaultRegistry } from "./field-types";
import { parseDraft } from "./version";
import { evaluateVisibility } from "./visibility";

const registry = buildDefaultRegistry();
const r = parseDraft(
  {
    languages: "es",
    confirmation: { screen: { es: "Gracias" } },
    pages: [
      {
        key: "page1",
        title: { es: "Uno" },
        fields: [
          { key: "twins", type: "checkbox", label: { es: "¿Gemelos?" } },
          {
            key: "names",
            type: "short_text",
            label: { es: "Nombres" },
            visibility: { field: "twins", op: "equals", value: true },
          },
          {
            key: "later_dep",
            type: "short_text",
            label: { es: "x" },
            visibility: { field: "weeks", op: "is_not_empty" },
          },
        ],
      },
      {
        key: "page2",
        title: { es: "Dos" },
        visibility: { field: "twins", op: "equals", value: true },
        fields: [{ key: "weeks", type: "number", label: { es: "Semanas" } }],
      },
    ],
  },
  registry,
);
if (!r.ok) throw new Error(JSON.stringify(r.issues));
const version = r.version;

describe("evaluateVisibility", () => {
  it("shows dependent fields and pages when the condition holds", () => {
    const v = evaluateVisibility(version, { twins: true, names: "A y B", weeks: 30 });
    expect(v.fields.get("names")).toBe(true);
    expect(v.pages.get("page2")).toBe(true);
    expect(v.visibleAnswers).toEqual({ twins: true, names: "A y B", weeks: 30 });
  });
  it("hides them otherwise and drops their answers from visibleAnswers", () => {
    const v = evaluateVisibility(version, { twins: false, names: "stale", weeks: 30 });
    expect(v.fields.get("names")).toBe(false);
    expect(v.pages.get("page2")).toBe(false);
    expect(v.fields.get("weeks")).toBe(false);
    expect(v.visibleAnswers).toEqual({ twins: false });
  });
  it("treats a reference to a later field as undefined (single forward pass)", () => {
    const v = evaluateVisibility(version, { twins: true, weeks: 30 });
    expect(v.fields.get("later_dep")).toBe(false);
  });
});
