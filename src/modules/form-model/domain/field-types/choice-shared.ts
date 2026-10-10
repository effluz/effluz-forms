import { z } from "zod";
import {
  type Languages,
  type Locale,
  localizedTextSchema,
  resolveText,
} from "@/shared/domain/localized-text";
import type { PublishIssueDraft, SettingsText } from "../field-type";
import { keySchema } from "../keys";
import { LIMITS } from "../limits";
import type { Rule } from "../rules";

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

/** Every option label is a required staff-authored text. */
export function optionLabelTexts(options: readonly Option[]): SettingsText[] {
  return options.map((o, i) => ({
    path: `options/${String(i)}/label`,
    text: o.label,
    blankCode: "option_unlabeled",
  }));
}

/** A selection-count rule cannot ask for more selections than there are options. */
export function selectionCountChecks(
  validation: readonly Rule[],
  options: readonly Option[],
): PublishIssueDraft[] {
  return validation.flatMap((rule) =>
    (rule.rule === "min_selected" || rule.rule === "max_selected") && rule.value > options.length
      ? [
          {
            code: "over_maximum" as const,
            path: "validation",
            params: {
              detail: `${rule.rule} ${String(rule.value)} > ${String(options.length)} options`,
            },
          },
        ]
      : [],
  );
}

export function optionLabel(
  options: Option[],
  key: string,
  locale: Locale,
  languages: Languages,
): string {
  const found = options.find((o) => o.key === key);
  return found ? resolveText(found.label, locale, languages) : key;
}
