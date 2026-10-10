import { Pool } from "pg";

/** One pool per process. See specs/system/database.md. */
export function createPool(databaseUrl: string, opts: { max?: number } = {}): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: opts.max ?? 10,
    application_name: "effluz-forms",
    statement_timeout: 30_000,
  });
}
