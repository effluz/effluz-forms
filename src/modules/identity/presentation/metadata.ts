import type { Metadata } from "next";
import { copy, type CopyKey } from "./copy";

/** Admin pages are never indexed; see specs/system/security.md, "Transport and headers". */
export const adminMetadata: Metadata = { robots: { index: false, follow: false } };

/** A page title from its heading's copy, so each page is titled (WCAG 2.4.2). */
export function pageMetadata(title: CopyKey): Metadata {
  return { title: `${copy[title].en} / ${copy[title].es}` };
}
