/** Postgres SQLSTATE for a unique violation, and the one-story-per-day index. */
const UNIQUE_VIOLATION = "23505";
const SLOT_INDEX = "story_plan_slot_key";
const MAX_CAUSE_DEPTH = 5;

/**
 * True when `error`, or one of its causes, is the one-story-per-day index refusing a second
 * unpublished story on a day (specs/system/database.md, "story").
 */
export function isSlotTaken(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && e !== null && typeof e === "object"; depth++) {
    if (
      "code" in e &&
      e.code === UNIQUE_VIOLATION &&
      "constraint" in e &&
      e.constraint === SLOT_INDEX
    )
      return true;
    e = "cause" in e ? e.cause : null;
  }
  return false;
}
