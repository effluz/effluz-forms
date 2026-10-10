import { callbackRedirectUri, type IdentityDeps } from "./deps";

/**
 * Keeps only same-site admin paths so the post-sign-in redirect cannot leave the app.
 * See specs/use-cases/sign-in.md, "Main flow".
 */
export function sanitizeReturnTo(input: string | null | undefined): string {
  if (!input) return "/admin";
  const inAdmin = input === "/admin" || input.startsWith("/admin/") || input.startsWith("/admin?");
  if (
    !inAdmin ||
    input.startsWith("//") ||
    // eslint-disable-next-line no-control-regex -- control characters are exactly what is rejected
    /[\\\u0000-\u001f]/.test(input) ||
    input.includes("://") ||
    /%2[ef]/i.test(input) ||
    /(^|[/?#&=])\.\.($|[/?#&=])/.test(input)
  ) {
    return "/admin";
  }
  return input;
}

/**
 * Begins sign-in: asks the provider for an authorization request and stores the
 * single-use attempt that the callback will consume.
 * See specs/use-cases/sign-in.md, "Main flow" steps 1 and 2.
 */
export async function startSignIn(
  deps: IdentityDeps,
  input: { returnTo: string },
): Promise<{ attemptId: string; authorizationUrl: string }> {
  const start = await deps.identity.beginSignIn(callbackRedirectUri(deps));
  const attemptId = deps.ids.newId();
  await deps.attempts.create({
    id: attemptId,
    state: start.state,
    nonce: start.nonce,
    codeVerifier: start.codeVerifier,
    returnTo: sanitizeReturnTo(input.returnTo),
    createdAt: deps.clock.now(),
  });
  return { attemptId, authorizationUrl: start.authorizationUrl };
}
