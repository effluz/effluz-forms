/**
 * In-memory fakes for review use-case tests.
 *
 * - `InMemoryStoryRepository`: `rows` by submission id, copies in and out;
 *   `lockOrCreate` inserts the empty row when missing; `lockDay` answers the
 *   unpublished story planned on the day; `save` rejects a second unpublished
 *   story on one day as the unique index `story_plan_slot_key` does (code
 *   23505, that constraint), and keeps `updatedAt` by submission id.
 * - `InMemoryStaffPhotoRepository`: `rows` by media id, oldest first per story.
 * - `InMemoryEditRepository`: `rows` in append order; the newest per field wins.
 * - `FakeReviewQueries`: canned answers in `listResult`, `countsResult`,
 *   `neighboursResult`, `weekResult`, `waitingResult`, `countResult` and
 *   `exportBatches` (one batch per call, then empty); every call is recorded
 *   in `calls` with its arguments.
 * - `ListingZipWriter`: streams the names of the entries it opened, one per
 *   line, skipping entries whose `open` answers null.
 * - `makeReviewDeps()`: the submissions fakes (with their definitions and
 *   media fakes), the fakes above, a job admin and the definitions audit log
 *   and reader, one clock at `2026-10-18T15:00:00Z` shared by all. Deleting a
 *   submission through it drops that submission's story, staff photo and edit
 *   rows (`dropSubmission`), as the database cascade does; the media rows stay
 *   for their `media.delete` jobs.
 *
 * The shared unit of work does not roll back: a write made before a failure
 * stays. Prove "fails and nothing changes" against Postgres instead.
 *
 * Locks are no-ops: one process needs none. Synthetic data only. Not for production code.
 */
import {
  makeSubmissionsDeps,
  type FakeSubmissionsDeps,
} from "@/modules/submissions/application/testing/fakes";
import type { FakeDefinitionsDeps } from "@/modules/definitions/application/testing/fakes";
import type { FakeMediaDeps } from "@/modules/media/application/testing/fakes";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import {
  FakeUnitOfWorkFactory,
  FixedClock,
  InMemoryAuditLog,
  InMemoryAuditLogReader,
  InMemoryJobAdmin,
  SequentialIdGenerator,
} from "@/shared/application/testing/fakes";
import type { IsoDate } from "../../domain/days";
import { PLAN_TIME_ZONE } from "../../domain/days";
import type { ReviewStatus } from "../../domain/status";
import type { ReviewDeps } from "../deps";
import type { EditRepository, EditRow } from "../ports/edit-repository";
import type {
  ExportSource,
  ListCursor,
  ListFilter,
  ListRow,
  PlanEntry,
  ReviewQueries,
} from "../ports/review-queries";
import type { StaffPhotoRepository, StaffPhotoRow } from "../ports/staff-photo-repository";
import { emptyStory, type StoryRepository, type StoryRow } from "../ports/story-repository";
import type { ZipEntry, ZipWriter } from "../ports/zip-writer";

export { InMemoryJobAdmin };

/** The fixed "now" of review tests: a Sunday afternoon in Panama. */
export const REVIEW_NOW = new Date("2026-10-18T15:00:00Z");

/** The refusal Postgres gives for a second unpublished story on one day. */
function slotTaken(): Error {
  return Object.assign(
    new Error('duplicate key value violates unique constraint "story_plan_slot_key"'),
    { code: "23505", constraint: "story_plan_slot_key" },
  );
}

export class InMemoryStoryRepository implements StoryRepository {
  readonly rows = new Map<string, StoryRow>();
  readonly updatedAt = new Map<string, Date>();

  /** The `on delete cascade` from `submission`. */
  dropSubmission(submissionId: string): void {
    this.rows.delete(submissionId);
    this.updatedAt.delete(submissionId);
  }

  find(submissionId: string): Promise<StoryRow | null> {
    const row = this.rows.get(submissionId);
    return Promise.resolve(row ? structuredClone(row) : null);
  }

