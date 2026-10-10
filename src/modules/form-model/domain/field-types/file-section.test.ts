import { describe, expect, it } from "vitest";
import { fileUpload } from "./file-upload";
import { section } from "./section";

describe("file_upload", () => {
  it("defaults to 10 files of 10 MB and rejects out-of-range settings", () => {
    expect(fileUpload.settingsSchema.parse({ kinds: ["image"] })).toEqual({
      kinds: ["image"],
      maxFiles: 10,
      maxSizeMb: 10,
    });
    expect(fileUpload.settingsSchema.safeParse({ kinds: ["image"], maxFiles: 11 }).success).toBe(
      false,
    );
    expect(fileUpload.settingsSchema.safeParse({ kinds: [], maxFiles: 1 }).success).toBe(false);
    expect(fileUpload.settingsSchema.safeParse({ kinds: ["image", "image"] }).success).toBe(false);
  });
  it("caps the count by settings even without a rule and dedupes ids", () => {
    const s = { kinds: ["image" as const], maxFiles: 2, maxSizeMb: 10 };
    expect(fileUpload.normalize(["m_aaaaaaaa", "m_aaaaaaaa"], s)).toEqual(["m_aaaaaaaa"]);
    expect(fileUpload.validate(["m_aaaaaaaa", "m_bbbbbbbb", "m_cccccccc"], s)).toEqual([
      "files_max",
    ]);
  });
  it("exports the count and the ids joined", () => {
    expect(fileUpload.exportHeaders("Photos")).toEqual(["Photos (count)", "Photos (files)"]);
    expect(
      fileUpload.exportCells(
        ["m_aaaaaaaa"],
        { kinds: ["image"], maxFiles: 10, maxSizeMb: 10 },
        "en",
        "bilingual",
      ),
    ).toEqual(["1", "m_aaaaaaaa"]);
  });
  it("collects personal data", () => {
    expect(fileUpload.collectsPersonalData).toBe(true);
  });
});

describe("section", () => {
  it("is not an input, takes no answer and exports nothing", () => {
    expect(section.isInput).toBe(false);
    expect(section.answerSchema.safeParse(undefined).success).toBe(true);
    expect(section.answerSchema.safeParse("x").success).toBe(false);
    expect(section.exportHeaders("Info")).toEqual([]);
    expect(section.exportCells(undefined, { title: { en: "Info" } }, "en", "bilingual")).toEqual(
      [],
    );
  });
});
