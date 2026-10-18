import type { ReactElement } from "react";
import { styles } from "../styles";

/**
 * The story page's icons. Each is decorative (`aria-hidden`): the words beside it carry the
 * meaning, and the icon's shape (a tick or a cross) carries the state besides its colour.
 */
export function StateIcon(props: { done: boolean }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={styles.checkIcon}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {props.done ? <path d="M4 10.5l4 4 8-9" /> : <path d="M5 5l10 10M15 5L5 15" />}
    </svg>
  );
}

/** The film icon a video tile shows in place of a thumbnail, sized by its class. */
export function FilmIcon(props: { className: string | undefined }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={props.className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
    </svg>
  );
}

/** The outward icon of an external link, 16 px (components.md, "Link"). */
export function OutwardIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={styles.externalIcon}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 3h4v4M13 3L7 9M11 9.5V13H3V5h3.5" />
    </svg>
  );
}
