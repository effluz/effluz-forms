import { actorOf, requireCsrf, seeOther, text } from "@/app/admin/_lib/request";
import { deleteForm } from "@/modules/definitions/application";
import { FORMS_PATH } from "@/modules/definitions/presentation/FormsList";
import { formHref } from "@/modules/definitions/presentation/view-models";

/**
 * POST /admin/forms/[id]/delete from the delete confirmation on the overview:
 * deletes a form that was never published and has no submissions, once its slug
 * is typed, and goes to the forms list. A wrong slug reopens the confirmation;
 * a form that can no longer be deleted returns to the overview.
 * See specs/use-cases/publish-form.md, "Deleting a form", and
 * specs/ui-ux/manager.md, "Form overview".
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const overview = formHref(id);
  // Sign-in returns with a GET, so it goes back to the overview, not to this route.
  const guarded = await requireCsrf(request, overview);
  if (guarded instanceof Response) return guarded;
  const { session, container, form } = guarded;

  // Compared exactly, as typed: the confirmation is deliberate.
  const result = await deleteForm(container.definitions, actorOf(session, request), {
    formId: id,
    slugConfirmation: text(form, "slug"),
  });
  if (result.ok) return seeOther(FORMS_PATH);
  switch (result.code) {
    case "slug_mismatch":
      return seeOther(`${overview}?action=delete&error=slug_mismatch`);
    case "not_allowed":
      return seeOther(`${overview}?error=not_allowed`);
    case "not_found":
      // Its overview answers with not found.
      return seeOther(overview);
  }
}
