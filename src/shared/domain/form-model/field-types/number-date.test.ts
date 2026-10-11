import { describe, expect, it } from "vitest";
import { date, isRealDate } from "./date";
import { numberType } from "./number";

describe("number", () => {
  it("rejects non-finite as shape and reports integer when required", () => {
    expect(numberType.answerSchema.safeParse(Number.NaN).success).toBe(false);
    expect(numberType.validate(2.5, { integerOnly: true })).toEqual(["integer"]);
    expect(numberType.validate(2.5, { integerOnly: false })).toEqual([]);
  });
  it("exports with the unit in the header, resolved per locale", () => {
    expect(numberType.exportHeaders("Weight")).toEqual(["Weight"]);
    expect(
      numberType.exportCells(
        2.3,
        { integerOnly: false, unit: { en: "kg", es: "kg" } },
        "es",
        "bilingual",
      ),
    ).toEqual(["2.3"]);
  });
  it("zero is a non-empty answer", () => {
    expect(numberType.isEmpty(0)).toBe(false);
  });
});

describe("date", () => {
  it("accepts only real calendar dates", () => {
    expect(isRealDate("2024-02-29")).toBe(true);
    expect(isRealDate("2026-02-29")).toBe(false);
    expect(isRealDate("2026-02-30")).toBe(false);
    expect(isRealDate("2026-13-01")).toBe(false);
  });
  it("shape accepts the ISO pattern and validate reports date_invalid for unreal dates", () => {
    expect(date.answerSchema.safeParse("2026-02-30").success).toBe(true);
    expect(date.validate("2026-02-30", {})).toEqual(["date_invalid"]);
    expect(date.answerSchema.safeParse("30/02/2026").success).toBe(false);
  });
});
