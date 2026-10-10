import { describe, expect, it } from "vitest";
import { email } from "./email";
import { longText } from "./long-text";
import { phone } from "./phone";
import { shortText } from "./short-text";

describe("short_text", () => {
  it("trims, NFC-normalizes and strips zero-width characters", () => {
    const raw = "  Ana​ María  ";
    expect(shortText.normalize(raw, {})).toBe("Ana María");
  });
  it("rejects answers over the system maximum as max_length", () => {
    expect(shortText.validate("x".repeat(5_001), {})).toEqual(["max_length"]);
    expect(shortText.validate("x".repeat(5_000), {})).toEqual([]);
  });
  it("reports blank as empty", () => {
    expect(shortText.isEmpty("   ")).toBe(true);
  });
});

describe("long_text", () => {
  it("defaults rows to 4 and caps at 12", () => {
    expect(longText.settingsSchema.parse({})).toEqual({ rows: 4 });
    expect(longText.settingsSchema.safeParse({ rows: 13 }).success).toBe(false);
  });
  it("allows up to 20,000 characters and keeps internal newlines", () => {
    expect(longText.validate("x".repeat(20_000), { rows: 4 })).toEqual([]);
    expect(longText.normalize("a\n\nb\n", { rows: 4 })).toBe("a\n\nb");
  });
});

describe("email", () => {
  it("lowercases and trims", () => {
    expect(email.normalize("  Ana@Example.COM ", { isSubmitterAddress: false })).toBe(
      "ana@example.com",
    );
  });
  it("flags syntax errors as email_syntax", () => {
    for (const bad of ["ana", "ana@", "@example.com", "ana@example", "ana example@x.com"]) {
      expect(email.validate(bad, { isSubmitterAddress: false })).toEqual(["email_syntax"]);
    }
    expect(email.validate("ana.maria+x@example.com", { isSubmitterAddress: false })).toEqual([]);
  });
  it("collects personal data", () => {
    expect(email.collectsPersonalData).toBe(true);
    expect(phone.collectsPersonalData).toBe(true);
  });
});

describe("phone", () => {
  it("keeps digits, plus, spaces, dashes and parentheses only", () => {
    expect(phone.normalize(" +507 6123-4567 ext.2", {})).toBe("+507 6123-4567 2");
  });
  it("needs at least 6 digits", () => {
    expect(phone.validate("12345", {})).toEqual(["pattern"]);
    expect(phone.validate("+507 6123 4567", {})).toEqual([]);
  });
});
