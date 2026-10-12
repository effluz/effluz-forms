import { getContainer } from "@/app/container";
import { clearedFillCookie } from "@/modules/submissions/presentation/cookies";
import { plain, seeOther } from "@/modules/submissions/presentation/http";
import { errorClass, formPath } from "../_lib/respond";

/**
 * GET /f/<slug>/restart: clears the in-progress cookie and returns to page 1 ("Start again",
 * "Fill in another form"); a cross-site navigation only returns. See specs/ui-ux/renderer.md,
 * "Routes", and specs/system/security.md, "In-progress cookie".
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  // A link from another site may navigate here with the Lax cookie; it must not clear progress.
  if (request.headers.get("sec-fetch-site") === "cross-site") return seeOther(formPath(slug));
  const container = getContainer();
  try {
    return seeOther(formPath(slug), [clearedFillCookie(slug, container.config.session.secure)]);
  } catch (error) {
    container.logger.error("restart route failed", { slug, error: errorClass(error) });
    return plain(500);
  }
}
