import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditLog } from "@/modules/identity/application";
import { PgMediaRepository } from "@/modules/media/infrastructure/pg-media-repository";
import {
  addStaffPhotos,
  choosePhoto,
  removeStaffPhoto,
  type ReviewDeps,
} from "@/modules/review/application";
import { OWNER } from "@/modules/review/application/testing/fixtures";
import { deleteSubmission, lockSubmission } from "@/modules/submissions/application";
import { storyVersion } from "@/modules/submissions/domain/testing/versions";
import type { Field, Version } from "@/shared/domain/form-model";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { syntheticJpegWithGps } from "../../fakes/media-files";
import { testPool, truncateAll, waitForLockWaiters } from "../db";
import { seedPublishedForm } from "../submissions/factories";
import { seedStoredStory } from "./factories";
import { pgReviewDeps } from "./wiring";

/** `storyVersion()` with consent item 10 (`later_photos`) covered. */
function laterPhotosVersion(): Version {
  const base = storyVersion();
  const cover = (field: Field): Field =>
    field.type === "consent"
      ? {
          ...field,
          settings: {
            ...(field.settings as Record<string, unknown>),
            coveredItems: [
              ...(field.settings as { coveredItems: string[] }).coveredItems,
              "later_photos",
            ],
          },
        }
      : field;
  return { ...base, pages: base.pages.map((p) => ({ ...p, fields: p.fields.map(cover) })) };
}

