import { describe, expect, it } from "vitest";
import { ruleSchema } from "../rules";
import { operatorSchema } from "../operators";
import { buildDefaultRegistry } from "./index";

const registry = buildDefaultRegistry();

// Vitest rejects a file whose describe.each has no cases. This placeholder keeps the
// file non-empty and asserts the registry is readable; the cases below are the real checks.
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
      expect(
        def.settingsSchema.safeParse(s).success,
        `${def.id}: settings fixture ${JSON.stringify(s)}`,
      ).toBe(true);
  });

  it("accepts valid answers and rejects invalid ones by shape", () => {
    for (const a of def.fixtures.validAnswers)
      expect(
        def.answerSchema.safeParse(a).success,
        `${def.id}: valid answer ${JSON.stringify(a)}`,
      ).toBe(true);
    for (const a of def.fixtures.invalidAnswers)
      expect(
        def.answerSchema.safeParse(a).success,
        `${def.id}: invalid answer ${JSON.stringify(a)}`,
      ).toBe(false);
  });

  it("normalizes idempotently and valid answers produce no intrinsic issues", () => {
    for (const a of def.fixtures.validAnswers) {
      const once = def.normalize(a, settings);
      expect(
        def.answerSchema.safeParse(once).success,
        `${def.id}: normalized answer ${JSON.stringify(once)} still parses`,
      ).toBe(true);
      expect(
        def.normalize(once, settings),
        `${def.id}: normalize is idempotent for ${JSON.stringify(a)}`,
      ).toEqual(once);
      expect(
        def.validate(once, settings),
        `${def.id}: normalized valid answer ${JSON.stringify(once)} has no intrinsic issues`,
      ).toEqual([]);
    }
  });

  it("declares only known rules and operators", () => {
    for (const r of def.allowedRules)
      expect(
        ruleSchema.options.some((o) => o.shape.rule.value === r),
        `${def.id}: unknown rule ${r}`,
      ).toBe(true);
    for (const o of def.allowedOperators)
      expect(operatorSchema.safeParse(o).success, `${def.id}: unknown operator ${o}`).toBe(true);
  });

  it("reports its empty fixture as empty and valid answers as non-empty", () => {
    if (def.fixtures.emptyAnswer !== undefined)
      expect(def.isEmpty(def.fixtures.emptyAnswer)).toBe(true);
    if (def.isInput)
      for (const a of def.fixtures.validAnswers)
        expect(def.isEmpty(a), `${def.id}: valid answer ${JSON.stringify(a)} is not empty`).toBe(
          false,
        );
  });

  it("exports the same number of cells as headers, for answers and for undefined", () => {
    const headers = def.exportHeaders("Label");
    expect(def.exportCells(undefined, settings, "en", "bilingual")).toHaveLength(headers.length);
    for (const a of def.fixtures.validAnswers)
      expect(
        def.exportCells(a, settings, "es", "bilingual"),
        `${def.id}: export cells for valid answer ${JSON.stringify(a)}`,
      ).toHaveLength(headers.length);
  });

  it("non-input types collect no personal data and allow no rules", () => {
    if (!def.isInput) {
      expect(def.collectsPersonalData).toBe(false);
      expect(def.allowedRules).toEqual([]);
    }
  });
});
