import { z } from "zod";
import {
  type Languages,
  type Locale,
  localizedTextSchema,
  resolveText,
} from "@/shared/domain/localized-text";
import { keySchema } from "../keys";
import { LIMITS } from "../limits";

export const optionSchema = z.object({ key: keySchema, label: localizedTextSchema });
export type Option = z.infer<typeof optionSchema>;

export const optionsSchema = z
  .array(optionSchema)
  .min(1)
  .max(LIMITS.optionsPerChoice)
  .refine(
    (opts) => new Set(opts.map((o) => o.key)).size === opts.length,
    "option keys must be unique",
  );

export function optionLabel(
  options: Option[],
  key: string,
  locale: Locale,
  languages: Languages,
): string {
  const found = options.find((o) => o.key === key);
  return found ? resolveText(found.label, locale, languages) : key;
}
