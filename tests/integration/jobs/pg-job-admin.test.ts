import { beforeEach, describe, expect, it } from "vitest";
import { PgJobAdmin } from "@/shared/infrastructure/jobs/pg-job-admin";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";

const NOW = new Date("2026-10-18T12:00:00Z");
const at = (hhmm: string): Date => new Date(`2026-10-18T${hhmm}:00Z`);

interface Seed {
  type?: string;
  payload?: Record<string, string | number | boolean | null>;
  status?: string;
  attempts?: number;
  lastError?: string | null;
  uniqueKey?: string | null;
  createdAt?: Date;
  finishedAt?: Date | null;
  locked?: boolean;
}

describe("PgJobAdmin", () => {
  const pool = testPool();
  const uowf = new PgUnitOfWorkFactory(pool);
  const admin = new PgJobAdmin(pool);

  async function seed(opts: Seed = {}): Promise<string> {
    const id = crypto.randomUUID();
    const status = opts.status ?? "dead";
    const finishedAt = opts.finishedAt === undefined && status === "dead" ? at("10:00") : null;
    await pool.query(
      `insert into job (id, type, payload, status, attempts, max_attempts, last_error, unique_key, created_at, finished_at, locked_at, locked_by)
       values ($1, $2, $3, $4, $5, 36, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        opts.type ?? "media.upload",
        JSON.stringify(opts.payload ?? {}),
        status,
        opts.attempts ?? 8,
        opts.lastError ?? null,
        opts.uniqueKey ?? null,
        opts.createdAt ?? at("09:00"),
        opts.finishedAt ?? finishedAt,
        opts.locked ? at("09:30") : null,
        opts.locked ? "worker-1" : null,
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
      unique_key: string | null;
      finished_at: Date | null;
      discard_reason: string | null;
    }>("select * from job where id = $1", [id]);
    const r = res.rows[0];
    if (!r) throw new Error("row not found");
    return r;
  }

  beforeEach(() => truncateAll(pool));

  it("lists dead jobs newest first and ignores other statuses", async () => {
    const a = await seed({ finishedAt: at("10:00") });
    const b = await seed({ finishedAt: at("11:00") });
    await seed({ status: "pending" });
    await seed({ status: "failed" });
    expect((await admin.listDead(10)).map((j) => j.id)).toEqual([b, a]);
    expect((await admin.listDead(1)).map((j) => j.id)).toEqual([b]);
  });

  it("returns the job's fields", async () => {
    const id = await seed({
      type: "email.staff_notification",
      payload: { submissionId: "s" },
      attempts: 8,
      lastError: "boom",
      createdAt: at("08:00"),
      finishedAt: at("10:00"),
    });
    expect(await admin.listDead(5)).toEqual([
      {
        id,
        type: "email.staff_notification",
        payload: { submissionId: "s" },
        attempts: 8,
        lastError: "boom",
        createdAt: at("08:00"),
        finishedAt: at("10:00"),
      },
    ]);
  });

  it("finds a story's dead jobs by submission id or media id", async () => {
    const s = crypto.randomUUID();
    const m1 = crypto.randomUUID();
    const m2 = crypto.randomUUID();
    const mail = await seed({ type: "email.staff_notification", payload: { submissionId: s } });
    const upload = await seed({ type: "media.upload", payload: { mediaId: m1 } });
    await seed({ type: "media.upload", payload: { mediaId: crypto.randomUUID() } });
    const found = await admin.deadFor({ submissionId: s, mediaIds: [m1, m2] });
    expect(found.map((j) => j.id).sort()).toEqual([mail, upload].sort());
    expect(await admin.deadFor({ submissionId: "not-a-uuid", mediaIds: [m1] })).toEqual([]);
  });

  it("counts dead jobs of a type", async () => {
    await seed({ finishedAt: at("09:00") });
    const second = await seed({ finishedAt: at("10:00") });
    const third = await seed({ finishedAt: at("11:00") });
    await seed({ type: "email.staff_notification" });
    const result = await admin.deadOfType("media.upload", 2);
    expect(result.count).toBe(3);
    expect(result.jobs.map((j) => j.id)).toEqual([third, second]);
  });

  it("retry resets a dead job and clears its unique key", async () => {
    const id = await seed({
      attempts: 36,
      uniqueKey: "k",
      locked: true,
      lastError: "gone",
      finishedAt: at("10:00"),
    });
    expect(await uowf.run((uow) => admin.retry(uow, id, NOW))).toBe("media.upload");
    const r = await row(id);
    expect(r).toMatchObject({
      status: "pending",
      attempts: 0,
      locked_at: null,
      locked_by: null,
      finished_at: null,
      unique_key: null,
      last_error: "gone",
    });
    expect(r.run_at).toEqual(NOW);
    expect(await uowf.run((uow) => admin.retry(uow, id, NOW))).toBeNull();
    const pending = await seed({ status: "pending" });
    expect(await uowf.run((uow) => admin.retry(uow, pending, NOW))).toBeNull();
    expect(await uowf.run((uow) => admin.retry(uow, "not-a-uuid", NOW))).toBeNull();
  });

  it("retry commits with the unit of work", async () => {
    const id = await seed();
    await expect(
      uowf.run(async (uow) => {
        await admin.retry(uow, id, NOW);
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");
    expect((await row(id)).status).toBe("dead");
  });

  it("discard records the reason", async () => {
    const id = await seed();
    expect(await uowf.run((uow) => admin.discard(uow, id, "provider gone", NOW))).toBe(
      "media.upload",
    );
    const r = await row(id);
    expect(r.status).toBe("discarded");
    expect(r.discard_reason).toBe("provider gone");
    expect(r.finished_at).toEqual(NOW);
    const pending = await seed({ status: "pending" });
    expect(await uowf.run((uow) => admin.discard(uow, pending, "x", NOW))).toBeNull();
    expect(await uowf.run((uow) => admin.discard(uow, "not-a-uuid", "x", NOW))).toBeNull();
  });

  it("retries all dead jobs of one type and returns their ids", async () => {
    const a = await seed();
    const b = await seed();
    const mail = await seed({ type: "email.staff_notification" });
    const ids = await uowf.run((uow) => admin.retryAllOfType(uow, "media.upload", NOW));
    expect(ids.sort()).toEqual([a, b].sort());
    expect((await row(mail)).status).toBe("dead");
    expect((await row(a)).status).toBe("pending");
  });

  it("reports the heartbeat age", async () => {
    expect(await admin.heartbeatAgeSeconds(NOW)).toBeNull();
    await pool.query(
      "insert into worker_heartbeat (id, worker_id, last_seen_at) values ($1, 'w1', $2)",
      [crypto.randomUUID(), new Date("2026-10-18T11:59:30Z")],
    );
    expect(await admin.heartbeatAgeSeconds(NOW)).toBe(30);
  });
});
