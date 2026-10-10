import { z } from "zod";
import { defineFieldType } from "../field-type";
import { asKey, keySchema } from "../keys";
import { optionLabel, optionsSchema } from "./choice-shared";

export const multipleChoice = defineFieldType({
  id: "multiple_choice",
  isInput: true,
  collectsPersonalData: false,
  settingsSchema: z.object({ options: optionsSchema }),
  answerSchema: z.array(keySchema),
  allowedRules: ["min_selected", "max_selected"],
  allowedOperators: ["contains", "not_contains", "is_empty", "is_not_empty"],
  normalize: (a, s) => s.options.map((o) => o.key).filter((k) => a.includes(k)),
  validate: (a, s) =>
    a.every((k) => s.options.some((o) => o.key === k)) ? [] : ["unknown_option"],
  isEmpty: (a) => a.length === 0,
  exportHeaders: (label) => [label],
  exportCells: (a, s, locale, languages) => [
    (a ?? []).map((k) => optionLabel(s.options, k, locale, languages)).join("; "),
  ],
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
