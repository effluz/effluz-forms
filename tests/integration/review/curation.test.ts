import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditLog } from "@/modules/identity/application";
import { revertCorrection, saveCorrection, type ReviewDeps } from "@/modules/review/application";
import { OWNER } from "@/modules/review/application/testing/fixtures";
import { testPool, truncateAll } from "../db";
import { seedStoredStory } from "./factories";
import { pgReviewDeps } from "./wiring";

describe("curation in Postgres", () => {
  const pool = testPool();
  let dir: string;
  beforeEach(async () => {
    await truncateAll(pool);
    dir = await mkdtemp(path.join(os.tmpdir(), "effluz-curation-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const deps = (): ReviewDeps =>
    pgReviewDeps(pool, { staging: path.join(dir, "staging"), durable: path.join(dir, "durable") });

  /** Everything a correction may write for the submission, as text. */
  async function curationState(submissionId: string) {
    const { rows } = await pool.query<Record<string, unknown>>(
      `select s.answers::text as answers, s.status, s.curated_answers::text as curated,
              s.status_changed_by, s.status_changed_at,
              (select count(*)::int from submission_edit e where e.submission_id = s.id) as edits,
              (select row_to_json(t)::text from story t where t.submission_id = s.id) as story,
              (select count(*)::int from audit_log a where a.target_id = s.id::text) as audits
         from submission s where s.id = $1`,
      [submissionId],
    );
    return rows[0];
  }

  async function answersText(submissionId: string): Promise<string | undefined> {
    const { rows } = await pool.query<{ answers: string }>(
      "select answers::text as answers from submission where id = $1",
      [submissionId],
    );
    return rows[0]?.answers;
  }

  it("corrections never change answers in Postgres", async () => {
    const review = deps();
    const { formId, submissionId, reference } = await seedStoredStory(pool, {
      answers: { f_name: "Ana Prueba", f_baby: "no_opt" },
      status: "viewed",
    });
    const target = { formId, reference, fieldKey: "f_name" };
    const before = await answersText(submissionId);
    expect(before).toBeDefined();

    for (const text of ["Ana  Prueba", "Ana Prueba."]) {
      expect(await saveCorrection(review, OWNER, { ...target, text })).toEqual({
        ok: true,
        changed: true,
      });
      expect(await revertCorrection(review, OWNER, target)).toEqual({ ok: true });
    }

    expect(await answersText(submissionId)).toBe(before);
    const { rows } = await pool.query<{ status: string; curated: string; edits: number }>(
      `select s.status, s.curated_answers::text as curated,
              (select count(*)::int from submission_edit e where e.submission_id = s.id) as edits
         from submission s where s.id = $1`,
      [submissionId],
    );
    expect(rows[0]).toEqual({ status: "viewed", curated: "{}", edits: 2 });
  });

  it("a refused correction writes nothing in Postgres", async () => {
    const { formId, submissionId, reference } = await seedStoredStory(pool, {
      answers: { f_name: "Ana Prueba", f_baby: "no_opt" },
      status: "viewed",
    });
    const before = await curationState(submissionId);
    const target = { formId, reference };

    expect(
      await saveCorrection(deps(), OWNER, { ...target, fieldKey: "f_name", text: "  " }),
    ).toEqual({ ok: false, code: "correction_blank" });
    expect(
      await saveCorrection(deps(), OWNER, {
        ...target,
        fieldKey: "f_name",
        text: "x".repeat(5001),
      }),
    ).toEqual({ ok: false, code: "correction_too_long", max: 5000 });
    expect(
      await saveCorrection(deps(), OWNER, { ...target, fieldKey: "f_baby", text: "Sí" }),
    ).toEqual({ ok: false, code: "not_curatable" });
    expect(await revertCorrection(deps(), OWNER, { ...target, fieldKey: "f_name" })).toEqual({
      ok: false,
      code: "not_corrected",
    });

    expect(await curationState(submissionId)).toEqual(before);
    expect(before?.story).toBeNull();
  });

  it("a correction whose unit of work fails leaves nothing behind", async () => {
    const { formId, submissionId, reference } = await seedStoredStory(pool, {
      answers: { f_name: "Ana Prueba", f_baby: "no_opt" },
      status: "viewed",
    });
    const before = await curationState(submissionId);
    const real = deps();
    // The last write of the unit of work fails, after the edit, curation and story writes.
    const failing: AuditLog = {
      record: (uow, entry, at) =>
        entry.action === "story_check_changed"
          ? Promise.reject(new Error("injected audit failure"))
          : real.audit.record(uow, entry, at),
    };

    await expect(
      saveCorrection({ ...real, audit: failing }, OWNER, {
        formId,
        reference,
        fieldKey: "f_name",
        text: "Ana  Prueba",
      }),
    ).rejects.toThrow("injected audit failure");

    expect(await curationState(submissionId)).toEqual(before);
  });
});
