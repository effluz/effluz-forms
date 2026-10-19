import { describe, expect, it } from "vitest";
import { fakeImage } from "@/modules/media/application/testing/fakes";
import { htmlPretendingToBeJpeg, syntheticMp4 } from "../../../../tests/fakes/media-files";
import { reviewAuditActions } from "../domain/audit";
import { EMPTY_QUERY } from "../domain/list-query";
import { MAX_STAFF_PHOTOS, STAFF_PHOTOS_FIELD_KEY } from "../domain/staff-photos";
import { setCheck } from "./checks";
import { openStory } from "./open-story";
import { addStaffPhotos, choosePhoto, removeStaffPhoto } from "./photos";
import { OWNER, seedAnotherStory, seedStory } from "./testing/fixtures";
import { makeReviewDeps, type FakeReviewDeps } from "./testing/fakes";

type Seeded = Awaited<ReturnType<typeof seedStory>>;

const add = (
  deps: FakeReviewDeps,
  formId: string,
  files: readonly Uint8Array[],
  over: { source?: string; senderConfirmed?: boolean; reference?: string } = {},
) =>
  addStaffPhotos(deps, OWNER, {
    formId,
    reference: over.reference ?? "ST-0001",
    files,
    source: over.source ?? "whatsapp",
    senderConfirmed: over.senderConfirmed ?? true,
  });

const choose = (deps: FakeReviewDeps, formId: string, mediaId: string, chosen: boolean) =>
  choosePhoto(deps, OWNER, { formId, reference: "ST-0001", mediaId, chosen });

const remove = (deps: FakeReviewDeps, formId: string, mediaId: string) =>
  removeStaffPhoto(deps, OWNER, { formId, reference: "ST-0001", mediaId });

const auditOf = (deps: FakeReviewDeps, action: string) =>
  deps.audit.entries.filter((e) => e.entry.action === action).map((e) => e.entry);

/** The entries this module wrote: seeding the form writes definitions' own. */
const reviewAudit = (deps: FakeReviewDeps) =>
  deps.audit.entries.filter((e) =>
    (reviewAuditActions as readonly string[]).includes(e.entry.action),
  );

const staffMedia = (deps: FakeReviewDeps, submissionId: string) =>
  [...deps.media.media.rows.values()]
    .filter((m) => m.submissionId === submissionId && m.fieldKey === STAFF_PHOTOS_FIELD_KEY)
    .sort((a, b) => a.position - b.position);

const stagingKeys = (deps: FakeReviewDeps) => [...deps.media.staging.files.keys()].sort();

const hex = (id: string) => id.replace(/-/g, "").slice(0, 8);

/** Adds one staff photo and answers its media id. */
async function addOne(deps: FakeReviewDeps, story: Seeded): Promise<string> {
  expect(await add(deps, story.formId, [fakeImage()])).toEqual({ ok: true, added: 1 });
  const last = staffMedia(deps, story.submissionId).at(-1);
  if (!last) throw new Error("no staff photo was added");
  return last.id;
}

const readinessOf = async (deps: FakeReviewDeps, formId: string) =>
  (await openStory(deps, OWNER, { formId, reference: "ST-0001", query: EMPTY_QUERY }))?.readiness;

