import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Curation, Submission } from "@/modules/submissions/domain/submission";
import { PgSubmissionRepository } from "@/modules/submissions/infrastructure/pg-submission-repository";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll, waitForLockWaiters } from "../db";
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

  it("finds by submit token inside a unit of work, on its connection", async () => {
    const submission = await sample();
    await uow.run(async (u) => {
      await repo.insert(u, submission);
      expect(await repo.findBySubmitToken(submission.submitToken, u)).toEqual(submission);
      expect(await repo.findBySubmitToken(submission.submitToken)).toBeNull();
    });
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
      // The transaction still answers queries, and sees its own uncommitted insert.
      expect(await repo.findBySubmitToken(first.submitToken, u)).toEqual(first);
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
    const { rows } = await pool.query<{ status: string }>(
      "select status from submission where id = $1",
      [submission.id],
    );
    expect(rows[0]?.status).toBe("viewed");
    expect(await repo.findById(submission.id)).toEqual(submission);
  });

  it("reads and writes curation columns, and the trigger still guards answers", async () => {
    const submission = await sample();
    await uow.run((u) => repo.insert(u, submission));
    const curation: Curation = {
      status: "edited",
      curatedAnswers: { f_name: "Ana" },
      publishedPostUrl: null,
      statusChangedBy: "editor@example.com",
      statusChangedAt: new Date("2026-10-11T08:00:00.000Z"),
    };
    await uow.run((u) => repo.writeCuration(u, submission.id, curation));

    await expect(
      pool.query("update submission set answers = '{}' where id = $1", [submission.id]),
    ).rejects.toThrow(/submission answers are immutable/);
    const found = await repo.findByReference(submission.formId, submission.reference);
    expect(found).toEqual({ ...submission, curation });
    expect(await repo.findStored(submission.id)).toEqual({ ...submission, curation });
  });

  it("starts every stored submission as new with no corrections", async () => {
    const submission = await sample();
    await uow.run((u) => repo.insert(u, submission));
    expect((await repo.findStored(submission.id))?.curation).toEqual({
      status: "new",
      curatedAnswers: {},
      publishedPostUrl: null,
      statusChangedBy: null,
      statusChangedAt: null,
    });
    expect(await repo.findStored("nope")).toBeNull();
  });

  it("locks the row for the unit of work", async () => {
    const submission = await sample();
    await uow.run((u) => repo.insert(u, submission));
    const first = await uow.begin();
    try {
      expect((await repo.lockForUpdate(first, submission.id))?.id).toBe(submission.id);

      let secondRead = false;
      const second = uow.run(async (u) => {
        const found = await repo.lockForUpdate(u, submission.id);
        secondRead = true;
        return found;
      });
      await waitForLockWaiters(pool);
      expect(secondRead).toBe(false);

      await repo.writeCuration(first, submission.id, {
        status: "viewed",
        curatedAnswers: {},
        publishedPostUrl: null,
        statusChangedBy: "editor@example.com",
        statusChangedAt: new Date("2026-10-11T08:00:00.000Z"),
      });
      await first.commit();
      expect((await second)?.curation.status).toBe("viewed");
    } finally {
      // A failed assertion must not leave the lock (and the next truncate) waiting.
      await first.rollback().catch(() => undefined);
    }
    expect(await uow.run((u) => repo.lockForUpdate(u, randomUUID()))).toBeNull();
    expect(await uow.run((u) => repo.lockForUpdate(u, "nope"))).toBeNull();
  });

  it("finds by reference within the form only", async () => {
    const submission = await sample();
    await uow.run((u) => repo.insert(u, submission));
    const other = await sample({ id: randomUUID(), submitToken: randomUUID() });
    await uow.run((u) => repo.insert(u, other));
    expect((await repo.findByReference(submission.formId, "ST-0001"))?.id).toBe(submission.id);
    expect((await repo.findByReference(other.formId, "ST-0001"))?.id).toBe(other.id);
    expect(await repo.findByReference(submission.formId, "ST-0002")).toBeNull();
    expect(await repo.findByReference("not-a-uuid", "ST-0001")).toBeNull();
  });

  it("deletes a submission and reports whether a row went", async () => {
    const submission = await sample();
    await uow.run((u) => repo.insert(u, submission));
    expect(await uow.run((u) => repo.delete(u, submission.id))).toBe(true);
    expect(await repo.findById(submission.id)).toBeNull();
    expect(await uow.run((u) => repo.delete(u, submission.id))).toBe(false);
    expect(await uow.run((u) => repo.delete(u, "nope"))).toBe(false);
  });
});
