import { describe, expect, it } from "vitest";
import { isUuid } from "./uuid";

describe("isUuid", () => {
  it("accepts a canonical UUID in either case", () => {
    expect(isUuid("3f1c2a9e-8b7d-4c6e-9f0a-1b2c3d4e5f60")).toBe(true);
    expect(isUuid("3F1C2A9E-8B7D-4C6E-9F0A-1B2C3D4E5F60")).toBe(true);
  });

  it.each([
    ["an arbitrary word", "gone"],
    ["an empty string", ""],
    ["a UUID without hyphens", "3f1c2a9e8b7d4c6e9f0a1b2c3d4e5f60"],
    ["a UUID with a trailing character", "3f1c2a9e-8b7d-4c6e-9f0a-1b2c3d4e5f60x"],
    ["a UUID in braces", "{3f1c2a9e-8b7d-4c6e-9f0a-1b2c3d4e5f60}"],
    ["a non-hex digit", "3f1c2a9e-8b7d-4c6e-9f0a-1b2c3d4e5f6g"],
  ])("rejects %s", (_name, value) => {
    expect(isUuid(value)).toBe(false);
  });
});
