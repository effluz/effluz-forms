import { describe, expect, it } from "vitest";
import { type AnyFieldType, defineFieldType } from "./field-type";
import { buildDefaultRegistry } from "./field-types";
import { checkbox } from "./field-types/checkbox";
import { numberType } from "./field-types/number";
import { createRegistry } from "./registry";
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
  it("does not read an inherited property as the answer of a field keyed constructor", () => {
    const own = parseDraft(
      {
        languages: "es",
        confirmation: { screen: { es: "Gracias" } },
        pages: [
          {
            key: "page1",
            title: { es: "Uno" },
            fields: [{ key: "constructor", type: "short_text", label: { es: "Campo" } }],
          },
        ],
      },
      registry,
    );
    if (!own.ok) throw new Error(JSON.stringify(own.issues));
    const v = evaluateVisibility(own.version, {});
    expect(v.fields.get("constructor")).toBe(true);
    expect(Object.hasOwn(v.visibleAnswers, "constructor")).toBe(false);
  });
  it("treats a reference to a later field as undefined (single forward pass)", () => {
    const v = evaluateVisibility(version, { twins: true, weeks: 30 });
    expect(v.fields.get("later_dep")).toBe(false);
  });
});

describe("evaluateVisibility with a registry", () => {
  const withStub = (stub: AnyFieldType) =>
    createRegistry(registry.list().map((d) => (d.id === stub.id ? stub : d)));
  it("keeps a neverHidden field visible whatever its own or its page's condition", () => {
    const reg = withStub(defineFieldType({ ...numberType, neverHidden: true }));
    const v = evaluateVisibility(version, { twins: false, weeks: 30 }, reg);
    expect(v.pages.get("page2")).toBe(false);
    expect(v.fields.get("weeks")).toBe(true);
    expect(v.visibleAnswers).toEqual({ twins: false, weeks: 30 });
  });
  it("leaves out answers of types the registry marks as non-input", () => {
    const reg = withStub(defineFieldType({ ...checkbox, isInput: false }));
    const v = evaluateVisibility(version, { twins: true, names: "A y B" }, reg);
    expect(v.fields.get("twins")).toBe(true);
    expect(v.visibleAnswers).toEqual({});
  });
  it("gives the same result as without a registry for the default types", () => {
    const answers = { twins: true, names: "A y B", weeks: 30 };
    expect(evaluateVisibility(version, answers, registry)).toEqual(
      evaluateVisibility(version, answers),
    );
  });
});
