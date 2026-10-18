import { describe, expect, it } from "vitest";
import { fakeImage } from "@/modules/media/application/testing/fakes";
import type { MediaRecord } from "@/modules/media/application";
import { reviewAuditActions } from "../domain/audit";
import { STAFF_PHOTOS_FIELD_KEY } from "../domain/staff-photos";
import { accessMedia, photoArchive, type MediaView } from "./media-access";
import { addStaffPhotos } from "./photos";
import { emptyStory } from "./ports/story-repository";
import { OWNER, seedAnotherStory, seedStory } from "./testing/fixtures";
import { makeReviewDeps, type FakeReviewDeps } from "./testing/fakes";

type Seeded = Awaited<ReturnType<typeof seedStory>>;

/** The entries this module wrote: seeding the form writes definitions' own. */
const reviewAudit = (deps: FakeReviewDeps) =>
  deps.audit.entries
    .filter((e) => (reviewAuditActions as readonly string[]).includes(e.entry.action))
    .map((e) => e.entry);

const access = (
  deps: FakeReviewDeps,
  story: Seeded,
  mediaId: string,
  view: MediaView,
  reference: string = story.reference,
) => accessMedia(deps, OWNER, { formId: story.formId, reference, mediaId, view });

/** Adds a stored video of the story with no staging copy left. */
function addStoredVideo(deps: FakeReviewDeps, story: Seeded): string {
  const id = deps.ids.newId();
  const at = new Date("2026-10-16T14:00:00Z");
  const record: MediaRecord = {
    id,
    submissionId: story.submissionId,
    formId: story.formId,
    fieldKey: "f_photos",
    position: 3,
    kind: "video",
    status: "stored",
    contentType: "video/mp4",
    size: 128,
    stagingRef: null,
    durableKey: "forms/story-form/ST-0001/03-photos.mp4",
    providerRef: null,
    createdAt: at,
    updatedAt: at,
  };
  deps.media.media.rows.set(id, record);
  return id;
}

/** Adds one staff photo and answers its media id. */
async function addStaffPhoto(deps: FakeReviewDeps, story: Seeded): Promise<string> {
  const result = await addStaffPhotos(deps, OWNER, {
    formId: story.formId,
    reference: story.reference,
    files: [fakeImage()],
    source: "whatsapp",
    senderConfirmed: true,
  });
  expect(result).toEqual({ ok: true, added: 1 });
  const staff = [...deps.media.media.rows.values()].find(
    (m) => m.submissionId === story.submissionId && m.fieldKey === STAFF_PHOTOS_FIELD_KEY,
  );
  if (!staff) throw new Error("no staff photo was added");
  return staff.id;
}

const text = async (body: ReadableStream<Uint8Array>) => new Response(body).text();

