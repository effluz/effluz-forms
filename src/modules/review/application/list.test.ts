import { describe, expect, it } from "vitest";
import { EMPTY_QUERY } from "../domain/list-query";
import { NO_CHECKS } from "../domain/readiness";
import type { ListRow } from "./ports/review-queries";
import { listStories } from "./list";
import { OWNER, seedStory } from "./testing/fixtures";
import { makeReviewDeps, type FakeReviewDeps } from "./testing/fakes";

function row(versionId: string, over: Partial<ListRow> = {}): ListRow {
  return {
    submissionId: "00000000-0000-4000-8000-0000000000a1",
    reference: "ST-0001",
    receivedAt: new Date("2026-10-16T14:00:00Z"),
    versionId,
    locale: "es",
    status: "new",
    answers: { f_name: "Ana Prueba" },
    mediaCount: 2,
    plannedOn: null,
    publishedOn: null,
    checks: NO_CHECKS,
    hasDeadJobs: false,
    ...over,
  };
}

async function seedWithRows(deps: FakeReviewDeps, postPlan = true) {
  const seeded = await seedStory(deps, { postPlan });
  const versionId = deps.definitions.store.forms.get(seeded.formId)?.currentVersionId ?? "";
  deps.queries.listResult = {
    rows: [
      row(versionId, {
        reference: "ST-0002",
        answers: { f_name: "Bea Prueba" },
        plannedOn: "2026-10-20",
        checks: { chosen: ["m1"], photosEditedFor: ["m1"], textCheckedAt: new Date() },
      }),
      row(versionId, { status: "published", answers: {}, hasDeadJobs: true }),
    ],
    total: 2,
  };
  return seeded;
}

describe("listStories", () => {
  it("maps rows and records one audit entry per page load", async () => {
    const deps = makeReviewDeps();
    const { formId } = await seedWithRows(deps);

    const list = await listStories(deps, OWNER, { formId, query: EMPTY_QUERY });

    expect(list?.rows.map((r) => [r.reference, r.label, r.versionNumber])).toEqual([
      ["ST-0002", "Bea Prueba", 1],
      ["ST-0001", null, 1],
    ]);
    expect(list?.rows[0]?.readiness?.ready).toBe(true);
    expect(list?.rows[0]?.plannedOn).toBe("2026-10-20");
    expect(list?.rows[1]?.readiness?.ready).toBe(false);
    expect(list?.rows[1]?.published).toBe(true);
    expect(list?.rows[1]?.deadJobs).toBe(true);
    expect(list?.total).toBe(2);
    expect(list?.pageCount).toBe(1);
    const listed = deps.audit.entries.filter((e) => e.entry.action === "submissions_listed");
    expect(listed.map((e) => e.entry)).toEqual([
      {
        action: "submissions_listed",
        actorEmail: OWNER.email,
        targetId: formId,
        ip: OWNER.ip,
        details: { page: 1, count: 2 },
      },
    ]);
  });

  it("computes the page count", async () => {
    const deps = makeReviewDeps();
    const { formId } = await seedWithRows(deps);
    deps.queries.listResult = { ...deps.queries.listResult, total: 101 };

    const list = await listStories(deps, OWNER, { formId, query: EMPTY_QUERY });

    expect(list?.pageCount).toBe(3);
  });

  it("leaves readiness out when the form is not in the plan", async () => {
    const deps = makeReviewDeps();
    const { formId } = await seedWithRows(deps, false);

    const list = await listStories(deps, OWNER, { formId, query: EMPTY_QUERY });

    expect(list?.rows.map((r) => r.readiness)).toEqual([null, null]);
  });

  it("answers null for an unknown form and records nothing", async () => {
    const deps = makeReviewDeps();
    await seedWithRows(deps);
    const before = deps.audit.entries.length;

    const list = await listStories(deps, OWNER, {
      formId: "00000000-0000-4000-8000-000000000999",
      query: EMPTY_QUERY,
    });

    expect(list).toBeNull();
    expect(deps.audit.entries).toHaveLength(before);
    expect(deps.queries.calls).toEqual([]);
  });
});
