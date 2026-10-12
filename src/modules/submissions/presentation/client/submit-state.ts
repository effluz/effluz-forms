"use client";

import { createContext } from "react";

/** The page form's pending post, from `PageEnhancer` to the navigation buttons. */
export const SubmitStateContext = createContext<{
  pending: boolean;
  action: string | null;
  /** A post waits for uploads, and the status line says so. */
  waiting: boolean;
}>({
  pending: false,
  action: null,
  waiting: false,
});
