import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { PgFormRepository } from "@/modules/definitions/infrastructure/pg-form-repository";
import { PgVersionRepository } from "@/modules/definitions/infrastructure/pg-version-repository";
import { txOf } from "@/shared/infrastructure/postgres/tx";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";
import { sampleForm, sampleVersion } from "./factories";

describe("PgVersionRepository", () => {
  const pool = testPool();
  const uowf = new PgUnitOfWorkFactory(pool);
  const forms = new PgFormRepository(pool);
  const repo = new PgVersionRepository(pool);
  beforeEach(() => truncateAll(pool));

  async function aForm() {
    const form = sampleForm();
    await uowf.run((uow) => forms.insert(uow, form));
    return form;
  }

  it("inserts a version and finds it by id", async () => {
    const form = await aForm();
    const v1 = sampleVersion(form.id, 1);
    expect(await uowf.run((uow) => repo.insert(uow, v1))).toBe("inserted");
    expect(await repo.findById(v1.id)).toEqual(v1);
  });

  it("returns null for an unknown or malformed id", async () => {
    expect(await repo.findById(randomUUID())).toBeNull();
    expect(await repo.findById("not-a-uuid")).toBeNull();
  });

  it("finds the current version once the form row points at it", async () => {
    const form = await aForm();
    expect(await repo.findCurrent(form.id)).toBeNull();
    const v1 = sampleVersion(form.id, 1);
    const v2 = sampleVersion(form.id, 2);
    await uowf.run(async (uow) => {
      await repo.insert(uow, v1);
      await repo.insert(uow, v2);
      await forms.update(uow, {
        ...form,
        status: "published",
        currentVersionId: v2.id,
        currentVersionNumber: 2,
      });
    });
    expect(await repo.findCurrent(form.id)).toEqual(v2);
    const stored = await forms.findById(form.id);
    expect(stored?.currentVersionNumber).toBe(2);
  });

  it("lets the form point at a version inserted later in the same unit of work", async () => {
    const form = await aForm();
    const v1 = sampleVersion(form.id, 1);
    await uowf.run(async (uow) => {
      await forms.update(uow, {
        ...form,
        status: "published",
        currentVersionId: v1.id,
        currentVersionNumber: 1,
      });
      await repo.insert(uow, v1);
    });
    expect((await forms.findById(form.id))?.currentVersionId).toBe(v1.id);
    expect(await repo.findCurrent(form.id)).toEqual(v1);
  });

  it("rejects a pointer to a version that never appears, at commit", async () => {
    const form = await aForm();
    await expect(
      uowf.run((uow) =>
        forms.update(uow, {
          ...form,
          status: "published",
          currentVersionId: randomUUID(),
          currentVersionNumber: 1,
        }),
      ),
    ).rejects.toThrow(/foreign key/);
    const stored = await forms.findById(form.id);
    expect(stored?.currentVersionId).toBeNull();
    expect(stored?.status).toBe("draft");
  });

  it("returns number_taken for a duplicate number and keeps the first", async () => {
    const form = await aForm();
    const first = sampleVersion(form.id, 1);
    await uowf.run((uow) => repo.insert(uow, first));
    const again = sampleVersion(form.id, 1);
    expect(await uowf.run((uow) => repo.insert(uow, again))).toBe("number_taken");
    expect(await repo.findById(again.id)).toBeNull();
    expect(await repo.findById(first.id)).toEqual(first);
  });

  it("keeps the unit of work usable after an insert reports number_taken", async () => {
    const form = await aForm();
    await uowf.run((uow) => repo.insert(uow, sampleVersion(form.id, 1)));
    const next = sampleVersion(form.id, 2);
    await uowf.run(async (uow) => {
      expect(await repo.insert(uow, sampleVersion(form.id, 1))).toBe("number_taken");
      expect(await repo.insert(uow, next)).toBe("inserted");
    });
    expect(await repo.findById(next.id)).toEqual(next);
  });

  it("refuses to update or delete a stored version", async () => {
    const form = await aForm();
    const v1 = sampleVersion(form.id, 1);
    await uowf.run((uow) => repo.insert(uow, v1));
    await expect(
      pool.query("update form_version set published_by = 'x' where id = $1", [v1.id]),
    ).rejects.toThrow(/immutable/);
    await expect(pool.query("delete from form_version where id = $1", [v1.id])).rejects.toThrow(
      /immutable/,
    );
    expect(await repo.findById(v1.id)).toEqual(v1);
  });

  it("lists a form's versions oldest first, none for a malformed id", async () => {
    const form = await aForm();
    const other = await aForm();
    const [v1, v2, v3] = [1, 2, 3].map((n) => sampleVersion(form.id, n));
    if (!v1 || !v2 || !v3) throw new Error("sample versions missing");
    const elsewhere = sampleVersion(other.id, 1);
    await uowf.run(async (uow) => {
      // Inserted out of order: the listing orders by number, not by insertion.
      await repo.insert(uow, v2);
      await repo.insert(uow, v3);
      await repo.insert(uow, v1);
      await repo.insert(uow, elsewhere);
    });
    expect(await repo.listByForm(form.id)).toEqual([v1, v2, v3]);
    expect(await repo.listByForm(randomUUID())).toEqual([]);
    expect(await repo.listByForm("not-a-uuid")).toEqual([]);
  });

  it("reports the latest number, 0 when none", async () => {
    const form = await aForm();
    expect(await repo.latestNumber(form.id)).toBe(0);
    await uowf.run(async (uow) => {
      await repo.insert(uow, sampleVersion(form.id, 1));
      await repo.insert(uow, sampleVersion(form.id, 2));
    });
    expect(await repo.latestNumber(form.id)).toBe(2);
    expect(await repo.latestNumber("not-a-uuid")).toBe(0);
  });

  it("throws when a stored document is not a valid version", async () => {
    const form = await aForm();
    const v1 = sampleVersion(form.id, 1);
    await uowf.run((uow) => repo.insert(uow, v1));
    await uowf.run(async (uow) => {
      const { client } = txOf(uow);
      await client.query("alter table form_version disable trigger form_version_no_update");
      await client.query(`update form_version set document = '{"nope": 1}'::jsonb where id = $1`, [
        v1.id,
      ]);
      await client.query("alter table form_version enable trigger form_version_no_update");
    });
    await expect(repo.findById(v1.id)).rejects.toThrow(/corrupt/i);
  });
});
