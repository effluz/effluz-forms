import { z } from "zod";
import { localizedTextSchema } from "@/shared/domain/localized-text";
import { defineFieldType } from "../field-type";

export const numberType = defineFieldType({
  id: "number",
  isInput: true,
  collectsPersonalData: false,
  settingsSchema: z.object({
    integerOnly: z.boolean().default(false),
    unit: localizedTextSchema.optional(),
  }),
  answerSchema: z.number(),
  allowedRules: ["min_value", "max_value"],
  allowedOperators: [
    "equals",
    "not_equals",
    "greater_than",
    "less_than",
    "is_empty",
    "is_not_empty",
  ],
  normalize: (a) => a,
  validate: (a, s) => (s.integerOnly && !Number.isInteger(a) ? ["integer"] : []),
  isEmpty: () => false,
  exportHeaders: (label) => [label],
  exportCells: (a) => [a === undefined ? "" : String(a)],
  fixtures: {
    settings: [{ integerOnly: false }, { integerOnly: true, unit: { en: "weeks", es: "semanas" } }],
    validAnswers: [30, 2.5],
    invalidAnswers: ["30", Number.NaN, null],
  },
});
