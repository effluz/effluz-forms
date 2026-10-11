import { pageSession } from "@/app/admin/_lib/page";
import { listForms } from "@/modules/definitions/application";
import { createFormError, NewFormDialog } from "@/modules/definitions/presentation/NewFormDialog";
import { carriedValues } from "@/modules/definitions/presentation/new-form-values";
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
 * The New form dialog as its own page, so it works without JavaScript. Active and
 * closed forms are offered for duplication; archived ones are not. After a refusal
 * the query carries the code and the values typed. See specs/ui-ux/builder.md,
 * "New form".
 */
export default async function NewFormPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, container, actor } = await pageSession("/admin/forms/new");
  const params = await searchParams;
  const [active, closed] = await Promise.all([
    listForms(container.definitions, actor, { tab: "active" }),
    listForms(container.definitions, actor, { tab: "closed" }),
  ]);
  const failed = createFormError(params.error);
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
        sources={[...active.rows, ...closed.rows].map((row) => ({
          id: row.id,
          title: row.title,
          slug: row.slug,
        }))}
        values={carriedValues(params)}
        {...(failed === undefined ? {} : { error: failed })}
      />
    </>
  );
}
