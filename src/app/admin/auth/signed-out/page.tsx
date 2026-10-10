// Placeholder sign-in page. The manager plan replaces it with the designed version.
import { pageMetadata } from "@/modules/identity/presentation/metadata";
import { SignedOutPage } from "@/modules/identity/presentation/SignedOutPage";

export const metadata = pageMetadata("auth.signed_out_title");

export default function SignedOut() {
  return <SignedOutPage />;
}
