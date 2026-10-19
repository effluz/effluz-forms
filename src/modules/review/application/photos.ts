import type { Actor } from "@/modules/definitions/application";
import {
  addedFileKey,
  attachToSubmission,
  discardRecordFiles,
  enqueueMediaDelete,
  extensionFor,
  listSubmissionMedia,
  stageFile,
  type MediaRecord,
  type StageRefusal,
  type StagedFile,
} from "@/modules/media/application";
import { lockSubmission } from "@/modules/submissions/application";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { normalizeIds, readiness, withChoice } from "../domain/readiness";
import {
  MAX_STAFF_PHOTOS,
  MAX_STAFF_UPLOAD_FILES,
  STAFF_FILE_MAX_BYTES,
  STAFF_PHOTOS_FIELD_KEY,
  parseSource,
} from "../domain/staff-photos";
import { loadStory } from "./context";
import { withDeadlockRetry } from "./deadlock";
import type { ReviewDeps } from "./deps";
import type { StoryRow } from "./ports/story-repository";

export type AddPhotosRefusal =
  | "not_found"
  | "post_plan_off"
  | "consent_missing"
  | "not_confirmed"
  | "source_invalid"
  | "no_files"
  | "too_many_files"
  | "staff_photos_max";

export type AddPhotosResult =
  | { ok: true; added: number }
  | { ok: false; code: AddPhotosRefusal }
  /** `file` is the 1-based position of the first refused file. */
  | { ok: false; code: "file_refused"; file: number; reason: StageRefusal };

export type RemovePhotoResult = { ok: true } | { ok: false; code: "not_found" };

export type ChoosePhotoResult = { ok: true } | { ok: false; code: "not_found" | "post_plan_off" };

const refuse = (code: AddPhotosRefusal): AddPhotosResult => ({ ok: false, code });

/** Stages every file under one record id; stops at the first refusal. */
async function stageAll(
  deps: ReviewDeps,
  recordId: string,
  files: readonly Uint8Array[],
): Promise<{ ok: true; files: StagedFile[] } | { ok: false; file: number; reason: StageRefusal }> {
  const staged: StagedFile[] = [];
  for (const [index, bytes] of files.entries()) {
    const result = await stageFile(deps.media, {
      recordId,
      bytes,
      accept: ["image", "video"],
      maxBytes: STAFF_FILE_MAX_BYTES,
    });
    if (!result.ok) return { ok: false, file: index + 1, reason: result.code };
    staged.push(result.file);
  }
  return { ok: true, files: staged };
}

/** One past the highest staff position, rows awaiting deletion included, so no position is reused while its row exists. */
function nextStaffPosition(media: readonly MediaRecord[]): number {
  let highest = 0;
  for (const m of media)
    if (m.fieldKey === STAFF_PHOTOS_FIELD_KEY) highest = Math.max(highest, m.position);
  return highest + 1;
}

/**
 * Deletes the record's staged files after a refusal or a failure, keeping that outcome: a
 * storage error here never replaces it, and the staging sweep removes what this misses.
 */
async function discardAfterFailure(deps: ReviewDeps, recordId: string): Promise<void> {
  try {
    await discardRecordFiles(deps.media, recordId);
  } catch {
    // The original error is what the caller needs; an unclaimed prefix is swept later.
  }
}

/**
 * Adds photos or videos the sender sent later (specs/use-cases/review-submissions.md,
 * "Main flow: staff photos"). The files go through the public pipeline (type by content,
 * images re-encoded without metadata, size limits) into staging before the unit of work;
 * any refusal or failure discards them all. The sender's `answers` are never touched.
 */
export async function addStaffPhotos(
  deps: ReviewDeps,
  actor: Actor,
  input: {
    formId: string;
    reference: string;
    files: readonly Uint8Array[];
    source: string;
    senderConfirmed: boolean;
  },
): Promise<AddPhotosResult> {
  const found = await loadStory(deps, input.formId, input.reference);
  if (!found) return refuse("not_found");
  if (!found.ctx.postPlan) return refuse("post_plan_off");
  if (!found.ctx.laterPhotosAllowed) return refuse("consent_missing");
  if (!input.senderConfirmed) return refuse("not_confirmed");
  const source = parseSource(input.source);
  if (source === null) return refuse("source_invalid");
  if (input.files.length === 0) return refuse("no_files");
  if (input.files.length > MAX_STAFF_UPLOAD_FILES) return refuse("too_many_files");
  const id = found.submission.id;
  const existing = await deps.staffPhotos.listBySubmission(id);
  if (existing.length + input.files.length > MAX_STAFF_PHOTOS) return refuse("staff_photos_max");

  const recordId = deps.ids.newId();
  let staged: StagedFile[];
  try {
    const result = await stageAll(deps, recordId, input.files);
    if (!result.ok) {
      await discardAfterFailure(deps, recordId);
      return { ok: false, code: "file_refused", file: result.file, reason: result.reason };
    }
    staged = result.files;
  } catch (error) {
    await discardAfterFailure(deps, recordId);
    throw error;
  }

  let outcome: AddPhotosResult;
  try {
    outcome = await withDeadlockRetry(() =>
      deps.uow.run(async (uow): Promise<AddPhotosResult> => {
        const locked = await lockSubmission(deps.submissions, uow, id);
        if (!locked) return refuse("not_found");
        const current = await deps.staffPhotos.listBySubmission(id, uow);
        if (current.length + staged.length > MAX_STAFF_PHOTOS) return refuse("staff_photos_max");
        const start = nextStaffPosition(await listSubmissionMedia(deps.media, id, uow));
        const now = deps.clock.now();
        await attachToSubmission(deps.media, uow, {
          submissionId: id,
          formId: found.ctx.form.id,
          files: staged.map((file, i) => ({
            fieldKey: STAFF_PHOTOS_FIELD_KEY,
            position: start + i,
            durableKey: addedFileKey({
              formSlug: found.ctx.form.slug,
              reference: locked.reference,
              position: start + i,
              fileId: file.id,
              ext: extensionFor(file.contentType),
            }),
            file,
          })),
        });
        for (const file of staged)
          await deps.staffPhotos.insert(uow, {
            id: file.id,
            submissionId: id,
            source,
            addedBy: actor.email,
            createdAt: now,
          });
        await deps.audit.record(
          uow,
          {
            action: "staff_photos_added",
            actorEmail: actor.email,
            targetId: id,
            ip: actor.ip,
            details: { count: staged.length, source, senderConfirmed: true },
          },
          now,
        );
        return { ok: true, added: staged.length };
      }),
    );
  } catch (error) {
    await discardAfterFailure(deps, recordId);
    throw error;
  }
  if (!outcome.ok) await discardAfterFailure(deps, recordId);
  return outcome;
}

