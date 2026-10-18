import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { StaffPhotoSource } from "../../domain/staff-photos";

/**
 * A photo staff added for a story. `id` is the media row's id; the file itself
 * is a media row under the field key `staff-photos` (ADR 0028).
 */
export interface StaffPhotoRow {
  id: string;
  submissionId: string;
  source: StaffPhotoSource;
  addedBy: string;
  createdAt: Date;
}

export interface StaffPhotoRepository {
  /** Records the photo with `sender_confirmed` true: staff confirmed the sender sent it. */
  insert(uow: UnitOfWork, row: StaffPhotoRow): Promise<void>;
  /** Oldest first; empty for an unknown or non-UUID id. */
  listBySubmission(submissionId: string, uow?: UnitOfWork): Promise<StaffPhotoRow[]>;
  /** False when no row had that id. */
  delete(uow: UnitOfWork, id: string): Promise<boolean>;
}
