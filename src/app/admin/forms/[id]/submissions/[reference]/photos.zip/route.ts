import { actorOf, plain, requireSession } from "@/app/admin/_lib/request";
import { photoArchive } from "@/modules/review/application";

const SETS = ["all", "chosen"] as const;

/**
 * GET .../[reference]/photos.zip?set=all|chosen: every file of the story, or the photos chosen
 * for the post, as one ZIP attachment streamed as it is written. 404 when the story is gone or
 * the set is empty (the chosen set is empty off the post plan). Needs a session, no CSRF
 * token. See specs/system/media-storage.md, "Downloads".
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; reference: string }> },
): Promise<Response> {
  const { id, reference } = await context.params;
  const guarded = await requireSession(request);
  if (guarded instanceof Response) return guarded;
  const { session, container } = guarded;
  const set = SETS.find((known) => known === new URL(request.url).searchParams.get("set"));
  if (set === undefined) return plain(400);

  const archive = await photoArchive(container.review, actorOf(session, request), {
    formId: id,
    reference,
    set,
  });
  if (!archive.ok) return plain(404);
  return new Response(archive.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${archive.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
