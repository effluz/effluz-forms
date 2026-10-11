import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  InMemoryAuditLog,
  InMemoryAuditLogReader,
  makeDeps,
} from "@/modules/identity/application/testing/fakes";
import { NullSubmissionStats } from "@/modules/definitions/infrastructure/null-submission-stats";
import { PgDraftRepository } from "@/modules/definitions/infrastructure/pg-draft-repository";
import { PgFormRepository } from "@/modules/definitions/infrastructure/pg-form-repository";
import { PgVersionRepository } from "@/modules/definitions/infrastructure/pg-version-repository";
import { GoogleOidcAdmin } from "@/modules/identity/infrastructure/google-oidc";
import { PgAuditLog } from "@/modules/identity/infrastructure/pg-audit-log";
import { PgAuditLogReader } from "@/modules/identity/infrastructure/pg-audit-log-reader";
import { PgSessionRepository } from "@/modules/identity/infrastructure/pg-session-repository";
import { PgSignInAttemptStore } from "@/modules/identity/infrastructure/pg-sign-in-attempt-store";
import { buildDefaultRegistry } from "@/shared/domain/form-model";
import { systemClock } from "@/shared/infrastructure/clock";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { loadConfig } from "./config";
import { buildContainer, type Container } from "./container";

const config = loadConfig({
  NODE_ENV: "test",
  PUBLIC_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://user:pw@localhost:5432/none",
  STAGING_DIR: "./data/staging",
  PRIVACY_CONTACT_EMAIL: "privacy@example.com",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_ALLOWED_HOSTED_DOMAIN: "example.com",
});

describe("buildContainer", () => {
  it("wires the shared services from the config around the given pool", () => {
    const pool = {} as unknown as Pool;
    const c = buildContainer(config, { pool });
    expect(c.config).toBe(config);
    expect(c.pool).toBe(pool);
    expect(typeof c.uow.run).toBe("function");
    expect(typeof c.queue.enqueue).toBe("function");
    expect(c.jobStore.leaseSeconds).toBe(config.worker.leaseSeconds);
    expect(typeof c.logger.info).toBe("function");
  });

  it("lets overrides replace any part", () => {
    const pool = {} as unknown as Pool;
    const logger = { marker: true } as unknown as ReturnType<typeof buildContainer>["logger"];
    const c = buildContainer(config, { pool, logger });
    expect(c.logger).toBe(logger);
  });

  it("keeps the defaults when an override is explicitly undefined", () => {
    const pool = {} as unknown as Pool;
    // exactOptionalPropertyTypes forbids this in typed code; plain JS callers can still do it.
    const overrides = {
      pool,
      config: undefined,
      uow: undefined,
      queue: undefined,
      jobStore: undefined,
      identity: undefined,
      definitions: undefined,
      auditReader: undefined,
    };
    const c = buildContainer(config, overrides as unknown as Partial<Container>);
    expect(c.config).toBe(config);
    expect(c.identity.publicBaseUrl).toBe(config.publicBaseUrl);
    expect(c.auditReader).toBeInstanceOf(PgAuditLogReader);
    expect(typeof c.uow.run).toBe("function");
    expect(typeof c.queue.enqueue).toBe("function");
    expect(c.jobStore.leaseSeconds).toBe(config.worker.leaseSeconds);
  });

  it("wires identity to the Postgres adapters, the Google adapter and the shared unit of work", () => {
    const pool = {} as unknown as Pool;
    const c = buildContainer(config, { pool });
    expect(c.identity.identity).toBeInstanceOf(GoogleOidcAdmin);
    expect(c.identity.sessions).toBeInstanceOf(PgSessionRepository);
    expect(c.identity.audit).toBeInstanceOf(PgAuditLog);
    expect(c.identity.attempts).toBeInstanceOf(PgSignInAttemptStore);
    expect(c.identity.uow).toBe(c.uow);
    expect(c.identity.clock).toBe(systemClock);
    expect(c.identity.ids).toBe(systemIdGenerator);
    expect(c.identity.allowedHostedDomain).toBe("example.com");
    expect(c.identity.publicBaseUrl).toBe("http://localhost:3000");
  });

  it("lets an override replace identity", () => {
    const identity = makeDeps();
    const c = buildContainer(config, { pool: {} as unknown as Pool, identity });
    expect(c.identity).toBe(identity);
  });

  it("wires the audit reader to Postgres and lets an override replace it", () => {
    const pool = {} as unknown as Pool;
    expect(buildContainer(config, { pool }).auditReader).toBeInstanceOf(PgAuditLogReader);
    const auditReader = new InMemoryAuditLogReader(new InMemoryAuditLog());
    expect(buildContainer(config, { pool, auditReader }).auditReader).toBe(auditReader);
  });

  it("wires definitions to the Postgres adapters, null stats and the configured domains", () => {
    const pool = {} as unknown as Pool;
    const c = buildContainer(config, { pool });
    expect(c.definitions.forms).toBeInstanceOf(PgFormRepository);
    expect(c.definitions.drafts).toBeInstanceOf(PgDraftRepository);
    expect(c.definitions.versions).toBeInstanceOf(PgVersionRepository);
    expect(c.definitions.stats).toBeInstanceOf(NullSubmissionStats);
    expect(c.definitions.audit).toBeInstanceOf(PgAuditLog);
    expect(c.definitions.auditReader).toBeInstanceOf(PgAuditLogReader);
    expect(c.definitions.uow).toBe(c.uow);
    expect(c.definitions.clock).toBe(systemClock);
    expect(c.definitions.ids).toBe(systemIdGenerator);
    expect(c.definitions.registry.list().length).toBe(buildDefaultRegistry().list().length);
    expect(c.definitions.allowedRecipientDomains).toEqual(["example.com"]);
    expect(c.definitions.publicBaseUrl).toBe("http://localhost:3000");
  });

  it("lets an override replace definitions", () => {
    const definitions = {} as unknown as Container["definitions"];
    const c = buildContainer(config, { pool: {} as unknown as Pool, definitions });
    expect(c.definitions).toBe(definitions);
  });

  it("builds everything from an overriding config", () => {
    const other = {
      ...config,
      publicBaseUrl: "https://forms.example.com",
      google: { ...config.google, allowedHostedDomain: "example.org" },
      worker: { ...config.worker, leaseSeconds: 120 },
    };
    const c = buildContainer(config, { pool: {} as unknown as Pool, config: other });
    expect(c.config).toBe(other);
    expect(c.jobStore.leaseSeconds).toBe(120);
    expect(c.identity.publicBaseUrl).toBe("https://forms.example.com");
    expect(c.identity.allowedHostedDomain).toBe("example.org");
  });
});
