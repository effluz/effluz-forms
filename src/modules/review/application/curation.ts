import type { Actor } from "@/modules/definitions/application";
import { lockSubmission, writeCuration, type Curation } from "@/modules/submissions/application";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { fieldIndex } from "@/shared/domain/form-model";
import { checkCorrection } from "../domain/correction";
import { statusAfterEdit, statusAfterRevert } from "../domain/status";
import { loadStory } from "./context";
import { withDeadlockRetry } from "./deadlock";
import type { ReviewDeps } from "./deps";
import { maxLengthOf } from "./open-story";

export type CorrectionResult =
  | { ok: true; changed: boolean }
  | { ok: false; code: "not_found" | "not_curatable" | "not_answered" | "correction_blank" }
  | { ok: false; code: "correction_too_long"; max: number };

export type RevertResult = { ok: true } | { ok: false; code: "not_found" | "not_corrected" };

const sameLineEnds = (text: string): string => text.replace(/\r\n?/g, "\n");

/** The curation with `status`, stamping who changed it only when it changed. */
function withStatus(
  curation: Curation,
  status: Curation["status"],
  actor: Actor,
  now: Date,
): Curation {
  return status === curation.status
    ? curation
    : { ...curation, status, statusChangedBy: actor.email, statusChangedAt: now };
}

/** The curation without the field's corrected text, its status walked back. */
function withoutCorrection(
  curation: Curation,
  fieldKey: string,
  actor: Actor,
  now: Date,
): Curation {
  const rest = Object.fromEntries(
    Object.entries(curation.curatedAnswers).filter(([key]) => key !== fieldKey),
  );
  const status = statusAfterRevert(curation.status, Object.keys(rest).length);
  return withStatus({ ...curation, curatedAnswers: rest }, status, actor, now);
}

function recordReverted(
  deps: ReviewDeps,
  uow: UnitOfWork,
  actor: Actor,
  submissionId: string,
  fieldKey: string,
  now: Date,
): Promise<void> {
  return deps.audit.record(
    uow,
    {
      action: "submission_reverted",
      actorEmail: actor.email,
      targetId: submissionId,
      ip: actor.ip,
      details: { fieldKey },
    },
    now,
  );
}

/**
 * Saves a curator's correction of one text answer (specs/use-cases/curate-submission.md,
 * "Main flow: edit a text answer"). Text identical to the original stores no correction
 * (changed: false), removes one saved earlier, and still ticks "Text checked".
 */
export async function saveCorrection(
  deps: ReviewDeps,
  actor: Actor,
  input: { formId: string; reference: string; fieldKey: string; text: string },
): Promise<CorrectionResult> {
  const found = await loadStory(deps, input.formId, input.reference);
  if (!found) return { ok: false, code: "not_found" };
  const field = fieldIndex(found.version.document).get(input.fieldKey)?.field;
  if (!field || deps.registry.get(field.type).reviewTraits?.curatable !== true)
    return { ok: false, code: "not_curatable" };
  const original = found.submission.answers[input.fieldKey];
  if (typeof original !== "string") return { ok: false, code: "not_answered" };
  const checked = checkCorrection(
    input.text,
    maxLengthOf(field, deps.registry) ?? Number.POSITIVE_INFINITY,
  );
  if (!checked.ok)
    return checked.code === "correction_too_long"
      ? { ok: false, code: checked.code, max: checked.max }
      : { ok: false, code: checked.code };
  const changed = checked.text !== sameLineEnds(original);
  const { fieldKey } = input;
  const id = found.submission.id;

  return withDeadlockRetry(() =>
    deps.uow.run(async (uow): Promise<CorrectionResult> => {
      const locked = await lockSubmission(deps.submissions, uow, id);
      if (!locked) return { ok: false, code: "not_found" };
      const story = await deps.stories.lockOrCreate(uow, id, found.ctx.form.id);
      const now = deps.clock.now();
      const curation = locked.curation;
      const tick = story.textCheckedAt === null;
      const reverts = !changed && curation.curatedAnswers[fieldKey] !== undefined;

      if (changed) {
        const status = statusAfterEdit(curation.status);
        await deps.edits.append(uow, {
          id: deps.ids.newId(),
          submissionId: id,
          fieldKey,
          text: checked.text,
          source: "manual",
          editor: actor.email,
          createdAt: now,
        });
        await writeCuration(
          deps.submissions,
          uow,
          id,
          withStatus(
            {
              ...curation,
              curatedAnswers: { ...curation.curatedAnswers, [fieldKey]: checked.text },
            },
            status,
            actor,
            now,
          ),
        );
      } else if (reverts) {
        await writeCuration(
          deps.submissions,
          uow,
          id,
          withoutCorrection(curation, fieldKey, actor, now),
        );
      }
      if (tick)
        await deps.stories.save(
          uow,
          { ...story, textCheckedBy: actor.email, textCheckedAt: now },
          now,
        );

      if (changed)
        await deps.audit.record(
          uow,
          {
            action: "submission_edited",
            actorEmail: actor.email,
            targetId: id,
            ip: actor.ip,
            details: { fieldKey, source: "manual" },
          },
          now,
        );
      if (reverts) await recordReverted(deps, uow, actor, id, fieldKey, now);
      if (tick)
        await deps.audit.record(
          uow,
          {
            action: "story_check_changed",
            actorEmail: actor.email,
            targetId: id,
            ip: actor.ip,
            details: { check: "text_checked", value: true, by: "correction" },
          },
          now,
        );
      return { ok: true, changed };
    }),
  );
}

/** "Revert to original": removes the field's corrected text. "Text checked" stays. */
export async function revertCorrection(
  deps: ReviewDeps,
  actor: Actor,
  input: { formId: string; reference: string; fieldKey: string },
): Promise<RevertResult> {
  const found = await loadStory(deps, input.formId, input.reference);
  if (!found) return { ok: false, code: "not_found" };
  const id = found.submission.id;
  return withDeadlockRetry(() =>
    deps.uow.run(async (uow): Promise<RevertResult> => {
      const locked = await lockSubmission(deps.submissions, uow, id);
      if (!locked) return { ok: false, code: "not_found" };
      if (locked.curation.curatedAnswers[input.fieldKey] === undefined)
        return { ok: false, code: "not_corrected" };
      const now = deps.clock.now();
      await writeCuration(
        deps.submissions,
        uow,
        id,
        withoutCorrection(locked.curation, input.fieldKey, actor, now),
      );
      await recordReverted(deps, uow, actor, id, input.fieldKey, now);
      return { ok: true };
    }),
  );
}
