import type { Metadata } from "next";
import { pageSession } from "@/app/admin/_lib/page";
import { EMPTY_QUERY, openStory } from "@/modules/review/application";
import { StoryNotFound } from "@/modules/review/presentation/StoryNotFound";
import { StoryPage } from "@/modules/review/presentation/StoryPage";
import { parseStoryParams, storyPath } from "@/modules/review/presentation/story-params";
import { pageMetadata } from "@/shared/presentation/metadata";

/**
 * Blocks on the session and the database, as the gated layout does: without it,
 * dev's instant-navigation check reports the uncached reads. Build passes either way.
 */
export const instant = false;

type Params = Promise<{ id: string; reference: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Titled with the reference only: the title must not load the story, which records a view. */
export async function generateMetadata(props: { params: Params }): Promise<Metadata> {
  const { reference } = await props.params;
  return pageMetadata({ en: reference, es: reference });
}

/**
 * One submission's story page, keeping the list's query for Back, Newer and Older. Opening it
 * records the view (and turns `new` into `viewed`). A story that is gone renders the not-found
 * body inside the shell, never `notFound()` (ADR 0027). See specs/ui-ux/manager.md, "Story page".
 */
export default async function StoryPageRoute(props: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id, reference } = await props.params;
  const { session, container, actor } = await pageSession(storyPath(id, reference, EMPTY_QUERY));
  const params = parseStoryParams(await props.searchParams);
  const view = await openStory(container.review, actor, {
    formId: id,
    reference,
    query: params.query,
  });
  if (view === null) return <StoryNotFound formId={id} query={params.query} />;
  return <StoryPage view={view} params={params} csrfToken={session.csrfToken} />;
}
