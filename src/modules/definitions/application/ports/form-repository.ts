import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { Form } from "../../domain/form";

/** The manager's tabs: active is draft and published. See specs/ui-ux/manager.md. */
export type FormTab = "active" | "closed" | "archived";

export interface FormRepository {
  /** `slug_taken` when another form already uses the slug. */
  insert(uow: UnitOfWork, form: Form): Promise<"inserted" | "slug_taken">;
  /** Writes the full row by id; `slug_taken` when the slug belongs to another form. */
  update(uow: UnitOfWork, form: Form): Promise<"updated" | "slug_taken">;
  delete(uow: UnitOfWork, id: string): Promise<void>;
  /** Read path, no unit of work: for display and early refusals only. */
  findById(id: string): Promise<Form | null>;
  /**
   * Reads the form inside the unit of work and locks its row until the unit
   * of work ends; null for a missing form or a malformed id.
   * See specs/system/database.md, "The `UnitOfWork` port".
   */
  findForUpdate(uow: UnitOfWork, id: string): Promise<Form | null>;
  findBySlug(slug: string): Promise<Form | null>;
  /**
   * Takes the form's next reference number and advances the counter; the
   * caller holds the form row lock. Never touches updated_at. Throws for a
   * missing form.
   */
  takeReferenceNumber(uow: UnitOfWork, formId: string): Promise<number>;
  /**
   * Forms of one tab, ordered by title (English, then Spanish) and slug. The
   * search matches the slug or either title, case-insensitively.
   */
  list(tab: FormTab, search?: string): Promise<Form[]>;
  counts(): Promise<Record<FormTab, number>>;
  /** Records that the person opened the form at `at`; the later call wins. */
  markOpened(uow: UnitOfWork, formId: string, email: string, at: Date): Promise<void>;
  lastOpened(email: string, formIds: string[]): Promise<Map<string, Date>>;
}
