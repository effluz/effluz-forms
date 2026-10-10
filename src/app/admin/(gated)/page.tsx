// Placeholder admin home. The manager plan replaces it with the forms list.
import { AdminHomePlaceholder } from "@/modules/identity/presentation/AdminHomePlaceholder";
import { pageMetadata } from "@/modules/identity/presentation/metadata";

export const metadata = pageMetadata("admin.home_placeholder");

export default function AdminHome() {
  return <AdminHomePlaceholder />;
}
