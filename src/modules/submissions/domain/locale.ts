import { requiredLocales, type Languages, type Locale } from "@/shared/domain/localized-text";

interface Preference {
  base: string;
  q: number;
}

function preferences(acceptLanguage: string): Preference[] {
  const parsed: Preference[] = [];
  for (const part of acceptLanguage.split(",")) {
    const [tag = "", ...params] = part.split(";").map((s) => s.trim());
    const base = tag.split("-")[0]?.toLowerCase() ?? "";
    if (base === "") continue;
    let q = 1;
    for (const param of params) {
      const [name, value] = param.split("=").map((s) => s.trim());
      if (name?.toLowerCase() === "q") q = value !== undefined ? Number(value) : Number.NaN;
    }
    if (!Number.isFinite(q) || q <= 0) continue;
    parsed.push({ base, q });
  }
  // Array.prototype.sort is stable, so equal weights keep header order.
  return parsed.sort((a, b) => b.q - a.q);
}

/**
 * The locale a fill starts in: the form's only language, else the browser's
 * preferred one of English and Spanish, else Spanish
 * (`specs/use-cases/fill-and-submit-form.md`, "Main flow").
 */
export function pickLocale(languages: Languages, acceptLanguage: string | null): Locale {
  if (languages !== "bilingual") return languages;
  if (acceptLanguage === null) return "es";
  for (const { base } of preferences(acceptLanguage))
    if (base === "en" || base === "es") return base;
  return "es";
}

/** The wanted locale when the form offers it, else the form's first offered locale. */
export function localeFor(languages: Languages, wanted: Locale): Locale {
  const offered = requiredLocales(languages);
  return offered.includes(wanted) ? wanted : (offered[0] ?? wanted);
}
