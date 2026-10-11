import libheif from "libheif-js/wasm-bundle";
import sharp from "sharp";
import type { EncodedImage, ImageEncoder } from "../application/ports/image-encoder";

/** Images above this many pixels are refused before they are decoded. */
export const MAX_INPUT_PIXELS = 50_000_000;

const QUALITY = 85;

/**
 * Decodes and re-encodes an image. sharp writes no metadata unless asked, so
 * the output carries no EXIF, XMP or IPTC. `failOn: "error"` turns a truncated
 * file into a refusal instead of a half image. HEIC and HEIF are decoded with
 * libheif-js and written as JPEG. See specs/system/media-storage.md, "File
 * handling rules", and ADR 0023.
 */
export class SharpImageEncoder implements ImageEncoder {
  async reencode(bytes: Uint8Array, contentType: string): Promise<EncodedImage | null> {
    try {
      switch (contentType) {
        case "image/jpeg":
          return {
            bytes: await toBytes(open(bytes).jpeg({ quality: QUALITY })),
            contentType: "image/jpeg",
          };
        case "image/png":
          return { bytes: await toBytes(open(bytes).png()), contentType: "image/png" };
        case "image/webp":
          return {
            bytes: await toBytes(open(bytes).webp({ quality: QUALITY })),
            contentType: "image/webp",
          };
        case "image/heic":
        case "image/heif":
          return await reencodeHeic(bytes);
        default:
          return null;
      }
    } catch {
      return null;
    }
  }
}

function open(bytes: Uint8Array): sharp.Sharp {
  return sharp(bytes, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).rotate();
}

async function toBytes(pipeline: sharp.Sharp): Promise<Uint8Array> {
  return new Uint8Array(await pipeline.toBuffer());
}

async function reencodeHeic(bytes: Uint8Array): Promise<EncodedImage | null> {
  const image = new libheif.HeifDecoder().decode(bytes)[0];
  if (image === undefined) return null;
  const width = image.get_width();
  const height = image.get_height();
  if (width <= 0 || height <= 0 || width * height > MAX_INPUT_PIXELS) return null;
  const pixels = await new Promise<Uint8ClampedArray | null>((resolve) => {
    image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (result) => {
      resolve(result?.data ?? null);
    });
  });
  if (pixels === null) return null;
  const jpeg = sharp(pixels, { raw: { width, height, channels: 4 } }).jpeg({ quality: QUALITY });
  return { bytes: await toBytes(jpeg), contentType: "image/jpeg" };
}
