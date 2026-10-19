import { describe, expect, it } from "vitest";
import { setCheck, type StoryCheck } from "./checks";
import { emptyStory } from "./ports/story-repository";
import { OWNER, seedStory } from "./testing/fixtures";
import { makeReviewDeps, type FakeReviewDeps } from "./testing/fakes";

const tick = (deps: FakeReviewDeps, formId: string, check: StoryCheck, value: boolean) =>
  setCheck(deps, OWNER, { formId, reference: "ST-0001", check, value });

const auditOf = (deps: FakeReviewDeps, action: string) =>
  deps.audit.entries.filter((e) => e.entry.action === action).map((e) => e.entry);

function choose(
  deps: FakeReviewDeps,
  story: { formId: string; submissionId: string },
  ids: string[],
) {
  deps.stories.rows.set(story.submissionId, {
    ...emptyStory(story.submissionId, story.formId),
    chosen: ids,
  });
}

describe("setCheck", () => {
  it("ticks photos edited for the chosen set", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    const [p1] = story.photoIds;
    choose(deps, story, [p1]);

    expect(await tick(deps, story.formId, "photos_edited", true)).toEqual({ ok: true });

    const row = deps.stories.rows.get(story.submissionId);
    expect(row?.photosEditedFor).toEqual([p1]);
    expect(row?.photosEditedBy).toBe(OWNER.email);
    expect(row?.photosEditedAt).toEqual(deps.clock.now());
    expect(auditOf(deps, "story_check_changed")).toEqual([
      {
        action: "story_check_changed",
        actorEmail: OWNER.email,
        targetId: story.submissionId,
        ip: OWNER.ip,
        details: { check: "photos_edited", value: true, by: "hand" },
      },
    ]);
  });

  it("refuses photos edited with nothing chosen", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);

    expect(await tick(deps, story.formId, "photos_edited", true)).toEqual({
      ok: false,
      code: "no_photos_chosen",
    });
    expect(deps.stories.rows.get(story.submissionId)?.photosEditedFor ?? null).toBeNull();
    expect(auditOf(deps, "story_check_changed")).toEqual([]);
  });

  it("ticks and unticks text checked by hand", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);

    expect(await tick(deps, story.formId, "text_checked", true)).toEqual({ ok: true });
    expect(deps.stories.rows.get(story.submissionId)).toMatchObject({
      textCheckedBy: OWNER.email,
      textCheckedAt: deps.clock.now(),
    });
    expect(await tick(deps, story.formId, "text_checked", false)).toEqual({ ok: true });
    expect(deps.stories.rows.get(story.submissionId)?.textCheckedAt).toBeNull();
    expect(auditOf(deps, "story_check_changed").map((e) => e.details)).toEqual([
      { check: "text_checked", value: true, by: "hand" },
      { check: "text_checked", value: false, by: "hand" },
    ]);
  });

  it("unticking clears who and when", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    choose(deps, story, [story.photoIds[0]]);
    await tick(deps, story.formId, "photos_edited", true);
    await tick(deps, story.formId, "text_checked", true);

    await tick(deps, story.formId, "photos_edited", false);
    await tick(deps, story.formId, "text_checked", false);

    expect(deps.stories.rows.get(story.submissionId)).toMatchObject({
      photosEditedFor: null,
      photosEditedBy: null,
      photosEditedAt: null,
      textCheckedBy: null,
      textCheckedAt: null,
    });
  });

  it("refuses an unknown story and a form without the post plan", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    expect(
      await setCheck(deps, OWNER, {
        formId: story.formId,
        reference: "ST-9999",
        check: "text_checked",
        value: true,
      }),
    ).toEqual({ ok: false, code: "not_found" });

    const off = makeReviewDeps();
    const offStory = await seedStory(off, { postPlan: false });
    expect(await tick(off, offStory.formId, "text_checked", true)).toEqual({
      ok: false,
      code: "post_plan_off",
    });
  });
});
