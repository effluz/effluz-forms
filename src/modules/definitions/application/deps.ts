import type { AuditLog, AuditLogReader } from "@/modules/identity/application";
import type { Clock } from "@/shared/application/ports/clock";
import type { IdGenerator } from "@/shared/application/ports/id-generator";
import type { UnitOfWorkFactory } from "@/shared/application/ports/unit-of-work";
import type { FieldTypeRegistry } from "@/shared/domain/form-model";
import type { DraftRepository } from "./ports/draft-repository";
import type { FormRepository } from "./ports/form-repository";
import type { SubmissionStats } from "./ports/submission-stats";
import type { VersionRepository } from "./ports/version-repository";

/** Everything the definitions use cases need, wired at the composition root. */
export interface DefinitionsDeps {
  forms: FormRepository;
  drafts: DraftRepository;
  versions: VersionRepository;
  stats: SubmissionStats;
  audit: AuditLog;
  auditReader: AuditLogReader;
  uow: UnitOfWorkFactory;
  clock: Clock;
  ids: IdGenerator;
  registry: FieldTypeRegistry;
  /** Domains notification recipients may use; the Workspace hosted domain first. */
  allowedRecipientDomains: readonly string[];
  /** Public origin without a trailing slash, for example `https://forms.example.com`. */
  publicBaseUrl: string;
}

/** The signed-in staff member acting, with the request IP the audit log records. */
export interface Actor {
  email: string;
  ip: string | null;
}

/** The public link of a form. See specs/ui-ux/manager.md, "Form overview". */
export function publicUrl(deps: Pick<DefinitionsDeps, "publicBaseUrl">, slug: string): string {
  return `${deps.publicBaseUrl}/f/${slug}`;
}
