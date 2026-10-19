import type { Actor } from "@/modules/definitions/application";
import { deleteSubmission, lockSubmission } from "@/modules/submissions/application";
import { loadStory } from "./context";
import { withDeadlockRetry } from "./deadlock";
import type { ReviewDeps } from "./deps";

export type DeleteStoryResult =
  { ok: true } | { ok: false; code: "not_found" | "reference_mismatch" };

/** The typed confirmation matches when it is the reference, ignoring surrounding space and case. */
function confirms(typed: string, reference: string): boolean {
  return typed.trim().toUpperCase() === reference.toUpperCase();
}

/**
 * Deletes one story for good (specs/use-cases/review-submissions.md, "Main flow:
 * delete"): one unit of work takes the submission row lock, deletes the row (its
 * story state, staff photo rows and edit history cascade), enqueues `media.delete`
 * for every media row, staff photos included, and records `submission_deleted`.
 */
export async function deleteStory(
  deps: ReviewDeps,
  actor: Actor,
  input: { formId: string; reference: string; typed: string },
): Promise<DeleteStoryResult> {
  const found = await loadStory(deps, input.formId, input.reference);
  if (!found) return { ok: false, code: "not_found" };
  const { id, reference } = found.submission;
  if (!confirms(input.typed, reference)) return { ok: false, code: "reference_mismatch" };

  return withDeadlockRetry(() =>
    deps.uow.run(async (uow): Promise<DeleteStoryResult> => {
      const locked = await lockSubmission(deps.submissions, uow, id);
      if (!locked) return { ok: false, code: "not_found" };
      const { deleted } = await deleteSubmission(deps.submissions, uow, id);
      if (!deleted) return { ok: false, code: "not_found" };
      await deps.audit.record(
        uow,
        {
          action: "submission_deleted",
          actorEmail: actor.email,
          targetId: id,
          ip: actor.ip,
          details: { reference },
        },
        deps.clock.now(),
      );
      return { ok: true };
    }),
  );
}
