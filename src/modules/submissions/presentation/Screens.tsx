import type { ReactElement, ReactNode } from "react";
import type { Form } from "@/modules/definitions/application";
import type { FieldTypeRegistry } from "@/shared/domain/form-model";
import { type Locale, resolveText } from "@/shared/domain/localized-text";
import { parseRichText, richTextToPlain } from "@/shared/domain/rich-text";
import { RichBlocks } from "@/shared/presentation/RichText";
import type { ViewResult } from "../application";
import { ClearDrafts } from "./client/ClearDrafts";
import { ClearPostedMarker } from "./client/ClearPostedMarker";
import { FocusTitle } from "./client/FocusTitle";
import { t, type ChromeKey } from "./copy";
import { FormPage } from "./FormPage";
import { formatInstant } from "./format";
import type { PageFormAction, RefusedFileMessage } from "./page-form-state";
import { Both, PrivacyFooter, PublicShell, withElement } from "./PublicShell";
import { styles } from "./styles";

type Shown = Exclude<ViewResult, { screen: "not_found" }>;

/**
 * The language a screen is in: a page's and a confirmation's own. The other screens show both
 * languages of a bilingual form with Spanish first, since no language has been chosen; an
 * English-only form is shown in English.
 */
export function viewLocale(view: ViewResult): Locale {
  switch (view.screen) {
    case "page":
      return view.page.locale;
    case "confirmation":
      return view.locale;
    case "not_found":
      return "es";
    default:
      return view.form.languages === "en" ? "en" : "es";
  }
}

/**
 * "Start again" and "Fill in another form": a POST, since restarting changes state and a link
 * from any site must not do it. Works without script. See specs/ui-ux/renderer.md, "Routes".
 */
function RestartForm(props: {
  slug: string;
  className: string | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <form method="post" action={`/f/${props.slug}/restart`} className={styles.restartForm}>
      <button type="submit" className={props.className}>
        {props.children}
      </button>
    </form>
  );
}

/** A heading, one sentence and an optional button, in every language of the form. */
function Message(props: {
  form: Form;
  contact: string;
  title: ChromeKey;
  body: ChromeKey;
  vars?: (locale: Locale) => Record<string, string>;
  action?: { slug: string; label: ChromeKey };
  /** Client pieces with no markup of their own (ClearDrafts). */
  children?: ReactNode;
}): ReactElement {
  const { form } = props;
  const locale: Locale = form.languages === "en" ? "en" : "es";
  return (
    <PublicShell
      locale={locale}
      footer={
        <PrivacyFooter
          locale={locale}
          languages={form.languages}
          both
          retentionMonths={form.settings.retentionMonths}
          contact={props.contact}
        />
      }
    >
      <h1 className={styles.title}>
        <Both k={props.title} locale={locale} languages={form.languages} />
      </h1>
      <p>
        <Both
          k={props.body}
          locale={locale}
          languages={form.languages}
          {...(props.vars ? { vars: props.vars } : {})}
        />
      </p>
      {props.action ? (
        <RestartForm slug={props.action.slug} className={styles.primary}>
          <Both k={props.action.label} locale={locale} languages={form.languages} />
        </RestartForm>
      ) : null}
      {props.children}
    </PublicShell>
  );
}

function Confirmation(props: {
  view: Extract<ViewResult, { screen: "confirmation" }>;
  slug: string;
  contact: string;
}): ReactElement {
  const { form, version, locale, reference } = props.view;
  const { languages } = version.document;
  const [first, ...rest] = parseRichText(
    resolveText(version.document.confirmation.screen, locale, languages),
  );
  const heading = first ? richTextToPlain([first]) : "";
  const shell = (children: ReactNode): ReactElement => (
    <PublicShell
      locale={locale}
      footer={
        <PrivacyFooter
          locale={locale}
          languages={languages}
          both={false}
          retentionMonths={form.settings.retentionMonths}
          contact={props.contact}
        />
      }
    >
      {children}
    </PublicShell>
  );
  return shell(
    <>
      <h1 id="page-title" tabIndex={-1} className={styles.title}>
        {heading}
      </h1>
      {rest.length > 0 ? <RichBlocks blocks={rest} className={styles.description} /> : null}
      <p className={styles.reference}>
        {withElement(
          t(locale, "confirmation_reference", { ref: "{ref}" }),
          "ref",
          <code className={styles.referenceCode}>{reference}</code>,
        )}
      </p>
      <p>{t(locale, "confirmation_close")}</p>
      <ClearDrafts slug={props.slug} />
      <FocusTitle />
      {form.settings.allowAnotherResponse ? (
        <RestartForm slug={props.slug} className={styles.secondary}>
          {t(locale, "fill_another")}
        </RestartForm>
      ) : null}
    </>,
  );
}

/**
 * Every public screen that is not a missing form, from the view the page asked for.
 * See specs/ui-ux/renderer.md, "Screens".
 */
export function RendererScreen(props: {
  view: Shown;
  slug: string;
  contact: string;
  registry: FieldTypeRegistry;
  formAction: PageFormAction;
  refusedFiles: readonly RefusedFileMessage[];
}): ReactElement {
  const { view, slug, contact } = props;
  switch (view.screen) {
    case "page":
      return (
        <FormPage
          view={view}
          slug={slug}
          contact={contact}
          registry={props.registry}
          formAction={props.formAction}
          refusedFiles={props.refusedFiles}
        />
      );
    case "confirmation":
      return <Confirmation view={view} slug={slug} contact={contact} />;
    case "closed":
      return <Message form={view.form} contact={contact} title="closed_title" body="closed_body" />;
    case "not_open": {
      const { opensAt } = view;
      const zone = view.form.settings.timezone;
      return (
        <Message
          form={view.form}
          contact={contact}
          title="not_open_title"
          body="not_open_body"
          vars={(locale) => ({ date: formatInstant(opensAt, locale, zone) })}
        />
      );
    }
    case "expired":
      return (
        <Message
          form={view.form}
          contact={contact}
          title="expired_title"
          body="expired_body"
          action={{ slug, label: "start_again" }}
        >
          <ClearDrafts slug={slug} />
        </Message>
      );
  }
}

/** No form at this link: no retention to state, so no privacy footer. */
export function NotFoundScreen(): ReactElement {
  return (
    <PublicShell locale="es">
      <h1 className={styles.title}>
        <Both k="not_found_title" locale="es" languages="bilingual" />
      </h1>
      <p>
        <Both k="not_found_body" locale="es" languages="bilingual" />
      </p>
    </PublicShell>
  );
}

/**
 * The 500 page: nothing is known about the form, so both languages and no footer. With the
 * form's `slug` it also drops that form's posted marker, so Try again after a failed scripted
 * post restores the page's edits. See specs/ui-ux/renderer.md, "Navigation and state".
 */
export function ErrorScreen(props: { tryAgainHref: string; slug?: string }): ReactElement {
  return (
    <PublicShell locale="es">
      <h1 id="page-title" tabIndex={-1} className={styles.title}>
        <Both k="error_title" locale="es" languages="bilingual" />
      </h1>
      <p>
        <Both k="error_body" locale="es" languages="bilingual" />
      </p>
      <p>
        <a href={props.tryAgainHref} className={styles.primaryLink}>
          <Both k="try_again" locale="es" languages="bilingual" />
        </a>
      </p>
      {props.slug === undefined ? null : <ClearPostedMarker slug={props.slug} />}
      <FocusTitle />
    </PublicShell>
  );
}
