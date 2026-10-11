import { requireSession } from "@/app/admin/_lib/request";
import { shareInfo } from "@/modules/definitions/application";

export interface QrTarget {
  /** The exact public link the code encodes. */
  url: string;
  /** For the download's file name. */
  slug: string;
}

/**
 * What the two QR routes share: a signed-in person (otherwise the redirect to sign-in)
 * and an existing form (otherwise 404). The slug is read from the public link, which
 * ends in it, so the code and its file name cannot disagree.
 * See specs/ui-ux/manager.md, "Share tab".
 */
export async function qrTarget(request: Request, id: string): Promise<QrTarget | Response> {
  const guarded = await requireSession(request);
  if (guarded instanceof Response) return guarded;
  const info = await shareInfo(guarded.container.definitions, id);
  if (info === null) return new Response(null, { status: 404 });
  const slug = new URL(info.url).pathname.split("/").pop() || "form";
  return { url: info.url, slug };
}
