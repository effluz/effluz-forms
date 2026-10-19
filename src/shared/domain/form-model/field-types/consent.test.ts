import { describe, expect, it } from "vitest";
import { consentTextVersion } from "../consent-text";
import {
  conditionalConsentItems,
  consent,
  consentItems,
  isConsentChecklistComplete,
} from "./consent";

const text = { en: "I am an adult and agree.", es: "Soy mayor de edad y acepto." };
const full = { text, coveredItems: [...consentItems] };
const noPlan = { postPlan: false };
const plan = { postPlan: true };

describe("consent", () => {
  it("has exactly nine checklist items", () => {
    expect(consentItems).toHaveLength(9);
  });
  it("checklist completeness requires all nine", () => {
    expect(isConsentChecklistComplete(full, noPlan)).toBe(true);
    expect(
      isConsentChecklistComplete({ text, coveredItems: consentItems.slice(0, 8) }, noPlan),
    ).toBe(false);
  });
  it("accepts later_photos as a covered item", () => {
    expect(conditionalConsentItems).toEqual(["later_photos"]);
    const parsed = consent.settingsSchema.parse({
      text: { en: "x" },
      coveredItems: ["later_photos"],
    });
    expect(parsed.coveredItems).toEqual(["later_photos"]);
  });
  it("requires later_photos only in the post-plan context", () => {
    const field = { required: false, validation: [] };
    expect(consent.publishChecks?.(field, full, noPlan)).toEqual([]);
    expect(consent.publishChecks?.(field, full, plan)).toEqual([
      { code: "consent_checklist", path: "settings/coveredItems" },
    ]);
    const all = { text, coveredItems: [...consentItems, ...conditionalConsentItems] };
    expect(consent.publishChecks?.(field, all, noPlan)).toEqual([]);
    expect(consent.publishChecks?.(field, all, plan)).toEqual([]);
  });
  it("declares the items it covers", () => {
    const all = { text, coveredItems: [...consentItems, ...conditionalConsentItems] };
    expect(consent.consentCoverage?.(all)).toEqual(all.coveredItems);
  });
  it("accepts only accepted:true with the matching text version", () => {
    const v = consentTextVersion(text);
    expect(consent.validate({ accepted: true, textVersion: v }, full)).toEqual([]);
    expect(consent.validate({ accepted: true, textVersion: "0000000000000000" }, full)).toEqual([
      "consent",
    ]);
    expect(consent.answerSchema.safeParse({ accepted: false, textVersion: v }).success).toBe(false);
  });
  it("is never empty when present and exports the accepted version", () => {
    const v = consentTextVersion(text);
    expect(consent.isEmpty({ accepted: true, textVersion: v })).toBe(false);
    expect(consent.exportHeaders("Consent")).toEqual(["Consent", "Consent (text version)"]);
    expect(
      consent.exportCells({ accepted: true, textVersion: v }, full, "en", "bilingual"),
    ).toEqual(["yes", v]);
  });
  it("asks publish to check its text", () => {
    expect(consent.localizedSettingsTexts?.(full)).toEqual([
      { path: "text", text, blankCode: "unlabeled" },
    ]);
  });
  it("reports an incomplete checklist at settings/coveredItems", () => {
    const field = { required: false, validation: [] };
    expect(consent.publishChecks?.(field, full, noPlan)).toEqual([]);
    expect(
      consent.publishChecks?.(field, { text, coveredItems: consentItems.slice(1) }, noPlan),
    ).toEqual([{ code: "consent_checklist", path: "settings/coveredItems" }]);
  });
  it("allows one consent field per form", () => {
    expect(consent.exclusiveRoles?.(full)).toEqual([
      { role: "consent", code: "over_maximum", params: { detail: "more than one consent field" } },
    ]);
  });
  it("is always required, reports the consent code and is never hidden", () => {
    expect(consent.alwaysRequired).toBe(true);
    expect(consent.requiredCode).toBe("consent");
    expect(consent.neverHidden).toBe(true);
  });
  it("records the accepted text version", () => {
    const v = consentTextVersion(text);
    expect(consent.consentRecord?.({ accepted: true, textVersion: v })).toEqual({
      textVersion: v,
    });
  });
});

describe("consent default settings", () => {
  it("parses, with empty text and every checklist item unchecked", () => {
    const defaults = consent.defaultSettings({
      newId: () => "00000001-0000-4000-8000-000000000000",
    });
    expect(consent.settingsSchema.safeParse(defaults).success).toBe(true);
    expect(defaults).toEqual({ text: {}, coveredItems: [] });
  });
});
