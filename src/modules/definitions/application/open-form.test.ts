import { describe, expect, it } from "vitest";
import type { FormStatus } from "../domain/form";
import { openForm } from "./open-form";
import { EDITOR, fakeUuid, makeDefinitionsDeps, seedForm } from "./testing/fakes";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("openForm", () => {
  it("returns null for an unknown or malformed id and records no visit", async () => {
    const deps = makeDefinitionsDeps();
    expect(await openForm(deps, EDITOR, fakeUuid(99))).toBeNull();
    expect(await openForm(deps, EDITOR, "not-a-uuid")).toBeNull();
    expect(deps.store.visits.size).toBe(0);
  });

  it("marks the visit for the actor at the current time", async () => {
    const deps = makeDefinitionsDeps();
    const id = await seedForm(deps);
    await openForm(deps, EDITOR, id);
    expect((await deps.forms.lastOpened(EDITOR.email, [id])).get(id)).toEqual(deps.clock.now());
    deps.clock.advance(60_000);
    await openForm(deps, EDITOR, id);
    expect((await deps.forms.lastOpened(EDITOR.email, [id])).get(id)).toEqual(deps.clock.now());
  });

  it("returns the form, its public url, the submission summary and reachability", async () => {
    const deps = makeDefinitionsDeps();
    const id = await seedForm(deps, { slug: "open-day" });
    deps.stats.receive(id, new Date("2026-10-09T10:00:00Z"));
    const overview = await openForm(deps, EDITOR, id);
    expect(overview?.form).toEqual(await deps.forms.findById(id));
    expect(overview?.publicUrl).toBe("https://forms.example.com/f/open-day");
    expect(overview?.summary).toEqual({
      total: 1,
      lastReceivedAt: new Date("2026-10-09T10:00:00Z"),
    });
    expect(overview?.reachability).toEqual({ reachable: false, reason: "draft" });
  });

  it("reports closingInDays when the close date is within seven days", async () => {
    const deps = makeDefinitionsDeps();
    const now = deps.clock.now().getTime();
    const closingAt = (ms: number) => new Date(now + ms).toISOString();
    const id = await seedForm(deps);
    const stored = deps.store.forms.get(id);
    if (!stored) throw new Error("seed failed");
    const withClose = (closesAt: string, status: FormStatus = "published") => {
      deps.store.forms.set(id, {
        ...stored,
        status,
        currentVersionId: fakeUuid(50),
        settings: { ...stored.settings, closesAt },
      });
    };

    withClose(closingAt(3 * DAY_MS));
    expect((await openForm(deps, EDITOR, id))?.closingInDays).toBe(3);
    withClose(closingAt(2.5 * DAY_MS));
    expect((await openForm(deps, EDITOR, id))?.closingInDays).toBe(3);
    withClose(closingAt(7 * DAY_MS));
    expect((await openForm(deps, EDITOR, id))?.closingInDays).toBe(7);
    withClose(closingAt(10 * DAY_MS));
    expect((await openForm(deps, EDITOR, id))?.closingInDays).toBeNull();
    withClose(closingAt(-DAY_MS));
    expect((await openForm(deps, EDITOR, id))?.closingInDays).toBeNull();
    withClose(closingAt(3 * DAY_MS), "closed");
    expect((await openForm(deps, EDITOR, id))?.closingInDays).toBeNull();
  });

  it("reports no closingInDays for a never-published draft with a close date", async () => {
    const deps = makeDefinitionsDeps();
    const id = await seedForm(deps);
    const stored = deps.store.forms.get(id);
    if (!stored) throw new Error("seed failed");
    const closesAt = new Date(deps.clock.now().getTime() + 3 * DAY_MS).toISOString();
    deps.store.forms.set(id, { ...stored, settings: { ...stored.settings, closesAt } });

    expect((await openForm(deps, EDITOR, id))?.closingInDays).toBeNull();
  });

  it("reports no closingInDays without a close date", async () => {
    const deps = makeDefinitionsDeps();
    const id = await seedForm(deps);
    expect((await openForm(deps, EDITOR, id))?.closingInDays).toBeNull();
  });

  it("lists the lifecycle actions the status allows", async () => {
    const deps = makeDefinitionsDeps();
    const cases: [FormStatus, string | null, string[]][] = [
      ["draft", null, ["archive"]],
      ["published", fakeUuid(50), ["close", "archive"]],
      ["closed", fakeUuid(50), ["reopen", "archive"]],
      ["archived", fakeUuid(50), ["unarchive"]],
      ["archived", null, ["unarchive"]],
    ];
    for (const [index, [status, currentVersionId, actions]] of cases.entries()) {
      const id = await seedForm(deps, {
        slug: `form-${String(index)}`,
        patch: { status, currentVersionId },
      });
      expect((await openForm(deps, EDITOR, id))?.allowedActions).toEqual(actions);
    }
  });

  it("allows delete only for a never-published form without submissions", async () => {
    const deps = makeDefinitionsDeps();
    const fresh = await seedForm(deps, { slug: "fresh" });
    expect((await openForm(deps, EDITOR, fresh))?.canDelete).toBe(true);

    const answered = await seedForm(deps, { slug: "answered" });
    deps.stats.receive(answered, new Date("2026-10-09T10:00:00Z"));
    expect((await openForm(deps, EDITOR, answered))?.canDelete).toBe(false);

    const published = await seedForm(deps, {
      slug: "published",
      patch: { status: "published", currentVersionId: fakeUuid(50), currentVersionNumber: 1 },
    });
    expect((await openForm(deps, EDITOR, published))?.canDelete).toBe(false);
  });
});
