import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";

/** One staff correction of a field's text. The sender's `answers` never change. */
export interface EditRow {
  id: string;
  submissionId: string;
  fieldKey: string;
  text: string;
  source: "manual";
  editor: string;
  createdAt: Date;
}

/** The edit history. Append-only: the database refuses any update. */
export interface EditRepository {
  append(uow: UnitOfWork, row: EditRow): Promise<void>;
  /** The newest edit per field key. */
  latestByField(submissionId: string): Promise<Map<string, EditRow>>;
}
