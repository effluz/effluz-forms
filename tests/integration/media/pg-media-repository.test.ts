import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { MediaRecord } from "@/modules/media/application";
import { PgMediaRepository } from "@/modules/media/infrastructure/pg-media-repository";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";

const at = new Date("2026-10-10T12:00:00.000Z");

function record(over: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: randomUUID(),
    submissionId: "11111111-1111-4111-8111-111111111111",
    formId: "22222222-2222-4222-8222-222222222222",
    fieldKey: "photos",
    position: 1,
    kind: "image",
    status: "staged",
    contentType: "image/jpeg",
    size: 1234,
    stagingRef: "in-progress/r/a.jpg",
    durableKey: "forms/s/HP-0001/01-photos.jpg",
    providerRef: null,
    createdAt: at,
    updatedAt: at,
    ...over,
  };
}

describe("PgMediaRepository", () => {
  const pool = testPool();
  const repo = new PgMediaRepository(pool);
  const uow = new PgUnitOfWorkFactory(pool);
  beforeEach(() => truncateAll(pool));

  it("round-trips a row and lists a submission's rows by field and position", async () => {
    const second = record({ position: 2 });
    const first = record();
    await uow.run(async (u) => {
      await repo.insert(u, second);
      await repo.insert(u, first);
    });
    expect(await repo.findById(first.id)).toEqual(first);
    expect((await repo.listBySubmission(first.submissionId)).map((r) => r.position)).toEqual([
      1, 2,
    ]);
    expect(await repo.findById("not-a-uuid")).toBeNull();
    expect(await repo.listBySubmission("not-a-uuid")).toEqual([]);
  });

  it("orders a submission's rows by field key before position", async () => {
    const b = record({ fieldKey: "b", position: 1 });
    const a2 = record({ fieldKey: "a", position: 2 });
    const a1 = record({ fieldKey: "a", position: 1 });
    await uow.run(async (u) => {
      for (const r of [b, a2, a1]) await repo.insert(u, r);
    });
    expect((await repo.listBySubmission(a1.submissionId)).map((r) => r.id)).toEqual([
      a1.id,
      a2.id,
      b.id,
    ]);
  });

  it("lists a submission's rows on the unit of work's connection, staff photos included", async () => {
    const sent = record();
    const staff = record({ fieldKey: "staff-photos", position: 1 });
    await uow.run(async (u) => {
      await repo.insert(u, sent);
      await repo.insert(u, staff);
      // Not committed yet: only the unit of work's own connection sees the rows.
      expect(await repo.listBySubmission(sent.submissionId)).toEqual([]);
      const listed = await repo.listBySubmission(sent.submissionId, u);
      expect(listed.map((r) => r.id)).toEqual([sent.id, staff.id]);
      expect(listed.map((r) => r.fieldKey)).toEqual(["photos", "staff-photos"]);
    });
  });

  it("refuses two rows at the same position of a field", async () => {
    await uow.run((u) => repo.insert(u, record()));
    await expect(uow.run((u) => repo.insert(u, record()))).rejects.toThrow(
      /media_submission_field_position_key/,
    );
  });

  it("marks stored, clears staging, marks failed and deletes", async () => {
    const r = record();
    await uow.run((u) => repo.insert(u, r));
    const later = new Date("2026-10-10T13:00:00.000Z");
    expect(
      await uow.run((u) => repo.markStored(u, r.id, "/forms/s/HP-0001/01-photos.jpg", later)),
    ).toBe(true);
    await uow.run((u) => repo.clearStaging(u, r.id, later));
    expect(await repo.findById(r.id)).toMatchObject({
      status: "stored",
      providerRef: "/forms/s/HP-0001/01-photos.jpg",
      stagingRef: null,
      updatedAt: later,
    });
    await uow.run((u) => repo.markFailed(u, r.id, later));
    expect((await repo.findById(r.id))?.status).toBe("failed");
    await uow.run((u) => repo.delete(u, r.id));
    expect(await repo.findById(r.id)).toBeNull();
  });

  it("reports false when markStored finds no row", async () => {
    const gone = record();
    expect(await uow.run((u) => repo.markStored(u, gone.id, "ref", at))).toBe(false);
  });

  it("ignores malformed ids on writes without querying", async () => {
    await uow.run(async (u) => {
      expect(await repo.markStored(u, "nope", "ref", at)).toBe(false);
      await repo.clearStaging(u, "nope", at);
      await repo.markFailed(u, "nope", at);
      await repo.delete(u, "nope");
    });
  });
});
