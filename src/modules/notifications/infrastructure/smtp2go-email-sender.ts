import { EmailSendError, type EmailSender, type OutgoingEmail } from "../application";

export interface Smtp2goConfig {
  apiKey: string;
  apiUrl: string;
  from: string;
  replyTo: string;
  fetch?: typeof fetch;
}

interface Smtp2goResponse {
  data?: {
    succeeded?: number;
    email_id?: string;
    error_code?: string;
  };
}

async function readJson(response: Response): Promise<Smtp2goResponse> {
  try {
    return (await response.json()) as Smtp2goResponse;
  } catch {
    return {};
  }
}

/**
 * Sends through the SMTP2GO HTTP API; see specs/system/email.md, "Provider" and
 * ADR 0006. Errors carry provider codes and statuses only, never an address or
 * the API key.
 */
export class Smtp2goEmailSender implements EmailSender {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly config: Smtp2goConfig) {
    this.fetchFn = config.fetch ?? fetch;
  }

  async send(email: OutgoingEmail): Promise<{ providerMessageId: string }> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.config.apiUrl.replace(/\/+$/, "")}/email/send`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-smtp2go-api-key": this.config.apiKey,
        },
        body: JSON.stringify({
          sender: this.config.from,
          to: email.to,
          subject: email.subject,
          text_body: email.text,
          html_body: email.html,
          custom_headers: [{ header: "Reply-To", value: this.config.replyTo }],
        }),
      });
    } catch {
      throw new EmailSendError("smtp2go is unreachable", false);
    }

    const body = await readJson(response);
    if (response.status === 400) {
      throw new EmailSendError(
        `smtp2go refused the message (${body.data?.error_code ?? "no code"})`,
        true,
      );
    }
    if (!response.ok) {
      throw new EmailSendError(`smtp2go failed with ${String(response.status)}`, false);
    }
    const emailId = body.data?.email_id;
    if ((body.data?.succeeded ?? 0) < 1 || !emailId) {
      throw new EmailSendError("smtp2go rejected the recipient", true);
    }
    return { providerMessageId: emailId };
  }
}
