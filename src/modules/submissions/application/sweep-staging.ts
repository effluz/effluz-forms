import { discardRecordFiles } from "@/modules/media/application";
import type { Logger } from "@/shared/application/ports/logger";
import { IN_PROGRESS_TTL_MS } from "../domain/in-progress";
import { recordHash } from "../domain/record-hash";
import type { SubmissionsDeps } from "./deps";
import { errorClass } from "./staging";

/** Media's staging root: each record stages under `in-progress/<record id>/` (specs/system/media-storage.md). */
const STAGING_ROOT = "in-progress/";
/** Ids the asking for claims is split into, so one statement stays small. */
const CHUNK = 500;
// Lowercase only: ids come from the database and randomUUID, and claimedStaging answers lowercase.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The staging sweep of `jobs.cleanup` (specs/system/jobs.md, "Recurring
 * jobs"): removes record prefixes untouched for 24 hours that no in-progress
 * row and no media row claims. They are left when a delete after commit fails
 * (a silent accept, the discarded files of a Submit) or the process stops
 * between staging and the first commit. The age keeps a first post whose row
 * is not committed yet. A prefix that is not a record id is never touched.
 * Returns how many prefixes were removed.
 */
export async function sweepStaging(
  deps: SubmissionsDeps,
  input: { now: Date; logger: Logger },
): Promise<number> {
  const cutoff = input.now.getTime() - IN_PROGRESS_TTL_MS;
  const candidates = (await deps.media.staging.listPrefixes(STAGING_ROOT))
    .filter((p) => p.modifiedAt.getTime() <= cutoff)
    .map((p) => p.prefix.slice(STAGING_ROOT.length, -1))
    .filter((id) => UUID.test(id));

  let removed = 0;
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    const claimed = await deps.inProgress.claimedStaging(chunk);
    for (const id of chunk) {
      if (claimed.has(id)) continue;
      try {
        await discardRecordFiles(deps.media, id);
        removed += 1;
      } catch (error) {
        input.logger.warn("orphaned staging prefix not removed", {
          recordHash: recordHash(id),
          errorClass: errorClass(error),
        });
      }
    }
  }
  input.logger.info("orphaned staging prefixes removed", { removed });
  return removed;
}
