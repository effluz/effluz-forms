import { z } from "zod";
import { defineFieldType } from "../field-type";
import { asKey, type Key, keySchema } from "../keys";
import {
  defaultOptions,
  optionLabel,
  optionLabelTexts,
  optionsSchema,
  selectionCountChecks,
} from "./choice-shared";

export const multipleChoice = defineFieldType({
  id: "multiple_choice",
  isInput: true,
  collectsPersonalData: false,
  settingsSchema: z.object({ options: optionsSchema }),
  defaultSettings: (ids) => ({ options: defaultOptions(ids) }),
  answerSchema: z.array(keySchema),
  allowedRules: ["min_selected", "max_selected"],
  allowedOperators: ["contains", "not_contains", "is_empty", "is_not_empty"],
  // Known keys come first in option order; unknown keys follow in input order so validate can report them.
  normalize: (a, s) => {
    const isOption = (k: Key): boolean => s.options.some((o) => o.key === k);
    const known = s.options.map((o) => o.key).filter((k) => a.includes(k));
    const unknown = [...new Set(a)].filter((k) => !isOption(k));
    return [...known, ...unknown];
  },
  validate: (a, s) =>
    a.every((k) => s.options.some((o) => o.key === k)) ? [] : ["unknown_option"],
  isEmpty: (a) => a.length === 0,
  exportHeaders: (label) => [label],
  exportCells: (a, s, locale, languages) => [
    (a ?? []).map((k) => optionLabel(s.options, k, locale, languages)).join("; "),
  ],
  localizedSettingsTexts: (s) => optionLabelTexts(s.options),
  publishChecks: (field, s) => selectionCountChecks(field.validation, s.options),
  fixtures: {
    settings: [
      {
        options: [
          { key: asKey("instagram"), label: { en: "Instagram", es: "Instagram" } },
          { key: asKey("facebook"), label: { en: "Facebook", es: "Facebook" } },
        ],
      },
    ],
    validAnswers: [[asKey("instagram")], [asKey("instagram"), asKey("facebook")]],
    invalidAnswers: ["instagram", [1]],
    emptyAnswer: [],
  },
});
