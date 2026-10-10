import { z } from "zod";

export const localeSchema = z.enum(["en", "es"]);
export type Locale = z.infer<typeof localeSchema>;

export const languagesSchema = z.enum(["bilingual", "en", "es"]);
export type Languages = z.infer<typeof languagesSchema>;

export const MAX_TEXT_LENGTH = 20_000;

export const localizedTextSchema = z.object({
  en: z.string().max(MAX_TEXT_LENGTH).optional(),
  es: z.string().max(MAX_TEXT_LENGTH).optional(),
});
export type LocalizedText = z.infer<typeof localizedTextSchema>;

export function localizedTextFrom(en: string, es: string): LocalizedText {
  return { en, es };
}

export function requiredLocales(languages: Languages): Locale[] {
  return languages === "bilingual" ? ["en", "es"] : [languages];
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

export function isComplete(text: LocalizedText | undefined, languages: Languages): boolean {
  if (!text) return false;
  return requiredLocales(languages).every((locale) => !isBlank(text[locale]));
}

export function resolveText(text: LocalizedText, locale: Locale, languages: Languages): string {
  const own = text[locale];
  if (!isBlank(own)) return own as string;
  for (const fallback of requiredLocales(languages)) {
    const candidate = text[fallback];
    if (!isBlank(candidate)) return candidate as string;
  }
  return "";
}
