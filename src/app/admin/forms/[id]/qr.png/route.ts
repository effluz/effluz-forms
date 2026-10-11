import { QR_SIZES, renderQrPng, type QrSize } from "@/modules/definitions/infrastructure/qr";
import { qrTarget } from "../qr-target";

function sizeOf(value: string | null): QrSize | undefined {
  return QR_SIZES.find((size) => String(size) === value);
}

/**
 * GET /admin/forms/[id]/qr.png?size=1024|2048: the QR code of the form's public link as
 * a PNG download. See specs/ui-ux/manager.md, "Share tab".
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const target = await qrTarget(request, id);
  if (target instanceof Response) return target;
  const size = sizeOf(new URL(request.url).searchParams.get("size"));
  if (size === undefined) return new Response(null, { status: 400 });
  const png = await renderQrPng(target.url, size);
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${target.slug}-qr-${String(size)}.png"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
