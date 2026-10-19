import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { EditRow } from "@/modules/review/application/ports/edit-repository";
import { PgEditRepository } from "@/modules/review/infrastructure/pg-edit-repository";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";
import { seedStoredStory } from "./factories";

describe("PgEditRepository", () => {
  const pool = testPool();
  const repo = new PgEditRepository(pool);
  const uow = new PgUnitOfWorkFactory(pool);
  beforeEach(() => truncateAll(pool));

  const edit = (submissionId: string, over: Partial<EditRow> = {}): EditRow => ({
    id: randomUUID(),
    submissionId,
    fieldKey: "f_story",
    text: "Texto corregido de prueba.",
    source: "manual",
    editor: "editor@example.com",
    createdAt: new Date("2026-10-18T10:00:00.000Z"),
    ...over,
  });

  it("returns the newest edit per field", async () => {
    const { submissionId } = await seedStoredStory(pool);
    const other = await seedStoredStory(pool);
    const storyOld = edit(submissionId, { text: "Primera versión." });
    const storyNew = edit(submissionId, {
      text: "Segunda versión.",
      createdAt: new Date("2026-10-18T12:00:00.000Z"),
    });
    const title = edit(submissionId, {
      fieldKey: "f_title",
      text: "Un título",
      createdAt: new Date("2026-10-18T09:00:00.000Z"),
    });
    await uow.run(async (u) => {
      await repo.append(u, storyNew);
      await repo.append(u, storyOld);
      await repo.append(u, title);
      await repo.append(u, edit(other.submissionId));
    });
    const latest = await repo.latestByField(submissionId);
    expect(latest).toEqual(
      new Map([
        ["f_story", storyNew],
        ["f_title", title],
      ]),
    );
    expect(await repo.latestByField(randomUUID())).toEqual(new Map());
    expect(await repo.latestByField("nope")).toEqual(new Map());
  });

  it("is append-only", async () => {
    const { submissionId } = await seedStoredStory(pool);
    await uow.run((u) => repo.append(u, edit(submissionId)));
    await expect(pool.query("update submission_edit set text = 'x'")).rejects.toThrow(
      "submission edits are append-only",
    );
  });

  it("goes with its submission", async () => {
    const { submissionId } = await seedStoredStory(pool);
    await uow.run((u) => repo.append(u, edit(submissionId)));
    await pool.query("delete from submission where id = $1", [submissionId]);
    expect(await repo.latestByField(submissionId)).toEqual(new Map());
  });
});
