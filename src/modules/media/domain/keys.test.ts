import { describe, expect, it } from "vitest";
import { durableKey, fieldSlug, stagingKey, stagingPrefix, uniqueFieldSlugs } from "./keys";

const RECORD = "00000001-0000-4000-8000-000000000001";
const FILE = "00000002-0000-4000-8000-000000000002";

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

  it("never gives two fields the same slug, even when a label is already suffixed", () => {
    const slugs = uniqueFieldSlugs([
      { fieldKey: "f_one", label: "Photos" },
      { fieldKey: "f_two", label: "Photos" },
      { fieldKey: "f_three", label: "Photos 2" },
      { fieldKey: "f_four", label: "Photos-2" },
    ]);
    expect(slugs.get("f_one")).toBe("photos");
    expect(slugs.get("f_two")).toBe("photos-2");
    expect(new Set(slugs.values()).size).toBe(4);
    expect(slugs.get("f_three")).not.toBe("photos-2");
  });

  it("keeps a suffixed slug within 40 characters by trimming the base first", () => {
    const long = "a".repeat(39);
    const slugs = uniqueFieldSlugs([
      { fieldKey: "f_one", label: `${long} one` },
      { fieldKey: "f_two", label: `${long} two` },
      { fieldKey: "f_three", label: `${long} three` },
    ]);
    const values = [...slugs.values()];
    expect(new Set(values).size).toBe(3);
    for (const slug of values) expect(slug.length).toBeLessThanOrEqual(40);
    expect(slugs.get("f_two")).toBe(`${"a".repeat(38)}-2`);
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
    expect(stagingPrefix(RECORD)).toBe(`in-progress/${RECORD}/`);
    expect(stagingKey(RECORD, FILE, "mp4")).toBe(`in-progress/${RECORD}/${FILE}.mp4`);
  });

  it("refuse an id that is not a UUID, so a prefix never reaches the staging root", () => {
    for (const bad of ["", "x/..", "../in-progress", "rec-1", `${RECORD}/`, "."]) {
      expect(() => stagingPrefix(bad)).toThrow();
      expect(() => stagingKey(bad, FILE, "jpg")).toThrow();
      expect(() => stagingKey(RECORD, bad, "jpg")).toThrow();
    }
  });
});
