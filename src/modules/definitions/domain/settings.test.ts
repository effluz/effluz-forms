import { describe, expect, it } from "vitest";
import {
  changedKeys,
  checkSettings,
  defaultSettings,
  isTimeZone,
  referencePrefixFromSlug,
  settingsSchema,
  type FormSettings,
} from "./settings";

const ctx = { allowedRecipientDomains: ["effluz.com", "partner.example"] };

function settings(overrides: Partial<FormSettings> = {}): FormSettings {
  return { ...defaultSettings("historias-bebe"), ...overrides };
}

describe("referencePrefixFromSlug", () => {
  it("takes the initials of the words", () => {
    expect(referencePrefixFromSlug("historias-bebe-prematuro")).toBe("HBP");
  });

  it("counts a digits-only word by its first digit", () => {
    expect(referencePrefixFromSlug("preemie-stories-2026-panama-city")).toBe("PS2PC");
  });

  it("takes the first letters of the first word when there is one word", () => {
    expect(referencePrefixFromSlug("effluz2026")).toBe("EF");
  });

  it("repeats a single letter", () => {
    expect(referencePrefixFromSlug("x")).toBe("XX");
  });

  it("cuts to six characters", () => {
    expect(referencePrefixFromSlug("a-b-c-d-e-f-g-h")).toBe("ABCDEF");
  });
});

describe("defaultSettings", () => {
  it("derives the prefix and applies the documented defaults", () => {
    const s = defaultSettings("historias-bebe");
    expect(s.referencePrefix).toBe("HB");
    expect(s.retentionMonths).toBe(12);
    expect(s.timezone).toBe("America/Panama");
    expect(s.notificationCadence).toBe("per_submission");
    expect(s.notificationRecipients).toEqual([]);
    expect(s.digestHour).toBe(9);
    expect(s.botChallenge).toBe(false);
    expect(s.allowAnotherResponse).toBe(false);
    expect(s.opensAt).toBeUndefined();
    expect(s.closesAt).toBeUndefined();
  });
});

describe("settingsSchema", () => {
  it("trims and lowercases recipients", () => {
    const parsed = settingsSchema.parse({
      referencePrefix: "HB",
      notificationRecipients: ["  Someone@Effluz.com "],
    });
    expect(parsed.notificationRecipients).toEqual(["someone@effluz.com"]);
  });

  it("rejects an hour above 23", () => {
    expect(settingsSchema.safeParse({ referencePrefix: "HB", digestHour: 24 }).success).toBe(false);
  });

  it("rejects more than 20 recipients", () => {
    const many = Array.from({ length: 21 }, (_, i) => `u${String(i)}@effluz.com`);
    expect(
      settingsSchema.safeParse({ referencePrefix: "HB", notificationRecipients: many }).success,
    ).toBe(false);
  });

  it("accepts UTC instants for the date window", () => {
    const parsed = settingsSchema.parse({
      referencePrefix: "HB",
      opensAt: "2026-10-10T14:00:00Z",
      closesAt: "2026-10-20T14:00:00Z",
    });
    expect(parsed.opensAt).toBe("2026-10-10T14:00:00Z");
  });
});

