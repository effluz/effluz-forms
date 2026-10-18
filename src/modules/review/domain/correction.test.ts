import { describe, expect, it } from "vitest";
import { checkCorrection } from "./correction";

describe("correction text", () => {
  it("normalizes line ends and enforces the field's limit", () => {
    expect(checkCorrection("Hola\r\nmundo", 100)).toEqual({ ok: true, text: "Hola\nmundo" });
    expect(checkCorrection("Hola\rmundo", 100)).toEqual({ ok: true, text: "Hola\nmundo" });
    expect(checkCorrection("  \n ", 100)).toEqual({
      ok: false,
      code: "correction_blank",
      max: 100,
    });

    const family = "👨‍👩‍👧‍👦";
    expect(checkCorrection(`${family}abcd`, 5)).toEqual({ ok: true, text: `${family}abcd` });
    expect(checkCorrection("abcdef", 5)).toEqual({
      ok: false,
      code: "correction_too_long",
      max: 5,
    });
  });
});
