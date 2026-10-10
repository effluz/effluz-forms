import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { SignInAttempt } from "@/modules/identity/application/ports/sign-in-attempt-store";
import { PgSignInAttemptStore } from "@/modules/identity/infrastructure/pg-sign-in-attempt-store";
import { testPool, truncateAll } from "../db";

function attempt(overrides: Partial<SignInAttempt> = {}): SignInAttempt {
  return {
    id: randomUUID(),
    state: "state-1",
    nonce: "nonce-1",
    codeVerifier: "verifier-1",
    returnTo: "/admin/forms",
    createdAt: new Date("2026-10-10T12:00:00.000Z"),
    ...overrides,
  };
}

describe("PgSignInAttemptStore", () => {
  const pool = testPool();
  const store = new PgSignInAttemptStore(pool);
  beforeEach(() => truncateAll(pool));

  async function count(): Promise<number> {
    const { rows } = await pool.query<{ n: number }>(
      "select count(*)::int as n from sign_in_attempt",
    );
    return rows[0]?.n ?? -1;
  }

  it("consumes an attempt once and then returns null", async () => {
    const a = attempt();
    await store.create(a);
    expect(await store.consume(a.id, new Date("2026-10-10T12:05:00.000Z"))).toEqual(a);
    expect(await store.consume(a.id, new Date("2026-10-10T12:05:01.000Z"))).toBeNull();
    expect(await count()).toBe(0);
  });

  it("returns null for an unknown id", async () => {
    expect(await store.consume(randomUUID(), new Date())).toBeNull();
  });

  it("returns null for an id that is not a UUID instead of failing", async () => {
    await store.create(attempt());
    expect(await store.consume("gone", new Date("2026-10-10T12:05:00.000Z"))).toBeNull();
    expect(await count()).toBe(1);
  });

  it("returns null for an attempt older than 10 minutes and deletes it", async () => {
    const a = attempt();
    await store.create(a);
    expect(await store.consume(a.id, new Date("2026-10-10T12:10:01.000Z"))).toBeNull();
    expect(await count()).toBe(0);
  });

  it("sets expiry to ten minutes after the supplied creation time", async () => {
    const a = attempt();
    await store.create(a);
    const { rows } = await pool.query<{ expires_at: Date }>(
      "select expires_at from sign_in_attempt where id = $1",
      [a.id],
    );
    expect(rows[0]?.expires_at).toEqual(new Date("2026-10-10T12:10:00.000Z"));
  });
});
