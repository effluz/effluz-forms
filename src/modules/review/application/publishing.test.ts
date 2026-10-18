import { describe, expect, it } from "vitest";
import { reviewAuditActions } from "../domain/audit";
import type { IsoDate } from "../domain/days";
import type { ReviewStatus } from "../domain/status";
import { saveCorrection } from "./curation";
import { emptyStory } from "./ports/story-repository";
import { markPublished, unmarkPublished } from "./publishing";
import { OWNER, seedAnotherStory, seedStory } from "./testing/fixtures";
import { makeReviewDeps, type FakeReviewDeps } from "./testing/fakes";

const LINK = "https://www.instagram.com/p/synthetic-post/";

function plan(
  deps: FakeReviewDeps,
  ids: { formId: string; submissionId: string },
  plannedOn: IsoDate | null,
): void {
  deps.stories.rows.set(ids.submissionId, {
    ...emptyStory(ids.submissionId, ids.formId),
    plannedOn,
  });
}

const mark = (deps: FakeReviewDeps, formId: string, postUrl = LINK, reference = "ST-0001") =>
  markPublished(deps, OWNER, { formId, reference, postUrl });

const unmark = (deps: FakeReviewDeps, formId: string, reference = "ST-0001") =>
  unmarkPublished(deps, OWNER, { formId, reference });

/** The entries this module wrote: seeding the form writes definitions' own. */
const reviewAudit = (deps: FakeReviewDeps) =>
  deps.audit.entries.filter((e) =>
    (reviewAuditActions as readonly string[]).includes(e.entry.action),
  );

const auditOf = (deps: FakeReviewDeps, action: string) =>
  deps.audit.entries.filter((e) => e.entry.action === action).map((e) => e.entry);

async function seed(deps: FakeReviewDeps, status: ReviewStatus = "viewed") {
  return seedStory(deps, { status });
}

describe("markPublished", () => {
  it("marks a planned story published on its planned day", async () => {
    const deps = makeReviewDeps();
    const story = await seed(deps);
    plan(deps, story, "2026-10-20");

    expect(await mark(deps, story.formId)).toEqual({ ok: true, day: "2026-10-20" });

    const curation = deps.submissions.submissions.curation.get(story.submissionId);
    expect(curation?.status).toBe("published");
    expect(curation?.publishedPostUrl).toBe(LINK);
    expect(curation?.statusChangedBy).toBe(OWNER.email);
    expect(curation?.statusChangedAt).toEqual(deps.clock.now());
    const row = deps.stories.rows.get(story.submissionId);
    expect(row?.publishedOn).toBe("2026-10-20");
    expect(row?.plannedOn).toBe("2026-10-20");
    expect(auditOf(deps, "submission_status_changed")).toEqual([
      {
        action: "submission_status_changed",
        actorEmail: OWNER.email,
        targetId: story.submissionId,
        ip: OWNER.ip,
        details: { from: "viewed", to: "published", link: true },
      },
    ]);
  });

  it("uses today in Panama when the story had no date", async () => {
    const deps = makeReviewDeps();
    const story = await seed(deps);
    deps.clock.set(new Date("2026-10-19T03:00:00Z"));

    expect(await mark(deps, story.formId)).toEqual({ ok: true, day: "2026-10-18" });

    const row = deps.stories.rows.get(story.submissionId);
    expect(row?.publishedOn).toBe("2026-10-18");
    expect(row?.plannedOn).toBeNull();
  });

  it("re-marking replaces the link and keeps the day", async () => {
    const deps = makeReviewDeps();
    const story = await seed(deps);
    await mark(deps, story.formId);
    const changedAt = deps.submissions.submissions.curation.get(
      story.submissionId,
    )?.statusChangedAt;
    deps.clock.set(new Date("2026-10-21T15:00:00Z"));
    const other = "https://www.facebook.com/synthetic/posts/2";

    expect(await mark(deps, story.formId, other)).toEqual({ ok: true, day: "2026-10-18" });

    const curation = deps.submissions.submissions.curation.get(story.submissionId);
    expect(curation?.publishedPostUrl).toBe(other);
    expect(curation?.statusChangedAt).toEqual(changedAt);
    expect(deps.stories.rows.get(story.submissionId)?.publishedOn).toBe("2026-10-18");
    expect(auditOf(deps, "submission_status_changed").map((e) => e.details)).toEqual([
      { from: "viewed", to: "published", link: true },
      { from: "published", to: "published", link: true },
    ]);

    expect(await mark(deps, story.formId, "")).toEqual({ ok: true, day: "2026-10-18" });
    expect(
      deps.submissions.submissions.curation.get(story.submissionId)?.publishedPostUrl,
    ).toBeNull();
  });

  it("refuses a link that is not https", async () => {
    const deps = makeReviewDeps();
    const story = await seed(deps);

    expect(await mark(deps, story.formId, "http://www.instagram.com/p/synthetic/")).toEqual({
      ok: false,
      code: "post_url_invalid",
    });

    expect(deps.submissions.submissions.curation.get(story.submissionId)?.status).toBe("viewed");
    expect(deps.stories.rows.get(story.submissionId)).toBeUndefined();
    expect(reviewAudit(deps)).toEqual([]);
  });

  it("answers not_found for an unknown story", async () => {
    const deps = makeReviewDeps();
    const story = await seed(deps);

    expect(await mark(deps, story.formId, LINK, "ST-9999")).toEqual({
      ok: false,
      code: "not_found",
    });
    expect(await unmark(deps, story.formId, "ST-9999")).toEqual({
      ok: false,
      code: "not_found",
    });
  });
});

