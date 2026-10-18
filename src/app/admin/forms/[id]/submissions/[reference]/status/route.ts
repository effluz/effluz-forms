import { plain, seeOther, text } from "@/app/admin/_lib/request";
import { markPublished, unmarkPublished } from "@/modules/review/application";
import {
  guardStoryPost,
  storyReturn,
  type StoryReturnParams,
  type StoryRouteContext,
} from "../_lib/story-request";

/**
 * POST .../[reference]/status from the Publishing card: `intent=publish` marks the story as
 * published with the optional `post_url`, `intent=unpublish` unmarks it. A link that is not
 * https reopens the publish dialog; an unmark whose day another story took meanwhile names
 * that story. See specs/use-cases/curate-submission.md, "Main flow: change status", and
 * specs/ui-ux/manager.md, "Mark as published".
 */
export async function POST(request: Request, context: StoryRouteContext): Promise<Response> {
  const guarded = await guardStoryPost(request, context);
  if (guarded instanceof Response) return guarded;
  const { container, form, formId, reference, actor } = guarded;
  const back = (story: StoryReturnParams = {}) =>
    seeOther(storyReturn(formId, reference, form, story));

  const intent = text(form, "intent");
  if (intent === "publish") {
    const result = await markPublished(container.review, actor, {
      formId,
      reference,
      postUrl: text(form, "post_url"),
    });
    if (result.ok) return back({ done: "published" });
    return result.code === "post_url_invalid"
      ? back({ action: "publish", error: result.code })
      : back();
  }
  // The card offers only the two intents; anything else is a tampered request.
  if (intent !== "unpublish") return plain(400);
  const result = await unmarkPublished(container.review, actor, { formId, reference });
  if (!result.ok) return back();
  return result.dayHeldBy === null
    ? back({ done: "unpublished" })
    : back({ done: "unpublished_waiting", other: result.dayHeldBy });
}
