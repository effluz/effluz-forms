import type { Locale } from "@/shared/domain/localized-text";
import type { RefusedFileMessage } from "../page-form-state";
import type { SummaryItem } from "../field-views";

/**
 * The summary's entries in field order. A field's stored entry gives way to its refused
 * files' messages (they say more); a field with only refused files gets them at the end.
 * See specs/ui-ux/renderer.md, "Validation and errors".
 */
export function summaryEntries(
  items: readonly SummaryItem[],
  refused: readonly RefusedFileMessage[],
): { href: string; message: string }[] {
  const refusedKeys = new Set(refused.map((r) => r.fieldKey));
  const entries: { href: string; message: string }[] = [];
  const placed = new Set<string>();
  const addRefused = (fieldKey: string): void => {
    if (placed.has(fieldKey)) return;
    placed.add(fieldKey);
    for (const r of refused)
      if (r.fieldKey === fieldKey) entries.push({ href: `#f-${fieldKey}`, message: r.message });
  };
  for (const item of items) {
    if (refusedKeys.has(item.fieldKey)) addRefused(item.fieldKey);
    else entries.push({ href: item.href, message: item.message });
  }
  for (const r of refused) addRefused(r.fieldKey);
  return entries;
}

/** The heading by the language's plural rule; `{count}` is filled in the other form. */
export function summaryHeading(
  count: number,
  locale: Locale,
  headings: { one: string; other: string },
): string {
  if (new Intl.PluralRules(locale).select(count) === "one") return headings.one;
  return headings.other.replaceAll("{count}", new Intl.NumberFormat(locale).format(count));
}
