import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  syntheticHeic,
  syntheticJpegWithGps,
  syntheticPng,
  syntheticWebp,
} from "../../../../tests/fakes/media-files";
import { SharpImageEncoder } from "./sharp-image-encoder";

const contains = (bytes: Uint8Array | undefined, text: string): boolean =>
  bytes !== undefined && Buffer.from(bytes).includes(Buffer.from(text, "latin1"));

describe("SharpImageEncoder", () => {
  const encoder = new SharpImageEncoder();

  it("re-encodes a JPEG with every metadata block removed", async () => {
    const input = await syntheticJpegWithGps();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    expect(contains(input, "synthetic test image")).toBe(true);
    const out = await encoder.reencode(input, "image/jpeg");
    expect(out?.contentType).toBe("image/jpeg");
    const meta = await sharp(out?.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    // Read back from the raw output: neither the EXIF segment nor its content survives.
    expect(contains(out?.bytes, "Exif")).toBe(false);
    expect(contains(out?.bytes, "synthetic test image")).toBe(false);
    expect([meta.width, meta.height]).toEqual([64, 48]);
  });

  it("keeps PNG and WebP in their own format", async () => {
    expect((await encoder.reencode(await syntheticPng(), "image/png"))?.contentType).toBe(
      "image/png",
    );
    expect((await encoder.reencode(await syntheticWebp(), "image/webp"))?.contentType).toBe(
      "image/webp",
    );
  });

  it("decodes HEIC and encodes it as JPEG", async () => {
    const out = await encoder.reencode(syntheticHeic(), "image/heic");
    expect(out?.contentType).toBe("image/jpeg");
    const meta = await sharp(out?.bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 16, 16]);
  });

  it("returns null for a truncated JPEG, bytes that do not decode as the type, and an unknown type", async () => {
    const jpeg = await syntheticJpegWithGps();
    expect(
      await encoder.reencode(jpeg.subarray(0, Math.floor(jpeg.length / 2)), "image/jpeg"),
    ).toBeNull();
    expect(await encoder.reencode(await syntheticPng(), "image/heic")).toBeNull();
    expect(await encoder.reencode(jpeg, "image/gif")).toBeNull();
  });

  it("refuses images above the pixel limit", async () => {
    const huge = await sharp({
      create: { width: 8000, height: 7000, channels: 3, background: "#ffffff" },
    })
      .jpeg()
      .toBuffer();
    expect(await encoder.reencode(new Uint8Array(huge), "image/jpeg")).toBeNull();
  });
});
