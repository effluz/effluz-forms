import { discardStaged, stageFile } from "@/modules/media/application";
import {
  asKey,
  LIMITS,
  type FieldTypeRegistry,
  type UploadLimits,
  type ValidationIssue,
  type Version,
} from "@/shared/domain/form-model";
import {
  stagedBytes,
  type InProgress,
  type RefusedFile,
  type StagedUpload,
} from "../domain/in-progress";
import { uploadFields } from "../domain/intake";
import { pageInputKeys } from "./answers";
import type { SubmissionsDeps } from "./deps";
import type { IncomingFile } from "./fill-state";

const BYTES_PER_MB = 1024 * 1024;

/** The most one submission may stage across every field (specs/system/security.md, "Upload limits"). */
export const SUBMISSION_BYTES = LIMITS.submissionSizeMb * BYTES_PER_MB;

/** The per-file limit: the field's own, never above the system maximum. */
export const fileMaxBytes = (limits: UploadLimits): number =>
  Math.min(limits.maxSizeMb, LIMITS.fileSizeMb) * BYTES_PER_MB;

/** What staging one post's files produced, before any record is touched. */
export interface StagedBatch {
  added: Record<string, StagedUpload[]>;
  refused: RefusedFile[];
  countIssues: ValidationIssue[];
  /** Every staging reference this batch wrote, for cleanup. */
  refs: string[];
  /** The browser's name of each staged file by staging reference; in memory only, for reports. */
  names: Record<string, string>;
}

const filesMax = (fieldKey: string, n: number): ValidationIssue => ({
  code: "files_max",
  field: asKey(fieldKey),
  params: { n },
});

const errorClass = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : typeof error;

/**
 * Stages the files of one page post, outside any transaction, under the
 * record's prefix. A field asked for more files than it has room for stages
 * none of them and reports one count issue. A refusal is a validation
 * outcome, not an error; a storage failure becomes `upload_failed`.
 * See specs/system/media-storage.md, "File handling rules".
 */
export async function stageIncoming(
  deps: SubmissionsDeps,
  input: {
    recordId: string;
    version: Version;
    pageKey: string;
    existing: Readonly<Record<string, readonly StagedUpload[]>>;
    incoming: readonly IncomingFile[];
  },
): Promise<StagedBatch> {
  const batch: StagedBatch = { added: {}, refused: [], countIssues: [], refs: [], names: {} };
  const onPage = new Set(pageInputKeys(input.version, deps.registry, input.pageKey).uploads);
  let total = stagedBytes(input.existing);

  for (const { field, limits } of uploadFields(input.version, deps.registry)) {
    if (!onPage.has(field.key)) continue;
    // A browser sends an empty, nameless part when no file was chosen.
    const files = input.incoming.filter(
      (f) => f.fieldKey === field.key && !(f.bytes.length === 0 && f.name === ""),
    );
    if (files.length === 0) continue;
    const room = limits.maxFiles - (input.existing[field.key]?.length ?? 0);
    if (files.length > room) {
      batch.countIssues.push(filesMax(field.key, limits.maxFiles));
      continue;
    }
    for (const file of files) {
      if (total + file.bytes.length > SUBMISSION_BYTES) {
        batch.refused.push({ fieldKey: field.key, code: "submission_too_large", name: file.name });
        continue;
      }
      try {
        const result = await stageFile(deps.media, {
          recordId: input.recordId,
          bytes: file.bytes,
          accept: limits.kinds,
          maxBytes: fileMaxBytes(limits),
        });
        if (!result.ok) {
          batch.refused.push({ fieldKey: field.key, code: result.code, name: file.name });
          continue;
        }
        (batch.added[field.key] ??= []).push(result.file);
        batch.refs.push(result.file.stagingRef);
        batch.names[result.file.stagingRef] = file.name;
        total += result.file.size;
      } catch (error) {
        deps.logger.warn("file staging failed", {
          recordId: input.recordId,
          errorClass: errorClass(error),
        });
        batch.refused.push({ fieldKey: field.key, code: "upload_failed", name: file.name });
      }
    }
  }
  return batch;
}

/**
 * Adds a batch to the locked record, field by field. The record may have
 * gained files since the batch was staged (an early upload from script); a
 * field the batch would push past its limit keeps its files, and the batch's
 * files for it come back as `overflow` references with a count issue. A field
 * whose files would take the record past `SUBMISSION_BYTES` overflows too, but
 * as `oversize` (also listed in `overflow`), with no count issue.
 */
export function mergeBatch(
  record: InProgress,
  batch: StagedBatch,
  version: Version,
  registry: FieldTypeRegistry,
): {
  record: InProgress;
  overflow: string[];
  issues: ValidationIssue[];
  oversize: { fieldKey: string; stagingRef: string }[];
} {
  const limits = new Map<string, UploadLimits>(
    uploadFields(version, registry).map((u) => [u.field.key, u.limits]),
  );
  const files: Record<string, StagedUpload[]> = { ...record.files };
  const overflow: string[] = [];
  const issues: ValidationIssue[] = [...batch.countIssues];
  const oversize: { fieldKey: string; stagingRef: string }[] = [];
  let total = stagedBytes(files);
  for (const [fieldKey, added] of Object.entries(batch.added)) {
    const existing = files[fieldKey] ?? [];
    const max = limits.get(fieldKey)?.maxFiles ?? 0;
    if (existing.length + added.length > max) {
      overflow.push(...added.map((u) => u.stagingRef));
      issues.push(filesMax(fieldKey, max));
      continue;
    }
    const addedBytes = stagedBytes({ [fieldKey]: added });
    if (total + addedBytes > SUBMISSION_BYTES) {
      for (const u of added) {
        overflow.push(u.stagingRef);
        oversize.push({ fieldKey, stagingRef: u.stagingRef });
      }
      continue;
    }
    total += addedBytes;
    files[fieldKey] = [...existing, ...added];
  }
  return { record: { ...record, files }, overflow, issues, oversize };
}

/**
 * Removes staged files after the fact. A failure only logs: the record's
 * prefix delete at expiry catches what is left.
 */
export async function discardQuietly(
  deps: SubmissionsDeps,
  refs: readonly string[],
): Promise<void> {
  if (refs.length === 0) return;
  try {
    await discardStaged(deps.media, refs);
  } catch (error) {
    deps.logger.warn("staged files not removed", {
      count: refs.length,
      errorClass: errorClass(error),
    });
  }
}