/**
 * Where a media id stands for this story: a sender's file is any media row of the
 * submission outside the staff key; a staff photo needs its `staff_photo` row too
 * (a staff media row without one is awaiting deletion). Null when neither.
 */
async function photoOrigin(
  deps: ReviewDeps,
  uow: UnitOfWork,
  submissionId: string,
  mediaId: string,
): Promise<"sender" | "staff" | null> {
  const media = await listSubmissionMedia(deps.media, submissionId, uow);
  const row = media.find((m) => m.id === mediaId);
  if (!row) return null;
  if (row.fieldKey !== STAFF_PHOTOS_FIELD_KEY) return "sender";
  const staff = await deps.staffPhotos.listBySubmission(submissionId, uow);
  return staff.some((s) => s.id === mediaId) ? "staff" : null;
}

/**
 * Writes the new chosen set, sorted and unique. When the change makes "Photos edited"
 * stop reading as done, records the automatic clear in the same unit of work.
 */
async function writeChoice(
  deps: ReviewDeps,
  uow: UnitOfWork,
  actor: Actor,
  story: StoryRow,
  chosen: readonly string[],
  now: Date,
): Promise<void> {
  const next: StoryRow = { ...story, chosen: normalizeIds(chosen) };
  await deps.stories.save(uow, next, now);
  const editedBefore = readiness(story).photosEdited;
  if (editedBefore && !readiness(next).photosEdited)
    await deps.audit.record(
      uow,
      {
        action: "story_check_changed",
        actorEmail: actor.email,
        targetId: story.submissionId,
        ip: actor.ip,
        details: { check: "photos_edited", value: false, automatic: true },
      },
      now,
    );
}

/**
 * Removes one staff photo: its `staff_photo` row, its place in the chosen set, and its
 * file and media row through a `media.delete` job. The sender's photos cannot be removed.
 */
export async function removeStaffPhoto(
  deps: ReviewDeps,
  actor: Actor,
  input: { formId: string; reference: string; mediaId: string },
): Promise<RemovePhotoResult> {
  const found = await loadStory(deps, input.formId, input.reference);
  if (!found) return { ok: false, code: "not_found" };
  const id = found.submission.id;
  const { mediaId } = input;

  return withDeadlockRetry(() =>
    deps.uow.run(async (uow): Promise<RemovePhotoResult> => {
      const locked = await lockSubmission(deps.submissions, uow, id);
      if (!locked) return { ok: false, code: "not_found" };
      if ((await photoOrigin(deps, uow, id, mediaId)) !== "staff")
        return { ok: false, code: "not_found" };
      const story = await deps.stories.lockOrCreate(uow, id, found.ctx.form.id);
      const now = deps.clock.now();
      await deps.staffPhotos.delete(uow, mediaId);
      await enqueueMediaDelete(deps.media, uow, mediaId);
      await deps.audit.record(
        uow,
        {
          action: "staff_photo_removed",
          actorEmail: actor.email,
          targetId: id,
          ip: actor.ip,
          details: { mediaId },
        },
        now,
      );
      if (story.chosen.includes(mediaId))
        await writeChoice(deps, uow, actor, story, withChoice(story.chosen, mediaId, false), now);
      return { ok: true };
    }),
  );
}

/** Chooses or unchooses one photo of the story, the sender's or a staff photo, for the post. */
export async function choosePhoto(
  deps: ReviewDeps,
  actor: Actor,
  input: { formId: string; reference: string; mediaId: string; chosen: boolean },
): Promise<ChoosePhotoResult> {
  const found = await loadStory(deps, input.formId, input.reference);
  if (!found) return { ok: false, code: "not_found" };
  if (!found.ctx.postPlan) return { ok: false, code: "post_plan_off" };
  const id = found.submission.id;
  const { mediaId } = input;

  return withDeadlockRetry(() =>
    deps.uow.run(async (uow): Promise<ChoosePhotoResult> => {
      const locked = await lockSubmission(deps.submissions, uow, id);
      if (!locked) return { ok: false, code: "not_found" };
      if ((await photoOrigin(deps, uow, id, mediaId)) === null)
        return { ok: false, code: "not_found" };
      const story = await deps.stories.lockOrCreate(uow, id, found.ctx.form.id);
      if (story.chosen.includes(mediaId) === input.chosen) return { ok: true };
      const now = deps.clock.now();
      await deps.audit.record(
        uow,
        {
          action: "photo_choice_changed",
          actorEmail: actor.email,
          targetId: id,
          ip: actor.ip,
          details: { mediaId, chosen: input.chosen },
        },
        now,
      );
      await writeChoice(
        deps,
        uow,
        actor,
        story,
        withChoice(story.chosen, mediaId, input.chosen),
        now,
      );
      return { ok: true };
    }),
  );
}
