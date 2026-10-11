import { describe, expect, it } from "vitest";
import { QR_SIZES, renderQrPng, renderQrSvg } from "./qr";

const URL_UNDER_TEST = "https://forms.example.com/f/summer-camp";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("renderQrPng", () => {
  it.each(QR_SIZES)("returns a PNG %i pixels wide", async (size) => {
    const png = await renderQrPng(URL_UNDER_TEST, size);
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    // IHDR width: bytes 16 to 19, big-endian.
    expect(png.readUInt32BE(16)).toBe(size);
  });
});

describe("renderQrSvg", () => {
  it("returns an SVG document with a drawn path", async () => {
    const svg = await renderQrSvg(URL_UNDER_TEST);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<path");
  });
});
