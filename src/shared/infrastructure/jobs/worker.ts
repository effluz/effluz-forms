import type { Clock } from "@/shared/application/ports/clock";
import type {
  JobHandler,
  JobHandlerContext,
  JobPayload,
  JobQueue,
} from "@/shared/application/ports/job-queue";
import type { Logger } from "@/shared/application/ports/logger";
import type { UnitOfWorkFactory } from "@/shared/application/ports/unit-of-work";
import { scrubError, type ClaimedJob, type PgJobStore } from "./pg-job-store";

export interface RecurringJob {
  type: string;
  period: "daily" | "hourly";
  payload?: JobPayload;
}

export interface WorkerOptions {
  workerId: string;
  concurrency: number;
  pollIntervalMs: number;
  jobTimeoutMs: number;
  handlers: Record<string, JobHandler>;
  recurring: RecurringJob[];
}

export interface WorkerDeps {
  store: PgJobStore;
  queue: JobQueue;
  uow: UnitOfWorkFactory;
  clock: Clock;
  logger: Logger;
}

/** Headroom between a job's timeout and its lease, covering clock skew and the outcome write. */
const LEASE_MARGIN_MS = 10_000;

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/** `YYYY-MM-DD` or `YYYY-MM-DDTHH`, in UTC. */
function bucketOf(now: Date, period: RecurringJob["period"]): string {
  return now.toISOString().slice(0, period === "daily" ? 10 : 13);
}

/**
 * Polls the outbox, runs handlers with a per-job timeout, records outcomes and
 * a heartbeat, and schedules recurring jobs. See specs/system/jobs.md.
 */
export class Worker {
  private running = false;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  /** Latest scheduling key seen per recurring type, to skip a query per poll. */
  private readonly scheduledKeys = new Map<string, string>();

  constructor(
    private readonly deps: WorkerDeps,
    private readonly opts: WorkerOptions,
  ) {
    // The timeout timer starts after the claim stamps `locked_at`, so the job
    // must be given up on well before another worker may reclaim it.
    const leaseMs = deps.store.leaseSeconds * 1000;
    if (opts.jobTimeoutMs <= 0 || opts.jobTimeoutMs + LEASE_MARGIN_MS > leaseMs)
      throw new Error(
        `Invalid worker options: jobTimeoutMs (${String(opts.jobTimeoutMs)}) plus ${String(LEASE_MARGIN_MS)} ms must fit inside the lease (${String(leaseMs)} ms)`,
      );
  }

  /** One poll. Returns the number of jobs run. Handler failures never escape. */
  async tick(): Promise<number> {
    await this.scheduleRecurring();
    const jobs = await this.deps.store.claim(this.opts.workerId, this.opts.concurrency);
    await Promise.all(jobs.map((j) => this.run(j)));
    await this.deps.store.heartbeat(this.opts.workerId);
    return jobs.length;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  /** Stops polling and waits for the poll in progress, including its handlers. */
  async stop(): Promise<void> {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.running) return;
      this.inFlight = this.poll().finally(() => {
        this.inFlight = undefined;
      });
    }, delayMs);
  }

  private async poll(): Promise<void> {
    let ran = 0;
    try {
      ran = await this.tick();
    } catch (e) {
      // Database trouble: log the message only and try again next interval.
      this.deps.logger.error("worker poll failed", {
        message: e instanceof Error ? scrubError(e.message) : "unknown error",
      });
    }
    if (this.running) this.schedule(ran >= this.opts.concurrency ? 0 : this.opts.pollIntervalMs);
  }

  private async scheduleRecurring(): Promise<void> {
    const now = this.deps.clock.now();
    for (const job of this.opts.recurring) {
      const uniqueKey = `${job.type}:${bucketOf(now, job.period)}`;
      if (this.scheduledKeys.get(job.type) === uniqueKey) continue;
      // The queue's unique index only guards pending and running jobs, so a job
      // that already ran in this bucket must be looked up explicitly.
      if (!(await this.deps.store.hasUniqueKey(uniqueKey))) {
        await this.deps.uow.run((uow) =>
          this.deps.queue.enqueue(uow, job.type, job.payload ?? {}, { uniqueKey }),
        );
      }
      this.scheduledKeys.set(job.type, uniqueKey);
    }
  }

  private async run(job: ClaimedJob): Promise<void> {
    const log = this.deps.logger.child({ jobId: job.id, jobType: job.type, attempt: job.attempts });
    const { store } = this.deps;
    const { workerId } = this.opts;
    try {
      if (job.attempts > job.maxAttempts) {
        // Reclaimed after its lease expired on the final attempt: do not run it again.
        const outcome = await store.markDead(job, workerId, "lease expired on final attempt");
        if (outcome === "lost") log.warn("lease lost");
        else log.error("job failed", { outcome });
        return;
      }
      const handler = this.opts.handlers[job.type];
      if (!handler) {
        const outcome = await store.fail(job, workerId, `no handler for ${job.type}`);
        if (outcome === "lost") log.warn("lease lost");
        else log.error("no handler registered", { outcome });
        return;
      }
      const ctx: JobHandlerContext = {
        jobId: job.id,
        attempt: job.attempts,
        logger: log,
        uow: this.deps.uow,
        queue: this.deps.queue,
        clock: this.deps.clock,
      };
      try {
        await withTimeout(
          handler(job.payload, ctx),
          this.opts.jobTimeoutMs,
          `job timed out after ${String(this.opts.jobTimeoutMs)} ms`,
        );
      } catch (e) {
        const outcome = await store.fail(job, workerId, e instanceof Error ? e.message : String(e));
        if (outcome === "lost") log.warn("lease lost");
        else if (outcome === "dead") log.error("job failed", { outcome });
        else log.warn("job failed", { outcome });
        return;
      }
      if ((await store.succeed(job, workerId)) === "lost") log.warn("lease lost");
    } catch (e) {
      // The outcome could not be recorded. The lease expiry will release the job.
      log.error("could not record job outcome", {
        message: e instanceof Error ? scrubError(e.message) : "unknown error",
      });
    }
  }
}
