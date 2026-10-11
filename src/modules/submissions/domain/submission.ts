import type { Locale } from "@/shared/domain/localized-text";

/**
 * A stored submission. Its answers never change after insert
 * (`specs/form-definition.md`, "Submissions").
 */
export interface Submission {
  id: string;
  formId: string;
  versionId: string;
  locale: Locale;
  answers: Record<string, unknown>;
  consent: { fieldKey: string; textVersion: string; acceptedAt: Date } | null;
  receivedAt: Date;
  reference: string;
  submitToken: string;
}
