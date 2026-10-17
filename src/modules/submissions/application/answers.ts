import {
  LIMITS,
  type FieldTypeRegistry,
  type ValidationIssue,
  type Version,
} from "@/shared/domain/form-model";
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

/** The most characters of one typed value kept: the longest answer any field takes. */
const RAW_VALUE_MAX = LIMITS.longTextMax;
/** The most values of one input name kept: the most options a choice field has. */
const RAW_VALUES_MAX = LIMITS.optionsPerChoice;

/** `value` cut to `RAW_VALUE_MAX` code units, never ending on half of a surrogate pair. */
function cut(value: string): string {
  if (value.length <= RAW_VALUE_MAX) return value;
  const head = value.slice(0, RAW_VALUE_MAX);
  const last = head.charCodeAt(head.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head;
}

/**
 * Typed text of the page's answer inputs only: never an upload input, never
 * another page's key. A control posting several parts (a date's `<key>.day`,
 * `<key>.month`, `<key>.year`) keeps every part. Each value is cut to the
 * longest answer a field takes, so a refused post cannot store or render back
 * more than a valid one.
 */
export function pageRaw(raw: RawValues, keys: readonly string[]): RawValues {
  const owned = (name: string) => keys.some((k) => name === k || name.startsWith(`${k}.`));
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([name]) => owned(name))
      .map(([name, value]) => [
        name,
        Array.isArray(value) ? value.slice(0, RAW_VALUES_MAX).map(cut) : cut(value),
      ]),
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
