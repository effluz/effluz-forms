// Placeholder sign-in page. The manager plan replaces it with the designed version.
import { copy } from "@/modules/identity/presentation/copy";
import { SignedOutPage } from "@/modules/identity/presentation/SignedOutPage";
import { pageMetadata } from "@/shared/presentation/metadata";

export const metadata = pageMetadata(copy["auth.signed_out_title"]);

export default function SignedOut() {
  return <SignedOutPage />;
}
