/** Public API of the identity module. Other modules and the app import only this. */
export type { StaffIdentity } from "../domain/staff-identity";
export type { Session } from "../domain/session";
export type { AuditEntry, AuditAction } from "../domain/audit";
export type { IdentityDeps, RequestMeta } from "./deps";
export type { CurrentSession } from "./current-session";
export type { CompleteSignInResult } from "./complete-sign-in";
export type { AdminIdentity } from "./ports/admin-identity";
export type { SessionRepository } from "./ports/session-repository";
export type { AuditLog } from "./ports/audit-log";
export type { SignInAttemptStore } from "./ports/sign-in-attempt-store";

export { startSignIn, sanitizeReturnTo } from "./start-sign-in";
export { completeSignIn } from "./complete-sign-in";
export { currentSession } from "./current-session";
export { signOut } from "./sign-out";
export { revokeSessionsForEmail } from "./revoke-sessions";
export { auditActions, assertNoPersonalData } from "../domain/audit";
export { IDLE_HOURS, ABSOLUTE_DAYS, sessionCookieMaxAgeSeconds } from "../domain/session";
