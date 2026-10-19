import { describe, expect, it } from "vitest";
import { seedPublished } from "@/modules/definitions/application/testing/fakes";
import { EMPTY_QUERY } from "../domain/list-query";
import { STAFF_PHOTOS_FIELD_KEY } from "../domain/staff-photos";
import { emptyStory } from "./ports/story-repository";
import { openStory } from "./open-story";
import { OWNER, seedStory } from "./testing/fixtures";
import { makeReviewDeps, type FakeReviewDeps } from "./testing/fakes";

const open = (deps: FakeReviewDeps, formId: string, reference = "ST-0001", query = EMPTY_QUERY) =>
  openStory(deps, OWNER, { formId, reference, query });

function addStaffMedia(deps: FakeReviewDeps, formId: string, submissionId: string): string[] {
  return [1, 2].map((position) => {
    const id = deps.ids.newId();
    deps.media.media.rows.set(id, {
      id,
      submissionId,
      formId,
      fieldKey: STAFF_PHOTOS_FIELD_KEY,
      position,
      kind: "image",
      status: "stored",
      contentType: "image/jpeg",
      size: 64,
      stagingRef: null,
      durableKey: `forms/story-form/ST-0001/staff-0${String(position)}-abcd.jpg`,
      providerRef: null,
      createdAt: new Date("2026-10-18T10:00:00Z"),
      updatedAt: new Date("2026-10-18T10:00:00Z"),
    });
    return id;
  });
}

