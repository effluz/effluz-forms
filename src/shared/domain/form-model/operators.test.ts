import { describe, expect, it } from "vitest";
import { OPERATORS } from "./operators";

describe("operators", () => {
  it("equals compares primitives strictly and arrays by membership-free equality", () => {
    expect(OPERATORS.equals.evaluate("a", "a")).toBe(true);
    expect(OPERATORS.equals.evaluate(1, "1")).toBe(false);
    expect(OPERATORS.not_equals.evaluate(true, false)).toBe(true);
  });
  it("contains works on strings and arrays", () => {
    expect(OPERATORS.contains.evaluate("hello world", "world")).toBe(true);
    expect(OPERATORS.contains.evaluate(["a", "b"], "b")).toBe(true);
    expect(OPERATORS.not_contains.evaluate(["a"], "b")).toBe(true);
    expect(OPERATORS.contains.evaluate(undefined, "x")).toBe(false);
  });
  it("is_empty treats undefined, blank strings and empty arrays as empty", () => {
    for (const empty of [undefined, null, "", "  ", []]) {
      expect(OPERATORS.is_empty.evaluate(empty, undefined)).toBe(true);
      expect(OPERATORS.is_not_empty.evaluate(empty, undefined)).toBe(false);
    }
    expect(OPERATORS.is_empty.evaluate(0, undefined)).toBe(false);
  });
  it("greater_than and less_than compare numbers and ISO dates, never mixed types", () => {
    expect(OPERATORS.greater_than.evaluate(5, 3)).toBe(true);
    expect(OPERATORS.less_than.evaluate("2026-01-01", "2026-02-01")).toBe(true);
    expect(OPERATORS.greater_than.evaluate("5", 3)).toBe(false);
  });
  it("is_one_of checks membership of a primitive in a list", () => {
    expect(OPERATORS.is_one_of.evaluate("b", ["a", "b"])).toBe(true);
    expect(OPERATORS.is_one_of.evaluate("c", ["a", "b"])).toBe(false);
    expect(OPERATORS.is_one_of.evaluate("a", "a")).toBe(false);
  });
  it("never throws on odd inputs", () => {
    for (const op of Object.values(OPERATORS)) {
      expect(() => op.evaluate({ a: 1 }, Symbol("x"))).not.toThrow();
    }
  });
});
