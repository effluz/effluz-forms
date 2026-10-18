import os from "node:os";
import { EMAIL_JOB_MAX_ATTEMPTS, EMAIL_JOB_TYPES } from "@/modules/notifications/application";
import { ReviewAlertSource } from "@/modules/review/application";
import { PgAuditLog } from "@/modules/identity/infrastructure/pg-audit-log";
import { PgAuditLogReader } from "@/modules/identity/infrastructure/pg-audit-log-reader";
import { systemClock } from "@/shared/infrastructure/clock";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { PgJobQueue } from "@/shared/infrastructure/jobs/pg-job-queue";
import { PgJobStore } from "@/shared/infrastructure/jobs/pg-job-store";
import { Worker } from "@/shared/infrastructure/jobs/worker";
import { createLogger } from "@/shared/infrastructure/logging/logger";
import { createPool } from "@/shared/infrastructure/postgres/pool";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { loadConfig } from "./config";
import {
  buildDefinitions,
  buildMedia,
  buildNotifications,
  buildReview,
  buildSubmissions,
} from "./modules";
import { RECURRING, workerHandlers } from "./worker-handlers";

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
  // A job going dead enqueues its grouped alert in the same transaction (decisions/0029).
  const store = new PgJobStore(pool, systemClock, {
    leaseSeconds: config.worker.leaseSeconds,
    deadAlert: { type: EMAIL_JOB_TYPES.jobAlert, maxAttempts: EMAIL_JOB_MAX_ATTEMPTS },
  });
  const uow = new PgUnitOfWorkFactory(pool);
  const queue = new PgJobQueue(systemIdGenerator, systemClock);
  const audit = new PgAuditLog();
  const auditReader = new PgAuditLogReader(pool);
  const definitions = buildDefinitions(config, pool, uow, audit, auditReader);
  const media = buildMedia(config, pool, uow, queue);
  const submissions = buildSubmissions({ pool, uow, queue, definitions, media, logger });
  const review = buildReview({ pool, uow, definitions, submissions, media, audit, auditReader });
  const notifications = buildNotifications(
    config,
    pool,
    submissions,
    new ReviewAlertSource(review, { to: config.alertEmail, publicBaseUrl: config.publicBaseUrl }),
  );
  const worker = new Worker(
    { store, queue, uow, clock: systemClock, logger },
    {
      workerId,
      concurrency: config.worker.concurrency,
      pollIntervalMs: config.worker.pollIntervalMs,
      jobTimeoutMs: (config.worker.leaseSeconds - 15) * 1000,
      handlers: workerHandlers({ store, pool, media, notifications, submissions }),
      recurring: RECURRING,
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
