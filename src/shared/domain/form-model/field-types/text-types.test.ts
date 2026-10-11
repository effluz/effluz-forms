import { describe, expect, it } from "vitest";
import { email } from "./email";
import { longText } from "./long-text";
import { phone } from "./phone";
import { shortText } from "./short-text";

describe("short_text", () => {
  it("composes a decomposed accent to NFC", () => {
    expect(shortText.normalize("Mari\u0301a", {})).toBe("Mar\u00EDa");
  });
  it("trims, NFC-normalizes and strips zero-width characters", () => {
    const raw = "  Ana\u200B María  ";
    expect(shortText.normalize(raw, {})).toBe("Ana María");
  });
  it("strips U+200B, U+2060 and U+FEFF", () => {
    expect(shortText.normalize("a\u200Bb\u2060c\uFEFF", {})).toBe("abc");
  });
  it("keeps zero-width joiners so emoji sequences survive", () => {
    const family = "\u{1F469}\u200D\u{1F469}\u200D\u{1F467}";
    expect(shortText.normalize(family, {})).toBe(family);
  });
  it("keeps zero-width non-joiners so Persian text survives", () => {
    const persian = "می\u200Cخواهم";
    expect(shortText.normalize(persian, {})).toBe(persian);
  });
  it("rejects answers over the system maximum as max_length", () => {
    expect(shortText.validate("x".repeat(5_001), {})).toEqual([
      { code: "max_length", params: { n: 5_000 } },
    ]);
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
    expect(longText.validate("x".repeat(20_001), { rows: 4 })).toEqual([
      { code: "max_length", params: { n: 20_000 } },
    ]);
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
  it("caps length at 254 graphemes before the syntax check", () => {
    expect(email.validate("a".repeat(250) + "@x.co", { isSubmitterAddress: false })).toEqual([
      { code: "max_length", params: { n: 254 } },
    ]);
    expect(email.validate("a".repeat(249) + "@x.co", { isSubmitterAddress: false })).toEqual([]);
  });
  it("collects personal data", () => {
    expect(email.collectsPersonalData).toBe(true);
    expect(phone.collectsPersonalData).toBe(true);
  });
  it("holds the submitter address role only when marked as the submitter address", () => {
    expect(email.exclusiveRoles?.({ isSubmitterAddress: true })).toEqual([
      { role: "submitter_address", code: "submitter_email_dup" },
    ]);
    expect(email.exclusiveRoles?.({ isSubmitterAddress: false })).toEqual([]);
  });
});

describe("phone", () => {
  it("keeps the number as typed, trimming and collapsing whitespace only", () => {
    expect(phone.normalize(" +507 6123-4567 ext.2", {})).toBe("+507 6123-4567 ext.2");
    expect(phone.normalize("+507  6123\t4567", {})).toBe("+507 6123 4567");
  });
  it("needs at least 6 digits", () => {
    expect(phone.validate("12345", {})).toEqual(["pattern"]);
    expect(phone.validate("+507 6123 4567", {})).toEqual([]);
  });
  it("caps length at shortTextMax before counting digits", () => {
    expect(phone.validate("1".repeat(5_001), {})).toEqual([
      { code: "max_length", params: { n: 5_000 } },
    ]);
    expect(phone.validate("1".repeat(5_000), {})).toEqual([]);
  });
});

describe("default settings", () => {
  const ids = { newId: () => "00000001-0000-4000-8000-000000000000" };
  it.each([shortText, longText, email, phone].map((d) => [d.id, d] as const))(
    "%s parses its own defaults",
    (_id, def) => {
      expect(def.settingsSchema.safeParse(def.defaultSettings(ids)).success).toBe(true);
    },
  );
});
