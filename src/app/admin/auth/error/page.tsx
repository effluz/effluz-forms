// Placeholder sign-in page. The manager plan replaces it with the designed version.
import { pageMetadata } from "@/modules/identity/presentation/metadata";
import { SignInErrorPage } from "@/modules/identity/presentation/SignInErrorPage";

export const metadata = pageMetadata("auth.error_title");

export default function SignInError() {
  return <SignInErrorPage />;
}
