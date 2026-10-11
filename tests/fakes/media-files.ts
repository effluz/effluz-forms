import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

/**
 * Synthetic media bytes for tests. Everything here is generated or a solid
 * colour square; no real photo or video is ever used. Test tooling only:
 * nothing under src/ may import it.
 */

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** An ISO BMFF box: 32-bit big-endian size (8 plus the body), type, body. */
export function box(type: string, body: Uint8Array = new Uint8Array(0)): Uint8Array {
  const header = new Uint8Array(8);
  new DataView(header.buffer).setUint32(0, 8 + body.length);
  header.set(ascii(type), 4);
  return concat(header, body);
}

/** A tiny MP4: ftyp, moov holding an mvhd, mdat. `syntheticMp4("qt  ")` is QuickTime. */
export function syntheticMp4(brand = "isom"): Uint8Array {
  const ftyp = box("ftyp", concat(ascii(brand), new Uint8Array(4), ascii(brand), ascii("mp41")));
  const moov = box("moov", box("mvhd", new Uint8Array(100)));
  const mdat = box("mdat", new Uint8Array(900));
  return concat(ftyp, moov, mdat);
}

/** An MP4 whose ftyp box claims to be larger than the whole file. */
export function brokenMp4(): Uint8Array {
  const bytes = syntheticMp4();
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(0, 4096);
  return bytes;
}

/** A noise JPEG carrying GPS and copyright EXIF, so metadata stripping is observable. */
export async function syntheticJpegWithGps(width = 64, height = 48): Promise<Uint8Array> {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#808080",
      noise: { type: "gaussian", mean: 128, sigma: 30 },
    },
  })
    .jpeg()
    .withExif({
      IFD0: { Copyright: "synthetic test image" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "8/1 58/1 0/1",
        GPSLongitudeRef: "W",
        GPSLongitude: "79/1 31/1 0/1",
      },
    })
    .toBuffer();
  return new Uint8Array(buffer);
}

export async function syntheticPng(): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width: 16, height: 16, channels: 4, background: "#6C344E" },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

export async function syntheticWebp(): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#372549" },
  })
    .webp()
    .toBuffer();
  return new Uint8Array(buffer);
}

/**
 * A 16 by 16 solid-colour HEIC. Generated once with:
 * `magick -size 16x16 xc:#6C344E /tmp/s.png && heif-enc -q 50 /tmp/s.png -o tests/fixtures/media/synthetic-16x16.heic`
 */
export function syntheticHeic(): Uint8Array {
  const file = path.join(process.cwd(), "tests", "fixtures", "media", "synthetic-16x16.heic");
  return new Uint8Array(readFileSync(file));
}

export function htmlPretendingToBeJpeg(): Uint8Array {
  return ascii("<!doctype html><title>not a photo</title>");
}
