/** The checks that make a story ready to post: `specs/use-cases/review-submissions.md`. */
export interface StoryChecks {
  /** Media ids, sorted and unique. */
  chosen: readonly string[];
  /** The chosen set at the moment "edited" was ticked. */
  photosEditedFor: readonly string[] | null;
  textCheckedAt: Date | null;
}

export interface Readiness {
  photosChosen: boolean;
  photosEdited: boolean;
  textChecked: boolean;
  ready: boolean;
  done: 0 | 1 | 2 | 3;
}

export const NO_CHECKS: StoryChecks = { chosen: [], photosEditedFor: null, textCheckedAt: null };

export function normalizeIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = normalizeIds(a);
  const right = normalizeIds(b);
  return left.length === right.length && left.every((id, i) => id === right[i]);
}

export function readiness(c: StoryChecks): Readiness {
  const photosChosen = c.chosen.length > 0;
  const photosEdited =
    photosChosen && c.photosEditedFor !== null && sameSet(c.chosen, c.photosEditedFor);
  const textChecked = c.textCheckedAt !== null;
  const done = ((photosChosen ? 1 : 0) + (photosEdited ? 1 : 0) + (textChecked ? 1 : 0)) as
    0 | 1 | 2 | 3;
  return {
    photosChosen,
    photosEdited,
    textChecked,
    ready: photosChosen && photosEdited && textChecked,
    done,
  };
}

/** Ticked once but the chosen set has changed since. */
export function editedStale(c: StoryChecks): boolean {
  return c.photosEditedFor !== null && !sameSet(c.chosen, c.photosEditedFor);
}

export function withChoice(
  chosen: readonly string[],
  mediaId: string,
  chosenNow: boolean,
): string[] {
  const rest = chosen.filter((id) => id !== mediaId);
  return normalizeIds(chosenNow ? [...rest, mediaId] : rest);
}
