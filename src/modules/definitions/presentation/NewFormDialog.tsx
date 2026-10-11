import type { ReactNode } from "react";
import type { LocalizedText } from "@/shared/domain/localized-text";
import { Bilingual } from "@/shared/presentation/Bilingual";
import type { CopyKey } from "@/shared/presentation/copy";
import { cx, styles } from "@/shared/presentation/styles";
import type { CreateFormResult } from "../application";
import local from "./forms.module.css";
import { titleText } from "./view-models";

/** Where the dialog posts; see src/app/admin/forms/create/route.ts. */
export const CREATE_FORM_PATH = "/admin/forms/create";

export type CreateFormError = Extract<CreateFormResult, { ok: false }>["code"];
type ErrorField = "title" | "slug" | "source";

/** Which field each refusal belongs to, and the copy that explains it. */
const ERRORS: Record<CreateFormError, { field: ErrorField; message: CopyKey }> = {
  title_missing: { field: "title", message: "new.title_missing" },
  slug_format: { field: "slug", message: "new.slug_hint" },
  slug_reserved: { field: "slug", message: "new.slug_reserved" },
  slug_taken: { field: "slug", message: "new.slug_taken" },
  source_not_found: { field: "source", message: "new.source_missing" },
};

/** The refusal code from the page's `error` parameter, or undefined for anything else. */
export function createFormError(value: unknown): CreateFormError | undefined {
  return typeof value === "string" && Object.hasOwn(ERRORS, value)
    ? (value as CreateFormError)
    : undefined;
}

export interface DuplicateSource {
  id: string;
  title: LocalizedText;
  slug: string;
}

const ID = {
  title: "new-form-title",
  error: "new-form-error",
  source: "new-form-source",
  titleEn: "new-form-title-en",
  titleEs: "new-form-title-es",
  slug: "new-form-slug",
  slugHint: "new-form-slug-hint",
  slugAuto: "new-form-slug-auto",
};

/**
 * The New form dialog as a page section: one plain POST form, so it works
 * without JavaScript. A refusal comes back as `error` and is shown on its field.
 * See specs/ui-ux/builder.md, "New form", and design-system/components.md, "Dialog".
 */
export function NewFormDialog(props: {
  csrfToken: string;
  sources: DuplicateSource[];
  error?: CreateFormError;
}) {
  const failed = props.error === undefined ? undefined : ERRORS[props.error];
  const errorOn = (field: ErrorField) => failed?.field === field;
  const errorRow = (field: ErrorField) =>
    failed !== undefined && failed.field === field ? (
      <p id={ID.error} role="alert" className={local.error}>
        <Bilingual k={failed.message} />
      </p>
    ) : null;
  const invalid = (field: ErrorField, describedBy: string[] = []) => {
    const ids = errorOn(field) ? [ID.error, ...describedBy] : describedBy;
    return {
      ...(errorOn(field) ? { "aria-invalid": true as const } : {}),
      ...(ids.length > 0 ? { "aria-describedby": ids.join(" ") } : {}),
      className: cx(styles.input, errorOn(field) && local.invalid),
    };
  };

  return (
    <section role="dialog" aria-labelledby={ID.title} className={cx(styles.dialog, local.newForm)}>
      <h1 id={ID.title} className={styles.dialogTitle}>
        <Bilingual k="new.title" />
      </h1>
      <form className={styles.dialogForm} method="post" action={CREATE_FORM_PATH}>
        <input type="hidden" name="csrf" value={props.csrfToken} />

        <fieldset className={local.fieldset}>
          <legend className={local.legend}>
            <Bilingual k="new.start" />
          </legend>
          <Choice name="start" value="blank" checked>
            <Bilingual k="new.blank" />
          </Choice>
          {props.sources.length > 0 ? (
            <>
              <Choice name="start" value="duplicate">
                <Bilingual k="new.duplicate" />
              </Choice>
              <div className={cx(styles.field, local.nested)}>
                <label htmlFor={ID.source} className={styles.label}>
                  <Bilingual k="new.source" />
                </label>
                <select id={ID.source} name="source" {...invalid("source")}>
                  {props.sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {titleText(source.title, source.slug)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : null}
          {errorRow("source")}
        </fieldset>

        <div className={styles.field}>
          <label htmlFor={ID.titleEn} className={styles.label}>
            <Bilingual k="new.title_en" />
          </label>
          <input
            id={ID.titleEn}
            type="text"
            name="title_en"
            lang="en"
            autoComplete="off"
            {...invalid("title")}
          />
          {errorRow("title")}
        </div>
        <div className={styles.field}>
          <label htmlFor={ID.titleEs} className={styles.label}>
            <Bilingual k="new.title_es" />
          </label>
          <input
            id={ID.titleEs}
            type="text"
            name="title_es"
            lang="es"
            autoComplete="off"
            {...invalid("title")}
          />
        </div>

        <fieldset className={local.fieldset}>
          <legend className={local.legend}>
            <Bilingual k="new.languages" />
          </legend>
          <Choice name="languages" value="bilingual" checked>
            <Bilingual k="new.bilingual" />
          </Choice>
          <Choice name="languages" value="en">
            <Bilingual k="new.only_en" />
          </Choice>
          <Choice name="languages" value="es">
            <Bilingual k="new.only_es" />
          </Choice>
        </fieldset>

        <div className={styles.field}>
          <label htmlFor={ID.slug} className={styles.label}>
            <Bilingual k="new.slug" />
          </label>
          <input
            id={ID.slug}
            type="text"
            name="slug"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            {...invalid("slug", [ID.slugHint, ID.slugAuto])}
          />
          {errorRow("slug")}
          <p id={ID.slugHint} className={local.hint}>
            <Bilingual k="new.slug_hint" />
          </p>
          <p id={ID.slugAuto} className={local.hint}>
            <Bilingual k="new.slug_auto" />
          </p>
        </div>

        <div className={styles.actions}>
          <a className={styles.button} href="/admin/forms">
            <Bilingual k="shell.cancel" />
          </a>
          <button className={styles.primary} type="submit">
            <Bilingual k="new.create" />
          </button>
        </div>
      </form>
    </section>
  );
}

function Choice(props: { name: string; value: string; checked?: boolean; children: ReactNode }) {
  return (
    <label className={local.choice}>
      <input
        type="radio"
        name={props.name}
        value={props.value}
        {...(props.checked ? { defaultChecked: true } : {})}
      />
      <span>{props.children}</span>
    </label>
  );
}
