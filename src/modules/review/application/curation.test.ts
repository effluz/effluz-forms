import { describe, expect, it } from "vitest";
import { reviewAuditActions } from "../domain/audit";
import { revertCorrection, saveCorrection } from "./curation";
import { OWNER, seedStory } from "./testing/fixtures";
import { makeReviewDeps, type FakeReviewDeps } from "./testing/fakes";

const save = (deps: FakeReviewDeps, formId: string, fieldKey: string, text: string) =>
  saveCorrection(deps, OWNER, { formId, reference: "ST-0001", fieldKey, text });

const revert = (deps: FakeReviewDeps, formId: string, fieldKey: string) =>
  revertCorrection(deps, OWNER, { formId, reference: "ST-0001", fieldKey });

const curationOf = (deps: FakeReviewDeps, submissionId: string) =>
  deps.submissions.submissions.curation.get(submissionId);

/** The entries this module wrote: seeding the form writes definitions' own. */
const reviewAudit = (deps: FakeReviewDeps) =>
  deps.audit.entries.filter((e) =>
    (reviewAuditActions as readonly string[]).includes(e.entry.action),
  );

const auditOf = (deps: FakeReviewDeps, action: string) =>
  deps.audit.entries.filter((e) => e.entry.action === action).map((e) => e.entry);

