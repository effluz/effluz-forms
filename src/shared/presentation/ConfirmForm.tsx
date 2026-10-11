import { useId } from "react";
import { Bilingual } from "./Bilingual";
import { bothLanguages, copy, type CopyKey, type Text } from "./copy";
import { styles } from "./styles";

/**
 * `value` as an HTML `pattern` that matches it literally. Browsers compile the
 * pattern with the `v` flag, where only syntax characters and `/` may be escaped.
 */
export function literalPattern(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}

/** "Label: value" in both languages, for the input's `title`. */
function typedTitle(label: Text, expected: string): string {
  return bothLanguages({ en: `${label.en}: ${expected}`, es: `${label.es}: ${expected}` });
}

/**
 * A confirmation rendered as a page section rather than a modal: a plain POST form
 * with the CSRF token, so it works without JavaScript. With `typeToConfirm` the
 * person types `expected` (a slug or a reference), shown beneath the label, before
 * the browser lets the form submit, and the confirm button is destructive; the
 * server checks the value again.
 * See design-system/components.md, "Dialog", and specs/ui-ux/manager.md,
 * "Form overview".
 */
export function ConfirmForm(props: {
  action: string;
  csrfToken: string;
  hidden: Record<string, string>;
  title: CopyKey;
  body: CopyKey;
  confirmLabel: CopyKey;
  cancelHref: string;
  typeToConfirm?: { name: string; expected: string; label: CopyKey };
}) {
  const id = useId();
  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;
  const inputId = `${id}-confirm`;
  const expectedId = `${id}-expected`;
  return (
    <section
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className={styles.dialog}
    >
      <h2 id={titleId} className={styles.dialogTitle}>
        <Bilingual k={props.title} />
      </h2>
      <p id={bodyId} className={styles.dialogBody}>
        <Bilingual k={props.body} />
      </p>
      <form className={styles.dialogForm} method="post" action={props.action}>
        <input type="hidden" name="csrf" value={props.csrfToken} />
        {Object.entries(props.hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {props.typeToConfirm ? (
          <div className={styles.field}>
            <label htmlFor={inputId} className={styles.label}>
              <Bilingual k={props.typeToConfirm.label} />
            </label>
            {/* The value to type, shown and read out, so nobody has to guess it. */}
            <code id={expectedId} className={styles.expected}>
              {props.typeToConfirm.expected}
            </code>
            <input
              id={inputId}
              className={styles.input}
              type="text"
              name={props.typeToConfirm.name}
              required
              pattern={literalPattern(props.typeToConfirm.expected)}
              // The browser's validation message adds the title, so it names the value.
              title={typedTitle(copy[props.typeToConfirm.label], props.typeToConfirm.expected)}
              aria-describedby={`${expectedId} ${bodyId}`}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
        ) : null}
        <div className={styles.actions}>
          <a className={styles.button} href={props.cancelHref}>
            <Bilingual k="shell.cancel" />
          </a>
          <button
            className={props.typeToConfirm ? styles.destructive : styles.primary}
            type="submit"
          >
            <Bilingual k={props.confirmLabel} />
          </button>
        </div>
      </form>
    </section>
  );
}
