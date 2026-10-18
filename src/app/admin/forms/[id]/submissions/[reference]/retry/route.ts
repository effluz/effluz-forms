import { seeOther } from "@/app/admin/_lib/request";
import { retryStoryJobs } from "@/modules/review/application";
import { guardStoryPost, storyReturn, type StoryRouteContext } from "../_lib/story-request";

/**
 * POST .../[reference]/retry from the story's failure warning: retries every dead job of the
 * story and returns with `done=retried`; a missing story returns to its page, which says so.
 * See specs/use-cases/operate-jobs.md.
 */
export async function POST(request: Request, context: StoryRouteContext): Promise<Response> {
  const guarded = await guardStoryPost(request, context);
  if (guarded instanceof Response) return guarded;
  const { container, form, formId, reference, actor } = guarded;

  const retried = await retryStoryJobs(container.review, actor, { formId, reference });
  return seeOther(
    storyReturn(formId, reference, form, retried === null ? {} : { done: "retried" }),
  );
}
