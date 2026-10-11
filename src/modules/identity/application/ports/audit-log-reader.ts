/** One stored audit entry, as read back. */
export interface AuditRecord {
  id: string;
  action: string;
  actorEmail: string | null;
  targetId: string | null;
  ip: string | null;
  details: Record<string, string | number | boolean> | null;
  at: Date;
}

export interface AuditQuery {
  targetId: string;
  action?: string;
  actorEmail?: string;
  /**
   * Paging cursor. With `before` alone, only entries strictly older than that
   * instant. With `before` and `beforeId` together the cursor is the pair
   * `(createdAt, id)`: only entries that sort after that row in the listing
   * order, so rows sharing the instant of the last row shown are not skipped.
   * `beforeId` without `before` is ignored.
   */
  before?: Date;
  beforeId?: string;
  limit: number;
}

/** Hard ceiling on one page, whatever the caller asks for. */
export const AUDIT_PAGE_MAX = 200;

/**
 * Read side of the audit log. Owned by identity and exported for other modules'
 * activity views; see specs/system/security.md, "Audit log".
 */
export interface AuditLogReader {
  /** Newest first, at most `min(limit, 200)` entries. */
  listByTarget(query: AuditQuery): Promise<AuditRecord[]>;
  /** Distinct actor addresses that touched the target, sorted, for filter menus. */
  actorsForTarget(targetId: string): Promise<string[]>;
}