describe("staff photos in Postgres", () => {
  const pool = testPool();
  let dir: string;
  beforeEach(async () => {
    await truncateAll(pool);
    dir = await mkdtemp(path.join(os.tmpdir(), "effluz-staff-photos-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const staging = () => path.join(dir, "staging");
  const deps = (): ReviewDeps =>
    pgReviewDeps(pool, { staging: staging(), durable: path.join(dir, "durable") });

  async function stagedFiles(): Promise<string[]> {
    try {
      const entries = await readdir(staging(), { recursive: true });
      return entries.map(String).filter((f) => path.basename(f).includes("."));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  /** A post-plan story with two of the sender's photos, stored. */
  async function seedStory() {
    const { formId, slug } = await seedPublishedForm(pool, laterPhotosVersion(), {
      usePostPlan: true,
    });
    const senderIds = [randomUUID(), randomUUID()];
    const story = await seedStoredStory(pool, {
      formId,
      answers: { f_name: "Ana Prueba", f_photos: senderIds },
    });
    const media = new PgMediaRepository(pool);
    const at = new Date("2026-10-10T12:00:00.000Z");
    await new PgUnitOfWorkFactory(pool).run(async (uow) => {
      for (const [i, id] of senderIds.entries())
        await media.insert(uow, {
          id,
          submissionId: story.submissionId,
          formId,
          fieldKey: "f_photos",
          position: i + 1,
          kind: "image",
          status: "stored",
          contentType: "image/jpeg",
          size: 64,
          stagingRef: null,
          durableKey: `forms/${slug}/${story.reference}/0${String(i + 1)}-photos.jpg`,
          providerRef: null,
          createdAt: at,
          updatedAt: at,
        });
    });
    return { ...story, senderIds, target: { formId, reference: story.reference } };
  }

  const addJpeg = async (d: ReviewDeps, target: { formId: string; reference: string }) =>
    addStaffPhotos(d, OWNER, {
      ...target,
      files: [await syntheticJpegWithGps()],
      source: "email",
      senderConfirmed: true,
    });

  const staffRows = async (submissionId: string) =>
    (
      await pool.query<{ id: string }>("select id from staff_photo where submission_id = $1", [
        submissionId,
      ])
    ).rows.map((r) => r.id);

  const staffMedia = async (submissionId: string) =>
    (
      await pool.query<{ id: string; staging_ref: string; durable_key: string }>(
        `select id, staging_ref, durable_key from media
          where submission_id = $1 and field_key = 'staff-photos' order by position`,
        [submissionId],
      )
    ).rows;

  const jobs = async (type: string) =>
    (
      await pool.query<{ media_id: string }>(
        "select payload->>'mediaId' as media_id from job where type = $1",
        [type],
      )
    ).rows
      .map((r) => r.media_id)
      .sort();

  const audits = async (submissionId: string, action: string) =>
    (
      await pool.query<{ n: number }>(
        "select count(*)::int as n from audit_log where target_id = $1 and action = $2",
        [submissionId, action],
      )
    ).rows[0]?.n;

  it("a staff upload and a delete see the same rows", async () => {
    const story = await seedStory();
    const d = deps();

    expect(await addJpeg(d, story.target)).toEqual({ ok: true, added: 1 });

    const [staff] = await staffMedia(story.submissionId);
    if (!staff) throw new Error("the staff photo has a media row");
    expect(staff.durable_key).toBe(
      `${path.dirname(staff.durable_key)}/staff-01-${staff.id.replace(/-/g, "").slice(0, 8)}.jpg`,
    );
    const stored = await readFile(path.join(staging(), staff.staging_ref));
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(stored.includes("Exif")).toBe(false);
    expect(await staffRows(story.submissionId)).toEqual([staff.id]);

    const outcome = await d.uow.run((uow) =>
      deleteSubmission(d.submissions, uow, story.submissionId),
    );

    expect(outcome).toEqual({ deleted: true, mediaDeletes: 3 });
    expect(await jobs("media.delete")).toEqual([...story.senderIds, staff.id].sort());
    expect(await staffRows(story.submissionId)).toEqual([]);
  });

  it("an upload waiting on a delete finds the story gone and discards its files", async () => {
    const story = await seedStory();
    const d = deps();
    const deleter = await d.uow.begin();
    try {
      await lockSubmission(d.submissions, deleter, story.submissionId);
      const upload = addJpeg(d, story.target);
      await waitForLockWaiters(pool);
      await deleteSubmission(d.submissions, deleter, story.submissionId);
      await deleter.commit();

      expect(await upload).toEqual({ ok: false, code: "not_found" });
    } catch (error) {
      await deleter.rollback();
      throw error;
    }
    expect(await stagedFiles()).toEqual([]);
    expect(await staffMedia(story.submissionId)).toEqual([]);
    expect(await jobs("media.upload")).toEqual([]);
  });

  it("an upload whose unit of work fails writes nothing and keeps no staged file", async () => {
    const story = await seedStory();
    const real = deps();
    const failing: AuditLog = {
      record: () => Promise.reject(new Error("injected audit failure")),
    };

    await expect(addJpeg({ ...real, audit: failing }, story.target)).rejects.toThrow(
      "injected audit failure",
    );

    expect(await staffMedia(story.submissionId)).toEqual([]);
    expect(await staffRows(story.submissionId)).toEqual([]);
    expect(await jobs("media.upload")).toEqual([]);
    expect(await stagedFiles()).toEqual([]);
  });

  it("a removal whose unit of work fails keeps the photo and its choice", async () => {
    const story = await seedStory();
    const d = deps();
    await addJpeg(d, story.target);
    const [staff] = await staffMedia(story.submissionId);
    if (!staff) throw new Error("the staff photo has a media row");
    expect(
      await choosePhoto(d, OWNER, { ...story.target, mediaId: staff.id, chosen: true }),
    ).toEqual({ ok: true });
    const failing: AuditLog = {
      record: (uow, entry, at) =>
        entry.action === "staff_photo_removed"
          ? Promise.reject(new Error("injected audit failure"))
          : d.audit.record(uow, entry, at),
    };

    await expect(
      removeStaffPhoto({ ...d, audit: failing }, OWNER, { ...story.target, mediaId: staff.id }),
    ).rejects.toThrow("injected audit failure");

    expect(await staffRows(story.submissionId)).toEqual([staff.id]);
    const { rows } = await pool.query<{ chosen: string[] }>(
      "select chosen_media::text[] as chosen from story where submission_id = $1",
      [story.submissionId],
    );
    expect(rows[0]?.chosen).toEqual([staff.id]);
    expect(await jobs("media.delete")).toEqual([]);
    expect(await audits(story.submissionId, "staff_photo_removed")).toBe(0);

    expect(await removeStaffPhoto(d, OWNER, { ...story.target, mediaId: staff.id })).toEqual({
      ok: true,
    });
    expect(await staffRows(story.submissionId)).toEqual([]);
    expect(await jobs("media.delete")).toEqual([staff.id]);
  });
});
