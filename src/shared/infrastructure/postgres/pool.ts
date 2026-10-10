import { Pool, type PoolConfig } from "pg";
import type { Logger } from "@/shared/application/ports/logger";

export interface PoolOptions {
  max?: number;
  /** Per-statement timeout in milliseconds. Default 30 000; 0 disables it. */
  statementTimeoutMs?: number;
  logger?: Logger;
}

export function poolOptions(databaseUrl: string, opts: PoolOptions = {}): PoolConfig {
  return {
    connectionString: databaseUrl,
    max: opts.max ?? 10,
    application_name: "effluz-forms",
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
