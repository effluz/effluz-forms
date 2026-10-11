import type { Pool } from "pg";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { txOf } from "@/shared/infrastructure/postgres/tx";
import { isUuid } from "@/shared/infrastructure/uuid";
import type { MediaRepository } from "../application/ports/media-repository";
import type { MediaKind, MediaRecord, MediaStatus } from "../domain/media";

const COLUMNS = `id, submission_id, form_id, field_key, position, kind, status,
  content_type, size, staging_ref, durable_key, provider_ref, created_at, updated_at`;

interface MediaRow {
  id: string;
  submission_id: string;
  form_id: string;
  field_key: string;
  position: number;
  kind: MediaKind;
  status: MediaStatus;
  content_type: string;
  size: string; // bigint arrives as a string
  staging_ref: string | null;
  durable_key: string;
  provider_ref: string | null;
  created_at: Date;
  updated_at: Date;
}

function toMedia(row: MediaRow): MediaRecord {
  return {
    id: row.id,
    submissionId: row.submission_id,
    formId: row.form_id,
    fieldKey: row.field_key,
    position: row.position,
    kind: row.kind,
    status: row.status,
    contentType: row.content_type,
    size: Number(row.size),
    stagingRef: row.staging_ref,
    durableKey: row.durable_key,
    providerRef: row.provider_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Postgres adapter for the `media` table; see specs/system/database.md and specs/system/media-storage.md. */
export class PgMediaRepository implements MediaRepository {
  constructor(private readonly pool: Pool) {}

  async insert(uow: UnitOfWork, r: MediaRecord): Promise<void> {
    await txOf(uow).client.query(
      `insert into media (${COLUMNS})
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        r.id,
        r.submissionId,
        r.formId,
        r.fieldKey,
        r.position,
        r.kind,
        r.status,
        r.contentType,
        r.size,
        r.stagingRef,
        r.durableKey,
        r.providerRef,
        r.createdAt,
        r.updatedAt,
      ],
    );
  }

  async findById(id: string): Promise<MediaRecord | null> {
    if (!isUuid(id)) return null;
    const { rows } = await this.pool.query<MediaRow>(`select ${COLUMNS} from media where id = $1`, [
      id,
    ]);
    const row = rows[0];
    return row ? toMedia(row) : null;
  }

  async listBySubmission(submissionId: string): Promise<MediaRecord[]> {
    if (!isUuid(submissionId)) return [];
    const { rows } = await this.pool.query<MediaRow>(
      `select ${COLUMNS} from media where submission_id = $1 order by field_key, position`,
      [submissionId],
    );
    return rows.map(toMedia);
  }

  async markStored(uow: UnitOfWork, id: string, providerRef: string, at: Date): Promise<void> {
    if (!isUuid(id)) return;
    await txOf(uow).client.query(
      "update media set status = 'stored', provider_ref = $2, updated_at = $3 where id = $1",
      [id, providerRef, at],
    );
  }

  async clearStaging(uow: UnitOfWork, id: string, at: Date): Promise<void> {
    if (!isUuid(id)) return;
    await txOf(uow).client.query(
      "update media set staging_ref = null, updated_at = $2 where id = $1",
      [id, at],
    );
  }

  async markFailed(uow: UnitOfWork, id: string, at: Date): Promise<void> {
    if (!isUuid(id)) return;
    await txOf(uow).client.query(
      "update media set status = 'failed', updated_at = $2 where id = $1",
      [id, at],
    );
  }

  async delete(uow: UnitOfWork, id: string): Promise<void> {
    if (!isUuid(id)) return;
    await txOf(uow).client.query("delete from media where id = $1", [id]);
  }
}
