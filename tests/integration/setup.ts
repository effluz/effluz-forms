import { randomBytes } from "node:crypto";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { loadMigrations, MIGRATION_DIRS, migrate } from "@/shared/infrastructure/postgres/migrate";
import { createPool } from "@/shared/infrastructure/postgres/pool";

const DEFAULT_ADMIN_URL = "postgres://effluz:effluz@127.0.0.1:5432/postgres";

/**
 * Creates a throwaway database, migrates it, hands its URL to the tests and
 * drops it afterwards. Test tooling, so it talks to `pg` directly.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const adminUrl = process.env["TEST_DATABASE_ADMIN_URL"] ?? DEFAULT_ADMIN_URL;
  const dbName = `effluz_test_${randomBytes(4).toString("hex")}`;

  const admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
  await admin.query(`create database ${dbName}`);

  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const databaseUrl = url.toString();

  try {
    const pool = createPool(databaseUrl, { max: 1, statementTimeoutMs: 0 });
    try {
      await migrate(pool, loadMigrations(MIGRATION_DIRS));
    } finally {
      await pool.end();
    }
  } catch (e) {
    await admin.query(`drop database if exists ${dbName}`);
    await admin.end();
    throw e;
  }

  project.provide("databaseUrl", databaseUrl);

  return async () => {
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
}
