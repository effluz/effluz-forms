import { renderSubmitterConfirmation } from "./confirmation";
import { renderJobAlert } from "./job-alert";
import { renderStaffNotification } from "./staff-notification";

export { renderSubmitterConfirmation } from "./confirmation";
export type { ConfirmationEmailData, EmailParts } from "./confirmation";
export { renderJobAlert } from "./job-alert";
export type { JobAlertEmailData } from "./job-alert";
export { renderStaffNotification } from "./staff-notification";
export type { StaffEmailData } from "./staff-notification";

/**
 * Satisfies notifications' `EmailRenderer` port structurally; shared may not import modules, so
 * the composition root wires it. See specs/system/email.md, "Templates".
 */
export const emailTemplates = {
  submitterConfirmation: renderSubmitterConfirmation,
  staffNotification: renderStaffNotification,
  jobAlert: renderJobAlert,
};
