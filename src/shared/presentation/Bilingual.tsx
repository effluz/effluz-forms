import { copy, fill, type CopyKey, type Text } from "./copy";
import { styles } from "./styles";

/**
 * Any text in both languages: English with the Spanish line beneath it, marked
 * `lang="es"`. There is no language preference yet, so both are always shown.
 * Identical text is shown once. Placeholders are filled as text, never as markup.
 */
export function BilingualText({ text, vars = {} }: { text: Text; vars?: Record<string, string> }) {
  const en = fill(text.en, vars);
  const es = fill(text.es, vars);
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

/** The manager copy for `k` in both languages; see `BilingualText`. */
export function Bilingual({ k, vars = {} }: { k: CopyKey; vars?: Record<string, string> }) {
  return <BilingualText text={copy[k]} vars={vars} />;
}
