// Placeholder sign-in page. The manager plan replaces it with the designed version.
import { DeniedPage } from "@/modules/identity/presentation/DeniedPage";
import { pageMetadata } from "@/modules/identity/presentation/metadata";

export const metadata = pageMetadata("auth.denied_title");

export default function Denied() {
  return <DeniedPage />;
}
