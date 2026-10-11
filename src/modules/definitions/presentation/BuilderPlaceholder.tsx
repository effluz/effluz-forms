import type { LocalizedText } from "@/shared/domain/localized-text";
import { Bilingual } from "@/shared/presentation/Bilingual";
import { Breadcrumbs } from "@/shared/presentation/Breadcrumbs";
import { styles } from "@/shared/presentation/styles";
import { FORMS_PATH } from "./FormsList";
import menu from "./forms.module.css";
import { FormTitle } from "./FormTitle";
import local from "./overview.module.css";
import { formHref } from "./view-models";

/**
 * Where Edit in builder leads until the builder exists: the form's title, a
 * sentence saying so, and the sections that already work. See
 * specs/ui-ux/manager.md, "Form overview".
 */
export function BuilderPlaceholder(props: { formId: string; title: LocalizedText; slug: string }) {
  const title = <FormTitle title={props.title} slug={props.slug} />;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: <Bilingual k="nav.forms" />, href: FORMS_PATH },
          { label: title, href: formHref(props.formId) },
          { label: <Bilingual k="form.edit" /> },
        ]}
      />
      <h1 className={styles.pageTitle}>{title}</h1>
      <div className={menu.empty}>
        <p>
          <Bilingual k="builder.placeholder" />
        </p>
        <p className={local.headerActions}>
          <a className={styles.button} href={formHref(props.formId, "settings")}>
            <Bilingual k="form.tab_settings" />
          </a>
          <a className={styles.button} href={formHref(props.formId, "share")}>
            <Bilingual k="form.tab_share" />
          </a>
        </p>
      </div>
    </>
  );
}
