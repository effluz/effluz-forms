import type { Pool } from "pg";
import { inject } from "vitest";
import { createPool } from "@/shared/infrastructure/postgres/pool";

let pool: Pool | undefined;

/** The shared pool for this test file's worker, pointed at the throwaway database. */
export function testPool(): Pool {
  pool ??= createPool(inject("databaseUrl"), { max: 4 });
  return pool;
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
