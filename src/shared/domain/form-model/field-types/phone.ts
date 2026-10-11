import { z } from "zod";
import { defineFieldType } from "../field-type";
import { LIMITS } from "../limits";
import { graphemeLength } from "../rules";
import { cleanText } from "./short-text";

export const phone = defineFieldType({
  id: "phone",
  isInput: true,
  collectsPersonalData: true,
  settingsSchema: z.object({}),
  answerSchema: z.string(),
  allowedRules: ["min_length", "max_length"],
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
  // Kept as typed: extensions and other notations stay readable for staff.
  normalize: (a) => cleanText(a).replace(/\s+/g, " "),
  validate: (a) => {
    // The length cap runs before the digit count so oversized input is refused early.
    if (graphemeLength(a) > LIMITS.shortTextMax)
      return [{ code: "max_length", params: { n: LIMITS.shortTextMax } }];
    return (a.match(/\d/g)?.length ?? 0) >= 6 ? [] : ["pattern"];
  },
  isEmpty: (a) => a.trim().length === 0,
  exportHeaders: (label) => [label],
  exportCells: (a) => [a ?? ""],
  fixtures: {
    settings: [{}],
    validAnswers: ["+507 6123-4567"],
    invalidAnswers: [61234567, null],
    emptyAnswer: "",
    overLimitAnswers: ["1".repeat(LIMITS.shortTextMax + 1)],
  },
});
