import { beforeEach, describe, expect, it } from "vitest";
import { PgAuditLog } from "@/modules/identity/infrastructure/pg-audit-log";
import { PgAuditLogReader } from "@/modules/identity/infrastructure/pg-audit-log-reader";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";

describe("PgAuditLogReader", () => {
  const pool = testPool();
  const uowf = new PgUnitOfWorkFactory(pool);
  const log = new PgAuditLog();
  const reader = new PgAuditLogReader(pool);
  const t1 = new Date("2026-10-10T10:00:00.000Z");
  const t2 = new Date("2026-10-10T11:00:00.000Z");
  const t3 = new Date("2026-10-10T12:00:00.000Z");
  beforeEach(() => truncateAll(pool));

  async function seed(): Promise<void> {
    await uowf.run(async (uow) => {
      await log.record(
        uow,
        {
          action: "form_created",
          actorEmail: "ana@example.com",
          targetId: "form-1",
          ip: "203.0.113.7",
          details: { slug: "camp", copies: 2, draft: true },
        },
        t1,
      );
      await log.record(
        uow,
        { action: "form_published", actorEmail: "ben@example.com", targetId: "form-1", ip: null },
        t2,
      );
      await log.record(
        uow,
        { action: "form_closed", actorEmail: "ana@example.com", targetId: "form-1", ip: null },
        t3,
      );
      await log.record(
        uow,
        { action: "form_created", actorEmail: "cy@example.com", targetId: "form-2", ip: null },
        t3,
      );
    });
  }

  it("lists the entries of one target, newest first, mapped to records", async () => {
    await seed();
    const found = await reader.listByTarget({ targetId: "form-1", limit: 10 });
    expect(found.map((r) => r.action)).toEqual(["form_closed", "form_published", "form_created"]);
    expect(found.every((r) => r.targetId === "form-1")).toBe(true);
    expect(found[2]).toMatchObject({
      actorEmail: "ana@example.com",
      ip: "203.0.113.7",
      details: { slug: "camp", copies: 2, draft: true },
      at: t1,
    });
    expect(found[1]).toMatchObject({ ip: null, details: null });
    expect(found[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("breaks timestamp ties deterministically", async () => {
    await uowf.run(async (uow) => {
      for (const action of ["a", "b", "c"]) {
        await log.record(uow, { action, actorEmail: null, targetId: "form-1", ip: null }, t1);
      }
    });
    const first = await reader.listByTarget({ targetId: "form-1", limit: 10 });
    const second = await reader.listByTarget({ targetId: "form-1", limit: 10 });
    expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id));
    expect(first).toHaveLength(3);
  });

  it("filters by action", async () => {
    await seed();
    const found = await reader.listByTarget({
      targetId: "form-1",
      action: "form_published",
      limit: 10,
    });
    expect(found.map((r) => r.action)).toEqual(["form_published"]);
  });

  it("filters by actor", async () => {
    await seed();
    const found = await reader.listByTarget({
      targetId: "form-1",
      actorEmail: "ben@example.com",
      limit: 10,
    });
    expect(found.map((r) => r.action)).toEqual(["form_published"]);
  });

  it("returns only entries strictly before the given time", async () => {
    await seed();
    const found = await reader.listByTarget({ targetId: "form-1", before: t2, limit: 10 });
    expect(found.map((r) => r.action)).toEqual(["form_created"]);
  });

  it("honours a smaller limit", async () => {
    await seed();
    const found = await reader.listByTarget({ targetId: "form-1", limit: 2 });
    expect(found.map((r) => r.action)).toEqual(["form_closed", "form_published"]);
  });

  it("returns nothing for an unknown target", async () => {
    await seed();
    expect(await reader.listByTarget({ targetId: "form-9", limit: 10 })).toEqual([]);
  });

  it("caps the limit at 200", async () => {
    await pool.query(
      `insert into audit_log (id, action, actor_email, target_id, created_at, updated_at)
       select gen_random_uuid(), 'form_updated', null, 'form-1',
              $1::timestamptz + n * interval '1 second', $1::timestamptz + n * interval '1 second'
         from generate_series(1, 201) as n`,
      [t1],
    );
    const found = await reader.listByTarget({ targetId: "form-1", limit: 500 });
    expect(found).toHaveLength(200);
  });

  it("treats a non-positive limit as an empty page", async () => {
    await seed();
    expect(await reader.listByTarget({ targetId: "form-1", limit: 0 })).toEqual([]);
  });

  it("lists the distinct actors of a target, sorted, without nulls", async () => {
    await seed();
    await uowf.run((uow) =>
      log.record(uow, { action: "x", actorEmail: null, targetId: "form-1", ip: null }, t3),
    );
    expect(await reader.actorsForTarget("form-1")).toEqual(["ana@example.com", "ben@example.com"]);
    expect(await reader.actorsForTarget("form-2")).toEqual(["cy@example.com"]);
    expect(await reader.actorsForTarget("form-9")).toEqual([]);
  });
});
