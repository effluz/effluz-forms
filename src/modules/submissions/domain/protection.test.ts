import { describe, expect, it } from "vitest";
import {
  HONEYPOT_FIELD,
  MIN_FILL_MS,
  decoyReference,
  isHoneypotFilled,
  isSilentAccept,
} from "./protection";

const startedAt = new Date("2026-10-10T12:00:00.000Z");

describe("public form abuse protection", () => {
  it("names the honeypot input and the minimum fill time", () => {
    expect(HONEYPOT_FIELD).toBe("website-url");
    expect(MIN_FILL_MS).toBe(3_000);
  });

  it("catches a filled honeypot and anything faster than 3 seconds", () => {
    expect(
      isSilentAccept({
        honeypot: "http://spam.example",
        startedAt,
        now: new Date("2026-10-10T12:05:00.000Z"),
      }),
    ).toBe(true);
    expect(
      isSilentAccept({ honeypot: "", startedAt, now: new Date("2026-10-10T12:00:02.999Z") }),
    ).toBe(true);
    expect(
      isSilentAccept({ honeypot: "  ", startedAt, now: new Date("2026-10-10T12:00:03.000Z") }),
    ).toBe(false);
  });

  it("calls a honeypot filled only when it holds more than blanks", () => {
    expect(isHoneypotFilled("x")).toBe(true);
    expect(isHoneypotFilled(" \t")).toBe(false);
  });

  it("makes a four-digit decoy reference with the form's prefix", () => {
    expect(decoyReference("HP", () => 0)).toBe("HP-1000");
    expect(decoyReference("HP", () => 0.9999)).toBe("HP-9999");
  });
});
