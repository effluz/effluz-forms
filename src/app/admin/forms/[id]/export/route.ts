import { actorOf, plain, requireCsrf, seeOther, text } from "@/app/admin/_lib/request";
import { formHref } from "@/modules/definitions/presentation/view-models";
import { exportStories, parseListQuery, type ExportOptions } from "@/modules/review/application";
import { exportLabels } from "@/modules/review/presentation/export-labels";
import { exportHref } from "@/modules/review/presentation/list-view";

const VERSIONS: readonly ExportOptions["versions"][] = ["filter", "all"];
const TEXTS: readonly ExportOptions["text"][] = ["original", "corrected", "both"];
/** The list filters the dialog carries as hidden fields; never `page`. */
const FILTER_KEYS = ["status", "plan", "from", "to", "version", "media", "q"] as const;

/**
 * POST /admin/forms/[id]/export from the export dialog: answers the CSV of the filtered
 * submissions as an attachment, streamed as it is written, or returns to the dialog with
 * `error=too_large` above the row cap. See specs/use-cases/review-submissions.md, "Main flow:
 * export", and specs/ui-ux/manager.md, "Export dialog".
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

  // The dialog offers only these choices; anything else is a tampered request.
  const versions = VERSIONS.find((known) => known === text(form, "versions"));
  const textMode = TEXTS.find((known) => known === text(form, "text"));
  if (versions === undefined || textMode === undefined) return plain(400);
  const query = parseListQuery(
    Object.fromEntries(FILTER_KEYS.map((key) => [key, text(form, key)])),
  );

  const result = await exportStories(container.review, actorOf(session, request), {
    formId: id,
    query,
    options: { versions, text: textMode, paths: text(form, "paths") === "1" },
    labels: exportLabels,
  });
  if (!result.ok)
    return seeOther(
      result.code === "too_large" ? `${exportHref(id, query)}&error=too_large` : overview,
    );
  return new Response(result.body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
