import {
  PermanentJobError,
  type JobHandler,
  type JobHandlerContext,
  type JobPayload,
} from "@/shared/application/ports/job-queue";
import type { NotificationsDeps } from "./deps";
import type { RenderedEmail } from "./ports/email-renderer";
import { EmailSendError } from "./ports/email-sender";

export const EMAIL_JOB_TYPES = {
  submitterConfirmation: "email.submitter_confirmation",
  staffNotification: "email.staff_notification",
} as const;

/**
 * Attempt limit for every `email.*` job: with the backoff of 2^attempt seconds
 * capped at one hour, 16 attempts cover about five hours of provider outage. See
 * specs/system/jobs.md, "Job types in the first release".
 */
export const EMAIL_JOB_MAX_ATTEMPTS = 16;

function submissionIdOf(payload: JobPayload): string {
  const id = payload.submissionId;
  if (typeof id !== "string") throw new PermanentJobError("payload has no submissionId");
  return id;
}

/**
 * Sends one email at most once per `<job type>:<submission id>`: a run that finds
 * the key in the delivery log sends nothing, and the provider id is recorded
 * before the job succeeds. See specs/system/email.md, "Ports".
 */
async function deliver(
  deps: NotificationsDeps,
  ctx: JobHandlerContext,
  type: string,
  submissionId: string,
  build: () => Promise<{ to: readonly string[]; rendered: RenderedEmail } | null>,
): Promise<void> {
  const log = ctx.logger.child({ submissionId });
  const key = `${type}:${submissionId}`;
  if ((await deps.deliveries.find(key)) !== null) {
    log.info("email already sent");
    return;
  }
  const message = await build();
  if (message === null || message.to.length === 0) {
    log.info("email not applicable");
    return;
  }
  let providerMessageId: string;
  try {
    ({ providerMessageId } = await deps.sender.send({ to: message.to, ...message.rendered }));
  } catch (e) {
    if (e instanceof EmailSendError && e.permanent) throw new PermanentJobError(e.message);
    throw e;
  }
  await deps.deliveries.record(key, providerMessageId, ctx.clock.now());
  log.info("email sent");
}

/** Job `email.submitter_confirmation`, payload `{ submissionId }`. See specs/system/email.md. */
export function createSubmitterConfirmationHandler(deps: NotificationsDeps): JobHandler {
  return async (payload, ctx) => {
    const submissionId = submissionIdOf(payload);
    await deliver(deps, ctx, EMAIL_JOB_TYPES.submitterConfirmation, submissionId, async () => {
      const found = await deps.source.submitterConfirmation(submissionId);
      if (found === null) return null;
      return { to: [found.to], rendered: deps.renderer.submitterConfirmation(found.data) };
    });
  };
}

/** Job `email.staff_notification`, payload `{ submissionId }`. See specs/system/email.md. */
export function createStaffNotificationHandler(deps: NotificationsDeps): JobHandler {
  return async (payload, ctx) => {
    const submissionId = submissionIdOf(payload);
    await deliver(deps, ctx, EMAIL_JOB_TYPES.staffNotification, submissionId, async () => {
      const found = await deps.source.staffNotification(submissionId);
      if (found === null) return null;
      return { to: found.to, rendered: deps.renderer.staffNotification(found.data) };
    });
  };
}
