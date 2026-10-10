// Interim admin home: the heading only, inside the shell's main landmark. The forms
// list task replaces this page with a redirect to /admin/forms.
import { Bilingual } from "@/shared/presentation/Bilingual";
import { pageMetadata } from "@/shared/presentation/metadata";
import { styles } from "@/shared/presentation/styles";

export const metadata = pageMetadata("nav.forms");

export default function AdminHome() {
  return (
    <h1 className={styles.pageTitle}>
      <Bilingual k="nav.forms" />
    </h1>
  );
}
