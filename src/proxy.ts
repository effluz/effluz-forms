import { NextResponse, type NextRequest } from "next/server";
import { getContainer } from "@/app/container";
import { currentSession } from "@/modules/identity/application";
import { clientIp, ERROR_PATH, signInPath } from "@/modules/identity/presentation/http";
import type { Logger } from "@/shared/application/ports/logger";

/**
 * The HTTP-level admin gate. Every request under /admin except the auth routes needs
 * an active session, or gets a real 302 to sign-in that returns to the requested
 * path. It runs on the Node.js runtime, the Proxy default in Next 16 (a `runtime`
 * option is not allowed here), so it can reach Postgres through the container.
 * The `(gated)` layout checks again as defence in depth; see ADR 0018 and
 * specs/use-cases/sign-in.md, "Trigger".
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, searchParams } = request.nextUrl;
  if (pathname === "/admin/auth" || pathname.startsWith("/admin/auth/")) return NextResponse.next();

  let logger: Logger | undefined;
  try {
    const container = getContainer();
    logger = container.logger;
    const sessionId = request.cookies.get(container.config.session.cookieName)?.value || null;
    const current = await currentSession(container.identity, {
      sessionId,
      meta: { ip: clientIp(request.headers) },
    });
    if (current.state === "active") return NextResponse.next();

    // `_rsc` is Next's internal cache-busting parameter on client navigations.
    const query = new URLSearchParams(searchParams);
    query.delete("_rsc");
    const search = query.size > 0 ? `?${query.toString()}` : "";
    return NextResponse.redirect(
      new URL(signInPath(`${pathname}${search}`), container.config.publicBaseUrl),
      302,
    );
  } catch (e) {
    // Never let a request through when the session cannot be checked (database down).
    logger?.warn("admin gate failed", { error: e instanceof Error ? e.name : "Error" });
    return NextResponse.redirect(new URL(ERROR_PATH, request.url), 302);
  }
}

export const config = {
  matcher: ["/admin/:path*"],
};
