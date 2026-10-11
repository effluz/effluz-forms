import { notFound } from "next/navigation";
import { pageSession } from "@/app/admin/_lib/page";
import { formActivity, openForm } from "@/modules/definitions/application";
import { activityFilter } from "@/modules/definitions/presentation/activity-query";
import { ActivityList } from "@/modules/definitions/presentation/ActivityList";
import { FormOverview } from "@/modules/definitions/presentation/FormOverview";
import { formHref } from "@/modules/definitions/presentation/view-models";
import { pageMetadata } from "@/shared/presentation/metadata";

/**
 * Blocks on the session and the database, as the gated layout does: without it,
 * dev's instant-navigation check reports the uncached reads. Build passes either way.
 */
export const instant = false;

export const metadata = pageMetadata("form.tab_activity");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The Activity tab of a form. See specs/ui-ux/manager.md, "Activity tab". */
export default async function ActivityPage(props: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await props.params;
  const { session, container, actor } = await pageSession(formHref(id, "activity"));
  const overview = await openForm(container.definitions, actor, id);
  if (overview === null) notFound();
  const filter = activityFilter(await props.searchParams);
  const { entries, actors, hasMore } = await formActivity(container.definitions, id, filter);
  return (
    <FormOverview overview={overview} csrfToken={session.csrfToken} tab="activity">
      <ActivityList
        entries={entries}
        actors={actors}
        hasMore={hasMore}
        filter={filter}
        formId={id}
      />
    </FormOverview>
  );
}
