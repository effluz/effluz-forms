import type { Actor } from "@/modules/definitions/application";
import type { Locale } from "@/shared/domain/localized-text";
import type { IsoDate } from "../domain/days";
import { LIST_PAGE_SIZE, type ListQuery } from "../domain/list-query";
import { readiness, type Readiness } from "../domain/readiness";
import type { ReviewStatus } from "../domain/status";
import { listFilterFor, loadFormContext, storyLabel, type FormContext } from "./context";
import type { ReviewDeps } from "./deps";
import type { ListRow } from "./ports/review-queries";

export interface StoryListRow {
  reference: string;
  receivedAt: Date;
  status: ReviewStatus;
  plannedOn: IsoDate | null;
  published: boolean;
  label: string | null;
  /** The sender's files only. */
  mediaCount: number;
  versionNumber: number;
  locale: Locale;
  deadJobs: boolean;
  /** Null when the form is not in the post plan. */
  readiness: Readiness | null;
}

export interface StoryList {
  ctx: FormContext;
  query: ListQuery;
  rows: StoryListRow[];
  total: number;
  pageCount: number;
  counts: Record<ReviewStatus, number>;
}

function toListRow(deps: ReviewDeps, ctx: FormContext, row: ListRow): StoryListRow {
  const version = ctx.versions.find((v) => v.id === row.versionId);
  return {
    reference: row.reference,
    receivedAt: row.receivedAt,
    status: row.status,
    plannedOn: row.plannedOn,
    published: row.status === "published",
    label: version ? storyLabel(version.document, deps.registry, row.answers) : null,
    mediaCount: row.mediaCount,
    versionNumber: version?.number ?? 0,
    locale: row.locale,
    deadJobs: row.hasDeadJobs,
    readiness: ctx.postPlan ? readiness(row.checks) : null,
  };
}

/**
 * One page of the Submissions list. A page load is one `submissions_listed`
 * entry, never one per row (specs/use-cases/review-submissions.md, "Rules").
 */
export async function listStories(
  deps: ReviewDeps,
  actor: Actor,
  input: { formId: string; query: ListQuery },
): Promise<StoryList | null> {
  const ctx = await loadFormContext(deps, input.formId);
  if (!ctx) return null;
  const filter = listFilterFor(ctx, input.query, deps.registry);
  const [{ rows, total }, counts] = await Promise.all([
    deps.queries.list(filter, input.query.page),
    deps.queries.statusCounts(ctx.form.id),
  ]);
  await deps.uow.run((uow) =>
    deps.audit.record(
      uow,
      {
        action: "submissions_listed",
        actorEmail: actor.email,
        targetId: ctx.form.id,
        ip: actor.ip,
        details: { page: input.query.page, count: rows.length },
      },
      deps.clock.now(),
    ),
  );
  return {
    ctx,
    query: input.query,
    rows: rows.map((row) => toListRow(deps, ctx, row)),
    total,
    pageCount: Math.max(1, Math.ceil(total / LIST_PAGE_SIZE)),
    counts,
  };
}
