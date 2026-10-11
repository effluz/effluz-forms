import QRCode from "qrcode";

/** Pixel widths the manager offers for PNG download. See specs/ui-ux/manager.md, "Share". */
export const QR_SIZES = [1024, 2048] as const;
export type QrSize = (typeof QR_SIZES)[number];

// Quiet zone of four modules and medium error correction: the scanning standard.
const OPTIONS = { margin: 4, errorCorrectionLevel: "M" } as const;

/**
 * A QR code of the plain public URL as a PNG `size` pixels wide.
 * See specs/decisions/0021-qr-code-library.md.
 */
export function renderQrPng(url: string, size: QrSize): Promise<Buffer> {
  return QRCode.toBuffer(url, { ...OPTIONS, type: "png", width: size });
}

/** A QR code of the plain public URL as an SVG document. */
export function renderQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { ...OPTIONS, type: "svg" });
}
