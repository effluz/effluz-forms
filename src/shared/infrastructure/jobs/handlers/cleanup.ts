import type { JobHandler, JobHandlerContext } from "@/shared/application/ports/job-queue";
import { scrubError, type PgJobStore } from "../pg-job-store";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Housekeeping another module contributes to `jobs.cleanup`, wired in through
 * the worker's composition root. See specs/system/jobs.md, "Recurring jobs".
 */
export interface CleanupStep {
  /** Names the step in the log line written when it fails. */
  name: string;
  run: (ctx: JobHandlerContext) => Promise<void>;
}

/**
 * `jobs.cleanup`: prunes succeeded jobs older than 30 days, then runs every
 * step in order. A failing step is logged by name and does not stop the others;
 * the first failure is rethrown at the end so the job retries. See specs/system/jobs.md,
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
    for (const { name, run } of steps) {
      try {
        await run(ctx);
      } catch (e) {
        ctx.logger.warn("cleanup step failed", {
          step: name,
          error: e instanceof Error ? scrubError(e.message) : "unknown error",
        });
        failure ??= { error: e };
      }
    }
    if (failure) throw failure.error;
  };
}
