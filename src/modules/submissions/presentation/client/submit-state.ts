"use client";

import { createContext } from "react";

/** The page form's pending post, from `PageEnhancer` to the navigation buttons. */
export const SubmitStateContext = createContext<{ pending: boolean; action: string | null }>({
  pending: false,
  action: null,
});
