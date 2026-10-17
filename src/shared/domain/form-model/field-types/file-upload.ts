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
type Settings = z.infer<typeof settings>;

// Explicit type arguments keep `kinds` narrow; inferred from the fixtures it widens to string[].
export const fileUpload = defineFieldType<Settings, string[]>({
  id: "file_upload",
  isInput: true,
  collectsPersonalData: true,
  settingsSchema: settings,
  defaultSettings: () => ({ kinds: ["image" as const], maxFiles: 1, maxSizeMb: LIMITS.fileSizeMb }),
  answerSchema: z.array(mediaIdSchema),
  allowedRules: ["min_files", "max_files"],
  allowedOperators: ["is_empty", "is_not_empty"],
  normalize: (a) => [...new Set(a)],
  validate: (a, s) =>
    a.length > s.maxFiles ? [{ code: "files_max", params: { n: s.maxFiles } }] : [],
  isEmpty: (a) => a.length === 0,
  exportHeaders: (label) => [`${label} (count)`, `${label} (files)`],
  exportCells: (a) => [String(a?.length ?? 0), (a ?? []).join("; ")],
  publishChecks: (field, s) =>
    field.validation.flatMap((rule) =>
      (rule.rule === "min_files" || rule.rule === "max_files") && rule.value > s.maxFiles
        ? [
            {
              code: "over_maximum" as const,
              path: "validation",
              params: {
                detail: `${rule.rule} ${String(rule.value)} > ${String(s.maxFiles)} files`,
              },
            },
          ]
        : [],
    ),
  uploadLimits: (s) => ({ kinds: s.kinds, maxFiles: s.maxFiles, maxSizeMb: s.maxSizeMb }),
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
