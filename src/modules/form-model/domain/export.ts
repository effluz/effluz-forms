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
 * `versions` is ordered oldest first: the LAST element is treated as the latest.
 * `exportColumns` reverses a copy of it, so callers must keep that contract.
 *
 * Columns follow the union of input field keys: keys in the latest version come
 * first in their own order, and keys that exist only in older versions are
 * appended, oldest first. Headers use the label from the latest version that
 * has the key, resolved in `locale` with that version's fallback. Each key
 * expands to one column per export header its field type produces.
 */
export function exportColumns(
  versions: readonly Version[],
  registry: FieldTypeRegistry,
  locale: Locale,
): ExportColumn[] {
  const latestFirst = [...versions].reverse();
  const ordered: { field: Field; version: Version }[] = [];
  const seen = new Set<string>();
  for (const version of latestFirst) {
    for (const field of inputFields(version, registry)) {
      if (seen.has(field.key)) continue;
      seen.add(field.key);
      ordered.push({ field, version });
    }
  }
  return ordered.flatMap(({ field, version }) => {
    const def = registry.get(field.type);
    const label = resolveText(field.label, locale, version.languages) || field.key;
    return def
      .exportHeaders(label)
      .map((header, cell) => ({ key: field.key, typeId: def.id, header, cell }));
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
