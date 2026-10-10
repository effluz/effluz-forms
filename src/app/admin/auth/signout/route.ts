import { getContainer } from "@/app/container";
import { signOut } from "@/modules/identity/application";
import { clearedCookie, readCookie } from "@/modules/identity/presentation/cookies";
import { csrfRejectedPage } from "@/modules/identity/presentation/csrf-page";
import {
  clientIp,
  ERROR_PATH,
  forbidden,
  redirectTo,
  SIGNED_OUT_PATH,
} from "@/modules/identity/presentation/http";

/** The `csrf` field of a form body, or "" when the body is not a form or lacks it. */
async function csrfField(request: Request): Promise<string> {
  try {
    const value = (await request.formData()).get("csrf");
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

/**
 * POST /admin/auth/signout with form field `csrf`: destroys the server-side session.
 * See specs/use-cases/sign-in.md, "Alternate flows and errors", and
 * specs/system/security.md, "Sessions".
 */
export async function POST(request: Request): Promise<Response> {
  const { identity, config, logger } = getContainer();
  const cookieName = config.session.cookieName;
  const sessionId = readCookie(request.headers.get("cookie"), cookieName);
  // No cookie, no Set-Cookie: a cross-site form post arrives without the SameSite=Lax
  // session cookie, and clearing it here would sign staff out without the CSRF token.
  if (sessionId === null) return redirectTo(SIGNED_OUT_PATH);

  let outcome: Awaited<ReturnType<typeof signOut>>;
  try {
    outcome = await signOut(identity, {
      sessionId,
      csrfToken: await csrfField(request),
      meta: { ip: clientIp(request.headers) },
    });
  } catch (e) {
    logger.warn("sign-out failed", { error: e instanceof Error ? e.name : "Error" });
    return redirectTo(ERROR_PATH);
  }
  if (outcome === "csrf_mismatch") return forbidden(csrfRejectedPage());
  return redirectTo(SIGNED_OUT_PATH, [clearedCookie(cookieName, config.session.secure)]);
}
