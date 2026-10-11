"use client";

import type { ReactElement, ReactNode } from "react";
import type { Locale } from "@/shared/domain/localized-text";
import type { PageFormAction, RefusedFileMessage } from "../page-form-state";
import { styles } from "../styles";
import { RefusedFilesContext } from "./refused-files";

export interface PageEnhancerProps {
  action: PageFormAction;
  slug: string;
  pageKey: string;
  locale: Locale;
  /** The view's `renderedAt`: new on every server render, a redirect back included. */
  renderId: string;
  /** A page change, so focus goes to the heading. */
  navigated: boolean;
  /** From the server render (the state cookie), never from the action. */
  refusedFiles: readonly RefusedFileMessage[];
  text: { submitting: string; uploadsPending: string; offline: string; submitFailed: string };
  children: ReactNode;
}

/**
 * The page form. Without script the browser posts it multipart to the page's own URL and
 * follows the action's redirect; with script React posts the same action. This file is the
 * markup; the enhancement (focus, submitting state, offline retry) arrives with it, which is
 * why `locale` and `text` are already props. See specs/ui-ux/renderer.md, "Navigation and
 * state".
 */
export function PageEnhancer(props: PageEnhancerProps): ReactElement {
  return (
    <form
      id="page-form"
      action={props.action}
      noValidate
      className={styles.form}
      data-slug={props.slug}
      data-page={props.pageKey}
      data-render-id={props.renderId}
      data-navigated={props.navigated ? "" : undefined}
    >
      <RefusedFilesContext.Provider value={props.refusedFiles}>
        {props.children}
      </RefusedFilesContext.Provider>
      <p role="status" data-status="" className={styles.status} />
    </form>
  );
}
