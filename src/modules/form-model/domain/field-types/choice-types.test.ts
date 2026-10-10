import { describe, expect, it } from "vitest";
import { asKey } from "../keys";
import { checkbox } from "./checkbox";
import { optionsSchema } from "./choice-shared";
import { multipleChoice } from "./multiple-choice";
import { effectiveDisplay, singleChoice } from "./single-choice";

const options = [
  { key: asKey("single"), label: { en: "One baby", es: "Un solo bebé" } },
  { key: asKey("twins"), label: { en: "Twins", es: "Gemelar" } },
];

describe("options", () => {
  it("requires unique keys and at most 50", () => {
    expect(optionsSchema.safeParse([options[0], options[0]]).success).toBe(false);
    expect(
      optionsSchema.safeParse(
        Array.from({ length: 51 }, (_, i) => ({ key: `opt${String(i)}`, label: { en: "x" } })),
      ).success,
    ).toBe(false);
    expect(optionsSchema.safeParse([]).success).toBe(false);
  });
});

describe("single_choice", () => {
  const s = { options, display: "radio" as const };
  it("reports an answer that is not an option key as unknown_option", () => {
    expect(singleChoice.validate(asKey("triplets"), s)).toEqual(["unknown_option"]);
    expect(singleChoice.validate(asKey("twins"), s)).toEqual([]);
  });
  it("falls back to radio with six or fewer options", () => {
    expect(effectiveDisplay({ options, display: "dropdown" })).toBe("radio");
    const seven = Array.from({ length: 7 }, (_, i) => ({
      key: asKey(`opt_${String(i)}`),
      label: { en: "x" },
    }));
    expect(effectiveDisplay({ options: seven, display: "dropdown" })).toBe("dropdown");
  });
  it("exports the label in the requested locale", () => {
    expect(singleChoice.exportCells(asKey("twins"), s, "es", "bilingual")).toEqual(["Gemelar"]);
    expect(singleChoice.exportCells(undefined, s, "es", "bilingual")).toEqual([""]);
  });
});

describe("multiple_choice", () => {
  const s = { options };
  it("normalizes to unique keys in option order", () => {
    expect(multipleChoice.normalize([asKey("twins"), asKey("single"), asKey("twins")], s)).toEqual([
      "single",
      "twins",
    ]);
  });
  it("keeps unknown keys after known ones so validation reports them", () => {
    expect(
      multipleChoice.normalize([asKey("twins"), asKey("nope"), asKey("single"), asKey("twins")], s),
    ).toEqual(["single", "twins", "nope"]);
    expect(
      multipleChoice.validate(multipleChoice.normalize([asKey("single"), asKey("nope")], s), s),
    ).toEqual(["unknown_option"]);
  });
  it("flags unknown keys and exports joined labels", () => {
    expect(multipleChoice.validate([asKey("single"), asKey("nope")], s)).toEqual([
      "unknown_option",
    ]);
    expect(
      multipleChoice.exportCells([asKey("single"), asKey("twins")], s, "en", "bilingual"),
    ).toEqual(["One baby; Twins"]);
  });
  it("empty array is empty", () => {
    expect(multipleChoice.isEmpty([])).toBe(true);
  });
});

describe("checkbox", () => {
  it("false is empty for required purposes and exports yes/no words", () => {
    expect(checkbox.isEmpty(false)).toBe(true);
    expect(checkbox.exportCells(true, {}, "es", "bilingual")).toEqual(["sí"]);
    expect(checkbox.exportCells(false, {}, "en", "bilingual")).toEqual(["no"]);
  });
});
