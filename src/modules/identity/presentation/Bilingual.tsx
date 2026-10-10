import { copy, fill, type CopyKey } from "./copy";
import { styles } from "./styles";

/**
 * English text with the Spanish line beneath it, marked `lang="es"`. There is no
 * language preference yet, so both are always shown. Identical text is shown once.
 */
export function Bilingual({ k, vars = {} }: { k: CopyKey; vars?: Record<string, string> }) {
  const en = fill(copy[k].en, vars);
  const es = fill(copy[k].es, vars);
  if (en === es) return <>{en}</>;
  return (
    <>
      {en}
      <span lang="es" className={styles.es}>
        {es}
      </span>
    </>
  );
}
