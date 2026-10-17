import type { ReactNode } from "react";
import { adminMetadata } from "@/shared/presentation/metadata";

export const metadata = adminMetadata;

/**
 * The staff root layout: it wraps both the gated pages and the auth pages and gates nothing
 * itself. The admin surface is English; the renderer has its own root layout so its
 * `<html lang>` follows the submitter's language.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
