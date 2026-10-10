import { beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "@/shared/application/ports/clock";
import { PgJobStore } from "@/shared/infrastructure/jobs/pg-job-store";
import { testPool, truncateAll } from "../db";

const NOW = new Date("2026-10-10T12:00:00Z");
const LEASE = 60;

function mutableClock(start: Date = NOW): Clock & { set(d: Date): void } {
  let current = start;
  return {
    now: () => current,
    set: (d) => {
      current = d;
    },
  };
}

interface Seed {
  status?: string;
  runAt?: Date;
  type?: string;
  attempts?: number;
  maxAttempts?: number;
  lockedAt?: Date | null;
  finishedAt?: Date | null;
}

describe("PgJobStore", () => {
  const pool = testPool();
  const clock = mutableClock();
  const store = new PgJobStore(pool, clock, { leaseSeconds: LEASE });

  async function seed(opts: Seed = {}): Promise<string> {
    const id = crypto.randomUUID();
    await pool.query(
      `insert into job (id, type, status, run_at, attempts, max_attempts, locked_at, locked_by, finished_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        opts.type ?? "x.y",
        opts.status ?? "pending",
        opts.runAt ?? NOW,
        opts.attempts ?? 0,
        opts.maxAttempts ?? 8,
        opts.lockedAt ?? null,
        opts.lockedAt ? "other-worker" : null,
        opts.finishedAt ?? null,
      ],
    );
    return id;
  }

  async function row(id: string) {
    const res = await pool.query<{
      status: string;
      attempts: number;
      run_at: Date;
      locked_at: Date | null;
      locked_by: string | null;
      last_error: string | null;
      finished_at: Date | null;
      updated_at: Date;
    }>("select * from job where id = $1", [id]);
    const r = res.rows[0];
    if (!r) throw new Error("row not found");
    return r;
  }

  beforeEach(async () => {
    clock.set(NOW);
    await truncateAll(pool);
  });

  describe("claim", () => {
    it("returns due pending jobs ordered by run_at and marks them running", async () => {
      const late = await seed({ runAt: new Date("2026-10-10T11:59:00Z") });
      const early = await seed({ runAt: new Date("2026-10-10T11:00:00Z") });
      const mid = await seed({ runAt: new Date("2026-10-10T11:30:00Z") });
      const claimed = await store.claim("w1", 10);
      expect(claimed.map((j) => j.id)).toEqual([early, mid, late]);
      expect(claimed[0]).toMatchObject({
        type: "x.y",
        payload: {},
        attempts: 1,
        maxAttempts: 8,
      });
      const r = await row(early);
      expect(r.status).toBe("running");
      expect(r.attempts).toBe(1);
      expect(r.locked_by).toBe("w1");
      expect(r.locked_at?.toISOString()).toBe(NOW.toISOString());
    });

    it("does not return jobs whose run_at is in the future, and honors the limit", async () => {
      await seed({ runAt: new Date("2026-10-10T12:00:01Z") });
      const a = await seed({ runAt: new Date("2026-10-10T10:00:00Z") });
      await seed({ runAt: new Date("2026-10-10T11:00:00Z") });
      expect((await store.claim("w1", 1)).map((j) => j.id)).toEqual([a]);
      expect(await store.claim("w1", 10)).toHaveLength(1);
      expect(await store.claim("w1", 10)).toHaveLength(0);
    });

    it("also picks up failed jobs that are due", async () => {
      const id = await seed({
        status: "failed",
        attempts: 1,
        runAt: new Date("2026-10-10T11:00:00Z"),
      });
      const claimed = await store.claim("w1", 5);
      expect(claimed.map((j) => j.id)).toEqual([id]);
      expect(claimed[0]?.attempts).toBe(2);
    });

    it("two stores claiming concurrently get disjoint sets covering every job", async () => {
      const ids = new Set<string>();
      for (let i = 0; i < 10; i++)
        ids.add(await seed({ runAt: new Date(NOW.getTime() - i * 1000) }));
      const other = new PgJobStore(pool, clock, { leaseSeconds: LEASE });
      const [a, b] = await Promise.all([store.claim("w1", 5), other.claim("w2", 5)]);
      const aIds = a.map((j) => j.id);
      const bIds = b.map((j) => j.id);
      expect(aIds).toHaveLength(5);
      expect(bIds).toHaveLength(5);
      expect(aIds.filter((id) => bIds.includes(id))).toEqual([]);
      expect(new Set([...aIds, ...bIds])).toEqual(ids);
    });

    it("reclaims a running job whose lease expired, but not one inside the lease", async () => {
      const expired = await seed({
        status: "running",
        attempts: 1,
        lockedAt: new Date(NOW.getTime() - (LEASE + 1) * 1000),
      });
      await seed({
        status: "running",
        attempts: 1,
        lockedAt: new Date(NOW.getTime() - (LEASE - 1) * 1000),
      });
      const claimed = await store.claim("w1", 10);
      expect(claimed.map((j) => j.id)).toEqual([expired]);
      expect(claimed[0]?.attempts).toBe(2);
      expect((await row(expired)).locked_by).toBe("w1");
    });
  });

  describe("succeed", () => {
    it("marks the job succeeded, sets finished_at and clears the lock", async () => {
      const id = await seed();
      await store.claim("w1", 1);
      clock.set(new Date("2026-10-10T12:00:05Z"));
      await store.succeed(id);
      const r = await row(id);
      expect(r.status).toBe("succeeded");
      expect(r.finished_at?.toISOString()).toBe("2026-10-10T12:00:05.000Z");
      expect(r.locked_at).toBeNull();
      expect(r.locked_by).toBeNull();
    });
  });

  describe("fail", () => {
    it("below max attempts schedules a retry in the future and truncates the error", async () => {
      const id = await seed();
      await store.claim("w1", 1);
      const outcome = await store.fail(id, "x".repeat(900), 1, 8);
      expect(outcome).toBe("retry");
      const r = await row(id);
      expect(r.status).toBe("failed");
      expect(r.last_error).toHaveLength(500);
      expect(r.run_at.getTime()).toBeGreaterThan(NOW.getTime());
      expect(r.locked_at).toBeNull();
      expect(r.locked_by).toBeNull();
      expect(r.finished_at).toBeNull();
    });

    it("at max attempts marks the job dead with finished_at", async () => {
      const id = await seed({ maxAttempts: 2 });
      await store.claim("w1", 1);
      const outcome = await store.fail(id, "boom", 2, 2);
      expect(outcome).toBe("dead");
      const r = await row(id);
      expect(r.status).toBe("dead");
      expect(r.finished_at?.toISOString()).toBe(NOW.toISOString());
      expect(r.last_error).toBe("boom");
    });

    it("redacts email-like tokens from the stored error", async () => {
      const id = await seed();
      await store.claim("w1", 1);
      await store.fail(id, "send to jane.doe@example.com failed", 1, 8);
      expect((await row(id)).last_error).toBe("send to [redacted] failed");
    });
  });

  describe("heartbeat", () => {
    it("upserts one row per worker and reports the age against the clock", async () => {
      expect(await store.heartbeatAgeSeconds()).toBeNull();
      await store.heartbeat("w1");
      await store.heartbeat("w1");
      expect(
        (await pool.query<{ n: number }>("select count(*)::int as n from worker_heartbeat")).rows[0]
          ?.n,
      ).toBe(1);
      clock.set(new Date(NOW.getTime() + 42_000));
      expect(await store.heartbeatAgeSeconds()).toBe(42);
      await store.heartbeat("w2");
      expect(await store.heartbeatAgeSeconds()).toBe(0);
    });
  });

  describe("counts", () => {
    it("reports pending, running, dead and the oldest pending age", async () => {
      expect(await store.counts()).toEqual({
        pending: 0,
        running: 0,
        dead: 0,
        oldestPendingAgeSeconds: null,
      });
      await seed({ runAt: new Date(NOW.getTime() - 90_000) });
      await seed({ runAt: new Date(NOW.getTime() - 10_000) });
      await seed({ runAt: new Date(NOW.getTime() + 60_000) });
      await seed({ status: "running", lockedAt: NOW });
      await seed({ status: "dead" });
      await seed({ status: "succeeded" });
      expect(await store.counts()).toEqual({
        pending: 3,
        running: 1,
        dead: 1,
        oldestPendingAgeSeconds: 90,
      });
    });
  });

  describe("pruneSucceeded", () => {
    it("removes only succeeded jobs finished before the cutoff", async () => {
      const cutoff = new Date("2026-09-10T12:00:00Z");
      await seed({ status: "succeeded", finishedAt: new Date("2026-09-01T00:00:00Z") });
      const recent = await seed({
        status: "succeeded",
        finishedAt: new Date("2026-10-01T00:00:00Z"),
      });
      const oldDead = await seed({ status: "dead", finishedAt: new Date("2026-09-01T00:00:00Z") });
      const oldPending = await seed({ status: "pending", runAt: new Date("2026-09-01T00:00:00Z") });
      expect(await store.pruneSucceeded(cutoff)).toBe(1);
      const left = (await pool.query<{ id: string }>("select id from job")).rows.map((r) => r.id);
      expect(new Set(left)).toEqual(new Set([recent, oldDead, oldPending]));
    });
  });
});
