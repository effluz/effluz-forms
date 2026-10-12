"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getContainer } from "@/app/container";
import {
  postContext,
  savePage,
  submitForm,
  type PostOutcome,
} from "@/modules/submissions/application";
import {
  encodeFillPostState,
  encodeFillState,
  FILL_COOKIE,
  FILL_COOKIE_MAX_AGE_SECONDS,
  FILL_STATE_COOKIE,
  FILL_STATE_MAX_AGE_SECONDS,
  fillCookieOptions,
  parseFillState,
  refusedEntries,
} from "@/modules/submissions/presentation/cookies";
import { decodePagePost } from "@/modules/submissions/presentation/decode";
import type { FillPostState } from "@/modules/submissions/presentation/page-form-state";
import {
  errorClass,
  formPath,
  outcomeFillState,
  outcomeLocation,
  refusedLocation,
} from "./_lib/respond";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Refused = Extract<PostOutcome, { kind: "refused" }>;

/** What the post decided: a refused page with its files, another outcome, or nothing. */
type Decision =
  | { kind: "refused"; outcome: Refused; state: FillPostState }
  | { kind: "outcome"; outcome: Exclude<PostOutcome, Refused> }
  | { kind: "ignored" };

/**
 * The renderer's page form, with or without script: Next, Back, Submit, the language switch
 * and Remove. The page binds it to the slug. It always ends in a redirect (Post/Redirect/Get),
 * as `saveSettings` does: a refused post to `?refused=<at>` with its refused files in
 * `effluz_fill_state`, every other one to the page or the expired screen.
 * See specs/ui-ux/renderer.md, "Routes", and specs/system/security.md, "In-progress cookie".
 */
export async function postPage(slug: string, form: FormData): Promise<void> {
  const container = getContainer();
  const deps = container.submissions;
  const secure = container.config.session.secure;
  const jar = await cookies();
  const acceptLanguage = (await headers()).get("accept-language");
  const state = parseFillState(jar.get(FILL_COOKIE)?.value ?? null);
  const posted = form.get("_token");
  const submitToken = typeof posted === "string" && UUID.test(posted) ? posted : null;
  const at = deps.clock.now().getTime();

  let decision: Decision;
  try {
    const context = await postContext(deps, { slug, state, submitToken });
    if (!context.ok) {
      // The post context never refuses a page, only replaces the post.
      decision = { kind: "outcome", outcome: context.outcome as Exclude<PostOutcome, Refused> };
    } else {
      const decoded = await decodePagePost(form, context.version.document, deps.registry);
      if (decoded === null) {
        decision = { kind: "ignored" };
      } else {
        const post = { ...decoded, state, acceptLanguage };
        const outcome =
          decoded.action.kind === "submit"
            ? await submitForm(deps, context, post)
            : await savePage(deps, context, post);
        decision =
          outcome.kind === "refused"
            ? {
                kind: "refused",
                outcome,
                state: {
                  at,
                  page: outcome.page,
                  refusedFiles: refusedEntries(
                    outcome.refusedFiles,
                    context.version.document,
                    deps.registry,
                  ),
                },
              }
            : { kind: "outcome", outcome };
      }
    }
  } catch (error) {
    container.logger.error("form post failed", {
      slug,
      error: errorClass(error),
    });
    throw error;
  }

  // An unknown page or action changes nothing.
  if (decision.kind === "ignored") redirect(formPath(slug));

  const fill = outcomeFillState(decision.outcome);
  if (fill === "clear") jar.set(FILL_COOKIE, "", fillCookieOptions(slug, secure, 0));
  else if (fill !== "keep")
    jar.set(
      FILL_COOKIE,
      encodeFillState(fill) ?? "",
      fillCookieOptions(slug, secure, FILL_COOKIE_MAX_AGE_SECONDS),
    );

  if (decision.kind === "refused") {
    jar.set(
      FILL_STATE_COOKIE,
      encodeFillPostState(decision.state),
      fillCookieOptions(slug, secure, FILL_STATE_MAX_AGE_SECONDS),
    );
    redirect(refusedLocation(slug, at));
  }
  jar.set(FILL_STATE_COOKIE, "", fillCookieOptions(slug, secure, 0));
  redirect(outcomeLocation(slug, decision.outcome));
}
