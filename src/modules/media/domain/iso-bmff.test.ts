import { describe, expect, it } from "vitest";
import { box, brokenMp4, syntheticMp4 } from "../../../../tests/fakes/media-files";
import { isWellFormedIsoBmff } from "./iso-bmff";

describe("isWellFormedIsoBmff", () => {
  it("accepts ftyp first, consistent sizes and a moov box", () => {
    expect(isWellFormedIsoBmff(syntheticMp4())).toBe(true);
    expect(isWellFormedIsoBmff(syntheticMp4("qt  "))).toBe(true);
  });

  it("refuses an overlong box, a missing moov, a wrong first box and tiny input", () => {
    expect(isWellFormedIsoBmff(brokenMp4())).toBe(false);
    expect(isWellFormedIsoBmff(box("ftyp", new Uint8Array(8)))).toBe(false);
    expect(
      isWellFormedIsoBmff(new Uint8Array([...box("moov"), ...box("ftyp", new Uint8Array(8))])),
    ).toBe(false);
    expect(isWellFormedIsoBmff(new Uint8Array(4))).toBe(false);
  });
});