  lockOrCreate(_uow: UnitOfWork, submissionId: string, formId: string): Promise<StoryRow> {
    if (!this.rows.has(submissionId)) this.rows.set(submissionId, emptyStory(submissionId, formId));
    return Promise.resolve(
      structuredClone(this.rows.get(submissionId) ?? emptyStory(submissionId, formId)),
    );
  }

  lockDay(_uow: UnitOfWork, date: IsoDate): Promise<StoryRow | null> {
    for (const row of this.rows.values())
      if (row.plannedOn === date && row.publishedOn === null)
        return Promise.resolve(structuredClone(row));
    return Promise.resolve(null);
  }

  save(_uow: UnitOfWork, row: StoryRow, at: Date): Promise<void> {
    if (row.plannedOn !== null && row.publishedOn === null) {
      for (const other of this.rows.values())
        if (
          other.submissionId !== row.submissionId &&
          other.plannedOn === row.plannedOn &&
          other.publishedOn === null
        )
          return Promise.reject(slotTaken());
    }
    this.rows.set(row.submissionId, structuredClone(row));
    this.updatedAt.set(row.submissionId, new Date(at.getTime()));
    return Promise.resolve();
  }
}

export class InMemoryStaffPhotoRepository implements StaffPhotoRepository {
  readonly rows = new Map<string, StaffPhotoRow>();

  /** The `on delete cascade` from `submission`. */
  dropSubmission(submissionId: string): void {
    for (const [id, row] of this.rows) if (row.submissionId === submissionId) this.rows.delete(id);
  }

  insert(_uow: UnitOfWork, row: StaffPhotoRow): Promise<void> {
    if (this.rows.has(row.id)) return Promise.reject(new Error(`staff photo ${row.id} exists`));
    this.rows.set(row.id, structuredClone(row));
    return Promise.resolve();
  }

  // One view of the rows: a unit of work changes nothing.
  listBySubmission(submissionId: string): Promise<StaffPhotoRow[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.submissionId === submissionId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
        .map((row) => structuredClone(row)),
    );
  }

  delete(_uow: UnitOfWork, id: string): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }
}

export class InMemoryEditRepository implements EditRepository {
  readonly rows: EditRow[] = [];

  /** The `on delete cascade` from `submission`. */
  dropSubmission(submissionId: string): void {
    const kept = this.rows.filter((row) => row.submissionId !== submissionId);
    this.rows.splice(0, this.rows.length, ...kept);
  }

  append(_uow: UnitOfWork, row: EditRow): Promise<void> {
    this.rows.push(structuredClone(row));
    return Promise.resolve();
  }

  latestByField(submissionId: string): Promise<Map<string, EditRow>> {
    const latest = new Map<string, EditRow>();
    for (const row of this.rows) {
      if (row.submissionId !== submissionId) continue;
      const seen = latest.get(row.fieldKey);
      if (!seen || row.createdAt.getTime() >= seen.createdAt.getTime())
        latest.set(row.fieldKey, structuredClone(row));
    }
    return Promise.resolve(latest);
  }
}

export type ReviewQueryCall = { method: keyof ReviewQueries; args: unknown[] };

const NO_COUNTS: Record<ReviewStatus, number> = { new: 0, viewed: 0, edited: 0, published: 0 };

export class FakeReviewQueries implements ReviewQueries {
  listResult: { rows: ListRow[]; total: number } = { rows: [], total: 0 };
  countsResult: Record<ReviewStatus, number> = { ...NO_COUNTS };
  neighboursResult: { newer: string | null; older: string | null } = { newer: null, older: null };
  weekResult: PlanEntry[] = [];
  waitingResult: { rows: PlanEntry[]; total: number } = { rows: [], total: 0 };
  countResult = 0;
  /** One batch per `exportBatch` call, in order; then empty batches. */
  exportBatches: ExportSource[][] = [];
  readonly calls: ReviewQueryCall[] = [];

  private record(method: keyof ReviewQueries, ...args: unknown[]): void {
    this.calls.push({ method, args: structuredClone(args) });
  }

  list(filter: ListFilter, page: number): Promise<{ rows: ListRow[]; total: number }> {
    this.record("list", filter, page);
    return Promise.resolve(structuredClone(this.listResult));
  }

