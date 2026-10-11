import type { Locale } from "@/shared/domain/localized-text";

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export interface SubmitterConfirmationData {
  locale: Locale;
  formTitle: string;
  subject: string;
  /** Rich-text source from the published version; the renderer escapes and sanitizes it. */
  body: string;
  receivedOn: string;
  reference: string;
  retentionMonths: number;
  contact: string;
}

export interface StaffNotificationData {
  formTitle: string;
  reference: string;
  receivedAt: string;
  link: string;
}

/** Turns message data into subject, text and HTML. See specs/system/email.md, "Templates". */
export interface EmailRenderer {
  submitterConfirmation(data: SubmitterConfirmationData): RenderedEmail;
  staffNotification(data: StaffNotificationData): RenderedEmail;
}
