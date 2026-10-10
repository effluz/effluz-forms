import { Bilingual } from "./Bilingual";
import { styles } from "./styles";

/** Placeholder admin home. The manager plan replaces it with the forms list. */
export function AdminHomePlaceholder() {
  return (
    <h1 className={styles.title}>
      <Bilingual k="admin.home_placeholder" />
    </h1>
  );
}
