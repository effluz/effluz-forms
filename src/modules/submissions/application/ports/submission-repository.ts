import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { Submission } from "../../domain/submission";

/** Where received submissions live. See specs/form-definition.md, "Submissions". */
export interface SubmissionRepository {
  /** "duplicate_token" when a submission with the same submit token exists; never aborts the transaction. */
  insert(uow: UnitOfWork, submission: Submission): Promise<"inserted" | "duplicate_token">;
  findBySubmitToken(token: string): Promise<Submission | null>;
  findById(id: string): Promise<Submission | null>;
}
