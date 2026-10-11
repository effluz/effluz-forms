import { actorOf, localized, requireCsrf, seeOther, text } from "@/app/admin/_lib/request";
import { createForm } from "@/modules/definitions/application";
import { languagesSchema } from "@/shared/domain/localized-text";

/**
 * POST /admin/forms/create from the New form dialog: creates a blank or duplicated
 * form and goes to it, or returns to the dialog with the refusal code. It is not
 * POST /admin/forms because Next does not allow a route handler beside the
 * (gated) forms page at the same path.
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
  if (!languages.success) return new Response(null, { status: 400 });
  const slug = text(form, "slug").trim();

  const result = await createForm(container.definitions, actorOf(session, request), {
    title: localized(form, "title"),
    languages: languages.data,
    ...(slug === "" ? {} : { slug }),
    // The source select is posted with Blank too, so only Duplicate reads it.
    ...(text(form, "start") === "duplicate" ? { duplicateOf: text(form, "source") } : {}),
  });
  if (!result.ok) return seeOther(`/admin/forms/new?error=${result.code}`);
  return seeOther(`/admin/forms/${result.formId}`);
}
