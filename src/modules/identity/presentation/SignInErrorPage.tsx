import { AuthPage } from "./AuthPage";

/**
 * Shown when Google is unavailable or the restart also failed.
 * See specs/use-cases/sign-in.md, "Alternate flows and errors".
 */
export function SignInErrorPage() {
  return <AuthPage title="auth.error_title" body="auth.error_body" action="auth.error_retry" />;
}
