import { seeOther, text } from "@/app/admin/_lib/request";
import { removeStaffPhoto } from "@/modules/review/application";
import { guardStoryPost, storyReturn, type StoryRouteContext } from "../../_lib/story-request";

/**
 * POST .../[reference]/photos/remove from the remove confirmation: removes one staff photo and
 * returns to the Photos card with `done=photo_removed`; a sender's photo or an unknown one
 * returns to the story page. See specs/use-cases/review-submissions.md, "Main flow: staff
 * photos".
 */
export async function POST(request: Request, context: StoryRouteContext): Promise<Response> {
  const guarded = await guardStoryPost(request, context);
  if (guarded instanceof Response) return guarded;
  const { container, form, formId, reference, actor } = guarded;

  const result = await removeStaffPhoto(container.review, actor, {
    formId,
    reference,
    mediaId: text(form, "media"),
  });
  return seeOther(
    result.ok
      ? storyReturn(formId, reference, form, { done: "photo_removed" }, "photos")
      : storyReturn(formId, reference, form),
  );
}
