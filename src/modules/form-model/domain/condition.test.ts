import { describe, expect, it } from "vitest";
import { type Clause, type Condition, conditionSchema, evaluateCondition } from "./condition";

const answers = { twins: "yes", weeks: 30, tags: ["a"] };

describe("conditionSchema", () => {
  it("accepts a bare clause and flat all and any groups", () => {
    expect(conditionSchema.safeParse({ field: "twins", op: "equals", value: "yes" }).success).toBe(
      true,
    );
    expect(
      conditionSchema.safeParse({
        all: [
          { field: "twins", op: "equals", value: "yes" },
          { field: "weeks", op: "less_than", value: 32 },
        ],
      }).success,
    ).toBe(true);
    expect(
      conditionSchema.safeParse({ any: [{ field: "weeks", op: "less_than", value: 32 }] }).success,
    ).toBe(true);
  });
  it("rejects nested groups", () => {
    expect(
      conditionSchema.safeParse({
        all: [
          { field: "twins", op: "equals", value: "yes" },
          { any: [{ field: "weeks", op: "less_than", value: 32 }] },
        ],
      }).success,
    ).toBe(false);
    expect(
      conditionSchema.safeParse({ any: [{ all: [{ field: "twins", op: "is_empty" }] }] }).success,
    ).toBe(false);
  });
  it("rejects a value on an operator that takes none and a missing value on one that does", () => {
    expect(conditionSchema.safeParse({ field: "twins", op: "is_empty", value: "x" }).success).toBe(
      false,
    );
    expect(conditionSchema.safeParse({ field: "twins", op: "equals" }).success).toBe(false);
  });
});

describe("evaluateCondition", () => {
  it("evaluates clauses and groups", () => {
    expect(
      evaluateCondition({ field: "twins", op: "equals", value: "yes" } as Condition, answers),
    ).toBe(true);
    expect(
      evaluateCondition(
        {
          all: [
            { field: "twins", op: "equals", value: "yes" } as Clause,
            { field: "weeks", op: "greater_than", value: 35 } as Clause,
          ],
        },
        answers,
      ),
    ).toBe(false);
    expect(
      evaluateCondition(
        {
          any: [
            { field: "twins", op: "equals", value: "no" } as Clause,
            { field: "weeks", op: "less_than", value: 35 } as Clause,
          ],
        },
        answers,
      ),
    ).toBe(true);
  });
  it("treats an empty all as true and an empty any as false", () => {
    expect(evaluateCondition({ all: [] }, answers)).toBe(true);
    expect(evaluateCondition({ any: [] }, answers)).toBe(false);
  });
  it("treats a missing field as undefined, not as an error", () => {
    expect(evaluateCondition({ field: "nope", op: "is_empty" } as Condition, answers)).toBe(true);
  });
  it("does not read inherited properties as answers", () => {
    expect(evaluateCondition({ field: "constructor", op: "is_empty" } as Condition, {})).toBe(true);
  });
});
