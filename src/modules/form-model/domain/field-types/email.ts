import { z } from "zod";
import { defineFieldType } from "../field-type";
import { graphemeLength } from "../rules";
import { cleanText } from "./short-text";

/** Longest address accepted, in graphemes (RFC 5321 path limit). Checked before the regex. */
export const EMAIL_MAX_LENGTH = 254;

// Pragmatic syntax: local@domain.tld, no spaces, one @, a dot in the domain.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const email = defineFieldType({
  id: "email",
  isInput: true,
  collectsPersonalData: true,
  settingsSchema: z.object({ isSubmitterAddress: z.boolean().default(false) }),
  answerSchema: z.string(),
  allowedRules: ["pattern"],
  allowedOperators: [
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "is_empty",
    "is_not_empty",
    "is_one_of",
  ],
  normalize: (a) => cleanText(a).toLowerCase(),
  validate: (a) => {
    // The length cap runs before the regex so oversized input never reaches it.
    if (graphemeLength(a) > EMAIL_MAX_LENGTH) return ["max_length"];
    return EMAIL.test(a) ? [] : ["email_syntax"];
  },
  isEmpty: (a) => a.trim().length === 0,
  exportHeaders: (label) => [label],
  exportCells: (a) => [a ?? ""],
  fixtures: {
    settings: [{ isSubmitterAddress: false }, { isSubmitterAddress: true }],
    validAnswers: ["family@example.com"],
    invalidAnswers: [5, null],
    emptyAnswer: "",
  },
});
