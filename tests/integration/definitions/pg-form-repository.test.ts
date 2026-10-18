import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { PgDraftRepository } from "@/modules/definitions/infrastructure/pg-draft-repository";
import { PgFormRepository } from "@/modules/definitions/infrastructure/pg-form-repository";
import type { Form } from "@/modules/definitions/domain/form";
import { defaultSettings } from "@/modules/definitions/domain/settings";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll, waitForLockWaiters } from "../db";
import { sampleDraft, sampleForm, sampleVersion } from "./factories";
import { PgVersionRepository } from "@/modules/definitions/infrastructure/pg-version-repository";

describe("PgFormRepository", () => {
  const pool = testPool();
  const uowf = new PgUnitOfWorkFactory(pool);
  const repo = new PgFormRepository(pool);
  beforeEach(() => truncateAll(pool));

  async function insert(form = sampleForm()) {
    await uowf.run((uow) => repo.insert(uow, form));
    return form;
  }

  it("round-trips a form by id and by slug with dates and settings", async () => {
    const form = sampleForm({
      status: "archived",
      archivedAt: new Date("2026-10-12T09:30:00.000Z"),
    });
    expect(await uowf.run((uow) => repo.insert(uow, form))).toBe("inserted");
    expect(await repo.findById(form.id)).toEqual(form);
    expect(await repo.findBySlug(form.slug)).toEqual(form);
  });

  it("returns null for an unknown or malformed id and an unknown slug", async () => {
    expect(await repo.findById(randomUUID())).toBeNull();
    expect(await repo.findById("not-a-uuid")).toBeNull();
    expect(await repo.findBySlug("nothing-here")).toBeNull();
  });

  it("reports slug_taken for a second form with the same slug and keeps the first", async () => {
    const first = await insert(sampleForm({ slug: "open-day" }));
    const second = sampleForm({ slug: "open-day", title: { en: "Other" } });
    expect(await uowf.run((uow) => repo.insert(uow, second))).toBe("slug_taken");
    expect(await repo.findBySlug("open-day")).toEqual(first);
    expect(await repo.findById(second.id)).toBeNull();
  });

  it("finds a form for update inside a unit of work, or null", async () => {
    const form = await insert();
    expect(await uowf.run((uow) => repo.findForUpdate(uow, form.id))).toEqual(form);
    expect(await uowf.run((uow) => repo.findForUpdate(uow, randomUUID()))).toBeNull();
    expect(await uowf.run((uow) => repo.findForUpdate(uow, "not-a-uuid"))).toBeNull();
  });

  it("holds the form row until the locking unit of work commits", async () => {
    const form = await insert();
    const first = await uowf.begin();
    try {
      await repo.findForUpdate(first, form.id);

      let secondRead = false;
      const second = uowf.run(async (uow) => {
        const found = await repo.findForUpdate(uow, form.id);
        secondRead = true;
        return found;
      });
      await waitForLockWaiters(pool);
      expect(secondRead).toBe(false);

      await repo.update(first, { ...form, status: "archived" });
      await first.commit();
      expect((await second)?.status).toBe("archived");
    } finally {
      // A failed assertion must not leave the lock (and the next truncate) waiting.
      await first.rollback().catch(() => undefined);
    }
  });

  it("updates the full row and writes the updatedAt it is given", async () => {
    const form = await insert();
    const changed = {
      ...form,
      status: "published" as const,
      title: { en: "Renamed" },
      updatedAt: new Date("2026-10-11T07:45:12.000Z"),
    };
    expect(await uowf.run((uow) => repo.update(uow, changed))).toBe("updated");
    const found = await repo.findById(form.id);
    expect(found?.status).toBe("published");
    expect(found?.title).toEqual({ en: "Renamed" });
    expect(found?.updatedAt).toEqual(changed.updatedAt);
  });

  it("reports slug_taken when an update renames onto another form's slug", async () => {
    await insert(sampleForm({ slug: "taken" }));
    const other = await insert(sampleForm({ slug: "free" }));
    expect(await uowf.run((uow) => repo.update(uow, { ...other, slug: "taken" }))).toBe(
      "slug_taken",
    );
    expect((await repo.findById(other.id))?.slug).toBe("free");
  });

  it("deletes a form", async () => {
    const form = await insert();
    await uowf.run((uow) => repo.delete(uow, form.id));
    expect(await repo.findById(form.id)).toBeNull();
  });

  it("rethrows errors that are not a unique violation", async () => {
    const form = sampleForm({ status: "bogus" as never });
    await expect(uowf.run((uow) => repo.insert(uow, form))).rejects.toThrow();
  });

  it("keeps the unit of work usable after an insert reports slug_taken", async () => {
    await insert(sampleForm({ slug: "taken" }));
    const other = sampleForm({ slug: "free" });
    await uowf.run(async (uow) => {
      expect(await repo.insert(uow, sampleForm({ slug: "taken" }))).toBe("slug_taken");
      expect(await repo.insert(uow, other)).toBe("inserted");
    });
    expect(await repo.findById(other.id)).toEqual(other);
  });

  it("keeps the unit of work usable after an update reports slug_taken", async () => {
    await insert(sampleForm({ slug: "taken" }));
    const other = await insert(sampleForm({ slug: "free" }));
    await uowf.run(async (uow) => {
      expect(await repo.update(uow, { ...other, slug: "taken" })).toBe("slug_taken");
      expect(await repo.update(uow, { ...other, title: { en: "Changed" } })).toBe("updated");
    });
    const found = await repo.findById(other.id);
    expect(found?.slug).toBe("free");
    expect(found?.title).toEqual({ en: "Changed" });
  });

  it("throws when an update matches no row", async () => {
    await expect(uowf.run((uow) => repo.update(uow, sampleForm()))).rejects.toThrow(
      /does not exist/,
    );
  });

  it("removes a never-published form with its draft and visits", async () => {
    const drafts = new PgDraftRepository(pool);
    const form = sampleForm();
    await uowf.run(async (uow) => {
      await repo.insert(uow, form);
      await drafts.insert(uow, sampleDraft(form.id));
      await repo.markOpened(uow, form.id, "staff@example.com", new Date());
    });
    await uowf.run((uow) => repo.delete(uow, form.id));
    for (const table of ["form", "form_draft", "form_visit"]) {
      const { rows } = await pool.query(`select 1 from ${table}`);
      expect(rows).toHaveLength(0);
    }
  });

  it("refuses to delete a form that has a version", async () => {
    const form = await insert();
    await uowf.run((uow) => new PgVersionRepository(pool).insert(uow, sampleVersion(form.id, 1)));
    await expect(uowf.run((uow) => repo.delete(uow, form.id))).rejects.toThrow(/foreign key/);
    expect(await repo.findById(form.id)).not.toBeNull();
  });

  it("throws on corrupt settings naming only the form id", async () => {
    const form = await insert();
    await pool.query(`update form set settings = $2::jsonb where id = $1`, [
      form.id,
      JSON.stringify({ notificationRecipients: ["leak@example.com"], retentionMonths: "x" }),
    ]);
    const failure = await repo.findById(form.id).then(
      () => null,
      (error: unknown) => error as Error,
    );
    expect(failure?.message).toBe(`stored settings of form ${form.id} are corrupt`);
  });

  it("throws on a corrupt title naming only the form id", async () => {
    const form = await insert();
    await pool.query(`update form set title = $2::jsonb where id = $1`, [
      form.id,
      JSON.stringify({ en: 42, es: "Titulo privado" }),
    ]);
    const failure = await repo.findById(form.id).then(
      () => null,
      (error: unknown) => error as Error,
    );
    expect(failure?.message).toBe(`stored title of form ${form.id} is corrupt`);
  });

  it("ignores markOpened for a malformed form id instead of failing", async () => {
    await uowf.run((uow) => repo.markOpened(uow, "not-a-uuid", "staff@example.com", new Date()));
    const { rows } = await pool.query("select 1 from form_visit");
    expect(rows).toHaveLength(0);
  });

  describe("list and counts", () => {
    beforeEach(async () => {
      await insert(
        sampleForm({ slug: "summer-camp", title: { en: "Summer camp", es: "Campamento" } }),
      );
      await insert(sampleForm({ slug: "alumni", title: { en: "Alumni", es: "Egresados" } }));
      await insert(
        sampleForm({ slug: "only-es", title: { es: "Beca anual" }, status: "published" }),
      );
      await insert(sampleForm({ slug: "old-poll", status: "closed" }));
      await insert(sampleForm({ slug: "gone", status: "archived" }));
    });

    it("lists the active tab as draft and published, ordered by title then slug", async () => {
      const slugs = (await repo.list("active")).map((f) => f.slug);
      expect(slugs).toEqual(["alumni", "only-es", "summer-camp"]);
    });

    it("lists the closed and archived tabs on their own", async () => {
      expect((await repo.list("closed")).map((f) => f.slug)).toEqual(["old-poll"]);
      expect((await repo.list("archived")).map((f) => f.slug)).toEqual(["gone"]);
    });

    it("searches slug and both titles case-insensitively", async () => {
      expect((await repo.list("active", "SUMMER")).map((f) => f.slug)).toEqual(["summer-camp"]);
      expect((await repo.list("active", "campamento")).map((f) => f.slug)).toEqual(["summer-camp"]);
      expect((await repo.list("active", "BECA")).map((f) => f.slug)).toEqual(["only-es"]);
      expect((await repo.list("active", "alu")).map((f) => f.slug)).toEqual(["alumni"]);
    });

    it("treats percent and underscore in the search as literal characters", async () => {
      expect(await repo.list("active", "%")).toEqual([]);
      expect(await repo.list("active", "_")).toEqual([]);
      await insert(sampleForm({ slug: "half", title: { en: "50% off" } }));
      expect((await repo.list("active", "50%")).map((f) => f.slug)).toEqual(["half"]);
    });

    it("counts all three tabs", async () => {
      expect(await repo.counts()).toEqual({ active: 3, closed: 1, archived: 1 });
    });

    it("counts zero for every tab when there are no forms", async () => {
      await truncateAll(pool);
      expect(await repo.counts()).toEqual({ active: 0, closed: 0, archived: 0 });
    });
  });

  it("lists the forms whose settings use the post plan, any status, by title then slug", async () => {
    const withPlan = (slug: string, title: { en?: string; es?: string }, status = "published") =>
      sampleForm({
        slug,
        title,
        status: status as Form["status"],
        settings: { ...defaultSettings(slug), usePostPlan: true },
      });
    await insert(withPlan("zeta", { en: "Zeta stories" }));
    await insert(withPlan("alpha", { en: "Alpha stories" }, "archived"));
    await insert(withPlan("alpha-two", { en: "Alpha stories" }, "closed"));
    await insert(sampleForm({ slug: "plain", title: { en: "Plain stories" } }));
    // A row written before the setting existed has no key: it reads as off.
    const old = await insert(sampleForm({ slug: "old", title: { en: "Old stories" } }));
    await pool.query("update form set settings = settings - 'usePostPlan' where id = $1", [old.id]);

    expect((await repo.listUsingPostPlan()).map((f) => f.slug)).toEqual([
      "alpha",
      "alpha-two",
      "zeta",
    ]);
    await truncateAll(pool);
    expect(await repo.listUsingPostPlan()).toEqual([]);
  });

  describe("visits", () => {
    it("keeps one row per person and form and the later time", async () => {
      const form = await insert();
      const first = new Date("2026-10-10T10:00:00.000Z");
      const later = new Date("2026-10-10T11:00:00.000Z");
      await uowf.run((uow) => repo.markOpened(uow, form.id, "staff@example.com", first));
      await uowf.run((uow) => repo.markOpened(uow, form.id, "staff@example.com", later));
      const { rows } = await pool.query("select * from form_visit");
      expect(rows).toHaveLength(1);
      const seen = await repo.lastOpened("staff@example.com", [form.id]);
      expect(seen.get(form.id)).toEqual(later);
    });

    it("returns only the asked forms and only for that person", async () => {
      const a = await insert();
      const b = await insert();
      const at = new Date("2026-10-10T10:00:00.000Z");
      await uowf.run(async (uow) => {
        await repo.markOpened(uow, a.id, "staff@example.com", at);
        await repo.markOpened(uow, b.id, "staff@example.com", at);
        await repo.markOpened(uow, a.id, "other@example.com", at);
      });
      const seen = await repo.lastOpened("staff@example.com", [a.id]);
      expect([...seen.keys()]).toEqual([a.id]);
      expect((await repo.lastOpened("nobody@example.com", [a.id, b.id])).size).toBe(0);
      expect((await repo.lastOpened("staff@example.com", [])).size).toBe(0);
    });
  });
});
