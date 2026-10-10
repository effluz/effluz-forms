import { describe, expect, it } from "vitest";
import { ruleSchema } from "../rules";
import { operatorSchema } from "../operators";
import { buildDefaultRegistry } from "./index";

const registry = buildDefaultRegistry();

// Vitest rejects a file whose describe.each has no cases, so the suite keeps one
// real assertion until the first field type registers.
it("registry is readable", () => {
  expect(Array.isArray(registry.list())).toBe(true);
});

describe.each(registry.list().map((d) => [d.id, d] as const))("field type %s", (_id, def) => {
  const settings = def.fixtures.settings[0];

  it("has at least one settings fixture, one valid and one invalid answer", () => {
    expect(def.fixtures.settings.length).toBeGreaterThan(0);
    expect(def.fixtures.validAnswers.length).toBeGreaterThan(0);
    expect(def.fixtures.invalidAnswers.length).toBeGreaterThan(0);
  });

  it("parses all settings fixtures with its settings schema", () => {
    for (const s of def.fixtures.settings)
      expect(def.settingsSchema.safeParse(s).success).toBe(true);
  });

  it("accepts valid answers and rejects invalid ones by shape", () => {
    for (const a of def.fixtures.validAnswers)
      expect(def.answerSchema.safeParse(a).success).toBe(true);
    for (const a of def.fixtures.invalidAnswers)
      expect(def.answerSchema.safeParse(a).success).toBe(false);
  });

  it("normalizes idempotently and valid answers produce no intrinsic issues", () => {
    for (const a of def.fixtures.validAnswers) {
      const once = def.normalize(a, settings);
      expect(def.normalize(once, settings)).toEqual(once);
      expect(def.validate(once, settings)).toEqual([]);
    }
  });

  it("declares only known rules and operators", () => {
    for (const r of def.allowedRules)
      expect(ruleSchema.options.some((o) => o.shape.rule.value === r)).toBe(true);
    for (const o of def.allowedOperators) expect(operatorSchema.safeParse(o).success).toBe(true);
  });

  it("reports its empty fixture as empty and valid answers as non-empty", () => {
    if (def.fixtures.emptyAnswer !== undefined)
      expect(def.isEmpty(def.fixtures.emptyAnswer)).toBe(true);
    if (def.isInput) for (const a of def.fixtures.validAnswers) expect(def.isEmpty(a)).toBe(false);
  });

  it("exports the same number of cells as headers, for answers and for undefined", () => {
    const headers = def.exportHeaders("Label");
    expect(def.exportCells(undefined, settings, "en", "bilingual")).toHaveLength(headers.length);
    for (const a of def.fixtures.validAnswers)
      expect(def.exportCells(a, settings, "es", "bilingual")).toHaveLength(headers.length);
  });

  it("non-input types collect no personal data and allow no rules", () => {
    if (!def.isInput) {
      expect(def.collectsPersonalData).toBe(false);
      expect(def.allowedRules).toEqual([]);
    }
  });
});
