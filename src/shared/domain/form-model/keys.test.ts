import { describe, expect, it } from "vitest";
import { keySchema, newKey } from "./keys";

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

describe("newKey", () => {
  it("builds a valid key from the prefix and the first 8 hex characters", () => {
    const key = newKey({ newId: () => "AB12CD34-ef56-4000-8000-000000000000" }, "f");
    expect(key).toBe("f_ab12cd34");
    expect(keySchema.safeParse(key).success).toBe(true);
  });

  it("starts with the requested prefix", () => {
    let n = 0;
    const ids = {
      newId: () => `${(++n).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
    };
    expect(newKey(ids, "p").startsWith("p_")).toBe(true);
    expect(newKey(ids, "o").startsWith("o_")).toBe(true);
  });

  it("surfaces a malformed id immediately", () => {
    expect(() => newKey({ newId: () => "!!!!!!!!-0000-4000-8000-000000000000" }, "f")).toThrow();
  });
});
