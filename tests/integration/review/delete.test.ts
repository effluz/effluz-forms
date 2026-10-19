import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditLog } from "@/modules/identity/application";
import { PgMediaRepository } from "@/modules/media/infrastructure/pg-media-repository";
import { deleteStory, type ReviewDeps } from "@/modules/review/application";
import { emptyStory } from "@/modules/review/application/ports/story-repository";
import { OWNER } from "@/modules/review/application/testing/fixtures";
import { PgEditRepository } from "@/modules/review/infrastructure/pg-edit-repository";
import { PgStaffPhotoRepository } from "@/modules/review/infrastructure/pg-staff-photo-repository";
import { PgStoryRepository } from "@/modules/review/infrastructure/pg-story-repository";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";
import { seedPublishedForm } from "../submissions/factories";
import { seedStoredStory } from "./factories";
import { pgReviewDeps } from "./wiring";

describe("deleting a story in Postgres", () => {
  const pool = testPool();
  let dir: string;
  beforeEach(async () => {
    await truncateAll(pool);
    dir = await mkdtemp(path.join(os.tmpdir(), "effluz-delete-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const deps = (): ReviewDeps =>
    pgReviewDeps(pool, { staging: path.join(dir, "staging"), durable: path.join(dir, "durable") });

  /** A post-plan story with one sender photo, one staff photo, a story row and an edit. */
  async function seedFullStory() {
    const { formId, slug } = await seedPublishedForm(pool, undefined, { usePostPlan: true });
    const senderId = randomUUID();
    const staffId = randomUUID();
    const story = await seedStoredStory(pool, {
      formId,
      answers: { f_name: "Ana Prueba", f_photos: [senderId] },
    });
    const at = new Date("2026-10-10T12:00:00.000Z");
    const media = new PgMediaRepository(pool);
    await new PgUnitOfWorkFactory(pool).run(async (uow) => {
      for (const [id, fieldKey, name] of [
        [senderId, "f_photos", "01-photos.jpg"],
        [staffId, "staff-photos", "staff-01-0a1b2c3d.jpg"],
      ] as const)
        await media.insert(uow, {
          id,
          submissionId: story.submissionId,
          formId,
          fieldKey,
          position: 1,
          kind: "image",
          status: "stored",
          contentType: "image/jpeg",
          size: 64,
          stagingRef: null,
          durableKey: `forms/${slug}/${story.reference}/${name}`,
          providerRef: null,
          createdAt: at,
          updatedAt: at,
        });
      await new PgStaffPhotoRepository(pool).insert(uow, {
        id: staffId,
        submissionId: story.submissionId,
        source: "email",
        addedBy: OWNER.email,
        createdAt: at,
      });
      const stories = new PgStoryRepository(pool);
      await stories.lockOrCreate(uow, story.submissionId, formId);
      await stories.save(uow, { ...emptyStory(story.submissionId, formId), chosen: [staffId] }, at);
      await new PgEditRepository(pool).append(uow, {
        id: randomUUID(),
        submissionId: story.submissionId,
        fieldKey: "f_name",
        text: "Ana Corregida",
        source: "manual",
        editor: OWNER.email,
        createdAt: at,
      });
    });
    return { ...story, senderId, staffId, target: { formId, reference: story.reference } };
  }

  async function state(submissionId: string) {
    const count = async (sql: string) =>
      (await pool.query<{ n: number }>(sql, [submissionId])).rows[0]?.n;
    return {
      submission: await count("select count(*)::int as n from submission where id = $1"),
      story: await count("select count(*)::int as n from story where submission_id = $1"),
      staff: await count("select count(*)::int as n from staff_photo where submission_id = $1"),
      edits: await count("select count(*)::int as n from submission_edit where submission_id = $1"),
      deleted: await count(
        "select count(*)::int as n from audit_log where target_id = $1::text and action = 'submission_deleted'",
      ),
    };
  }

  const deleteJobs = async () =>
    (
      await pool.query<{ media_id: string }>(
        "select payload->>'mediaId' as media_id from job where type = 'media.delete'",
      )
    ).rows
      .map((r) => r.media_id)
      .sort();

  it("deletes the submission, cascades its review state and enqueues every file", async () => {
    const story = await seedFullStory();

    expect(await deleteStory(deps(), OWNER, { ...story.target, typed: story.reference })).toEqual({
      ok: true,
    });

    expect(await state(story.submissionId)).toEqual({
      submission: 0,
      story: 0,
      staff: 0,
      edits: 0,
      deleted: 1,
    });
    expect(await deleteJobs()).toEqual([story.senderId, story.staffId].sort());
  });

  it("a delete whose unit of work fails leaves everything", async () => {
    const story = await seedFullStory();
    const real = deps();
    // The last write of the unit of work fails, after the delete and the jobs.
    const failing: AuditLog = {
      record: (uow, entry, at) =>
        entry.action === "submission_deleted"
          ? Promise.reject(new Error("injected audit failure"))
          : real.audit.record(uow, entry, at),
    };

    await expect(
      deleteStory({ ...real, audit: failing }, OWNER, { ...story.target, typed: story.reference }),
    ).rejects.toThrow("injected audit failure");

    expect(await state(story.submissionId)).toEqual({
      submission: 1,
      story: 1,
      staff: 1,
      edits: 1,
      deleted: 0,
    });
    expect(await deleteJobs()).toEqual([]);
  });
});
