import { describe, expect, it } from "vitest";
import { formatReference } from "./reference";

describe("formatReference", () => {
  it("pads to four digits and grows past them", () => {
    expect(formatReference("HP", 1)).toBe("HP-0001");
    expect(formatReference("HP", 12345)).toBe("HP-12345");
  });
});
