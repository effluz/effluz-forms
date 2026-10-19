/**
 * Fakes for the notifications ports, used by tests in this and other modules.
 *
 * - `RecordingEmailSender`: records copies in `sent`, ids `msg-<n>`; `failWith` makes `send` reject.
 * - `StubMessageSource`: returns its `confirmation` and `staff` fields.
 * - `StubAlertSource`: returns what its `next` field holds (null by default).
 * - `InMemoryDeliveryLog`: `entries` maps key to provider id; the first id for a key wins.
 * - `stubRenderer`: builds subject, text and html from the data fields, for assertions.
 *
 * Synthetic data only (example.com addresses). Not for production code.
 */
import type { NotificationsDeps } from "../deps";
import type { AlertSource } from "../ports/alert-source";
import type { DeliveryLog } from "../ports/delivery-log";
import type {
  EmailRenderer,
  JobAlertData,
  StaffNotificationData,
  SubmitterConfirmationData,
} from "../ports/email-renderer";
import type { EmailSendError, EmailSender, OutgoingEmail } from "../ports/email-sender";
import type { MessageSource } from "../ports/message-source";

export class RecordingEmailSender implements EmailSender {
  readonly sent: OutgoingEmail[] = [];
  failWith: EmailSendError | null = null;

  send(email: OutgoingEmail): Promise<{ providerMessageId: string }> {
    if (this.failWith !== null) return Promise.reject(this.failWith);
    this.sent.push({ ...email, to: [...email.to] });
    return Promise.resolve({ providerMessageId: `msg-${String(this.sent.length)}` });
  }
}

export class StubMessageSource implements MessageSource {
  confirmation: { to: string; data: SubmitterConfirmationData } | null = null;
  staff: { to: string[]; data: StaffNotificationData } | null = null;

  submitterConfirmation(): Promise<{ to: string; data: SubmitterConfirmationData } | null> {
    return Promise.resolve(this.confirmation);
  }

  staffNotification(): Promise<{ to: string[]; data: StaffNotificationData } | null> {
    return Promise.resolve(this.staff);
  }
}

export class StubAlertSource implements AlertSource {
  next: { to: string[]; data: JobAlertData } | null = null;

  jobAlert(): Promise<{ to: string[]; data: JobAlertData } | null> {
    return Promise.resolve(this.next);
  }
}

export class InMemoryDeliveryLog implements DeliveryLog {
  readonly entries = new Map<string, string>();

  find(key: string): Promise<string | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  record(key: string, providerMessageId: string): Promise<void> {
    if (!this.entries.has(key)) this.entries.set(key, providerMessageId);
    return Promise.resolve();
  }
}

export const stubRenderer: EmailRenderer = {
  submitterConfirmation: (d) => ({
    subject: d.subject,
    text: `${d.body} ${d.reference}`,
    html: `<p>${d.reference}</p>`,
  }),
  staffNotification: (d) => ({
    subject: `New ${d.reference}`,
    text: d.link,
    html: `<p>${d.reference}</p>`,
  }),
  jobAlert: (d) => ({
    subject: `Alert ${d.jobType} ${String(d.count)}`,
    text: d.link,
    html: `<p>${d.jobType}</p>`,
  }),
};

export interface FakeNotificationsDeps extends NotificationsDeps {
  sender: RecordingEmailSender;
  source: StubMessageSource;
  alerts: StubAlertSource;
  deliveries: InMemoryDeliveryLog;
}

export function makeNotificationsDeps(
  over: Partial<FakeNotificationsDeps> = {},
): FakeNotificationsDeps {
  return {
    sender: new RecordingEmailSender(),
    renderer: stubRenderer,
    source: new StubMessageSource(),
    alerts: new StubAlertSource(),
    deliveries: new InMemoryDeliveryLog(),
    ...over,
  };
}