describe("addStaffPhotos", () => {
  it("adds staff photos as media of the story with staff keys and upload jobs", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    const answersBefore = JSON.stringify(
      deps.submissions.submissions.rows.get(story.submissionId)?.answers,
    );

    expect(await add(deps, story.formId, [fakeImage(), fakeImage()])).toEqual({
      ok: true,
      added: 2,
    });

    const rows = staffMedia(deps, story.submissionId);
    expect(rows.map((m) => [m.fieldKey, m.position, m.kind, m.status])).toEqual([
      ["staff-photos", 1, "image", "staged"],
      ["staff-photos", 2, "image", "staged"],
    ]);
    const [first, second] = rows;
    if (!first || !second) throw new Error("two rows expected");
    expect(first.durableKey).toBe(`forms/story-form/ST-0001/staff-01-${hex(first.id)}.jpg`);
    expect(second.durableKey).toBe(`forms/story-form/ST-0001/staff-02-${hex(second.id)}.jpg`);
    expect(deps.media.queue.ofType("media.upload").map((j) => j.payload)).toEqual([
      { mediaId: first.id },
      { mediaId: second.id },
    ]);
    const staffRows = await deps.staffPhotos.listBySubmission(story.submissionId);
    expect(staffRows.map((r) => [r.id, r.source, r.addedBy])).toEqual([
      [first.id, "whatsapp", "owner@example.com"],
      [second.id, "whatsapp", "owner@example.com"],
    ]);
    expect(auditOf(deps, "staff_photos_added")).toEqual([
      {
        action: "staff_photos_added",
        actorEmail: OWNER.email,
        targetId: story.submissionId,
        ip: OWNER.ip,
        details: { count: 2, source: "whatsapp", senderConfirmed: true },
      },
    ]);
    expect(JSON.stringify(deps.submissions.submissions.rows.get(story.submissionId)?.answers)).toBe(
      answersBefore,
    );
  });

  it("continues positions after earlier staff photos", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    await add(deps, story.formId, [fakeImage(), fakeImage()]);

    expect(await add(deps, story.formId, [fakeImage()])).toEqual({ ok: true, added: 1 });

    const third = staffMedia(deps, story.submissionId)[2];
    expect(third?.position).toBe(3);
    expect(third?.durableKey).toBe(`forms/story-form/ST-0001/staff-03-${hex(third?.id ?? "")}.jpg`);
  });

  it("accepts a video", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);

    expect(await add(deps, story.formId, [syntheticMp4()])).toEqual({ ok: true, added: 1 });

    const [video] = staffMedia(deps, story.submissionId);
    expect(video?.kind).toBe("video");
    expect(video?.durableKey).toMatch(/^forms\/story-form\/ST-0001\/staff-01-[0-9a-f]{8}\.mp4$/);
  });

  it("refuses in this order", async () => {
    const cases: {
      code: string;
      seed?: { postPlan?: boolean; laterPhotos?: boolean };
      prepare?: (deps: FakeReviewDeps, story: Seeded) => void;
      files?: Uint8Array[];
      over?: { source?: string; senderConfirmed?: boolean; reference?: string };
    }[] = [
      { code: "not_found", over: { reference: "ST-9999" } },
      { code: "post_plan_off", seed: { postPlan: false } },
      { code: "consent_missing", seed: { laterPhotos: false } },
      { code: "not_confirmed", over: { senderConfirmed: false } },
      { code: "source_invalid", over: { source: "sms" } },
      { code: "no_files", files: [] },
      { code: "too_many_files", files: Array.from({ length: 11 }, () => fakeImage()) },
      {
        code: "staff_photos_max",
        files: [fakeImage(), fakeImage()],
        prepare: (deps, story) => {
          for (let n = 0; n < 29; n += 1) {
            const id = deps.ids.newId();
            deps.staffPhotos.rows.set(id, {
              id,
              submissionId: story.submissionId,
              source: "email",
              addedBy: OWNER.email,
              createdAt: deps.clock.now(),
            });
          }
        },
      },
    ];
    for (const c of cases) {
      const deps = makeReviewDeps();
      const story = await seedStory(deps, c.seed ?? {});
      c.prepare?.(deps, story);
      const staged = stagingKeys(deps);

      expect(await add(deps, story.formId, c.files ?? [fakeImage()], c.over ?? {})).toEqual({
        ok: false,
        code: c.code,
      });

      expect(stagingKeys(deps)).toEqual(staged);
      expect(staffMedia(deps, story.submissionId)).toEqual([]);
      expect(deps.media.queue.enqueued).toEqual([]);
      expect(reviewAudit(deps)).toEqual([]);
    }
  });

  it("is all or nothing when one file is refused", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    const staged = stagingKeys(deps);

    expect(
      await add(deps, story.formId, [fakeImage(), htmlPretendingToBeJpeg(), fakeImage()]),
    ).toEqual({ ok: false, code: "file_refused", file: 2, reason: "file_wrong_type" });

    expect(stagingKeys(deps)).toEqual(staged);
    expect(staffMedia(deps, story.submissionId)).toEqual([]);
    expect(deps.staffPhotos.rows.size).toBe(0);
    expect(deps.media.queue.enqueued).toEqual([]);
    expect(reviewAudit(deps)).toEqual([]);
  });

  it("stays a refusal when discarding the staged files fails", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    deps.media.staging.deletePrefix = () => Promise.reject(new Error("storage unavailable"));

    expect(await add(deps, story.formId, [htmlPretendingToBeJpeg()])).toEqual({
      ok: false,
      code: "file_refused",
      file: 1,
      reason: "file_wrong_type",
    });

    // Staged, then refused under the lock: the story filled up after the first look.
    const full = Array.from({ length: MAX_STAFF_PHOTOS }, (_, i) => ({
      id: `staff-${String(i)}`,
      submissionId: story.submissionId,
      source: "whatsapp" as const,
      addedBy: OWNER.email,
      createdAt: deps.clock.now(),
    }));
    let reads = 0;
    deps.staffPhotos.listBySubmission = () => Promise.resolve(reads++ === 0 ? [] : full);
    expect(await add(deps, story.formId, [fakeImage()])).toEqual({
      ok: false,
      code: "staff_photos_max",
    });
  });

  it("discards staged files when the unit of work fails", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    const staged = stagingKeys(deps);
    deps.media.queue.failAt = 0;

    await expect(add(deps, story.formId, [fakeImage(), fakeImage()])).rejects.toThrow(
      "injected enqueue failure",
    );

    expect(stagingKeys(deps)).toEqual(staged);
  });
});

