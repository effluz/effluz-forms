import { beforeEach, describe, expect, it } from "vitest";
import { PgAuditLog } from "@/modules/identity/infrastructure/pg-audit-log";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";

interface Row {
  action: string;
  actor_email: string | null;
  target_id: string | null;
  ip: string | null;
  details: unknown;
  created_at: Date;
  updated_at: Date;
}

describe("PgAuditLog", () => {
  const pool = testPool();
  const uowf = new PgUnitOfWorkFactory(pool);
  const log = new PgAuditLog();
  const at = new Date("2026-10-10T12:00:00.000Z");
  const bare = { action: "sign_in", actorEmail: null, targetId: null, ip: null } as const;
  beforeEach(() => truncateAll(pool));

  async function rows(): Promise<Row[]> {
    return (await pool.query<Row>("select * from audit_log")).rows;
  }

  it("records action, actor, target, ip, details and the supplied timestamp", async () => {
    await uowf.run((uow) =>
      log.record(
        uow,
        {
          action: "sign_in",
          actorEmail: "staff@example.com",
          targetId: "session-1",
          ip: "203.0.113.7",
          details: { domain: "example.com", attempts: 2, remembered: false },
        },
        at,
      ),
    );
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      action: "sign_in",
      actor_email: "staff@example.com",
      target_id: "session-1",
      ip: "203.0.113.7",
      details: { domain: "example.com", attempts: 2, remembered: false },
    });
    expect(all[0]?.created_at).toEqual(at);
    expect(all[0]?.updated_at).toEqual(at);
  });

  it("stores nulls when the optional parts are absent", async () => {
    await uowf.run((uow) => log.record(uow, { ...bare, action: "sign_out" }, at));
    expect((await rows())[0]).toMatchObject({
      actor_email: null,
      target_id: null,
      ip: null,
      details: null,
    });
  });

  it("is rolled back with the unit of work", async () => {
    await expect(
      uowf.run(async (uow) => {
        await log.record(uow, bare, at);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await rows()).toHaveLength(0);
  });

  it("rejects an update of a row", async () => {
    await uowf.run((uow) => log.record(uow, bare, at));
    await expect(pool.query("update audit_log set action = 'x'")).rejects.toThrow(/append-only/);
  });

  it("rejects a delete of a row", async () => {
    await uowf.run((uow) => log.record(uow, bare, at));
    await expect(pool.query("delete from audit_log")).rejects.toThrow(/append-only/);
  });

  it("rejects details containing an address before issuing any SQL", async () => {
    await expect(
      uowf.run((uow) => log.record(uow, { ...bare, details: { note: "someone@example.com" } }, at)),
    ).rejects.toThrow(/personal data/);
    expect(await rows()).toHaveLength(0);
  });
});
