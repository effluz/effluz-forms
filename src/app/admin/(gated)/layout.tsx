import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getContainer } from "@/app/container";
import { currentSession } from "@/modules/identity/application";
import { AdminShell } from "@/modules/identity/presentation/AdminShell";
import { returnPathFromReferer, signInPath } from "@/modules/identity/presentation/http";

/**
 * Lets this segment block on the session read: with Cache Components a top-level
 * `cookies()` read in a layout is otherwise a build error. The root shell is still
 * prerendered, so `redirect()` here reaches the browser through the RSC payload
 * (status 200), not as an HTTP 3xx.
 */
export const instant = false;

/**
 * The session gate for every admin page outside /admin/auth.
 * See specs/use-cases/sign-in.md, "Trigger".
 */
export default async function GatedLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const container = getContainer();
  const sessionId = jar.get(container.config.session.cookieName)?.value || null;
  const current = await currentSession(container.identity, { sessionId, meta: { ip: null } });
  if (current.state !== "active") {
    // Server layouts do not see the request path; the Referer is the best available hint.
    const referer = (await headers()).get("referer");
    redirect(signInPath(returnPathFromReferer(referer, container.config.publicBaseUrl)));
  }
  return (
    <AdminShell name={current.session.name} csrfToken={current.session.csrfToken}>
      {children}
    </AdminShell>
  );
}
