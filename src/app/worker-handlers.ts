import type { Pool } from "pg";
import { createIdentityCleanupHandler } from "@/modules/identity/infrastructure/jobs/cleanup";
import {
  MEDIA_JOB_TYPES,
  createMediaDeleteHandler,
  createMediaUploadHandler,
  type MediaDeps,
} from "@/modules/media/application";
import {
  EMAIL_JOB_TYPES,
  createJobAlertHandler,
  createStaffNotificationHandler,
  createSubmitterConfirmationHandler,
  type NotificationsDeps,
} from "@/modules/notifications/application";
import {
  expireInProgress,
  sweepStaging,
  type SubmissionsDeps,
} from "@/modules/submissions/application";
import type { JobHandler } from "@/shared/application/ports/job-queue";
import { createCleanupHandler } from "@/shared/infrastructure/jobs/handlers/cleanup";
import type { PgJobStore } from "@/shared/infrastructure/jobs/pg-job-store";
import type { RecurringJob } from "@/shared/infrastructure/jobs/worker";

/** The jobs the scheduler enqueues. See specs/system/jobs.md, "Recurring jobs". */
export const RECURRING: RecurringJob[] = [
  { type: "jobs.cleanup", period: "daily" },
  { type: "identity.cleanup", period: "daily" },
];

/**
 * Every job type this release handles, keyed by type. `jobs.cleanup` runs two
 * submissions steps: expired in-progress records with their staged files,
 * then the staging prefixes no record or media row claims. See
 * specs/system/jobs.md, "Recurring jobs" and "Job types in the first release".
 */
export function workerHandlers(input: {
  store: Pick<PgJobStore, "pruneSucceeded">;
  pool: Pool;
  media: MediaDeps;
  notifications: NotificationsDeps;
  submissions: SubmissionsDeps;
}): Record<string, JobHandler> {
  return {
    "jobs.cleanup": createCleanupHandler(input.store, [
      {
        name: "submissions.expire_in_progress",
        run: (ctx) =>
          expireInProgress(input.submissions, { now: ctx.clock.now(), logger: ctx.logger }).then(
            () => undefined,
          ),
      },
      {
        name: "submissions.sweep_staging",
        run: (ctx) =>
          sweepStaging(input.submissions, { now: ctx.clock.now(), logger: ctx.logger }).then(
            () => undefined,
          ),
      },
    ]),
    "identity.cleanup": createIdentityCleanupHandler(input.pool),
    [MEDIA_JOB_TYPES.upload]: createMediaUploadHandler(input.media),
    [MEDIA_JOB_TYPES.delete]: createMediaDeleteHandler(input.media),
    [EMAIL_JOB_TYPES.submitterConfirmation]: createSubmitterConfirmationHandler(
      input.notifications,
    ),
    [EMAIL_JOB_TYPES.staffNotification]: createStaffNotificationHandler(input.notifications),
    [EMAIL_JOB_TYPES.jobAlert]: createJobAlertHandler(input.notifications),
  };
}
