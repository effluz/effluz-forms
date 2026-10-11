import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { JobHandlerContext } from "@/shared/application/ports/job-queue";
import { handlerContext } from "@/shared/application/testing/fakes";
import { createCleanupHandler } from "@/shared/infrastructure/jobs/handlers/cleanup";
import { PgJobStore } from "@/shared/infrastructure/jobs/pg-job-store";
import { testPool, truncateAll } from "../db";

describe("jobs.cleanup", () => {
  const pool = testPool();
  const NOW = new Date("2026-10-10T12:00:00Z");
  const clock = { now: () => NOW };
  const store = new PgJobStore(pool, clock, { leaseSeconds: 60 });
  beforeEach(() => truncateAll(pool));

  async function succeededJob(finishedAt: Date): Promise<string> {
    const id = randomUUID();
    await pool.query(
      "insert into job (id, type, status, finished_at) values ($1, 'x.y', 'succeeded', $2)",
      [id, finishedAt],
    );
    return id;
  }
  const exists = async (id: string) =>
    (await pool.query("select 1 from job where id = $1", [id])).rowCount === 1;

  it("prunes succeeded jobs before running the steps, in order, with the job's context", async () => {
    const old = await succeededJob(new Date("2026-09-01T00:00:00Z"));
    const seen: string[] = [];
    const ctx = handlerContext({ clock });
    const handler = createCleanupHandler(store, [
      async (c: JobHandlerContext) => {
        seen.push(`a:${c.jobId}:${String(await exists(old))}`);
      },
      () => {
        seen.push("b");
        return Promise.resolve();
      },
    ]);
    await handler({}, ctx);
    expect(seen).toEqual([`a:${ctx.jobId}:false`, "b"]);
  });

  it("runs the remaining steps when one fails, then fails the job", async () => {
    const ran: string[] = [];
    const handler = createCleanupHandler(store, [
      () => Promise.reject(new Error("step failed")),
      () => {
        ran.push("second");
        return Promise.resolve();
      },
    ]);
    await expect(handler({}, handlerContext({ clock }))).rejects.toThrow("step failed");
    expect(ran).toEqual(["second"]);
  });
});
