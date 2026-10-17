"use client";

import { createContext } from "react";

/**
 * The server render's time (ISO), the value of the page form's `_rendered` input, which early
 * uploads send too. `PageEnhancer` provides it.
 */
export const RenderedAtContext = createContext("");
