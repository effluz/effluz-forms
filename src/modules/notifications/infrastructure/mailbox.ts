const NAMED_MAILBOX = /^\s*(.*?)\s*<([^<>\s]+)>\s*$/;

/** Splits `Name <address>` or a bare address, the shape of `EMAIL_FROM`. */
export function parseMailbox(value: string): { name: string | null; email: string } {
  const match = NAMED_MAILBOX.exec(value);
  if (!match) return { name: null, email: value.trim() };
  const name = match[1] ?? "";
  return { name: name === "" ? null : name, email: match[2] ?? "" };
}
