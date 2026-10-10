import type { AnyFieldType, ValidationOutcome } from "../field-type";
import { operatorSchema } from "../operators";
import { ruleSchema } from "../rules";

export interface ConformanceCheck {
  name: string;
  ok: boolean;
  /** What failed, for the test message; empty when the check passed. */
  detail: string;
}

const show = (v: unknown): string => (v === undefined ? "undefined" : JSON.stringify(v));

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.hasOwn(b, k) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

const isLimitCode = (code: string) => code.startsWith("max_") || code.endsWith("_max");
const codeOf = (o: ValidationOutcome) => (typeof o === "string" ? o : o.code);

/**
 * The per-type checks of the field type conformance suite. Each check returns
 * the first failure it finds, or undefined. A check that throws fails.
 */
const checks: readonly { name: string; run: (def: AnyFieldType) => string | undefined }[] = [
  {
    name: "has settings, valid and invalid fixtures",
    run: (def) => {
      const f = def.fixtures;
      if (f.settings.length === 0) return "no settings fixture";
      if (f.validAnswers.length === 0) return "no valid answer fixture";
      if (f.invalidAnswers.length === 0) return "no invalid answer fixture";
      return undefined;
    },
  },
  {
    name: "parses its settings fixtures",
    run: (def) => {
      const bad: unknown = def.fixtures.settings.find(
        (s) => !def.settingsSchema.safeParse(s).success,
      );
      return bad === undefined ? undefined : `settings fixture ${show(bad)} does not parse`;
    },
  },
  {
    name: "accepts valid and rejects invalid answers by shape",
    run: (def) => {
      for (const a of def.fixtures.validAnswers)
        if (!def.answerSchema.safeParse(a).success) return `valid answer ${show(a)} rejected`;
      for (const a of def.fixtures.invalidAnswers)
        if (def.answerSchema.safeParse(a).success) return `invalid answer ${show(a)} accepted`;
      return undefined;
    },
  },
  {
    name: "normalizes idempotently with no intrinsic issues for valid answers",
    run: (def) => {
      const settings: unknown = def.fixtures.settings[0];
      for (const a of def.fixtures.validAnswers) {
        const once: unknown = def.normalize(a, settings);
        if (!def.answerSchema.safeParse(once).success)
          return `normalized answer ${show(once)} no longer parses`;
        if (!deepEqual(def.normalize(once, settings), once))
          return `normalize is not idempotent for ${show(a)}`;
        const outcomes = def.validate(once, settings);
        if (outcomes.length > 0) return `valid answer ${show(once)} yields ${show(outcomes)}`;
      }
      return undefined;
    },
  },
  {
    name: "declares only known rules and operators",
    run: (def) => {
      const rule = def.allowedRules.find(
        (r) => !ruleSchema.options.some((o) => o.shape.rule.value === r),
      );
      if (rule !== undefined) return `unknown rule ${rule}`;
      const op = def.allowedOperators.find((o) => !operatorSchema.safeParse(o).success);
      return op === undefined ? undefined : `unknown operator ${op}`;
    },
  },
  {
    name: "classifies empty answers",
    run: (def) => {
      const empty: unknown = def.fixtures.emptyAnswer;
      if (empty !== undefined && !def.isEmpty(empty)) return `empty fixture ${show(empty)}`;
      if (def.isInput)
        for (const a of def.fixtures.validAnswers)
          if (def.isEmpty(a)) return `valid answer ${show(a)} reported empty`;
      return undefined;
    },
  },
  {
    name: "exports one cell per header",
    run: (def) => {
      const settings: unknown = def.fixtures.settings[0];
      const headers = def.exportHeaders("Label").length;
      const blank = def.exportCells(undefined, settings, "en", "bilingual").length;
      if (blank !== headers)
        return `${String(blank)} cells for undefined, ${String(headers)} headers`;
      for (const a of def.fixtures.validAnswers) {
        const cells = def.exportCells(a, settings, "es", "bilingual").length;
        if (cells !== headers)
          return `${String(cells)} cells for ${show(a)}, ${String(headers)} headers`;
      }
      return undefined;
    },
  },
  {
    name: "collects no personal data and allows no rules when not an input",
    run: (def) => {
      if (def.isInput) return undefined;
      if (def.collectsPersonalData) return "non-input type collects personal data";
      return def.allowedRules.length > 0
        ? `non-input type allows ${show(def.allowedRules)}`
        : undefined;
    },
  },
  {
    name: "reports limits with a numeric n",
    run: (def) => {
      const settings: unknown = def.fixtures.settings[0];
      for (const a of def.fixtures.overLimitAnswers ?? []) {
        const outcomes = def.validate(def.normalize(a, settings), settings);
        const limits = outcomes.filter((o) => isLimitCode(codeOf(o)));
        if (limits.length === 0)
          return `over-limit answer yields no limit outcome: ${show(outcomes)}`;
        const bad = limits.find((o) => typeof o === "string" || typeof o.params["n"] !== "number");
        if (bad !== undefined) return `limit outcome without numeric params.n: ${show(bad)}`;
      }
      return undefined;
    },
  },
];

export function conformanceChecks(def: AnyFieldType): ConformanceCheck[] {
  return checks.map(({ name, run }) => {
    let detail: string | undefined;
    try {
      detail = run(def);
    } catch (e) {
      detail = `threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    return { name, ok: detail === undefined, detail: detail ?? "" };
  });
}
