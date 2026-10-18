import type { Pool } from "pg";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { txOf } from "@/shared/infrastructure/postgres/tx";
import { isUuid } from "@/shared/infrastructure/uuid";
import type { EditRepository, EditRow } from "../application/ports/edit-repository";

interface Row {
  id: string;
  submission_id: string;
  field_key: string;
  text: string;
  source: string;
  editor: string;
  created_at: Date;
}

function toEdit(row: Row): EditRow {
  // The message names the edit only: its text is personal data.
  if (row.source !== "manual") throw new Error(`stored source of edit ${row.id} is unsupported`);
  return {
    id: row.id,
    submissionId: row.submission_id,
    fieldKey: row.field_key,
    text: row.text,
    source: "manual",
    editor: row.editor,
    createdAt: row.created_at,
  };
}

/**
 * Postgres adapter for the edit history; see specs/system/database.md. Rows are
 * appended only: the trigger `submission_edit_no_update` refuses any update.
 */
export class PgEditRepository implements EditRepository {
  constructor(private readonly pool: Pool) {}

  async append(uow: UnitOfWork, row: EditRow): Promise<void> {
    await txOf(uow).client.query(
      `insert into submission_edit
         (id, submission_id, field_key, text, source, editor, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [row.id, row.submissionId, row.fieldKey, row.text, row.source, row.editor, row.createdAt],
    );
  }

  async latestByField(submissionId: string): Promise<Map<string, EditRow>> {
    if (!isUuid(submissionId)) return new Map();
    const { rows } = await this.pool.query<Row>(
      `select distinct on (field_key)
              id, submission_id, field_key, text, source, editor, created_at
         from submission_edit
        where submission_id = $1
        order by field_key, created_at desc, id desc`,
      [submissionId],
    );
    return new Map(rows.map((row) => [row.field_key, toEdit(row)]));
  }
}
