import type { IdentityDeps } from "./deps";

/**
 * Deletes every session of an address (the runbook step for someone who leaves) and
 * audits `sessions_revoked` with the operator as actor and only the count as detail.
 * The revoked address is never written to the audit log.
 * See specs/use-cases/sign-in.md, "Rules".
 */
export async function revokeSessionsForEmail(
  deps: IdentityDeps,
  input: { email: string; actorEmail: string | null },
): Promise<number> {
  const email = input.email.trim().toLowerCase();
  const now = deps.clock.now();
  return deps.uow.run(async (uow) => {
    const count = await deps.sessions.deleteAllForEmail(uow, email);
    await deps.audit.record(
      uow,
      {
        action: "sessions_revoked",
        actorEmail: input.actorEmail,
        targetId: null,
        ip: null,
        details: { count },
      },
      now,
    );
    return count;
  });
}
