import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { Curation, StoredSubmission, Submission } from "../../domain/submission";

/** Where received submissions live. See specs/form-definition.md, "Submissions". */
export interface SubmissionRepository {
  /** "duplicate_token" when a submission with the same submit token exists; never aborts the transaction. */
  insert(uow: UnitOfWork, submission: Submission): Promise<"inserted" | "duplicate_token">;
  /**
   * With `uow`, reads on the unit of work's connection: a use case holding row
   * locks never borrows a second connection (specs/system/database.md).
   */
  findBySubmitToken(token: string, uow?: UnitOfWork): Promise<Submission | null>;
  findById(id: string): Promise<Submission | null>;
  findStored(id: string): Promise<StoredSubmission | null>;
  /** Null for a malformed form id. */
  findByReference(formId: string, reference: string): Promise<StoredSubmission | null>;
  /** Reads the row `for update` on the unit of work's connection. */
  lockForUpdate(uow: UnitOfWork, id: string): Promise<StoredSubmission | null>;
  /** Writes the curation columns only; `answers` is never part of the statement. */
  writeCuration(uow: UnitOfWork, id: string, curation: Curation): Promise<void>;
  /** True when a row was deleted. */
  delete(uow: UnitOfWork, id: string): Promise<boolean>;
}
