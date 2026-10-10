/** Identity's own audit actions. Other modules add their own. */
export const auditActions = [
  "sign_in",
  "sign_in_rejected",
  "sign_out",
  "session_expired",
  "sessions_revoked",
] as const;

/** Open on purpose: other modules register their own actions. */
export type AuditAction = (typeof auditActions)[number] | (string & {});

export interface AuditEntry {
  action: AuditAction;
  actorEmail: string | null;
  targetId: string | null;
  ip: string | null;
  details?: Record<string, string | number | boolean>;
}

/**
 * Throws when any string detail contains "@", so addresses never reach the audit log.
 * See specs/use-cases/sign-in.md, "Audit entries".
 */
export function assertNoPersonalData(details: AuditEntry["details"]): void {
  if (details === undefined) return;
  for (const value of Object.values(details)) {
    if (typeof value === "string" && value.includes("@")) {
      throw new Error("Audit details must not contain personal data such as an email address");
    }
  }
}
