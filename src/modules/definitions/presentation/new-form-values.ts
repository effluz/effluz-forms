import { languagesSchema, type Languages } from "@/shared/domain/localized-text";
import type { CreateFormResult } from "../application";

export type CreateFormError = Extract<CreateFormResult, { ok: false }>["code"];

/** What the New form dialog posts, as typed; staff-authored, never personal data. */
export interface NewFormValues {
  kind: "blank" | "duplicate";
  titleEn: string;
  titleEs: string;
  languages: Languages;
  slug: string;
  source: string;
}

/**
 * The longest value carried back in the redirect after a refusal. A title may be
 * longer (the schema allows 20,000 characters), but the redirect URL has to stay
 * well under the 16 KB request-header limit, so a longer one is not carried and
 * its input comes back empty. A slug has at most 64 characters and a source id is
 * a 36-character UUID.
 */
export const CARRY_LIMITS = { title: 500, slug: 64, source: 36 } as const;

const FIELDS = {
  titleEn: "title_en",
  titleEs: "title_es",
  slug: "slug",
  source: "source",
} as const;

type TextField = keyof typeof FIELDS;
const TEXT_FIELDS = Object.keys(FIELDS) as TextField[];

function limitOf(field: TextField): number {
  return field === "titleEn" || field === "titleEs" ? CARRY_LIMITS.title : CARRY_LIMITS[field];
}

/**
 * The dialog's URL after a refusal: the code, and the typed values that fit their
 * limit. See specs/ui-ux/builder.md, "New form".
 */
export function refusedCreateLocation(code: CreateFormError, values: NewFormValues): string {
  const query = new URLSearchParams({
    error: code,
    kind: values.kind,
    languages: values.languages,
  });
  for (const field of TEXT_FIELDS) {
    const value = values[field];
    if (value !== "" && value.length <= limitOf(field)) query.set(FIELDS[field], value);
  }
  return `/admin/forms/new?${query.toString()}`;
}

type Params = Record<string, string | string[] | undefined>;

function param(params: Params, name: string): string {
  const value = params[name];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * The values carried back in the page's query, ignoring anything malformed or
 * over its limit. The refusal code is read by `createFormError`.
 */
export function carriedValues(params: Params): Partial<NewFormValues> {
  const values: Partial<NewFormValues> = {};
  const kind = param(params, "kind");
  if (kind === "blank" || kind === "duplicate") values.kind = kind;
  const languages = languagesSchema.safeParse(param(params, "languages"));
  if (languages.success) values.languages = languages.data;
  for (const field of TEXT_FIELDS) {
    const value = param(params, FIELDS[field]);
    if (value !== "" && value.length <= limitOf(field)) values[field] = value;
  }
  return values;
}
