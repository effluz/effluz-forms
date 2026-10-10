import type { Clock } from "@/shared/application/ports/clock";
import type { IdGenerator } from "@/shared/application/ports/id-generator";
import type { UnitOfWorkFactory } from "@/shared/application/ports/unit-of-work";
import type { AdminIdentity } from "./ports/admin-identity";
import type { AuditLog } from "./ports/audit-log";
import type { SessionRepository } from "./ports/session-repository";
import type { SignInAttemptStore } from "./ports/sign-in-attempt-store";

/** Everything the identity use cases need, wired at the composition root. */
export interface IdentityDeps {
  identity: AdminIdentity;
  sessions: SessionRepository;
  audit: AuditLog;
  attempts: SignInAttemptStore;
  uow: UnitOfWorkFactory;
  clock: Clock;
  ids: IdGenerator;
  /** The Workspace domain the hosted-domain claim must equal, for example `effluz.com`. */
  allowedHostedDomain: string;
  /** Public origin without a trailing slash; the OIDC callback is `${publicBaseUrl}/admin/auth/callback`. */
  publicBaseUrl: string;
}

/** Request facts the use cases may audit. Never carries personal data beyond the IP. */
export interface RequestMeta {
  ip: string | null;
}

/** The OIDC redirect URI; start and completion must pass the identical value. */
export function callbackRedirectUri(deps: Pick<IdentityDeps, "publicBaseUrl">): string {
  return `${deps.publicBaseUrl}/admin/auth/callback`;
}
