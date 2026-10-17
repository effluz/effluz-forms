"use client";

import { useEffect } from "react";
import { clearPostedMarker } from "./form-dom";

/**
 * Mounted on the error screen: a scripted page post failed on the server, so the page was not
 * sent. This drops the posted marker (never the drafts), and Try again restores the page's
 * unsent edits. Renders nothing. See specs/ui-ux/renderer.md, "Navigation and state".
 */
export function ClearPostedMarker(props: { slug: string }): null {
  useEffect(() => {
    clearPostedMarker(props.slug);
  }, [props.slug]);
  return null;
}