describe("openStory", () => {
  it("opens a new story as viewed and records the view", async () => {
    const deps = makeReviewDeps();
    const { formId, submissionId } = await seedStory(deps);

    const view = await open(deps, formId);

    expect(view?.status).toBe("viewed");
    expect(deps.submissions.submissions.curation.get(submissionId)?.status).toBe("viewed");
    const viewed = () =>
      deps.audit.entries.filter((e) => e.entry.action === "submission_viewed").map((e) => e.entry);
    expect(viewed()).toEqual([
      {
        action: "submission_viewed",
        actorEmail: OWNER.email,
        targetId: submissionId,
        ip: OWNER.ip,
      },
    ]);
    expect(view?.activity.map((a) => a.action)).toEqual(["submission_viewed"]);

    const again = await open(deps, formId);

    expect(again?.status).toBe("viewed");
    expect(viewed()).toHaveLength(2);
  });

  it("shows answers in page and field order with corrections", async () => {
    const deps = makeReviewDeps();
    const { formId, submissionId } = await seedStory(deps);
    const at = new Date("2026-10-18T11:00:00Z");
    const curation = deps.submissions.submissions.curation;
    curation.set(submissionId, {
      status: "edited",
      curatedAnswers: { f_name: "Ana P." },
      publishedPostUrl: null,
      statusChangedBy: OWNER.email,
      statusChangedAt: at,
    });
    await deps.uow.run((uow) =>
      deps.edits.append(uow, {
        id: deps.ids.newId(),
        submissionId,
        fieldKey: "f_name",
        text: "Ana P.",
        source: "manual",
        editor: OWNER.email,
        createdAt: at,
      }),
    );

    const view = await open(deps, formId);

    expect(view?.pages.map((p) => [p.key, p.answers.map((a) => a.field.key)])).toEqual([
      ["page_contact", ["f_name", "f_email", "f_baby"]],
      ["page_baby", ["f_photos"]],
      ["page_consent", ["f_consent"]],
    ]);
    const answers = view?.pages.flatMap((p) => p.answers) ?? [];
    const name = answers.find((a) => a.field.key === "f_name");
    expect(name?.answer).toBe("Ana Prueba");
    expect(name?.corrected).toEqual({ text: "Ana P.", by: OWNER.email, at });
    expect(name?.curatable).toBe(true);
    expect(name?.maxLength).toBe(5_000);
    expect(name?.languages).toBe("bilingual");
    const baby = answers.find((a) => a.field.key === "f_baby");
    expect(baby?.curatable).toBe(false);
    expect(baby?.corrected).toBeNull();

    const limited = makeReviewDeps();
    const seeded = await seedStory(limited, { nameMaxLength: 80 });
    const limitedView = await open(limited, seeded.formId);
    const limitedName = limitedView?.pages
      .flatMap((p) => p.answers)
      .find((a) => a.field.key === "f_name");
    expect(limitedName?.maxLength).toBe(80);
  });

  it("lists the sender's photos then the staff photos, hiding staff rows pending deletion", async () => {
    const deps = makeReviewDeps();
    const { formId, submissionId, photoIds } = await seedStory(deps);
    const [s1] = addStaffMedia(deps, formId, submissionId);
    if (s1 === undefined) throw new Error("no staff media");
    const addedAt = new Date("2026-10-18T10:00:00Z");
    await deps.uow.run((uow) =>
      deps.staffPhotos.insert(uow, {
        id: s1,
        submissionId,
        source: "whatsapp",
        addedBy: OWNER.email,
        createdAt: addedAt,
      }),
    );

    const view = await open(deps, formId);

    expect(view?.photos.map((p) => [p.mediaId, p.origin])).toEqual([
      [photoIds[0], "sender"],
      [photoIds[1], "sender"],
      [s1, "staff"],
    ]);
    expect(view?.photos[0]).toMatchObject({
      status: "staged",
      kind: "image",
      durableKey: "forms/story-form/ST-0001/01-photos.jpg",
      staff: null,
    });
    expect(view?.photos[2]?.staff).toEqual({ addedBy: OWNER.email, addedAt, source: "whatsapp" });
  });

  it("marks chosen photos and works out readiness", async () => {
    const deps = makeReviewDeps();
    const { formId, submissionId, photoIds } = await seedStory(deps);
    const [p1, p2] = photoIds;
    const checkedAt = new Date("2026-10-18T12:00:00Z");
    const story = {
      ...emptyStory(submissionId, formId),
      chosen: [p1],
      photosEditedFor: [p1],
      photosEditedBy: OWNER.email,
      photosEditedAt: checkedAt,
      textCheckedBy: OWNER.email,
      textCheckedAt: checkedAt,
    };
    await deps.uow.run((uow) => deps.stories.save(uow, story, checkedAt));

    const view = await open(deps, formId);

    expect(view?.photos.map((p) => p.chosen)).toEqual([true, false]);
    expect(view?.readiness.ready).toBe(true);
    expect(view?.editedStale).toBe(false);
    expect(view?.photosEditedBy).toEqual({ by: OWNER.email, at: checkedAt });
    expect(view?.textCheckedBy).toEqual({ by: OWNER.email, at: checkedAt });

    await deps.uow.run((uow) =>
      deps.stories.save(uow, { ...story, photosEditedFor: [p2] }, checkedAt),
    );
    const stale = await open(deps, formId);

    expect(stale?.editedStale).toBe(true);
    expect(stale?.readiness.ready).toBe(false);
  });

  it("lists the story's dead jobs", async () => {
    const deps = makeReviewDeps();
    const { formId, photoIds } = await seedStory(deps);
    deps.jobs.add({ type: "media.upload", payload: { mediaId: photoIds[0] } });
    deps.jobs.add({ type: "media.upload", payload: { mediaId: "someone-else" } });

    const view = await open(deps, formId);

    expect(view?.deadJobs).toEqual([{ id: "dead-job-1", type: "media.upload" }]);
  });

  it("passes the list filter to neighbours", async () => {
    const deps = makeReviewDeps();
    const { formId, submissionId } = await seedStory(deps);
    deps.queries.neighboursResult = { newer: "ST-0002", older: null };

    const view = await open(deps, formId, "ST-0001", { ...EMPTY_QUERY, status: "new" });

    expect(view?.neighbours).toEqual({ newer: "ST-0002", older: null });
    const call = deps.queries.calls.find((c) => c.method === "neighbours");
    expect(call?.args).toEqual([
      expect.objectContaining({ formId, status: "new" }),
      { receivedAt: new Date("2026-10-16T14:00:00Z"), submissionId },
    ]);
  });

  it("answers null for an unknown reference, another form's reference, or an unknown form, and records nothing", async () => {
    const deps = makeReviewDeps();
    const { formId, submissionId } = await seedStory(deps);
    const document = [...deps.definitions.store.versions.values()][0]?.document;
    if (!document) throw new Error("no version");
    const other = await seedPublished(deps.definitions, { slug: "other-form", document });
    const before = deps.audit.entries.length;

    expect(await open(deps, formId, "ST-0099")).toBeNull();
    expect(await open(deps, other.formId, "ST-0001")).toBeNull();
    expect(await open(deps, "00000000-0000-4000-8000-000000000999")).toBeNull();

    expect(deps.audit.entries).toHaveLength(before);
    expect(deps.submissions.submissions.curation.get(submissionId)).toBeUndefined();
  });
});
