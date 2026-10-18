import { parseIsoDate, type IsoDate } from "./days";
import { REVIEW_STATUSES, type ReviewStatus } from "./status";

export const LIST_PAGE_SIZE = 50;
export const PLAN_FILTERS = ["planned", "waiting", "not_ready"] as const;
export type PlanFilter = (typeof PLAN_FILTERS)[number];

const SEARCH_MAX = 100;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Replaces any half of a surrogate pair with U+FFFD, so the text can always be URL-encoded. */
function wellFormed(value: string): string {
  return value.replace(LONE_SURROGATE, "\uFFFD");
}

/** Cuts by code points, so a character is never split. */
function cut(value: string, max: number): string {
  return Array.from(wellFormed(value)).slice(0, max).join("");
}

export interface ListQuery {
  status: ReviewStatus | null;
  plan: PlanFilter | null;
  from: IsoDate | null;
  to: IsoDate | null;
  version: number | null;
  media: boolean;
  q: string | null;
  page: number;
}

export const EMPTY_QUERY: ListQuery = {
  status: null,
  plan: null,
  from: null,
  to: null,
  version: null,
  media: false,
  q: null,
  page: 1,
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInt(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

function oneOf<T extends string>(values: readonly T[], value: string | undefined): T | null {
  return values.find((v) => v === value) ?? null;
}

export function parseListQuery(
  params: Readonly<Record<string, string | string[] | undefined>>,
): ListQuery {
  const from = first(params["from"]);
  const to = first(params["to"]);
  const q = cut((first(params["q"]) ?? "").trim(), SEARCH_MAX).trim();
  return {
    status: oneOf(REVIEW_STATUSES, first(params["status"])),
    plan: oneOf(PLAN_FILTERS, first(params["plan"])),
    from: from === undefined ? null : parseIsoDate(from),
    to: to === undefined ? null : parseIsoDate(to),
    version: positiveInt(first(params["version"])),
    media: first(params["media"]) === "1",
    q: q === "" ? null : q,
    page: positiveInt(first(params["page"])) ?? 1,
  };
}

/** Canonical `?key=value&...` in a fixed order; defaults left out; "" when empty. */
export function listQueryString(q: ListQuery, over: Partial<ListQuery> = {}): string {
  const m: ListQuery = { ...q, ...over };
  const pairs: string[] = [];
  const add = (key: string, value: string): void => {
    pairs.push(`${key}=${encodeURIComponent(wellFormed(value))}`);
  };
  if (m.status !== null) add("status", m.status);
  if (m.plan !== null) add("plan", m.plan);
  if (m.from !== null) add("from", m.from);
  if (m.to !== null) add("to", m.to);
  if (m.version !== null) add("version", String(m.version));
  if (m.media) add("media", "1");
  if (m.q !== null) add("q", m.q);
  if (m.page !== 1) add("page", String(m.page));
  return pairs.length === 0 ? "" : `?${pairs.join("&")}`;
}
