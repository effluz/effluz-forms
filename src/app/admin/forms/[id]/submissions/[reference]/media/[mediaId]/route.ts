import { actorOf, plain, requireSession } from "@/app/admin/_lib/request";
import { accessMedia, type MediaView } from "@/modules/review/application";

const VIEWS: readonly MediaView[] = ["thumb", "full", "download"];

/**
 * GET .../[reference]/media/[mediaId]?view=thumb|full|download: a 320 px thumbnail (cached
 * privately for an hour, not audited), the full file inline, or the file as an attachment;
 * a full view of a stored video redirects to the provider's temporary link. Needs a session,
 * no CSRF token (it changes nothing). Files stream without a Content-Length: the row's size
 * may differ from the bytes the storage returns. See specs/system/media-storage.md,
 * "Downloads", and specs/ui-ux/manager.md, "Routes".
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; reference: string; mediaId: string }> },
): Promise<Response> {
  const { id, reference, mediaId } = await context.params;
  const guarded = await requireSession(request);
  if (guarded instanceof Response) return guarded;
  const { session, container } = guarded;
  const view = VIEWS.find((known) => known === new URL(request.url).searchParams.get("view"));
  if (view === undefined) return plain(400);

  const access = await accessMedia(container.review, actorOf(session, request), {
    formId: id,
    reference,
    mediaId,
    view,
  });
  if (access === null) return plain(404);
  switch (access.kind) {
    case "bytes":
      return new Response(new Uint8Array(access.body), {
        headers: {
          "Content-Type": access.contentType,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, max-age=3600",
        },
      });
    case "stream":
      return new Response(access.body, {
        headers: {
          "Content-Type": access.contentType,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
          "Content-Disposition":
            view === "download" ? `attachment; filename="${access.filename}"` : "inline",
        },
      });
    case "redirect":
      return new Response(null, {
        status: 302,
        headers: { Location: access.url, "Cache-Control": "no-store" },
      });
  }
}