describe("removeStaffPhoto", () => {
  it("removes a staff photo, its choice and its file", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    const s1 = await addOne(deps, story);
    await choose(deps, story.formId, s1, true);

    expect(await remove(deps, story.formId, s1)).toEqual({ ok: true });

    expect(deps.staffPhotos.rows.has(s1)).toBe(false);
    expect(deps.stories.rows.get(story.submissionId)?.chosen).toEqual([]);
    expect(deps.media.queue.ofType("media.delete").map((j) => j.payload)).toEqual([
      { mediaId: s1 },
    ]);
    expect(auditOf(deps, "staff_photo_removed")).toEqual([
      {
        action: "staff_photo_removed",
        actorEmail: OWNER.email,
        targetId: story.submissionId,
        ip: OWNER.ip,
        details: { mediaId: s1 },
      },
    ]);
    const [p1] = story.photoIds;
    expect(await remove(deps, story.formId, p1)).toEqual({ ok: false, code: "not_found" });
    expect(deps.media.queue.ofType("media.delete")).toHaveLength(1);
  });

  it("removes a staff photo on a form whose post plan is off", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    const s1 = await addOne(deps, story);
    const form = deps.definitions.store.forms.get(story.formId);
    if (!form) throw new Error("the form is seeded");
    deps.definitions.store.forms.set(story.formId, {
      ...form,
      settings: { ...form.settings, usePostPlan: false },
    });

    expect(await remove(deps, story.formId, s1)).toEqual({ ok: true });

    expect(deps.staffPhotos.rows.has(s1)).toBe(false);
    expect(deps.media.queue.ofType("media.delete").map((j) => j.payload)).toEqual([
      { mediaId: s1 },
    ]);
    expect(auditOf(deps, "staff_photo_removed")).toHaveLength(1);
  });

  it("removing a chosen staff photo unsets photos edited", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    const [p1] = story.photoIds;
    const s1 = await addOne(deps, story);
    await choose(deps, story.formId, s1, true);
    await setCheck(deps, OWNER, {
      formId: story.formId,
      reference: "ST-0001",
      check: "photos_edited",
      value: true,
    });

    await remove(deps, story.formId, s1);

    expect(await readinessOf(deps, story.formId)).toMatchObject({
      photosChosen: false,
      photosEdited: false,
    });
    expect(auditOf(deps, "story_check_changed").at(-1)?.details).toEqual({
      check: "photos_edited",
      value: false,
      automatic: true,
    });

    const s2 = await addOne(deps, story);
    await choose(deps, story.formId, p1, true);
    await choose(deps, story.formId, s2, true);
    await setCheck(deps, OWNER, {
      formId: story.formId,
      reference: "ST-0001",
      check: "photos_edited",
      value: true,
    });

    await remove(deps, story.formId, s2);

    expect(await readinessOf(deps, story.formId)).toMatchObject({
      photosChosen: true,
      photosEdited: false,
    });
  });
});

