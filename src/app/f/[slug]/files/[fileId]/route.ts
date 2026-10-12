import { getContainer } from "@/app/container";
import { postContext, removeFile } from "@/modules/submissions/application";
import {
  FILL_COOKIE,
  parseFillState,
  readCookie,
} from "@/modules/submissions/presentation/cookies";
import { plain } from "@/modules/submissions/presentation/http";
import { errorClass } from "../../_lib/respond";

/**
 * DELETE /f/<slug>/files/<file id>: removes a staged file with script; 204, or 404 when the
 * record holds no such file. See specs/ui-ux/renderer.md, "File upload" and "Routes".
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; fileId: string }> },
): Promise<Response> {
  const { slug, fileId } = await params;
  const container = getContainer();
  try {
    const deps = container.submissions;
    const state = parseFillState(readCookie(request.headers.get("cookie"), FILL_COOKIE));
    const context = await postContext(deps, { slug, state, submitToken: null });
    if (!context.ok) return plain(410);
    return plain((await removeFile(deps, context, fileId)) ? 204 : 404);
  } catch (error) {
    container.logger.error("file removal failed", { slug, error: errorClass(error) });
    return plain(500);
  }
}
