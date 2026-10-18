import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  InMemoryAuditLog,
  InMemoryAuditLogReader,
  makeDeps,
} from "@/modules/identity/application/testing/fakes";
import { PgDraftRepository } from "@/modules/definitions/infrastructure/pg-draft-repository";
import { PgFormRepository } from "@/modules/definitions/infrastructure/pg-form-repository";
import { PgVersionRepository } from "@/modules/definitions/infrastructure/pg-version-repository";
import { GoogleOidcAdmin } from "@/modules/identity/infrastructure/google-oidc";
import { PgAuditLog } from "@/modules/identity/infrastructure/pg-audit-log";
import { PgAuditLogReader } from "@/modules/identity/infrastructure/pg-audit-log-reader";
import { PgSessionRepository } from "@/modules/identity/infrastructure/pg-session-repository";
import { PgSignInAttemptStore } from "@/modules/identity/infrastructure/pg-sign-in-attempt-store";
import { PLAN_TIME_ZONE } from "@/modules/review/application";
import { PgEditRepository } from "@/modules/review/infrastructure/pg-edit-repository";
import { PgReviewQueries } from "@/modules/review/infrastructure/pg-review-queries";
import { PgStaffPhotoRepository } from "@/modules/review/infrastructure/pg-staff-photo-repository";
import { PgStoryRepository } from "@/modules/review/infrastructure/pg-story-repository";
import { StoredZipWriter } from "@/modules/review/infrastructure/stored-zip-writer";
import { PgSubmissionStats } from "@/modules/submissions/infrastructure/pg-submission-stats";
import { buildDefaultRegistry } from "@/shared/domain/form-model";
import { systemClock } from "@/shared/infrastructure/clock";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { PgJobAdmin } from "@/shared/infrastructure/jobs/pg-job-admin";
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
      media: undefined,
      submissions: undefined,
      auditReader: undefined,
      review: undefined,
    };
    const c = buildContainer(config, overrides as unknown as Partial<Container>);
    expect(c.config).toBe(config);
    expect(c.identity.publicBaseUrl).toBe(config.publicBaseUrl);
    expect(c.auditReader).toBeInstanceOf(PgAuditLogReader);
    expect(c.review.definitions).toBe(c.definitions);
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

  it("wires definitions to the Postgres adapters, submission stats and the configured domains", () => {
    const pool = {} as unknown as Pool;
    const c = buildContainer(config, { pool });
    expect(c.definitions.forms).toBeInstanceOf(PgFormRepository);
    expect(c.definitions.drafts).toBeInstanceOf(PgDraftRepository);
    expect(c.definitions.versions).toBeInstanceOf(PgVersionRepository);
    expect(c.definitions.stats).toBeInstanceOf(PgSubmissionStats);
    expect(c.definitions.audit).toBeInstanceOf(PgAuditLog);
    expect(c.definitions.auditReader).toBeInstanceOf(PgAuditLogReader);
    expect(c.definitions.uow).toBe(c.uow);
    expect(c.definitions.clock).toBe(systemClock);
    expect(c.definitions.ids).toBe(systemIdGenerator);
    expect(c.definitions.registry.list().length).toBe(buildDefaultRegistry().list().length);
    expect(c.definitions.allowedRecipientDomains).toEqual(["example.com"]);
    expect(c.definitions.publicBaseUrl).toBe("http://localhost:3000");
  });

  it("wires media and submissions around the shared definitions, queue and unit of work", () => {
    const pool = {} as unknown as Pool;
    const c = buildContainer(config, { pool });
    expect(c.submissions.definitions).toBe(c.definitions);
    expect(c.submissions.media).toBe(c.media);
    expect(c.media.queue).toBe(c.queue);
    expect(c.media.uow).toBe(c.uow);
    expect(c.submissions.queue).toBe(c.queue);
    expect(c.submissions.uow).toBe(c.uow);
    expect(c.submissions.logger).toBe(c.logger);
  });

  it("builds review on the shared definitions, submissions and media", () => {
    const pool = {} as unknown as Pool;
    const c = buildContainer(config, { pool });
    expect(c.review.definitions).toBe(c.definitions);
    expect(c.review.submissions).toBe(c.submissions);
    expect(c.review.media).toBe(c.media);
    expect(c.review.registry).toBe(c.definitions.registry);
    expect(c.review.uow).toBe(c.uow);
    expect(c.review.audit).toBe(c.identity.audit);
    expect(c.review.auditReader).toBe(c.auditReader);
    expect(c.review.stories).toBeInstanceOf(PgStoryRepository);
    expect(c.review.staffPhotos).toBeInstanceOf(PgStaffPhotoRepository);
    expect(c.review.edits).toBeInstanceOf(PgEditRepository);
    expect(c.review.queries).toBeInstanceOf(PgReviewQueries);
    expect(c.review.jobs).toBeInstanceOf(PgJobAdmin);
    expect(c.review.zip).toBeInstanceOf(StoredZipWriter);
    expect(c.review.clock).toBe(systemClock);
    expect(c.review.ids).toBe(systemIdGenerator);
    expect(c.review.planTimeZone).toBe(PLAN_TIME_ZONE);
    const review = {} as unknown as Container["review"];
    expect(buildContainer(config, { pool, review }).review).toBe(review);
  });

  it("lets an override replace media and submissions", () => {
    const media = {} as unknown as Container["media"];
    const submissions = {} as unknown as Container["submissions"];
    const c = buildContainer(config, { pool: {} as unknown as Pool, media, submissions });
    expect(c.media).toBe(media);
    expect(c.submissions).toBe(submissions);
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
