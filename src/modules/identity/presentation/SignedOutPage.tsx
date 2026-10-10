import { AuthPage } from "./AuthPage";

/** Shown after sign-out. See specs/use-cases/sign-in.md, "Alternate flows and errors". */
export function SignedOutPage() {
  return (
    <AuthPage
      title="auth.signed_out_title"
      body="auth.signed_out_body"
      action="auth.signed_out_again"
    />
  );
}
