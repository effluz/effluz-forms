import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getContainer, type Container } from "@/app/container";
import type { Actor } from "@/modules/definitions/application";
import { currentSession, type Session } from "@/modules/identity/application";
import { clientIp, signInPath } from "@/modules/identity/presentation/http";

export interface PageSession {
  session: Session;
  container: Container;
  actor: Actor;
}

/**
 * The active session for a gated server component, or a redirect to sign-in
 * that returns to `path`. The proxy and the gated layout already check; this
 * is defence in depth and hands the page its session and actor. See
 * specs/use-cases/sign-in.md, "Trigger".
 */
export async function pageSession(path: string): Promise<PageSession> {
  const [jar, head] = await Promise.all([cookies(), headers()]);
  const container = getContainer();
  const sessionId = jar.get(container.config.session.cookieName)?.value || null;
  const ip = clientIp(head);
  const current = await currentSession(container.identity, { sessionId, meta: { ip } });
  if (current.state !== "active") redirect(signInPath(path));
  return { session: current.session, container, actor: { email: current.session.email, ip } };
}
