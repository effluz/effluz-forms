import type { JobHandler } from "@/shared/application/ports/job-queue";
import type { PgJobStore } from "../pg-job-store";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * `jobs.cleanup`: prunes succeeded jobs older than 30 days. See
 * specs/system/jobs.md, "Recurring jobs".
 */
export function createCleanupHandler(store: PgJobStore): JobHandler {
  return async (_payload, ctx) => {
    const pruned = await store.pruneSucceeded(new Date(ctx.clock.now().getTime() - RETENTION_MS));
    ctx.logger.info("pruned succeeded jobs", { pruned });
  };
}
