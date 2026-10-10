import type { ReactNode } from "react";
import { adminMetadata } from "@/modules/identity/presentation/metadata";

export const metadata = adminMetadata;

/** Wraps both the gated pages and the auth pages; it gates nothing itself. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