describe("choosePhoto", () => {
  it("chooses and unchooses a photo", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    const [p1] = story.photoIds;

    expect(await choose(deps, story.formId, p1, true)).toEqual({ ok: true });
    expect(deps.stories.rows.get(story.submissionId)?.chosen).toEqual([p1]);
    expect(auditOf(deps, "photo_choice_changed")).toEqual([
      {
        action: "photo_choice_changed",
        actorEmail: OWNER.email,
        targetId: story.submissionId,
        ip: OWNER.ip,
        details: { mediaId: p1, chosen: true },
      },
    ]);

    expect(await choose(deps, story.formId, p1, true)).toEqual({ ok: true });
    expect(auditOf(deps, "photo_choice_changed")).toHaveLength(1);

    expect(await choose(deps, story.formId, p1, false)).toEqual({ ok: true });
    expect(deps.stories.rows.get(story.submissionId)?.chosen).toEqual([]);
    expect(auditOf(deps, "photo_choice_changed").at(-1)?.details).toEqual({
      mediaId: p1,
      chosen: false,
    });

    const other = await seedAnotherStory(deps, story.formId);
    const foreign = deps.ids.newId();
    const template = deps.media.media.rows.get(p1);
    if (!template) throw new Error("p1 is seeded");
    deps.media.media.rows.set(foreign, {
      ...template,
      id: foreign,
      submissionId: other.submissionId,
    });
    expect(await choose(deps, story.formId, foreign, true)).toEqual({
      ok: false,
      code: "not_found",
    });

    const off = makeReviewDeps();
    const offStory = await seedStory(off, { postPlan: false });
    expect(await choose(off, offStory.formId, offStory.photoIds[0], true)).toEqual({
      ok: false,
      code: "post_plan_off",
    });
  });

  it("stores the chosen set sorted, so choosing in another order keeps photos edited", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    const [p1, p2] = story.photoIds;
    await choose(deps, story.formId, p2, true);
    await choose(deps, story.formId, p1, true);
    expect(deps.stories.rows.get(story.submissionId)?.chosen).toEqual([p1, p2]);
    await setCheck(deps, OWNER, {
      formId: story.formId,
      reference: "ST-0001",
      check: "photos_edited",
      value: true,
    });
    expect(deps.stories.rows.get(story.submissionId)?.photosEditedFor).toEqual([p1, p2]);
    expect(await readinessOf(deps, story.formId)).toMatchObject({ photosEdited: true });

    // p1 unchosen and chosen again comes after p2 in choosing order; the set is the same.
    await choose(deps, story.formId, p1, false);
    await choose(deps, story.formId, p1, true);
    expect(deps.stories.rows.get(story.submissionId)?.chosen).toEqual([p1, p2]);
    expect(await readinessOf(deps, story.formId)).toMatchObject({ photosEdited: true });
  });
});
