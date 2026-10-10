import { sessionState } from "../domain/session";
import type { IdentityDeps, RequestMeta } from "./deps";

/**
 * Compares two strings without returning early on the first difference, so timing
 * does not reveal how much of a CSRF token matched. Node's `timingSafeEqual` is
 * unavailable here because application code imports no `node:` modules.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Destroys the server-side session and audits `sign_out`, after checking the CSRF token.
 * See specs/use-cases/sign-in.md, "Alternate flows and errors", and
 * specs/system/security.md, "Sessions".
 */
export async function signOut(
  deps: IdentityDeps,
  input: { sessionId: string; csrfToken: string; meta: RequestMeta },
): Promise<"signed_out" | "csrf_mismatch" | "no_session"> {
  const session = await deps.sessions.findById(input.sessionId);
  if (session === null) return "no_session";

  const now = deps.clock.now();
  const state = sessionState(session, now);
  if (state !== "active") {
    // An expired session cannot sign out; clean it up exactly as currentSession would.
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
    return "no_session";
  }
  if (!constantTimeEqual(session.csrfToken, input.csrfToken)) return "csrf_mismatch";

  await deps.uow.run(async (uow) => {
    await deps.sessions.delete(uow, session.id);
    await deps.audit.record(
      uow,
      {
        action: "sign_out",
        actorEmail: session.email,
        targetId: session.id,
        ip: input.meta.ip,
      },
      now,
    );
  });
  return "signed_out";
}
