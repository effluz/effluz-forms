// The honeypot and the minimum fill time (`specs/system/security.md`,
// "Public form abuse protection"). Both end in a silent accept.

export const MIN_FILL_MS = 3_000;
export const HONEYPOT_FIELD = "website-url";

export function isHoneypotFilled(honeypot: string): boolean {
  return honeypot.trim() !== "";
}

/** True when a post must be silently accepted: a filled honeypot, or faster than `MIN_FILL_MS`. */
export function isSilentAccept(input: { honeypot: string; startedAt: Date; now: Date }): boolean {
  return (
    isHoneypotFilled(input.honeypot) ||
    input.now.getTime() - input.startedAt.getTime() < MIN_FILL_MS
  );
}

/** A reference shaped like a real one, shown after a silent accept; nothing is stored under it. */
export function decoyReference(prefix: string, random: () => number): string {
  return `${prefix}-${String(1000 + Math.floor(random() * 9000))}`;
}
