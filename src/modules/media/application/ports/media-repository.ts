import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { MediaRecord } from "../../domain/media";

export interface MediaRepository {
  insert(uow: UnitOfWork, record: MediaRecord): Promise<void>;
  findById(id: string): Promise<MediaRecord | null>;
  /** Ordered by field key, then position. */
  listBySubmission(submissionId: string): Promise<MediaRecord[]>;
  markStored(uow: UnitOfWork, id: string, providerRef: string, at: Date): Promise<void>;
  clearStaging(uow: UnitOfWork, id: string, at: Date): Promise<void>;
  markFailed(uow: UnitOfWork, id: string, at: Date): Promise<void>;
  delete(uow: UnitOfWork, id: string): Promise<void>;
}
