import { notFound } from "next/navigation";
import { pageSession } from "@/app/admin/_lib/page";
import { openForm } from "@/modules/definitions/application";
import {
  FormOverview,
  overviewDialog,
  overviewError,
  SubmissionsPlaceholder,
} from "@/modules/definitions/presentation/FormOverview";
import { formHref } from "@/modules/definitions/presentation/view-models";
import { pageMetadata } from "@/shared/presentation/metadata";

/**
 * Blocks on the session and the database, as the gated layout does: without it,
 * dev's instant-navigation check reports the uncached reads. Build passes either way.
 */
export const instant = false;

export const metadata = pageMetadata("form.tab_submissions");

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * A form's overview, which is its Submissions tab, with the lifecycle
 * confirmation asked for by `?action=` and a refusal from `?error=`.
 * See specs/ui-ux/manager.md, "Form overview".
 */
export default async function FormOverviewPage(props: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await props.params;
  const { session, container, actor } = await pageSession(formHref(id));
  const query = await props.searchParams;
  const overview = await openForm(container.definitions, actor, id);
  if (overview === null) notFound();
  const dialog = overviewDialog(query.action);
  const error = overviewError(query.error);
  return (
    <FormOverview
      overview={overview}
      csrfToken={session.csrfToken}
      tab="submissions"
      {...(dialog === undefined ? {} : { dialog })}
      {...(error === undefined ? {} : { error })}
    >
      <SubmissionsPlaceholder total={overview.summary.total} />
    </FormOverview>
  );
}
