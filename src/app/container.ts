import type { Pool } from "pg";
import type { DefinitionsDeps } from "@/modules/definitions/application";
import type { AuditLogReader, IdentityDeps } from "@/modules/identity/application";
import { GoogleOidcAdmin } from "@/modules/identity/infrastructure/google-oidc";
import { PgAuditLog } from "@/modules/identity/infrastructure/pg-audit-log";
import { PgAuditLogReader } from "@/modules/identity/infrastructure/pg-audit-log-reader";
import { PgSessionRepository } from "@/modules/identity/infrastructure/pg-session-repository";
import { PgSignInAttemptStore } from "@/modules/identity/infrastructure/pg-sign-in-attempt-store";
import type { MediaDeps } from "@/modules/media/application";
import type { SubmissionsDeps } from "@/modules/submissions/application";
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
import { buildDefinitions, buildMedia, buildSubmissions } from "./modules";

export interface Container {
  config: AppConfig;
  logger: Logger;
  pool: Pool;
  uow: UnitOfWorkFactory;
  queue: JobQueue;
  jobStore: PgJobStore;
  identity: IdentityDeps;
  definitions: DefinitionsDeps;
  media: MediaDeps;
  submissions: SubmissionsDeps;
  auditReader: AuditLogReader;
}

function buildIdentity(config: AppConfig, pool: Pool, uow: UnitOfWorkFactory): IdentityDeps {
  return {
    identity: new GoogleOidcAdmin({
      issuer: config.google.issuer,
      clientId: config.google.clientId,
      clientSecret: config.google.clientSecret,
      allowedHostedDomain: config.google.allowedHostedDomain,
    }),
    sessions: new PgSessionRepository(pool),
    audit: new PgAuditLog(),
    attempts: new PgSignInAttemptStore(pool),
    uow,
    clock: systemClock,
    ids: systemIdGenerator,
    allowedHostedDomain: config.google.allowedHostedDomain,
    publicBaseUrl: config.publicBaseUrl,
  };
}

/**
 * Web composition root: wires adapters to ports. Overrides replace any part,
 * which is how tests supply fakes. See specs/architecture.md.
 */
export function buildContainer(
  baseConfig: AppConfig,
  overrides: Partial<Container> = {},
): Container {
  // `??` per field, so an explicit `undefined` override cannot clobber a default.
  const config = overrides.config ?? baseConfig;
  const logger =
    overrides.logger ??
    createLogger({ service: config.service, level: config.logLevel, version: config.appVersion });
  const pool = overrides.pool ?? createPool(config.databaseUrl, { logger });
  const uow = overrides.uow ?? new PgUnitOfWorkFactory(pool);
  const identity = overrides.identity ?? buildIdentity(config, pool, uow);
  const auditReader = overrides.auditReader ?? new PgAuditLogReader(pool);
  const queue = overrides.queue ?? new PgJobQueue(systemIdGenerator, systemClock);
  const definitions =
    overrides.definitions ?? buildDefinitions(config, pool, uow, identity.audit, auditReader);
  const media = overrides.media ?? buildMedia(config, pool, uow, queue);
  const submissions =
    overrides.submissions ?? buildSubmissions({ pool, uow, queue, definitions, media, logger });
  return {
    config,
    logger,
    pool,
    uow,
    queue,
    jobStore:
      overrides.jobStore ??
      new PgJobStore(pool, systemClock, { leaseSeconds: config.worker.leaseSeconds }),
    identity,
    definitions,
    media,
    submissions,
    auditReader,
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
