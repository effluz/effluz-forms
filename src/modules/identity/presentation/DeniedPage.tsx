import { AuthPage } from "./AuthPage";

/** Shown when admission is refused. See specs/use-cases/sign-in.md, "Alternate flows and errors". */
export function DeniedPage() {
  return <AuthPage title="auth.denied_title" body="auth.denied_body" action="auth.denied_retry" />;
}
