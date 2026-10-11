import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { InProgress } from "../../domain/in-progress";

/** Storage for in-progress records. See specs/system/database.md, "Submissions". */
export interface InProgressRepository {
  insert(uow: UnitOfWork, record: InProgress): Promise<void>;
  /** Null for an unknown id and for a non-UUID id. */
  find(id: string): Promise<InProgress | null>;
  /** Locks the row for the unit of work, serializing concurrent posts and the submit. */
  findForUpdate(uow: UnitOfWork, id: string): Promise<InProgress | null>;
  /** Writes the mutable parts only: locale, page, answers, files and pending page. */
  update(uow: UnitOfWork, record: InProgress): Promise<void>;
  delete(uow: UnitOfWork, id: string): Promise<void>;
  /** Ids of records past their expiry at `now`, oldest expiry first. */
  listExpired(now: Date, limit: number): Promise<string[]>;
}
