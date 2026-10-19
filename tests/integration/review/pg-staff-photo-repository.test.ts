import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { StaffPhotoRow } from "@/modules/review/application/ports/staff-photo-repository";
import { PgStaffPhotoRepository } from "@/modules/review/infrastructure/pg-staff-photo-repository";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";
import { seedStoredStory } from "./factories";

describe("PgStaffPhotoRepository", () => {
  const pool = testPool();
  const repo = new PgStaffPhotoRepository(pool);
  const uow = new PgUnitOfWorkFactory(pool);
  beforeEach(() => truncateAll(pool));

  const photo = (submissionId: string, over: Partial<StaffPhotoRow> = {}): StaffPhotoRow => ({
    id: randomUUID(),
    submissionId,
    source: "whatsapp",
    addedBy: "editor@example.com",
    createdAt: new Date("2026-10-18T10:00:00.000Z"),
    ...over,
  });

  it("lists a story's staff photos oldest first and deletes one", async () => {
    const { submissionId } = await seedStoredStory(pool);
    const other = await seedStoredStory(pool);
    const newer = photo(submissionId, {
      source: "email",
      createdAt: new Date("2026-10-18T12:00:00.000Z"),
    });
    const older = photo(submissionId, {
      source: "instagram",
      createdAt: new Date("2026-10-18T09:00:00.000Z"),
    });
    const elsewhere = photo(other.submissionId);
    await uow.run(async (u) => {
      await repo.insert(u, newer);
      await repo.insert(u, older);
      await repo.insert(u, elsewhere);
    });
    expect(await repo.listBySubmission(submissionId)).toEqual([older, newer]);
    await uow.run(async (u) => {
      expect(await repo.listBySubmission(submissionId, u)).toEqual([older, newer]);
      expect(await repo.delete(u, older.id)).toBe(true);
      expect(await repo.delete(u, older.id)).toBe(false);
      expect(await repo.delete(u, "nope")).toBe(false);
    });
    expect(await repo.listBySubmission(submissionId)).toEqual([newer]);
    expect(await repo.listBySubmission(other.submissionId)).toEqual([elsewhere]);
    const { rows } = await pool.query<{ sender_confirmed: boolean }>(
      "select sender_confirmed from staff_photo where id = $1",
      [newer.id],
    );
    expect(rows[0]?.sender_confirmed).toBe(true);
  });

  it("refuses an unknown source", async () => {
    const { submissionId } = await seedStoredStory(pool);
    await expect(
      pool.query(
        `insert into staff_photo (id, submission_id, source, sender_confirmed, added_by)
         values ($1, $2, 'sms', true, 'editor@example.com')`,
        [randomUUID(), submissionId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("goes with its submission", async () => {
    const { submissionId } = await seedStoredStory(pool);
    await uow.run((u) => repo.insert(u, photo(submissionId)));
    await pool.query("delete from submission where id = $1", [submissionId]);
    expect(await repo.listBySubmission(submissionId)).toEqual([]);
  });
});
