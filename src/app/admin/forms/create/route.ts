import { actorOf, localized, requireCsrf, seeOther, text } from "@/app/admin/_lib/request";
import { createForm } from "@/modules/definitions/application";
import {
  refusedCreateLocation,
  type NewFormValues,
} from "@/modules/definitions/presentation/new-form-values";
import {
  languagesSchema,
  requiredLocales,
  type Languages,
  type LocalizedText,
} from "@/shared/domain/localized-text";

/** Only the languages the chosen mode uses: a title typed for another one is dropped. */
function titleFor(title: LocalizedText, languages: Languages): LocalizedText {
  const kept: LocalizedText = {};
  for (const locale of requiredLocales(languages)) {
    const value = title[locale];
    if (value !== undefined) kept[locale] = value;
  }
  return kept;
}

/**
 * POST /admin/forms/create from the New form dialog: creates a blank or duplicated
 * form and goes to it, or returns to the dialog with the refusal code and the
 * values typed. It is not POST /admin/forms because Next does not allow a route
 * handler beside the (gated) forms page at the same path.
 * See specs/use-cases/create-and-edit-form.md, "Main flow: create", and
 * specs/ui-ux/builder.md, "New form".
 */
export async function POST(request: Request): Promise<Response> {
  // Sign-in returns with a GET, so it goes back to the dialog, not to this route.
  const guarded = await requireCsrf(request, "/admin/forms/new");
  if (guarded instanceof Response) return guarded;
  const { session, container, form } = guarded;

  // The dialog offers only the three modes; anything else is a tampered request.
  const languages = languagesSchema.safeParse(text(form, "languages"));
  if (!languages.success) {
    return new Response(null, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const typed: NewFormValues = {
    kind: text(form, "kind") === "duplicate" ? "duplicate" : "blank",
    titleEn: text(form, "title_en").trim(),
    titleEs: text(form, "title_es").trim(),
    languages: languages.data,
    slug: text(form, "slug").trim(),
    source: text(form, "source"),
  };

  const result = await createForm(container.definitions, actorOf(session, request), {
    title: titleFor(localized(form, "title"), typed.languages),
    languages: typed.languages,
    ...(typed.slug === "" ? {} : { slug: typed.slug }),
    // The source select is posted with Blank too, so only Duplicate reads it.
    ...(typed.kind === "duplicate" ? { duplicateOf: typed.source } : {}),
  });
  if (!result.ok) return seeOther(refusedCreateLocation(result.code, typed));
  return seeOther(`/admin/forms/${result.formId}`);
}
