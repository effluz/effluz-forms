import { seeOther, text } from "@/app/admin/_lib/request";
import { parseIsoDate, planStory } from "@/modules/review/application";
import {
  guardStoryPost,
  storyReturn,
  type StoryReturnParams,
  type StoryRouteContext,
} from "../_lib/story-request";

const PLAN_PATH = "/admin/plan";

/**
 * POST .../[reference]/plan from the story's Planned date block (`return=story`) or the Post
 * plan's "Pick a story" (`return=plan`, with the `week` shown): plans the story on `date`, or
 * clears its date when `date` is empty; `resolution` (swap, move) answers a conflict about the
 * holder `expected` names. A planned story goes back where it came from; a conflict or a
 * refusal returns to the story page's plan block. See specs/use-cases/curate-submission.md, "Planning".
 */
export async function POST(request: Request, context: StoryRouteContext): Promise<Response> {
  const guarded = await guardStoryPost(request, context);
  if (guarded instanceof Response) return guarded;
  const { container, form, formId, reference, actor } = guarded;
  const back = (story: StoryReturnParams) =>
    seeOther(storyReturn(formId, reference, form, story, "plan"));

  const result = await planStory(container.review, actor, {
    formId,
    reference,
    date: text(form, "date"),
    resolution: text(form, "resolution"),
    expected: text(form, "expected"),
  });
  if (result.ok) {
    if (text(form, "return") === "plan") {
      const week = parseIsoDate(text(form, "week"));
      return seeOther(week === null ? PLAN_PATH : `${PLAN_PATH}?week=${week}`);
    }
    return back({ done: result.plannedOn === null ? "plan_cleared" : "planned" });
  }
  switch (result.code) {
    case "conflict":
      return back({ conflict: { date: result.date, ref: result.other, canSwap: result.canSwap } });
    case "date_invalid":
    case "published":
      return back({ error: result.code });
    case "not_found":
    case "post_plan_off":
      return seeOther(storyReturn(formId, reference, form));
  }
}