describe("accessMedia", () => {
  it("serves a thumbnail without an audit entry", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);

    const result = await access(deps, story, story.photoIds[0], "thumb");

    expect(result).toMatchObject({ kind: "bytes", contentType: "image/webp" });
    expect(reviewAudit(deps)).toEqual([]);
  });

  it("streams a full photo and records the view", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    const [p1] = story.photoIds;

    const result = await access(deps, story, p1, "full");

    expect(result).toMatchObject({
      kind: "stream",
      contentType: "image/jpeg",
      size: 64,
      filename: "01-photos.jpg",
    });
    if (result?.kind !== "stream") throw new Error("expected a stream");
    expect(new Uint8Array(await new Response(result.body).arrayBuffer())).toEqual(fakeImage());
    expect(reviewAudit(deps)).toEqual([
      {
        action: "photo_viewed",
        actorEmail: OWNER.email,
        targetId: story.submissionId,
        ip: OWNER.ip,
        details: { mediaId: p1, kind: "image" },
      },
    ]);
  });

  it("redirects a stored video and records the view", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    const video = addStoredVideo(deps, story);

    const result = await access(deps, story, video, "full");

    expect(result).toEqual({
      kind: "redirect",
      url: "memory://forms/story-form/ST-0001/03-photos.mp4",
    });
    expect(reviewAudit(deps)).toMatchObject([
      { action: "photo_viewed", details: { mediaId: video, kind: "video" } },
    ]);
  });

  it("downloads with an audit entry", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    const [p1] = story.photoIds;

    const result = await access(deps, story, p1, "download");

    expect(result).toMatchObject({ kind: "stream", filename: "01-photos.jpg" });
    expect(reviewAudit(deps)).toEqual([
      {
        action: "media_downloaded",
        actorEmail: OWNER.email,
        targetId: story.submissionId,
        ip: OWNER.ip,
        details: { mediaId: p1 },
      },
    ]);
  });

  it("refuses a file of another story, a staff row pending deletion, and a missing file", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    const [p1, p2] = story.photoIds;
    const other = await seedAnotherStory(deps, story.formId);
    const staff = await addStaffPhoto(deps, story);
    // Its staff_photo row is gone: the media row awaits its delete job.
    deps.staffPhotos.rows.delete(staff);
    // p2's durable bytes are gone.
    deps.media.durable.files.clear();
    const before = reviewAudit(deps).length;

    for (const view of ["thumb", "full", "download"] as const) {
      expect(await access(deps, story, p1, view, other.reference)).toBeNull();
      expect(await access(deps, story, staff, view)).toBeNull();
      expect(await access(deps, story, p2, view)).toBeNull();
      expect(await access(deps, story, deps.ids.newId(), view)).toBeNull();
    }
    expect(reviewAudit(deps)).toHaveLength(before);
  });

  it("cancels the opened file when the audit write fails", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    let cancelled = false;
    deps.media.staging.openRead = () =>
      Promise.resolve(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(fakeImage());
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    const failing = { ...deps, audit: { record: () => Promise.reject(new Error("audit down")) } };

    await expect(
      accessMedia(failing, OWNER, {
        formId: story.formId,
        reference: story.reference,
        mediaId: story.photoIds[0],
        view: "full",
      }),
    ).rejects.toThrow("audit down");
    expect(cancelled).toBe(true);
  });
});

describe("photoArchive", () => {
  it("zips every photo of the story", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    const staff = await addStaffPhoto(deps, story);
    const before = reviewAudit(deps).length;

    const result = await photoArchive(deps, OWNER, {
      formId: story.formId,
      reference: story.reference,
      set: "all",
    });

    if (!result.ok) throw new Error(`expected an archive, got ${result.code}`);
    expect(result.filename).toBe("story-form-ST-0001.zip");
    expect(await text(result.body)).toBe(
      [
        "ST-0001/01-photos.jpg",
        "ST-0001/02-photos.jpg",
        `ST-0001/staff-01-${staff.replace(/-/g, "").slice(0, 8)}.jpg`,
        "",
      ].join("\n"),
    );
    expect(reviewAudit(deps).slice(before)).toEqual([
      {
        action: "media_downloaded",
        actorEmail: OWNER.email,
        targetId: story.submissionId,
        ip: OWNER.ip,
        details: { set: "all", count: 3 },
      },
    ]);
  });

  it("zips the chosen photos only", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    const [, p2] = story.photoIds;
    const input = { formId: story.formId, reference: story.reference, set: "chosen" as const };

    expect(await photoArchive(deps, OWNER, input)).toEqual({ ok: false, code: "none" });
    expect(reviewAudit(deps)).toEqual([]);

    deps.stories.rows.set(story.submissionId, {
      ...emptyStory(story.submissionId, story.formId),
      chosen: [p2],
    });
    const result = await photoArchive(deps, OWNER, input);

    if (!result.ok) throw new Error(`expected an archive, got ${result.code}`);
    expect(result.filename).toBe("story-form-ST-0001-chosen.zip");
    expect(await text(result.body)).toBe("ST-0001/02-photos.jpg\n");
    expect(reviewAudit(deps)).toMatchObject([
      { action: "media_downloaded", details: { set: "chosen", count: 1 } },
    ]);
  });
});
