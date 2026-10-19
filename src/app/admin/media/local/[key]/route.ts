import { actorOf, plain, requireSession } from "@/app/admin/_lib/request";
import { openLocalVideo } from "@/modules/review/application";

/** The content type of a durable file by its extension. */
const TYPES: Readonly<Record<string, string>> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function decoded(key: string): string | null {
  try {
    return decodeURIComponent(key);
  } catch {
    return null;
  }
}

/**
 * GET /admin/media/local/[key]: a stored video on local disk, the target of a video redirect
 * from the audited media route when `MEDIA_PROVIDER=local`. 404 unless the durable provider
 * is local and the key is a stored video of an existing story; the view is audited. Needs a
 * session, no CSRF token. See specs/system/media-storage.md, "Downloads".
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key } = await context.params;
  const guarded = await requireSession(request);
  if (guarded instanceof Response) return guarded;
  const { session, container } = guarded;
  if (container.config.media.provider !== "local") return plain(404);
  const storedKey = decoded(key);
  const extension = storedKey?.slice(storedKey.lastIndexOf(".") + 1) ?? "";
  if (storedKey === null || !Object.hasOwn(TYPES, extension)) return plain(404);
  const type = TYPES[extension];
  if (type === undefined) return plain(404);

  const file = await openLocalVideo(container.review, actorOf(session, request), storedKey);
  if (file === null) return plain(404);
  return new Response(file.body, {
    headers: {
      "Content-Type": type,
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "none",
      "Cache-Control": "private, no-store",
    },
  });
}
