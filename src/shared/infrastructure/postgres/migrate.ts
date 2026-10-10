import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import type { Logger } from "@/shared/application/ports/logger";

export interface MigrationFile {
  id: string;
  name: string;
  sql: string;
}

const FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const LOCK_KEY = 727001;

/**
 * Shared migrations first, then each module's `infrastructure/migrations`
 * folder that exists. See specs/system/database.md, "Migrations".
 */
export const MIGRATION_DIRS: readonly string[] = (() => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const shared = path.join(root, "shared/infrastructure/postgres/migrations");
  const modules = path.join(root, "modules");
  const moduleDirs = existsSync(modules)
    ? readdirSync(modules)
        .map((m) => path.join(modules, m, "infrastructure/migrations"))
        .filter((d) => existsSync(d))
    : [];
  return [shared, ...moduleDirs];
})();

export function loadMigrations(dirs: readonly string[]): MigrationFile[] {
  const files: MigrationFile[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".sql")) continue;
      const m = FILE.exec(entry);
      if (!m) throw new Error(`malformed migration file name: ${entry}`);
      files.push({
        id: m[1] as string,
        name: m[2] as string,
        sql: readFileSync(path.join(dir, entry), "utf8"),
      });
    }
  }
  files.sort((a, b) => a.id.localeCompare(b.id));
  for (let i = 1; i < files.length; i++) {
    if (files[i]?.id === files[i - 1]?.id) {
      throw new Error(`duplicate migration id ${String(files[i]?.id)}`);
    }
  }
  return files;
}

/**
 * Applies each unapplied migration in its own transaction, under a session
 * advisory lock so concurrent deploys cannot interleave.
 */
export async function migrate(
  pool: Pool,
  migrations: MigrationFile[],
  log?: Logger,
): Promise<{ applied: string[] }> {
  const client = await pool.connect();
  const applied: string[] = [];
  let failure: Error | undefined;
  try {
    // The pool's (or the database's) statement timeout must not cap migrations or
    // the wait for the advisory lock. pg treats a 0 option as unset, so say it here.
    await client.query("set statement_timeout = 0");
    // Lock first: two first-time runners must not race on creating the ledger.
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(`create table if not exists schema_migration (
      id text primary key, name text not null, applied_at timestamptz not null default now())`);
    const done = new Set(
      (await client.query<{ id: string }>("select id from schema_migration")).rows.map((r) => r.id),
    );
    for (const m of migrations) {
      if (done.has(m.id)) continue;
      await client.query("begin");
      try {
        await client.query(m.sql);
        await client.query("insert into schema_migration (id, name) values ($1, $2)", [
          m.id,
          m.name,
        ]);
        await client.query("commit");
        applied.push(m.id);
        log?.info("migration applied", { migration: `${m.id}_${m.name}` });
      } catch (e) {
        // A dead connection must not mask the original error.
        await client.query("rollback").catch(() => undefined);
        throw e;
      }
    }
  } catch (e) {
    failure = e instanceof Error ? e : new Error(String(e));
    throw e;
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    // Always destroy this client (truthy arg): its session has no statement timeout and must not be reused.
    client.release(failure ?? true);
  }
  return { applied };
}
