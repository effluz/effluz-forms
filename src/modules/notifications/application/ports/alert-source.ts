import type { JobAlertData } from "./email-renderer";

/**
 * What an alert needs, read when its job runs; null when there is nothing to send. Implemented by
 * review. See specs/system/email.md, "Ports", and specs/decisions/0029-dead-job-alerts.md.
 */
export interface AlertSource {
  jobAlert(jobType: string): Promise<{ to: string[]; data: JobAlertData } | null>;
}
