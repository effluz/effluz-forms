import {
  localeFor,
  pickLocale,
  type FillState,
  type PostOutcome,
} from "@/modules/submissions/application";
import { localeSchema, type Languages, type Locale } from "@/shared/domain/localized-text";

/*
 * What the renderer's routes and its Server Action share: where a page post goes, what the
 * in-progress cookie becomes, the language of a JSON answer and what a failure logs. See
 * specs/ui-ux/renderer.md, "Routes", and specs/system/security.md, "In-progress cookie".
 */

/** The class of an unexpected error, the only thing a route logs about it. */
export function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : "Error";
}

/**
 * The language a JSON answer is in: the posted `_locale` when the form offers it, else the
 * record's, else the browser's preference among the form's languages.
 */
export function requestLocale(
  languages: Languages,
  posted: FormDataEntryValue | null,
  record: { locale: Locale } | null,
  acceptLanguage: string | null,
): Locale {
  const wanted = localeSchema.safeParse(posted);
  if (wanted.success) return localeFor(languages, wanted.data);
  return record ? localeFor(languages, record.locale) : pickLocale(languages, acceptLanguage);
}

/**
 * Whether a script request to a renderer route came from a page of another origin: an `Origin`
 * other than the public one, or a `Sec-Fetch-Site` of `cross-site` or `same-site`. `SameSite=Lax`
 * lets a same-site page send the fill cookie, so the routes answer such a request 403.
 * See specs/system/security.md, "In-progress cookie".
 */
export function isForeignRequest(headers: Headers, publicOrigin: string): boolean {
  const origin = headers.get("origin");
  if (origin !== null && origin !== publicOrigin) return true;
  const site = headers.get("sec-fetch-site");
  return site === "cross-site" || site === "same-site";
}

/**
 * A posted ISO instant such as `_rendered`, or null when it is absent or unreadable. The first
 * early upload carries the page's render time, so a record it opens starts where the page did.
 */
export function postedInstant(value: FormDataEntryValue | null): Date | null {
  if (typeof value !== "string") return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** The form's public link. */
export function formPath(slug: string): string {
  return `/f/${encodeURIComponent(slug)}`;
}

/** The page, or the expired screen. */
export function outcomeLocation(
  slug: string,
  outcome: Exclude<PostOutcome, { kind: "refused" }>,
): string {
  return outcome.kind === "expired" ? `${formPath(slug)}?expired=1` : formPath(slug);
}

/** The error screen, where a page post that failed unexpectedly lands. */
export function errorLocation(slug: string): string {
  return `${formPath(slug)}?error=1`;
}

/** The page showing the refused post tagged `at`. */
export function refusedLocation(slug: string, at: number): string {
  return `${formPath(slug)}?refused=${String(at)}`;
}

/** The in-progress cookie after an outcome: a new value, cleared, or left as it is. */
export function outcomeFillState(outcome: PostOutcome): FillState | "clear" | "keep" {
  switch (outcome.kind) {
    case "show":
    case "refused":
      return { kind: "record", id: outcome.recordId };
    case "submitted":
      return { kind: "done", submitToken: outcome.submitToken };
    case "decoy":
      return { kind: "decoy", reference: outcome.reference };
    case "expired":
      return "clear";
    case "gate":
      return "keep";
  }
}
