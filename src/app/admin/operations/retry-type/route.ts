import { actorOf, requireCsrf, seeOther, text } from "@/app/admin/_lib/request";
import { retryAllOfType } from "@/modules/review/application";

const OPERATIONS = "/admin/operations";

/**
 * POST /admin/operations/retry-type from "Retry all": retries every dead job of the type and
 * returns with `done=retried_all&n=<count>`. See specs/use-cases/operate-jobs.md and
 * specs/ui-ux/manager.md, "Operations page".
 */
export async function POST(request: Request): Promise<Response> {
  // Sign-in returns with a GET, so it goes back to Operations, not to this route.
  const guarded = await requireCsrf(request, OPERATIONS);
  if (guarded instanceof Response) return guarded;
  const { session, container, form } = guarded;

  const count = await retryAllOfType(
    container.review,
    actorOf(session, request),
    text(form, "type"),
  );
  return seeOther(`${OPERATIONS}?done=retried_all&n=${String(count)}`);
}
