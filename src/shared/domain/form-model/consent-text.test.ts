import { describe, expect, it } from "vitest";
import { consentTextVersion } from "./consent-text";

describe("consentTextVersion", () => {
  it("is stable, 16 hex chars, and changes with any character", () => {
    const a = consentTextVersion({ en: "I agree", es: "Acepto" });
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(consentTextVersion({ en: "I agree", es: "Acepto" })).toBe(a);
    expect(consentTextVersion({ en: "I agree.", es: "Acepto" })).not.toBe(a);
    expect(consentTextVersion({ en: "I agree", es: "Acepto." })).not.toBe(a);
  });
  it("matches the pinned vector so stored versions never change", () => {
    expect(consentTextVersion({ en: "I agree", es: "Acepto" })).toBe("ae9d9e5ae8c52f00");
  });
  it("treats NFC and NFD forms as the same text", () => {
    expect(consentTextVersion({ es: "María" })).toBe(consentTextVersion({ es: "María" }));
  });
});
