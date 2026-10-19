import { z } from "zod";
import { localizedTextSchema } from "@/shared/domain/localized-text";
import { defineFieldType } from "../field-type";
import { LIMITS } from "../limits";
import { graphemeLength } from "../rules";
import { cleanText } from "./short-text";

export const longText = defineFieldType({
  id: "long_text",
  isInput: true,
  collectsPersonalData: false,
  reviewTraits: { curatable: true },
  settingsSchema: z.object({
    placeholder: localizedTextSchema.optional(),
    rows: z.number().int().min(2).max(12).default(4),
  }),
  defaultSettings: () => ({ rows: 4 }),
  answerSchema: z.string(),
  allowedRules: ["min_length", "max_length"],
  maxLength: LIMITS.longTextMax,
  allowedOperators: ["contains", "not_contains", "is_empty", "is_not_empty"],
  normalize: (a) => cleanText(a).replace(/\r\n?/g, "\n"),
  validate: (a) =>
    graphemeLength(a) > LIMITS.longTextMax
      ? [{ code: "max_length", params: { n: LIMITS.longTextMax } }]
      : [],
  isEmpty: (a) => a.trim().length === 0,
  exportHeaders: (label) => [label],
  exportCells: (a) => [a ?? ""],
  fixtures: {
    settings: [{ rows: 4 }],
    validAnswers: ["Our story\n\nbegan early."],
    invalidAnswers: [1, {}],
    emptyAnswer: "",
    overLimitAnswers: ["x".repeat(LIMITS.longTextMax + 1)],
  },
});
