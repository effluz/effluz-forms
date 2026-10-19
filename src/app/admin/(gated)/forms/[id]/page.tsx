import { pageSession } from "@/app/admin/_lib/page";
import { openForm, publicUrl } from "@/modules/definitions/application";
import {
  FormOverview,
  overviewDialog,
  overviewError,
} from "@/modules/definitions/presentation/FormOverview";
import { FORMS_PATH } from "@/modules/definitions/presentation/FormsList";
import { formHref } from "@/modules/definitions/presentation/view-models";
import { listStories, parseListQuery } from "@/modules/review/application";
import { SubmissionsList } from "@/modules/review/presentation/SubmissionsList";
import { pageMetadata } from "@/shared/presentation/metadata";
import { NotFoundPage } from "@/shared/presentation/NotFoundPage";

/**
 * Blocks on the session and the database, as the gated layout does: without it,
 * dev's instant-navigation check reports the uncached reads. Build passes either way.
 */
export const instant = false;

export const metadata = pageMetadata("form.tab_submissions");

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The longest reference `?deleted=` may name. */
const REFERENCE_MAX = 40;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * A form's overview, which is its Submissions tab: the list with the list's query, the export
 * dialog opened by `?export=1` (with `?error=too_large`) and the deletion reported by
 * `?deleted=<ref>`, under the form header with the lifecycle confirmation asked for by
 * `?action=` and a refusal from `?error=`. A missing form renders the not-found body itself. See
 * specs/ui-ux/manager.md, "Form overview" and "Submissions tab".
 */
export default async function FormOverviewPage(props: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await props.params;
  const { session, container, actor } = await pageSession(formHref(id));
  const query = await props.searchParams;
  const overview = await openForm(container.definitions, actor, id);
  // A form that is gone renders the not-found body inside the shell, never `notFound()`: that
  // would show the empty shell without script (ADR 0027).
  if (overview === null) return <NotFoundPage formsHref={FORMS_PATH} />;
  const list = await listStories(container.review, actor, {
    formId: id,
    query: parseListQuery(query),
  });
  if (list === null) return <NotFoundPage formsHref={FORMS_PATH} />;
  const dialog = overviewDialog(query.action);
  const error = overviewError(query.error);
  const deleted = first(query.deleted);
  return (
    <FormOverview
      overview={overview}
      csrfToken={session.csrfToken}
      tab="submissions"
      {...(dialog === undefined ? {} : { dialog })}
      {...(error === undefined ? {} : { error })}
    >
      <SubmissionsList
        list={list}
        publicUrl={publicUrl(container.definitions, overview.form.slug)}
        csrfToken={session.csrfToken}
        exportOpen={first(query.export) === "1"}
        exportError={first(query.error) === "too_large" ? "too_large" : null}
        deleted={
          deleted === undefined || deleted === "" || deleted.length > REFERENCE_MAX ? null : deleted
        }
      />
    </FormOverview>
  );
}
