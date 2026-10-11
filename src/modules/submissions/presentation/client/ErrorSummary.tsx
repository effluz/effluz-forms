"use client";

import { type ReactElement, useContext } from "react";
import type { Locale } from "@/shared/domain/localized-text";
import type { SummaryItem } from "../field-views";
import { styles } from "../styles";
import { RefusedFilesContext } from "./refused-files";
import { summaryEntries, summaryHeading } from "./summary";

/**
 * The summary above a page's first field: the stored issues plus the refused files the page
 * provides through `RefusedFilesContext`. See specs/ui-ux/renderer.md, "Validation and errors".
 */
export function ErrorSummary(props: {
  items: readonly SummaryItem[];
  locale: Locale;
  headings: { one: string; other: string };
}): ReactElement | null {
  const refused = useContext(RefusedFilesContext);
  const entries = summaryEntries(props.items, refused);
  if (entries.length === 0) return null;
  return (
    <div role="alert" data-error-summary="" className={styles.summary}>
      <h2 id="error-summary-heading" tabIndex={-1} className={styles.summaryHeading}>
        {summaryHeading(entries.length, props.locale, props.headings)}
      </h2>
      <ul className={styles.summaryList}>
        {entries.map((entry, index) => (
          <li key={index}>
            <a href={entry.href}>{entry.message}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
