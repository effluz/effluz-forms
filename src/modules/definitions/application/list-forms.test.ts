import { describe, expect, it } from "vitest";
import { listForms } from "./list-forms";
import { EDITOR, makeDefinitionsDeps, seedForm, type FakeDefinitionsDeps } from "./testing/fakes";

const at = (iso: string) => new Date(iso);

async function seed(deps: FakeDefinitionsDeps, slug: string, en: string, es = en) {
  return seedForm(deps, { slug, title: { en, es } });
}

describe("listForms", () => {
  it("filters by tab and takes the tab counts from the repository", async () => {
    const deps = makeDefinitionsDeps();
    await seed(deps, "alpha", "Alpha");
    await seedForm(deps, {
      slug: "beta",
      title: { en: "Beta", es: "Beta" },
      patch: { status: "published", currentVersionNumber: 2 },
    });
    await seedForm(deps, {
      slug: "gamma",
      title: { en: "Gamma", es: "Gamma" },
      patch: { status: "closed" },
    });
    await seedForm(deps, {
      slug: "delta",
      title: { en: "Delta", es: "Delta" },
      patch: { status: "archived" },
    });

    const active = await listForms(deps, EDITOR, { tab: "active" });
    expect(active.rows.map((r) => r.slug)).toEqual(["alpha", "beta"]);
    expect(active.counts).toEqual({ active: 2, closed: 1, archived: 1 });
    expect(active.rows.find((r) => r.slug === "beta")).toMatchObject({
      status: "published",
      versionNumber: 2,
    });
    expect((await listForms(deps, EDITOR, { tab: "closed" })).rows.map((r) => r.slug)).toEqual([
      "gamma",
    ]);
    expect((await listForms(deps, EDITOR, { tab: "archived" })).rows.map((r) => r.slug)).toEqual([
      "delta",
    ]);
  });

  it("sorts by last submission, newest first and never-submitted last, then by title ignoring case and accents", async () => {
    const deps = makeDefinitionsDeps();
    const zulu = await seed(deps, "zulu", "Zulu");
    const yankee = await seed(deps, "yankee", "yankee");
    await seed(deps, "bravo", "Bravo");
    await seedForm(deps, { slug: "solo-es", title: { es: "árbol" }, languages: "es" });
    await seed(deps, "alpha", "alpha");
    deps.stats.receive(zulu, at("2026-10-09T10:00:00Z"));
    deps.stats.receive(yankee, at("2026-10-08T10:00:00Z"), at("2026-10-09T12:00:00Z"));

    const { rows } = await listForms(deps, EDITOR, { tab: "active" });
    expect(rows.map((r) => r.slug)).toEqual(["yankee", "zulu", "alpha", "solo-es", "bravo"]);
    expect(rows[0]).toMatchObject({ total: 2, lastReceivedAt: at("2026-10-09T12:00:00Z") });
    expect(rows[2]).toMatchObject({ total: 0, lastReceivedAt: null, newCount: 0 });
  });

  it("counts new submissions since the actor last opened the form, else all of them", async () => {
    const deps = makeDefinitionsDeps();
    const opened = await seed(deps, "opened", "Opened");
    const unopened = await seed(deps, "unopened", "Unopened");
    deps.stats.receive(opened, at("2026-10-01T10:00:00Z"), at("2026-10-09T10:00:00Z"));
    deps.stats.receive(unopened, at("2026-10-01T10:00:00Z"), at("2026-10-02T10:00:00Z"));
    await deps.uow.run((uow) =>
      deps.forms.markOpened(uow, opened, EDITOR.email, at("2026-10-05T00:00:00Z")),
    );
    // Someone else's visit does not count for the actor.
    await deps.uow.run((uow) =>
      deps.forms.markOpened(uow, unopened, "other@example.com", at("2026-10-05T00:00:00Z")),
    );

    const { rows } = await listForms(deps, EDITOR, { tab: "active" });
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    expect(bySlug.get("opened")).toMatchObject({ newCount: 1, total: 2 });
    expect(bySlug.get("unopened")).toMatchObject({ newCount: 2, total: 2 });
  });

  it("passes the search through to the repository", async () => {
    const deps = makeDefinitionsDeps();
    await seed(deps, "summer-camp", "Summer camp", "Campamento");
    await seed(deps, "alumni", "Alumni");
    const { rows } = await listForms(deps, EDITOR, { tab: "active", search: "campa" });
    expect(rows.map((r) => r.slug)).toEqual(["summer-camp"]);
    expect(deps.forms.listCalls.at(-1)).toEqual({ tab: "active", search: "campa" });
  });

  it("returns the row fields the manager table shows", async () => {
    const deps = makeDefinitionsDeps();
    const id = await seedForm(deps, { slug: "fair", title: { en: "Fair", es: "Feria" } });
    const stored = deps.store.forms.get(id);
    if (!stored) throw new Error("seed failed");
    deps.store.forms.set(id, {
      ...stored,
      settings: {
        ...stored.settings,
        closesAt: "2026-12-01T00:00:00.000Z",
        timezone: "America/Mexico_City",
      },
    });
    const { rows } = await listForms(deps, EDITOR, { tab: "active" });
    expect(rows).toEqual([
      {
        id,
        slug: "fair",
        title: { en: "Fair", es: "Feria" },
        status: "draft",
        versionNumber: null,
        newCount: 0,
        total: 0,
        lastReceivedAt: null,
        closesAt: "2026-12-01T00:00:00.000Z",
        timezone: "America/Mexico_City",
      },
    ]);
  });

  it("returns empty rows and zero counts with no forms", async () => {
    const deps = makeDefinitionsDeps();
    expect(await listForms(deps, EDITOR, { tab: "active" })).toEqual({
      rows: [],
      counts: { active: 0, closed: 0, archived: 0 },
    });
  });
});
