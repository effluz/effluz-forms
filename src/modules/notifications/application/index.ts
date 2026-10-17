/** Public API of the notifications module. Other modules and the app import only this. */
export type { NotificationsDeps } from "./deps";
export type { EmailSender, OutgoingEmail } from "./ports/email-sender";
export { EmailSendError } from "./ports/email-sender";
export type {
  EmailRenderer,
  RenderedEmail,
  StaffNotificationData,
  SubmitterConfirmationData,
} from "./ports/email-renderer";
export type { MessageSource } from "./ports/message-source";
export type { DeliveryLog } from "./ports/delivery-log";

export {
  EMAIL_JOB_TYPES,
  createStaffNotificationHandler,
  createSubmitterConfirmationHandler,
} from "./jobs";
export { enqueueSubmissionEmails } from "./enqueue";
