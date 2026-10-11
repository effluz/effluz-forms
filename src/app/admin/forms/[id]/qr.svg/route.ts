import { renderQrSvg } from "@/modules/definitions/infrastructure/qr";
import { qrTarget } from "../qr-target";

/**
 * GET /admin/forms/[id]/qr.svg: the QR code of the form's public link as an SVG, inline
 * for the Share tab's preview, or a download with `?download=1`.
 * See specs/ui-ux/manager.md, "Share tab".
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const target = await qrTarget(request, id);
  if (target instanceof Response) return target;
  const svg = await renderQrSvg(target.url);
  const headers: Record<string, string> = {
    "Content-Type": "image/svg+xml",
    "Cache-Control": "private, max-age=3600",
  };
  if (new URL(request.url).searchParams.get("download") === "1") {
    headers["Content-Disposition"] = `attachment; filename="${target.slug}-qr.svg"`;
  }
  return new Response(svg, { headers });
}
