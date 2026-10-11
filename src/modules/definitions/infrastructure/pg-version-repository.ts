import type { Pool } from "pg";
import { versionSchema, type Version } from "@/shared/domain/form-model";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { txOf } from "@/shared/infrastructure/postgres/tx";
import type { FormVersion, VersionRepository } from "../application/ports/version-repository";
import { isUuid } from "./uuid";

const UNIQUE_VIOLATION = "23505";
const NUMBER_CONSTRAINT = "form_version_form_id_number_key";

interface VersionRow {
  id: string;
  form_id: string;
  number: number;
  document: unknown;
  published_at: Date;
  published_by: string | null;
}

const COLUMNS = "v.id, v.form_id, v.number, v.document, v.published_at, v.published_by";

function toVersion(row: VersionRow): FormVersion {
  // The application layer re-parses with the registry; this only guards the shape and
  // returns the stored object, so no key is dropped or defaulted on read.
  const document = versionSchema.safeParse(row.document);
  if (!document.success) throw new Error(`stored version ${row.id} is corrupt`);
  return {
    id: row.id,
    formId: row.form_id,
    number: row.number,
    document: row.document as Version,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
  };
}

/**
 * Postgres adapter for published versions. The table refuses updates and
 * deletes, so a version never changes once written; see
 * specs/form-definition.md, "Versioning".
 */
export class PgVersionRepository implements VersionRepository {
  constructor(private readonly pool: Pool) {}

  async insert(uow: UnitOfWork, version: FormVersion): Promise<"inserted" | "number_taken"> {
    // A savepoint keeps the surrounding transaction usable after the violation.
    const client = txOf(uow).client;
    await client.query("savepoint version_insert");
    try {
      await client.query(
        `insert into form_version
           (id, form_id, number, document, published_at, published_by, created_at, updated_at)
         values ($1, $2, $3, $4::jsonb, $5, $6, $5, $5)`,
        [
          version.id,
          version.formId,
          version.number,
          JSON.stringify(version.document),
          version.publishedAt,
          version.publishedBy,
        ],
      );
      await client.query("release savepoint version_insert");
      return "inserted";
    } catch (error) {
      const e = error as { code?: string; constraint?: string } | null;
      if (e?.code !== UNIQUE_VIOLATION || e.constraint !== NUMBER_CONSTRAINT) throw error;
      await client.query("rollback to savepoint version_insert");
      return "number_taken";
    }
  }

  async findById(id: string): Promise<FormVersion | null> {
    if (!isUuid(id)) return null;
    const { rows } = await this.pool.query<VersionRow>(
      `select ${COLUMNS} from form_version v where v.id = $1`,
      [id],
    );
    const row = rows[0];
    return row ? toVersion(row) : null;
  }

  async findCurrent(formId: string): Promise<FormVersion | null> {
    if (!isUuid(formId)) return null;
    const { rows } = await this.pool.query<VersionRow>(
      `select ${COLUMNS} from form_version v
         join form f on f.current_version_id = v.id
        where f.id = $1`,
      [formId],
    );
    const row = rows[0];
    return row ? toVersion(row) : null;
  }

  async latestNumber(formId: string): Promise<number> {
    if (!isUuid(formId)) return 0;
    const { rows } = await this.pool.query<{ latest: number }>(
      "select coalesce(max(number), 0)::int as latest from form_version where form_id = $1",
      [formId],
    );
    return rows[0]?.latest ?? 0;
  }
}
