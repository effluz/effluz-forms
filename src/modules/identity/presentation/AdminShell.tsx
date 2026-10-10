import type { ReactNode } from "react";
import { Bilingual } from "./Bilingual";
import { SignOutForm } from "./SignOutForm";
import { styles } from "./styles";

/**
 * Interim admin chrome: wordmark, who is signed in, and sign-out. The manager plan
 * replaces it with the shell in specs/ui-ux/manager.md.
 */
export function AdminShell(props: { name: string; csrfToken: string; children: ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.wordmark}>
          <Bilingual k="shell.wordmark" />
        </span>
        <span className={styles.who}>
          <Bilingual k="shell.signed_in_as" vars={{ name: props.name }} />
        </span>
        <SignOutForm csrfToken={props.csrfToken} />
      </header>
      <main className={styles.main}>{props.children}</main>
    </div>
  );
}
