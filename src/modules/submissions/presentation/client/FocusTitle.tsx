"use client";

import { useEffect } from "react";
import { focusTitle } from "./form-dom";

/**
 * Mounted on the confirmation screen: after a scripted Submit the form and its focused button
 * are gone, so focus moves to the screen's heading. Renders nothing. See
 * specs/ui-ux/renderer.md, "Accessibility notes beyond the baseline".
 */
export function FocusTitle(): null {
  useEffect(() => {
    focusTitle();
  }, []);
  return null;
}
