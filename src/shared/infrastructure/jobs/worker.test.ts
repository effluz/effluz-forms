import { describe, expect, it } from "vitest";
import type { Clock } from "@/shared/application/ports/clock";
import type { JobQueue } from "@/shared/application/ports/job-queue";
import type { Logger } from "@/shared/application/ports/logger";
import type { UnitOfWorkFactory } from "@/shared/application/ports/unit-of-work";
import type { PgJobStore } from "./pg-job-store";
import { Worker } from "./worker";

function makeWorker(leaseSeconds: number, jobTimeoutMs: number): Worker {
  const deps = {
    store: { leaseSeconds } as unknown as PgJobStore,
    queue: {} as JobQueue,
    uow: {} as UnitOfWorkFactory,
    clock: { now: () => new Date() } satisfies Clock,
    logger: {} as Logger,
  };
  return new Worker(deps, {
    workerId: "w",
    concurrency: 1,
    pollIntervalMs: 100,
    jobTimeoutMs,
    handlers: {},
    recurring: [],
  });
}

describe("Worker constructor", () => {
  it("accepts a job timeout at least ten seconds below the lease", () => {
    expect(() => makeWorker(90, 80_000)).not.toThrow();
    expect(() => makeWorker(90, 75_000)).not.toThrow();
  });

  it("rejects a job timeout less than ten seconds below the lease, with a clear message", () => {
    expect(() => makeWorker(60, 60_000)).toThrow(/jobTimeoutMs.*lease/);
    expect(() => makeWorker(90, 80_001)).toThrow(/Invalid worker options/);
  });

  it("rejects a non-positive job timeout", () => {
    expect(() => makeWorker(10, -5_000)).toThrow(/Invalid worker options/);
    expect(() => makeWorker(90, 0)).toThrow(/Invalid worker options/);
  });
});
