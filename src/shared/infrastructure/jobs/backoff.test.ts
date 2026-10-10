import { describe, expect, it } from "vitest";
import { backoffMs } from "./backoff";

describe("backoffMs", () => {
  it("doubles per attempt with jitter and caps at one hour", () => {
    expect(backoffMs(1, () => 0)).toBe(2_000);
    expect(backoffMs(3, () => 0)).toBe(8_000);
    expect(backoffMs(3, () => 1)).toBe(10_000);
    expect(backoffMs(20, () => 1)).toBe(3_600_000);
  });
});
