"use client";

import { useEffect } from "react";
import { clearDrafts } from "./form-dom";

/**
 * Mounted on the confirmation and session-expired screens: the form is submitted, or its
 * record is gone, so this tab forgets its session-storage drafts and no old fill reaches a new
 * one. Renders nothing. See specs/ui-ux/renderer.md, "Navigation and state".
 */
export function ClearDrafts(props: { slug: string }): null {
  useEffect(() => {
    clearDrafts(props.slug);
  }, [props.slug]);
  return null;
}
