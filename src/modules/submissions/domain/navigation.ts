import { visiblePages, type FieldTypeRegistry, type Version } from "@/shared/domain/form-model";

// Page order follows the conditions (`specs/form-definition.md`, "Conditional logic").
// A key the version does not hold has no neighbours and counts as page 1.

export function visiblePageKeys(
  version: Version,
  answers: Readonly<Record<string, unknown>>,
  registry: FieldTypeRegistry,
): string[] {
  return visiblePages(version, answers, registry).map((p) => p.key);
}

/** The first page shown with nothing answered, falling back to the first page. */
export function firstPageKey(version: Version, registry: FieldTypeRegistry): string {
  const first = visiblePages(version, {}, registry)[0] ?? version.pages[0];
  if (!first) throw new Error("a version has at least one page");
  return first.key;
}

function walk(
  version: Version,
  answers: Readonly<Record<string, unknown>>,
  registry: FieldTypeRegistry,
  current: string,
  step: 1 | -1,
): string | null {
  const index = version.pages.findIndex((p) => p.key === current);
  if (index < 0) return null;
  const visible = new Set(visiblePageKeys(version, answers, registry));
  for (let i = index + step; i >= 0 && i < version.pages.length; i += step) {
    const key = version.pages[i]?.key;
    if (key !== undefined && visible.has(key)) return key;
  }
  return null;
}

export function nextPageKey(
  version: Version,
  answers: Readonly<Record<string, unknown>>,
  registry: FieldTypeRegistry,
  current: string,
): string | null {
  return walk(version, answers, registry, current, 1);
}

export function previousPageKey(
  version: Version,
  answers: Readonly<Record<string, unknown>>,
  registry: FieldTypeRegistry,
  current: string,
): string | null {
  return walk(version, answers, registry, current, -1);
}

/**
 * "Page n of total" over the visible pages. A current page its condition just
 * hid counts itself: the visible pages before it plus one, of the total plus one.
 */
export function pagePosition(
  version: Version,
  answers: Readonly<Record<string, unknown>>,
  registry: FieldTypeRegistry,
  current: string,
): { n: number; total: number } {
  const visible = visiblePageKeys(version, answers, registry);
  const at = visible.indexOf(current);
  if (at >= 0) return { n: at + 1, total: visible.length };
  const index = version.pages.findIndex((p) => p.key === current);
  if (index < 0) return { n: 1, total: Math.max(1, visible.length) };
  const shown = new Set(visible);
  const before = version.pages.slice(0, index).filter((p) => shown.has(p.key)).length;
  return { n: before + 1, total: visible.length + 1 };
}
