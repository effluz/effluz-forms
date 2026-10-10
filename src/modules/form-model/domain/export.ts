import { type Locale, resolveText } from "@/shared/domain/localized-text";
import type { FieldTypeId } from "./field-type";
import type { FieldTypeRegistry } from "./registry";
import { type Field, inputFields, type Version } from "./version";

export interface ExportColumn {
  key: string;
  typeId: FieldTypeId;
  header: string;
  /** Index of this column within the field's export cells. */
  cell: number;
}

/**
 * Builds the export column layout across form versions.
 *
 * `versions` is ordered oldest to newest: the LAST element is the latest.
 *
 * Columns follow the union of input field keys: keys in the latest version come
 * first in their own order, then keys that exist only in older versions are
 * appended, oldest version first, in each version's field order. A key's header
 * uses the label from the newest version that has it, resolved in `locale` with
 * that version's fallback. Each key expands to one column per export header its
 * field type produces.
 */
export function exportColumns(
  versions: readonly Version[],
  registry: FieldTypeRegistry,
  locale: Locale,
): ExportColumn[] {
  const latest = versions[versions.length - 1];
  if (!latest) return [];

  // Oldest to newest, so the newest version that has a key overwrites older owners.
  const owner = new Map<string, { field: Field; version: Version }>();
  for (const version of versions) {
    for (const field of inputFields(version, registry)) owner.set(field.key, { field, version });
  }

  const keys: string[] = [];
  const seen = new Set<string>();
  const add = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };
  for (const field of inputFields(latest, registry)) add(field.key);
  for (const version of versions.slice(0, -1))
    for (const field of inputFields(version, registry)) add(field.key);

  return keys.flatMap((key) => {
    const entry = owner.get(key);
    if (!entry) return [];
    const { field, version } = entry;
    const def = registry.get(field.type);
    const label = resolveText(field.label, locale, version.languages) || field.key;
    return def.exportHeaders(label).map((header, cell) => ({ key, typeId: def.id, header, cell }));
  });
}

/**
 * Fills one submission's export row. Cells come from the submission's own
 * `version`; a column whose key that version does not have is left blank.
 */
export function exportRow(
  columns: readonly ExportColumn[],
  version: Version,
  registry: FieldTypeRegistry,
  answers: Readonly<Record<string, unknown>>,
  locale: Locale,
): string[] {
  const fields = new Map<string, Field>(
    inputFields(version, registry).map((f) => [f.key, f] as const),
  );
  const cache = new Map<string, string[]>();
  return columns.map((col) => {
    const field = fields.get(col.key);
    if (!field) return "";
    if (!cache.has(col.key)) {
      const def = registry.get(field.type);
      cache.set(
        col.key,
        def.exportCells(answers[col.key], field.settings, locale, version.languages),
      );
    }
    return cache.get(col.key)?.[col.cell] ?? "";
  });
}