describe("checkSettings", () => {
  it("accepts the defaults", () => {
    expect(checkSettings(settings(), ctx)).toEqual([]);
  });

  it("accepts an effluz.com recipient and an allowlisted partner domain", () => {
    const s = settings({
      notificationRecipients: ["someone@effluz.com", "partner@partner.example"],
    });
    expect(checkSettings(s, ctx)).toEqual([]);
  });

  it("refuses an effluz.com recipient when the list does not contain the domain", () => {
    const s = settings({ notificationRecipients: ["someone@effluz.com"] });
    expect(checkSettings(s, { allowedRecipientDomains: ["partner.example"] })).toEqual([
      { code: "recipient_domain", path: "notificationRecipients.0", params: { index: 0 } },
    ]);
  });

  it("flags a recipient outside the allowed domains with its index", () => {
    const s = settings({ notificationRecipients: ["ok@effluz.com", "x@elsewhere.example"] });
    expect(checkSettings(s, ctx)).toEqual([
      { code: "recipient_domain", path: "notificationRecipients.1", params: { index: 1 } },
    ]);
  });

  it("flags a recipient without a single @ and non-empty parts", () => {
    const bad = ["nobody", "a@@effluz.com", "@effluz.com", "a@", "a@b@effluz.com"];
    const issues = checkSettings(settings({ notificationRecipients: bad }), ctx);
    expect(issues.map((i) => i.code)).toEqual(bad.map(() => "recipient_syntax"));
    expect(issues.map((i) => i.params)).toEqual(bad.map((_, index) => ({ index })));
  });

  it("flags more than 20 recipients", () => {
    const many = Array.from({ length: 21 }, (_, i) => `u${String(i)}@effluz.com`);
    const issues = checkSettings(settings({ notificationRecipients: many }), ctx);
    expect(issues).toEqual([
      { code: "too_many_recipients", path: "notificationRecipients", params: { max: 20 } },
    ]);
  });

  it("flags a malformed prefix", () => {
    for (const referencePrefix of ["a", "ab", "A", "ABCDEFG", "AB-C"]) {
      expect(checkSettings(settings({ referencePrefix }), ctx)).toEqual([
        { code: "prefix_format", path: "referencePrefix" },
      ]);
    }
  });

  it("flags retention outside 1 to 36", () => {
    for (const retentionMonths of [0, 37]) {
      expect(checkSettings(settings({ retentionMonths }), ctx)).toEqual([
        { code: "retention_range", path: "retentionMonths", params: { min: 1, max: 36 } },
      ]);
    }
    expect(checkSettings(settings({ retentionMonths: 1 }), ctx)).toEqual([]);
    expect(checkSettings(settings({ retentionMonths: 36 }), ctx)).toEqual([]);
  });

  it("flags a close date that is not after the open date", () => {
    const equal = settings({ opensAt: "2026-10-10T14:00:00Z", closesAt: "2026-10-10T14:00:00Z" });
    const before = settings({ opensAt: "2026-10-10T14:00:00Z", closesAt: "2026-10-09T14:00:00Z" });
    for (const s of [equal, before]) {
      expect(checkSettings(s, ctx)).toEqual([{ code: "date_order", path: "closesAt" }]);
    }
  });

  it("accepts a window with only one bound", () => {
    expect(checkSettings(settings({ closesAt: "2026-10-09T14:00:00Z" }), ctx)).toEqual([]);
  });

  it("flags an unknown timezone", () => {
    expect(checkSettings(settings({ timezone: "Mars/Olympus" }), ctx)).toEqual([
      { code: "timezone_unknown", path: "timezone" },
    ]);
  });

  it("flags an hour outside 0 to 23", () => {
    expect(checkSettings(settings({ digestHour: 24 }), ctx)).toEqual([
      { code: "hour_range", path: "digestHour" },
    ]);
  });

  it("matches allowlisted domains regardless of case", () => {
    const s = settings({ notificationRecipients: ["partner@partner.example"] });
    expect(checkSettings(s, { allowedRecipientDomains: ["Partner.Example"] })).toEqual([]);
  });
});

describe("isTimeZone", () => {
  it("accepts IANA identifiers", () => {
    expect(isTimeZone("America/Panama")).toBe(true);
    expect(isTimeZone("Europe/Madrid")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
  });

  it("rejects unknown identifiers", () => {
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("")).toBe(false);
  });
});

describe("changedKeys", () => {
  it("lists only the keys whose values differ", () => {
    const before = settings();
    const after = settings({ retentionMonths: 24, notificationRecipients: ["a@effluz.com"] });
    expect(changedKeys(before, after).sort()).toEqual([
      "notificationRecipients",
      "retentionMonths",
    ]);
  });

  it("lists a date added or removed", () => {
    const before = settings();
    const after = settings({ opensAt: "2026-10-10T14:00:00Z" });
    expect(changedKeys(before, after)).toEqual(["opensAt"]);
    expect(changedKeys(after, before)).toEqual(["opensAt"]);
  });

  it("is empty for equal settings", () => {
    expect(changedKeys(settings(), settings())).toEqual([]);
  });
});
