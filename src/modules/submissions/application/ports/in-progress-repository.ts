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
  /**
   * Locks the record `for update` when it exists and `expiresAt <= now`, without
   * reading its contents, so a row that no longer parses can still be removed.
   * False for an unknown, unexpired or non-UUID id.
   */
  lockExpired(uow: UnitOfWork, id: string, now: Date): Promise<boolean>;
  /**
   * The ids among `recordIds` whose staged files something still needs: an
   * in-progress row with that id, or a media row whose staging copy lies under
   * the record's prefix (a submitted file `media.upload` has not moved, or one
   * that failed). Read in one statement, so a Submit committing meanwhile is
   * seen either as the row or as its media rows.
   */
  claimedStaging(recordIds: readonly string[]): Promise<Set<string>>;
  /** Ids of records with `expiresAt <= now`, oldest first, at most `limit`. */
  listExpired(now: Date, limit: number): Promise<string[]>;
}
