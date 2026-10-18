import type { Pool } from "pg";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { txOf } from "@/shared/infrastructure/postgres/tx";
import { isUuid } from "@/shared/infrastructure/uuid";
import type {
  StaffPhotoRepository,
  StaffPhotoRow,
} from "../application/ports/staff-photo-repository";
import { parseSource } from "../domain/staff-photos";

interface Row {
  id: string;
  submission_id: string;
  source: string;
  added_by: string;
  created_at: Date;
}

function toPhoto(row: Row): StaffPhotoRow {
  const source = parseSource(row.source);
  if (source === null) throw new Error(`stored source of staff photo ${row.id} is corrupt`);
  return {
    id: row.id,
    submissionId: row.submission_id,
    source,
    addedBy: row.added_by,
    createdAt: row.created_at,
  };
}

/** Postgres adapter for staff photos; see specs/system/database.md and ADR 0028. */
export class PgStaffPhotoRepository implements StaffPhotoRepository {
  constructor(private readonly pool: Pool) {}

  async insert(uow: UnitOfWork, row: StaffPhotoRow): Promise<void> {
    await txOf(uow).client.query(
      `insert into staff_photo
         (id, submission_id, source, sender_confirmed, added_by, created_at, updated_at)
       values ($1, $2, $3, true, $4, $5, $5)`,
      [row.id, row.submissionId, row.source, row.addedBy, row.createdAt],
    );
  }

  async listBySubmission(submissionId: string, uow?: UnitOfWork): Promise<StaffPhotoRow[]> {
    if (!isUuid(submissionId)) return [];
    const db = uow ? txOf(uow).client : this.pool;
    const { rows } = await db.query<Row>(
      `select id, submission_id, source, added_by, created_at from staff_photo
        where submission_id = $1
        order by created_at, id`,
      [submissionId],
    );
    return rows.map(toPhoto);
  }

  async delete(uow: UnitOfWork, id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const { rowCount } = await txOf(uow).client.query("delete from staff_photo where id = $1", [
      id,
    ]);
    return (rowCount ?? 0) > 0;
  }
}
