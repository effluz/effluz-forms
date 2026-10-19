import { actorOf, requireCsrf, seeOther, text } from "@/app/admin/_lib/request";
import { discardJob } from "@/modules/review/application";

const OPERATIONS = "/admin/operations";

/**
 * POST /admin/operations/discard from a dead job's Discard: discards it with the reason
 * (the use case trims it: 1 to 200 characters) and returns with `done=discarded`; a blank or too long reason
 * returns with `error=reason_invalid&job=<id>`, so the refusal shows on its row.
 * See specs/use-cases/operate-jobs.md and specs/ui-ux/manager.md, "Operations page".
 */
export async function POST(request: Request): Promise<Response> {
  // Sign-in returns with a GET, so it goes back to Operations, not to this route.
  const guarded = await requireCsrf(request, OPERATIONS);
  if (guarded instanceof Response) return guarded;
  const { session, container, form } = guarded;
  const jobId = text(form, "job");

  const result = await discardJob(container.review, actorOf(session, request), {
    jobId,
    reason: text(form, "reason"),
  });
  if (result.ok) return seeOther(`${OPERATIONS}?done=discarded`);
  return seeOther(
    result.code === "reason_invalid"
      ? `${OPERATIONS}?error=reason_invalid&job=${encodeURIComponent(jobId)}`
      : OPERATIONS,
  );
}
