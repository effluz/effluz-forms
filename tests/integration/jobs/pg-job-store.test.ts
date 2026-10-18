import { beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "@/shared/application/ports/clock";
import { PgJobStore, type ClaimedJob } from "@/shared/infrastructure/jobs/pg-job-store";
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
      const [job] = await store.claim("w1", 1);
      clock.set(new Date("2026-10-10T12:00:05Z"));
      expect(await store.succeed(job as ClaimedJob, "w1")).toBe("succeeded");
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
      const [job] = await store.claim("w1", 1);
      const outcome = await store.fail(job as ClaimedJob, "w1", "x".repeat(900));
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
      const id = await seed({ maxAttempts: 2, attempts: 1 });
      const [job] = await store.claim("w1", 1);
      const outcome = await store.fail(job as ClaimedJob, "w1", "boom");
      expect(outcome).toBe("dead");
      const r = await row(id);
      expect(r.status).toBe("dead");
      expect(r.finished_at?.toISOString()).toBe(NOW.toISOString());
      expect(r.last_error).toBe("boom");
    });

    it("redacts email-like tokens from the stored error", async () => {
      const id = await seed();
      const [job] = await store.claim("w1", 1);
      await store.fail(job as ClaimedJob, "w1", "send to jane.doe@example.com failed");
      expect((await row(id)).last_error).toBe("send to [redacted] failed");
    });
  });

  describe("markDead", () => {
    it("marks a claimed job dead with the given error", async () => {
      const id = await seed();
      const [job] = await store.claim("w1", 1);
      expect(await store.markDead(job as ClaimedJob, "w1", "gave up")).toBe("dead");
      const r = await row(id);
      expect(r.status).toBe("dead");
      expect(r.last_error).toBe("gave up");
      expect(r.finished_at?.toISOString()).toBe(NOW.toISOString());
      expect(r.locked_by).toBeNull();
    });
  });

  describe("fencing", () => {
    it("a worker whose lease expired cannot fail, kill or succeed the job another worker reclaimed", async () => {
      const id = await seed();
      const [first] = await store.claim("w1", 1);
      clock.set(new Date(NOW.getTime() + (LEASE + 1) * 1000));
      const [second] = await store.claim("w2", 1);
      expect(second?.id).toBe(id);
      expect(second?.attempts).toBe(2);

      expect(await store.fail(first as ClaimedJob, "w1", "late")).toBe("lost");
      expect(await store.markDead(first as ClaimedJob, "w1", "late")).toBe("lost");
      expect(await store.succeed(first as ClaimedJob, "w1")).toBe("lost");
      const mid = await row(id);
      expect(mid.status).toBe("running");
      expect(mid.locked_by).toBe("w2");
      expect(mid.attempts).toBe(2);
      expect(mid.last_error).toBeNull();

      expect(await store.succeed(second as ClaimedJob, "w2")).toBe("succeeded");
      expect((await row(id)).status).toBe("succeeded");
    });

    it("an outcome for the right worker but a stale attempt count is lost", async () => {
      const id = await seed();
      const [first] = await store.claim("w1", 1);
      clock.set(new Date(NOW.getTime() + (LEASE + 1) * 1000));
      await store.claim("w1", 1);
      expect(await store.succeed(first as ClaimedJob, "w1")).toBe("lost");
      expect((await row(id)).attempts).toBe(2);
    });
  });

  describe("dead alerts", () => {
    const ALERT = "email.job_alert";
    const alertStore = new PgJobStore(pool, clock, {
      leaseSeconds: LEASE,
      deadAlert: { type: ALERT, maxAttempts: 36 },
    });

    async function alerts() {
      const res = await pool.query<{
        status: string;
        payload: unknown;
        max_attempts: number;
        run_at: Date;
        unique_key: string | null;
      }>(
        `select status, payload, max_attempts, run_at, unique_key from job
          where type = $1 order by run_at, unique_key`,
        [ALERT],
      );
      return res.rows;
    }

    /** Claims every due job at once, so later deaths cannot pick up an alert row. */
    async function claimAll(): Promise<ClaimedJob[]> {
      return alertStore.claim("w1", 10);
    }

    function only(jobs: ClaimedJob[]): ClaimedJob {
      const [job] = jobs;
      if (!job || jobs.length !== 1) throw new Error("expected one claimed job");
      return job;
    }

    it("enqueues one alert when a job goes dead", async () => {
      await seed({ type: "media.upload", attempts: 35, maxAttempts: 36 });
      const job = only(await claimAll());
      expect(await alertStore.fail(job, "w1", "boom")).toBe("dead");
      expect(await alerts()).toEqual([
        {
          status: "pending",
          payload: { jobType: "media.upload" },
          max_attempts: 36,
          run_at: NOW,
          unique_key: "email.job_alert:media.upload:2026-10-10T12",
        },
      ]);
    });

    it("markDead raises the alert too", async () => {
      await seed({ type: "media.upload" });
      const job = only(await claimAll());
      expect(await alertStore.markDead(job, "w1", "gave up")).toBe("dead");
      expect(await alerts()).toEqual([
        {
          status: "pending",
          payload: { jobType: "media.upload" },
          max_attempts: 36,
          run_at: NOW,
          unique_key: "email.job_alert:media.upload:2026-10-10T12",
        },
      ]);
    });

    it("coalesces deaths of one type within the hour and schedules the next hour once", async () => {
      for (let i = 0; i < 3; i++) await seed({ type: "media.upload", maxAttempts: 1 });
      const [a, b, c] = await claimAll();
      if (!a || !b || !c) throw new Error("expected three claimed jobs");
      expect(await alertStore.fail(a, "w1", "boom")).toBe("dead");
      await pool.query("update job set status = 'succeeded', finished_at = $2 where type = $1", [
        ALERT,
        NOW,
      ]);
      clock.set(new Date("2026-10-10T12:10:00Z"));
      expect(await alertStore.fail(b, "w1", "boom")).toBe("dead");
      clock.set(new Date("2026-10-10T12:20:00Z"));
      expect(await alertStore.fail(c, "w1", "boom")).toBe("dead");
      const rows = await alerts();
      expect(rows.map((r) => ({ status: r.status, key: r.unique_key, runAt: r.run_at }))).toEqual([
        {
          status: "succeeded",
          key: "email.job_alert:media.upload:2026-10-10T12",
          runAt: NOW,
        },
        {
          status: "pending",
          key: "email.job_alert:media.upload:2026-10-10T13",
          runAt: new Date("2026-10-10T13:00:00Z"),
        },
      ]);
    });

    it("a death while the hour's alert is still waiting adds nothing", async () => {
      await seed({ type: "media.upload", maxAttempts: 1 });
      await seed({ type: "media.upload", maxAttempts: 1 });
      const [a, b] = await claimAll();
      if (!a || !b) throw new Error("expected two claimed jobs");
      expect(await alertStore.fail(a, "w1", "boom")).toBe("dead");
      clock.set(new Date("2026-10-10T12:05:00Z"));
      expect(await alertStore.fail(b, "w1", "boom")).toBe("dead");
      const rows = await alerts();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("pending");
    });

    it("a death while the hour's alert awaits a retry adds nothing", async () => {
      await seed({ type: "media.upload", maxAttempts: 1 });
      await seed({ type: "media.upload", maxAttempts: 1 });
      const [a, b] = await claimAll();
      if (!a || !b) throw new Error("expected two claimed jobs");
      expect(await alertStore.fail(a, "w1", "boom")).toBe("dead");
      await pool.query("update job set status = 'failed', attempts = 1 where type = $1", [ALERT]);
      clock.set(new Date("2026-10-10T12:05:00Z"));
      expect(await alertStore.fail(b, "w1", "boom")).toBe("dead");
      expect((await alerts()).map((r) => r.status)).toEqual(["failed"]);
    });

    it("keeps types apart", async () => {
      await seed({ type: "media.upload", maxAttempts: 1 });
      await seed({ type: "email.staff_notification", maxAttempts: 1 });
      const claimed = await claimAll();
      expect(claimed).toHaveLength(2);
      for (const job of claimed) expect(await alertStore.fail(job, "w1", "boom")).toBe("dead");
      expect((await alerts()).map((r) => r.unique_key)).toEqual([
        "email.job_alert:email.staff_notification:2026-10-10T12",
        "email.job_alert:media.upload:2026-10-10T12",
      ]);
    });

    it("an alert job going dead raises no alert", async () => {
      const id = await seed({ type: ALERT, attempts: 35, maxAttempts: 36 });
      const job = only(await claimAll());
      expect(await alertStore.fail(job, "w1", "smtp down")).toBe("dead");
      expect((await row(id)).status).toBe("dead");
      expect(await alerts()).toHaveLength(1);
    });

    it("a lost outcome raises nothing", async () => {
      await seed({ type: "media.upload", maxAttempts: 1 });
      const first = only(await claimAll());
      clock.set(new Date(NOW.getTime() + (LEASE + 1) * 1000));
      expect(await alertStore.claim("w2", 1)).toHaveLength(1);
      expect(await alertStore.fail(first, "w1", "late")).toBe("lost");
      expect(await alerts()).toEqual([]);
    });

    it("without deadAlert no alert is written", async () => {
      await seed({ type: "media.upload", maxAttempts: 1 });
      const [job] = await store.claim("w1", 1);
      expect(await store.fail(job as ClaimedJob, "w1", "boom")).toBe("dead");
      expect(await alerts()).toEqual([]);
    });

    it("rolls back the dead write when the alert insert fails", async () => {
      const broken = new PgJobStore(pool, clock, {
        leaseSeconds: LEASE,
        deadAlert: { type: ALERT, maxAttempts: Number.NaN },
      });
      const id = await seed({ type: "media.upload", maxAttempts: 1 });
      const [job] = await broken.claim("w1", 1);
      await expect(broken.fail(job as ClaimedJob, "w1", "boom")).rejects.toThrow();
      expect((await row(id)).status).toBe("running");
      expect(await alerts()).toEqual([]);
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
