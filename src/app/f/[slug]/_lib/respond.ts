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
