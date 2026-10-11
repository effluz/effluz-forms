import { describe, expect, it } from "vitest";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { InMemoryAuditLog, InMemoryAuditLogReader } from "./fakes";

describe("InMemoryAuditLogReader", () => {
  const uow = {} as UnitOfWork;
  const t1 = new Date("2026-10-10T10:00:00Z");
  const t2 = new Date("2026-10-10T11:00:00Z");

  async function setup() {
    const log = new InMemoryAuditLog();
    const base = { ip: null, targetId: "form-1" };
    await log.record(uow, { ...base, action: "created", actorEmail: "ana@example.com" }, t1);
    await log.record(uow, { ...base, action: "published", actorEmail: "ben@example.com" }, t2);
    await log.record(
      uow,
      { ...base, targetId: "form-2", action: "created", actorEmail: "cy@example.com" },
      t2,
    );
    return new InMemoryAuditLogReader(log);
  }

  it("lists one target newest first with the same filters as the Postgres reader", async () => {
    const reader = await setup();
    const all = await reader.listByTarget({ targetId: "form-1", limit: 10 });
    expect(all.map((r) => r.action)).toEqual(["published", "created"]);
    expect(
      await reader.listByTarget({ targetId: "form-1", action: "created", limit: 10 }),
    ).toHaveLength(1);
    expect(
      await reader.listByTarget({ targetId: "form-1", actorEmail: "ben@example.com", limit: 10 }),
    ).toHaveLength(1);
    const older = await reader.listByTarget({ targetId: "form-1", before: t2, limit: 10 });
    expect(older.map((r) => r.action)).toEqual(["created"]);
    expect(await reader.listByTarget({ targetId: "form-1", limit: 1 })).toHaveLength(1);
  });

  it("pages through entries of one instant with the (createdAt, id) cursor", async () => {
    const log = new InMemoryAuditLog();
    const base = { ip: null, targetId: "form-1", actorEmail: null };
    for (const action of ["a", "b", "c"]) await log.record(uow, { ...base, action }, t1);
    const reader = new InMemoryAuditLogReader(log);

    const first = await reader.listByTarget({ targetId: "form-1", limit: 2 });
    const last = first[first.length - 1];
    if (last === undefined) throw new Error("expected a first page");
    const next = await reader.listByTarget({
      targetId: "form-1",
      before: last.at,
      beforeId: last.id,
      limit: 2,
    });
    const timestampOnly = await reader.listByTarget({
      targetId: "form-1",
      before: last.at,
      limit: 2,
    });

    expect(first.map((r) => r.action)).toEqual(["c", "b"]);
    expect(next.map((r) => r.action)).toEqual(["a"]);
    expect(timestampOnly).toEqual([]);
  });

  it("lists distinct actors sorted", async () => {
    const reader = await setup();
    expect(await reader.actorsForTarget("form-1")).toEqual(["ana@example.com", "ben@example.com"]);
  });
});
