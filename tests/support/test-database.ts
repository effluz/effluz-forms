import { randomBytes } from "node:crypto";
import pg from "pg";
import { loadMigrations, MIGRATION_DIRS, migrate } from "@/shared/infrastructure/postgres/migrate";
import { createPool } from "@/shared/infrastructure/postgres/pool";

const DEFAULT_ADMIN_URL = "postgres://effluz:effluz@127.0.0.1:5432/postgres";

/**
 * A throwaway database on the shared Postgres: created under a random
 * `effluz_test_<hex>` name through `TEST_DATABASE_ADMIN_URL`, migrated, and
 * dropped (after terminating its connections) on failure or by `drop()`.
 * Test tooling, so it talks to `pg` directly. See specs/system/database.md,
 * "Local development".
 */
export async function createTestDatabase(): Promise<{ url: string; drop(): Promise<void> }> {
  const adminUrl = process.env["TEST_DATABASE_ADMIN_URL"] ?? DEFAULT_ADMIN_URL;
  const dbName = `effluz_test_${randomBytes(4).toString("hex")}`;

  const admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    await admin.query(`create database ${dbName}`);
  } catch (e) {
    await admin.end();
    throw e;
  }

  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const databaseUrl = url.toString();

  const drop = async (): Promise<void> => {
    try {
      await admin.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
        [dbName],
      );
      await admin.query(`drop database if exists ${dbName}`);
    } finally {
      await admin.end();
    }
  };

  try {
    const pool = createPool(databaseUrl, { max: 1, statementTimeoutMs: 0 });
    try {
      await migrate(pool, loadMigrations(MIGRATION_DIRS));
    } finally {
      await pool.end();
    }
  } catch (e) {
    await drop();
    throw e;
  }

  return { url: databaseUrl, drop };
}
