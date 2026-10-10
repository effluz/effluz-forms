import type { Pool } from "pg";
import type { JobQueue } from "@/shared/application/ports/job-queue";
import type { Logger } from "@/shared/application/ports/logger";
import type { UnitOfWorkFactory } from "@/shared/application/ports/unit-of-work";
import { systemClock } from "@/shared/infrastructure/clock";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { PgJobQueue } from "@/shared/infrastructure/jobs/pg-job-queue";
import { PgJobStore } from "@/shared/infrastructure/jobs/pg-job-store";
import { createLogger } from "@/shared/infrastructure/logging/logger";
import { createPool } from "@/shared/infrastructure/postgres/pool";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { loadConfig, type AppConfig } from "./config";

export interface Container {
  config: AppConfig;
  logger: Logger;
  pool: Pool;
  uow: UnitOfWorkFactory;
  queue: JobQueue;
  jobStore: PgJobStore;
}

/**
 * Web composition root: wires adapters to ports. Overrides replace any part,
 * which is how tests supply fakes. See specs/architecture.md.
 */
export function buildContainer(config: AppConfig, overrides: Partial<Container> = {}): Container {
  const logger =
    overrides.logger ??
    createLogger({ service: config.service, level: config.logLevel, version: config.appVersion });
  const pool = overrides.pool ?? createPool(config.databaseUrl, { logger });
  // `??` per field, so an explicit `undefined` override cannot clobber a default.
  return {
    config,
    logger,
    pool,
    uow: overrides.uow ?? new PgUnitOfWorkFactory(pool),
    queue: overrides.queue ?? new PgJobQueue(systemIdGenerator, systemClock),
    jobStore:
      overrides.jobStore ??
      new PgJobStore(pool, systemClock, { leaseSeconds: config.worker.leaseSeconds }),
  };
}

// Stored on globalThis so Next.js dev hot reloads reuse one pool instead of opening a new one per reload.
const CONTAINER_KEY = Symbol.for("effluz-forms.container");
type ContainerHolder = { [CONTAINER_KEY]?: Container };

/** Lazily built process-wide container. Throws when the environment is invalid. */
export function getContainer(): Container {
  const holder = globalThis as ContainerHolder;
  const existing = holder[CONTAINER_KEY];
  if (existing) return existing;
  const built = buildContainer(loadConfig(process.env));
  holder[CONTAINER_KEY] = built;
  return built;
}
