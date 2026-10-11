import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { newInProgress } from "@/modules/submissions/domain/in-progress";
import { PgInProgressRepository } from "@/modules/submissions/infrastructure/pg-in-progress-repository";
import { asKey } from "@/shared/domain/form-model";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";
import { seedPublishedForm } from "./factories";

describe("PgInProgressRepository", () => {
  const pool = testPool();
  const repo = new PgInProgressRepository(pool);
  const uow = new PgUnitOfWorkFactory(pool);
  beforeEach(() => truncateAll(pool));

  it("round-trips a record with answers, files and a pending page", async () => {
    const { formId, versionId } = await seedPublishedForm(pool);
    const now = new Date("2026-10-10T12:00:00.000Z");
    const record = {
      ...newInProgress({
        id: randomUUID(),
        formId,
        versionId,
        locale: "es" as const,
        pageKey: "page_contact",
        submitToken: randomUUID(),
        startedAt: now,
        now,
      }),
      answers: { f_name: "Ana Prueba" },
      files: {
        f_photos: [
          {
            id: randomUUID(),
            stagingRef: "in-progress/r/a.jpg",
            kind: "image" as const,
            contentType: "image/jpeg",
            size: 3,
          },
        ],
      },
      pending: {
        pageKey: "page_contact",
        raw: { f_email: "nope" },
        issues: [{ code: "email_syntax" as const, field: asKey("f_email") }],
      },
    };
    await uow.run((u) => repo.insert(u, record));
    expect(await repo.find(record.id)).toEqual(record);
    const updated = {
      ...record,
      pageKey: "page_baby",
      pending: null,
      updatedAt: new Date("2026-10-10T12:01:00.000Z"),
    };
    await uow.run(async (u) => {
      expect(await repo.findForUpdate(u, record.id)).toEqual(record);
      await repo.update(u, updated);
    });
    expect(await repo.find(record.id)).toEqual(updated);
    expect(await repo.find("not-a-uuid")).toBeNull();
  });

  it("lists expired ids, oldest first, and deletes", async () => {
    const { formId, versionId } = await seedPublishedForm(pool);
    const make = (iso: string) => {
      const now = new Date(iso);
      return newInProgress({
        id: randomUUID(),
        formId,
        versionId,
        locale: "en",
        pageKey: "page_contact",
        submitToken: randomUUID(),
        startedAt: now,
        now,
      });
    };
    const old = make("2026-10-08T00:00:00.000Z");
    const fresh = make("2026-10-10T00:00:00.000Z");
    await uow.run(async (u) => {
      await repo.insert(u, fresh);
      await repo.insert(u, old);
    });
    expect(await repo.listExpired(new Date("2026-10-10T12:00:00.000Z"), 10)).toEqual([old.id]);
    await uow.run((u) => repo.delete(u, old.id));
    expect(await repo.find(old.id)).toBeNull();
    expect(await repo.find(fresh.id)).not.toBeNull();
  });
});
