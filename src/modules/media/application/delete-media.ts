import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { MediaDeps } from "./deps";
import { MEDIA_JOB_MAX_ATTEMPTS, MEDIA_JOB_TYPES } from "./job-types";

/**
 * Enqueues `media.delete` for every media row of the submission, staff photos
 * included, inside the caller's unit of work; returns how many. The rows are
 * read on that unit of work's connection, so a delete and a staff upload
 * holding the submission row lock see the same rows. The jobs remove the files
 * and then the rows. See specs/system/media-storage.md, "Lifecycle".
 */
export async function enqueueSubmissionMediaDeletes(
  deps: Pick<MediaDeps, "media" | "queue">,
  uow: UnitOfWork,
  submissionId: string,
): Promise<number> {
  const rows = await deps.media.listBySubmission(submissionId, uow);
  for (const row of rows) await enqueueMediaDelete(deps, uow, row.id);
  return rows.length;
}

export async function enqueueMediaDelete(
  deps: Pick<MediaDeps, "queue">,
  uow: UnitOfWork,
  mediaId: string,
): Promise<void> {
  await deps.queue.enqueue(
    uow,
    MEDIA_JOB_TYPES.delete,
    { mediaId },
    { maxAttempts: MEDIA_JOB_MAX_ATTEMPTS },
  );
}
