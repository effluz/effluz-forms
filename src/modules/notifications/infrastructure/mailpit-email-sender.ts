import { EmailSendError, type EmailSender, type OutgoingEmail } from "../application";
import { parseMailbox } from "./mailbox";

/** A send that takes longer is abandoned and retried by the job system as unreachable. */
const REQUEST_TIMEOUT_MS = 30_000;

export interface MailpitConfig {
  url: string;
  from: string;
  replyTo: string;
  fetch?: typeof fetch;
}

/**
 * Local-development sender: posts to Mailpit's `POST /api/v1/send`, which
 * returns a message id like the real provider; see specs/system/email.md,
 * "Local development". Errors carry statuses only, never an address.
 */
export class MailpitEmailSender implements EmailSender {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly config: MailpitConfig) {
    this.fetchFn = config.fetch ?? fetch;
  }

  async send(email: OutgoingEmail): Promise<{ providerMessageId: string }> {
    const from = parseMailbox(this.config.from);
    let response: Response;
    try {
      response = await this.fetchFn(`${this.config.url.replace(/\/+$/, "")}/api/v1/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          From: from.name === null ? { Email: from.email } : { Email: from.email, Name: from.name },
          To: email.to.map((address) => ({ Email: address })),
          ReplyTo: [{ Email: parseMailbox(this.config.replyTo).email }],
          Subject: email.subject,
          Text: email.text,
          HTML: email.html,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new EmailSendError("mailpit is unreachable", false);
    }
    if (!response.ok) {
      throw new EmailSendError(
        `mailpit failed with ${String(response.status)}`,
        response.status === 400,
      );
    }
    let id: unknown;
    try {
      id = ((await response.json()) as { ID?: unknown }).ID;
    } catch {
      id = undefined;
    }
    if (typeof id !== "string" || id === "") {
      throw new EmailSendError("mailpit returned no message id", false);
    }
    return { providerMessageId: id };
  }
}
