import {
  listQueryString,
  parseIsoDate,
  parseListQuery,
  type IsoDate,
  type ListQuery,
} from "../application";

/** The in-page confirmations a story page opens with `?action=`. */
export const STORY_ACTIONS = ["revert", "publish", "unpublish", "remove_photo", "delete"] as const;

/** The flash of the last change, `?done=`. */
export const STORY_DONE = [
  "saved",
  "reverted",
  "published",
  "unpublished",
  "unpublished_waiting",
  "photos_added",
  "photo_removed",
  "planned",
  "plan_cleared",
  "retried",
  "check_saved",
  "choice_saved",
] as const;

/** A refusal sent back by a story route, `?error=`. */
export const STORY_ERRORS = [
  "correction_blank",
  "correction_too_long",
  "post_url_invalid",
  "not_confirmed",
  "source_invalid",
  "no_files",
  "too_many_files",
  "staff_photos_max",
  "file_too_large",
  "file_wrong_type",
  "file_unreadable",
  "consent_missing",
  "no_photos_chosen",
  "date_invalid",
  "published",
  "reference_mismatch",
] as const;

export type StoryAction = (typeof STORY_ACTIONS)[number];
export type StoryDone = (typeof STORY_DONE)[number];
export type StoryError = (typeof STORY_ERRORS)[number];

/**
 * The story page's query: the list's (so Back, Newer and Older follow it) and the page's own
 * keys. See specs/ui-ux/manager.md, "Routes".
 */
export interface StoryParams {
  query: ListQuery;
  edit: string | null;
  compare: string | null;
  photo: string | null;
  action: StoryAction | null;
  field: string | null;
  media: string | null;
  /** `conflict_date`, `conflict_ref` and `conflict_swap=1`. */
  conflict: { date: IsoDate; ref: string; canSwap: boolean } | null;
  done: StoryDone | null;
  error: StoryError | null;
  /** A count or a file position for the flash text. */
  n: number | null;
  /** A reference for the flash text. */
  other: string | null;
}

/** The longest field key, media id or reference the page takes from its query. */
const VALUE_MAX = 200;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function word(value: string | undefined): string | null {
  return value === undefined || value === "" || value.length > VALUE_MAX ? null : value;
}

function oneOf<T extends string>(values: readonly T[], value: string | undefined): T | null {
  return values.find((v) => v === value) ?? null;
}

function positiveInt(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

export function parseStoryParams(
  params: Readonly<Record<string, string | string[] | undefined>>,
): StoryParams {
  const get = (key: string) => first(params[key]);
  const conflictDate = get("conflict_date");
  const date = conflictDate === undefined ? null : parseIsoDate(conflictDate);
  const ref = word(get("conflict_ref"));
  return {
    query: parseListQuery(params),
    edit: word(get("edit")),
    compare: word(get("compare")),
    photo: word(get("photo")),
    action: oneOf(STORY_ACTIONS, get("action")),
    field: word(get("field")),
    media: word(get("media")),
    conflict:
      date === null || ref === null ? null : { date, ref, canSwap: get("conflict_swap") === "1" },
    done: oneOf(STORY_DONE, get("done")),
    error: oneOf(STORY_ERRORS, get("error")),
    n: positiveInt(get("n")),
    other: word(get("other")),
  };
}

/** The story page without any query: `/admin/forms/<id>/submissions/<reference>`. */
function storyBase(formId: string, reference: string): string {
  return `/admin/forms/${encodeURIComponent(formId)}/submissions/${encodeURIComponent(reference)}`;
}

/** The story page URL with the list query and the given story params. */
export function storyPath(
  formId: string,
  reference: string,
  query: ListQuery,
  story: Partial<Omit<StoryParams, "query">> = {},
): string {
  const pairs: string[] = [];
  const add = (key: string, value: string | null | undefined): void => {
    if (value !== null && value !== undefined) pairs.push(`${key}=${encodeURIComponent(value)}`);
  };
  add("edit", story.edit);
  add("compare", story.compare);
  add("photo", story.photo);
  add("action", story.action);
  add("field", story.field);
  add("media", story.media);
  if (story.conflict) {
    add("conflict_date", story.conflict.date);
    add("conflict_ref", story.conflict.ref);
    if (story.conflict.canSwap) add("conflict_swap", "1");
  }
  add("done", story.done);
  add("error", story.error);
  add("n", story.n === null || story.n === undefined ? null : String(story.n));
  add("other", story.other);
  const list = listQueryString(query);
  const own = pairs.join("&");
  const search = list === "" ? (own === "" ? "" : `?${own}`) : own === "" ? list : `${list}&${own}`;
  return `${storyBase(formId, reference)}${search}`;
}

/** Where a story form posts: `/admin/forms/<id>/submissions/<reference>/<route>`. */
export function storyActionPath(formId: string, reference: string, route: string): string {
  return `${storyBase(formId, reference)}/${route}`;
}
