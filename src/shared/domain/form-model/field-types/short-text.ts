import { z } from "zod";
import { localizedTextSchema } from "@/shared/domain/localized-text";
import { defineFieldType, normalizeText } from "../field-type";
import { LIMITS } from "../limits";
import { graphemeLength } from "../rules";

// Only characters with no visible or joining role. U+200C and U+200D stay: they
// shape emoji sequences and Persian or Indic text.
const ZERO_WIDTH = /[\u200B\u2060\uFEFF]/g;
export const cleanText = (s: string): string => normalizeText(s.replace(ZERO_WIDTH, ""));

const settings = z.object({ placeholder: localizedTextSchema.optional() });

export const shortText = defineFieldType({
  id: "short_text",
  isInput: true,
  collectsPersonalData: false,
  settingsSchema: settings,
  defaultSettings: () => ({}),
  answerSchema: z.string(),
  allowedRules: ["min_length", "max_length", "pattern"],
  maxLength: LIMITS.shortTextMax,
  allowedOperators: [
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "is_empty",
    "is_not_empty",
    "is_one_of",
  ],
  normalize: (a) => cleanText(a).replace(/\s*\n\s*/g, " "),
  validate: (a) =>
    graphemeLength(a) > LIMITS.shortTextMax
      ? [{ code: "max_length", params: { n: LIMITS.shortTextMax } }]
      : [],
  isEmpty: (a) => a.trim().length === 0,
  exportHeaders: (label) => [label],
  exportCells: (a) => [a ?? ""],
  fixtures: {
    settings: [{}, { placeholder: { en: "Full name", es: "Nombre completo" } }],
    validAnswers: ["Ana María", "x"],
    invalidAnswers: [42, null, ["a"]],
    emptyAnswer: "",
    overLimitAnswers: ["x".repeat(LIMITS.shortTextMax + 1)],
  },
});
