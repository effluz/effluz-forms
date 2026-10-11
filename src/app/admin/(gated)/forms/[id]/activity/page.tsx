import { notFound } from "next/navigation";
import { pageSession } from "@/app/admin/_lib/page";
import { formActivity, shareInfo, type ActivityFilter } from "@/modules/definitions/application";
import { ACTIVITY_PAGE_SIZE, ActivityList } from "@/modules/definitions/presentation/ActivityList";
import { formHref } from "@/modules/definitions/presentation/view-models";
import { pageMetadata } from "@/shared/presentation/metadata";

/**
 * Blocks on the session and the database, as the gated layout does: without it,
 * dev's instant-navigation check reports the uncached reads. Build passes either way.
 */
export const instant = false;

export const metadata = pageMetadata("form.tab_activity");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The filter the query string asks for; blanks and an unreadable instant are ignored, and
 * `beforeId` counts only next to a readable `before` and only as a UUID.
 */
function filterOf(params: Record<string, string | string[] | undefined>): ActivityFilter {
  const actor = first(params.actor);
  const action = first(params.action);
  const before = new Date(first(params.before));
  const beforeId = first(params.beforeId);
  const cursor = !Number.isNaN(before.getTime());
  return {
    ...(actor === "" ? {} : { actorEmail: actor }),
    ...(action === "" ? {} : { action }),
    ...(cursor ? { before } : {}),
    ...(cursor && UUID.test(beforeId) ? { beforeId } : {}),
    limit: ACTIVITY_PAGE_SIZE,
  };
}

/** The Activity tab of a form. See specs/ui-ux/manager.md, "Activity tab". */
export default async function ActivityPage(props: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await props.params;
  const { container } = await pageSession(formHref(id, "activity"));
  if ((await shareInfo(container.definitions, id)) === null) notFound();
  const filter = filterOf(await props.searchParams);
  const { entries, actors, hasMore } = await formActivity(container.definitions, id, filter);
  return (
    <ActivityList entries={entries} actors={actors} hasMore={hasMore} filter={filter} formId={id} />
  );
}
