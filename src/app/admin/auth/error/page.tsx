// Placeholder sign-in page. The manager plan replaces it with the designed version.
import { copy } from "@/modules/identity/presentation/copy";
import { SignInErrorPage } from "@/modules/identity/presentation/SignInErrorPage";
import { pageMetadata } from "@/shared/presentation/metadata";

export const metadata = pageMetadata(copy["auth.error_title"]);

export default function SignInError() {
  return <SignInErrorPage />;
}
