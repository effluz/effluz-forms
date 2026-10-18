import type { Pool } from "pg";
import { localizedTextSchema, type Languages } from "@/shared/domain/localized-text";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { txOf } from "@/shared/infrastructure/postgres/tx";
import type { FormRepository, FormTab } from "../application/ports/form-repository";
import type { Form, FormStatus } from "../domain/form";
import { settingsSchema } from "../domain/settings";
import { isUuid } from "@/shared/infrastructure/uuid";

const UNIQUE_VIOLATION = "23505";
const SLUG_CONSTRAINT = "form_slug_key";

const STATUSES_OF_TAB: Record<FormTab, FormStatus[]> = {
  active: ["draft", "published"],
  closed: ["closed"],
  archived: ["archived"],
};

const COLUMNS = `id, slug, title, languages, status, settings, current_version_id,
  current_version_number, archived_at, created_at, updated_at`;

interface FormRow {
  id: string;
  slug: string;
  title: unknown;
  languages: Languages;
  status: FormStatus;
  settings: unknown;
  current_version_id: string | null;
  current_version_number: number | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toForm(row: FormRow): Form {
  // A stored row that fails is corruption. The messages name the form only:
  // settings hold recipient addresses and titles are staff text.
  const title = localizedTextSchema.safeParse(row.title);
  if (!title.success) throw new Error(`stored title of form ${row.id} is corrupt`);
  const settings = settingsSchema.safeParse(row.settings);
  if (!settings.success) throw new Error(`stored settings of form ${row.id} are corrupt`);
  return {
    id: row.id,
    slug: row.slug,
    title: title.data,
    languages: row.languages,
    status: row.status,
    settings: settings.data,
    currentVersionId: row.current_version_id,
    currentVersionNumber: row.current_version_number,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isSlugViolation(error: unknown): boolean {
  const e = error as { code?: string; constraint?: string } | null;
  return e?.code === UNIQUE_VIOLATION && e.constraint === SLUG_CONSTRAINT;
}

/** Escapes the LIKE wildcards so the search term matches literally. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Postgres adapter for forms and the per-person "last opened" marks; see
 * specs/system/database.md and specs/ui-ux/manager.md.
 */
export class PgFormRepository implements FormRepository {
  constructor(private readonly pool: Pool) {}

  async insert(uow: UnitOfWork, form: Form): Promise<"inserted" | "slug_taken"> {
    // A savepoint keeps the surrounding transaction usable after the violation.
    const client = txOf(uow).client;
    await client.query("savepoint form_insert");
    try {
      await client.query(
        `insert into form
           (id, slug, title, languages, status, settings, current_version_id,
            current_version_number, archived_at, created_at, updated_at)
         values ($1, $2, $3::jsonb, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
        [
          form.id,
          form.slug,
          JSON.stringify(form.title),
          form.languages,
          form.status,
          JSON.stringify(form.settings),
          form.currentVersionId,
          form.currentVersionNumber,
          form.archivedAt,
          form.createdAt,
          form.updatedAt,
        ],
      );
      await client.query("release savepoint form_insert");
      return "inserted";
    } catch (error) {
      if (!isSlugViolation(error)) throw error;
      await client.query("rollback to savepoint form_insert");
      return "slug_taken";
    }
  }

  async update(uow: UnitOfWork, form: Form): Promise<"updated" | "slug_taken"> {
    const client = txOf(uow).client;
    await client.query("savepoint form_update");
    try {
      const res = await client.query(
        `update form set
           slug = $2, title = $3::jsonb, languages = $4, status = $5, settings = $6::jsonb,
           current_version_id = $7, current_version_number = $8, archived_at = $9,
           updated_at = $10
         where id = $1`,
        [
          form.id,
          form.slug,
          JSON.stringify(form.title),
          form.languages,
          form.status,
          JSON.stringify(form.settings),
          form.currentVersionId,
          form.currentVersionNumber,
          form.archivedAt,
          form.updatedAt,
        ],
      );
      if (res.rowCount === 0) throw new Error(`form ${form.id} does not exist`);
      await client.query("release savepoint form_update");
      return "updated";
    } catch (error) {
      if (!isSlugViolation(error)) throw error;
      await client.query("rollback to savepoint form_update");
      return "slug_taken";
    }
  }

  async delete(uow: UnitOfWork, id: string): Promise<void> {
    if (!isUuid(id)) return;
    await txOf(uow).client.query("delete from form where id = $1", [id]);
  }

  async findById(id: string): Promise<Form | null> {
    if (!isUuid(id)) return null;
    const { rows } = await this.pool.query<FormRow>(`select ${COLUMNS} from form where id = $1`, [
      id,
    ]);
    const row = rows[0];
    return row ? toForm(row) : null;
  }

  async findForUpdate(uow: UnitOfWork, id: string): Promise<Form | null> {
    if (!isUuid(id)) return null;
    const { rows } = await txOf(uow).client.query<FormRow>(
      `select ${COLUMNS} from form where id = $1 for update`,
      [id],
    );
    const row = rows[0];
    return row ? toForm(row) : null;
  }

  async findBySlug(slug: string): Promise<Form | null> {
    const { rows } = await this.pool.query<FormRow>(`select ${COLUMNS} from form where slug = $1`, [
      slug,
    ]);
    const row = rows[0];
    return row ? toForm(row) : null;
  }

  async takeReferenceNumber(uow: UnitOfWork, formId: string): Promise<number> {
    // Leaves updated_at alone: a submission is not a form edit.
    const { rows } = isUuid(formId)
      ? await txOf(uow).client.query<{ n: number }>(
          `update form set next_reference = next_reference + 1
            where id = $1 returning next_reference - 1 as n`,
          [formId],
        )
      : { rows: [] };
    const row = rows[0];
    if (!row) throw new Error(`form ${formId} does not exist`);
    return row.n;
  }

  async list(tab: FormTab, search?: string): Promise<Form[]> {
    const params: unknown[] = [STATUSES_OF_TAB[tab]];
    let filter = "";
    const term = search?.trim();
    if (term) {
      params.push(likePattern(term));
      filter = `and (slug ilike $2 or title->>'en' ilike $2 or title->>'es' ilike $2)`;
    }
    const { rows } = await this.pool.query<FormRow>(
      `select ${COLUMNS} from form
        where status = any($1::text[]) ${filter}
        order by lower(coalesce(title->>'en', title->>'es', '')), slug`,
      params,
    );
    return rows.map(toForm);
  }

  async listUsingPostPlan(): Promise<Form[]> {
    // A row without the key (stored before the setting existed) reads as off.
    const { rows } = await this.pool.query<FormRow>(
      `select ${COLUMNS} from form
        where (settings->>'usePostPlan')::boolean is true
        order by lower(coalesce(title->>'en', title->>'es', '')), slug`,
    );
    return rows.map(toForm);
  }

  async counts(): Promise<Record<FormTab, number>> {
    const { rows } = await this.pool.query<{ tab: FormTab; total: number }>(
      `select case when status in ('draft', 'published') then 'active' else status end as tab,
              count(*)::int as total
         from form group by 1`,
    );
    const counts: Record<FormTab, number> = { active: 0, closed: 0, archived: 0 };
    for (const row of rows) counts[row.tab] = row.total;
    return counts;
  }

  async markOpened(uow: UnitOfWork, formId: string, email: string, at: Date): Promise<void> {
    if (!isUuid(formId)) return;
    await txOf(uow).client.query(
      `insert into form_visit (form_id, email, last_opened_at, created_at, updated_at)
       values ($1, $2, $3, now(), now())
       on conflict (form_id, email)
       do update set last_opened_at = excluded.last_opened_at, updated_at = now()`,
      [formId, email, at],
    );
  }

  async lastOpened(email: string, formIds: string[]): Promise<Map<string, Date>> {
    const ids = formIds.filter(isUuid);
    const opened = new Map<string, Date>();
    if (ids.length === 0) return opened;
    const { rows } = await this.pool.query<{ form_id: string; last_opened_at: Date }>(
      `select form_id, last_opened_at from form_visit
        where email = $1 and form_id = any($2::uuid[])`,
      [email, ids],
    );
    for (const row of rows) opened.set(row.form_id, row.last_opened_at);
    return opened;
  }
}
