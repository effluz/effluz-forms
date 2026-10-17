import { NextResponse, type NextRequest } from "next/server";
import { getContainer } from "@/app/container";
import { currentSession } from "@/modules/identity/application";
import { clientIp, ERROR_PATH, signInPath } from "@/modules/identity/presentation/http";
import { rendererCsp } from "@/modules/submissions/presentation/csp";
import type { Logger } from "@/shared/application/ports/logger";
import { createLogger } from "@/shared/infrastructure/logging/logger";

/**
 * The HTTP-level admin gate. Every request under /admin except the auth routes needs
 * an active session, or gets a real 302 to sign-in that returns to the requested
 * path. It runs on the Node.js runtime, the Proxy default in Next 16 (a `runtime`
 * option is not allowed here), so it can reach Postgres through the container.
 * The `(gated)` layout checks again as defence in depth; see ADR 0018 and
 * specs/use-cases/sign-in.md, "Trigger". It also sets the renderer's
 * Content-Security-Policy on /f/<slug>, the page and its form posts, without
 * touching the container (specs/system/security.md, "Transport and headers").
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/f/")) return withRendererCsp(request);
  const method = request.method;
  if (pathname === "/admin/auth" || pathname.startsWith("/admin/auth/")) return NextResponse.next();

  let logger: Logger | undefined;
  let publicBaseUrl: string | undefined;
  try {
    const container = getContainer();
    logger = container.logger;
    publicBaseUrl = container.config.publicBaseUrl;
    const sessionId = request.cookies.get(container.config.session.cookieName)?.value || null;
    const current = await currentSession(container.identity, {
      sessionId,
      meta: { ip: clientIp(request.headers) },
    });
    if (current.state === "active") return NextResponse.next();
    return NextResponse.redirect(
      new URL(signInPath(returnPath(method, pathname, search)), container.config.publicBaseUrl),
      302,
    );
  } catch (e) {
    // Never let a request through when the session cannot be checked (database down).
    // Without a container (invalid configuration) a stand-alone logger still records
    // it, and the request's own URL is the only origin left to redirect on.
    (logger ?? fallbackLogger()).warn("admin gate failed", {
      error: e instanceof Error ? e.name : "Error",
    });
    return NextResponse.redirect(new URL(ERROR_PATH, publicBaseUrl ?? request.url), 302);
  }
}

/**
 * A fresh nonce per request, in the policy on the forwarded request (Next reads the nonce from
 * it and stamps its scripts) and on the response.
 */
function withRendererCsp(request: NextRequest): NextResponse {
  const nonce = btoa(crypto.randomUUID());
  const policy = rendererCsp(nonce, process.env.NODE_ENV === "development");
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", policy);
  return response;
}

/**
 * Where sign-in returns to, which it does with a GET. A GET or HEAD request returns to
 * itself, query included. Any other method hit a route that only answers POST, so it
 * returns to the page that posted: the New form page for `create`, the form's overview
 * for `lifecycle` and `delete`, and for a server action its own page; never a query,
 * which may carry what was typed. See specs/ui-ux/manager.md, "Routes".
 */
function returnPath(method: string, pathname: string, search: string): string {
  if (method === "GET" || method === "HEAD") return `${pathname}${withoutRsc(search)}`;
  if (pathname === "/admin/forms/create") return "/admin/forms/new";
  return pathname.replace(/\/(lifecycle|delete)$/, "");
}

/**
 * The query string as sent, minus Next's internal `_rsc` cache-busting parameter.
 * Pairs are kept verbatim: re-encoding would turn `/` into `%2F`, which
 * sanitizeReturnTo rejects.
 */
function withoutRsc(search: string): string {
  const pairs = search
    .replace(/^\?/, "")
    .split("&")
    .filter((pair) => pair !== "" && pair.split("=")[0] !== "_rsc");
  return pairs.length > 0 ? `?${pairs.join("&")}` : "";
}

let fallback: Logger | undefined;
function fallbackLogger(): Logger {
  fallback ??= createLogger({ service: "app", level: "warn", version: "unknown" });
  return fallback;
}

export const config = {
  matcher: ["/admin/:path*", "/f/:slug"],
};
