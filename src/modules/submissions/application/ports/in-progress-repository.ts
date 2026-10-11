import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { InProgress } from "../../domain/in-progress";

/**
 * Where in-progress fills live. A row holds personal data: it is never logged
 * and is gone at submit or after 24 hours.
 * See specs/use-cases/fill-and-submit-form.md, "Alternate flows and errors".
 */
export interface InProgressRepository {
  insert(uow: UnitOfWork, record: InProgress): Promise<void>;
  /** Null for an unknown id and for a non-UUID id. */
  find(id: string): Promise<InProgress | null>;
  findForUpdate(uow: UnitOfWork, id: string): Promise<InProgress | null>;
  update(uow: UnitOfWork, record: InProgress): Promise<void>;
  delete(uow: UnitOfWork, id: string): Promise<void>;
  /** Ids of records with `expiresAt <= now`, oldest first, at most `limit`. */
  listExpired(now: Date, limit: number): Promise<string[]>;
}
