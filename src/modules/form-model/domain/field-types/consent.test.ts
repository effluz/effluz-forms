import { describe, expect, it } from "vitest";
import { consentTextVersion } from "../consent-text";
import { consent, consentItems, isConsentChecklistComplete } from "./consent";

const text = { en: "I am an adult and agree.", es: "Soy mayor de edad y acepto." };
const full = { text, coveredItems: [...consentItems] };

describe("consent", () => {
  it("has exactly nine checklist items", () => {
    expect(consentItems).toHaveLength(9);
  });
  it("checklist completeness requires all nine", () => {
    expect(isConsentChecklistComplete(full)).toBe(true);
    expect(isConsentChecklistComplete({ text, coveredItems: consentItems.slice(0, 8) })).toBe(
      false,
    );
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
    expect(consent.publishChecks?.(field, full)).toEqual([]);
    expect(consent.publishChecks?.(field, { text, coveredItems: consentItems.slice(1) })).toEqual([
      { code: "consent_checklist", path: "settings/coveredItems" },
    ]);
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
