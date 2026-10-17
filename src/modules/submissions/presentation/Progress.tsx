import type { ReactElement } from "react";
import type { Locale } from "@/shared/domain/localized-text";
import { t } from "./copy";
import { styles } from "./styles";

/**
 * "Page n of total" and a bar that says the same thing, on forms of two or more pages. The total
 * counts the pages the answers so far make visible. See specs/ui-ux/renderer.md, "Form page".
 */
export function Progress(props: {
  locale: Locale;
  position: { n: number; total: number };
}): ReactElement | null {
  const { n, total } = props.position;
  if (total < 2) return null;
  return (
    <div className={styles.progress}>
      <p id="progress-text" aria-live="polite" className={styles.progressText}>
        {t(props.locale, "progress", { n: String(n), total: String(total) })}
      </p>
      <div
        role="progressbar"
        aria-labelledby="progress-text"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={n}
        className={styles.progressTrack}
      >
        <div className={styles.progressFill} style={{ width: `${String((n / total) * 100)}%` }} />
      </div>
    </div>
  );
}
