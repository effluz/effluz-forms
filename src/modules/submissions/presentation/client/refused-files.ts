"use client";

import { createContext } from "react";
import type { RefusedFileMessage } from "../page-form-state";

/**
 * The refused files' messages for the page being shown. Its value always comes from the
 * server render (the page reads the state cookie), never from an action's return.
 */
export const RefusedFilesContext = createContext<readonly RefusedFileMessage[]>([]);
