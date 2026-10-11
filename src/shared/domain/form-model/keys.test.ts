import { describe, expect, it } from "vitest";
import { keySchema } from "./keys";

describe("keySchema", () => {
  it("accepts lowercase alphanumeric keys starting with a letter", () => {
    expect(keySchema.safeParse("f_ab12cd34").success).toBe(true);
    expect(keySchema.safeParse("page1").success).toBe(true);
  });
  it("rejects uppercase, short, spaced or leading-digit keys", () => {
    for (const bad of ["F1", "ab", "a b", "1abc", "a".repeat(33)]) {
      expect(keySchema.safeParse(bad).success).toBe(false);
    }
  });
});
