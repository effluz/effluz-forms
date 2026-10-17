export interface OutgoingEmail {
  to: readonly string[];
  subject: string;
  text: string;
  html: string;
}

/** Sends one message through the transactional provider. See specs/system/email.md, "Ports". */
export interface EmailSender {
  send(email: OutgoingEmail): Promise<{ providerMessageId: string }>;
}

/**
 * A provider failure. `permanent` marks one no retry can fix (invalid address,
 * suppressed recipient); the job then goes dead at once.
 */
export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = "EmailSendError";
  }
}
