/**
 * The curation status ladder of `specs/use-cases/curate-submission.md`. This is the review
 * domain's own twin of the submissions module's `CurationStatus`: a domain may not import
 * another module, and both are plain strings, so they stay assignable to one another.
 */
export const REVIEW_STATUSES = ["new", "viewed", "edited", "published"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** The first open turns `new` into `viewed`; every other status stays. */
export function statusAfterOpen(status: ReviewStatus): ReviewStatus {
  return status === "new" ? "viewed" : status;
}

/** A saved edit makes the story `edited`, except a published one, which stays published. */
export function statusAfterEdit(status: ReviewStatus): ReviewStatus {
  return status === "published" ? "published" : "edited";
}

/** Reverting the last correction of an `edited` story returns it to `viewed`. */
export function statusAfterRevert(
  status: ReviewStatus,
  remainingCorrections: number,
): ReviewStatus {
  return status === "edited" && remainingCorrections === 0 ? "viewed" : status;
}

/** Unmarking published returns to `edited` if any corrections exist, otherwise `viewed`. */
export function statusAfterUnpublish(corrections: number): ReviewStatus {
  return corrections > 0 ? "edited" : "viewed";
}
