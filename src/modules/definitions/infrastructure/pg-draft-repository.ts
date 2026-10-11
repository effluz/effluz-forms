import type { Pool } from "pg";
import { versionSchema, type Version } from "@/shared/domain/form-model";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { txOf } from "@/shared/infrastructure/postgres/tx";
import type { DraftRepository } from "../application/ports/draft-repository";
import type { Draft } from "../domain/draft";
import { isUuid } from "@/shared/infrastructure/uuid";

interface DraftRow {
  form_id: string;
  revision: number;
  document: unknown;
  updated_by: string | null;
  updated_at: Date;
  audited_by: string | null;
  audited_at: Date | null;
}

const SELECT = `select form_id, revision, document, updated_by, updated_at, audited_by, audited_at
  from form_draft`;

function toDraft(row: DraftRow): Draft {
  // The application layer re-parses with the registry; this only guards the shape and
  // returns the stored object, so no key is dropped or defaulted on read.
  const document = versionSchema.safeParse(row.document);
  if (!document.success) throw new Error(`stored draft of form ${row.form_id} is corrupt`);
  return {
    formId: row.form_id,
    revision: row.revision,
    document: row.document as Version,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    auditedBy: row.audited_by,
    auditedAt: row.audited_at,
  };
}

/**
 * Postgres adapter for working copies; see specs/form-definition.md,
 * "Versioning". The row's `updated_at` is the draft's own `updatedAt`, so the
 * caller's clock decides it.
 */
export class PgDraftRepository implements DraftRepository {
  constructor(private readonly pool: Pool) {}

  async insert(uow: UnitOfWork, draft: Draft): Promise<void> {
    await txOf(uow).client.query(
      `insert into form_draft
         (form_id, revision, document, updated_by, audited_by, audited_at, created_at, updated_at)
       values ($1, $2, $3::jsonb, $4, $5, $6, $7, $7)`,
      [
        draft.formId,
        draft.revision,
        JSON.stringify(draft.document),
        draft.updatedBy,
        draft.auditedBy,
        draft.auditedAt,
        draft.updatedAt,
      ],
    );
  }

  async find(formId: string): Promise<Draft | null> {
    if (!isUuid(formId)) return null;
    const { rows } = await this.pool.query<DraftRow>(`${SELECT} where form_id = $1`, [formId]);
    const row = rows[0];
    return row ? toDraft(row) : null;
  }

  async findForUpdate(uow: UnitOfWork, formId: string): Promise<Draft | null> {
    if (!isUuid(formId)) return null;
    const { rows } = await txOf(uow).client.query<DraftRow>(
      `${SELECT} where form_id = $1 for update`,
      [formId],
    );
    const row = rows[0];
    return row ? toDraft(row) : null;
  }

  async save(uow: UnitOfWork, draft: Draft, expectedRevision: number): Promise<"saved" | "stale"> {
    const res = await txOf(uow).client.query(
      `update form_draft set
         revision = $3, document = $4::jsonb, updated_by = $5, audited_by = $6,
         audited_at = $7, updated_at = $8
       where form_id = $1 and revision = $2`,
      [
        draft.formId,
        expectedRevision,
        expectedRevision + 1,
        JSON.stringify(draft.document),
        draft.updatedBy,
        draft.auditedBy,
        draft.auditedAt,
        draft.updatedAt,
      ],
    );
    return res.rowCount === 1 ? "saved" : "stale";
  }
}
