import { seeOther, text } from "@/app/admin/_lib/request";
import { deleteStory } from "@/modules/review/application";
import { listHref } from "@/modules/review/presentation/list-view";
import { STORY_DIALOG_ID } from "@/modules/review/presentation/story-params";
import {
  backQuery,
  guardStoryPost,
  storyReturn,
  type StoryRouteContext,
} from "../_lib/story-request";

/**
 * POST .../[reference]/delete from the delete confirmation: deletes the story once its
 * reference is typed and goes to the list it came from with `deleted=<ref>`. A wrong
 * reference reopens the confirmation with the refusal; a missing story returns to its page.
 * See specs/use-cases/review-submissions.md, "Main flow: delete", and specs/ui-ux/manager.md,
 * "Delete".
 */
export async function POST(request: Request, context: StoryRouteContext): Promise<Response> {
  const guarded = await guardStoryPost(request, context);
  if (guarded instanceof Response) return guarded;
  const { container, form, formId, reference, actor } = guarded;

  const result = await deleteStory(container.review, actor, {
    formId,
    reference,
    typed: text(form, "typed"),
  });
  if (result.ok) {
    const list = listHref(formId, backQuery(form));
    return seeOther(
      `${list}${list.includes("?") ? "&" : "?"}deleted=${encodeURIComponent(reference)}`,
    );
  }
  return seeOther(
    storyReturn(
      formId,
      reference,
      form,
      result.code === "reference_mismatch" ? { action: "delete", error: result.code } : {},
      result.code === "reference_mismatch" ? STORY_DIALOG_ID : undefined,
    ),
  );
}
