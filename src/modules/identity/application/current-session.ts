import { sessionState, touch, type Session, type SessionState } from "../domain/session";
import type { IdentityDeps, RequestMeta } from "./deps";

export type CurrentSession =
  | { state: "active"; session: Session }
  | { state: "none" }
  | { state: "expired"; reason: SessionState };

/** lastSeenAt is refreshed at most this often, to keep reads cheap. */
const TOUCH_INTERVAL_MS = 60_000;

/**
 * Resolves the session behind a cookie. Expiry is enforced lazily: the first request
 * that finds an expired session deletes it and audits `session_expired` once.
 * See specs/system/security.md, "Sessions", and specs/use-cases/sign-in.md, "Audit entries".
 */
export async function currentSession(
  deps: IdentityDeps,
  input: { sessionId: string | null; meta: RequestMeta },
): Promise<CurrentSession> {
  if (input.sessionId === null) return { state: "none" };
  const session = await deps.sessions.findById(input.sessionId);
  if (session === null) return { state: "none" };

  const now = deps.clock.now();
  const state = sessionState(session, now);
  if (state !== "active") {
    await deps.uow.run(async (uow) => {
      await deps.sessions.delete(uow, session.id);
      await deps.audit.record(
        uow,
        {
          action: "session_expired",
          actorEmail: session.email,
          targetId: session.id,
          ip: input.meta.ip,
          details: { reason: state },
        },
        now,
      );
    });
    return { state: "expired", reason: state };
  }

  if (now.getTime() - session.lastSeenAt.getTime() < TOUCH_INTERVAL_MS) {
    return { state: "active", session };
  }
  await deps.sessions.touch(session.id, now);
  return { state: "active", session: touch(session, now) };
}
