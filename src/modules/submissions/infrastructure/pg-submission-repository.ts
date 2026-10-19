import type { Pool } from "pg";
import { z } from "zod";
import type { Locale } from "@/shared/domain/localized-text";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { txOf } from "@/shared/infrastructure/postgres/tx";
import { isUuid } from "@/shared/infrastructure/uuid";
import type { SubmissionRepository } from "../application/ports/submission-repository";
import {
  CURATION_STATUSES,
  type Curation,
  type StoredSubmission,
  type Submission,
} from "../domain/submission";

const COLUMNS = `id, form_id, form_version_id, locale, answers, consent, received_at,
  reference, submit_token`;
const STORED_COLUMNS = `${COLUMNS}, status, curated_answers, published_post_url,
  status_changed_by, status_changed_at`;

const curatedAnswersSchema = z.record(z.string(), z.string());

const answersSchema = z.record(z.string(), z.unknown());
const consentSchema = z.object({
  fieldKey: z.string(),
  textVersion: z.string(),
  acceptedAt: z.string(),
});

interface SubmissionRow {
  id: string;
  form_id: string;
  form_version_id: string;
  locale: Locale;
  answers: unknown;
  consent: unknown;
  received_at: Date;
  reference: string;
  submit_token: string;
}

interface StoredRow extends SubmissionRow {
  status: string;
  curated_answers: unknown;
  published_post_url: string | null;
  status_changed_by: string | null;
  status_changed_at: Date | null;
}

function toStored(row: StoredRow): StoredSubmission {
  const submission = toSubmission(row);
  const curated = curatedAnswersSchema.safeParse(row.curated_answers);
  if (!curated.success) throw new Error(`stored curation of submission ${row.id} is corrupt`);
  const status = CURATION_STATUSES.find((s) => s === row.status);
  if (status === undefined) throw new Error(`stored status of submission ${row.id} is corrupt`);
  return {
    ...submission,
    curation: {
      status,
      curatedAnswers: curated.data,
      publishedPostUrl: row.published_post_url,
      statusChangedBy: row.status_changed_by,
      statusChangedAt: row.status_changed_at,
    },
  };
}

function toSubmission(row: SubmissionRow): Submission {
  // A stored row that fails is corruption. The messages name the submission
  // only: answers are personal data.
  const answers = answersSchema.safeParse(row.answers);
  if (!answers.success) throw new Error(`stored answers of submission ${row.id} are corrupt`);
  let consent: Submission["consent"] = null;
  if (row.consent !== null) {
    const parsed = consentSchema.safeParse(row.consent);
    const acceptedAt = parsed.success ? new Date(parsed.data.acceptedAt) : null;
    if (!parsed.success || acceptedAt === null || Number.isNaN(acceptedAt.getTime()))
      throw new Error(`stored consent of submission ${row.id} is corrupt`);
    consent = {
      fieldKey: parsed.data.fieldKey,
      textVersion: parsed.data.textVersion,
      acceptedAt,
    };
  }
  return {
    id: row.id,
    formId: row.form_id,
    versionId: row.form_version_id,
    locale: row.locale,
    answers: answers.data,
    consent,
    receivedAt: row.received_at,
    reference: row.reference,
    submitToken: row.submit_token,
  };
}

/**
 * Postgres adapter for submissions; see specs/system/database.md. Answers are
 * written once: the trigger refuses any later change.
 */
export class PgSubmissionRepository implements SubmissionRepository {
  constructor(private readonly pool: Pool) {}

  async insert(uow: UnitOfWork, submission: Submission): Promise<"inserted" | "duplicate_token"> {
    // `on conflict do nothing` keeps the surrounding transaction usable on a repeated token.
    const { rows } = await txOf(uow).client.query<{ id: string }>(
      `insert into submission
         (id, form_id, form_version_id, locale, answers, consent, received_at, reference,
          submit_token)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)
       on conflict (submit_token) do nothing
       returning id`,
      [
        submission.id,
        submission.formId,
        submission.versionId,
        submission.locale,
        JSON.stringify(submission.answers),
        submission.consent === null
          ? null
          : JSON.stringify({
              fieldKey: submission.consent.fieldKey,
              textVersion: submission.consent.textVersion,
              acceptedAt: submission.consent.acceptedAt.toISOString(),
            }),
        submission.receivedAt,
        submission.reference,
        submission.submitToken,
      ],
    );
    return rows.length === 0 ? "duplicate_token" : "inserted";
  }

  async findBySubmitToken(token: string, uow?: UnitOfWork): Promise<Submission | null> {
    if (!isUuid(token)) return null;
    const db = uow ? txOf(uow).client : this.pool;
    const { rows } = await db.query<SubmissionRow>(
      `select ${COLUMNS} from submission where submit_token = $1`,
      [token],
    );
    const row = rows[0];
    return row ? toSubmission(row) : null;
  }

  async findById(id: string): Promise<Submission | null> {
    if (!isUuid(id)) return null;
    const { rows } = await this.pool.query<SubmissionRow>(
      `select ${COLUMNS} from submission where id = $1`,
      [id],
    );
    const row = rows[0];
    return row ? toSubmission(row) : null;
  }

  async findStored(id: string): Promise<StoredSubmission | null> {
    if (!isUuid(id)) return null;
    const { rows } = await this.pool.query<StoredRow>(
      `select ${STORED_COLUMNS} from submission where id = $1`,
      [id],
    );
    const row = rows[0];
    return row ? toStored(row) : null;
  }

  async findByReference(formId: string, reference: string): Promise<StoredSubmission | null> {
    if (!isUuid(formId)) return null;
    const { rows } = await this.pool.query<StoredRow>(
      `select ${STORED_COLUMNS} from submission where form_id = $1 and reference = $2`,
      [formId, reference],
    );
    const row = rows[0];
    return row ? toStored(row) : null;
  }

  async lockForUpdate(uow: UnitOfWork, id: string): Promise<StoredSubmission | null> {
    if (!isUuid(id)) return null;
    const { rows } = await txOf(uow).client.query<StoredRow>(
      `select ${STORED_COLUMNS} from submission where id = $1 for update`,
      [id],
    );
    const row = rows[0];
    return row ? toStored(row) : null;
  }

  /** Throws for an unknown id, as the port's callers hold the row's lock and expect it there. */
  async writeCuration(uow: UnitOfWork, id: string, curation: Curation): Promise<void> {
    if (!isUuid(id)) throw new Error(`submission ${id} does not exist`);
    // The statement names the curation columns only; the trigger guards `answers` regardless.
    const { rowCount } = await txOf(uow).client.query(
      `update submission
          set status = $2, curated_answers = $3::jsonb, published_post_url = $4,
              status_changed_by = $5, status_changed_at = $6, updated_at = now()
        where id = $1`,
      [
        id,
        curation.status,
        JSON.stringify(curation.curatedAnswers),
        curation.publishedPostUrl,
        curation.statusChangedBy,
        curation.statusChangedAt,
      ],
    );
    if ((rowCount ?? 0) === 0) throw new Error(`submission ${id} does not exist`);
  }

  async delete(uow: UnitOfWork, id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const { rowCount } = await txOf(uow).client.query("delete from submission where id = $1", [id]);
    return (rowCount ?? 0) > 0;
  }
}
