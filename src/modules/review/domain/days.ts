/** A calendar date, `YYYY-MM-DD`, with no time or zone. */
export type IsoDate = string;

/** The zone in which a planned day is a day: the organisation works in Panama. */
export const PLAN_TIME_ZONE = "America/Panama";

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const DAY_MS = 86_400_000;

function toUtc(date: IsoDate): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fromUtc(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

/** A real calendar date in the years 2000 to 2100, or null. */
export function parseIsoDate(value: string): IsoDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  const d = toUtc(value);
  if (Number.isNaN(d.getTime())) return null;
  return fromUtc(d) === value ? value : null;
}

export function todayIn(timeZone: string, now: Date): IsoDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addDays(date: IsoDate, n: number): IsoDate {
  return fromUtc(new Date(toUtc(date).getTime() + n * DAY_MS));
}

/** The Monday of the week that holds `date` (weeks run Monday to Sunday). */
export function mondayOf(date: IsoDate): IsoDate {
  const sinceMonday = (toUtc(date).getUTCDay() + 6) % 7;
  return addDays(date, -sinceMonday);
}

export function weekDays(monday: IsoDate): IsoDate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}
