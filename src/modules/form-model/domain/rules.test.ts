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
    "(a)\\1",
    "(?=a)b",
    "(?!a)b",
    "(?<=a)b",
    "\\k<n>",
    "(",
    // RE2 caps repeat counts at 1000 and rejects anything above at compile time.
    "a{1001}",
    "a".repeat(201),
  ])("rejects %s", (value) => {
    expect(ruleSchema.safeParse({ rule: "pattern", value }).success).toBe(false);
  });

  it.each([
    "[a-z]+",
    "\\d{3}-\\d{4}",
    "(abc|def)",
    "\\(\\d+\\)",
    "\\(\\d+\\)+",
    "[a-z]+@[a-z]+",
    "\\+?\\d{7,15}",
    "a*b?",
    "a{1000}",
    "a".repeat(200),
    // Formerly rejected by the interim subset (ADR 0013); linear time under RE2.
    "(a+)+",
    "(a|aa)+",
    "(a|a)*",
    "(abc)+",
    "((a(b)))",
    "a*a*a*b",
    "a?b?c?",
    "a{0,1000}a{0,1000}a{0,1000}a{0,1000}b",
    "[A-Z]{2}\\d{4}[A-Z]?",
    "[^@\\s]+@[^@\\s]+\\.[a-z]{2,}",
    "(Mon|Tue|Wed|Thu|Fri)",
    "(a|aa)(a|aa)(a|aa)(a|aa)(a|aa)b",
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
  it("pattern matching trims the answer and has no input length bound", () => {
    expect(evaluateRule({ rule: "pattern", value: "[a-z]+" }, "  abc ", ctx)).toBeUndefined();
    expect(evaluateRule({ rule: "pattern", value: ".*" }, "a".repeat(5000), ctx)).toBeUndefined();
  });
  it("only the i flag changes case sensitivity", () => {
    expect(evaluateRule({ rule: "pattern", value: "abc" }, "ABC", ctx)).toBe("pattern");
    expect(evaluateRule({ rule: "pattern", value: "abc", flags: "i" }, "ABC", ctx)).toBeUndefined();
  });
  it("a catastrophic pattern fails fast instead of stalling", () => {
    const started = performance.now();
    const result = evaluateRule(
      { rule: "pattern", value: "(a|aa)+" },
      "a".repeat(10_000) + "b",
      ctx,
    );
    expect(result).toBe("pattern");
    expect(performance.now() - started).toBeLessThan(500);
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
