import type { ReactElement } from "react";
import { styles } from "./styles";

/** The mark beside an error message, so the message never relies on color alone. */
export function ErrorIcon(): ReactElement {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" className={styles.errorIcon}>
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4v5M8 11.5v.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
