import { PermanentJobError } from "@/shared/application/ports/job-queue";
import type { JobHandler, JobPayload } from "@/shared/application/ports/job-queue";
import type { MediaDeps } from "./deps";

function mediaIdOf(payload: JobPayload): string {
  const { mediaId } = payload;
  if (typeof mediaId !== "string") throw new PermanentJobError("payload has no mediaId");
  return mediaId;
}

/**
 * The `media.upload` handler: moves one staged file to durable storage. Every
 * step is safe to repeat, so a retry after a crash finishes the work without
 * a second upload. The staging copy goes only after the durable write is
 * recorded. See specs/system/jobs.md, "Handler rules", and
 * specs/system/media-storage.md, "Lifecycle".
 */
export function createMediaUploadHandler(deps: MediaDeps): JobHandler {
  return async (payload, ctx) => {
    const mediaId = mediaIdOf(payload);
    let recorded = false;
    try {
      const row = await deps.media.findById(mediaId);
      if (row === null) {
        ctx.logger.info("media no longer exists", { mediaId });
        return;
      }

      if (row.providerRef === null) {
        if (row.stagingRef === null || !(await deps.staging.exists(row.stagingRef)))
          throw new PermanentJobError("staging copy is missing");
        const bytes = await deps.staging.read(row.stagingRef);
        const providerRef = await deps.durable.put(bytes, row.durableKey, row.contentType);
        const updated = await deps.uow.run((uow) =>
          deps.media.markStored(uow, mediaId, providerRef, deps.clock.now()),
        );
        if (!updated) {
          // The row was deleted while the upload ran: nothing points at the file.
          await deps.durable.delete(providerRef);
          await deps.staging.delete(row.stagingRef);
          ctx.logger.info("media deleted during upload", { mediaId });
          recorded = true;
          return;
        }
      }
      recorded = true;

      if (row.stagingRef !== null) {
        await deps.staging.delete(row.stagingRef);
        await deps.uow.run((uow) => deps.media.clearStaging(uow, mediaId, deps.clock.now()));
      }
      ctx.logger.info("media stored", { mediaId });
    } catch (error) {
      const final = error instanceof PermanentJobError || ctx.attempt >= ctx.maxAttempts;
      // A row that is already stored stays stored: only cleanup is left.
      if (final && !recorded) {
        try {
          await deps.uow.run((uow) => deps.media.markFailed(uow, mediaId, deps.clock.now()));
        } catch {
          ctx.logger.warn("media could not be marked failed", { mediaId });
        }
      }
      throw error;
    }
  };
}

/**
 * The `media.delete` handler: removes the durable copy, then the staging copy,
 * then the row, each tolerating a copy that is already gone, so a retry
 * resumes where a crash stopped. See specs/system/media-storage.md,
 * "Lifecycle".
 */
export function createMediaDeleteHandler(deps: MediaDeps): JobHandler {
  return async (payload, ctx) => {
    const mediaId = mediaIdOf(payload);
    const row = await deps.media.findById(mediaId);
    if (row === null) return;

    await deps.durable.delete(row.providerRef ?? deps.durable.refForKey(row.durableKey));
    if (row.stagingRef !== null) await deps.staging.delete(row.stagingRef);
    await deps.uow.run((uow) => deps.media.delete(uow, mediaId));
    ctx.logger.info("media deleted", { mediaId });
  };
}
