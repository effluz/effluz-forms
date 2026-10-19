import type { JobPayload } from "./job-queue";
import type { UnitOfWork } from "./unit-of-work";

export interface DeadJob {
  id: string;
  type: string;
  payload: JobPayload;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

/** Operator actions on the outbox. See specs/use-cases/operate-jobs.md. */
export interface JobAdmin {
  /** Dead jobs, the most recently dead first, at most `limit`. */
  listDead(limit: number): Promise<DeadJob[]>;
  /** Dead jobs whose payload names the submission or one of the media ids. */
  deadFor(ref: { submissionId: string; mediaIds: readonly string[] }): Promise<DeadJob[]>;
  /** How many jobs of the type are dead, and the newest `limit` of them. */
  deadOfType(type: string, limit: number): Promise<{ count: number; jobs: DeadJob[] }>;
  /** Dead to pending: attempts 0, run_at now, lock, finished_at and unique_key cleared. The job's type, or null when it was not dead. */
  retry(uow: UnitOfWork, id: string, now: Date): Promise<string | null>;
  /** Dead to discarded with the reason and finished_at now. The job's type, or null when it was not dead. */
  discard(uow: UnitOfWork, id: string, reason: string, now: Date): Promise<string | null>;
  /** Retries every dead job of the type; returns their ids. */
  retryAllOfType(uow: UnitOfWork, type: string, now: Date): Promise<string[]>;
  /** Seconds since the newest worker heartbeat, or null when none was ever written. */
  heartbeatAgeSeconds(now: Date): Promise<number | null>;
}
