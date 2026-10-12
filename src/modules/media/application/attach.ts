import type { Clock } from "@/shared/application/ports/clock";
import type { JobQueue } from "@/shared/application/ports/job-queue";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { StagedFile } from "../domain/media";
import { MEDIA_JOB_MAX_ATTEMPTS, MEDIA_JOB_TYPES } from "./job-types";
import type { MediaRepository } from "./ports/media-repository";

export interface AttachedFile {
  fieldKey: string;
  position: number;
  durableKey: string;
  file: StagedFile;
}

/**
 * Inside the intake transaction, records each staged file against the
 * submission and enqueues its upload. The staged file's id is the row id and
 * the job payload. See specs/architecture.md, "Submission data flow".
 */
export async function attachToSubmission(
  deps: { media: MediaRepository; queue: JobQueue; clock: Clock },
  uow: UnitOfWork,
  input: { submissionId: string; formId: string; files: readonly AttachedFile[] },
): Promise<void> {
  for (const { fieldKey, position, durableKey, file } of input.files) {
    const at = deps.clock.now();
    await deps.media.insert(uow, {
      id: file.id,
      submissionId: input.submissionId,
      formId: input.formId,
      fieldKey,
      position,
      kind: file.kind,
      status: "staged",
      contentType: file.contentType,
      size: file.size,
      stagingRef: file.stagingRef,
      durableKey,
      providerRef: null,
      createdAt: at,
      updatedAt: at,
    });
    await deps.queue.enqueue(
      uow,
      MEDIA_JOB_TYPES.upload,
      { mediaId: file.id },
      { maxAttempts: MEDIA_JOB_MAX_ATTEMPTS },
    );
  }
}
