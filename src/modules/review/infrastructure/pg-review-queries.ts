import type { Pool } from "pg";
import { z } from "zod";
import type { Locale } from "@/shared/domain/localized-text";
import { isUuid } from "@/shared/infrastructure/uuid";
import type {
  ExportSource,
  ListCursor,
  ListFilter,
  ListRow,
  PlanEntry,
  ReviewQueries,
} from "../application/ports/review-queries";
import { PLAN_TIME_ZONE, type IsoDate } from "../domain/days";
import { LIST_PAGE_SIZE, type PlanFilter } from "../domain/list-query";
import type { StoryChecks } from "../domain/readiness";
import { REVIEW_STATUSES, type ReviewStatus } from "../domain/status";
import { STAFF_PHOTOS_FIELD_KEY } from "../domain/staff-photos";

/** Collects positional parameters while a statement is assembled. */
class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${String(this.values.length)}`;
  }
}

// `st` is the left-joined story row: every column is null for a story no one touched.
const PLAN_SQL: Record<PlanFilter, string> = {
  planned: "st.planned_on is not null and st.published_on is null",
  waiting: "st.planned_on is null and st.published_on is null",
  // The negation of `readiness(checks).ready`; the edited tick compares null-safely.
  not_ready: `st.published_on is null and not (
      cardinality(coalesce(st.chosen_media, '{}')) > 0
      and st.photos_edited_for is not distinct from st.chosen_media
      and st.text_checked_at is not null)`,
};

const FROM = "from submission s left join story st on st.submission_id = s.id";
const ORDER_NEWEST = "order by s.received_at desc, s.id desc";

/** `%`, `_` and the escape character itself match literally. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** The conditions of the filter, or null when it can match nothing (a malformed id). */
function conditions(filter: ListFilter, p: Params): string[] | null {
  if (!isUuid(filter.formId)) return null;
  if (filter.versionId !== null && !isUuid(filter.versionId)) return null;
  const c = [`s.form_id = ${p.add(filter.formId)}::uuid`];
  if (filter.status !== null) c.push(`s.status = ${p.add(filter.status)}`);
  if (filter.plan !== null) c.push(`(${PLAN_SQL[filter.plan]})`);
  if (filter.from !== null || filter.to !== null) {
    const day = `(s.received_at at time zone ${p.add(PLAN_TIME_ZONE)})::date`;
    if (filter.from !== null) c.push(`${day} >= ${p.add(filter.from)}::date`);
    if (filter.to !== null) c.push(`${day} <= ${p.add(filter.to)}::date`);
  }
  if (filter.versionId !== null) c.push(`s.form_version_id = ${p.add(filter.versionId)}::uuid`);
  if (filter.media)
    c.push(
      `exists (select 1 from media m
        where m.submission_id = s.id and m.field_key <> ${p.add(STAFF_PHOTOS_FIELD_KEY)})`,
    );
  if (filter.search !== null) {
    const pattern = p.add(likePattern(filter.search.text));
    c.push(
      `(s.reference ilike ${pattern} or exists (
        select 1 from unnest(${p.add([...filter.search.keys])}::text[]) as k (key)
         where s.answers ->> k.key ilike ${pattern}))`,
    );
  }
  return c;
}

const STORY_COLUMNS = `s.id, s.form_id, s.reference, s.received_at, s.form_version_id, s.locale, s.status,
    s.answers,
    to_char(st.planned_on, 'YYYY-MM-DD') as planned_on,
    to_char(st.published_on, 'YYYY-MM-DD') as published_on,
    st.chosen_media::text[] as chosen_media, st.photos_edited_for::text[] as photos_edited_for,
    st.text_checked_at`;

function listColumns(p: Params): string {
  const staff = p.add(STAFF_PHOTOS_FIELD_KEY);
  return `${STORY_COLUMNS},
    (select count(*)::int from media m
      where m.submission_id = s.id and m.field_key <> ${staff}) as media_count,
    exists (select 1 from job j
      where j.status = 'dead'
        and (j.payload ->> 'submissionId' = s.id::text
          or j.payload ->> 'mediaId' in (select m.id::text from media m where m.submission_id = s.id))
    ) as has_dead_jobs`;
}

function exportColumns(p: Params): string {
  const staff = p.add(STAFF_PHOTOS_FIELD_KEY);
  return `${STORY_COLUMNS}, s.curated_answers, s.published_post_url,
    coalesce((select json_agg(json_build_object('fieldKey', m.field_key, 'key', m.durable_key)
        order by m.field_key, m.position) from media m
      where m.submission_id = s.id and m.field_key <> ${staff}), '[]') as sender_files,
    coalesce((select array_agg(m.durable_key order by m.created_at, m.position, m.id) from media m
      where m.submission_id = s.id and m.field_key = ${staff}), '{}') as staff_keys`;
}

const PLAN_COLUMNS = `${STORY_COLUMNS}, s.published_post_url`;

interface StoryRowSql {
  id: string;
  form_id: string;
  reference: string;
  received_at: Date;
  form_version_id: string;
  locale: Locale;
  status: string;
  answers: unknown;
  planned_on: string | null;
  published_on: string | null;
  chosen_media: string[] | null;
  photos_edited_for: string[] | null;
  text_checked_at: Date | null;
}

interface ListRowSql extends StoryRowSql {
  media_count: number;
  has_dead_jobs: boolean;
}

interface PlanRowSql extends StoryRowSql {
  published_post_url: string | null;
}

interface ExportRowSql extends PlanRowSql {
  curated_answers: unknown;
  sender_files: unknown;
  staff_keys: string[];
}

const answersSchema = z.record(z.string(), z.unknown());
const curatedSchema = z.record(z.string(), z.string());
const senderFilesSchema = z.array(z.object({ fieldKey: z.string(), key: z.string() }));

// A stored row that fails is corruption. Messages name the submission only.
function statusOf(row: StoryRowSql): ReviewStatus {
  const status = REVIEW_STATUSES.find((s) => s === row.status);
  if (status === undefined) throw new Error(`stored status of submission ${row.id} is corrupt`);
  return status;
}

function answersOf(row: StoryRowSql): Record<string, unknown> {
  const parsed = answersSchema.safeParse(row.answers);
  if (!parsed.success) throw new Error(`stored answers of submission ${row.id} are corrupt`);
  return parsed.data;
}

function checksOf(row: StoryRowSql): StoryChecks {
  return {
    chosen: row.chosen_media ?? [],
    photosEditedFor: row.photos_edited_for,
    textCheckedAt: row.text_checked_at,
  };
}

function toListRow(row: ListRowSql): ListRow {
  return {
    submissionId: row.id,
    reference: row.reference,
    receivedAt: row.received_at,
    versionId: row.form_version_id,
    locale: row.locale,
    status: statusOf(row),
    answers: answersOf(row),
    mediaCount: row.media_count,
    plannedOn: row.planned_on,
    publishedOn: row.published_on,
    checks: checksOf(row),
    hasDeadJobs: row.has_dead_jobs,
  };
}

function toPlanEntry(row: PlanRowSql): PlanEntry {
  return {
    submissionId: row.id,
    formId: row.form_id,
    reference: row.reference,
    versionId: row.form_version_id,
    receivedAt: row.received_at,
    answers: answersOf(row),
    status: statusOf(row),
    postUrl: row.published_post_url,
    plannedOn: row.planned_on,
    publishedOn: row.published_on,
    checks: checksOf(row),
  };
}

function toExportSource(row: ExportRowSql): ExportSource {
  const curated = curatedSchema.safeParse(row.curated_answers);
  if (!curated.success) throw new Error(`stored curation of submission ${row.id} is corrupt`);
  const senderFiles = senderFilesSchema.safeParse(row.sender_files);
  if (!senderFiles.success) throw new Error(`stored media of submission ${row.id} is corrupt`);
  return {
    submissionId: row.id,
    reference: row.reference,
    receivedAt: row.received_at,
    versionId: row.form_version_id,
    locale: row.locale,
    status: statusOf(row),
    answers: answersOf(row),
    curatedAnswers: curated.data,
    postUrl: row.published_post_url,
    plannedOn: row.planned_on,
    senderFiles: senderFiles.data,
    staffKeys: row.staff_keys,
  };
}

function zeroCounts(): Record<ReviewStatus, number> {
  return { new: 0, viewed: 0, edited: 0, published: 0 };
}

function uuids(ids: readonly string[]): string[] {
  return ids.filter(isUuid);
}

/**
 * The review read model in SQL. Reads `submission`, `story`, `media` and `job`,
 * never writes them (ADR 0028). Malformed ids name no row, so they match nothing.
 */
export class PgReviewQueries implements ReviewQueries {
  constructor(private readonly pool: Pool) {}

  async list(filter: ListFilter, page: number): Promise<{ rows: ListRow[]; total: number }> {
    const p = new Params();
    const where = conditions(filter, p);
    if (where === null) return { rows: [], total: 0 };
    const total = await this.count(filter);
    const offset = (Math.max(1, Math.floor(page)) - 1) * LIST_PAGE_SIZE;
    const columns = listColumns(p);
    const { rows } = await this.pool.query<ListRowSql>(
      `select ${columns} ${FROM} where ${where.join(" and ")} ${ORDER_NEWEST}
        limit ${p.add(LIST_PAGE_SIZE)} offset ${p.add(offset)}`,
      p.values,
    );
    return { rows: rows.map(toListRow), total };
  }

  async statusCounts(formId: string): Promise<Record<ReviewStatus, number>> {
    const counts = zeroCounts();
    if (!isUuid(formId)) return counts;
    const { rows } = await this.pool.query<{ status: string; n: number }>(
      "select status, count(*)::int as n from submission where form_id = $1 group by status",
      [formId],
    );
    for (const row of rows) {
      const status = REVIEW_STATUSES.find((s) => s === row.status);
      if (status !== undefined) counts[status] = row.n;
    }
    return counts;
  }

  async neighbours(
    filter: ListFilter,
    at: ListCursor,
  ): Promise<{ newer: string | null; older: string | null }> {
    if (!isUuid(at.submissionId)) return { newer: null, older: null };
    const [newer, older] = await Promise.all([
      this.nearest(filter, at, ">", "asc"),
      this.nearest(filter, at, "<", "desc"),
    ]);
    return { newer, older };
  }

  private async nearest(
    filter: ListFilter,
    at: ListCursor,
    op: ">" | "<",
    direction: "asc" | "desc",
  ): Promise<string | null> {
    const p = new Params();
    const where = conditions(filter, p);
    if (where === null) return null;
    where.push(
      `(s.received_at, s.id) ${op} (${p.add(at.receivedAt)}::timestamptz, ${p.add(at.submissionId)}::uuid)`,
    );
    const { rows } = await this.pool.query<{ reference: string }>(
      `select s.reference ${FROM} where ${where.join(" and ")}
        order by s.received_at ${direction}, s.id ${direction} limit 1`,
      p.values,
    );
    return rows[0]?.reference ?? null;
  }

  async week(formIds: readonly string[], from: IsoDate, to: IsoDate): Promise<PlanEntry[]> {
    const ids = uuids(formIds);
    if (ids.length === 0) return [];
    const p = new Params();
    const forms = p.add(ids);
    const first = p.add(from);
    const last = p.add(to);
    const { rows } = await this.pool.query<PlanRowSql>(
      `select ${PLAN_COLUMNS} from story st join submission s on s.id = st.submission_id
        where s.form_id = any(${forms}::uuid[])
          and ((st.published_on is null and st.planned_on between ${first}::date and ${last}::date)
            or st.published_on between ${first}::date and ${last}::date)
        order by coalesce(st.published_on, st.planned_on), s.received_at, s.id`,
      p.values,
    );
    return rows.map(toPlanEntry);
  }

  async waiting(
    formIds: readonly string[],
    limit: number,
  ): Promise<{ rows: PlanEntry[]; total: number }> {
    const ids = uuids(formIds);
    if (ids.length === 0) return { rows: [], total: 0 };
    const where = `s.form_id = any($1::uuid[]) and (${PLAN_SQL.waiting})`;
    const counted = await this.pool.query<{ n: number }>(
      `select count(*)::int as n ${FROM} where ${where}`,
      [ids],
    );
    const p = new Params();
    p.add(ids);
    const { rows } = await this.pool.query<PlanRowSql>(
      `select ${PLAN_COLUMNS} ${FROM} where ${where} ${ORDER_NEWEST}
        limit ${p.add(Math.max(0, Math.floor(limit)))}`,
      p.values,
    );
    return { rows: rows.map(toPlanEntry), total: counted.rows[0]?.n ?? 0 };
  }

  async count(filter: ListFilter): Promise<number> {
    const p = new Params();
    const where = conditions(filter, p);
    if (where === null) return 0;
    const { rows } = await this.pool.query<{ n: number }>(
      `select count(*)::int as n ${FROM} where ${where.join(" and ")}`,
      p.values,
    );
    return rows[0]?.n ?? 0;
  }

  async exportBatch(
    filter: ListFilter,
    after: ListCursor | null,
    size: number,
  ): Promise<ExportSource[]> {
    if (size < 1) return [];
    if (after !== null && !isUuid(after.submissionId)) return [];
    const p = new Params();
    const where = conditions(filter, p);
    if (where === null) return [];
    if (after !== null)
      where.push(
        `(s.received_at, s.id) < (${p.add(after.receivedAt)}::timestamptz, ${p.add(after.submissionId)}::uuid)`,
      );
    const columns = exportColumns(p);
    const { rows } = await this.pool.query<ExportRowSql>(
      `select ${columns} ${FROM} where ${where.join(" and ")} ${ORDER_NEWEST}
        limit ${p.add(Math.floor(size))}`,
      p.values,
    );
    return rows.map(toExportSource);
  }
}
