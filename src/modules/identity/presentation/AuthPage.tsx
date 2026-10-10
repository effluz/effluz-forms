import { Bilingual } from "./Bilingual";
import type { CopyKey } from "./copy";
import { SIGN_IN_PATH } from "./http";
import { styles } from "./styles";

/** The layout shared by the pages outside the session gate: heading, message, one action. */
export function AuthPage(props: { title: CopyKey; body: CopyKey; action: CopyKey }) {
  return (
    <div className={styles.page}>
      <main className={styles.card}>
        <h1 className={styles.title}>
          <Bilingual k={props.title} />
        </h1>
        <p className={styles.body}>
          <Bilingual k={props.body} />
        </p>
        <a className={styles.primary} href={SIGN_IN_PATH}>
          <Bilingual k={props.action} />
        </a>
      </main>
    </div>
  );
}
