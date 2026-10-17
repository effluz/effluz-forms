import type { Metadata } from "next";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import type { ViewResult } from "@/modules/submissions/application";
import { decodeFillPostState, FILL_STATE_COOKIE } from "@/modules/submissions/presentation/cookies";
import { type ChromeKey, t } from "@/modules/submissions/presentation/copy";
import { pageTitle, refusedFileMessages } from "@/modules/submissions/presentation/field-views";
import {
  ErrorScreen,
  NotFoundScreen,
  RendererScreen,
  viewLocale,
} from "@/modules/submissions/presentation/Screens";
import { resolveText } from "@/shared/domain/localized-text";
import { rendererLogger } from "./_lib/log";
import { errorClass, formPath } from "./_lib/respond";
import { postPage } from "./actions";
import { loadView } from "./view";

/** Blocks on the fill cookie and the database: every render is the visitor's own. */
export const instant = false;

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (value: string | string[] | undefined): string | null =>
  typeof value === "string" ? value : null;

const hidden: Metadata["robots"] = { index: false };

/** The error screen's metadata: both languages, never indexed. */
const errorMetadata = (): Metadata => ({
  title: `${t("es", "error_title")} / ${t("en", "error_title")}`,
  robots: hidden,
});

/** A screen title in the screen's language, Spanish first and both on a bilingual form. */
function screenTitle(view: ViewResult, key: ChromeKey): string {
  const locale = viewLocale(view);
  const bilingual = view.screen === "not_found" || view.form.languages === "bilingual";
  if (!bilingual) return t(locale, key);
  return `${t("es", key)} / ${t("en", key)}`;
}

/** The document title of each screen (WCAG 2.4.2); only form pages may be indexed. */
export async function generateMetadata(props: {
  params: Params;
  searchParams: SearchParams;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const query = await props.searchParams;
  if (one(query.error) === "1") return errorMetadata();
  let view: ViewResult;
  try {
    ({ view } = await loadView(slug, one(query.expired) === "1"));
  } catch {
    // The page fails the same way, shows the error screen and logs it; this does not log again.
    return errorMetadata();
  }
  switch (view.screen) {
    case "page":
      return { title: pageTitle(view).documentTitle };
    case "confirmation": {
      const { document } = view.version;
      return {
        title: resolveText(document.title, view.locale, document.languages),
        robots: hidden,
      };
    }
    case "closed":
      return { title: screenTitle(view, "closed_title"), robots: hidden };
    case "not_open":
      return { title: screenTitle(view, "not_open_title"), robots: hidden };
    case "expired":
      return { title: screenTitle(view, "expired_title"), robots: hidden };
    case "not_found":
      return { title: screenTitle(view, "not_found_title"), robots: hidden };
  }
}

/**
 * GET /f/<slug>: the screen the visitor is on. `?refused=<at>` shows the refused files the
 * post tagged `at` left in `effluz_fill_state`; a render cannot set cookies, so it never
 * clears that cookie. `?error=1` is where a failed page post lands. A view that cannot be
 * loaded is logged and shows the error screen. See specs/ui-ux/renderer.md, "Screens", "Error"
 * and "Routes".
 */
export default async function RendererPage(props: { params: Params; searchParams: SearchParams }) {
  const { slug } = await props.params;
  const query = await props.searchParams;
  // Not thrown to a boundary, not `notFound()`, not `redirect()`: with Cache Components on,
  // Next 16.4.0 serves the prerendered shell's status (200) and has no server-side error
  // boundary, so anything thrown or redirected while rendering reaches the browser as an empty
  // document with the screen only in the RSC payload, whatever the layout tree (measured, ADR
  // 0027). Rendered here it is real HTML; the status stays 200 and the metadata keeps it out
  // of search indexes.
  if (one(query.error) === "1") return <ErrorScreen tryAgainHref={formPath(slug)} slug={slug} />;
  let loaded: Awaited<ReturnType<typeof loadView>>;
  let stateCookie: string | undefined;
  try {
    loaded = await loadView(slug, one(query.expired) === "1");
    stateCookie = (await cookies()).get(FILL_STATE_COOKIE)?.value;
  } catch (error) {
    // Next's own control flow (a prerender bailout, a redirect) is not a failure.
    unstable_rethrow(error);
    rendererLogger().error("form render failed", { slug, error: errorClass(error) });
    return <ErrorScreen tryAgainHref={formPath(slug)} slug={slug} />;
  }
  const { view, container } = loaded;
  if (view.screen === "not_found") return <NotFoundScreen />;
  const { registry } = container.submissions;
  const refusedFiles =
    view.screen === "page"
      ? refusedFileMessages(decodeFillPostState(stateCookie, one(query.refused)), view, registry)
      : [];
  return (
    <RendererScreen
      view={view}
      slug={slug}
      contact={container.config.privacyContactEmail}
      registry={registry}
      formAction={postPage.bind(null, slug)}
      refusedFiles={refusedFiles}
    />
  );
}
