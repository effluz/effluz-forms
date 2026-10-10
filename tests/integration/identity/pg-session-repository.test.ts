import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Session } from "@/modules/identity/domain/session";
import { PgSessionRepository } from "@/modules/identity/infrastructure/pg-session-repository";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: randomUUID(),
    email: "staff@example.com",
    name: "Sample Staff",
    csrfToken: "csrf-token-1",
    createdAt: new Date("2026-10-10T12:00:00.000Z"),
    lastSeenAt: new Date("2026-10-10T12:00:00.000Z"),
    ...overrides,
  };
}

describe("PgSessionRepository", () => {
  const pool = testPool();
  const uowf = new PgUnitOfWorkFactory(pool);
  const repo = new PgSessionRepository(pool);
  beforeEach(() => truncateAll(pool));

  it("creates a session in a unit of work and finds it by id", async () => {
    const s = session();
    await uowf.run((uow) => repo.create(uow, s));
    expect(await repo.findById(s.id)).toEqual(s);
  });

  it("returns null for an unknown id", async () => {
    expect(await repo.findById(randomUUID())).toBeNull();
  });

  it("treats an id that is not a UUID as absent instead of failing", async () => {
    const s = session();
    await uowf.run((uow) => repo.create(uow, s));
    expect(await repo.findById("gone")).toBeNull();
    await expect(repo.touch("gone", new Date())).resolves.toBeUndefined();
    await expect(uowf.run((uow) => repo.delete(uow, "gone"))).resolves.toBeUndefined();
    expect(await repo.findById(s.id)).toEqual(s);
  });

  it("does not keep a session created in a rolled back unit of work", async () => {
    const s = session();
    await expect(
      uowf.run(async (uow) => {
        await repo.create(uow, s);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await repo.findById(s.id)).toBeNull();
  });

  it("touch updates last_seen_at", async () => {
    const s = session();
    await uowf.run((uow) => repo.create(uow, s));
    const later = new Date("2026-10-10T13:30:00.000Z");
    await repo.touch(s.id, later);
    expect((await repo.findById(s.id))?.lastSeenAt).toEqual(later);
  });

  it("deletes a session", async () => {
    const s = session();
    await uowf.run((uow) => repo.create(uow, s));
    await uowf.run((uow) => repo.delete(uow, s.id));
    expect(await repo.findById(s.id)).toBeNull();
  });

  it("deleteAllForEmail returns the count removed and leaves other emails", async () => {
    const a1 = session();
    const a2 = session();
    const b = session({ email: "other@example.com" });
    await uowf.run(async (uow) => {
      await repo.create(uow, a1);
      await repo.create(uow, a2);
      await repo.create(uow, b);
    });
    const removed = await uowf.run((uow) => repo.deleteAllForEmail(uow, "staff@example.com"));
    expect(removed).toBe(2);
    expect(await repo.findById(a1.id)).toBeNull();
    expect(await repo.findById(a2.id)).toBeNull();
    expect(await repo.findById(b.id)).toEqual(b);
  });
});
