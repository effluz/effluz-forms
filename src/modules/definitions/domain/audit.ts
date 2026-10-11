/** Audit actions written by the definitions module. See specs/use-cases/. */
export const definitionsAuditActions = [
  "form_created",
  "draft_saved",
  "draft_language_mode_changed",
  "form_published",
  "form_closed",
  "form_reopened",
  "form_archived",
  "form_unarchived",
  "form_deleted",
  "form_settings_changed",
  "retention_shortened",
] as const;
export type DefinitionsAuditAction = (typeof definitionsAuditActions)[number];
