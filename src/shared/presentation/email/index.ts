import { renderSubmitterConfirmation } from "./confirmation";
import { renderStaffNotification } from "./staff-notification";

export { renderSubmitterConfirmation } from "./confirmation";
export type { ConfirmationEmailData, EmailParts } from "./confirmation";
export { renderStaffNotification } from "./staff-notification";
export type { StaffEmailData } from "./staff-notification";

/**
 * Satisfies notifications' `EmailRenderer` port structurally; shared may not import modules, so
 * the composition root wires it. See specs/system/email.md, "Templates".
 */
export const emailTemplates = {
  submitterConfirmation: renderSubmitterConfirmation,
  staffNotification: renderStaffNotification,
};
