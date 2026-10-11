import { pageSession } from "@/app/admin/_lib/page";
import { listForms } from "@/modules/definitions/application";
import { createFormError, NewFormDialog } from "@/modules/definitions/presentation/NewFormDialog";
import { Bilingual } from "@/shared/presentation/Bilingual";
import { Breadcrumbs } from "@/shared/presentation/Breadcrumbs";
import { pageMetadata } from "@/shared/presentation/metadata";

/**
 * Blocks on the session and the database, as the gated layout does: without it,
 * dev's instant-navigation check reports the uncached reads. Build passes either way.
 */
export const instant = false;

export const metadata = pageMetadata("new.title");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The New form dialog as its own page, so it works without JavaScript; the
 * active forms are the ones offered for duplication. See specs/ui-ux/builder.md,
 * "New form".
 */
export default async function NewFormPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, container, actor } = await pageSession("/admin/forms/new");
  const { error } = await searchParams;
  const { rows } = await listForms(container.definitions, actor, { tab: "active" });
  const failed = createFormError(error);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: <Bilingual k="nav.forms" />, href: "/admin/forms" },
          { label: <Bilingual k="new.title" /> },
        ]}
      />
      <NewFormDialog
        csrfToken={session.csrfToken}
        sources={rows.map((row) => ({ id: row.id, title: row.title, slug: row.slug }))}
        {...(failed === undefined ? {} : { error: failed })}
      />
    </>
  );
}
