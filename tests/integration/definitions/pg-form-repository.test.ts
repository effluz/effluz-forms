import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { PgFormRepository } from "@/modules/definitions/infrastructure/pg-form-repository";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";
import { sampleForm } from "./factories";

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

  it("updates the full row and bumps updated_at", async () => {
    const form = await insert();
    const changed = {
      ...form,
      status: "published" as const,
      title: { en: "Renamed" },
    };
    expect(await uowf.run((uow) => repo.update(uow, changed))).toBe("updated");
    const found = await repo.findById(form.id);
    expect(found?.status).toBe("published");
    expect(found?.title).toEqual({ en: "Renamed" });
    expect(found?.updatedAt).not.toEqual(form.updatedAt);
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
