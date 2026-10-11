import { actorOf, requireCsrf, seeOther, text } from "@/app/admin/_lib/request";
import { applyLifecycle, LIFECYCLE_ACTIONS } from "@/modules/definitions/application";
import { formHref } from "@/modules/definitions/presentation/view-models";

/**
 * POST /admin/forms/[id]/lifecycle from a lifecycle confirmation on the overview:
 * closes, reopens, archives or unarchives the form and returns to the overview,
 * with `?error=invalid_transition` when the form no longer allows the action.
 * See specs/use-cases/publish-form.md, "Main flow: close, reopen, archive", and
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

  // The confirmation offers only the lifecycle actions; anything else is a tampered request.
  const action = LIFECYCLE_ACTIONS.find((known) => known === text(form, "action"));
  if (action === undefined) return new Response(null, { status: 400 });

  const result = await applyLifecycle(container.definitions, actorOf(session, request), {
    formId: id,
    action,
  });
  // An unknown form goes to its overview too, which answers with not found.
  if (!result.ok && result.code === "invalid_transition") {
    return seeOther(`${overview}?error=invalid_transition`);
  }
  return seeOther(overview);
}
