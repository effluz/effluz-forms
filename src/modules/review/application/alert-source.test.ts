import { describe, expect, it } from "vitest";
import { ReviewAlertSource } from "./alert-source";
import { seedAnotherStory, seedStory } from "./testing/fixtures";
import { makeReviewDeps, type FakeReviewDeps } from "./testing/fakes";

const OPTS = { to: "alerts@example.com", publicBaseUrl: "https://forms.example.com" };

/** A copy of ST-0001's stored submission under a new id and reference. */
function cloneStory(deps: FakeReviewDeps, fromId: string, reference: string): string {
  const row = deps.submissions.submissions.rows.get(fromId);
  if (!row) throw new Error("no submission to clone");
  const id = deps.ids.newId();
  deps.submissions.submissions.rows.set(id, { ...structuredClone(row), id, reference });
  return id;
}

/** ST-0001 with three dead uploads, two of its photos and one of ST-0002's photo. */
async function seedThreeDeadUploads(deps: FakeReviewDeps) {
  const story = await seedStory(deps);
  const other = await seedAnotherStory(deps, story.formId);
  const p1 = deps.media.media.rows.get(story.photoIds[0]);
  if (!p1) throw new Error("no photo");
  const p3 = deps.ids.newId();
  deps.media.media.rows.set(p3, {
    ...p1,
    id: p3,
    submissionId: other.submissionId,
    durableKey: "forms/story-form/ST-0002/01-photos.jpg",
  });
  for (const mediaId of [story.photoIds[0], story.photoIds[1], p3])
    deps.jobs.add({ type: "media.upload", payload: { mediaId } });
  deps.jobs.add({
    type: "email.staff_notification",
    payload: { submissionId: story.submissionId },
  });
  return story;
}

describe("ReviewAlertSource", () => {
  it("lists the affected stories of the dead jobs of a type", async () => {
    const deps = makeReviewDeps();
    await seedThreeDeadUploads(deps);

    expect(await new ReviewAlertSource(deps, OPTS).jobAlert("media.upload")).toEqual({
      to: ["alerts@example.com"],
      data: {
        jobType: "media.upload",
        count: 3,
        references: ["ST-0001", "ST-0002"],
        moreCount: 0,
        link: "https://forms.example.com/admin/operations",
      },
    });
  });

  it("caps references at 20", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    for (let i = 1; i <= 25; i += 1) {
      const id = cloneStory(deps, story.submissionId, `ST-${String(100 + i).padStart(4, "0")}`);
      deps.jobs.add({ type: "email.staff_notification", payload: { submissionId: id } });
    }

    const alert = await new ReviewAlertSource(deps, OPTS).jobAlert("email.staff_notification");

    expect(alert?.data.count).toBe(25);
    expect(alert?.data.references).toHaveLength(20);
    expect(alert?.data.references[0]).toBe("ST-0101");
    expect(alert?.data.references[19]).toBe("ST-0120");
    expect(alert?.data.moreCount).toBe(5);
  });

  it("sends nothing without an address or without dead jobs", async () => {
    const deps = makeReviewDeps();
    await seedThreeDeadUploads(deps);

    expect(
      await new ReviewAlertSource(deps, { ...OPTS, to: null }).jobAlert("media.upload"),
    ).toBeNull();

    // Every dead upload was retried before the alert ran.
    for (const job of deps.jobs.jobs) if (job.type === "media.upload") job.status = "pending";
    expect(await new ReviewAlertSource(deps, OPTS).jobAlert("media.upload")).toBeNull();
  });

  it("carries no content", async () => {
    const deps = makeReviewDeps();
    await seedThreeDeadUploads(deps);

    const alert = await new ReviewAlertSource(deps, OPTS).jobAlert("media.upload");
    if (!alert) throw new Error("no alert");
    const json = JSON.stringify(alert.data);

    const answers = [...deps.submissions.submissions.rows.values()].flatMap((row) =>
      Object.values(row.answers).filter((v): v is string => typeof v === "string"),
    );
    expect(answers.length).toBeGreaterThan(0);
    for (const answer of answers) expect(json).not.toContain(answer);
    expect(json).not.toContain("@");
  });
});
