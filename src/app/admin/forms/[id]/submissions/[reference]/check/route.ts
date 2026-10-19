import { plain, seeOther, text } from "@/app/admin/_lib/request";
import { STORY_CHECKS, setCheck } from "@/modules/review/application";
import { guardStoryPost, storyReturn, type StoryRouteContext } from "../_lib/story-request";

/**
 * POST .../[reference]/check from the Readiness panel: ticks (`value=1`) or unticks (`value=0`)
 * "Photos edited in Canva" or "Text checked" and returns to the panel with `done=check_saved`,
 * or with `error=no_photos_chosen`. See specs/use-cases/curate-submission.md, "Readiness".
 */
export async function POST(request: Request, context: StoryRouteContext): Promise<Response> {
  const guarded = await guardStoryPost(request, context);
  if (guarded instanceof Response) return guarded;
  const { container, form, formId, reference, actor } = guarded;
  // The panel offers only its checks, each 1 or 0; anything else is a tampered request.
  const check = STORY_CHECKS.find((known) => known === text(form, "check"));
  const value = text(form, "value");
  if (check === undefined || (value !== "1" && value !== "0")) return plain(400);

  const result = await setCheck(container.review, actor, {
    formId,
    reference,
    check,
    value: value === "1",
  });
  if (result.ok)
    return seeOther(storyReturn(formId, reference, form, { done: "check_saved" }, "readiness"));
  if (result.code === "no_photos_chosen")
    return seeOther(storyReturn(formId, reference, form, { error: result.code }, "readiness"));
  return seeOther(storyReturn(formId, reference, form));
}
