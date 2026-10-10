import os from "node:os";
import { createIdentityCleanupHandler } from "@/modules/identity/infrastructure/jobs/cleanup";
import { systemClock } from "@/shared/infrastructure/clock";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { createCleanupHandler } from "@/shared/infrastructure/jobs/handlers/cleanup";
import { PgJobQueue } from "@/shared/infrastructure/jobs/pg-job-queue";
import { PgJobStore } from "@/shared/infrastructure/jobs/pg-job-store";
import { Worker } from "@/shared/infrastructure/jobs/worker";
import { createLogger } from "@/shared/infrastructure/logging/logger";
import { createPool } from "@/shared/infrastructure/postgres/pool";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { loadConfig } from "./config";

/** Worker composition root. See specs/system/jobs.md and specs/architecture.md. */
function main(): void {
  const config = loadConfig({ ...process.env, SERVICE: "worker" });
  const logger = createLogger({
    service: "worker",
    level: config.logLevel,
    version: config.appVersion,
  });
  const workerId = `${os.hostname()}-${String(process.pid)}`;
  const pool = createPool(config.databaseUrl, {
    max: config.worker.concurrency + 2,
    logger,
  });
  const store = new PgJobStore(pool, systemClock, { leaseSeconds: config.worker.leaseSeconds });
  const worker = new Worker(
    {
      store,
      queue: new PgJobQueue(systemIdGenerator, systemClock),
      uow: new PgUnitOfWorkFactory(pool),
      clock: systemClock,
      logger,
    },
    {
      workerId,
      concurrency: config.worker.concurrency,
      pollIntervalMs: config.worker.pollIntervalMs,
      jobTimeoutMs: (config.worker.leaseSeconds - 15) * 1000,
      handlers: {
        "jobs.cleanup": createCleanupHandler(store),
        "identity.cleanup": createIdentityCleanupHandler(pool),
      },
      recurring: [
        { type: "jobs.cleanup", period: "daily" },
        { type: "identity.cleanup", period: "daily" },
      ],
    },
  );

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info("worker stopping", { signal });
    worker
      .stop()
      .then(() => pool.end())
      .then(
        () => {
          logger.info("worker stopped");
          process.exit(0);
        },
        (e: unknown) => {
          console.error(
            `worker shutdown failed: ${e instanceof Error ? e.message : "unknown error"}`,
          );
          process.exit(1);
        },
      );
  };
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });

  worker.start();
  logger.info("worker started", { workerId });
}

try {
  main();
} catch (e) {
  // Message only: the error text must not carry connection strings or data.
  console.error(`worker failed to start: ${e instanceof Error ? e.message : "unknown error"}`);
  process.exit(1);
}
