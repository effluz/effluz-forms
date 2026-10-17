import type { ReactNode } from "react";
import type { Locale } from "@/shared/domain/localized-text";
import { viewLocale } from "@/modules/submissions/presentation/Screens";
import { loadView } from "./view";

/** Blocks on the fill cookie and the database, as the page does. */
export const instant = false;

/**
 * `slug` is a root parameter, and with Cache Components the build asks for at least one value.
 * No slug can hold `_`, so the placeholder renders the not-found screen; every real slug
 * renders at request time.
 */
export function generateStaticParams(): { slug: string }[] {
  return [{ slug: "__placeholder__" }];
}

/**
 * The view's language. When the view cannot be loaded the page fails the same way, logs it and
 * shows the error screen, which leads in Spanish; a root layout that threw would leave no page
 * to show it.
 */
async function documentLocale(slug: string): Promise<Locale> {
  try {
    return viewLocale((await loadView(slug, false)).view);
  } catch {
    return "es";
  }
}

/**
 * The renderer's root layout: `<html lang>` is the language the screen is in, the record's or
 * the form's first. See specs/ui-ux/renderer.md, "Layout".
 */
export default async function RendererLayout(props: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  return (
    <html lang={await documentLocale(slug)}>
      <body style={{ margin: 0 }}>{props.children}</body>
    </html>
  );
}
