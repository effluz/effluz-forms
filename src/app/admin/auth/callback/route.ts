import { connection } from "next/server";
import { getContainer } from "@/app/container";
import {
  completeSignIn,
  sessionCookieMaxAgeSeconds,
  type CompleteSignInResult,
} from "@/modules/identity/application";
import {
  ATTEMPT_COOKIE,
  ATTEMPT_COOKIE_PATH,
  clearedCookie,
  readCookie,
  RETRY_COOKIE,
  sessionCookie,
} from "@/modules/identity/presentation/cookies";
import {
  clientIp,
  DENIED_PATH,
  ERROR_PATH,
  redirectTo,
  RETRY_SIGN_IN_PATH,
} from "@/modules/identity/presentation/http";

/**
 * GET /admin/auth/callback: finishes sign-in and maps the outcome to a redirect.
 * See specs/use-cases/sign-in.md, "Main flow" and "Alternate flows and errors".
 */
export async function GET(request: Request): Promise<Response> {
  // Request-time only: with Cache Components a GET handler is otherwise prerendered at build.
  await connection();
  const { identity, config, logger } = getContainer();
  const cookieHeader = request.headers.get("cookie");
  const secure = config.session.secure;
  const retried =
    new URL(request.url).searchParams.get("retried") === "1" ||
    readCookie(cookieHeader, RETRY_COOKIE) === "1";
  const clearAttempt = clearedCookie(ATTEMPT_COOKIE, secure, ATTEMPT_COOKIE_PATH);
  const clearRetry = clearedCookie(RETRY_COOKIE, secure, ATTEMPT_COOKIE_PATH);

  let result: CompleteSignInResult;
  try {
    result = await completeSignIn(identity, {
      attemptId: readCookie(cookieHeader, ATTEMPT_COOKIE),
      callbackUrl: request.url,
      meta: { ip: clientIp(request.headers) },
    });
  } catch (e) {
    logger.warn("sign-in failed", {
      step: "callback",
      error: e instanceof Error ? e.name : "Error",
    });
    return redirectTo(ERROR_PATH, [clearAttempt, clearRetry]);
  }

  switch (result.outcome) {
    case "signed_in":
      return redirectTo(result.returnTo, [
        sessionCookie(config.session.cookieName, result.session.id, {
          secure,
          maxAgeSeconds: sessionCookieMaxAgeSeconds(),
        }),
        clearAttempt,
        clearRetry,
      ]);
    case "denied":
      return redirectTo(DENIED_PATH, [clearAttempt, clearRetry]);
    case "retry":
      return retried
        ? redirectTo(ERROR_PATH, [clearAttempt, clearRetry])
        : redirectTo(RETRY_SIGN_IN_PATH, [clearAttempt]);
    case "error":
      return redirectTo(ERROR_PATH, [clearAttempt, clearRetry]);
  }
}
