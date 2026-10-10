import { getContainer } from "@/app/container";
import { signOut } from "@/modules/identity/application";
import { clearedCookie, readCookie } from "@/modules/identity/presentation/cookies";
import {
  clientIp,
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
  const { identity, config } = getContainer();
  const cookieName = config.session.cookieName;
  const cleared = clearedCookie(cookieName, config.session.secure);
  const sessionId = readCookie(request.headers.get("cookie"), cookieName);
  if (sessionId === null) return redirectTo(SIGNED_OUT_PATH, [cleared]);

  const outcome = await signOut(identity, {
    sessionId,
    csrfToken: await csrfField(request),
    meta: { ip: clientIp(request.headers) },
  });
  if (outcome === "csrf_mismatch") return forbidden();
  return redirectTo(SIGNED_OUT_PATH, [cleared]);
}
