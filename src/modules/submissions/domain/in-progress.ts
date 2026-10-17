import type { ValidationIssue } from "@/shared/domain/form-model";
import type { Locale } from "@/shared/domain/localized-text";

/** In-progress records live 24 hours (`specs/use-cases/fill-and-submit-form.md`, "Alternate flows and errors"). */
export const IN_PROGRESS_TTL_MS = 86_400_000;

/** The raw form values of one page post, by input name. */
export type RawValues = Record<string, string | string[]>;

export type FileIssueCode =
  | "file_too_large"
  | "file_wrong_type"
  | "file_unreadable"
  | "upload_failed"
  | "submission_too_large";

/** A refused file of a page post: the browser's name, carried only to the page the post redirects to, in the `effluz_fill_state` cookie (Task 28); never stored. */
export interface RefusedFile {
  fieldKey: string;
  code: FileIssueCode;
  name: string;
}

/** The last refused post of a page: what was typed and why it was refused. No file is named. */
export interface PendingPage {
  pageKey: string;
  raw: RawValues;
  issues: ValidationIssue[];
}

/** Structural twin of media's StagedFile; a domain may not import another module. */
export interface StagedUpload {
  id: string;
  stagingRef: string;
  kind: "image" | "video";
  contentType: string;
  size: number;
}

export interface InProgress {
  id: string;
  formId: string;
  versionId: string;
  locale: Locale;
  pageKey: string;
  /** Valid, normalized answers; never file fields. */
  answers: Record<string, unknown>;
  /** Staged uploads by field key, in upload order. */
  files: Record<string, StagedUpload[]>;
  pending: PendingPage | null;
  submitToken: string;
  startedAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** A fresh record with nothing answered, expiring `IN_PROGRESS_TTL_MS` after `now`. */
export function newInProgress(input: {
  id: string;
  formId: string;
  versionId: string;
  locale: Locale;
  pageKey: string;
  submitToken: string;
  startedAt: Date;
  now: Date;
}): InProgress {
  const { now, ...rest } = input;
  return {
    ...rest,
    answers: {},
    files: {},
    pending: null,
    expiresAt: new Date(now.getTime() + IN_PROGRESS_TTL_MS),
    createdAt: now,
    updatedAt: now,
  };
}

export function isExpired(record: Pick<InProgress, "expiresAt">, now: Date): boolean {
  return now.getTime() >= record.expiresAt.getTime();
}

/**
 * The `started_at` of a record from the first post's `_rendered` value
 * (`specs/system/security.md`, "Public form abuse protection").
 */
export function clampStartedAt(renderedAt: Date | null, now: Date): Date {
  const nowMs = now.getTime();
  if (renderedAt === null || Number.isNaN(renderedAt.getTime())) return new Date(nowMs);
  const clamped = Math.min(nowMs, Math.max(nowMs - IN_PROGRESS_TTL_MS, renderedAt.getTime()));
  return new Date(clamped);
}

/** The answers with every upload field set to its staged ids, in upload order. */
export function withFileAnswers(
  answers: Readonly<Record<string, unknown>>,
  files: Readonly<Record<string, readonly StagedUpload[]>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...answers };
  for (const [fieldKey, uploads] of Object.entries(files))
    result[fieldKey] = uploads.map((u) => u.id);
  return result;
}

export function removeUpload(
  files: Readonly<Record<string, readonly StagedUpload[]>>,
  fileId: string,
): { files: Record<string, StagedUpload[]>; removed: StagedUpload | null } {
  let removed: StagedUpload | null = null;
  const left: Record<string, StagedUpload[]> = {};
  for (const [fieldKey, uploads] of Object.entries(files)) {
    left[fieldKey] = uploads.filter((u) => {
      if (u.id !== fileId) return true;
      removed ??= u;
      return false;
    });
  }
  return { files: left, removed };
}

/** The sum of the staged sizes across every field. */
export function stagedBytes(files: Readonly<Record<string, readonly StagedUpload[]>>): number {
  let total = 0;
  for (const uploads of Object.values(files)) for (const u of uploads) total += u.size;
  return total;
}
