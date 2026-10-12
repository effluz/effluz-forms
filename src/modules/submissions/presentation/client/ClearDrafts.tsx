"use client";

import { useEffect } from "react";
import { clearDrafts } from "./form-dom";

/**
 * Mounted on the confirmation screen: the form is submitted, so this tab forgets its
 * session-storage drafts. Renders nothing. See specs/ui-ux/renderer.md, "Navigation and state".
 */
export function ClearDrafts(props: { slug: string }): null {
  useEffect(() => {
    clearDrafts(props.slug);
  }, [props.slug]);
  return null;
}
