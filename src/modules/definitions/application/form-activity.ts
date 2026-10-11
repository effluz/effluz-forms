import { AUDIT_PAGE_MAX, type AuditQuery, type AuditRecord } from "@/modules/identity/application";
import type { DefinitionsDeps } from "./deps";

export interface ActivityFilter {
  action?: string;
  actorEmail?: string;
  /** Paging cursor: the `at` of the last entry shown. Pair it with `beforeId`. */
  before?: Date;
  /** The id of the last entry shown; with `before` the cursor is `(at, id)`. */
  beforeId?: string;
  /** Entries per page; the use case reads one more to learn whether older ones exist. */
  limit?: number;
}

export interface FormActivity {
  entries: AuditRecord[];
  /** Everyone who touched the form, for the actor filter. */
  actors: string[];
  /** True when entries older than the last one returned exist. */
  hasMore: boolean;
}

const DEFAULT_LIMIT = 50;

/**
 * A whole page size of at least one; a missing or non-finite limit is the
 * default. One row more than the page is read to learn `hasMore`, so the page
 * stays below the reader's cap.
 */
function pageSizeOf(limit: number | undefined): number {
  const requested =
    limit !== undefined && Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_LIMIT;
  return Math.min(Math.max(1, requested), AUDIT_PAGE_MAX - 1);
}

/**
 * The audit log filtered to one form, newest first, with the actors for the
 * filter menu. See specs/ui-ux/manager.md, "Activity tab".
 */
export async function formActivity(
  deps: DefinitionsDeps,
  formId: string,
  filter: ActivityFilter,
): Promise<FormActivity> {
  const pageSize = pageSizeOf(filter.limit);
  const query: AuditQuery = {
    targetId: formId,
    ...(filter.action !== undefined ? { action: filter.action } : {}),
    ...(filter.actorEmail !== undefined ? { actorEmail: filter.actorEmail } : {}),
    ...(filter.before !== undefined ? { before: filter.before } : {}),
    ...(filter.before !== undefined && filter.beforeId !== undefined
      ? { beforeId: filter.beforeId }
      : {}),
    limit: pageSize + 1,
  };
  const [rows, actors] = await Promise.all([
    deps.auditReader.listByTarget(query),
    deps.auditReader.actorsForTarget(formId),
  ]);
  return { entries: rows.slice(0, pageSize), actors, hasMore: rows.length > pageSize };
}
