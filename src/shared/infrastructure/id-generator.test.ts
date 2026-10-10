import { describe, expect, it } from "vitest";
import { systemIdGenerator } from "./id-generator";

describe("systemIdGenerator", () => {
  it("returns lowercase v4 UUIDs that do not repeat", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => systemIdGenerator.newId()));
    expect(ids.size).toBe(1000);
    for (const id of ids)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
