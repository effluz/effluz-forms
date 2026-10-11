import { z } from "zod";
import { defineFieldType } from "../field-type";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isRealDate(iso: string): boolean {
  const m = ISO.exec(iso);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export const date = defineFieldType({
  id: "date",
  isInput: true,
  collectsPersonalData: false,
  settingsSchema: z.object({}),
  defaultSettings: () => ({}),
  answerSchema: z.string().regex(ISO),
  allowedRules: ["min_date", "max_date", "not_future"],
  allowedOperators: [
    "equals",
    "not_equals",
    "greater_than",
    "less_than",
    "is_empty",
    "is_not_empty",
  ],
  normalize: (a) => a.trim(),
  validate: (a) => (isRealDate(a) ? [] : ["date_invalid"]),
  isEmpty: (a) => a.length === 0,
  exportHeaders: (label) => [label],
  exportCells: (a) => [a ?? ""],
  fixtures: {
    settings: [{}],
    validAnswers: ["2024-02-29"],
    invalidAnswers: ["29/02/2024", 20240229],
    emptyAnswer: "",
  },
});
