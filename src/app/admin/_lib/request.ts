import { getContainer, type Container } from "@/app/container";
import type { Actor } from "@/modules/definitions/application";
import { constantTimeEqual, currentSession, type Session } from "@/modules/identity/application";
import { readCookie } from "@/modules/identity/presentation/cookies";
import { staleFormPage } from "@/modules/identity/presentation/csrf-page";
import { clientIp, forbidden, redirectTo, signInPath } from "@/modules/identity/presentation/http";
import type { LocalizedText } from "@/shared/domain/localized-text";

/**
 * Request helpers for the admin route handlers that change data. The proxy
 * (src/proxy.ts) already gates every admin request; these are the second line
 * and the source of the session. See specs/system/security.md, "Sessions".
 */

export interface SessionContext {
  session: Session;
  container: Container;
}

export interface CsrfContext extends SessionContext {
  form: FormData;
}

/**
 * The active session behind the request's cookie, or a 302 to sign-in that
 * returns to `returnTo`. A route handler that only answers POST passes the
 * page the person came from, since sign-in returns with a GET.
 */
export async function requireSession(
  request: Request,
  returnTo: string = new URL(request.url).pathname,
): Promise<SessionContext | Response> {
  const container = getContainer();
  const sessionId = readCookie(request.headers.get("cookie"), container.config.session.cookieName);
  const current = await currentSession(container.identity, {
    sessionId,
    meta: { ip: clientIp(request.headers) },
  });
  if (current.state !== "active") {
    return redirectTo(signInPath(returnTo));
  }
  return { session: current.session, container };
}

/**
 * `requireSession`, then the form body, whose `csrf` field must equal the
 * session's token; otherwise a 403 with the out-of-date page.
 */
export async function requireCsrf(
  request: Request,
  returnTo?: string,
): Promise<CsrfContext | Response> {
  const guarded = await requireSession(request, returnTo);
  if (guarded instanceof Response) return guarded;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return forbidden(staleFormPage());
  }
  if (!constantTimeEqual(text(form, "csrf"), guarded.session.csrfToken)) {
    return forbidden(staleFormPage());
  }
  return { ...guarded, form };
}

/** Who is acting, for use cases and their audit entries. */
export function actorOf(session: Session, request: Request): Actor {
  return { email: session.email, ip: clientIp(request.headers) };
}

/** The string value of a form field, or "" when it is missing or a file. */
export function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** A text pair from the `${name}_en` and `${name}_es` fields, trimmed, blanks dropped. */
export function localized(form: FormData, name: string): LocalizedText {
  const result: LocalizedText = {};
  const en = text(form, `${name}_en`).trim();
  const es = text(form, `${name}_es`).trim();
  if (en !== "") result.en = en;
  if (es !== "") result.es = es;
  return result;
}

/** An uncached 303, the answer to a form post (Post/Redirect/Get). */
export function seeOther(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}

/**
 * A bare, uncached answer for a request that cannot be served (400, 404): the
 * status and, optionally, a text body. Never cached, since the same URL may be
 * valid a moment later.
 */
export function plain(status: number, body?: string): Response {
  return new Response(body ?? null, { status, headers: { "Cache-Control": "no-store" } });
}
