import type { Actor } from "@/modules/definitions/application";
import {
  findSubmission,
  lockSubmission,
  writeCuration,
  type Curation,
} from "@/modules/submissions/application";
import { todayIn, type IsoDate } from "../domain/days";
import { plannedAfterUnpublish, publishDay } from "../domain/plan";
import { parsePostUrl } from "../domain/post-url";
import { statusAfterUnpublish, type ReviewStatus } from "../domain/status";
import { loadStory } from "./context";
import { withDeadlockRetry } from "./deadlock";
import type { ReviewDeps } from "./deps";

export type MarkResult =
  { ok: true; day: IsoDate } | { ok: false; code: "not_found" | "post_url_invalid" };

export type UnmarkResult =
  | { ok: true; status: ReviewStatus; movedToWaiting: boolean; dayHeldBy: string | null }
  | { ok: false; code: "not_found" | "not_published" };

function withStatus(curation: Curation, status: ReviewStatus, actor: Actor, now: Date): Curation {
  return status === curation.status
    ? curation
    : { ...curation, status, statusChangedBy: actor.email, statusChangedAt: now };
}

/**
 * "Mark as published" (specs/use-cases/curate-submission.md, "Main flow: change status"):
 * stores the optional link, replacing an earlier one, and the day the story went out: the
 * day it already went out, else its planned date, else today in the plan's zone.
 */
export async function markPublished(
  deps: ReviewDeps,
  actor: Actor,
  input: { formId: string; reference: string; postUrl: string },
): Promise<MarkResult> {
  const found = await loadStory(deps, input.formId, input.reference);
  if (!found) return { ok: false, code: "not_found" };
  const link = parsePostUrl(input.postUrl);
  if (!link.ok) return { ok: false, code: "post_url_invalid" };
  const id = found.submission.id;

  return withDeadlockRetry(() =>
    deps.uow.run(async (uow): Promise<MarkResult> => {
      const locked = await lockSubmission(deps.submissions, uow, id);
      if (!locked) return { ok: false, code: "not_found" };
      const story = await deps.stories.lockOrCreate(uow, id, found.ctx.form.id);
      const now = deps.clock.now();
      const from = locked.curation.status;
      const day = story.publishedOn ?? publishDay(story.plannedOn, todayIn(deps.planTimeZone, now));

      await writeCuration(deps.submissions, uow, id, {
        ...withStatus(locked.curation, "published", actor, now),
        publishedPostUrl: link.url,
      });
      if (story.publishedOn !== day)
        await deps.stories.save(uow, { ...story, publishedOn: day }, now);
      await deps.audit.record(
        uow,
        {
          action: "submission_status_changed",
          actorEmail: actor.email,
          targetId: id,
          ip: actor.ip,
          details: { from, to: "published", link: link.url !== null },
        },
        now,
      );
      return { ok: true, day };
    }),
  );
}

/**
 * "Unmark published": back to `edited` or `viewed`, the link cleared. The planned date
 * stays when its day is still free; when another story took the day meanwhile, or the
 * story had none, it goes to "Waiting for a date". Locks: the submission, the story row,
 * then the day.
 */
export async function unmarkPublished(
  deps: ReviewDeps,
  actor: Actor,
  input: { formId: string; reference: string },
): Promise<UnmarkResult> {
  const found = await loadStory(deps, input.formId, input.reference);
  if (!found) return { ok: false, code: "not_found" };
  const id = found.submission.id;

  const outcome = await withDeadlockRetry(() =>
    deps.uow.run(async (uow) => {
      const locked = await lockSubmission(deps.submissions, uow, id);
      if (!locked) return { ok: false as const, code: "not_found" as const };
      if (locked.curation.status !== "published")
        return { ok: false as const, code: "not_published" as const };
      const story = await deps.stories.lockOrCreate(uow, id, found.ctx.form.id);
      const holder =
        story.plannedOn === null ? null : await deps.stories.lockDay(uow, story.plannedOn);
      const heldBy = holder !== null && holder.submissionId !== id ? holder.submissionId : null;
      const plannedOn = plannedAfterUnpublish({
        plannedOn: story.plannedOn,
        dayHeldByOther: heldBy !== null,
      });
      const now = deps.clock.now();
      const status = statusAfterUnpublish(Object.keys(locked.curation.curatedAnswers).length);

      await writeCuration(deps.submissions, uow, id, {
        ...withStatus(locked.curation, status, actor, now),
        publishedPostUrl: null,
      });
      await deps.stories.save(uow, { ...story, plannedOn, publishedOn: null }, now);
      await deps.audit.record(
        uow,
        {
          action: "submission_status_changed",
          actorEmail: actor.email,
          targetId: id,
          ip: actor.ip,
          details: { from: "published", to: status, link: false },
        },
        now,
      );
      if (plannedOn !== story.plannedOn)
        await deps.audit.record(
          uow,
          {
            action: "story_planned",
            actorEmail: actor.email,
            targetId: id,
            ip: actor.ip,
            details: { from: story.plannedOn ?? "none", to: plannedOn ?? "none" },
          },
          now,
        );
      return { ok: true as const, status, movedToWaiting: plannedOn === null, heldBy };
    }),
  );
  if (!outcome.ok) return outcome;
  const holder =
    outcome.heldBy === null ? null : await findSubmission(deps.submissions, outcome.heldBy);
  return {
    ok: true,
    status: outcome.status,
    movedToWaiting: outcome.movedToWaiting,
    dayHeldBy: holder?.reference ?? null,
  };
}
