import type { StaffNotificationData, SubmitterConfirmationData } from "./email-renderer";

/**
 * Looks up what a message needs when its job runs: the address and the data.
 * Null means there is nothing to send (the submission is gone, or it has no
 * address). See specs/system/jobs.md, "Handler rules".
 */
export interface MessageSource {
  submitterConfirmation(
    submissionId: string,
  ): Promise<{ to: string; data: SubmitterConfirmationData } | null>;
  staffNotification(
    submissionId: string,
  ): Promise<{ to: string[]; data: StaffNotificationData } | null>;
}
