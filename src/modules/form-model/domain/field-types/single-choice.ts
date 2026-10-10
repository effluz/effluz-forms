import { z } from "zod";
import { defineFieldType } from "../field-type";
import { asKey, keySchema } from "../keys";
import {
  optionLabel,
  optionLabelTexts,
  optionsSchema,
  selectionCountChecks,
} from "./choice-shared";

const settings = z.object({
  options: optionsSchema,
  display: z.enum(["radio", "dropdown"]).default("radio"),
});
type Settings = z.infer<typeof settings>;

export const DROPDOWN_MIN_OPTIONS = 7;

/** A dropdown with six or fewer options renders as radio buttons, which are easier to scan. */
export function effectiveDisplay(s: Pick<Settings, "options" | "display">): "radio" | "dropdown" {
  return s.display === "dropdown" && s.options.length >= DROPDOWN_MIN_OPTIONS
    ? "dropdown"
    : "radio";
}

export const singleChoice = defineFieldType({
  id: "single_choice",
  isInput: true,
  collectsPersonalData: false,
  settingsSchema: settings,
  answerSchema: keySchema,
  allowedRules: [],
  allowedOperators: ["equals", "not_equals", "is_one_of", "is_empty", "is_not_empty"],
  normalize: (a) => a,
  validate: (a, s) => (s.options.some((o) => o.key === a) ? [] : ["unknown_option"]),
  isEmpty: (a) => a.length === 0,
  exportHeaders: (label) => [label],
  exportCells: (a, s, locale, languages) => [
    a === undefined ? "" : optionLabel(s.options, a, locale, languages),
  ],
  localizedSettingsTexts: (s) => optionLabelTexts(s.options),
  publishChecks: (field, s) => selectionCountChecks(field.validation, s.options),
  fixtures: {
    settings: [
      {
        options: [
          { key: asKey("opt_one"), label: { en: "One", es: "Uno" } },
          { key: asKey("opt_two"), label: { en: "Two", es: "Dos" } },
        ],
        display: "radio",
      },
    ],
    validAnswers: [asKey("opt_one")],
    invalidAnswers: [1, ["opt_one"], null],
  },
});
