import { discardRecordFiles } from "@/modules/media/application";
import type { Logger } from "@/shared/application/ports/logger";
import { recordHash } from "../domain/record-hash";
import type { SubmissionsDeps } from "./deps";
import { errorClass } from "./staging";

const BATCH = 500;

/**
 * The submissions step of `jobs.cleanup` (specs/system/jobs.md, "Recurring
 * jobs"): removes in-progress records past their 24 hours, in batches of
 * `limit`. Each record goes in its own unit of work, files first and under the
 * row lock, so a failure leaves the row for the next run rather than orphaned
 * files. Returns how many records were removed.
 */
export async function expireInProgress(
  deps: SubmissionsDeps,
  input: { now: Date; logger: Logger; limit?: number },
): Promise<number> {
  const limit = input.limit ?? BATCH;
  let removed = 0;
  for (;;) {
    const ids = await deps.inProgress.listExpired(input.now, limit);
    let removedNow = 0;
    for (const id of ids) {
      try {
        const gone = await deps.uow.run(async (uow) => {
          // Locked without parsing: a row that no longer parses still goes.
          if (!(await deps.inProgress.lockExpired(uow, id, input.now))) return false;
          await discardRecordFiles(deps.media, id);
          await deps.inProgress.delete(uow, id);
          return true;
        });
        if (gone) removedNow += 1;
      } catch (error) {
        input.logger.warn("expired in-progress record not removed", {
          recordHash: recordHash(id),
          errorClass: errorClass(error),
        });
      }
    }
    removed += removedNow;
    // A short batch is the last; a batch that removed nothing would only list the same rows again.
    if (ids.length < limit || removedNow === 0) break;
  }
  input.logger.info("expired in-progress records removed", { removed });
  return removed;
}
