import type { AuditEntry } from "../domain/audit";
import type { Session } from "../domain/session";
import { admit } from "../domain/staff-identity";
import { callbackRedirectUri, type IdentityDeps, type RequestMeta } from "./deps";
import { sanitizeReturnTo } from "./start-sign-in";

export type CompleteSignInResult =
  | { outcome: "signed_in"; session: Session; returnTo: string }
  /** Admission refused; `sign_in_rejected` was audited. */
  | { outcome: "denied" }
  /** Attempt missing or expired, or state mismatch: the route restarts once. */
  | { outcome: "retry" }
  /** Code exchange failed or the token was invalid. */
  | { outcome: "error" };

/**
 * Finishes sign-in: consumes the attempt (single use), completes with the provider,
 * applies the admission policy and, in one unit of work, creates a fresh session,
 * removes the browser's previous session if it still exists (not audited) and
 * audits `sign_in`. See specs/use-cases/sign-in.md and
 * specs/system/security.md, "Admin authentication" and "Sessions".
 */
export async function completeSignIn(
  deps: IdentityDeps,
  input: {
    attemptId: string | null;
    /** The session cookie the callback request carried, if any; it is replaced. */
    previousSessionId?: string | null;
    callbackUrl: string;
    meta: RequestMeta;
  },
): Promise<CompleteSignInResult> {
  if (input.attemptId === null) return { outcome: "retry" };
  const attempt = await deps.attempts.consume(input.attemptId, deps.clock.now());
  if (attempt === null) return { outcome: "retry" };

  const completion = await deps.identity.completeSignIn(
    { url: input.callbackUrl },
    {
      state: attempt.state,
      nonce: attempt.nonce,
      codeVerifier: attempt.codeVerifier,
      redirectUri: callbackRedirectUri(deps),
    },
  );
  if (!completion.ok) {
    return completion.reason === "state_mismatch" || completion.reason === "stale"
      ? { outcome: "retry" }
      : { outcome: "error" };
  }

  const admission = admit(completion.claims, deps.allowedHostedDomain);
  const now = deps.clock.now();

  if (!admission.admitted) {
    const entry: AuditEntry = {
      action: "sign_in_rejected",
      actorEmail: null,
      targetId: null,
      ip: input.meta.ip,
      ...(admission.attemptedDomain !== null
        ? { details: { domain: admission.attemptedDomain } }
        : {}),
    };
    await deps.uow.run((uow) => deps.audit.record(uow, entry, now));
    return { outcome: "denied" };
  }

  const session: Session = {
    id: deps.ids.newId(),
    email: admission.identity.email,
    name: admission.identity.name,
    csrfToken: deps.ids.newId(),
    createdAt: now,
    lastSeenAt: now,
  };
  const previousSessionId = input.previousSessionId ?? null;
  await deps.uow.run(async (uow) => {
    if (previousSessionId !== null) await deps.sessions.delete(uow, previousSessionId);
    await deps.sessions.create(uow, session);
    await deps.audit.record(
      uow,
      {
        action: "sign_in",
        actorEmail: session.email,
        targetId: session.id,
        ip: input.meta.ip,
      },
      now,
    );
  });
  return { outcome: "signed_in", session, returnTo: sanitizeReturnTo(attempt.returnTo) };
}
