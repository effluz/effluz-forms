import type { FieldTypeRegistry, ValidationIssue, Version } from "@/shared/domain/form-model";
import type { RawValues } from "../domain/in-progress";

/**
 * The input fields of one page, split by where their values live: answer
 * fields keep their value in the record's `answers`, upload fields keep
 * staged files in `files`. A page the version does not hold has neither.
 */
export function pageInputKeys(
  version: Version,
  registry: FieldTypeRegistry,
  pageKey: string,
): { answers: string[]; uploads: string[] } {
  const keys: { answers: string[]; uploads: string[] } = { answers: [], uploads: [] };
  const page = version.pages.find((p) => p.key === pageKey);
  for (const field of page?.fields ?? []) {
    const def = registry.get(field.type);
    if (!def.isInput) continue;
    (def.uploadLimits ? keys.uploads : keys.answers).push(field.key);
  }
  return keys;
}

/**
 * The stored answers with the page's answers replaced by its valid ones: a
 * field the page now leaves empty, invalid or hidden is cleared. Upload
 * fields are never stored here. See specs/ui-ux/renderer.md, "Navigation and
 * state".
 */
export function storePageAnswers(
  stored: Readonly<Record<string, unknown>>,
  version: Version,
  registry: FieldTypeRegistry,
  pageKey: string,
  valid: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const { answers: pageKeys } = pageInputKeys(version, registry, pageKey);
  const result = omitKeys(stored, pageKeys);
  for (const key of pageKeys) if (Object.hasOwn(valid, key)) result[key] = valid[key];
  return result;
}

/** A copy of the answers without the given keys. */
export function omitKeys(
  answers: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, unknown> {
  const drop = new Set(keys);
  return Object.fromEntries(Object.entries(answers).filter(([k]) => !drop.has(k)));
}

/** The entries of `source` named by `keys`. */
export const pick = (source: Readonly<Record<string, unknown>>, keys: readonly string[]) =>
  Object.fromEntries(keys.filter((k) => Object.hasOwn(source, k)).map((k) => [k, source[k]]));

/** Typed text of the page's answer inputs only: never an upload input, never another page's key. */
export function pageRaw(raw: RawValues, keys: readonly string[]): RawValues {
  return Object.fromEntries(
    keys.filter((k) => Object.hasOwn(raw, k)).map((k) => [k, raw[k] ?? ""]),
  );
}

/**
 * The model's issues, with the issue of a field that has an override (a
 * decode or count issue) replaced by it in place, and overrides for fields
 * the model did not flag appended.
 */
export function withOverrides(
  model: readonly ValidationIssue[],
  overrides: readonly ValidationIssue[],
): ValidationIssue[] {
  const byField = new Map<string, ValidationIssue>();
  for (const o of overrides) if (!byField.has(o.field)) byField.set(o.field, o);
  const used = new Set<string>();
  const result: ValidationIssue[] = [];
  for (const issue of model) {
    const override = byField.get(issue.field);
    if (!override) {
      result.push(issue);
    } else if (!used.has(issue.field)) {
      used.add(issue.field);
      result.push(override);
    }
  }
  for (const [field, override] of byField) if (!used.has(field)) result.push(override);
  return result;
}
