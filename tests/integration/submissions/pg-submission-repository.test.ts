import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Submission } from "@/modules/submissions/domain/submission";
import { PgSubmissionRepository } from "@/modules/submissions/infrastructure/pg-submission-repository";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";
import { seedPublishedForm } from "./factories";

describe("PgSubmissionRepository", () => {
  const pool = testPool();
  const repo = new PgSubmissionRepository(pool);
  const uow = new PgUnitOfWorkFactory(pool);
  beforeEach(() => truncateAll(pool));

  async function sample(over: Partial<Submission> = {}): Promise<Submission> {
    const { formId, versionId } = await seedPublishedForm(pool);
    const at = new Date("2026-10-10T12:00:00.000Z");
    return {
      id: randomUUID(),
      formId,
      versionId,
      locale: "es",
      answers: { f_name: "Ana Prueba" },
      consent: { fieldKey: "f_consent", textVersion: "0123456789abcdef", acceptedAt: at },
      receivedAt: at,
      reference: "ST-0001",
      submitToken: randomUUID(),
      ...over,
    };
  }

  it("inserts, finds by id and by submit token", async () => {
    const submission = await sample();
    expect(await uow.run((u) => repo.insert(u, submission))).toBe("inserted");
    expect(await repo.findById(submission.id)).toEqual(submission);
    expect(await repo.findBySubmitToken(submission.submitToken)).toEqual(submission);
    expect(await repo.findBySubmitToken("nope")).toBeNull();
    expect(await repo.findById("nope")).toBeNull();
  });

  it("stores a submission without consent", async () => {
    const submission = await sample({ consent: null });
    await uow.run((u) => repo.insert(u, submission));
    expect(await repo.findById(submission.id)).toEqual(submission);
  });

  it("reports a repeated submit token without aborting the transaction", async () => {
    const first = await sample();
    const second = { ...first, id: randomUUID(), reference: "ST-0002" };
    await uow.run(async (u) => {
      expect(await repo.insert(u, first)).toBe("inserted");
      expect(await repo.insert(u, second)).toBe("duplicate_token");
      expect(await repo.findById(first.id)).toBeNull();
    });
    expect(await repo.findById(first.id)).toEqual(first);
    expect(await repo.findById(second.id)).toBeNull();
  });

  it("refuses any change to answers, but not to the status", async () => {
    const submission = await sample();
    await uow.run((u) => repo.insert(u, submission));
    await expect(
      pool.query("update submission set answers = '{}' where id = $1", [submission.id]),
    ).rejects.toThrow(/immutable/);
    await pool.query("update submission set status = 'viewed' where id = $1", [submission.id]);
    expect(await repo.findById(submission.id)).toEqual(submission);
  });
});
