import { z } from "zod";
import { defineFieldType } from "../field-type";
import { LIMITS } from "../limits";

export const mediaIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

const settings = z.object({
  kinds: z
    .array(z.enum(["image", "video"]))
    .min(1)
    .refine((k) => new Set(k).size === k.length, "kinds must be unique"),
  maxFiles: z.number().int().min(1).max(LIMITS.filesPerField).default(LIMITS.filesPerField),
  maxSizeMb: z.number().int().min(1).max(LIMITS.fileSizeMb).default(LIMITS.fileSizeMb),
});

export const fileUpload = defineFieldType({
  id: "file_upload",
  isInput: true,
  collectsPersonalData: true,
  settingsSchema: settings,
  answerSchema: z.array(mediaIdSchema),
  allowedRules: ["min_files", "max_files"],
  allowedOperators: ["is_empty", "is_not_empty"],
  normalize: (a) => [...new Set(a)],
  validate: (a, s) =>
    a.length > s.maxFiles ? [{ code: "files_max", params: { n: s.maxFiles } }] : [],
  isEmpty: (a) => a.length === 0,
  exportHeaders: (label) => [`${label} (count)`, `${label} (files)`],
  exportCells: (a) => [String(a?.length ?? 0), (a ?? []).join("; ")],
  fixtures: {
    settings: [
      { kinds: ["image"], maxFiles: 10, maxSizeMb: 10 },
      { kinds: ["image", "video"], maxFiles: 3, maxSizeMb: 10 },
    ],
    validAnswers: [["m_aaaaaaaa"], ["m_aaaaaaaa", "m_bbbbbbbb"]],
    invalidAnswers: ["m_aaaaaaaa", [1], ["short"]],
    emptyAnswer: [],
    overLimitAnswers: [
      Array.from(
        { length: LIMITS.filesPerField + 1 },
        (_, i) => `m_file${String(i).padStart(4, "0")}`,
      ),
    ],
  },
});
