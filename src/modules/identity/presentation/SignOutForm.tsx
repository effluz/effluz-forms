import { Bilingual } from "./Bilingual";
import { styles } from "./styles";

/** A plain form, so sign-out works without JavaScript; the token guards against CSRF. */
export function SignOutForm({ csrfToken }: { csrfToken: string }) {
  return (
    <form className={styles.form} method="post" action="/admin/auth/signout">
      <input type="hidden" name="csrf" value={csrfToken} />
      <button className={styles.button} type="submit">
        <Bilingual k="nav.sign_out" />
      </button>
    </form>
  );
}
