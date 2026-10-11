"use client";

import { type ReactElement, useContext, useSyncExternalStore } from "react";
import { styles } from "../styles";
import { inFlight, onUploadsChange } from "./bus";
import { navButtonsState } from "./page-state";
import { SubmitStateContext } from "./submit-state";

const noUploads = (): number => 0;

/**
 * The navigation row: Back (secondary) unless the page is the first, then Next or Submit
 * (primary). While a post is pending every button is disabled and Submit shows a spinner and
 * "Submitting…"; while an upload on the page is in flight the primary waits, with the reason
 * beside it. Without script these are plain submit buttons. See specs/ui-ux/renderer.md,
 * "Form page", "File upload" and "Navigation and state".
 */
export function NavButtons(props: {
  back: string | null;
  primary: { value: "next" | "submit"; label: string };
  submitting: string;
  uploadsPending: string;
}): ReactElement {
  const pending = useContext(SubmitStateContext);
  const uploadsInFlight = useSyncExternalStore(onUploadsChange, inFlight, noUploads);
  const state = navButtonsState({
    pending: pending.pending,
    pendingAction: pending.action,
    uploadsInFlight,
  });
  const waitsForUploads = !state.disabled && state.primaryDisabled;
  return (
    <>
      <div className={styles.navigation}>
        {props.back === null ? null : (
          <button
            type="submit"
            name="_action"
            value="back"
            className={styles.secondary}
            disabled={state.disabled}
          >
            {props.back}
          </button>
        )}
        <button
          type="submit"
          name="_action"
          value={props.primary.value}
          data-primary=""
          className={styles.primary}
          disabled={state.primaryDisabled}
          aria-describedby={waitsForUploads ? "uploads-pending" : undefined}
        >
          {state.submitting ? (
            <>
              <span aria-hidden="true" className={styles.spinner} />
              {props.submitting}
            </>
          ) : (
            props.primary.label
          )}
        </button>
      </div>
      {waitsForUploads ? (
        <p id="uploads-pending" className={styles.hint}>
          {props.uploadsPending}
        </p>
      ) : null}
    </>
  );
}
