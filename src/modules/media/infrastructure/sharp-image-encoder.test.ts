import libheif from "libheif-js/wasm-bundle";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  syntheticHeic,
  syntheticJpegWithGps,
  syntheticPng,
  syntheticWebp,
} from "../../../../tests/fakes/media-files";
import { HEIC_DECODE_TIMEOUT_MS, SharpImageEncoder } from "./sharp-image-encoder";

const contains = (bytes: Uint8Array | undefined, text: string): boolean =>
  bytes !== undefined && Buffer.from(bytes).includes(Buffer.from(text, "latin1"));

describe("SharpImageEncoder", () => {
  const encoder = new SharpImageEncoder();

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

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

  it("applies the EXIF orientation and drops the tag", async () => {
    const input = new Uint8Array(
      await sharp({
        create: { width: 64, height: 48, channels: 3, background: "#336699" },
      })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer(),
    );
    expect((await sharp(input).metadata()).orientation).toBe(6);
    const out = await encoder.reencode(input, "image/jpeg");
    const meta = await sharp(out?.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([48, 64]);
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it("makes a WebP thumbnail without metadata", async () => {
    const input = await syntheticJpegWithGps(1200, 800);
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const thumb = await encoder.thumbnail(input, "image/jpeg", 320);
    const meta = await sharp(thumb ?? undefined).metadata();
    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([320, 213]);
    expect(meta.exif).toBeUndefined();
    expect(contains(thumb ?? undefined, "synthetic test image")).toBe(false);
    expect(await encoder.thumbnail(new Uint8Array([1, 2, 3, 4]), "image/jpeg", 320)).toBeNull();
  });

  it("does not enlarge a small image", async () => {
    const thumb = await encoder.thumbnail(await syntheticJpegWithGps(64, 48), "image/jpeg", 320);
    const meta = await sharp(thumb ?? undefined).metadata();
    expect([meta.width, meta.height]).toEqual([64, 48]);
  });

  describe("libheif handles", () => {
    it("releases the context and every image after each successful decode", async () => {
      const freeImage = vi.spyOn(libheif.HeifImage.prototype, "free");
      const freeContext = vi.spyOn(libheif, "heif_context_free");
      for (let i = 0; i < 50; i += 1) {
        expect((await encoder.reencode(syntheticHeic(), "image/heic"))?.contentType).toBe(
          "image/jpeg",
        );
      }
      expect(freeImage).toHaveBeenCalledTimes(50);
      expect(freeContext).toHaveBeenCalledTimes(50);
    });

    it("releases the context when the bytes are not a HEIC file", async () => {
      const freeContext = vi.spyOn(libheif, "heif_context_free");
      expect(await encoder.reencode(await syntheticPng(), "image/heic")).toBeNull();
      expect(freeContext).toHaveBeenCalledTimes(1);
    });

    it("releases every image of a multi-image file, also when the first is refused", async () => {
      const make = (width: number) => ({
        get_width: () => width,
        get_height: () => 1,
        display: vi.fn(),
        free: vi.fn(),
      });
      const images = [make(0), make(4), make(8)];
      vi.spyOn(libheif, "HeifDecoder").mockImplementation(function () {
        return { decoder: 7, decode: () => images };
      });
      const freeContext = vi
        .spyOn(libheif, "heif_context_free")
        .mockImplementation(() => undefined);
      expect(await encoder.reencode(syntheticHeic(), "image/heic")).toBeNull();
      for (const image of images) expect(image.free).toHaveBeenCalledTimes(1);
      expect(freeContext).toHaveBeenCalledWith(7);
    });

    it("refuses the file when libheif never calls back, and still releases its handles", async () => {
      vi.useFakeTimers();
      const image = { get_width: () => 4, get_height: () => 4, display: vi.fn(), free: vi.fn() };
      vi.spyOn(libheif, "HeifDecoder").mockImplementation(function () {
        return { decoder: 9, decode: () => [image] };
      });
      const freeContext = vi
        .spyOn(libheif, "heif_context_free")
        .mockImplementation(() => undefined);
      const pending = encoder.reencode(syntheticHeic(), "image/heic");
      await vi.advanceTimersByTimeAsync(HEIC_DECODE_TIMEOUT_MS);
      expect(await pending).toBeNull();
      expect(image.display).toHaveBeenCalledTimes(1);
      expect(image.free).toHaveBeenCalledTimes(1);
      expect(freeContext).toHaveBeenCalledWith(9);
    });
  });
});
