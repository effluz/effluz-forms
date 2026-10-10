import { beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "@/shared/application/ports/clock";
import type { JobHandler, JobHandlerContext } from "@/shared/application/ports/job-queue";
import type { LogFields, Logger } from "@/shared/application/ports/logger";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { createCleanupHandler } from "@/shared/infrastructure/jobs/handlers/cleanup";
import { PgJobQueue } from "@/shared/infrastructure/jobs/pg-job-queue";
import { PgJobStore } from "@/shared/infrastructure/jobs/pg-job-store";
import { Worker, type WorkerOptions } from "@/shared/infrastructure/jobs/worker";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";

const NOW = new Date("2026-10-10T12:00:00Z");

interface LogLine {
  level: string;
  msg: string;
  fields: LogFields;
}

function recordingLogger(lines: LogLine[], base: LogFields = {}): Logger {
  const write = (level: string) => (msg: string, fields?: LogFields) => {
    lines.push({ level, msg, fields: { ...base, ...fields } });
  };
  return {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    child: (fields) => recordingLogger(lines, { ...base, ...fields }),
  };
}

describe("Worker", () => {
  const pool = testPool();
  const clock: Clock = { now: () => NOW };
  const uow = new PgUnitOfWorkFactory(pool);
  const queue = new PgJobQueue(systemIdGenerator, clock);
  const store = new PgJobStore(pool, clock, { leaseSeconds: 60 });
  let lines: LogLine[];

  function makeWorker(handlers: Record<string, JobHandler>, over: Partial<WorkerOptions> = {}) {
    return new Worker(
      { store, queue, uow, clock, logger: recordingLogger(lines) },
      {
        workerId: "test-worker",
        concurrency: 4,
        pollIntervalMs: 10,
        jobTimeoutMs: 5_000,
        handlers,
        recurring: [],
        ...over,
      },
    );
  }

  async function enqueue(
    type: string,
    payload: Record<string, string> = {},
    maxAttempts?: number,
  ): Promise<string> {
    const id = await uow.run((u) =>
      queue.enqueue(u, type, payload, maxAttempts === undefined ? {} : { maxAttempts }),
    );
    if (!id) throw new Error("not enqueued");
    return id;
  }

  async function job(id: string) {
    const r = await pool.query<{ status: string; last_error: string | null; attempts: number }>(
      "select status, last_error, attempts from job where id = $1",
      [id],
    );
    const row = r.rows[0];
    if (!row) throw new Error("job not found");
    return row;
  }

  beforeEach(async () => {
    lines = [];
    await truncateAll(pool);
  });

  it("runs a registered handler with its payload and a job-scoped logger, then marks it succeeded", async () => {
    const id = await enqueue("x.ok", { submissionId: "s1" });
    let seen: { payload: unknown; ctx: JobHandlerContext } | undefined;
    const worker = makeWorker({
      "x.ok": async (payload, ctx) => {
        await Promise.resolve();
        seen = { payload, ctx };
        ctx.logger.info("hello");
      },
    });
    expect(await worker.tick()).toBe(1);
    expect(seen?.payload).toEqual({ submissionId: "s1" });
    expect(seen?.ctx.jobId).toBe(id);
    expect(seen?.ctx.attempt).toBe(1);
    expect(lines.find((l) => l.msg === "hello")?.fields).toMatchObject({ jobId: id });
    expect((await job(id)).status).toBe("succeeded");
  });

  it("fails a throwing handler with its message and never throws out of tick", async () => {
    const id = await enqueue("x.boom");
    const worker = makeWorker({
      "x.boom": async () => {
        await Promise.resolve();
        throw new Error("kaput");
      },
    });
    await expect(worker.tick()).resolves.toBe(1);
    expect(await job(id)).toMatchObject({ status: "failed", last_error: "kaput", attempts: 1 });
  });

  it("fails a handler that throws synchronously", async () => {
    const id = await enqueue("x.sync");
    const worker = makeWorker({
      "x.sync": () => {
        throw new Error("sync kaput");
      },
    });
    await expect(worker.tick()).resolves.toBe(1);
    expect(await job(id)).toMatchObject({ status: "failed", last_error: "sync kaput" });
  });

  it("fails a job of an unknown type with 'no handler for <type>'", async () => {
    const id = await enqueue("x.y");
    await makeWorker({}).tick();
    expect(await job(id)).toMatchObject({ status: "failed", last_error: "no handler for x.y" });
  });

  it("fails a handler that exceeds the job timeout", async () => {
    const id = await enqueue("x.slow");
    const worker = makeWorker(
      { "x.slow": () => new Promise<void>((resolve) => setTimeout(resolve, 2_000).unref()) },
      { jobTimeoutMs: 50 },
    );
    await worker.tick();
    const j = await job(id);
    expect(j.status).toBe("failed");
    expect(j.last_error).toContain("timed out after 50 ms");
  });

  it("marks a job dead after its last attempt and logs it as an error", async () => {
    const id = await enqueue("x.boom", {}, 1);
    await makeWorker({
      "x.boom": async () => {
        await Promise.resolve();
        throw new Error("nope");
      },
    }).tick();
    expect((await job(id)).status).toBe("dead");
    expect(lines.some((l) => l.level === "error" && l.msg === "job failed")).toBe(true);
  });

  it("enqueues a recurring job once per day bucket across ticks", async () => {
    const worker = makeWorker(
      { "jobs.cleanup": async () => Promise.resolve() },
      { recurring: [{ type: "jobs.cleanup", period: "daily" }] },
    );
    await worker.tick();
    await worker.tick();
    const rows = await pool.query<{ unique_key: string | null; status: string }>(
      "select unique_key, status from job where type = 'jobs.cleanup'",
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.unique_key).toBe("jobs.cleanup:2026-10-10");
  });

  it("uses an hourly bucket for hourly recurring jobs", async () => {
    await makeWorker({}, { recurring: [{ type: "x.hourly", period: "hourly" }] }).tick();
    const r = await pool.query<{ unique_key: string }>("select unique_key from job");
    expect(r.rows[0]?.unique_key).toBe("x.hourly:2026-10-10T12");
  });

  it("writes a heartbeat row on every tick", async () => {
    await makeWorker({}).tick();
    const r = await pool.query<{ worker_id: string }>("select worker_id from worker_heartbeat");
    expect(r.rows.map((x) => x.worker_id)).toEqual(["test-worker"]);
  });

  it("stop waits for an in-flight handler to finish before resolving", async () => {
    const id = await enqueue("x.slowish");
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const startedP = new Promise<void>((r) => {
      started = r;
    });
    const worker = makeWorker({
      "x.slowish": () =>
        new Promise<void>((resolve) => {
          started();
          release = resolve;
        }),
    });
    worker.start();
    await startedP;
    let stopped = false;
    const stopP = worker.stop().then(() => {
      stopped = true;
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(stopped).toBe(false);
    release();
    await stopP;
    expect(stopped).toBe(true);
    expect((await job(id)).status).toBe("succeeded");
  });

  it("the cleanup handler prunes succeeded jobs older than 30 days and logs the count", async () => {
    const old = new Date(NOW.getTime() - 31 * 86_400_000);
    const fresh = new Date(NOW.getTime() - 29 * 86_400_000);
    await pool.query(
      `insert into job (id, type, status, finished_at) values
         ($1, 'x.y', 'succeeded', $3), ($2, 'x.y', 'succeeded', $4)`,
      [crypto.randomUUID(), crypto.randomUUID(), old, fresh],
    );
    const cleanupId = await enqueue("jobs.cleanup");
    await makeWorker({ "jobs.cleanup": createCleanupHandler(store) }).tick();
    expect((await job(cleanupId)).status).toBe("succeeded");
    expect((await pool.query("select 1 from job where type = 'x.y'")).rowCount).toBe(1);
    expect(lines.find((l) => l.msg === "pruned succeeded jobs")?.fields).toMatchObject({
      pruned: 1,
    });
  });
});
