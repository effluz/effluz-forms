import type { JobHandler, JobHandlerContext } from "@/shared/application/ports/job-queue";
import type { PgJobStore } from "../pg-job-store";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Housekeeping another module contributes to `jobs.cleanup`, wired in through
 * the worker's composition root. See specs/system/jobs.md, "Recurring jobs".
 */
export type CleanupStep = (ctx: JobHandlerContext) => Promise<void>;

/**
 * `jobs.cleanup`: prunes succeeded jobs older than 30 days, then runs every
 * step in order. A failing step does not stop the others; the first failure is
 * rethrown at the end so the job retries. See specs/system/jobs.md,
 * "Recurring jobs".
 *
 * The store is narrowed to the one method the handler calls, so a unit test
 * can stub it.
 */
export function createCleanupHandler(
  store: Pick<PgJobStore, "pruneSucceeded">,
  steps: readonly CleanupStep[] = [],
): JobHandler {
  return async (_payload, ctx) => {
    const pruned = await store.pruneSucceeded(new Date(ctx.clock.now().getTime() - RETENTION_MS));
    ctx.logger.info("pruned succeeded jobs", { pruned });
    let failure: { error: unknown } | undefined;
    for (const step of steps) {
      try {
        await step(ctx);
      } catch (e) {
        failure ??= { error: e };
      }
    }
    if (failure) throw failure.error;
  };
}
