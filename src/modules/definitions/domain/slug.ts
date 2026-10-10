import {
  requiredLocales,
  type Languages,
  type LocalizedText,
} from "@/shared/domain/localized-text";

/** Words that collide with application routes. */
export const RESERVED_SLUGS = ["admin", "api", "health", "f"] as const;

/** 3 to 64 characters, lowercase letters, digits and hyphens, no edge hyphens. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

const MAX_SLUG_LENGTH = 64;
const MIN_SLUG_LENGTH = 3;

export type SlugIssue = "slug_format" | "slug_reserved";

/**
 * Validates a slug against the reserved words (checked first, since `f` is also
 * too short) and the format.
 * See specs/system/security.md, "Staff-authored content".
 */
export function checkSlug(slug: string): SlugIssue | null {
  if (isReserved(slug)) return "slug_reserved";
  if (!SLUG_PATTERN.test(slug)) return "slug_format";
  return null;
}

function isReserved(slug: string): boolean {
  return (RESERVED_SLUGS as readonly string[]).includes(slug);
}

/**
 * Suggests a slug from the form title in the first required language that has
 * text. The result always passes `checkSlug`.
 * See specs/system/security.md, "Staff-authored content".
 */
export function slugFromTitle(title: LocalizedText, languages: Languages): string {
  const text =
    requiredLocales(languages)
      .map((locale) => title[locale])
      .find((value) => value !== undefined && value.trim().length > 0) ?? "";
  const base = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  if (base.length === 0) return "form";
  if (base.length < MIN_SLUG_LENGTH || isReserved(base)) return `${base}-form`;
  return base;
}
