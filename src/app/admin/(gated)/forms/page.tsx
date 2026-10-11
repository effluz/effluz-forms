import { pageSession } from "@/app/admin/_lib/page";
import { listForms, type FormTab } from "@/modules/definitions/application";
import { FormsList } from "@/modules/definitions/presentation/FormsList";
import { Bilingual } from "@/shared/presentation/Bilingual";
import { Breadcrumbs } from "@/shared/presentation/Breadcrumbs";
import { pageMetadata } from "@/shared/presentation/metadata";

/**
 * Blocks on the session and the database, as the gated layout does: without it,
 * dev's instant-navigation check reports the uncached reads. Build passes either way.
 */
export const instant = false;

export const metadata = pageMetadata("nav.forms");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function tabOf(value: string): FormTab {
  return value === "closed" || value === "archived" ? value : "active";
}

/** The manager's home. See specs/ui-ux/manager.md, "Forms list (home)". */
export default async function FormsPage({ searchParams }: { searchParams: SearchParams }) {
  const { container, actor } = await pageSession("/admin/forms");
  const params = await searchParams;
  const tab = tabOf(first(params.tab));
  const search = first(params.q).trim();
  const { rows, counts } = await listForms(container.definitions, actor, {
    tab,
    ...(search === "" ? {} : { search }),
  });
  return (
    <>
      <Breadcrumbs items={[{ label: <Bilingual k="nav.forms" /> }]} />
      <FormsList tab={tab} counts={counts} rows={rows} search={search} />
    </>
  );
}
