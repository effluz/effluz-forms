import { beforeEach, describe, expect, it } from "vitest";
import { PgJobQueue } from "@/shared/infrastructure/jobs/pg-job-queue";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";

const fixedIds = (...ids: string[]) => {
  let i = 0;
  return { newId: () => ids[i++] ?? crypto.randomUUID() };
};
const clock = { now: () => new Date("2026-10-10T12:00:00Z") };

describe("PgJobQueue.enqueue", () => {
  const pool = testPool();
  const uowf = new PgUnitOfWorkFactory(pool);
  beforeEach(() => truncateAll(pool));

  it("inserts a pending job with defaults inside the unit of work", async () => {
    const q = new PgJobQueue(fixedIds("11111111-1111-4111-8111-111111111111"), clock);
    const id = await uowf.run((uow) =>
      q.enqueue(uow, "email.staff_notification", { submissionId: "s1" }),
    );
    expect(id).toBe("11111111-1111-4111-8111-111111111111");
    const row = (
      await pool.query<{ run_at: Date }>(
        "select type, status, attempts, max_attempts, payload, run_at from job",
      )
    ).rows[0];
    expect(row).toMatchObject({
      type: "email.staff_notification",
      status: "pending",
      attempts: 0,
      max_attempts: 8,
      payload: { submissionId: "s1" },
    });
    expect(new Date(row?.run_at ?? 0).toISOString()).toBe("2026-10-10T12:00:00.000Z");
  });

  it("is rolled back with the unit of work", async () => {
    const q = new PgJobQueue(fixedIds(), clock);
    await expect(
      uowf.run(async (uow) => {
        await q.enqueue(uow, "x.y", {});
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect((await pool.query<{ n: number }>("select count(*)::int as n from job")).rows[0]?.n).toBe(
      0,
    );
  });

  it("returns null for a duplicate uniqueKey while pending, and allows it again after success", async () => {
    const q = new PgJobQueue(fixedIds(), clock);
    const first = await uowf.run((uow) =>
      q.enqueue(uow, "retention.purge", {}, { uniqueKey: "retention.purge:2026-10-10" }),
    );
    const dup = await uowf.run((uow) =>
      q.enqueue(uow, "retention.purge", {}, { uniqueKey: "retention.purge:2026-10-10" }),
    );
    expect(first).not.toBeNull();
    expect(dup).toBeNull();
    await pool.query("update job set status = 'succeeded'");
    const again = await uowf.run((uow) =>
      q.enqueue(uow, "retention.purge", {}, { uniqueKey: "retention.purge:2026-10-10" }),
    );
    expect(again).not.toBeNull();
  });

  it("honors runAt and maxAttempts", async () => {
    const q = new PgJobQueue(fixedIds(), clock);
    await uowf.run((uow) =>
      q.enqueue(uow, "x.y", {}, { runAt: new Date("2026-10-11T00:00:00Z"), maxAttempts: 3 }),
    );
    const row = (
      await pool.query<{ run_at: Date; max_attempts: number }>(
        "select run_at, max_attempts from job",
      )
    ).rows[0];
    expect(new Date(row?.run_at ?? 0).toISOString()).toBe("2026-10-11T00:00:00.000Z");
    expect(row?.max_attempts).toBe(3);
  });
});
