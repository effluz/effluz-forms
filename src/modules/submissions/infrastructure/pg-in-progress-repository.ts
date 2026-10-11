import type { Pool } from "pg";
import { z } from "zod";
import type { Locale } from "@/shared/domain/localized-text";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { txOf } from "@/shared/infrastructure/postgres/tx";
import { isUuid } from "@/shared/infrastructure/uuid";
import type { InProgressRepository } from "../application/ports/in-progress-repository";
import type { InProgress, PendingPage } from "../domain/in-progress";

const COLUMNS = `id, form_id, form_version_id, locale, page_key, answers, files, pending,
  submit_token, started_at, expires_at, created_at, updated_at`;

const filesSchema = z.record(
  z.string(),
  z.array(
    z.object({
      id: z.string(),
      stagingRef: z.string(),
      kind: z.enum(["image", "video"]),
      contentType: z.string(),
      size: z.number(),
    }),
  ),
);

const pendingSchema = z.object({
  pageKey: z.string(),
  raw: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  issues: z.array(
    z.object({
      code: z.string(),
      field: z.string(),
      params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    }),
  ),
});

const answersSchema = z.record(z.string(), z.unknown());

interface InProgressRow {
  id: string;
  form_id: string;
  form_version_id: string;
  locale: Locale;
  page_key: string;
  answers: unknown;
  files: unknown;
  pending: unknown;
  submit_token: string;
  started_at: Date;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

function toInProgress(row: InProgressRow): InProgress {
  // A stored row that fails is corruption. The messages name the record only:
  // answers and typed values are personal data.
  const answers = answersSchema.safeParse(row.answers);
  if (!answers.success) throw new Error(`stored answers of in-progress ${row.id} are corrupt`);
  const files = filesSchema.safeParse(row.files);
  if (!files.success) throw new Error(`stored files of in-progress ${row.id} are corrupt`);
  let pending: PendingPage | null = null;
  if (row.pending !== null) {
    const parsed = pendingSchema.safeParse(row.pending);
    if (!parsed.success) throw new Error(`stored pending page of in-progress ${row.id} is corrupt`);
    // The issue codes and field keys were validated when they were written.
    pending = parsed.data as PendingPage;
  }
  return {
    id: row.id,
    formId: row.form_id,
    versionId: row.form_version_id,
    locale: row.locale,
    pageKey: row.page_key,
    answers: answers.data,
    files: files.data,
    pending,
    submitToken: row.submit_token,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Postgres adapter for in-progress records; see specs/system/database.md. The
 * row holds personal data: it is never logged and is gone at submit or expiry.
 */
export class PgInProgressRepository implements InProgressRepository {
  constructor(private readonly pool: Pool) {}

  async insert(uow: UnitOfWork, record: InProgress): Promise<void> {
    await txOf(uow).client.query(
      `insert into submission_in_progress
         (id, form_id, form_version_id, locale, page_key, answers, files, pending,
          submit_token, started_at, expires_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13)`,
      [
        record.id,
        record.formId,
        record.versionId,
        record.locale,
        record.pageKey,
        JSON.stringify(record.answers),
        JSON.stringify(record.files),
        record.pending === null ? null : JSON.stringify(record.pending),
        record.submitToken,
        record.startedAt,
        record.expiresAt,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  async find(id: string): Promise<InProgress | null> {
    if (!isUuid(id)) return null;
    const { rows } = await this.pool.query<InProgressRow>(
      `select ${COLUMNS} from submission_in_progress where id = $1`,
      [id],
    );
    const row = rows[0];
    return row ? toInProgress(row) : null;
  }

  async findForUpdate(uow: UnitOfWork, id: string): Promise<InProgress | null> {
    if (!isUuid(id)) return null;
    const { rows } = await txOf(uow).client.query<InProgressRow>(
      `select ${COLUMNS} from submission_in_progress where id = $1 for update`,
      [id],
    );
    const row = rows[0];
    return row ? toInProgress(row) : null;
  }

  async update(uow: UnitOfWork, record: InProgress): Promise<void> {
    // The pinned version, the submit token and the dates never change.
    const res = await txOf(uow).client.query(
      `update submission_in_progress set
         locale = $2, page_key = $3, answers = $4::jsonb, files = $5::jsonb,
         pending = $6::jsonb, updated_at = $7
       where id = $1`,
      [
        record.id,
        record.locale,
        record.pageKey,
        JSON.stringify(record.answers),
        JSON.stringify(record.files),
        record.pending === null ? null : JSON.stringify(record.pending),
        record.updatedAt,
      ],
    );
    if (res.rowCount === 0) throw new Error(`in-progress ${record.id} does not exist`);
  }

  async delete(uow: UnitOfWork, id: string): Promise<void> {
    if (!isUuid(id)) return;
    await txOf(uow).client.query("delete from submission_in_progress where id = $1", [id]);
  }

  async listExpired(now: Date, limit: number): Promise<string[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      `select id from submission_in_progress
        where expires_at <= $1 order by expires_at limit $2`,
      [now, limit],
    );
    return rows.map((r) => r.id);
  }
}
