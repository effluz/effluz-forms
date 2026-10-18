import type { Text } from "@/shared/presentation/copy";
import type { IsoDate } from "../domain/days";

/** The parts of a calendar day in `locale`, read at UTC so no machine zone can move the day. */
function parts(date: IsoDate, locale: string) {
  const format = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const at = new Date(`${date}T00:00:00Z`);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    format.formatToParts(at).find((p) => p.type === type)?.value ?? "";
  return { weekday: part("weekday"), day: part("day"), month: part("month"), year: part("year") };
}

/**
 * A calendar day in words, in both languages, assembled here so the order and punctuation do
 * not depend on the runtime's locale data: "Monday 19 October 2026" and "lunes, 19 de octubre
 * de 2026". `date` must be a real `IsoDate`.
 */
export function dayText(date: IsoDate): Text {
  const en = parts(date, "en-GB");
  const es = parts(date, "es");
  return {
    en: `${en.weekday} ${en.day} ${en.month} ${en.year}`,
    es: `${es.weekday}, ${es.day} de ${es.month} de ${es.year}`,
  };
}

/** A calendar day as `YYYY-MM-DD`, the same in both languages, for filters, links and cells. */
export function shortDay(date: IsoDate): string {
  return date;
}
