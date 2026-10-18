import type { ManagerSection } from "./ManagerShell";

/**
 * The request header the proxy sets on every /admin request it lets through, and the gated
 * layout reads: a layout cannot see its own path. The proxy overwrites any value a client
 * sends. See specs/ui-ux/manager.md, "Shell".
 */
export const SECTION_HEADER = "x-effluz-section";

const SECTIONS: readonly ManagerSection[] = ["forms", "plan", "operations", "audit"];

/** The segment right after /admin, then the end, a slash or a query. */
const PREFIXES: readonly { section: ManagerSection; pattern: RegExp }[] = [
  { section: "plan", pattern: /^\/admin\/plan(?:[/?#]|$)/ },
  { section: "operations", pattern: /^\/admin\/operations(?:[/?#]|$)/ },
  { section: "audit", pattern: /^\/admin\/audit(?:[/?#]|$)/ },
];

/** The manager section a path belongs to; every path that is not another section is Forms. */
export function sectionOf(pathname: string): ManagerSection {
  return PREFIXES.find(({ pattern }) => pattern.test(pathname))?.section ?? "forms";
}

/** The section named by the proxy's header; a missing or unknown value reads as Forms. */
export function sectionFromHeader(value: string | null): ManagerSection {
  return SECTIONS.find((section) => section === value) ?? "forms";
}
