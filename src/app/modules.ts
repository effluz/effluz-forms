import type { Pool } from "pg";
import type { DefinitionsDeps } from "@/modules/definitions/application";
import { PgDraftRepository } from "@/modules/definitions/infrastructure/pg-draft-repository";
import { PgFormRepository } from "@/modules/definitions/infrastructure/pg-form-repository";
import { PgVersionRepository } from "@/modules/definitions/infrastructure/pg-version-repository";
import type { AuditLog, AuditLogReader } from "@/modules/identity/application";
import type { MediaDeps } from "@/modules/media/application";
import { DropboxStorage } from "@/modules/media/infrastructure/dropbox-storage";
import { FileTypeSniffer } from "@/modules/media/infrastructure/file-type-sniffer";
import { LocalDiskStorage } from "@/modules/media/infrastructure/local-disk-storage";
import { PgMediaRepository } from "@/modules/media/infrastructure/pg-media-repository";
import { SharpImageEncoder } from "@/modules/media/infrastructure/sharp-image-encoder";
import type { AlertSource, NotificationsDeps } from "@/modules/notifications/application";
import { MailpitEmailSender } from "@/modules/notifications/infrastructure/mailpit-email-sender";
import { PgDeliveryLog } from "@/modules/notifications/infrastructure/pg-delivery-log";
import { Smtp2goEmailSender } from "@/modules/notifications/infrastructure/smtp2go-email-sender";
import { VersionCache, type SubmissionsDeps } from "@/modules/submissions/application";
import { SubmissionMessageSource } from "@/modules/submissions/infrastructure/message-source";
import { PgInProgressRepository } from "@/modules/submissions/infrastructure/pg-in-progress-repository";
import { PgSubmissionRepository } from "@/modules/submissions/infrastructure/pg-submission-repository";
import { PgSubmissionStats } from "@/modules/submissions/infrastructure/pg-submission-stats";
import type { JobQueue } from "@/shared/application/ports/job-queue";
import type { Logger } from "@/shared/application/ports/logger";
import type { UnitOfWorkFactory } from "@/shared/application/ports/unit-of-work";
import { buildDefaultRegistry } from "@/shared/domain/form-model";
import { systemClock } from "@/shared/infrastructure/clock";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { emailTemplates } from "@/shared/presentation/email";
import type { AppConfig } from "./config";

/*
 * Module wiring shared by the web container and the worker, so both processes
 * build definitions, media, submissions and notifications the same way. Each
 * process calls `buildDefaultRegistry()` once, through `buildDefinitions`, and
 * every later module reuses that registry. See specs/architecture.md, "Ports".
 */

/** Definitions over Postgres, with submission counts from the submissions tables. */
export function buildDefinitions(
  config: AppConfig,
  pool: Pool,
  uow: UnitOfWorkFactory,
  audit: AuditLog,
  auditReader: AuditLogReader,
): DefinitionsDeps {
  return {
    forms: new PgFormRepository(pool),
    drafts: new PgDraftRepository(pool),
    versions: new PgVersionRepository(pool),
    stats: new PgSubmissionStats(pool),
    audit,
    auditReader,
    uow,
    clock: systemClock,
    ids: systemIdGenerator,
    registry: buildDefaultRegistry(),
    allowedRecipientDomains: config.notificationAllowedDomains,
    publicBaseUrl: config.publicBaseUrl,
  };
}

/** Media: staging is always local disk; durable storage is local disk or Dropbox. */
export function buildMedia(
  config: AppConfig,
  pool: Pool,
  uow: UnitOfWorkFactory,
  queue: JobQueue,
): MediaDeps {
  const { media } = config;
  return {
    staging: new LocalDiskStorage(config.stagingDir),
    durable:
      media.provider === "dropbox"
        ? new DropboxStorage({
            appKey: media.appKey,
            appSecret: media.appSecret,
            refreshToken: media.refreshToken,
            apiUrl: media.apiUrl,
            contentUrl: media.contentUrl,
          })
        : new LocalDiskStorage(media.durableDir),
    sniffer: new FileTypeSniffer(),
    encoder: new SharpImageEncoder(),
    media: new PgMediaRepository(pool),
    queue,
    uow,
    ids: systemIdGenerator,
    clock: systemClock,
  };
}

/** Submissions over Postgres, on the given definitions and media. */
export function buildSubmissions(input: {
  pool: Pool;
  uow: UnitOfWorkFactory;
  queue: JobQueue;
  definitions: DefinitionsDeps;
  media: MediaDeps;
  logger: Logger;
}): SubmissionsDeps {
  return {
    definitions: input.definitions,
    media: input.media,
    inProgress: new PgInProgressRepository(input.pool),
    submissions: new PgSubmissionRepository(input.pool),
    queue: input.queue,
    uow: input.uow,
    clock: systemClock,
    ids: systemIdGenerator,
    registry: input.definitions.registry,
    logger: input.logger,
    versions: new VersionCache(),
    random: Math.random,
  };
}

/** Notifications: the email provider from the config, the shared templates, submissions as the message source, `alerts` for dead-job alerts. */
export function buildNotifications(
  config: AppConfig,
  pool: Pool,
  submissions: SubmissionsDeps,
  alerts: AlertSource,
): NotificationsDeps {
  const { email } = config;
  return {
    sender:
      email.provider === "smtp2go"
        ? new Smtp2goEmailSender({
            apiKey: email.apiKey,
            apiUrl: email.apiUrl,
            from: email.from,
            replyTo: email.replyTo,
          })
        : new MailpitEmailSender({ url: email.url, from: email.from, replyTo: email.replyTo }),
    renderer: emailTemplates,
    source: new SubmissionMessageSource({
      submissions: submissions.submissions,
      definitions: submissions.definitions,
      versions: submissions.versions,
      registry: submissions.registry,
      publicBaseUrl: config.publicBaseUrl,
      privacyContact: config.privacyContactEmail,
    }),
    alerts,
    deliveries: new PgDeliveryLog(pool),
  };
}
