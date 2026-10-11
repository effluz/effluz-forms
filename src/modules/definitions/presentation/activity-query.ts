import type { ActivityFilter } from "../application";

/** Entries on one page; `formActivity` reports whether older ones exist. */
export const ACTIVITY_PAGE_SIZE = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Query = Record<string, string | string[] | undefined>;

function first(query: Query, name: string): string {
  const value = query[name];
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim();
}

/**
 * The filter the Activity tab's query string asks for. A parameter that is blank or
 * unreadable is ignored: `before` must parse to a date, and `beforeId` counts only
 * next to a readable `before` and only as a UUID. The page size is fixed, so a
 * `limit` in the query is not read. See specs/ui-ux/manager.md, "Activity tab".
 */
export function activityFilter(query: Query): ActivityFilter {
  const actor = first(query, "actor");
  const action = first(query, "action");
  const before = new Date(first(query, "before"));
  const beforeId = first(query, "beforeId");
  const cursor = !Number.isNaN(before.getTime());
  return {
    ...(actor === "" ? {} : { actorEmail: actor }),
    ...(action === "" ? {} : { action }),
    ...(cursor ? { before } : {}),
    ...(cursor && UUID.test(beforeId) ? { beforeId } : {}),
    limit: ACTIVITY_PAGE_SIZE,
  };
}
