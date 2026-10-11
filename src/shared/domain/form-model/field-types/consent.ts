import { z } from "zod";
import { localizedTextSchema } from "@/shared/domain/localized-text";
import { consentTextVersion } from "../consent-text";
import { defineFieldType } from "../field-type";

export const consentItems = [
  "collector",
  "collected",
  "purpose",
  "storage",
  "retention",
  "team_access",
  "deletion",
  "adult_authority",
  "automated_correction",
] as const;
export type ConsentItem = (typeof consentItems)[number];

const settings = z.object({
  text: localizedTextSchema,
  coveredItems: z.array(z.enum(consentItems)).default([]),
});
type Settings = z.infer<typeof settings>;

export function isConsentChecklistComplete(s: Settings): boolean {
  return consentItems.every((item) => s.coveredItems.includes(item));
}

const YES = { en: "yes", es: "sí" } as const;

export const consent = defineFieldType({
  id: "consent",
  isInput: true,
  collectsPersonalData: false,
  settingsSchema: settings,
  defaultSettings: () => ({ text: {}, coveredItems: [] }),
  answerSchema: z.object({
    accepted: z.literal(true),
    textVersion: z.string().regex(/^[0-9a-f]{16}$/),
  }),
  allowedRules: [],
  allowedOperators: [],
  normalize: (a) => a,
  validate: (a, s) => (a.textVersion === consentTextVersion(s.text) ? [] : ["consent"]),
  isEmpty: () => false,
  exportHeaders: (label) => [label, `${label} (text version)`],
  exportCells: (a, _s, locale) => (a ? [YES[locale], a.textVersion] : ["", ""]),
  localizedSettingsTexts: (s) => [{ path: "text", text: s.text, blankCode: "unlabeled" }],
  publishChecks: (_field, s) =>
    isConsentChecklistComplete(s)
      ? []
      : [{ code: "consent_checklist", path: "settings/coveredItems" }],
  exclusiveRoles: () => [
    { role: "consent", code: "over_maximum", params: { detail: "more than one consent field" } },
  ],
  // Hiding or skipping the agreement would collect data without consent.
  alwaysRequired: true,
  requiredCode: "consent",
  neverHidden: true,
  consentRecord: (a) => ({ textVersion: a.textVersion }),
  fixtures: (() => {
    const text = { en: "I agree.", es: "Acepto." };
    return {
      settings: [{ text, coveredItems: [...consentItems] }],
      validAnswers: [{ accepted: true as const, textVersion: consentTextVersion(text) }],
      invalidAnswers: [{ accepted: false, textVersion: "0" }, true, "yes"],
    };
  })(),
});
