import { Bilingual } from "./Bilingual";
import { Breadcrumbs } from "./Breadcrumbs";
import { styles } from "./styles";

/**
 * The body of a manager page that does not exist: breadcrumb, the one `<h1>`, one
 * sentence and one link back to the Forms list. It renders inside the shell the gated
 * layout already provides, so it adds none. See specs/ui-ux/manager.md, "States".
 */
export function NotFoundPage({ formsHref }: { formsHref: string }) {
  return (
    <>
      <Breadcrumbs
        items={[
          { label: <Bilingual k="nav.forms" />, href: formsHref },
          { label: <Bilingual k="shell.not_found_title" /> },
        ]}
      />
      <h1 className={styles.pageTitle}>
        <Bilingual k="shell.not_found_title" />
      </h1>
      <p>
        <Bilingual k="shell.not_found_body" />
      </p>
      <p>
        <a className={styles.button} href={formsHref}>
          <Bilingual k="shell.not_found_back" />
        </a>
      </p>
    </>
  );
}
