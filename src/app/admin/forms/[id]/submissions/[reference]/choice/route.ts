import { plain, seeOther, text } from "@/app/admin/_lib/request";
import { choosePhoto } from "@/modules/review/application";
import { guardStoryPost, storyReturn, type StoryRouteContext } from "../_lib/story-request";

/**
 * POST .../[reference]/choice from a photo tile: chooses (`chosen=1`) or unchooses (`chosen=0`)
 * the photo for the post and returns to the Photos card with `done=choice_saved`; an unknown
 * photo or a form off the post plan returns to the story page.
 * See specs/use-cases/curate-submission.md, "Readiness".
 */
export async function POST(request: Request, context: StoryRouteContext): Promise<Response> {
  const guarded = await guardStoryPost(request, context);
  if (guarded instanceof Response) return guarded;
  const { container, form, formId, reference, actor } = guarded;
  const chosen = text(form, "chosen");
  // The tile posts 1 or 0; anything else is a tampered request.
  if (chosen !== "1" && chosen !== "0") return plain(400);

  const result = await choosePhoto(container.review, actor, {
    formId,
    reference,
    mediaId: text(form, "media"),
    chosen: chosen === "1",
  });
  return seeOther(
    result.ok
      ? storyReturn(formId, reference, form, { done: "choice_saved" }, "photos")
      : storyReturn(formId, reference, form),
  );
}
