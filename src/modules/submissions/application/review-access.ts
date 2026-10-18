import { enqueueSubmissionMediaDeletes } from "@/modules/media/application";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { Curation, StoredSubmission } from "../domain/submission";
import type { SubmissionsDeps } from "./deps";

/**
 * Review's door to stored submissions (specs/use-cases/review-submissions.md).
 * Curation lives in columns beside `answers`; these use cases write only those
 * columns, so the sender's answers stay byte-identical.
 */

export function findSubmission(
  deps: SubmissionsDeps,
  id: string,
): Promise<StoredSubmission | null> {
  return deps.submissions.findStored(id);
}

export function findSubmissionByReference(
  deps: SubmissionsDeps,
  formId: string,
  reference: string,
): Promise<StoredSubmission | null> {
  return deps.submissions.findByReference(formId, reference);
}

/** Takes the submission row lock, the first lock of every review change. */
export function lockSubmission(
  deps: SubmissionsDeps,
  uow: UnitOfWork,
  id: string,
): Promise<StoredSubmission | null> {
  return deps.submissions.lockForUpdate(uow, id);
}

export function writeCuration(
  deps: SubmissionsDeps,
  uow: UnitOfWork,
  id: string,
  curation: Curation,
): Promise<void> {
  return deps.submissions.writeCuration(uow, id, curation);
}

/**
 * Inside the caller's unit of work: deletes the row (review state cascades)
 * and enqueues `media.delete` for every media row. A submission that is
 * already gone enqueues nothing. The media rows are read on the unit of work's
 * connection, so a staff upload holding the row lock is seen.
 */
export async function deleteSubmission(
  deps: SubmissionsDeps,
  uow: UnitOfWork,
  id: string,
): Promise<{ deleted: boolean; mediaDeletes: number }> {
  const deleted = await deps.submissions.delete(uow, id);
  if (!deleted) return { deleted, mediaDeletes: 0 };
  return { deleted, mediaDeletes: await enqueueSubmissionMediaDeletes(deps.media, uow, id) };
}
