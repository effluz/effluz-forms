import type { FieldTypeRegistry, Key, Version } from "@/shared/domain/form-model";
import { fieldIndex, inputFields } from "@/shared/domain/form-model";

/** What changed between two versions, for the publish summary. See specs/use-cases/definitions.md. */
export interface VersionDiff {
  addedKeys: Key[];
  removedKeys: Key[];
  changedLabels: Key[];
  changedLogic: Key[];
}

/** Canonical JSON: object keys sorted recursively, arrays kept in order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const parts = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Compares two versions over all field types; page keys appear in `changedLogic`. */
export function diffVersions(previous: Version, next: Version): VersionDiff {
  const before = fieldIndex(previous);
  const after = fieldIndex(next);
  const diff: VersionDiff = { addedKeys: [], removedKeys: [], changedLabels: [], changedLogic: [] };

  for (const [key, { field }] of after) {
    const old = before.get(key);
    if (!old) {
      diff.addedKeys.push(key as Key);
      continue;
    }
    if (canonical(old.field.label) !== canonical(field.label)) diff.changedLabels.push(key as Key);
    if (canonical(old.field.visibility) !== canonical(field.visibility))
      diff.changedLogic.push(key as Key);
  }
  for (const key of before.keys()) if (!after.has(key)) diff.removedKeys.push(key as Key);

  const oldPages = new Map(previous.pages.map((p) => [p.key, p]));
  for (const page of next.pages) {
    const old = oldPages.get(page.key);
    if (old && canonical(old.visibility) !== canonical(page.visibility))
      diff.changedLogic.push(page.key);
  }
  return diff;
}

/** True when both documents are equal as canonical JSON, whatever their property order. */
export function sameDefinition(a: Version, b: Version): boolean {
  return canonical(a) === canonical(b);
}

/** Pages and input fields (sections excluded) of a version. */
export function countFields(
  version: Version,
  registry: FieldTypeRegistry,
): { pages: number; fields: number } {
  return { pages: version.pages.length, fields: inputFields(version, registry).length };
}
