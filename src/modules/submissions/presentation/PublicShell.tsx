import type { ReactElement, ReactNode } from "react";
import type { Languages, Locale } from "@/shared/domain/localized-text";
import { chrome, type ChromeKey, t } from "./copy";
import { fill } from "@/shared/presentation/copy";
import { styles } from "./styles";

type Vars = Readonly<Record<string, string>>;

const other = (locale: Locale): Locale => (locale === "en" ? "es" : "en");

/**
 * A chrome string in the page language and, on a bilingual form with no language chosen, the
 * other language after it in `<span lang>`, after a space so the two never run together in the
 * text or the accessible name. `vars` may differ per language (dates).
 * See specs/ui-ux/renderer.md, "Closed, not yet open, not found".
 */
export function Both(props: {
  k: ChromeKey;
  locale: Locale;
  languages: Languages;
  vars?: Vars | ((locale: Locale) => Vars);
}): ReactElement {
  const varsFor = (locale: Locale): Vars =>
    typeof props.vars === "function" ? props.vars(locale) : (props.vars ?? {});
  const second = other(props.locale);
  return (
    <>
      {t(props.locale, props.k, varsFor(props.locale))}
      {props.languages === "bilingual" ? (
        <>
          {" "}
          <span lang={second} className={styles.secondLanguage}>
            {t(second, props.k, varsFor(second))}
          </span>
        </>
      ) : null}
    </>
  );
}

/** A template with one `{name}` placeholder replaced by an element. */
export function withElement(template: string, name: string, element: ReactNode): ReactNode {
  const [before = "", after = ""] = template.split(`{${name}}`);
  return (
    <>
      {before}
      {element}
      {after}
    </>
  );
}

function PrivacyLine(props: {
  locale: Locale;
  retentionMonths: number;
  contact: string;
}): ReactElement {
  const text = fill(chrome.privacy_footer[props.locale], {
    retention: new Intl.NumberFormat(props.locale).format(props.retentionMonths),
    contact: "{contact}",
  });
  return (
    <>{withElement(text, "contact", <a href={`mailto:${props.contact}`}>{props.contact}</a>)}</>
  );
}

/**
 * What the form does with answers, on every screen that has a form: retention and a way to ask
 * for deletion, in one language or, before a language is chosen, in both.
 */
export function PrivacyFooter(props: {
  locale: Locale;
  languages: Languages;
  both: boolean;
  retentionMonths: number;
  contact: string;
}): ReactElement {
  const second = other(props.locale);
  return (
    <footer className={styles.footer}>
      <p>
        <PrivacyLine
          locale={props.locale}
          retentionMonths={props.retentionMonths}
          contact={props.contact}
        />
      </p>
      {props.both && props.languages === "bilingual" ? (
        <p lang={second} className={styles.secondLanguage}>
          <PrivacyLine
            locale={second}
            retentionMonths={props.retentionMonths}
            contact={props.contact}
          />
        </p>
      ) : null}
    </footer>
  );
}

/**
 * The frame of every public screen: the skip link, the wordmark, the language switch, the
 * progress and the footer around `<main>`. On a page with a form it opens with the hidden
 * default action, so Enter in a text field means Next (or Submit on the last page) and never a
 * Remove button that comes earlier in tree order. See specs/ui-ux/renderer.md, "Layout".
 */
export function PublicShell(props: {
  locale: Locale;
  /** Present on a page with the form `#page-form`. */
  form?: { defaultAction: "next" | "submit"; switchTo: Locale | null };
  progress?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const { locale, form } = props;
  return (
    <div className={styles.page}>
      {form ? (
        <button
          type="submit"
          form="page-form"
          name="_action"
          value={form.defaultAction}
          tabIndex={-1}
          aria-hidden="true"
          className={styles.defaultAction}
        />
      ) : null}
      {form ? (
        <a href="#content" className={styles.skip}>
          {t(locale, "skip_link")}
        </a>
      ) : null}
      <header className={styles.header}>
        {/* The spec asks for an SVG wordmark that design-system/assets/README.md lists but
            does not ship yet; the text stands in until it does. */}
        <span className={styles.wordmark}>{t(locale, "wordmark")}</span>
        {form?.switchTo ? (
          <div
            role="group"
            aria-label={t(locale, "language_switch_label")}
            className={styles.languages}
          >
            <button
              type="submit"
              form="page-form"
              name="_action"
              value={`language:${form.switchTo}`}
              lang={form.switchTo}
              className={styles.tertiary}
            >
              {t(locale, form.switchTo === "es" ? "switch_to_es" : "switch_to_en")}
            </button>
          </div>
        ) : null}
      </header>
      {props.progress}
      <main id="content" tabIndex={-1} className={styles.main}>
        {props.children}
      </main>
      {props.footer}
    </div>
  );
}
