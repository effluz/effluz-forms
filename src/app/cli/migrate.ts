import { loadConfig } from "@/app/config";
import { createLogger } from "@/shared/infrastructure/logging/logger";
import { loadMigrations, MIGRATION_DIRS, migrate } from "@/shared/infrastructure/postgres/migrate";
import { createPool } from "@/shared/infrastructure/postgres/pool";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const log = createLogger({
    service: config.service,
    level: config.logLevel,
    version: config.appVersion,
  });
  const pool = createPool(config.databaseUrl, { max: 1, statementTimeoutMs: 0, logger: log });
  try {
    const { applied } = await migrate(pool, loadMigrations(MIGRATION_DIRS), log);
    log.info("migrations complete", { applied: applied.length });
  } finally {
    await pool.end();
  }
}

main().then(
  () => {
    process.exit(0);
  },
  (e: unknown) => {
    // Message only: the error text must not carry connection strings or data.
    console.error(`migration failed: ${e instanceof Error ? e.message : "unknown error"}`);
    process.exit(1);
  },
);
