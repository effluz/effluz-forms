import type { Pool } from "pg";
import { inject } from "vitest";
import { createPool } from "@/shared/infrastructure/postgres/pool";

let pool: Pool | undefined;

/** The shared pool for this test file's worker, pointed at the throwaway database. */
export function testPool(): Pool {
  pool ??= createPool(inject("databaseUrl"), { max: 4 });
  return pool;
}

/**
 * Resolves once `count` sessions of this database wait on a lock; rejects after
 * `timeoutMs`. Lets a test prove a statement blocks without guessing a delay.
 */
export async function waitForLockWaiters(
  target: Pool,
  count = 1,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await target.query<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if ((rows[0]?.n ?? 0) >= count) return;
    if (Date.now() > deadline) throw new Error(`no ${String(count)} lock waiter(s) appeared`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Empties every application table, keeping the migration ledger. */
export async function truncateAll(target: Pool): Promise<void> {
  const { rows } = await target.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migration'",
  );
  if (rows.length === 0) return;
  const names = rows.map((r) => `"${r.tablename}"`).join(", ");
  await target.query(`truncate ${names} restart identity cascade`);
}
