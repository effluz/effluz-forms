import { describe, expect, it } from "vitest";
import { fieldTypeIds } from "../field-type";
import { OPERATORS } from "../operators";
import { buildDefaultRegistry, operatorsFor } from "./index";

describe("default registry", () => {
  const registry = buildDefaultRegistry();
  it("contains every first-release field type exactly once", () => {
    expect([...registry.list().map((d) => d.id)].sort()).toEqual([...fieldTypeIds].sort());
  });
  it("lists operators compatible with a type, needing a value or not", () => {
    const ops = operatorsFor(registry, "number").map((o) => o.id);
    expect(ops).toEqual([
      "equals",
      "not_equals",
      "greater_than",
      "less_than",
      "is_empty",
      "is_not_empty",
    ]);
    expect(operatorsFor(registry, "section")).toEqual([]);
    expect(operatorsFor(registry, "checkbox")).toEqual([OPERATORS.equals, OPERATORS.not_equals]);
  });
});
