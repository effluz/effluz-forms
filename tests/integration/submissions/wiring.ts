import type { Pool } from "pg";
import type { DefinitionsDeps } from "@/modules/definitions/application";
import { PgDraftRepository } from "@/modules/definitions/infrastructure/pg-draft-repository";
import { PgFormRepository } from "@/modules/definitions/infrastructure/pg-form-repository";
import { PgVersionRepository } from "@/modules/definitions/infrastructure/pg-version-repository";
import { PgAuditLog } from "@/modules/identity/infrastructure/pg-audit-log";
import { PgAuditLogReader } from "@/modules/identity/infrastructure/pg-audit-log-reader";
import type { MediaDeps } from "@/modules/media/application";
import { FileTypeSniffer } from "@/modules/media/infrastructure/file-type-sniffer";
import { LocalDiskStorage } from "@/modules/media/infrastructure/local-disk-storage";
import { PgMediaRepository } from "@/modules/media/infrastructure/pg-media-repository";
import { SharpImageEncoder } from "@/modules/media/infrastructure/sharp-image-encoder";
import { VersionCache, type SubmissionsDeps } from "@/modules/submissions/application";
import { PgInProgressRepository } from "@/modules/submissions/infrastructure/pg-in-progress-repository";
import { PgSubmissionRepository } from "@/modules/submissions/infrastructure/pg-submission-repository";
import { PgSubmissionStats } from "@/modules/submissions/infrastructure/pg-submission-stats";
import type { JobQueue } from "@/shared/application/ports/job-queue";
import { RecordingLogger } from "@/shared/application/testing/fakes";
import { buildDefaultRegistry } from "@/shared/domain/form-model";
import { systemClock } from "@/shared/infrastructure/clock";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { PgJobQueue } from "@/shared/infrastructure/jobs/pg-job-queue";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";

/**
 * The real adapters of definitions, media and submissions over one pool, the
 * way the composition root wires them: one unit of work factory and one job
 * queue (`over.queue`, else Postgres) shared by the three modules.
 */
export function pgSubmissionsDeps(
  pool: Pool,
  dirs: { staging: string; durable: string },
  over: { queue?: JobQueue } = {},
): SubmissionsDeps {
  const uow = new PgUnitOfWorkFactory(pool);
  const queue = over.queue ?? new PgJobQueue(systemIdGenerator, systemClock);
  const registry = buildDefaultRegistry();
  const definitions: DefinitionsDeps = {
    forms: new PgFormRepository(pool),
    drafts: new PgDraftRepository(pool),
    versions: new PgVersionRepository(pool),
    stats: new PgSubmissionStats(pool),
    audit: new PgAuditLog(),
    auditReader: new PgAuditLogReader(pool),
    uow,
    clock: systemClock,
    ids: systemIdGenerator,
    registry,
    allowedRecipientDomains: ["example.com"],
    publicBaseUrl: "http://localhost:3000",
  };
  const media: MediaDeps = {
    staging: new LocalDiskStorage(dirs.staging),
    durable: new LocalDiskStorage(dirs.durable),
    sniffer: new FileTypeSniffer(),
    encoder: new SharpImageEncoder(),
    media: new PgMediaRepository(pool),
    queue,
    uow,
    ids: systemIdGenerator,
    clock: systemClock,
  };
  return {
    definitions,
    media,
    inProgress: new PgInProgressRepository(pool),
    submissions: new PgSubmissionRepository(pool),
    queue,
    uow,
    clock: systemClock,
    ids: systemIdGenerator,
    registry,
    logger: new RecordingLogger(),
    versions: new VersionCache(),
    random: Math.random,
  };
}
