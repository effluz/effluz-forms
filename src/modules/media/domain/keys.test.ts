import { describe, expect, it } from "vitest";
import { durableKey, fieldSlug, stagingKey, stagingPrefix, uniqueFieldSlugs } from "./keys";

describe("fieldSlug", () => {
  it("is an ASCII slug of the label, accents removed, at most 40 characters", () => {
    expect(fieldSlug("Sube hasta 10 fotos sin editar del bebé")).toBe(
      "sube-hasta-10-fotos-sin-editar-del-bebe",
    );
    expect(fieldSlug("¿Fotos?   Ñandú  & más")).toBe("fotos-nandu-mas");
    expect(fieldSlug(`${"a".repeat(39)} bcd`)).toBe("a".repeat(39));
    expect(fieldSlug("🙂")).toBe("file");
  });
});

describe("uniqueFieldSlugs", () => {
  it("suffixes repeated slugs in field order", () => {
    expect(
      uniqueFieldSlugs([
        { fieldKey: "f_one", label: "Photos" },
        { fieldKey: "f_two", label: "photos" },
        { fieldKey: "f_three", label: "Videos" },
      ]),
    ).toEqual(
      new Map([
        ["f_one", "photos"],
        ["f_two", "photos-2"],
        ["f_three", "videos"],
      ]),
    );
  });
});

describe("durableKey and stagingKey", () => {
  it("follow the documented schemes", () => {
    expect(
      durableKey({
        formSlug: "historia-prematuro-2026",
        reference: "HP-0042",
        position: 1,
        fieldSlug: "sube-hasta-10-fotos",
        ext: "jpg",
      }),
    ).toBe("forms/historia-prematuro-2026/HP-0042/01-sube-hasta-10-fotos.jpg");
    expect(stagingPrefix("rec-1")).toBe("in-progress/rec-1/");
    expect(stagingKey("rec-1", "file-1", "mp4")).toBe("in-progress/rec-1/file-1.mp4");
  });
});
