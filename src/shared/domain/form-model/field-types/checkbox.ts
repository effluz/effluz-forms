import { z } from "zod";
import { defineFieldType } from "../field-type";

const YES = { en: "yes", es: "sí" } as const;
const NO = { en: "no", es: "no" } as const;

export const checkbox = defineFieldType({
  id: "checkbox",
  isInput: true,
  collectsPersonalData: false,
  settingsSchema: z.object({}),
  answerSchema: z.boolean(),
  allowedRules: ["must_be_true"],
  allowedOperators: ["equals", "not_equals"],
  normalize: (a) => a,
  validate: () => [],
  isEmpty: (a) => !a,
  exportHeaders: (label) => [label],
  exportCells: (a, _s, locale) => [a === undefined ? "" : a ? YES[locale] : NO[locale]],
  fixtures: {
    settings: [{}],
    validAnswers: [true],
    invalidAnswers: ["true", 1],
    emptyAnswer: false,
  },
});
