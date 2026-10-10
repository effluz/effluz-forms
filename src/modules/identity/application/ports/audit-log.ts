import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { AuditEntry } from "../../domain/audit";

/** Append-only; an entry commits or rolls back with the unit of work that records it. */
export interface AuditLog {
  record(uow: UnitOfWork, entry: AuditEntry, at: Date): Promise<void>;
}
