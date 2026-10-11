import type { Key } from "./keys";

export const validationCodes = [
  "required",
  "min_length",
  "max_length",
  "pattern",
  "email_syntax",
  "number_min",
  "number_max",
  "integer",
  "not_a_number",
  "date_invalid",
  "date_min",
  "date_max",
  "date_not_future",
  "choice_min",
  "choice_max",
  "must_be_true",
  "consent",
  "files_min",
  "files_max",
  "invalid_shape",
  "unknown_option",
] as const;
export type ValidationCode = (typeof validationCodes)[number];

export type IssueParams = Record<string, string | number>;

export interface ValidationIssue {
  code: ValidationCode;
  field: Key;
  params?: IssueParams;
}

export const publishCodes = [
  "no_input",
  "unlabeled",
  "missing_translation",
  "option_unlabeled",
  "consent_missing",
  "consent_checklist",
  "retention_missing",
  "confirmation_missing",
  "dangling_condition",
  "over_maximum",
  "submitter_email_dup",
  "header_alt_missing",
] as const;
export type PublishCode = (typeof publishCodes)[number];

export interface PublishIssue {
  code: PublishCode;
  /** JSON-pointer-like path into the version, e.g. "pages/1/fields/3/label" */
  path: string;
  params?: IssueParams;
}
