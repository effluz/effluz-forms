// The honeypot and the minimum fill time (`specs/system/security.md`,
// "Public form abuse protection"). Both end in a silent accept. The honeypot
// is checked on every post; the minimum time at Submit only.

export const MIN_FILL_MS = 3_000;
export const HONEYPOT_FIELD = "website-url";

export function isHoneypotFilled(honeypot: string): boolean {
  return honeypot.trim() !== "";
}

/** True when less than `MIN_FILL_MS` passed between the start of the record and `now`. */
export function isTooFast(input: { startedAt: Date; now: Date }): boolean {
  return input.now.getTime() - input.startedAt.getTime() < MIN_FILL_MS;
}

/** True when a Submit must be silently accepted: a filled honeypot, or faster than `MIN_FILL_MS`. */
export function isSilentAccept(input: { honeypot: string; startedAt: Date; now: Date }): boolean {
  return isHoneypotFilled(input.honeypot) || isTooFast(input);
}

/** A reference shaped like a real one, shown after a silent accept; nothing is stored under it. */
export function decoyReference(prefix: string, random: () => number): string {
  return `${prefix}-${String(1000 + Math.floor(random() * 9000))}`;
}
