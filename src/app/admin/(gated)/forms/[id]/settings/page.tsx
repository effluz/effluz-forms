import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { pageSession } from "@/app/admin/_lib/page";
import { openForm } from "@/modules/definitions/application";
import { FormTitle } from "@/modules/definitions/presentation/FormTitle";
import {
  decodeSettingsState,
  SETTINGS_STATE_COOKIE,
  TIMEZONES,
} from "@/modules/definitions/presentation/settings-form";
import { SettingsForm } from "@/modules/definitions/presentation/SettingsForm";
import { formHref } from "@/modules/definitions/presentation/view-models";
import { Bilingual } from "@/shared/presentation/Bilingual";
import { Breadcrumbs } from "@/shared/presentation/Breadcrumbs";
import { pageMetadata } from "@/shared/presentation/metadata";
import { styles } from "@/shared/presentation/styles";
import { saveSettings } from "./actions";

/** Blocks on the session and the database; see src/app/admin/(gated)/forms/new/page.tsx. */
export const instant = false;

export const metadata = pageMetadata("form.tab_settings");

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

/**
 * A form's Settings tab. After a save, `saved` shows the success banner and
 * `refused` the state the action left for that save: the values as submitted
 * and why they were not saved. See specs/ui-ux/manager.md, "Settings tab".
 */
export default async function SettingsPage(props: { params: Params; searchParams: SearchParams }) {
  const { id } = await props.params;
  const { session, container, actor } = await pageSession(formHref(id, "settings"));
  const overview = await openForm(container.definitions, actor, id);
  if (!overview) notFound();
  const query = await props.searchParams;
  const jar = await cookies();
  const state = decodeSettingsState(jar.get(SETTINGS_STATE_COOKIE)?.value, one(query.refused));

  const tab = (
    <SettingsForm
      form={overview.form}
      csrfToken={session.csrfToken}
      hasSubmissions={overview.summary.total > 0}
      timezones={TIMEZONES}
      action={saveSettings.bind(null, id)}
      saved={state === null && one(query.saved) !== undefined}
      {...state}
    />
  );

  // Interim header until the form overview wraps its tabs.
  return (
    <>
      <Breadcrumbs
        items={[
          { label: <Bilingual k="nav.forms" />, href: "/admin/forms" },
          {
            label: <FormTitle title={overview.form.title} slug={overview.form.slug} />,
            href: formHref(id),
          },
          { label: <Bilingual k="form.tab_settings" /> },
        ]}
      />
      <h1 className={styles.pageTitle}>
        <FormTitle title={overview.form.title} slug={overview.form.slug} />
      </h1>
      {tab}
    </>
  );
}