describe("saveCorrection", () => {
  it("saves a correction, marks the story edited and ticks text checked", async () => {
    const deps = makeReviewDeps();
    const { formId, submissionId } = await seedStory(deps, { status: "viewed" });

    const result = await save(deps, formId, "f_name", "Ana  Prueba");

    expect(result).toEqual({ ok: true, changed: true });
    const curation = curationOf(deps, submissionId);
    expect(curation?.status).toBe("edited");
    expect(curation?.curatedAnswers.f_name).toBe("Ana  Prueba");
    expect(curation?.statusChangedBy).toBe("owner@example.com");
    expect(curation?.statusChangedAt).toEqual(deps.clock.now());
    expect(deps.edits.rows).toHaveLength(1);
    expect(deps.edits.rows[0]).toMatchObject({
      submissionId,
      fieldKey: "f_name",
      text: "Ana  Prueba",
      source: "manual",
      editor: OWNER.email,
    });
    const story = deps.stories.rows.get(submissionId);
    expect(story?.textCheckedAt).toEqual(deps.clock.now());
    expect(story?.textCheckedBy).toBe(OWNER.email);
    expect(auditOf(deps, "submission_edited")).toEqual([
      {
        action: "submission_edited",
        actorEmail: OWNER.email,
        targetId: submissionId,
        ip: OWNER.ip,
        details: { fieldKey: "f_name", source: "manual" },
      },
    ]);
    expect(auditOf(deps, "story_check_changed")).toEqual([
      {
        action: "story_check_changed",
        actorEmail: OWNER.email,
        targetId: submissionId,
        ip: OWNER.ip,
        details: { check: "text_checked", value: true, by: "correction" },
      },
    ]);
  });

  it("keeps a published story published", async () => {
    const deps = makeReviewDeps();
    const { formId, submissionId } = await seedStory(deps, { status: "published" });

    expect(await save(deps, formId, "f_name", "Ana  Prueba")).toEqual({ ok: true, changed: true });

    const curation = curationOf(deps, submissionId);
    expect(curation?.status).toBe("published");
    expect(curation?.statusChangedBy).toBeNull();
    expect(curation?.curatedAnswers.f_name).toBe("Ana  Prueba");
  });

  it("saving the original text stores no correction", async () => {
    const deps = makeReviewDeps();
    const { formId, submissionId } = await seedStory(deps, { status: "viewed" });

    expect(await save(deps, formId, "f_name", "Ana Prueba")).toEqual({ ok: true, changed: false });

    expect(deps.edits.rows).toEqual([]);
    expect(curationOf(deps, submissionId)?.status).toBe("viewed");
    expect(curationOf(deps, submissionId)?.curatedAnswers).toEqual({});
    expect(auditOf(deps, "submission_edited")).toEqual([]);
    expect(deps.stories.rows.get(submissionId)?.textCheckedAt).toEqual(deps.clock.now());
    expect(auditOf(deps, "story_check_changed")).toHaveLength(1);
  });

  it("normalizes a correction as its field type normalizes an answer on receipt", async () => {
    const deps = makeReviewDeps();
    const { formId, submissionId } = await seedStory(deps, { status: "viewed" });

    // A single-line field collapses line breaks and trims, as it did for the original.
    expect(await save(deps, formId, "f_name", " Ana\r\n  María Prueba\n")).toEqual({
      ok: true,
      changed: true,
    });
    expect(curationOf(deps, submissionId)?.curatedAnswers.f_name).toBe("Ana María Prueba");
    expect(deps.edits.rows.map((r) => r.text)).toEqual(["Ana María Prueba"]);

    expect(await save(deps, formId, "f_name", "Ana Prueba\n")).toEqual({
      ok: true,
      changed: false,
    });
    expect(curationOf(deps, submissionId)?.curatedAnswers).toEqual({});
  });

  it("refuses fields that are not curatable or not answered", async () => {
    const deps = makeReviewDeps();
    const { formId, submissionId } = await seedStory(deps);

    expect(await save(deps, formId, "f_baby", "Sí")).toEqual({
      ok: false,
      code: "not_curatable",
    });
    expect(await save(deps, formId, "f_missing", "Hola")).toEqual({
      ok: false,
      code: "not_curatable",
    });

    const row = deps.submissions.submissions.rows.get(submissionId);
    if (!row) throw new Error("seeded story is missing");
    const answers = Object.fromEntries(
      Object.entries(row.answers).filter(([key]) => key !== "f_name"),
    );
    deps.submissions.submissions.rows.set(submissionId, { ...row, answers });

    expect(await save(deps, formId, "f_name", "Ana Prueba")).toEqual({
      ok: false,
      code: "not_answered",
    });
    expect(deps.edits.rows).toEqual([]);
    expect(reviewAudit(deps)).toEqual([]);
  });

  it("refuses blank and over-long text", async () => {
    const deps = makeReviewDeps();
    const { formId, submissionId } = await seedStory(deps, { status: "viewed" });

    expect(await save(deps, formId, "f_name", "   ")).toEqual({
      ok: false,
      code: "correction_blank",
    });
    expect(await save(deps, formId, "f_name", "x".repeat(5001))).toEqual({
      ok: false,
      code: "correction_too_long",
      max: 5000,
    });

    expect(deps.edits.rows).toEqual([]);
    expect(curationOf(deps, submissionId)?.curatedAnswers).toEqual({});
    expect(deps.stories.rows.get(submissionId)).toBeUndefined();
    expect(reviewAudit(deps)).toEqual([]);
  });

  it("a second correction on a story already checked does not tick again", async () => {
    const deps = makeReviewDeps();
    const { formId, submissionId } = await seedStory(deps, { status: "viewed" });
    await save(deps, formId, "f_name", "Ana  Prueba");
    const firstCheck = deps.stories.rows.get(submissionId)?.textCheckedAt;
    deps.clock.set(new Date("2026-10-18T16:00:00Z"));

    expect(await save(deps, formId, "f_name", "Ana Prueba.")).toEqual({ ok: true, changed: true });

    expect(auditOf(deps, "story_check_changed")).toHaveLength(1);
    expect(auditOf(deps, "submission_edited")).toHaveLength(2);
    expect(deps.stories.rows.get(submissionId)?.textCheckedAt).toEqual(firstCheck);
    expect(curationOf(deps, submissionId)?.curatedAnswers.f_name).toBe("Ana Prueba.");
  });

  it("reverts to the original and walks back the status", async () => {
    const deps = makeReviewDeps();
    const { formId, submissionId } = await seedStory(deps, { status: "viewed" });
    await save(deps, formId, "f_name", "Ana  Prueba");

    expect(await revert(deps, formId, "f_name")).toEqual({ ok: true });

    const curation = curationOf(deps, submissionId);
    expect(curation?.curatedAnswers).toEqual({});
    expect(curation?.status).toBe("viewed");
    expect(auditOf(deps, "submission_reverted")).toEqual([
      {
        action: "submission_reverted",
        actorEmail: OWNER.email,
        targetId: submissionId,
        ip: OWNER.ip,
        details: { fieldKey: "f_name" },
      },
    ]);
    expect(deps.stories.rows.get(submissionId)?.textCheckedAt).not.toBeNull();

    expect(await revert(deps, formId, "f_name")).toEqual({ ok: false, code: "not_corrected" });
  });

  it("saving the original over a correction removes it", async () => {
    const deps = makeReviewDeps();
    const { formId, submissionId } = await seedStory(deps, { status: "viewed" });
    await save(deps, formId, "f_name", "Ana  Prueba");

    expect(await save(deps, formId, "f_name", "Ana Prueba")).toEqual({ ok: true, changed: false });

    expect(curationOf(deps, submissionId)?.curatedAnswers).toEqual({});
    expect(curationOf(deps, submissionId)?.status).toBe("viewed");
    expect(deps.edits.rows).toHaveLength(1);
    expect(auditOf(deps, "submission_reverted")).toHaveLength(1);
  });

  it("answers not_found for an unknown story", async () => {
    const deps = makeReviewDeps();
    const { formId } = await seedStory(deps);

    expect(
      await saveCorrection(deps, OWNER, {
        formId,
        reference: "ST-9999",
        fieldKey: "f_name",
        text: "Hola",
      }),
    ).toEqual({ ok: false, code: "not_found" });
    expect(
      await revertCorrection(deps, OWNER, { formId, reference: "ST-9999", fieldKey: "f_name" }),
    ).toEqual({ ok: false, code: "not_found" });
  });
});
