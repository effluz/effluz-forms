import { seeOther, text } from "@/app/admin/_lib/request";
import { saveCorrection } from "@/modules/review/application";
import {
  guardStoryPost,
  storyReturn,
  type StoryReturnParams,
  type StoryRouteContext,
} from "../_lib/story-request";

/**
 * POST .../[reference]/correction from the correction editor: saves the corrected text of one
 * answer and returns to the story page with `done=saved`. A refused save reopens the editor
 * (`edit=<field>`) with the refusal; a field that cannot be corrected, or a missing story,
 * returns to the story page. See specs/use-cases/curate-submission.md, "Main flow: edit a
 * text answer", and specs/ui-ux/manager.md, "Edit a text answer".
 */
export async function POST(request: Request, context: StoryRouteContext): Promise<Response> {
  const guarded = await guardStoryPost(request, context);
  if (guarded instanceof Response) return guarded;
  const { container, form, formId, reference, actor } = guarded;
  const field = text(form, "field");
  const back = (story: StoryReturnParams = {}) =>
    seeOther(storyReturn(formId, reference, form, story));

  const result = await saveCorrection(container.review, actor, {
    formId,
    reference,
    fieldKey: field,
    text: text(form, "text"),
  });
  if (result.ok) return back({ done: "saved" });
  switch (result.code) {
    case "correction_blank":
      return back({ edit: field, error: result.code });
    case "correction_too_long":
      return back({ edit: field, error: result.code, n: result.max });
    case "not_found":
    case "not_curatable":
    case "not_answered":
      return back();
  }
}
