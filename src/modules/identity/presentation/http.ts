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

/** An uncached, empty 403. */
export function forbidden(): Response {
  return new Response(null, { status: 403, headers: NO_STORE });
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

/**
 * The admin path to return to after sign-in, taken from the Referer when it is a
 * same-origin admin page other than the auth pages; otherwise `/admin`. The sign-in
 * start sanitizes it again.
 */
export function returnPathFromReferer(referer: string | null, publicBaseUrl: string): string {
  if (referer === null) return "/admin";
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return "/admin";
  }
  if (url.origin !== new URL(publicBaseUrl).origin) return "/admin";
  const path = url.pathname;
  const inAdmin = path === "/admin" || path.startsWith("/admin/");
  const inAuth = path === "/admin/auth" || path.startsWith("/admin/auth/");
  return inAdmin && !inAuth ? path : "/admin";
}
