import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getContainer } from "@/app/container";
import { currentSession } from "@/modules/identity/application";
import { signInPath } from "@/modules/identity/presentation/http";
import { ManagerShell } from "@/shared/presentation/ManagerShell";
import { SECTION_HEADER, sectionFromHeader } from "@/shared/presentation/sections";

/**
 * Lets this segment block on the session read: with Cache Components a top-level
 * `cookies()` read in a layout is otherwise a build error. The root shell is still
 * prerendered, so `redirect()` here reaches the browser through the RSC payload
 * (status 200), not as an HTTP 3xx.
 */
export const instant = false;

/**
 * Defence in depth behind the proxy gate (src/proxy.ts), and the source of the
 * shell's identity. See specs/use-cases/sign-in.md, "Trigger".
 */
export default async function GatedLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const container = getContainer();
  const sessionId = jar.get(container.config.session.cookieName)?.value || null;
  const current = await currentSession(container.identity, { sessionId, meta: { ip: null } });
  // src/proxy.ts already redirected with the real request path; this is the second line.
  if (current.state !== "active") redirect(signInPath("/admin"));
  // A layout does not know the request path, so the proxy names the section in a header
  // (src/proxy.ts); a missing or unknown value reads as Forms.
  const section = sectionFromHeader((await headers()).get(SECTION_HEADER));
  return (
    <ManagerShell
      name={current.session.name}
      csrfToken={current.session.csrfToken}
      current={section}
    >
      {children}
    </ManagerShell>
  );
}
