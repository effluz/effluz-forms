const formats = new Map<string, Intl.DateTimeFormat>();

function stamp(date: Date, timeZone: string): string {
  let format = formats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formats.set(timeZone, format);
  }
  const parts = format.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

/**
 * A moment as `YYYY-MM-DD HH:mm` in `timezone`, labelled with the zone, and in
 * UTC; the same in both languages. Both are shown. In UTC the two are equal.
 * See specs/ui-ux/manager.md, "Forms list (home)".
 */
export function formatDate(iso: string | Date, timezone: string): { local: string; utc: string } {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const utc = `${stamp(date, "UTC")} UTC`;
  return { local: timezone === "UTC" ? utc : `${stamp(date, timezone)} ${timezone}`, utc };
}
