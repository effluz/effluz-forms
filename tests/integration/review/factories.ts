import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ReviewStatus } from "@/modules/review/domain/status";
import { PgSubmissionRepository } from "@/modules/submissions/infrastructure/pg-submission-repository";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { seedPublishedForm } from "../submissions/factories";

let sequence = 0;

/**
 * A stored submission, written through the real submission repository, on a
 * new published form or on the current version of `over.formId` (or on `over.versionId`
 * of that form), with `over.status` written afterwards. Synthetic data only.
 */
export async function seedStoredStory(
  pool: Pool,
  over: {
    formId?: string;
    reference?: string;
    receivedAt?: Date;
    answers?: Record<string, unknown>;
    status?: ReviewStatus;
    versionId?: string;
  } = {},
): Promise<{ formId: string; submissionId: string; reference: string }> {
  let formId: string;
  let versionId: string;
  if (over.formId === undefined) {
    if (over.versionId !== undefined) throw new Error("versionId needs the formId it belongs to");
    ({ formId, versionId } = await seedPublishedForm(pool));
  } else {
    formId = over.formId;
    const { rows } = await pool.query<{ current_version_id: string | null }>(
      "select current_version_id from form where id = $1",
      [formId],
    );
    const current = rows[0]?.current_version_id;
    if (current == null) throw new Error(`form ${formId} has no current version`);
    versionId = over.versionId ?? current;
  }
  sequence += 1;
  const receivedAt = over.receivedAt ?? new Date("2026-10-10T12:00:00.000Z");
  const reference = over.reference ?? `ST-${String(sequence).padStart(4, "0")}`;
  const submissionId = randomUUID();
  await new PgUnitOfWorkFactory(pool).run((uow) =>
    new PgSubmissionRepository(pool).insert(uow, {
      id: submissionId,
      formId,
      versionId,
      locale: "es",
      answers: over.answers ?? { f_name: "Ana Prueba" },
      consent: { fieldKey: "f_consent", textVersion: "0123456789abcdef", acceptedAt: receivedAt },
      receivedAt,
      reference,
      submitToken: randomUUID(),
    }),
  );
  if (over.status !== undefined)
    await pool.query("update submission set status = $2 where id = $1", [
      submissionId,
      over.status,
    ]);
  return { formId, submissionId, reference };
}