  statusCounts(formId: string): Promise<Record<ReviewStatus, number>> {
    this.record("statusCounts", formId);
    return Promise.resolve({ ...this.countsResult });
  }

  neighbours(
    filter: ListFilter,
    at: ListCursor,
  ): Promise<{ newer: string | null; older: string | null }> {
    this.record("neighbours", filter, at);
    return Promise.resolve({ ...this.neighboursResult });
  }

  week(formIds: readonly string[], from: IsoDate, to: IsoDate): Promise<PlanEntry[]> {
    this.record("week", formIds, from, to);
    return Promise.resolve(structuredClone(this.weekResult));
  }

  waiting(
    formIds: readonly string[],
    limit: number,
  ): Promise<{ rows: PlanEntry[]; total: number }> {
    this.record("waiting", formIds, limit);
    return Promise.resolve(structuredClone(this.waitingResult));
  }

  count(filter: ListFilter): Promise<number> {
    this.record("count", filter);
    return Promise.resolve(this.countResult);
  }

  exportBatch(filter: ListFilter, after: ListCursor | null, size: number): Promise<ExportSource[]> {
    this.record("exportBatch", filter, after, size);
    return Promise.resolve(structuredClone(this.exportBatches.shift() ?? []));
  }
}

/** Streams `<name>\n` for every entry it opened, draining each file. */
export class ListingZipWriter implements ZipWriter {
  write(entries: AsyncIterable<ZipEntry>): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const iterator = entries[Symbol.asyncIterator]();
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        for (;;) {
          const next = await iterator.next();
          if (next.done === true) {
            controller.close();
            return;
          }
          const stream = await next.value.open();
          if (stream === null) continue;
          const reader = stream.getReader();
          while (!(await reader.read()).done) {
            // drain the file
          }
          controller.enqueue(encoder.encode(`${next.value.name}\n`));
          return;
        }
      },
    });
  }
}

export interface FakeReviewDeps extends ReviewDeps {
  definitions: FakeDefinitionsDeps;
  submissions: FakeSubmissionsDeps;
  media: FakeMediaDeps;
  stories: InMemoryStoryRepository;
  staffPhotos: InMemoryStaffPhotoRepository;
  edits: InMemoryEditRepository;
  queries: FakeReviewQueries;
  jobs: InMemoryJobAdmin;
  audit: InMemoryAuditLog;
  auditReader: InMemoryAuditLogReader;
  zip: ListingZipWriter;
  uow: FakeUnitOfWorkFactory;
  clock: FixedClock;
  ids: SequentialIdGenerator;
}

/** One clock, id generator, unit of work and audit log across every module. */
export function makeReviewDeps(): FakeReviewDeps {
  const submissions = makeSubmissionsDeps();
  const definitions = submissions.definitions;
  const clock = submissions.clock;
  clock.set(REVIEW_NOW);
  const stories = new InMemoryStoryRepository();
  const staffPhotos = new InMemoryStaffPhotoRepository();
  const edits = new InMemoryEditRepository();
  // Deleting a submission takes its review rows with it, as the database cascade does.
  const repository = submissions.submissions;
  const deleteRow = repository.delete.bind(repository);
  repository.delete = async (uow, id) => {
    const deleted = await deleteRow(uow, id);
    if (deleted) {
      stories.dropSubmission(id);
      staffPhotos.dropSubmission(id);
      edits.dropSubmission(id);
    }
    return deleted;
  };
  // makeSubmissionsDeps hands the same id generator and unit of work to definitions.
  return {
    definitions,
    submissions,
    media: submissions.media,
    stories,
    staffPhotos,
    edits,
    queries: new FakeReviewQueries(),
    jobs: new InMemoryJobAdmin(),
    audit: definitions.audit,
    auditReader: definitions.auditReader,
    zip: new ListingZipWriter(),
    uow: definitions.uow,
    clock,
    ids: definitions.ids,
    registry: submissions.registry,
    planTimeZone: PLAN_TIME_ZONE,
  };
}
