import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ViewResult } from "@/modules/submissions/application";
import { decodeFillPostState, FILL_STATE_COOKIE } from "@/modules/submissions/presentation/cookies";
import { type ChromeKey, t } from "@/modules/submissions/presentation/copy";
import { pageTitle, refusedFileMessages } from "@/modules/submissions/presentation/field-views";
import {
  NotFoundScreen,
  RendererScreen,
  viewLocale,
} from "@/modules/submissions/presentation/Screens";
import { resolveText } from "@/shared/domain/localized-text";
import { postPage } from "./actions";
import { loadView } from "./view";

/** Blocks on the fill cookie and the database: every render is the visitor's own. */
export const instant = false;

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (value: string | string[] | undefined): string | null =>
  typeof value === "string" ? value : null;

const hidden: Metadata["robots"] = { index: false };

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
  let view: ViewResult;
  try {
    ({ view } = await loadView(slug, one(query.expired) === "1"));
  } catch {
    // The page fails the same way and its error boundary answers; metadata has no boundary.
    return { title: `${t("es", "error_title")} / ${t("en", "error_title")}`, robots: hidden };
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
 * clears that cookie. See specs/ui-ux/renderer.md, "Screens" and "Routes".
 */
export default async function RendererPage(props: { params: Params; searchParams: SearchParams }) {
  const { slug } = await props.params;
  const query = await props.searchParams;
  const { view, container } = await loadView(slug, one(query.expired) === "1");
  // Not `notFound()`: under this root layout, whose `slug` is a root parameter, Next 16.4.0
  // answers it with an empty error document and the screen only in the RSC payload, so
  // without script the visitor would see a blank page. Rendered here it is real HTML; the
  // status stays 200 and the metadata keeps it out of search indexes.
  if (view.screen === "not_found") return <NotFoundScreen />;
  const { registry } = container.submissions;
  const jar = await cookies();
  const refusedFiles =
    view.screen === "page"
      ? refusedFileMessages(
          decodeFillPostState(jar.get(FILL_STATE_COOKIE)?.value, one(query.refused)),
          view,
          registry,
        )
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
