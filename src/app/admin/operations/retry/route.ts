import { actorOf, requireCsrf, seeOther, text } from "@/app/admin/_lib/request";
import { retryJob } from "@/modules/review/application";

const OPERATIONS = "/admin/operations";

/**
 * POST /admin/operations/retry from a dead job's Retry: retries it and returns with
 * `done=retried`; a job that is no longer dead returns to Operations without a flash.
 * See specs/use-cases/operate-jobs.md and specs/ui-ux/manager.md, "Operations page".
 */
export async function POST(request: Request): Promise<Response> {
  // Sign-in returns with a GET, so it goes back to Operations, not to this route.
  const guarded = await requireCsrf(request, OPERATIONS);
  if (guarded instanceof Response) return guarded;
  const { session, container, form } = guarded;

  const retried = await retryJob(container.review, actorOf(session, request), text(form, "job"));
  return seeOther(retried ? `${OPERATIONS}?done=retried` : OPERATIONS);
}
