import { seeOther, text } from "@/app/admin/_lib/request";
import { revertCorrection } from "@/modules/review/application";
import { guardStoryPost, storyReturn, type StoryRouteContext } from "../_lib/story-request";

/**
 * POST .../[reference]/revert from the revert confirmation: removes the corrected text of one
 * answer and returns to the story page with `done=reverted`; anything else returns to the story
 * page. See specs/use-cases/curate-submission.md, "Revert".
 */
export async function POST(request: Request, context: StoryRouteContext): Promise<Response> {
  const guarded = await guardStoryPost(request, context);
  if (guarded instanceof Response) return guarded;
  const { container, form, formId, reference, actor } = guarded;

  const result = await revertCorrection(container.review, actor, {
    formId,
    reference,
    fieldKey: text(form, "field"),
  });
  return seeOther(storyReturn(formId, reference, form, result.ok ? { done: "reverted" } : {}));
}
