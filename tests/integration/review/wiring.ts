import type { Pool } from "pg";
import type { ReviewDeps, ZipWriter } from "@/modules/review/application";
import { PgEditRepository } from "@/modules/review/infrastructure/pg-edit-repository";
import { PgReviewQueries } from "@/modules/review/infrastructure/pg-review-queries";
import { PgStaffPhotoRepository } from "@/modules/review/infrastructure/pg-staff-photo-repository";
import { PgStoryRepository } from "@/modules/review/infrastructure/pg-story-repository";
import { StoredZipWriter } from "@/modules/review/infrastructure/stored-zip-writer";
import { PLAN_TIME_ZONE } from "@/modules/review/domain/days";
import type { Clock } from "@/shared/application/ports/clock";
import type { JobQueue } from "@/shared/application/ports/job-queue";
import { PgJobAdmin } from "@/shared/infrastructure/jobs/pg-job-admin";
import { pgSubmissionsDeps } from "../submissions/wiring";

/**
 * The real adapters of definitions, media, submissions and review over one
 * pool, the way the composition root wires them: one unit of work factory,
 * id generator and audit log across the four modules. `over.queue` replaces
 * the Postgres job queue, `over.clock` review's clock, `over.zip` the ZIP
 * writer (the module's own `StoredZipWriter` by default).
 */
export function pgReviewDeps(
  pool: Pool,
  dirs: { staging: string; durable: string },
  over: { queue?: JobQueue; clock?: Clock; zip?: ZipWriter } = {},
): ReviewDeps {
  const submissions = pgSubmissionsDeps(pool, dirs, over.queue ? { queue: over.queue } : {});
  const { definitions, media } = submissions;
  return {
    definitions,
    submissions,
    media,
    stories: new PgStoryRepository(pool),
    staffPhotos: new PgStaffPhotoRepository(pool),
    edits: new PgEditRepository(pool),
    queries: new PgReviewQueries(pool),
    jobs: new PgJobAdmin(pool),
    audit: definitions.audit,
    auditReader: definitions.auditReader,
    zip: over.zip ?? new StoredZipWriter(),
    uow: submissions.uow,
    clock: over.clock ?? submissions.clock,
    ids: submissions.ids,
    registry: submissions.registry,
    planTimeZone: PLAN_TIME_ZONE,
  };
}
