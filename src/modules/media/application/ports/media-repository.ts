import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { MediaRecord } from "../../domain/media";

export interface MediaRepository {
  insert(uow: UnitOfWork, record: MediaRecord): Promise<void>;
  findById(id: string): Promise<MediaRecord | null>;
  /**
   * Ordered by field key, then position. Reads on the unit of work's connection when given one, so a
   * delete and a staff upload holding the submission row lock see the same rows.
   */
  listBySubmission(submissionId: string, uow?: UnitOfWork): Promise<MediaRecord[]>;
  /** Answers whether a row was updated; false means the row is gone. */
  markStored(uow: UnitOfWork, id: string, providerRef: string, at: Date): Promise<boolean>;
  clearStaging(uow: UnitOfWork, id: string, at: Date): Promise<void>;
  markFailed(uow: UnitOfWork, id: string, at: Date): Promise<void>;
  delete(uow: UnitOfWork, id: string): Promise<void>;
}
