import { notFound } from "next/navigation";
import { pageSession } from "@/app/admin/_lib/page";
import { openForm, shareInfo } from "@/modules/definitions/application";
import { FormOverview } from "@/modules/definitions/presentation/FormOverview";
import { SharePanel } from "@/modules/definitions/presentation/SharePanel";
import { formHref } from "@/modules/definitions/presentation/view-models";
import { pageMetadata } from "@/shared/presentation/metadata";

/**
 * Blocks on the session and the database, as the gated layout does: without it,
 * dev's instant-navigation check reports the uncached reads. Build passes either way.
 */
export const instant = false;

export const metadata = pageMetadata("form.tab_share");

/** The Share tab of a form. See specs/ui-ux/manager.md, "Share tab". */
export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, container, actor } = await pageSession(formHref(id, "share"));
  const overview = await openForm(container.definitions, actor, id);
  if (overview === null) notFound();
  const info = await shareInfo(container.definitions, id);
  if (info === null) notFound();
  return (
    <FormOverview overview={overview} csrfToken={session.csrfToken} tab="share">
      <SharePanel info={info} formId={id} />
    </FormOverview>
  );
}
