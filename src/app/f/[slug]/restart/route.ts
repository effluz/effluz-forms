import { getContainer } from "@/app/container";
import { clearedFillCookie } from "@/modules/submissions/presentation/cookies";
import { plain, seeOther } from "@/modules/submissions/presentation/http";
import { errorClass, formPath, isForeignRequest } from "../_lib/respond";

/**
 * POST /f/<slug>/restart: clears the in-progress cookie and returns to page 1 ("Start again",
 * "Fill in another form"). A request from another origin is refused, like the script routes'.
 * See specs/ui-ux/renderer.md, "Routes", and specs/system/security.md, "In-progress cookie".
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const container = getContainer();
  try {
    if (isForeignRequest(request.headers, container.config.publicBaseUrl)) return plain(403);
    return seeOther(formPath(slug), [clearedFillCookie(slug, container.config.session.secure)]);
  } catch (error) {
    container.logger.error("restart route failed", { slug, error: errorClass(error) });
    return plain(500);
  }
}

/** A GET changes nothing: a link, a redirect or a prefetch must not clear a visitor's progress. */
export function GET(): Response {
  const response = plain(405);
  response.headers.set("Allow", "POST");
  return response;
}
