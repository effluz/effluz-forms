import { z } from "zod";
import { localizedTextSchema } from "@/shared/domain/localized-text";
import { defineFieldType } from "../field-type";

export const section = defineFieldType({
  id: "section",
  isInput: false,
  collectsPersonalData: false,
  settingsSchema: z.object({
    title: localizedTextSchema,
    description: localizedTextSchema.optional(),
  }),
  defaultSettings: () => ({ title: {} }),
  answerSchema: z.undefined(),
  allowedRules: [],
  allowedOperators: [],
  normalize: () => undefined,
  validate: () => [],
  isEmpty: () => true,
  exportHeaders: () => [],
  exportCells: () => [],
  localizedSettingsTexts: (s) => [
    { path: "title", text: s.title, blankCode: "unlabeled" },
    { path: "description", text: s.description, blankCode: null },
  ],
  fixtures: {
    settings: [{ title: { en: "Information", es: "Información" } }],
    validAnswers: [undefined],
    invalidAnswers: ["text", 1],
  },
});
