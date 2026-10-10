/** Framework-free request and response helpers for the admin auth routes and the gate. */

export const SIGN_IN_PATH = "/admin/auth/signin";
export const DENIED_PATH = "/admin/auth/denied";
export const SIGNED_OUT_PATH = "/admin/auth/signed-out";
export const ERROR_PATH = "/admin/auth/error";
/** The one automatic restart; see specs/use-cases/sign-in.md, "Alternate flows and errors". */
export const RETRY_SIGN_IN_PATH = `${SIGN_IN_PATH}?returnTo=/admin&retried=1`;

const NO_STORE = { "Cache-Control": "no-store" };

/** An uncached 302 to `location`, carrying each Set-Cookie value as its own header. */
export function redirectTo(location: string, setCookies: readonly string[] = []): Response {
  const headers = new Headers({ Location: location, ...NO_STORE });
  for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

/** An uncached 403 carrying an HTML page. */
export function forbidden(html: string): Response {
  return new Response(html, {
    status: 403,
    headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE },
  });
}

/** The first `x-forwarded-for` value, set by the reverse proxy, or null. */
export function clientIp(headers: Headers): string | null {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first ? first : null;
}

/** The sign-in route that returns to `returnTo` afterwards. */
export function signInPath(returnTo: string): string {
  return `${SIGN_IN_PATH}?returnTo=${encodeURIComponent(returnTo)}`;
}
