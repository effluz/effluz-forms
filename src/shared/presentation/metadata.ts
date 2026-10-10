import type { Metadata } from "next";
import { bothLanguages, copy, type CopyKey, type Text } from "./copy";

/** Admin pages are never indexed; see specs/system/security.md, "Transport and headers". */
export const adminMetadata: Metadata = { robots: { index: false, follow: false } };

/**
 * A page title from its heading's copy, so each page is titled (WCAG 2.4.2). Takes a
 * manager copy key, or the text itself for copy another module owns.
 */
export function pageMetadata(title: CopyKey | Text): Metadata {
  return { title: bothLanguages(typeof title === "string" ? copy[title] : title) };
}
