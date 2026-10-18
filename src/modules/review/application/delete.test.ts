import { describe, expect, it } from "vitest";
import { fakeImage } from "@/modules/media/application/testing/fakes";
import { reviewAuditActions } from "../domain/audit";
import { STAFF_PHOTOS_FIELD_KEY } from "../domain/staff-photos";
import { saveCorrection } from "./curation";
import { deleteStory } from "./delete";
import { addStaffPhotos } from "./photos";
import { OWNER, seedStory } from "./testing/fixtures";
import { makeReviewDeps, type FakeReviewDeps } from "./testing/fakes";

const reviewAudit = (deps: FakeReviewDeps) =>
  deps.audit.entries
    .filter((e) => (reviewAuditActions as readonly string[]).includes(e.entry.action))
    .map((e) => e.entry);

/** A story with a staff photo, a correction and a story row. */
async function seedFullStory(deps: FakeReviewDeps) {
  const story = await seedStory(deps);
  const target = { formId: story.formId, reference: story.reference };
  expect(
    await addStaffPhotos(deps, OWNER, {
      ...target,
      files: [fakeImage()],
      source: "email",
      senderConfirmed: true,
    }),
  ).toEqual({ ok: true, added: 1 });
  expect(
    await saveCorrection(deps, OWNER, { ...target, fieldKey: "f_name", text: "Ana Corregida" }),
  ).toMatchObject({ ok: true });
  const staff = [...deps.media.media.rows.values()].find(
    (m) => m.submissionId === story.submissionId && m.fieldKey === STAFF_PHOTOS_FIELD_KEY,
  );
  if (!staff) throw new Error("no staff photo was added");
  return { ...story, target, staffId: staff.id };
}

const deleteJobs = (deps: FakeReviewDeps) =>
  deps.media.queue
    .ofType("media.delete")
    .map((j) => String(j.payload.mediaId))
    .sort();

describe("deleteStory", () => {
  it("deletes after the typed reference matches", async () => {
    const deps = makeReviewDeps();
    const story = await seedFullStory(deps);
    const id = story.submissionId;
    const before = reviewAudit(deps).length;

    expect(await deleteStory(deps, OWNER, { ...story.target, typed: " st-0001 " })).toEqual({
      ok: true,
    });

    expect(deps.submissions.submissions.rows.has(id)).toBe(false);
    expect(deleteJobs(deps)).toEqual([...story.photoIds, story.staffId].sort());
    // The database cascade: review state goes with the submission.
    expect(deps.stories.rows.has(id)).toBe(false);
    expect([...deps.staffPhotos.rows.values()].filter((r) => r.submissionId === id)).toEqual([]);
    expect(deps.edits.rows.filter((r) => r.submissionId === id)).toEqual([]);
    expect(reviewAudit(deps).slice(before)).toEqual([
      {
        action: "submission_deleted",
        actorEmail: OWNER.email,
        targetId: id,
        ip: OWNER.ip,
        details: { reference: "ST-0001" },
      },
    ]);
  });

  it("refuses a mismatch and keeps everything", async () => {
    const deps = makeReviewDeps();
    const story = await seedFullStory(deps);
    const id = story.submissionId;
    const before = reviewAudit(deps).length;

    expect(await deleteStory(deps, OWNER, { ...story.target, typed: "ST-0002" })).toEqual({
      ok: false,
      code: "reference_mismatch",
    });

    expect(deps.submissions.submissions.rows.has(id)).toBe(true);
    expect(deleteJobs(deps)).toEqual([]);
    expect(deps.stories.rows.has(id)).toBe(true);
    expect(deps.staffPhotos.rows.has(story.staffId)).toBe(true);
    expect(deps.edits.rows.some((r) => r.submissionId === id)).toBe(true);
    expect(reviewAudit(deps)).toHaveLength(before);
  });
});
