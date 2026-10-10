import { randomUUID } from "node:crypto";
import { txOf } from "@/shared/infrastructure/postgres/tx";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { AuditLog } from "../application/ports/audit-log";
import { assertNoPersonalData, type AuditEntry } from "../domain/audit";

/**
 * Postgres adapter for the append-only audit log; see specs/system/security.md,
 * "Audit log". Writes always join the caller's unit of work, so it needs no pool.
 */
export class PgAuditLog implements AuditLog {
  async record(uow: UnitOfWork, entry: AuditEntry, at: Date): Promise<void> {
    assertNoPersonalData(entry.details);
    await txOf(uow).client.query(
      `insert into audit_log (id, action, actor_email, target_id, ip, details, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)`,
      [
        randomUUID(),
        entry.action,
        entry.actorEmail,
        entry.targetId,
        entry.ip,
        entry.details === undefined ? null : JSON.stringify(entry.details),
        at,
      ],
    );
  }
}
