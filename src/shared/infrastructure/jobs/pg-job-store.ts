import type { Pool } from "pg";
import type { Clock } from "@/shared/application/ports/clock";
import type { JobPayload } from "@/shared/application/ports/job-queue";
import { backoffMs } from "./backoff";

export interface ClaimedJob {
  id: string;
  type: string;
  payload: JobPayload;
  attempts: number;
  maxAttempts: number;
}

export interface JobCounts {
  pending: number;
  running: number;
  dead: number;
  oldestPendingAgeSeconds: number | null;
}

const MAX_ERROR_LENGTH = 500;

/** Scrubs email-like tokens and truncates, so `last_error` and logs never carry personal data. */
export function scrubError(error: string): string {
  return error.replace(/\S+@\S+/g, "[redacted]").slice(0, MAX_ERROR_LENGTH);
}

function ageSeconds(now: Date, then: Date): number {
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));
}

/**
 * Worker-side persistence of the outbox: claiming, outcomes, heartbeat and
 * housekeeping. Every statement is a single autocommitted query. Times come
 * from the injected clock. See specs/system/jobs.md.
 */
export class PgJobStore {
  readonly leaseSeconds: number;

  constructor(
    private readonly pool: Pool,
    private readonly clock: Clock,
    opts: { leaseSeconds: number },
  ) {
    this.leaseSeconds = opts.leaseSeconds;
  }

  /**
   * Claims up to `limit` due jobs in `run_at` order, skipping rows other workers
   * hold. Also reclaims `running` jobs whose lease expired. `attempts` is
   * incremented here, so a claimed job's `attempts` counts the run about to start.
   */
  async claim(workerId: string, limit: number): Promise<ClaimedJob[]> {
    const now = this.clock.now();
    const leaseCutoff = new Date(now.getTime() - this.leaseSeconds * 1000);
    const res = await this.pool.query<{
      id: string;
      type: string;
      payload: JobPayload;
      attempts: number;
      max_attempts: number;
      run_at: Date;
    }>(
      `update job
          set status = 'running', attempts = attempts + 1, locked_at = $1, locked_by = $2, updated_at = now()
        where id in (
          select id from job
           where (status in ('pending','failed') and run_at <= $1)
              or (status = 'running' and locked_at < $3)
           order by run_at
             for update skip locked
           limit $4)
        returning id, type, payload, attempts, max_attempts, run_at`,
      [now, workerId, leaseCutoff, limit],
    );
    // UPDATE ... RETURNING does not preserve the subselect order.
    return res.rows
      .sort((a, b) => a.run_at.getTime() - b.run_at.getTime())
      .map((r) => ({
        id: r.id,
        type: r.type,
        payload: r.payload,
        attempts: r.attempts,
        maxAttempts: r.max_attempts,
      }));
  }

  /**
   * The claim is a fencing token: an outcome applies only while the row is still
   * `running`, locked by `workerId` and at the attempt number `claim` returned.
   * A worker whose lease expired and whose job another worker reclaimed gets
   * "lost" and changes nothing.
   */
  async succeed(job: ClaimedJob, workerId: string): Promise<"succeeded" | "lost"> {
    const res = await this.pool.query(
      `update job
          set status = 'succeeded', finished_at = $4, locked_at = null, locked_by = null, updated_at = now()
        where id = $1 and status = 'running' and locked_by = $2 and attempts = $3`,
      [job.id, workerId, job.attempts, this.clock.now()],
    );
    return res.rowCount === 1 ? "succeeded" : "lost";
  }

  /**
   * Records a failed run of a claimed job. Below `maxAttempts` the job is
   * retried after a backoff; otherwise it is dead. Fenced like `succeed`.
   */
  async fail(job: ClaimedJob, workerId: string, error: string): Promise<"retry" | "dead" | "lost"> {
    if (job.attempts >= job.maxAttempts) return this.markDead(job, workerId, error);
    const now = this.clock.now();
    const runAt = new Date(now.getTime() + backoffMs(job.attempts));
    const res = await this.pool.query(
      `update job
          set status = 'failed', last_error = $4, run_at = $5, locked_at = null, locked_by = null, updated_at = now()
        where id = $1 and status = 'running' and locked_by = $2 and attempts = $3`,
      [job.id, workerId, job.attempts, scrubError(error), runAt],
    );
    return res.rowCount === 1 ? "retry" : "lost";
  }

  /** Marks a claimed job dead without further retries. Fenced like `succeed`. */
  async markDead(job: ClaimedJob, workerId: string, error: string): Promise<"dead" | "lost"> {
    const res = await this.pool.query(
      `update job
          set status = 'dead', last_error = $4, finished_at = $5, locked_at = null, locked_by = null, updated_at = now()
        where id = $1 and status = 'running' and locked_by = $2 and attempts = $3`,
      [job.id, workerId, job.attempts, scrubError(error), this.clock.now()],
    );
    return res.rowCount === 1 ? "dead" : "lost";
  }

  /**
   * True when any job, in any status, carries this unique key. Used by the scheduler.
   * The check-then-insert race between two workers is accepted: handlers are
   * idempotent, so a duplicate recurring run is harmless.
   */
  async hasUniqueKey(uniqueKey: string): Promise<boolean> {
    const res = await this.pool.query("select 1 from job where unique_key = $1 limit 1", [
      uniqueKey,
    ]);
    return (res.rowCount ?? 0) > 0;
  }

  async heartbeat(workerId: string): Promise<void> {
    await this.pool.query(
      `insert into worker_heartbeat (id, worker_id, last_seen_at)
       values ($1, $2, $3)
       on conflict (worker_id) do update set last_seen_at = excluded.last_seen_at, updated_at = now()`,
      [crypto.randomUUID(), workerId, this.clock.now()],
    );
  }

  /** Seconds since the newest heartbeat of any worker, or null when none was ever written. */
  async heartbeatAgeSeconds(): Promise<number | null> {
    const res = await this.pool.query<{ last: Date | null }>(
      "select max(last_seen_at) as last from worker_heartbeat",
    );
    const last = res.rows[0]?.last;
    return last ? ageSeconds(this.clock.now(), last) : null;
  }

  /**
   * `pending` counts every job waiting to run, including failed jobs awaiting a
   * retry. The oldest age is measured from `run_at` over jobs already due.
   */
  async counts(): Promise<JobCounts> {
    const now = this.clock.now();
    const res = await this.pool.query<{
      pending: number;
      running: number;
      dead: number;
      oldest: Date | null;
    }>(
      `select count(*) filter (where status in ('pending','failed'))::int as pending,
              count(*) filter (where status = 'running')::int as running,
              count(*) filter (where status = 'dead')::int as dead,
              min(run_at) filter (where status in ('pending','failed') and run_at <= $1) as oldest
         from job`,
      [now],
    );
    const r = res.rows[0];
    return {
      pending: r?.pending ?? 0,
      running: r?.running ?? 0,
      dead: r?.dead ?? 0,
      oldestPendingAgeSeconds: r?.oldest ? ageSeconds(now, r.oldest) : null,
    };
  }

  /** Deletes succeeded jobs finished before `olderThan`. Returns how many. */
  async pruneSucceeded(olderThan: Date): Promise<number> {
    const res = await this.pool.query(
      "delete from job where status = 'succeeded' and finished_at < $1",
      [olderThan],
    );
    return res.rowCount ?? 0;
  }
}
