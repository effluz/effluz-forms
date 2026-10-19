import { seeOther, text } from "@/app/admin/_lib/request";
import { MAX_STAFF_UPLOAD_FILES, addStaffPhotos } from "@/modules/review/application";
import {
  guardStoryPost,
  storyReturn,
  type StoryReturnParams,
  type StoryRouteContext,
} from "../_lib/story-request";

/** The files of the multipart body; the empty part a browser sends when none is picked is not one. */
async function postedFiles(form: FormData): Promise<Uint8Array[]> {
  const files = form
    .getAll("files")
    .filter((value): value is File => typeof value !== "string")
    .filter((file) => !(file.size === 0 && file.name === ""));
  return Promise.all(files.map(async (file) => new Uint8Array(await file.arrayBuffer())));
}

/**
 * POST .../[reference]/photos from "Add photos the sender sent later" (multipart): adds the
 * files as staff photos and returns to the Photos card with `done=photos_added&n=<count>`, or
 * with the refusal (a refused file names its reason and its position in `n`).
 * See specs/use-cases/review-submissions.md, "Main flow: staff photos".
 */
export async function POST(request: Request, context: StoryRouteContext): Promise<Response> {
  const guarded = await guardStoryPost(request, context);
  if (guarded instanceof Response) return guarded;
  const { container, form, formId, reference, actor } = guarded;
  const back = (story: StoryReturnParams) =>
    seeOther(storyReturn(formId, reference, form, story, "photos"));

  const result = await addStaffPhotos(container.review, actor, {
    formId,
    reference,
    files: await postedFiles(form),
    source: text(form, "source"),
    senderConfirmed: text(form, "confirmed") === "1",
  });
  if (result.ok) return back({ done: "photos_added", n: result.added });
  switch (result.code) {
    case "not_found":
      return seeOther(storyReturn(formId, reference, form));
    case "file_refused":
      return back({ error: result.reason, n: result.file });
    case "too_many_files":
      return back({ error: result.code, n: MAX_STAFF_UPLOAD_FILES });
    // Off the post plan the page offers no upload; a post that gets here reads as missing consent.
    case "post_plan_off":
      return back({ error: "consent_missing" });
    case "consent_missing":
    case "not_confirmed":
    case "source_invalid":
    case "no_files":
    case "staff_photos_max":
      return back({ error: result.code });
  }
}
