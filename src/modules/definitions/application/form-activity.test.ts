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
      { targetId: FORM_ID, action: "form_published", before, limit: 50 },
      { targetId: FORM_ID, actorEmail: EDITOR.email, limit: 10 },
    ]);
    expect(first).toEqual({ entries: [], actors: [`actor-of-${FORM_ID}`] });
  });
});
