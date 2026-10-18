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

export const CURATION_STATUSES = ["new", "viewed", "edited", "published"] as const;
export type CurationStatus = (typeof CURATION_STATUSES)[number];

/**
 * What staff did with a submission after it arrived. Kept beside the answers,
 * never in them (specs/use-cases/review-submissions.md).
 */
export interface Curation {
  status: CurationStatus;
  /** Corrected text per field key; text fields only. */
  curatedAnswers: Record<string, string>;
  publishedPostUrl: string | null;
  statusChangedBy: string | null;
  statusChangedAt: Date | null;
}

/** A submission together with its curation, as review reads it. */
export interface StoredSubmission extends Submission {
  curation: Curation;
}
