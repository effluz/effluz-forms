import { describe, expect, it } from "vitest";
import type { AuditLogReader, AuditQuery } from "@/modules/identity/application";
import type { DefinitionsDeps } from "./deps";
import { formActivity } from "./form-activity";
import { EDITOR, fakeUuid, makeDefinitionsDeps } from "./testing/fakes";

const FORM_ID = fakeUuid(1);
const REVIEWER = "reviewer@example.com";

async function seedLog(deps: ReturnType<typeof makeDefinitionsDeps>) {
  const rows = [
    ["form_created", EDITOR.email, FORM_ID, "2026-10-01T00:00:00Z"],
    ["draft_saved", REVIEWER, FORM_ID, "2026-10-02T00:00:00Z"],
    ["draft_saved", EDITOR.email, FORM_ID, "2026-10-03T00:00:00Z"],
    ["form_created", REVIEWER, fakeUuid(2), "2026-10-04T00:00:00Z"],
  ] as const;
  await deps.uow.run(async (uow) => {
    for (const [action, actorEmail, targetId, at] of rows) {
      await deps.audit.record(uow, { action, actorEmail, targetId, ip: null }, new Date(at));
    }
  });
}

describe("formActivity", () => {
  it("lists the form's entries newest first with its actors", async () => {
    const deps = makeDefinitionsDeps();
    await seedLog(deps);

    const result = await formActivity(deps, FORM_ID, {});

    expect(result.entries.map((e) => [e.action, e.actorEmail])).toEqual([
      ["draft_saved", EDITOR.email],
      ["draft_saved", REVIEWER],
      ["form_created", EDITOR.email],
    ]);
    expect(result.actors).toEqual([EDITOR.email, REVIEWER]);
  });

  it("filters by action, actor and an older-than cursor", async () => {
    const deps = makeDefinitionsDeps();
    await seedLog(deps);

    const result = await formActivity(deps, FORM_ID, {
      action: "draft_saved",
      actorEmail: REVIEWER,
      before: new Date("2026-10-03T00:00:00Z"),
    });

    expect(result.entries.map((e) => e.at)).toEqual([new Date("2026-10-02T00:00:00Z")]);
  });

  it("passes the filter to the reader with a default limit of 50", async () => {
    const calls: AuditQuery[] = [];
    const reader: AuditLogReader = {
      listByTarget: (query) => {
        calls.push(query);
        return Promise.resolve([]);
      },
      actorsForTarget: (targetId) => Promise.resolve([`actor-of-${targetId}`]),
    };
    const deps: DefinitionsDeps = { ...makeDefinitionsDeps(), auditReader: reader };
    const before = new Date("2026-10-05T00:00:00Z");

    const first = await formActivity(deps, FORM_ID, { action: "form_published", before });
    await formActivity(deps, FORM_ID, { actorEmail: EDITOR.email, limit: 10 });

    expect(calls).toEqual([
      { targetId: FORM_ID, action: "form_published", before, limit: 51 },
      { targetId: FORM_ID, actorEmail: EDITOR.email, limit: 11 },
    ]);
    expect(first).toEqual({ entries: [], actors: [`actor-of-${FORM_ID}`], hasMore: false });
  });

  it.each([
    [0, 2],
    [-5, 2],
    [2.7, 3],
    [Number.NaN, 51],
    [Number.POSITIVE_INFINITY, 51],
    [1000, 200],
  ])("clamps a limit of %s to a page the reader accepts (reads %s)", async (limit, read) => {
    const calls: AuditQuery[] = [];
    const reader: AuditLogReader = {
      listByTarget: (query) => {
        calls.push(query);
        return Promise.resolve([]);
      },
      actorsForTarget: () => Promise.resolve([]),
    };
    const deps: DefinitionsDeps = { ...makeDefinitionsDeps(), auditReader: reader };

    await formActivity(deps, FORM_ID, { limit });

    expect(calls).toEqual([{ targetId: FORM_ID, limit: read }]);
  });

  it("passes the (createdAt, id) cursor through", async () => {
    const calls: AuditQuery[] = [];
    const reader: AuditLogReader = {
      listByTarget: (query) => {
        calls.push(query);
        return Promise.resolve([]);
      },
      actorsForTarget: () => Promise.resolve([]),
    };
    const deps: DefinitionsDeps = { ...makeDefinitionsDeps(), auditReader: reader };
    const before = new Date("2026-10-05T00:00:00Z");

    await formActivity(deps, FORM_ID, { before, beforeId: fakeUuid(9) });

    expect(calls).toEqual([{ targetId: FORM_ID, before, beforeId: fakeUuid(9), limit: 51 }]);
  });

  it("reports whether older entries exist and trims the extra row", async () => {
    const deps = makeDefinitionsDeps();
    await seedLog(deps);

    const more = await formActivity(deps, FORM_ID, { limit: 2 });
    const exact = await formActivity(deps, FORM_ID, { limit: 3 });

    expect(more.entries.map((e) => e.at)).toEqual([
      new Date("2026-10-03T00:00:00Z"),
      new Date("2026-10-02T00:00:00Z"),
    ]);
    expect(more.hasMore).toBe(true);
    expect(exact.entries).toHaveLength(3);
    expect(exact.hasMore).toBe(false);
  });

  it("pages through entries that share one instant without skipping any", async () => {
    const deps = makeDefinitionsDeps();
    const at = new Date("2026-10-06T00:00:00Z");
    await deps.uow.run(async (uow) => {
      for (const action of ["a", "b", "c"]) {
        await deps.audit.record(uow, { action, actorEmail: null, targetId: FORM_ID, ip: null }, at);
      }
    });

    const page1 = await formActivity(deps, FORM_ID, { limit: 2 });
    const last = page1.entries[page1.entries.length - 1];
    if (last === undefined) throw new Error("expected a first page");
    const page2 = await formActivity(deps, FORM_ID, {
      limit: 2,
      before: last.at,
      beforeId: last.id,
    });

    expect(page1.hasMore).toBe(true);
    expect(page2.entries.map((e) => e.action)).toEqual(["a"]);
    expect(page2.hasMore).toBe(false);
  });
});
