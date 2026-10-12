"use client";

import { usePathname } from "next/navigation";
import type { Text } from "@/shared/presentation/copy";
import { errorCopy } from "@/modules/submissions/presentation/error-copy";
import { styles } from "@/modules/submissions/presentation/styles";

/** Spanish first and English after it, as every screen without a chosen language. */
function Both(props: { text: Text }) {
  return (
    <>
      {props.text.es}
      <span lang="en" className={styles.secondLanguage}>
        {props.text.en}
      </span>
    </>
  );
}

/**
 * The renderer's error screen for an unexpected failure of a page render or a page post:
 * nothing is known about the form, so both languages, and a Try again link back to the page.
 * See specs/ui-ux/renderer.md, "Error".
 */
export default function RendererError() {
  const pathname = usePathname();
  return (
    <div className={styles.page}>
      <main id="content" tabIndex={-1} className={styles.main}>
        <h1 className={styles.title}>
          <Both text={errorCopy.title} />
        </h1>
        <p>
          <Both text={errorCopy.body} />
        </p>
        <p>
          <a href={pathname} className={styles.primaryLink}>
            <Both text={errorCopy.tryAgain} />
          </a>
        </p>
      </main>
    </div>
  );
}
