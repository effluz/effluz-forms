import type { ReactNode } from "react";
import { Bilingual } from "./Bilingual";
import { bothLanguages, copy, type CopyKey } from "./copy";
import { cx, styles } from "./styles";

export type ManagerSection = "forms" | "operations" | "audit";

/** The sign-out route handler; see specs/use-cases/sign-in.md. */
const SIGN_OUT_PATH = "/admin/auth/signout";

const SECTIONS: readonly {
  section: ManagerSection;
  label: CopyKey;
  href: string;
  /** False until the section's page exists. */
  ready: boolean;
}[] = [
  { section: "forms", label: "nav.forms", href: "/admin/forms", ready: true },
  // Operations and Audit render as disabled placeholders (aria-disabled, no href) until
  // their pages exist; set `ready` when each page ships.
  { section: "operations", label: "nav.operations", href: "/admin/operations", ready: false },
  { section: "audit", label: "nav.audit", href: "/admin/audit", ready: false },
];

/**
 * The manager chrome around every gated admin page: skip link, wordmark, primary
 * navigation, who is signed in and sign-out, then the page in its main landmark.
 * See specs/ui-ux/manager.md, "Shell".
 */
export function ManagerShell(props: {
  name: string;
  csrfToken: string;
  current: ManagerSection;
  children: ReactNode;
}) {
  const currentLabel = SECTIONS.find((s) => s.section === props.current)?.label ?? "nav.forms";
  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main">
        <Bilingual k="shell.skip_to_main" />
      </a>
      <header className={styles.header}>
        <a className={styles.wordmark} href="/admin/forms">
          <Bilingual k="shell.wordmark" />
        </a>
        <nav className={styles.nav} aria-label={bothLanguages(copy["shell.main_nav"])}>
          {/* Below 768 px the links sit in a disclosure; from 768 px CSS shows the bar instead. */}
          <details className={styles.navMenu}>
            <summary className={styles.navSummary}>
              <Bilingual k={currentLabel} />
            </summary>
            <NavLinks current={props.current} />
          </details>
          <NavLinks current={props.current} bar />
        </nav>
        <div className={styles.account}>
          <span className={styles.who}>
            <Bilingual k="shell.signed_in_as" vars={{ name: props.name }} />
          </span>
          <SignOutForm csrfToken={props.csrfToken} />
        </div>
      </header>
      <main id="main" tabIndex={-1} className={styles.main}>
        {props.children}
      </main>
    </div>
  );
}

function NavLinks({ current, bar = false }: { current: ManagerSection; bar?: boolean }) {
  return (
    <ul className={cx(styles.navList, bar && styles.navBar)}>
      {SECTIONS.map(({ section, label, href, ready }) => (
        <li key={section}>
          {/* The page being shown exists, so its own section is always a link. */}
          {!ready && section !== current ? (
            <a className={styles.navLink} aria-disabled="true">
              <Bilingual k={label} />
            </a>
          ) : (
            <a
              className={styles.navLink}
              href={href}
              {...(section === current ? { "aria-current": "page" as const } : {})}
            >
              <Bilingual k={label} />
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A plain form, so sign-out works without JavaScript; the token guards against CSRF. */
function SignOutForm({ csrfToken }: { csrfToken: string }) {
  return (
    <form className={styles.signOut} method="post" action={SIGN_OUT_PATH}>
      <input type="hidden" name="csrf" value={csrfToken} />
      <button className={styles.button} type="submit">
        <Bilingual k="nav.sign_out" />
      </button>
    </form>
  );
}
