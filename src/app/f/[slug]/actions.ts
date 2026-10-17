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
import { rendererLogger } from "./_lib/log";
import {
  errorClass,
  errorLocation,
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

/** The decision of one post, and what setting its cookies needs. */
interface Decided {
  decision: Decision;
  jar: Awaited<ReturnType<typeof cookies>>;
  secure: boolean;
  at: number;
}

/** Reads the request and lets the use cases decide the post; every failure throws. */
async function decide(slug: string, form: FormData): Promise<Decided> {
  const container = getContainer();
  const deps = container.submissions;
  const secure = container.config.session.secure;
  const jar = await cookies();
  const acceptLanguage = (await headers()).get("accept-language");
  const state = parseFillState(jar.get(FILL_COOKIE)?.value ?? null);
  const posted = form.get("_token");
  const submitToken = typeof posted === "string" && UUID.test(posted) ? posted : null;
  const at = deps.clock.now().getTime();

  const context = await postContext(deps, { slug, state, submitToken });
  if (!context.ok) {
    const { outcome } = context;
    // The post context replaces a post and never refuses a page.
    if (outcome.kind === "refused") throw new Error("post context refused a page");
    return { decision: { kind: "outcome", outcome }, jar, secure, at };
  }
  const decoded = await decodePagePost(form, context.version.document, deps.registry);
  if (decoded === null) return { decision: { kind: "ignored" }, jar, secure, at };
  const post = { ...decoded, state, acceptLanguage };
  const outcome =
    decoded.action.kind === "submit"
      ? await submitForm(deps, context, post)
      : await savePage(deps, context, post);
  const decision: Decision =
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
  return { decision, jar, secure, at };
}

/**
 * The renderer's page form, with or without script: Next, Back, Submit, the language switch
 * and Remove. The page binds it to the slug. It always ends in a redirect (Post/Redirect/Get),
 * as `saveSettings` does: a refused post to `?refused=<at>` with its refused files in
 * `effluz_fill_state`, an unexpected failure, logged, to the error screen (`?error=1`), every
 * other one to the page or the expired screen.
 * See specs/ui-ux/renderer.md, "Routes" and "Error", and specs/system/security.md,
 * "In-progress cookie".
 */
export async function postPage(slug: string, form: FormData): Promise<void> {
  let decided: Decided;
  try {
    decided = await decide(slug, form);
  } catch (error) {
    // Next would rethrow an MPA action's error into an empty document; the page renders it.
    rendererLogger().error("form post failed", { slug, error: errorClass(error) });
    redirect(errorLocation(slug));
  }
  const { decision, jar, secure, at } = decided;

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
