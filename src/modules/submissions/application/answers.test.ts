import { describe, expect, it } from "vitest";
import { LIMITS } from "@/shared/domain/form-model";
import { pageRaw } from "./answers";

describe("pageRaw", () => {
  it("keeps the parts of a multi-part control, such as a date's day, month and year", () => {
    expect(
      pageRaw(
        { "f_born.day": "3", "f_born.month": "4", "f_born.year": "2020", f_borne: "x" },
        ["f_born"],
      ),
    ).toEqual({ "f_born.day": "3", "f_born.month": "4", "f_born.year": "2020" });
  });

  it("cuts a typed value to the longest answer a field can take, and a list to the most options", () => {
    const long = "a".repeat(LIMITS.longTextMax + 50);
    const many = Array.from({ length: LIMITS.optionsPerChoice + 5 }, () => long);
    const kept = pageRaw({ f_story: long, f_pick: many }, ["f_story", "f_pick"]);
    expect(kept.f_story).toHaveLength(LIMITS.longTextMax);
    expect(kept.f_pick).toHaveLength(LIMITS.optionsPerChoice);
    expect((kept.f_pick as string[]).every((v) => v.length === LIMITS.longTextMax)).toBe(true);
  });

  it("never splits a character made of two code units", () => {
    const value = `${"a".repeat(LIMITS.longTextMax - 1)}😀`;
    expect(pageRaw({ f_story: value }, ["f_story"]).f_story).toBe(
      "a".repeat(LIMITS.longTextMax - 1),
    );
  });
});
