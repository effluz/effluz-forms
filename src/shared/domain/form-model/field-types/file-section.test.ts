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
      { code: "files_max", params: { n: 2 } },
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
  it("reports a file-count rule beyond the settings cap at validation", () => {
    const s = { kinds: ["image" as const], maxFiles: 3, maxSizeMb: 10 };
    const field = (validation: { rule: "min_files" | "max_files"; value: number }[]) => ({
      required: false,
      validation,
    });
    expect(
      fileUpload.publishChecks?.(field([{ rule: "min_files", value: 4 }]), s, { postPlan: false }),
    ).toEqual([
      { code: "over_maximum", path: "validation", params: { detail: "min_files 4 > 3 files" } },
    ]);
    expect(
      fileUpload.publishChecks?.(field([{ rule: "max_files", value: 5 }]), s, { postPlan: false }),
    ).toEqual([
      { code: "over_maximum", path: "validation", params: { detail: "max_files 5 > 3 files" } },
    ]);
    expect(
      fileUpload.publishChecks?.(field([{ rule: "max_files", value: 3 }]), s, { postPlan: false }),
    ).toEqual([]);
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
  it("asks publish to check its title and its optional description", () => {
    const title = { en: "Info", es: "Información" };
    expect(section.localizedSettingsTexts?.({ title })).toEqual([
      { path: "title", text: title, blankCode: "unlabeled" },
      { path: "description", text: undefined, blankCode: null },
    ]);
    const description = { en: "More" };
    expect(section.localizedSettingsTexts?.({ title, description })[1]).toEqual({
      path: "description",
      text: description,
      blankCode: null,
    });
  });
});

describe("default settings", () => {
  const ids = { newId: () => "00000001-0000-4000-8000-000000000000" };
  it("file_upload parses its own minimum: one image kind, one file", () => {
    const defaults = fileUpload.defaultSettings(ids);
    expect(fileUpload.settingsSchema.safeParse(defaults).success).toBe(true);
    expect(defaults).toMatchObject({ kinds: ["image"], maxFiles: 1 });
  });
  it("section parses its own defaults with an empty title", () => {
    const defaults = section.defaultSettings(ids);
    expect(section.settingsSchema.safeParse(defaults).success).toBe(true);
    expect(defaults).toEqual({ title: {} });
  });
});
