import type { Metadata } from "next";
import { chrome } from "@/modules/submissions/presentation/copy";
import { NotFoundScreen } from "@/modules/submissions/presentation/Screens";

export const metadata: Metadata = {
  title: `${chrome.not_found_title.es} / ${chrome.not_found_title.en}`,
  robots: { index: false },
};

/**
 * Paths outside the three root layouts (`admin/`, `(home)/`, `f/[slug]/`), enabled by
 * `experimental.globalNotFound` in next.config.ts. Most stray links are public ones, so it is
 * the renderer's not-found screen, Spanish first.
 */
export default function GlobalNotFound() {
  return (
    <html lang="es">
      <body style={{ margin: 0 }}>
        <NotFoundScreen />
      </body>
    </html>
  );
}
