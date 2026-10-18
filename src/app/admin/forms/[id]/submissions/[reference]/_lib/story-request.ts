import { actorOf, requireCsrf, text, type CsrfContext } from "@/app/admin/_lib/request";
import type { Actor } from "@/modules/definitions/application";
import { EMPTY_QUERY, parseListQuery, type ListQuery } from "@/modules/review/application";
import { storyPath, type StoryParams } from "@/modules/review/presentation/story-params";

/** The route params of every handler under a story page. */
export interface StoryRouteContext {
  params: Promise<{ id: string; reference: string }>;
}

/** The list query a story form posts in `back`, parsed with parseListQuery, so nothing else survives. */
export function backQuery(form: FormData): ListQuery {
  return parseListQuery(Object.fromEntries(new URLSearchParams(text(form, "back"))));
}

/** The story page's own keys a route sends back. */
export type StoryReturnParams = Partial<Omit<StoryParams, "query">>;

/** The story page path from the route's params and the posted `back` query (parsed with parseListQuery, so nothing else survives). */
export function storyReturn(
  formId: string,
  reference: string,
  form: FormData,
  story?: StoryReturnParams,
  hash?: "photos" | "readiness" | "plan",
): string {
  const path = storyPath(formId, reference, backQuery(form), story);
  return hash === undefined ? path : `${path}#${hash}`;
}

/** A guarded story post: the params, the session's container and form, and who is acting. */
export interface StoryPost extends CsrfContext {
  formId: string;
  reference: string;
  actor: Actor;
}

/**
 * `requireCsrf` for a story POST: sign-in returns with a GET, so it goes back to the story
 * page without a query (which may carry what was typed), never to the route.
 * See specs/ui-ux/manager.md, "Routes".
 */
export async function guardStoryPost(
  request: Request,
  context: StoryRouteContext,
): Promise<StoryPost | Response> {
  const { id, reference } = await context.params;
  const guarded = await requireCsrf(request, storyPath(id, reference, EMPTY_QUERY));
  if (guarded instanceof Response) return guarded;
  return { ...guarded, formId: id, reference, actor: actorOf(guarded.session, request) };
}
