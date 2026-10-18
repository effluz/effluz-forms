import { EMPTY_QUERY, listQueryString, type ListQuery } from "../application";

/** The Submissions tab of a form, with the query's filters and page: `/admin/forms/<id><query>`. */
export function listHref(formId: string, query: ListQuery): string {
  return `/admin/forms/${encodeURIComponent(formId)}${listQueryString(query)}`;
}

/**
 * A filter chip's link: the list with `over` applied and the page back to 1. A chip that is
 * already active (every value in `over` is the current one) links to the list without that
 * filter, which is how it is turned off.
 */
export function chipHref(formId: string, query: ListQuery, over: Partial<ListQuery>): string {
  const keys = Object.keys(over) as (keyof ListQuery)[];
  const next: ListQuery = { ...query, ...over, page: 1 };
  if (keys.every((key) => query[key] === over[key]))
    Object.assign(next, Object.fromEntries(keys.map((key) => [key, EMPTY_QUERY[key]])));
  return listHref(formId, next);
}

/** A story page, keeping the list's query so its Back, Newer and Older links follow it. */
export function storyHref(formId: string, reference: string, query: ListQuery): string {
  return `/admin/forms/${encodeURIComponent(formId)}/submissions/${encodeURIComponent(reference)}${listQueryString(query)}`;
}

/** The list with the export dialog open (`?export=1`), keeping the filters it will export. */
export function exportHref(formId: string, query: ListQuery): string {
  const base = listHref(formId, query);
  return `${base}${base.includes("?") ? "&" : "?"}export=1`;
}

/** The public share page of a form, for the empty state. */
export function shareHref(formId: string): string {
  return `/admin/forms/${encodeURIComponent(formId)}/share`;
}
