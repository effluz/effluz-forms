import type { AuditQuery, AuditRecord } from "@/modules/identity/application";
import type { DefinitionsDeps } from "./deps";

export interface ActivityFilter {
  action?: string;
  actorEmail?: string;
  /** Only entries strictly older than this instant, for paging. */
  before?: Date;
  limit?: number;
}

export interface FormActivity {
  entries: AuditRecord[];
  /** Everyone who touched the form, for the actor filter. */
  actors: string[];
}

const DEFAULT_LIMIT = 50;

/**
 * The audit log filtered to one form, newest first, with the actors for the
 * filter menu. See specs/ui-ux/manager.md, "Activity tab".
 */
export async function formActivity(
  deps: DefinitionsDeps,
  formId: string,
  filter: ActivityFilter,
): Promise<FormActivity> {
  const query: AuditQuery = {
    targetId: formId,
    ...(filter.action !== undefined ? { action: filter.action } : {}),
    ...(filter.actorEmail !== undefined ? { actorEmail: filter.actorEmail } : {}),
    ...(filter.before !== undefined ? { before: filter.before } : {}),
    limit: filter.limit ?? DEFAULT_LIMIT,
  };
  const [entries, actors] = await Promise.all([
    deps.auditReader.listByTarget(query),
    deps.auditReader.actorsForTarget(formId),
  ]);
  return { entries, actors };
}
