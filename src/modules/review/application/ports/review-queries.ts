import type { Locale } from "@/shared/domain/localized-text";
import type { IsoDate } from "../../domain/days";
import type { PlanFilter } from "../../domain/list-query";
import type { StoryChecks } from "../../domain/readiness";
import type { ReviewStatus } from "../../domain/status";

/** The list's filters, resolved by the application (ADR 0028, `review-submissions.md`). */
export interface ListFilter {
  formId: string;
  status: ReviewStatus | null;
  /** The application passes null on forms without the post plan. */
  plan: PlanFilter | null;
  /** Received on or after, America/Panama days. */
  from: IsoDate | null;
  /** Received on or before, America/Panama days. */
  to: IsoDate | null;
  versionId: string | null;
  /** Only stories with at least one of the sender's files. */
  media: boolean;
  /** Matched case-insensitively as a substring of these answer keys and of the reference. */
  search: { text: string; keys: readonly string[] } | null;
}

export interface ListRow {
  submissionId: string;
  reference: string;
  receivedAt: Date;
  versionId: string;
  locale: Locale;
  status: ReviewStatus;
  answers: Record<string, unknown>;
  /** The sender's files only. */
  mediaCount: number;
  plannedOn: IsoDate | null;
  publishedOn: IsoDate | null;
  checks: StoryChecks;
  hasDeadJobs: boolean;
}

export interface PlanEntry {
  submissionId: string;
  formId: string;
  reference: string;
  versionId: string;
  receivedAt: Date;
  answers: Record<string, unknown>;
  status: ReviewStatus;
  postUrl: string | null;
  plannedOn: IsoDate | null;
  publishedOn: IsoDate | null;
  checks: StoryChecks;
}

export interface ExportSource {
  submissionId: string;
  reference: string;
  receivedAt: Date;
  versionId: string;
  locale: Locale;
  status: ReviewStatus;
  answers: Record<string, unknown>;
  curatedAnswers: Record<string, string>;
  postUrl: string | null;
  plannedOn: IsoDate | null;
  /** Durable keys of the sender's files, in field and position order. */
  senderKeys: string[];
  /** Durable keys of the staff photos, by creation. */
  staffKeys: string[];
}

/** A position in list order: newest first by (received_at, id). */
export interface ListCursor {
  receivedAt: Date;
  submissionId: string;
}

/** The review read model (ADR 0028): reads, never writes, other owners' tables. */
export interface ReviewQueries {
  /** Newest first by (received_at, id), `LIST_PAGE_SIZE` per page. */
  list(filter: ListFilter, page: number): Promise<{ rows: ListRow[]; total: number }>;
  statusCounts(formId: string): Promise<Record<ReviewStatus, number>>;
  /** References of the nearest newer and older rows under the filter, relative to `at`, whether or not `at` matches. */
  neighbours(
    filter: ListFilter,
    at: ListCursor,
  ): Promise<{ newer: string | null; older: string | null }>;
  /** Unpublished stories planned in [from, to] and stories published in [from, to], of these forms. */
  week(formIds: readonly string[], from: IsoDate, to: IsoDate): Promise<PlanEntry[]>;
  /** Unpublished, unplanned stories of these forms, newest first. */
  waiting(formIds: readonly string[], limit: number): Promise<{ rows: PlanEntry[]; total: number }>;
  count(filter: ListFilter): Promise<number>;
  /** Keyset batches in list order; `after` is the last row of the previous batch. */
  exportBatch(filter: ListFilter, after: ListCursor | null, size: number): Promise<ExportSource[]>;
}
