import libheif, { type HeifImage } from "libheif-js/wasm-bundle";
import sharp from "sharp";
import type { EncodedImage, ImageEncoder } from "../application/ports/image-encoder";

/** Images above this many pixels are refused before they are decoded. */
export const MAX_INPUT_PIXELS = 50_000_000;

/** How long a HEIC decode may take before the file is refused. */
export const HEIC_DECODE_TIMEOUT_MS = 10_000;

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
  // libheif keeps its handles in a WASM heap that is shared by the whole
  // process and never shrinks: the decoder owns a context that only a later
  // decode (or heif_context_free) releases, and every image wraps a handle that
  // only free() releases. Release both on every path, including early returns.
  const decoder = new libheif.HeifDecoder();
  let images: HeifImage[] = [];
  try {
    images = decoder.decode(bytes);
    const image = images[0];
    if (image === undefined) return null;
    const width = image.get_width();
    const height = image.get_height();
    if (width <= 0 || height <= 0 || width * height > MAX_INPUT_PIXELS) return null;
    const pixels = await displayWithTimeout(image, width, height);
    if (pixels === null) return null;
    const jpeg = sharp(pixels, { raw: { width, height, channels: 4 } }).jpeg({ quality: QUALITY });
    return { bytes: await toBytes(jpeg), contentType: "image/jpeg" };
  } finally {
    for (const image of images) image.free();
    if (decoder.decoder !== null) {
      libheif.heif_context_free(decoder.decoder);
      decoder.decoder = null;
    }
  }
}

/**
 * libheif-js runs the decode inside a setTimeout callback, so a throw there
 * leaves its callback uncalled forever. The wait is bounded so a bad file
 * yields a refusal instead of a hanging request.
 */
function displayWithTimeout(
  image: HeifImage,
  width: number,
  height: number,
): Promise<Uint8ClampedArray | null> {
  return new Promise<Uint8ClampedArray | null>((resolve) => {
    const timer = setTimeout(() => {
      resolve(null);
    }, HEIC_DECODE_TIMEOUT_MS);
    image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (result) => {
      clearTimeout(timer);
      resolve(result?.data ?? null);
    });
  });
}
