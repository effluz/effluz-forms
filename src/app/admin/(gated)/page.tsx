import { redirect } from "next/navigation";

/** A redirect has no instant shell to validate; dev reports it otherwise. */
export const instant = false;

/** The admin home is the forms list; see specs/ui-ux/manager.md, "Principles". */
export default function AdminHome() {
  redirect("/admin/forms");
}
