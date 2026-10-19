import type { Actor } from "@/modules/definitions/application";
import { lockSubmission } from "@/modules/submissions/application";
import { normalizeIds } from "../domain/readiness";
import { loadStory } from "./context";
import { withDeadlockRetry } from "./deadlock";
import type { ReviewDeps } from "./deps";
import type { StoryRow } from "./ports/story-repository";

/** The readiness checks staff tick by hand (specs/use-cases/curate-submission.md, "Readiness"). */
export const STORY_CHECKS = ["photos_edited", "text_checked"] as const;
export type StoryCheck = (typeof STORY_CHECKS)[number];

export type SetCheckResult =
  { ok: true } | { ok: false; code: "not_found" | "post_plan_off" | "no_photos_chosen" };

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** The row after the tick, null when nothing changes, or the refusal. */
function ticked(
  story: StoryRow,
  check: StoryCheck,
  value: boolean,
  actor: Actor,
  now: Date,
): StoryRow | null | "no_photos_chosen" {
  if (check === "text_checked") {
    if (value === (story.textCheckedAt !== null)) return null;
    return value
      ? { ...story, textCheckedBy: actor.email, textCheckedAt: now }
      : { ...story, textCheckedBy: null, textCheckedAt: null };
  }
  if (!value)
    return story.photosEditedFor === null
      ? null
      : { ...story, photosEditedFor: null, photosEditedBy: null, photosEditedAt: null };
  const chosen = normalizeIds(story.chosen);
  if (chosen.length === 0) return "no_photos_chosen";
  const edited = story.photosEditedFor === null ? null : normalizeIds(story.photosEditedFor);
  if (edited !== null && sameIds(edited, chosen)) return null;
  return {
    ...story,
    chosen,
    photosEditedFor: chosen,
    photosEditedBy: actor.email,
    photosEditedAt: now,
  };
}

/**
 * Ticks or unticks "Photos edited in Canva" or "Text checked" by hand. "Photos edited"
 * records the chosen set at that moment and cannot be ticked with nothing chosen;
 * unticking clears who and when. A tick that changes nothing writes nothing.
 */
export async function setCheck(
  deps: ReviewDeps,
  actor: Actor,
  input: { formId: string; reference: string; check: StoryCheck; value: boolean },
): Promise<SetCheckResult> {
  const found = await loadStory(deps, input.formId, input.reference);
  if (!found) return { ok: false, code: "not_found" };
  if (!found.ctx.postPlan) return { ok: false, code: "post_plan_off" };
  const id = found.submission.id;

  return withDeadlockRetry(() =>
    deps.uow.run(async (uow): Promise<SetCheckResult> => {
      const locked = await lockSubmission(deps.submissions, uow, id);
      if (!locked) return { ok: false, code: "not_found" };
      const story = await deps.stories.lockOrCreate(uow, id, found.ctx.form.id);
      const now = deps.clock.now();
      const next = ticked(story, input.check, input.value, actor, now);
      if (next === "no_photos_chosen") return { ok: false, code: next };
      if (next === null) return { ok: true };
      await deps.stories.save(uow, next, now);
      await deps.audit.record(
        uow,
        {
          action: "story_check_changed",
          actorEmail: actor.email,
          targetId: id,
          ip: actor.ip,
          details: { check: input.check, value: input.value, by: "hand" },
        },
        now,
      );
      return { ok: true };
    }),
  );
}
