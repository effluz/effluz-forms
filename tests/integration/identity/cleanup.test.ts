import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobHandlerContext } from "@/shared/application/ports/job-queue";
import type { Logger } from "@/shared/application/ports/logger";
import { createIdentityCleanupHandler } from "@/modules/identity/infrastructure/jobs/cleanup";
import { PgJobQueue } from "@/shared/infrastructure/jobs/pg-job-queue";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { testPool, truncateAll } from "../db";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-10T12:00:00Z");

function fakeLogger(): { logger: Logger; info: ReturnType<typeof vi.fn> } {
  const info = vi.fn();
  const logger: Logger = {
    debug: vi.fn(),
    info,
    warn: vi.fn(),
    error: vi.fn(),
    child: (): Logger => logger,
  };
  return { logger, info };
}

describe("identity.cleanup", () => {
  const pool = testPool();

  async function insertAttempt(expiresAt: Date): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `insert into sign_in_attempt (id, state, nonce, code_verifier, return_to, created_at, updated_at, expires_at)
       values ($1, 's', 'n', 'v', '/admin', $2, $2, $3)`,
      [id, new Date(expiresAt.getTime() - 10 * 60 * 1000), expiresAt],
    );
    return id;
  }

  async function insertSession(createdAt: Date, lastSeenAt: Date): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `insert into admin_session (id, email, name, csrf_token, created_at, updated_at, last_seen_at)
       values ($1, 'someone@example.com', 'Someone', 'c', $2, $2, $3)`,
      [id, createdAt, lastSeenAt],
    );
    return id;
  }

  async function ids(table: "sign_in_attempt" | "admin_session"): Promise<string[]> {
    const { rows } = await pool.query<{ id: string }>(`select id from ${table} order by id`);
    return rows.map((r) => r.id).sort();
  }

  function context(logger: Logger): JobHandlerContext {
    return {
      jobId: randomUUID(),
      attempt: 1,
      maxAttempts: 8,
      logger,
      uow: new PgUnitOfWorkFactory(pool),
      queue: new PgJobQueue(systemIdGenerator, { now: () => NOW }),
      clock: { now: () => NOW },
    };
  }

  beforeEach(async () => {
    await truncateAll(pool);
  });

  it("deletes expired attempts and sessions, keeps live ones, and logs counts only", async () => {
    await insertAttempt(new Date(NOW.getTime() - 1000));
    await insertAttempt(NOW); // expires exactly now: no longer live
    const liveAttempt = await insertAttempt(new Date(NOW.getTime() + 60 * 1000));

    await insertSession(new Date(NOW.getTime() - DAY), new Date(NOW.getTime() - 9 * HOUR)); // idle
    await insertSession(new Date(NOW.getTime() - 8 * DAY), new Date(NOW.getTime() - HOUR)); // absolute
    const onLimit = await insertSession(
      new Date(NOW.getTime() - 7 * DAY),
      new Date(NOW.getTime() - 8 * HOUR),
    ); // exactly on both limits: still valid
    const active = await insertSession(new Date(NOW.getTime() - HOUR), NOW);

    const { logger, info } = fakeLogger();
    await createIdentityCleanupHandler(pool)({}, context(logger));

    expect(await ids("sign_in_attempt")).toEqual([liveAttempt]);
    expect(await ids("admin_session")).toEqual([onLimit, active].sort());
    expect(info).toHaveBeenCalledWith("purged expired identity rows", {
      attempts: 2,
      sessions: 2,
    });
    const { rows } = await pool.query<{ n: number }>("select count(*)::int as n from audit_log");
    expect(rows[0]?.n).toBe(0);
  });

  it("is a no-op on an empty database", async () => {
    const { logger, info } = fakeLogger();
    await createIdentityCleanupHandler(pool)({}, context(logger));
    expect(info).toHaveBeenCalledWith("purged expired identity rows", {
      attempts: 0,
      sessions: 0,
    });
  });
});
