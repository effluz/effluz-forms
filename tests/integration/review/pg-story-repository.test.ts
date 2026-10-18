import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyStory } from "@/modules/review/application/ports/story-repository";
import { PgEditRepository } from "@/modules/review/infrastructure/pg-edit-repository";
import { PgStaffPhotoRepository } from "@/modules/review/infrastructure/pg-staff-photo-repository";
import { PgStoryRepository } from "@/modules/review/infrastructure/pg-story-repository";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll, waitForLockWaiters } from "../db";
import { seedStoredStory } from "./factories";

const AT = new Date("2026-10-18T15:00:00.000Z");
const DAY = "2026-10-21";

describe("PgStoryRepository", () => {
  const pool = testPool();
  const repo = new PgStoryRepository(pool);
  const uow = new PgUnitOfWorkFactory(pool);
  beforeEach(() => truncateAll(pool));

  async function storyCount(submissionId: string): Promise<number> {
    const { rows } = await pool.query<{ n: number }>(
      "select count(*)::int as n from story where submission_id = $1",
      [submissionId],
    );
    return rows[0]?.n ?? 0;
  }

  it("creates an empty story on first lock and keeps it", async () => {
    const { formId, submissionId } = await seedStoredStory(pool);
    const first = await uow.run((u) => repo.lockOrCreate(u, submissionId, formId));
    const second = await uow.run((u) => repo.lockOrCreate(u, submissionId, formId));
    expect(first).toEqual(emptyStory(submissionId, formId));
    expect(second).toEqual(emptyStory(submissionId, formId));
    expect(await storyCount(submissionId)).toBe(1);
    expect(await repo.find(submissionId)).toEqual(emptyStory(submissionId, formId));
    expect(await repo.find(randomUUID())).toBeNull();
  });

  it("saves sorted arrays and reads them back", async () => {
    const { formId, submissionId } = await seedStoredStory(pool);
    const chosen = [randomUUID(), randomUUID(), randomUUID()].sort();
    const row = {
      ...emptyStory(submissionId, formId),
      plannedOn: DAY,
      chosen,
      photosEditedFor: chosen.slice(0, 2),
      photosEditedBy: "editor@example.com",
      photosEditedAt: new Date("2026-10-18T10:00:00.000Z"),
      textCheckedBy: "checker@example.com",
      textCheckedAt: new Date("2026-10-18T11:00:00.000Z"),
    };
    await uow.run(async (u) => {
      await repo.lockOrCreate(u, submissionId, formId);
      await repo.save(u, row, AT);
    });
    expect(await repo.find(submissionId)).toEqual(row);
  });

  it("refuses a second unpublished story on one day", async () => {
    const a = await seedStoredStory(pool);
    const b = await seedStoredStory(pool, { formId: a.formId });
    const c = await seedStoredStory(pool);
    await uow.run((u) =>
      repo.save(u, { ...emptyStory(a.submissionId, a.formId), plannedOn: DAY }, AT),
    );
    await expect(
      uow.run((u) => repo.save(u, { ...emptyStory(c.submissionId, c.formId), plannedOn: DAY }, AT)),
    ).rejects.toMatchObject({ code: "23505" });
    await uow.run((u) =>
      repo.save(
        u,
        { ...emptyStory(b.submissionId, b.formId), plannedOn: DAY, publishedOn: DAY },
        AT,
      ),
    );
    expect((await repo.find(a.submissionId))?.plannedOn).toBe(DAY);
    expect(await repo.find(b.submissionId)).toMatchObject({ plannedOn: DAY, publishedOn: DAY });
    expect(await repo.find(c.submissionId)).toBeNull();
  });

  it("lockDay returns the holder and serializes planners", async () => {
    const { formId, submissionId } = await seedStoredStory(pool);
    const first = await uow.begin();
    try {
      await repo.lockOrCreate(first, submissionId, formId);
      expect(await repo.lockDay(first, DAY)).toBeNull();
      await repo.save(first, { ...emptyStory(submissionId, formId), plannedOn: DAY }, AT);

      let secondRead = false;
      const second = uow.run(async (u) => {
        const holder = await repo.lockDay(u, DAY);
        secondRead = true;
        return holder;
      });
      await waitForLockWaiters(pool);
      expect(secondRead).toBe(false);

      await first.commit();
      expect(await second).toEqual({ ...emptyStory(submissionId, formId), plannedOn: DAY });
    } finally {
      // A failed assertion must not leave the lock (and the next truncate) waiting.
      await first.rollback().catch(() => undefined);
    }
  });

  it("goes with its submission", async () => {
    const { formId, submissionId } = await seedStoredStory(pool);
    await uow.run((u) => repo.lockOrCreate(u, submissionId, formId));
    await pool.query("delete from submission where id = $1", [submissionId]);
    expect(await storyCount(submissionId)).toBe(0);
  });

  // Task 9's deleteSubmission is a plain delete: every piece of review state must cascade.
  it("deleting a submission removes its story, staff photos and edits", async () => {
    const { formId, submissionId } = await seedStoredStory(pool);
    const kept = await seedStoredStory(pool, { formId });
    const photos = new PgStaffPhotoRepository(pool);
    const edits = new PgEditRepository(pool);
    for (const id of [submissionId, kept.submissionId]) {
      await uow.run(async (u) => {
        await repo.lockOrCreate(u, id, formId);
        await photos.insert(u, {
          id: randomUUID(),
          submissionId: id,
          source: "other",
          addedBy: "editor@example.com",
          createdAt: AT,
        });
        await edits.append(u, {
          id: randomUUID(),
          submissionId: id,
          fieldKey: "f_story",
          text: "Texto de prueba.",
          source: "manual",
          editor: "editor@example.com",
          createdAt: AT,
        });
      });
    }
    await pool.query("delete from submission where id = $1", [submissionId]);
    const counts = async (id: string) => {
      const { rows } = await pool.query<{ s: number; p: number; e: number }>(
        `select (select count(*)::int from story where submission_id = $1) as s,
                (select count(*)::int from staff_photo where submission_id = $1) as p,
                (select count(*)::int from submission_edit where submission_id = $1) as e`,
        [id],
      );
      return rows[0];
    };
    expect(await counts(submissionId)).toEqual({ s: 0, p: 0, e: 0 });
    expect(await counts(kept.submissionId)).toEqual({ s: 1, p: 1, e: 1 });
  });
});
