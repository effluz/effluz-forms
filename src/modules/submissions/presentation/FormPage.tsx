import type { ReactElement } from "react";
import type { FieldTypeRegistry } from "@/shared/domain/form-model";
import { resolveText } from "@/shared/domain/localized-text";
import { RichText } from "@/shared/presentation/RichText";
import { HONEYPOT_FIELD, type ViewResult } from "../application";
import { ErrorSummary } from "./client/ErrorSummary";
import { NavButtons } from "./client/NavButtons";
import { PageEnhancer } from "./client/PageEnhancer";
import { t } from "./copy";
import { pageFieldViews, pageTitle, summaryItems } from "./field-views";
import { fieldRenderers } from "./fields";
import type { PageFormAction, RefusedFileMessage } from "./page-form-state";
import { Progress } from "./Progress";
import { PrivacyFooter, PublicShell } from "./PublicShell";
import { styles } from "./styles";

export interface FormPageProps {
  view: Extract<ViewResult, { screen: "page" }>;
  slug: string;
  contact: string;
  registry: FieldTypeRegistry;
  formAction: PageFormAction;
  refusedFiles: readonly RefusedFileMessage[];
}

/**
 * One page of a form: the heading, the error summary, the legend, the fields, the honeypot and
 * the navigation row inside the page form, framed by the shell. See specs/ui-ux/renderer.md,
 * "Screens" and "Form page".
 */
export function FormPage(props: FormPageProps): ReactElement {
  const { view, slug, registry } = props;
  const { form, version, page } = view;
  const { locale } = page;
  const { languages } = version.document;
  const fields = pageFieldViews({ version, page, slug }, registry);
  const title = pageTitle(view);
  const pageDefinition = version.document.pages.find((p) => p.key === page.pageKey);
  const description = pageDefinition?.description
    ? resolveText(pageDefinition.description, locale, languages)
    : "";
  const primary = page.isLast ? "submit" : "next";
  const switchTo = languages === "bilingual" ? (locale === "en" ? "es" : "en") : null;

  return (
    <PublicShell
      locale={locale}
      form={{ defaultAction: primary, switchTo }}
      progress={<Progress locale={locale} position={page.position} />}
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
      <h1 id="page-title" tabIndex={-1} data-page-heading="" className={styles.title}>
        {title.h1}
      </h1>
      {title.subtitle ? <h2 className={styles.subtitle}>{title.subtitle}</h2> : null}
      {description !== "" ? <RichText source={description} className={styles.description} /> : null}
      <PageEnhancer
        action={props.formAction}
        slug={slug}
        pageKey={page.pageKey}
        locale={locale}
        renderId={page.renderedAt.toISOString()}
        navigated={page.hasRecord && page.pending === null}
        refusedFiles={props.refusedFiles}
        text={{
          submitting: t(locale, "submitting"),
          uploadsPending: t(locale, "uploads_pending"),
          offline: t(locale, "offline"),
          submitFailed: t(locale, "submit_failed"),
        }}
      >
        <ErrorSummary
          items={summaryItems({ version, page }, registry)}
          locale={locale}
          headings={{
            one: t(locale, "error_summary_heading_one"),
            other: t(locale, "error_summary_heading"),
          }}
        />
        {fields.some(({ props: field }) => field.required) ? (
          <p className={styles.legend}>{t(locale, "required_legend")}</p>
        ) : null}
        {fields.map(({ field, props: fieldProps }) => {
          const Field = fieldRenderers[field.type].Component;
          return <Field key={field.key} {...fieldProps} />;
        })}
        <input type="hidden" name="_page" value={page.pageKey} />
        {page.hasRecord ? null : (
          <input type="hidden" name="_rendered" value={page.renderedAt.toISOString()} />
        )}
        {page.isLast && page.submitToken !== null ? (
          <input type="hidden" name="_token" value={page.submitToken} />
        ) : null}
        <div className={styles.honeypot} aria-hidden="true">
          <label htmlFor={HONEYPOT_FIELD}>{t(locale, "honeypot_label")}</label>
          <input
            id={HONEYPOT_FIELD}
            name={HONEYPOT_FIELD}
            type="text"
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </div>
        <NavButtons
          back={page.isFirst ? null : t(locale, "back")}
          primary={{ value: primary, label: t(locale, primary) }}
          submitting={t(locale, "submitting")}
          uploadsPending={t(locale, "uploads_pending")}
        />
      </PageEnhancer>
    </PublicShell>
  );
}
