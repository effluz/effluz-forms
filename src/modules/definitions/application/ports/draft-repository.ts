import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { Draft } from "../../domain/draft";

export interface DraftRepository {
  insert(uow: UnitOfWork, draft: Draft): Promise<void>;
  /** Read path, no unit of work. */
  find(formId: string): Promise<Draft | null>;
  /**
   * Writes the draft when the stored revision equals `expectedRevision` and
   * bumps it to `expectedRevision + 1`; `stale` changes nothing.
   */
  save(uow: UnitOfWork, draft: Draft, expectedRevision: number): Promise<"saved" | "stale">;
  /** After a publish: stores the new document and bumps the revision, with no expectation. */
  replace(uow: UnitOfWork, draft: Draft): Promise<void>;
}
