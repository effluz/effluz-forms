import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFieldType } from "./field-type";
import { createRegistry, UnknownFieldTypeError } from "./registry";

const stub = defineFieldType({
  id: "checkbox",
  isInput: true,
  collectsPersonalData: false,
  settingsSchema: z.object({}),
  answerSchema: z.boolean(),
  allowedRules: ["must_be_true"],
  allowedOperators: ["equals", "not_equals"],
  normalize: (a) => a,
  validate: () => [],
  isEmpty: (a) => !a,
  exportHeaders: (label) => [label],
  exportCells: (a) => [a === undefined ? "" : a ? "yes" : "no"],
  fixtures: { settings: [{}], validAnswers: [true], invalidAnswers: ["yes"], emptyAnswer: false },
});

describe("createRegistry", () => {
  it("returns definitions by id and lists them", () => {
    const r = createRegistry([stub]);
    expect(r.get("checkbox").id).toBe("checkbox");
    expect(r.has("checkbox")).toBe(true);
    expect(r.has("nope")).toBe(false);
    expect(r.list()).toHaveLength(1);
  });
  it("throws a typed error for unknown ids", () => {
    expect(() => createRegistry([stub]).get("nope")).toThrow(UnknownFieldTypeError);
  });
  it("rejects duplicate ids", () => {
    expect(() => createRegistry([stub, stub])).toThrow(/duplicate/);
  });
});
