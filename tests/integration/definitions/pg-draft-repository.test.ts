import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { PgDraftRepository } from "@/modules/definitions/infrastructure/pg-draft-repository";
import { PgFormRepository } from "@/modules/definitions/infrastructure/pg-form-repository";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll, waitForLockWaiters } from "../db";
import { sampleDraft, sampleForm } from "./factories";

describe("PgDraftRepository", () => {
  const pool = testPool();
  const uowf = new PgUnitOfWorkFactory(pool);
  const forms = new PgFormRepository(pool);
  const repo = new PgDraftRepository(pool);
  beforeEach(() => truncateAll(pool));

  async function formWithDraft() {
    const form = sampleForm();
    const draft = sampleDraft(form.id, { en: "First" });
    await uowf.run(async (uow) => {
      await forms.insert(uow, form);
      await repo.insert(uow, draft);
    });
    return { form, draft };
  }

  it("inserts a draft and finds it with its document and audit fields", async () => {
    const { draft } = await formWithDraft();
    expect(await repo.find(draft.formId)).toEqual(draft);
  });

  it("returns null for a form without a draft or a malformed id", async () => {
    expect(await repo.find(randomUUID())).toBeNull();
    expect(await repo.find("not-a-uuid")).toBeNull();
  });

  it("saves with the expected revision and bumps it", async () => {
    const { draft } = await formWithDraft();
    const edited = {
      ...draft,
      document: { ...draft.document, title: { en: "Edited" } },
      updatedBy: "other@example.com",
      updatedAt: new Date("2026-10-10T12:05:00.000Z"),
      auditedBy: "other@example.com",
      auditedAt: new Date("2026-10-10T12:05:00.000Z"),
    };
    expect(await uowf.run((uow) => repo.save(uow, edited, 1))).toBe("saved");
    const found = await repo.find(draft.formId);
    expect(found?.revision).toBe(2);
    expect(found?.document.title).toEqual({ en: "Edited" });
    expect(found?.updatedBy).toBe("other@example.com");
    expect(found?.updatedAt).toEqual(edited.updatedAt);
    expect(found?.auditedAt).toEqual(edited.auditedAt);
  });

  it("returns stale for a wrong revision and changes nothing", async () => {
    const { draft } = await formWithDraft();
    const edited = { ...draft, document: { ...draft.document, title: { en: "Edited" } } };
    expect(await uowf.run((uow) => repo.save(uow, edited, 7))).toBe("stale");
    expect(await repo.find(draft.formId)).toEqual(draft);
  });

  it("finds the draft for update inside a unit of work, or null", async () => {
    const { draft } = await formWithDraft();
    expect(await uowf.run((uow) => repo.findForUpdate(uow, draft.formId))).toEqual(draft);
    expect(await uowf.run((uow) => repo.findForUpdate(uow, randomUUID()))).toBeNull();
    expect(await uowf.run((uow) => repo.findForUpdate(uow, "not-a-uuid"))).toBeNull();
  });

  it("holds the draft row until the locking unit of work commits", async () => {
    const { draft } = await formWithDraft();
    const first = await uowf.begin();
    try {
      await repo.findForUpdate(first, draft.formId);

      let secondRead = false;
      const second = uowf.run(async (uow) => {
        const found = await repo.findForUpdate(uow, draft.formId);
        secondRead = true;
        return found;
      });
      await waitForLockWaiters(pool);
      expect(secondRead).toBe(false);

      const edited = { ...draft, document: { ...draft.document, title: { en: "Edited" } } };
      expect(await repo.save(first, edited, draft.revision)).toBe("saved");
      await first.commit();
      const seen = await second;
      expect(seen?.revision).toBe(draft.revision + 1);
      expect(seen?.document.title).toEqual({ en: "Edited" });
    } finally {
      // A failed assertion must not leave the lock (and the next truncate) waiting.
      await first.rollback().catch(() => undefined);
    }
  });

  it("is removed with its form", async () => {
    const { form } = await formWithDraft();
    await uowf.run((uow) => forms.delete(uow, form.id));
    expect(await repo.find(form.id)).toBeNull();
  });

  it("throws when the stored document is not a valid version", async () => {
    const { draft } = await formWithDraft();
    await pool.query(
      `update form_draft set document = '{"nope": true}'::jsonb where form_id = $1`,
      [draft.formId],
    );
    await expect(repo.find(draft.formId)).rejects.toThrow(/corrupt/i);
  });
});
