import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { PgAuditLog } from "@/modules/identity/infrastructure/pg-audit-log";
import { PgAuditLogReader } from "@/modules/identity/infrastructure/pg-audit-log-reader";
import { DropboxStorage } from "@/modules/media/infrastructure/dropbox-storage";
import { LocalDiskStorage } from "@/modules/media/infrastructure/local-disk-storage";
import { EMAIL_JOB_MAX_ATTEMPTS, EMAIL_JOB_TYPES } from "@/modules/notifications/application";
import { MailpitEmailSender } from "@/modules/notifications/infrastructure/mailpit-email-sender";
import { Smtp2goEmailSender } from "@/modules/notifications/infrastructure/smtp2go-email-sender";
import { PgSubmissionStats } from "@/modules/submissions/infrastructure/pg-submission-stats";
import {
  FakeUnitOfWorkFactory,
  InMemoryJobQueue,
  RecordingLogger,
} from "@/shared/application/testing/fakes";
import { emailTemplates } from "@/shared/presentation/email";
import { loadConfig } from "./config";
import {
  buildAlertSource,
  buildDefinitions,
  buildJobStore,
  buildMedia,
  buildNotifications,
  buildReview,
  buildSubmissions,
} from "./modules";

const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  PUBLIC_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://u:p@localhost:5432/none",
  STAGING_DIR: "./data/staging",
  PRIVACY_CONTACT_EMAIL: "privacy@example.com",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_ALLOWED_HOSTED_DOMAIN: "example.com",
};
const pool = {} as unknown as Pool;
const uow = new FakeUnitOfWorkFactory();
const queue = new InMemoryJobQueue();
const noAlerts = { jobAlert: () => Promise.resolve(null) };

describe("module wiring", () => {
  it("uses local disk and Mailpit by default, Dropbox and SMTP2GO when configured", () => {
    const local = loadConfig(env);
    expect(buildMedia(local, pool, uow, queue).durable).toBeInstanceOf(LocalDiskStorage);
    const remote = loadConfig({
      ...env,
      MEDIA_PROVIDER: "dropbox",
      DROPBOX_APP_KEY: "k",
      DROPBOX_APP_SECRET: "s",
      DROPBOX_REFRESH_TOKEN: "r",
      EMAIL_PROVIDER: "smtp2go",
      SMTP2GO_API_KEY: "a",
    });
    expect(buildMedia(remote, pool, uow, queue).durable).toBeInstanceOf(DropboxStorage);
    const definitions = buildDefinitions(
      local,
      pool,
      uow,
      new PgAuditLog(),
      new PgAuditLogReader(pool),
    );
    expect(definitions.stats).toBeInstanceOf(PgSubmissionStats);
    const submissions = buildSubmissions({
      pool,
      uow,
      queue,
      definitions,
      media: buildMedia(local, pool, uow, queue),
      logger: new RecordingLogger(),
    });
    const notifications = buildNotifications(local, pool, submissions, noAlerts);
    expect(notifications.sender).toBeInstanceOf(MailpitEmailSender);
    expect(notifications.renderer).toBe(emailTemplates);
    expect(buildNotifications(remote, pool, submissions, noAlerts).sender).toBeInstanceOf(
      Smtp2goEmailSender,
    );
  });

  it("keeps staging local and shares one unit of work, queue and registry across the modules", () => {
    const config = loadConfig(env);
    const media = buildMedia(config, pool, uow, queue);
    expect(media.staging).toBeInstanceOf(LocalDiskStorage);
    expect(media.uow).toBe(uow);
    expect(media.queue).toBe(queue);
    const definitions = buildDefinitions(
      config,
      pool,
      uow,
      new PgAuditLog(),
      new PgAuditLogReader(pool),
    );
    expect(definitions.allowedRecipientDomains).toEqual(["example.com"]);
    expect(definitions.publicBaseUrl).toBe("http://localhost:3000");
    const submissions = buildSubmissions({
      pool,
      uow,
      queue,
      definitions,
      media,
      logger: new RecordingLogger(),
    });
    expect(submissions.definitions).toBe(definitions);
    expect(submissions.media).toBe(media);
    expect(submissions.uow).toBe(uow);
    expect(submissions.queue).toBe(queue);
    expect(submissions.registry).toBe(definitions.registry);
  });

  it("raises a dead-job alert from the worker's store and mails it to ALERT_EMAIL", () => {
    const config = loadConfig({ ...env, SERVICE: "worker", ALERT_EMAIL: "alerts@example.com" });
    const store = buildJobStore(config, pool);
    expect(store.deadAlert).toEqual({
      type: EMAIL_JOB_TYPES.jobAlert,
      maxAttempts: EMAIL_JOB_MAX_ATTEMPTS,
    });
    expect(store.leaseSeconds).toBe(config.worker.leaseSeconds);

    const media = buildMedia(config, pool, uow, queue);
    const audit = new PgAuditLog();
    const auditReader = new PgAuditLogReader(pool);
    const definitions = buildDefinitions(config, pool, uow, audit, auditReader);
    const submissions = buildSubmissions({
      pool,
      uow,
      queue,
      definitions,
      media,
      logger: new RecordingLogger(),
    });
    const review = buildReview({ pool, uow, definitions, submissions, media, audit, auditReader });
    const source = buildAlertSource(config, review);
    expect(source.opts).toEqual({
      to: "alerts@example.com",
      publicBaseUrl: "http://localhost:3000",
    });
    expect(buildAlertSource(loadConfig(env), review).opts.to).toBeNull();
  });
});
