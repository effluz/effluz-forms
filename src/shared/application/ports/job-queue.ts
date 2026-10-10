import type { Clock } from "./clock";
import type { Logger } from "./logger";
import type { UnitOfWork, UnitOfWorkFactory } from "./unit-of-work";

/** Identifiers only; never personal data. See specs/system/jobs.md. */
export type JobPayload = Record<string, string | number | boolean | null>;

export interface EnqueueOptions {
  runAt?: Date;
  uniqueKey?: string;
  maxAttempts?: number;
}

export interface JobQueue {
  /** Inserts inside the given unit of work. Returns the job id, or null when uniqueKey is already pending or running. */
  enqueue(
    uow: UnitOfWork,
    type: string,
    payload: JobPayload,
    opts?: EnqueueOptions,
  ): Promise<string | null>;
}

export interface JobHandlerContext {
  jobId: string;
  attempt: number;
  logger: Logger;
  uow: UnitOfWorkFactory;
  queue: JobQueue;
  clock: Clock;
}

export type JobHandler = (payload: JobPayload, ctx: JobHandlerContext) => Promise<void>;

export const DEFAULT_MAX_ATTEMPTS = 8;
