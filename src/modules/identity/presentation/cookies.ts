/**
 * Framework-free builders for the admin cookies, as Set-Cookie strings.
 * Attributes follow specs/system/security.md, "Sessions".
 */

/** Holds the single-use sign-in attempt id between the start and the callback. */
export const ATTEMPT_COOKIE = "effluz_signin";
/** Marks that the one automatic restart of sign-in has been used; see `retryCookie`. */
export const RETRY_COOKIE = "effluz_signin_retry";
/** The attempt and retry cookies only travel to the auth routes. */
export const ATTEMPT_COOKIE_PATH = "/admin/auth";
/** Matches the sign-in attempt's own ten-minute expiry. */
export const ATTEMPT_COOKIE_MAX_AGE_SECONDS = 600;

const SESSION_COOKIE_PATH = "/admin";

// RFC 6265 cookie-octet: anything else could end the value and inject attributes.
const COOKIE_VALUE = /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/;

function build(
  name: string,
  value: string,
  opts: { path: string; maxAgeSeconds: number; secure: boolean },
): string {
  if (!COOKIE_VALUE.test(value)) throw new Error(`Invalid value for cookie ${name}`);
  const parts = [
    `${name}=${value}`,
    `Path=${opts.path}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${String(opts.maxAgeSeconds)}`,
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

/** The opaque session cookie, scoped to the admin path. */
export function sessionCookie(
  name: string,
  value: string,
  opts: { secure: boolean; maxAgeSeconds: number },
): string {
  return build(name, value, { path: SESSION_COOKIE_PATH, ...opts });
}

/** The sign-in attempt cookie, set by the start route and read by the callback. */
export function attemptCookie(value: string, secure: boolean): string {
  return build(ATTEMPT_COOKIE, value, {
    path: ATTEMPT_COOKIE_PATH,
    maxAgeSeconds: ATTEMPT_COOKIE_MAX_AGE_SECONDS,
    secure,
  });
}

/**
 * Set when sign-in restarts automatically. The provider always returns to the
 * fixed redirect URI, so the restart cannot be remembered in the callback query.
 */
export function retryCookie(secure: boolean): string {
  return build(RETRY_COOKIE, "1", {
    path: ATTEMPT_COOKIE_PATH,
    maxAgeSeconds: ATTEMPT_COOKIE_MAX_AGE_SECONDS,
    secure,
  });
}

/**
 * Expires a cookie at once. Browsers key cookies by name and path, so `path`
 * must be the one the cookie was set with.
 */
export function clearedCookie(name: string, secure: boolean, path = SESSION_COOKIE_PATH): string {
  return build(name, "", { path, maxAgeSeconds: 0, secure });
}

/** The value of cookie `name` in a Cookie request header, or null when absent or empty. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return value === "" ? null : value;
  }
  return null;
}
