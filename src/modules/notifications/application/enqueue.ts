import type { JobQueue } from "@/shared/application/ports/job-queue";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { EMAIL_JOB_TYPES } from "./jobs";

/**
 * Enqueues the emails a submission asks for, inside the intake transaction.
 * Payloads carry the submission id only. See specs/system/jobs.md, "Handler rules".
 */
export async function enqueueSubmissionEmails(
  queue: JobQueue,
  uow: UnitOfWork,
  input: { submissionId: string; submitterConfirmation: boolean; staffNotification: boolean },
): Promise<void> {
  const payload = { submissionId: input.submissionId };
  if (input.submitterConfirmation) {
    await queue.enqueue(uow, EMAIL_JOB_TYPES.submitterConfirmation, payload);
  }
  if (input.staffNotification) {
    await queue.enqueue(uow, EMAIL_JOB_TYPES.staffNotification, payload);
  }
}
