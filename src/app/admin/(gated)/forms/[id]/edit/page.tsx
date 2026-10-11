import { notFound } from "next/navigation";
import { pageSession } from "@/app/admin/_lib/page";
import { openForm } from "@/modules/definitions/application";
import { BuilderPlaceholder } from "@/modules/definitions/presentation/BuilderPlaceholder";
import { formHref } from "@/modules/definitions/presentation/view-models";
import { pageMetadata } from "@/shared/presentation/metadata";

/**
 * Blocks on the session and the database, as the gated layout does: without it,
 * dev's instant-navigation check reports the uncached reads. Build passes either way.
 */
export const instant = false;

export const metadata = pageMetadata("form.edit");

/**
 * Edit in builder, until the builder exists. See specs/ui-ux/manager.md,
 * "Form overview", and specs/ui-ux/builder.md.
 */
export default async function BuilderPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const { container, actor } = await pageSession(formHref(id, "edit"));
  const overview = await openForm(container.definitions, actor, id);
  if (overview === null) notFound();
  const { form } = overview;
  return <BuilderPlaceholder formId={form.id} title={form.title} slug={form.slug} />;
}
