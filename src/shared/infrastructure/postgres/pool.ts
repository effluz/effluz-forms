import { Pool, type PoolConfig } from "pg";
import type { Logger } from "@/shared/application/ports/logger";

export interface PoolOptions {
  max?: number;
  /**
   * Per-statement timeout in milliseconds. Defaults to 30 000 when omitted.
   * 0 leaves the server default (pg treats 0 as unset, it does not disable the timeout).
   */
  statementTimeoutMs?: number;
  logger?: Logger;
}

export function poolOptions(databaseUrl: string, opts: PoolOptions = {}): PoolConfig {
  return {
    connectionString: databaseUrl,
    max: opts.max ?? 10,
    application_name: "effluz-forms",
    // Bounds how long a query waits for a connection, so an unreachable host fails fast instead of hanging.
    connectionTimeoutMillis: 5_000,
    statement_timeout: opts.statementTimeoutMs ?? 30_000,
  };
}

/** One pool per process. See specs/system/database.md. */
export function createPool(databaseUrl: string, opts: PoolOptions = {}): Pool {
  const pool = new Pool(poolOptions(databaseUrl, opts));
  // An idle client can be dropped (server restart, terminated backend). Without
  // a listener the process would crash on the unhandled "error" event.
  pool.on("error", (e) => {
    opts.logger?.warn("postgres pool error", { message: e.message });
  });
  return pool;
}
