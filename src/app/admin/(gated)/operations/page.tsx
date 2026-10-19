import { pageSession } from "@/app/admin/_lib/page";
import { operationsView } from "@/modules/review/application";
import { OperationsPage } from "@/modules/review/presentation/OperationsPage";
import { pageMetadata } from "@/shared/presentation/metadata";

/**
 * Blocks on the session and the database, as the gated layout does: without it,
 * dev's instant-navigation check reports the uncached reads. Build passes either way.
 */
export const instant = false;

export const metadata = pageMetadata("nav.operations");

const DONE = ["retried", "retried_all", "discarded"] as const;
/** The longest job id the page takes from its query. */
const JOB_MAX = 200;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function count(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/**
 * Operations: the worker's heartbeat and the dead jobs, with the flash (`?done=`, `?n=`) or the
 * refused discard (`?error=reason_invalid&job=<id>`) sent back by its routes. See
 * specs/ui-ux/manager.md, "Operations page".
 */
export default async function OperationsRoute(props: { searchParams: SearchParams }) {
  const { session, container } = await pageSession("/admin/operations");
  const query = await props.searchParams;
  const job = first(query.job);
  const view = await operationsView(container.review);
  return (
    <OperationsPage
      view={view}
      csrfToken={session.csrfToken}
      done={DONE.find((known) => known === first(query.done)) ?? null}
      n={count(first(query.n))}
      error={first(query.error) === "reason_invalid" ? "reason_invalid" : null}
      errorJob={job === undefined || job === "" || job.length > JOB_MAX ? null : job}
    />
  );
}
