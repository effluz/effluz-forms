import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { Submission } from "../../domain/submission";

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
}
