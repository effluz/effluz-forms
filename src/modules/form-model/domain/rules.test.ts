import { describe, expect, it } from "vitest";
import { evaluateRule, ruleParams, ruleSchema } from "./rules";

const ctx = { today: "2026-10-10" };

describe("ruleSchema", () => {
  it("accepts known rules with the right value types", () => {
    expect(ruleSchema.safeParse({ rule: "min_length", value: 3 }).success).toBe(true);
    expect(ruleSchema.safeParse({ rule: "not_future" }).success).toBe(true);
    expect(ruleSchema.safeParse({ rule: "min_date", value: "2020-01-01" }).success).toBe(true);
  });
  it("rejects unknown rules, negative counts and malformed dates", () => {
    expect(ruleSchema.safeParse({ rule: "bogus" }).success).toBe(false);
    expect(ruleSchema.safeParse({ rule: "max_files", value: -1 }).success).toBe(false);
    expect(ruleSchema.safeParse({ rule: "min_date", value: "01/01/2020" }).success).toBe(false);
  });
  it("rejects an unsafe regex pattern", () => {
    expect(ruleSchema.safeParse({ rule: "pattern", value: "(" }).success).toBe(false);
  });
});

describe("pattern safety", () => {
  it.each([
    "(a+)+",
    "(a|aa)+",
    "(a|a)*",
    "(abc)+",
    "(a)\\1",
    "(?=a)b",
    "(",
    "((a(b)))",
    "a{1001}",
    "a".repeat(201),
    "a*a*a*b",
    "\\d{2,}\\d{2,}\\d{2,}",
    "(a|b)*c+d{1,}",
    // Three unbounded quantifiers: over the limit of two.
    "[^@\\s]+@[^@\\s]+\\.[a-z]{2,}",
  ])("rejects %s", (value) => {
    expect(ruleSchema.safeParse({ rule: "pattern", value }).success).toBe(false);
  });

  it.each([
    "[a-z]+",
    "\\d{3}-\\d{4}",
    "(abc|def)",
    "\\(\\d+\\)",
    // Escaped parens are literals, not a group, so the quantifier is allowed.
    "\\(\\d+\\)+",
    "[a-z]+@[a-z]+",
    "\\+?\\d{7,15}",
    "a*b?c{1,3}",
    "a{1000}",
  ])("accepts %s", (value) => {
    expect(ruleSchema.safeParse({ rule: "pattern", value }).success).toBe(true);
  });
});

describe("evaluateRule", () => {
  it("length rules count user-perceived characters after trimming", () => {
    expect(evaluateRule({ rule: "min_length", value: 3 }, "  ab ", ctx)).toBe("min_length");
    expect(evaluateRule({ rule: "max_length", value: 2 }, "éé", ctx)).toBeUndefined();
    expect(evaluateRule({ rule: "max_length", value: 1 }, "👩‍👩‍👧", ctx)).toBeUndefined();
    expect(evaluateRule({ rule: "max_length", value: 0 }, "👩‍👩‍👧", ctx)).toBe("max_length");
  });
  it("pattern matches the whole string", () => {
    expect(evaluateRule({ rule: "pattern", value: "[a-z]+" }, "abc", ctx)).toBeUndefined();
    expect(evaluateRule({ rule: "pattern", value: "[a-z]+" }, "abc1", ctx)).toBe("pattern");
    expect(
      evaluateRule({ rule: "pattern", value: "[a-z]+", flags: "i" }, "ABC", ctx),
    ).toBeUndefined();
  });
  it("pattern rules refuse answers over 1000 characters", () => {
    expect(evaluateRule({ rule: "pattern", value: ".*" }, "a".repeat(1001), ctx)).toBe("pattern");
    expect(evaluateRule({ rule: "pattern", value: ".*" }, "a".repeat(1000), ctx)).toBeUndefined();
    // 1000 graphemes but 2000 code units: combining marks cannot bypass the cap.
    expect(evaluateRule({ rule: "pattern", value: ".*" }, "á".repeat(1000), ctx)).toBe("pattern");
  });
  it("number rules", () => {
    expect(evaluateRule({ rule: "min_value", value: 10 }, 9, ctx)).toBe("number_min");
    expect(evaluateRule({ rule: "max_value", value: 10 }, 10, ctx)).toBeUndefined();
  });
  it("date rules including not_future against the supplied today", () => {
    expect(evaluateRule({ rule: "not_future" }, "2026-10-11", ctx)).toBe("date_not_future");
    expect(evaluateRule({ rule: "not_future" }, "2026-10-10", ctx)).toBeUndefined();
    expect(evaluateRule({ rule: "min_date", value: "2026-01-01" }, "2025-12-31", ctx)).toBe(
      "date_min",
    );
    expect(evaluateRule({ rule: "max_date", value: "2026-01-01" }, "2026-01-02", ctx)).toBe(
      "date_max",
    );
  });
  it("selection, boolean and file count rules", () => {
    expect(evaluateRule({ rule: "min_selected", value: 2 }, ["a"], ctx)).toBe("choice_min");
    expect(evaluateRule({ rule: "max_selected", value: 1 }, ["a", "b"], ctx)).toBe("choice_max");
    expect(evaluateRule({ rule: "must_be_true" }, false, ctx)).toBe("must_be_true");
    expect(evaluateRule({ rule: "min_files", value: 1 }, [], ctx)).toBe("files_min");
    expect(evaluateRule({ rule: "max_files", value: 2 }, ["m1", "m2", "m3"], ctx)).toBe(
      "files_max",
    );
  });
  it("skips when the answer has the wrong shape; shape is the field type's job", () => {
    expect(evaluateRule({ rule: "min_length", value: 3 }, 42, ctx)).toBeUndefined();
    expect(evaluateRule({ rule: "min_value", value: 3 }, "x", ctx)).toBeUndefined();
  });
});

describe("ruleParams", () => {
  it("exposes n or date for messages", () => {
    expect(ruleParams({ rule: "min_length", value: 3 })).toEqual({ n: 3 });
    expect(ruleParams({ rule: "min_date", value: "2026-01-01" })).toEqual({ date: "2026-01-01" });
    expect(ruleParams({ rule: "not_future" })).toEqual({});
  });
});
