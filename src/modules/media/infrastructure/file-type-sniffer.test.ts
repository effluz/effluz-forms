import { describe, expect, it } from "vitest";
import {
  htmlPretendingToBeJpeg,
  syntheticHeic,
  syntheticJpegWithGps,
  syntheticMp4,
  syntheticPng,
  syntheticWebp,
} from "../../../../tests/fakes/media-files";
import { FileTypeSniffer } from "./file-type-sniffer";

describe("FileTypeSniffer", () => {
  const sniffer = new FileTypeSniffer();

  it("names each accepted type by its content", async () => {
    expect(await sniffer.sniff(await syntheticJpegWithGps())).toBe("image/jpeg");
    expect(await sniffer.sniff(await syntheticPng())).toBe("image/png");
    expect(await sniffer.sniff(await syntheticWebp())).toBe("image/webp");
    expect(await sniffer.sniff(syntheticHeic())).toMatch(/^image\/hei[cf]$/);
    expect(await sniffer.sniff(syntheticMp4())).toBe("video/mp4");
    expect(await sniffer.sniff(syntheticMp4("qt  "))).toBe("video/quicktime");
  });

  it("ignores names and declared types: HTML is not an image whatever it is called", async () => {
    expect(await sniffer.sniff(htmlPretendingToBeJpeg())).toBeNull();
    expect(await sniffer.sniff(new Uint8Array())).toBeNull();
  });
});
