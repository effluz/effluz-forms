import { pageSession } from "@/app/admin/_lib/page";
import { parseIsoDate, postPlanWeek, waitingStories } from "@/modules/review/application";
import { PostPlanPage } from "@/modules/review/presentation/PostPlanPage";
import { pageMetadata } from "@/shared/presentation/metadata";

/**
 * Blocks on the session and the database, as the gated layout does: without it,
 * dev's instant-navigation check reports the uncached reads. Build passes either way.
 */
export const instant = false;

export const metadata = pageMetadata("nav.plan");

/** The longest "Waiting for a date" list the page shows. */
const WAITING_LIMIT = 50;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/**
 * The Post plan: the week of `?week=` (this week without it) and the stories waiting for a
 * date, with the plan buttons for the day picked by `?pick=`. `postPlanWeek` records the one
 * `post_plan_viewed` entry of the load. See specs/ui-ux/manager.md, "Post plan page".
 */
export default async function PostPlanRoute(props: { searchParams: SearchParams }) {
  const { session, container, actor } = await pageSession("/admin/plan");
  const query = await props.searchParams;
  const pick = first(query.pick);
  const [week, waiting] = await Promise.all([
    postPlanWeek(container.review, actor, { week: first(query.week) }),
    waitingStories(container.review, { limit: WAITING_LIMIT }),
  ]);
  return (
    <PostPlanPage
      week={week}
      waiting={waiting}
      pick={pick === null ? null : parseIsoDate(pick)}
      csrfToken={session.csrfToken}
    />
  );
}
