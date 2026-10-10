// Placeholder sign-in page. The manager plan replaces it with the designed version.
import { copy } from "@/modules/identity/presentation/copy";
import { DeniedPage } from "@/modules/identity/presentation/DeniedPage";
import { pageMetadata } from "@/shared/presentation/metadata";

export const metadata = pageMetadata(copy["auth.denied_title"]);

export default function Denied() {
  return <DeniedPage />;
}
