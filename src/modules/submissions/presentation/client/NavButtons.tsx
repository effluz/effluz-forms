"use client";

import type { ReactElement } from "react";
import { styles } from "../styles";

/**
 * The navigation row: Back (secondary) unless the page is the first, then Next or Submit
 * (primary). Markup only; the submitting and pending-upload behavior arrives with the
 * enhancement, which is why `submitting` and `uploadsPending` are already props.
 * See specs/ui-ux/renderer.md, "Form page" and "Navigation and state".
 */
export function NavButtons(props: {
  back: string | null;
  primary: { value: "next" | "submit"; label: string };
  submitting: string;
  uploadsPending: string;
}): ReactElement {
  return (
    <div className={styles.navigation}>
      {props.back === null ? null : (
        <button type="submit" name="_action" value="back" className={styles.secondary}>
          {props.back}
        </button>
      )}
      <button
        type="submit"
        name="_action"
        value={props.primary.value}
        data-primary=""
        className={styles.primary}
      >
        {props.primary.label}
      </button>
    </div>
  );
}
