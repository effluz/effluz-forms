import type { Pool } from "pg";
import { z } from "zod";
import type { Locale } from "@/shared/domain/localized-text";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { txOf } from "@/shared/infrastructure/postgres/tx";
import { isUuid } from "@/shared/infrastructure/uuid";
import type { SubmissionRepository } from "../application/ports/submission-repository";
import type { Submission } from "../domain/submission";

const COLUMNS = `id, form_id, form_version_id, locale, answers, consent, received_at,
  reference, submit_token`;

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

  async findBySubmitToken(token: string): Promise<Submission | null> {
    if (!isUuid(token)) return null;
    const { rows } = await this.pool.query<SubmissionRow>(
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
}
