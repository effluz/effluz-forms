import type { Version } from "@/shared/domain/form-model";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";

/** A published, immutable version of a form. See specs/form-definition.md, "Concepts". */
export interface FormVersion {
  id: string;
  formId: string;
  number: number;
  document: Version;
  publishedAt: Date;
  publishedBy: string | null;
}

export interface VersionRepository {
  /** `number_taken` when the form already has a version with that number. */
  insert(uow: UnitOfWork, version: FormVersion): Promise<"inserted" | "number_taken">;
  findById(id: string): Promise<FormVersion | null>;
  /** The version the form's current_version_id points at. */
  findCurrent(formId: string): Promise<FormVersion | null>;
  /** Every version of the form, oldest first; empty for an unknown or malformed id. */
  listByForm(formId: string): Promise<FormVersion[]>;
  /** The highest number published for the form, 0 when none. */
  latestNumber(formId: string): Promise<number>;
}
