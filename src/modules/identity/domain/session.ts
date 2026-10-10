export const IDLE_HOURS = 8;
export const ABSOLUTE_DAYS = 7;

export interface Session {
  id: string;
  email: string;
  name: string;
  csrfToken: string;
  createdAt: Date;
  lastSeenAt: Date;
}

export type SessionState = "active" | "idle_expired" | "absolute_expired";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Classifies a session against its idle and absolute limits. A timestamp exactly
 * on a limit is still active; absolute expiry wins when both apply.
 * See specs/system/security.md, "Sessions".
 */
export function sessionState(s: Session, now: Date): SessionState {
  if (now.getTime() > s.createdAt.getTime() + ABSOLUTE_DAYS * DAY_MS) return "absolute_expired";
  if (now.getTime() > s.lastSeenAt.getTime() + IDLE_HOURS * HOUR_MS) return "idle_expired";
  return "active";
}

/**
 * Returns a copy of the session marked as seen at `now`.
 * See specs/system/security.md, "Sessions".
 */
export function touch(s: Session, now: Date): Session {
  return { ...s, lastSeenAt: new Date(now.getTime()) };
}

/**
 * Cookie lifetime in seconds: the absolute session lifetime.
 * See specs/system/security.md, "Sessions".
 */
export function sessionCookieMaxAgeSeconds(): number {
  return ABSOLUTE_DAYS * 24 * 60 * 60;
}
