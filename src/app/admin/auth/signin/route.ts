import { connection } from "next/server";
import { getContainer } from "@/app/container";
import { startSignIn } from "@/modules/identity/application";
import {
  ATTEMPT_COOKIE_PATH,
  attemptCookie,
  clearedCookie,
  RETRY_COOKIE,
  retryCookie,
} from "@/modules/identity/presentation/cookies";
import { ERROR_PATH, redirectTo } from "@/modules/identity/presentation/http";

/** GET /admin/auth/signin?returnTo=…: starts sign-in. See specs/use-cases/sign-in.md, "Main flow". */
export async function GET(request: Request): Promise<Response> {
  // Request-time only: with Cache Components a GET handler is otherwise prerendered at build.
  await connection();
  const { identity, config, logger } = getContainer();
  const query = new URL(request.url).searchParams;
  const secure = config.session.secure;
  try {
    const { attemptId, authorizationUrl } = await startSignIn(identity, {
      returnTo: query.get("returnTo") ?? "",
    });
    // A fresh start earns one automatic restart; only the restart itself sets the marker.
    const retry =
      query.get("retried") === "1"
        ? retryCookie(secure)
        : clearedCookie(RETRY_COOKIE, secure, ATTEMPT_COOKIE_PATH);
    return redirectTo(authorizationUrl, [attemptCookie(attemptId, secure), retry]);
  } catch (e) {
    // Google unavailable: error page with a retry, never a partial attempt.
    logger.warn("sign-in failed", { step: "start", error: e instanceof Error ? e.name : "Error" });
    return redirectTo(ERROR_PATH);
  }
}
