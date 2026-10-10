import { describe, expect, it } from "vitest";
import { defineFieldType } from "../field-type";
import { checkbox } from "./checkbox";
import { conformanceChecks } from "./conformance-checks";

const failing = (def: Parameters<typeof conformanceChecks>[0]) =>
  conformanceChecks(def)
    .filter((c) => !c.ok)
    .map((c) => c.name);

describe("conformanceChecks", () => {
  it("passes a conforming type", () => {
    expect(failing(checkbox)).toEqual([]);
  });
  it("fails the export check when cells and headers disagree", () => {
    const broken = defineFieldType({
      ...checkbox,
      exportHeaders: (label) => [label, `${label} (note)`],
    });
    expect(failing(broken)).toEqual(["exports one cell per header"]);
  });
  it("fails the limit check when an over-limit outcome has no numeric n", () => {
    const broken = defineFieldType({
      ...checkbox,
      validate: (a) => (a ? [] : ["max_length"]),
      fixtures: { ...checkbox.fixtures, overLimitAnswers: [false] },
    });
    expect(failing(broken)).toEqual(["reports limits with a numeric n"]);
  });
  it("reports a check that throws as failed instead of throwing", () => {
    const broken = defineFieldType({
      ...checkbox,
      isEmpty: () => {
        throw new Error("boom");
      },
    });
    const check = conformanceChecks(broken).find((c) => c.name === "classifies empty answers");
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain("boom");
  });
});