describe("unmarkPublished", () => {
  it("unmark returns to edited or viewed", async () => {
    const deps = makeReviewDeps();
    const story = await seed(deps);
    await saveCorrection(deps, OWNER, {
      formId: story.formId,
      reference: "ST-0001",
      fieldKey: "f_name",
      text: "Ana  Prueba",
    });
    await mark(deps, story.formId);

    expect(await unmark(deps, story.formId)).toEqual({
      ok: true,
      status: "edited",
      movedToWaiting: true,
      dayHeldBy: null,
    });
    const edited = deps.submissions.submissions.curation.get(story.submissionId);
    expect(edited?.status).toBe("edited");
    expect(edited?.publishedPostUrl).toBeNull();
    expect(deps.stories.rows.get(story.submissionId)?.publishedOn).toBeNull();

    const plain = makeReviewDeps();
    const other = await seed(plain);
    await mark(plain, other.formId);

    const result = await unmark(plain, other.formId);

    expect(result).toMatchObject({ ok: true, status: "viewed" });
    const viewed = plain.submissions.submissions.curation.get(other.submissionId);
    expect(viewed?.status).toBe("viewed");
    expect(viewed?.publishedPostUrl).toBeNull();
    expect(viewed?.statusChangedBy).toBe(OWNER.email);
    expect(plain.stories.rows.get(other.submissionId)?.publishedOn).toBeNull();
    expect(auditOf(plain, "submission_status_changed").map((e) => e.details)).toEqual([
      { from: "viewed", to: "published", link: true },
      { from: "published", to: "viewed", link: false },
    ]);
    expect(auditOf(deps, "submission_status_changed").at(-1)?.details).toEqual({
      from: "published",
      to: "edited",
      link: false,
    });
  });

  it("unmark keeps the date when the day is free", async () => {
    const deps = makeReviewDeps();
    const story = await seed(deps);
    plan(deps, story, "2026-10-20");
    await mark(deps, story.formId);

    expect(await unmark(deps, story.formId)).toEqual({
      ok: true,
      status: "viewed",
      movedToWaiting: false,
      dayHeldBy: null,
    });

    const row = deps.stories.rows.get(story.submissionId);
    expect(row?.plannedOn).toBe("2026-10-20");
    expect(row?.publishedOn).toBeNull();
    expect(auditOf(deps, "story_planned")).toEqual([]);
  });

  it("unmark moves the story to waiting when its day was taken meanwhile", async () => {
    const deps = makeReviewDeps();
    const a = await seed(deps);
    plan(deps, a, "2026-10-20");
    await mark(deps, a.formId);
    const b = await seedAnotherStory(deps, a.formId);
    plan(deps, { formId: a.formId, submissionId: b.submissionId }, "2026-10-20");
    const before = structuredClone(deps.stories.rows.get(b.submissionId));

    expect(await unmark(deps, a.formId)).toEqual({
      ok: true,
      status: "viewed",
      movedToWaiting: true,
      dayHeldBy: "ST-0002",
    });

    const row = deps.stories.rows.get(a.submissionId);
    expect(row?.plannedOn).toBeNull();
    expect(row?.publishedOn).toBeNull();
    expect(deps.stories.rows.get(b.submissionId)).toEqual(before);
    expect(auditOf(deps, "story_planned")).toEqual([
      {
        action: "story_planned",
        actorEmail: OWNER.email,
        targetId: a.submissionId,
        ip: OWNER.ip,
        details: { from: "2026-10-20", to: "none" },
      },
    ]);
  });

  it("unmark of a story published without a date sends it to waiting", async () => {
    const deps = makeReviewDeps();
    const story = await seed(deps);
    await mark(deps, story.formId);

    expect(await unmark(deps, story.formId)).toEqual({
      ok: true,
      status: "viewed",
      movedToWaiting: true,
      dayHeldBy: null,
    });

    const row = deps.stories.rows.get(story.submissionId);
    expect(row?.plannedOn).toBeNull();
    expect(row?.publishedOn).toBeNull();
    expect(auditOf(deps, "story_planned")).toEqual([]);
  });

  it("unmark of an unpublished story is refused", async () => {
    const deps = makeReviewDeps();
    const story = await seed(deps);

    expect(await unmark(deps, story.formId)).toEqual({ ok: false, code: "not_published" });
    expect(reviewAudit(deps)).toEqual([]);
  });
});
