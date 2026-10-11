import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { Draft } from "../../domain/draft";

export interface DraftRepository {
  insert(uow: UnitOfWork, draft: Draft): Promise<void>;
  /** Read path, no unit of work: for display and early refusals only. */
  find(formId: string): Promise<Draft | null>;
  /**
   * Reads the draft inside the unit of work and locks its row until the unit
   * of work ends; null for a missing draft or a malformed id.
   * See specs/system/database.md, "The `UnitOfWork` port".
   */
  findForUpdate(uow: UnitOfWork, formId: string): Promise<Draft | null>;
  /**
   * Writes the draft when the stored revision equals `expectedRevision` and
   * bumps it to `expectedRevision + 1`; `stale` changes nothing.
   */
  save(uow: UnitOfWork, draft: Draft, expectedRevision: number): Promise<"saved" | "stale">;
}
