import { stageFile, type StageRefusal } from "@/modules/media/application";
import { evaluateVisibility } from "@/shared/domain/form-model";
import {
  clampStartedAt,
  isExpired,
  newInProgress,
  removeUpload,
  withFileAnswers,
  type InProgress,
} from "../domain/in-progress";
import { uploadFields, visibleStagedBytes } from "../domain/intake";
import { pickLocale } from "../domain/locale";
import { firstPageKey } from "../domain/navigation";
import { pageInputKeys } from "./answers";
import type { SubmissionsDeps } from "./deps";
import type { OpenContext } from "./post-context";
import {
  discardQuietly,
  fileMaxBytes,
  mergeBatch,
  SUBMISSION_BYTES,
  type StagedBatch,
} from "./staging";

export type UploadRefusal =
  StageRefusal | "files_max" | "submission_too_large" | "not_allowed" | "expired";

export type UploadOutcome =
  | {
      ok: true;
      recordId: string;
      file: { id: string; kind: "image" | "video"; size: number };
      count: number;
    }
  | { ok: false; code: UploadRefusal; params?: { n: number } };

const refuse = (code: UploadRefusal, n?: number): UploadOutcome =>
  n === undefined ? { ok: false, code } : { ok: false, code, params: { n } };

/**
 * Stages one file chosen before the page is posted and links it to the
 * in-progress record the cookie names, creating the record on the first page.
 * The field must be a visible upload field of the record's current page; the
 * server decides type and size by content, and the original file name is
 * never kept. See specs/ui-ux/renderer.md, "File upload", and
 * specs/use-cases/fill-and-submit-form.md, step 5.
 */
export async function uploadFile(
  deps: SubmissionsDeps,
  context: OpenContext,
  input: {
    fieldKey: string;
    bytes: Uint8Array;
    renderedAt: Date | null;
    acceptLanguage: string | null;
  },
): Promise<UploadOutcome> {
  const { form, version: pinned, record: existing } = context;
  const doc = pinned.document;
  const now = deps.clock.now();

  const pageKey = existing?.pageKey ?? firstPageKey(doc, deps.registry);
  const target = uploadFields(doc, deps.registry).find((u) => u.field.key === input.fieldKey);
  if (!target || !pageInputKeys(doc, deps.registry, pageKey).uploads.includes(input.fieldKey))
    return refuse("not_allowed");
  const answers = withFileAnswers(existing?.answers ?? {}, existing?.files ?? {});
  if (evaluateVisibility(doc, answers, deps.registry).fields.get(input.fieldKey) !== true)
    return refuse("not_allowed");

  const { limits } = target;
  const held = existing?.files ?? {};
  if ((held[input.fieldKey]?.length ?? 0) >= limits.maxFiles)
    return refuse("files_max", limits.maxFiles);
  const total = visibleStagedBytes(doc, deps.registry, existing?.answers ?? {}, held);
  if (total + input.bytes.length > SUBMISSION_BYTES) return refuse("submission_too_large");

  const recordId = existing?.id ?? deps.ids.newId();
  const staged = await stageFile(deps.media, {
    recordId,
    bytes: input.bytes,
    accept: limits.kinds,
    maxBytes: fileMaxBytes(limits),
  });
  if (!staged.ok) return refuse(staged.code);
  const { file } = staged;
  const batch: StagedBatch = {
    added: { [input.fieldKey]: [file] },
    refused: [],
    countIssues: [],
    refs: [file.stagingRef],
    names: {},
  };

  let outcome: UploadOutcome;
  try {
    outcome = await deps.uow.run(async (uow): Promise<UploadOutcome> => {
      let record: InProgress;
      if (existing) {
        const locked = await deps.inProgress.findForUpdate(uow, existing.id);
        if (!locked || isExpired(locked, now)) return refuse("expired");
        record = locked;
      } else {
        record = newInProgress({
          id: recordId,
          formId: form.id,
          versionId: pinned.id,
          locale: pickLocale(doc.languages, input.acceptLanguage),
          pageKey,
          submitToken: deps.ids.newId(),
          startedAt: clampStartedAt(input.renderedAt, now),
          now,
        });
      }
      // Re-checks the field count and the per-submission size on the locked record.
      const merged = mergeBatch(record, batch, doc, deps.registry);
      if (merged.overflow.length > 0)
        return merged.oversize.length > 0
          ? refuse("submission_too_large")
          : refuse("files_max", limits.maxFiles);
      record = { ...merged.record, updatedAt: now };
      if (existing) await deps.inProgress.update(uow, record);
      else await deps.inProgress.insert(uow, record);
      return {
        ok: true,
        recordId: record.id,
        file: { id: file.id, kind: file.kind, size: file.size },
        count: record.files[input.fieldKey]?.length ?? 0,
      };
    });
  } catch (error) {
    await discardQuietly(deps, batch.refs);
    throw error;
  }
  if (!outcome.ok) await discardQuietly(deps, batch.refs);
  return outcome;
}

/**
 * Removes one staged file of the cookie's record, from the record and from
 * staging. False when there is no record, it expired, or it holds no such
 * file. See specs/ui-ux/renderer.md, "File upload".
 */
export async function removeFile(
  deps: SubmissionsDeps,
  context: OpenContext,
  fileId: string,
): Promise<boolean> {
  const { record: existing } = context;
  if (!existing) return false;
  const now = deps.clock.now();
  const ref = await deps.uow.run(async (uow): Promise<string | null> => {
    const locked = await deps.inProgress.findForUpdate(uow, existing.id);
    if (!locked || isExpired(locked, now)) return null;
    const { files, removed } = removeUpload(locked.files, fileId);
    if (!removed) return null;
    await deps.inProgress.update(uow, { ...locked, files, updatedAt: now });
    return removed.stagingRef;
  });
  if (ref === null) return false;
  await discardQuietly(deps, [ref]);
  return true;
}
