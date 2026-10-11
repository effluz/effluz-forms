import type { Pool } from "pg";
import {
  AUDIT_PAGE_MAX,
  type AuditLogReader,
  type AuditQuery,
  type AuditRecord,
} from "../application/ports/audit-log-reader";
import { isUuid } from "@/shared/infrastructure/uuid";

interface Row {
  id: string;
  action: string;
  actor_email: string | null;
  target_id: string | null;
  ip: string | null;
  details: Record<string, string | number | boolean> | null;
  created_at: Date;
}

/** Postgres adapter for reading the audit log; see specs/system/security.md, "Audit log". */
export class PgAuditLogReader implements AuditLogReader {
  constructor(private readonly pool: Pool) {}

  async listByTarget(query: AuditQuery): Promise<AuditRecord[]> {
    // A hand-edited activity URL can carry NaN, a negative limit, a bad cursor
    // id or an invalid date: an unusable limit is an empty page, an unusable
    // cursor is no cursor (specs/system/security.md, "Audit log", "Reading").
    if (!Number.isFinite(query.limit) || query.limit <= 0) return [];
    const limit = Math.min(Math.floor(query.limit), AUDIT_PAGE_MAX);
    if (limit === 0) return [];
    const params: unknown[] = [query.targetId];
    const where = ["target_id = $1"];
    if (query.action !== undefined) {
      params.push(query.action);
      where.push(`action = $${String(params.length)}`);
    }
    if (query.actorEmail !== undefined) {
      params.push(query.actorEmail);
      where.push(`actor_email = $${String(params.length)}`);
    }
    if (query.before !== undefined && !Number.isNaN(query.before.getTime())) {
      params.push(query.before);
      const at = `$${String(params.length)}`;
      if (query.beforeId === undefined || !isUuid(query.beforeId)) {
        where.push(`created_at < ${at}`);
      } else {
        params.push(query.beforeId);
        where.push(`(created_at, id) < (${at}, $${String(params.length)}::uuid)`);
      }
    }
    params.push(limit);
    const { rows } = await this.pool.query<Row>(
      `select id, action, actor_email, target_id, ip, details, created_at
         from audit_log
        where ${where.join(" and ")}
        order by created_at desc, id desc
        limit $${String(params.length)}`,
      params,
    );
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      actorEmail: row.actor_email,
      targetId: row.target_id,
      ip: row.ip,
      details: row.details,
      at: row.created_at,
    }));
  }

  async actorsForTarget(targetId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ actor_email: string }>(
      `select distinct actor_email
         from audit_log
        where target_id = $1 and actor_email is not null
        order by actor_email`,
      [targetId],
    );
    return rows.map((row) => row.actor_email);
  }
}
