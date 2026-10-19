import { describe, expect, it } from "vitest";
import { seedPublished } from "@/modules/definitions/application/testing/fakes";
import type { IsoDate } from "../domain/days";
import { NO_CHECKS } from "../domain/readiness";
import { planStory, postPlanWeek, waitingStories } from "./plan";
import type { PlanEntry } from "./ports/review-queries";
import { emptyStory } from "./ports/story-repository";
import { OWNER, seedAnotherStory, seedStory } from "./testing/fixtures";
import { makeReviewDeps, type FakeReviewDeps } from "./testing/fakes";

const LINK = "https://www.instagram.com/p/synthetic-post/";
const TICKED_AT = new Date("2026-10-17T15:00:00Z");

function setPlanned(
  deps: FakeReviewDeps,
  ids: { formId: string; submissionId: string },
  plannedOn: IsoDate | null,
): void {
  deps.stories.rows.set(ids.submissionId, {
    ...emptyStory(ids.submissionId, ids.formId),
    plannedOn,
  });
}

const plannedOf = (deps: FakeReviewDeps, submissionId: string) =>
  deps.stories.rows.get(submissionId)?.plannedOn ?? null;

const auditOf = (deps: FakeReviewDeps, action: string) =>
  deps.audit.entries.filter((e) => e.entry.action === action).map((e) => e.entry);

const plan = (
  deps: FakeReviewDeps,
  formId: string,
  date: string,
  over: { reference?: string; resolution?: string; expected?: string } = {},
) =>
  planStory(deps, OWNER, {
    formId,
    reference: over.reference ?? "ST-0001",
    date,
    resolution: over.resolution ?? "",
    expected: over.expected ?? "",
  });

async function twoStories(deps: FakeReviewDeps) {
  const first = await seedStory(deps, { status: "viewed" });
  const second = await seedAnotherStory(deps, first.formId);
  return { first, second: { ...second, formId: first.formId } };
}

function entry(
  over: Partial<PlanEntry> & Pick<PlanEntry, "submissionId" | "formId" | "versionId">,
): PlanEntry {
  return {
    reference: "ST-0001",
    receivedAt: new Date("2026-10-16T14:00:00Z"),
    answers: { f_name: "Ana Prueba" },
    status: "viewed",
    postUrl: null,
    plannedOn: null,
    publishedOn: null,
    checks: NO_CHECKS,
    ...over,
  };
}

/** The current version's document of a form, to publish another form like it. */
function versionDocument(deps: FakeReviewDeps, formId: string) {
  const version = deps.definitions.store.versions.get(versionOf(deps, formId));
  if (!version) throw new Error("test: the version is missing");
  return version.document;
}

function versionOf(deps: FakeReviewDeps, formId: string): string {
  const versionId = deps.definitions.store.forms.get(formId)?.currentVersionId;
  if (versionId == null) throw new Error("test: the form has no version");
  return versionId;
}

describe("planStory", () => {
  it("plans a story on a free day", async () => {
    const deps = makeReviewDeps();
    const { first } = await twoStories(deps);

    expect(await plan(deps, first.formId, "2026-10-21")).toEqual({
      ok: true,
      plannedOn: "2026-10-21",
    });

    expect(plannedOf(deps, first.submissionId)).toBe("2026-10-21");
    expect(auditOf(deps, "story_planned")).toEqual([
      {
        action: "story_planned",
        actorEmail: OWNER.email,
        targetId: first.submissionId,
        ip: OWNER.ip,
        details: { from: "none", to: "2026-10-21" },
      },
    ]);
  });

  it("asks before taking a day", async () => {
    const deps = makeReviewDeps();
    const { first, second } = await twoStories(deps);
    setPlanned(deps, second, "2026-10-21");

    expect(await plan(deps, first.formId, "2026-10-21")).toEqual({
      ok: false,
      code: "conflict",
      date: "2026-10-21",
      other: "ST-0002",
      canSwap: false,
    });

    expect(plannedOf(deps, first.submissionId)).toBeNull();
    expect(plannedOf(deps, second.submissionId)).toBe("2026-10-21");
    expect(auditOf(deps, "story_planned")).toEqual([]);
  });

  it("swaps two planned stories", async () => {
    const deps = makeReviewDeps();
    const { first, second } = await twoStories(deps);
    setPlanned(deps, first, "2026-10-20");
    setPlanned(deps, second, "2026-10-21");

    expect(
      await plan(deps, first.formId, "2026-10-21", { resolution: "swap", expected: "ST-0002" }),
    ).toEqual({
      ok: true,
      plannedOn: "2026-10-21",
    });

    expect(plannedOf(deps, first.submissionId)).toBe("2026-10-21");
    expect(plannedOf(deps, second.submissionId)).toBe("2026-10-20");
    expect(auditOf(deps, "story_planned")).toEqual([
      {
        action: "story_planned",
        actorEmail: OWNER.email,
        targetId: first.submissionId,
        ip: OWNER.ip,
        details: { from: "2026-10-20", to: "2026-10-21", resolution: "swap" },
      },
      {
        action: "story_planned",
        actorEmail: OWNER.email,
        targetId: second.submissionId,
        ip: OWNER.ip,
        details: { from: "2026-10-21", to: "2026-10-20", resolution: "swap" },
      },
    ]);
  });

  it("moves the other story to waiting", async () => {
    const deps = makeReviewDeps();
    const { first, second } = await twoStories(deps);
    setPlanned(deps, first, "2026-10-20");
    setPlanned(deps, second, "2026-10-21");

    expect(
      await plan(deps, first.formId, "2026-10-21", { resolution: "move", expected: "ST-0002" }),
    ).toEqual({
      ok: true,
      plannedOn: "2026-10-21",
    });

    expect(plannedOf(deps, first.submissionId)).toBe("2026-10-21");
    expect(plannedOf(deps, second.submissionId)).toBeNull();
    expect(auditOf(deps, "story_planned").map((e) => [e.targetId, e.details])).toEqual([
      [first.submissionId, { from: "2026-10-20", to: "2026-10-21", resolution: "move" }],
      [second.submissionId, { from: "2026-10-21", to: "none", resolution: "move" }],
    ]);
  });

  it("asks again when the day's holder is not the story the dialog named", async () => {
    const deps = makeReviewDeps();
    const { first, second } = await twoStories(deps);
    setPlanned(deps, first, "2026-10-20");
    setPlanned(deps, second, "2026-10-21");

    for (const resolution of ["swap", "move"])
      expect(
        await plan(deps, first.formId, "2026-10-21", { resolution, expected: "ST-0003" }),
      ).toEqual({
        ok: false,
        code: "conflict",
        date: "2026-10-21",
        other: "ST-0002",
        canSwap: true,
      });

    expect(plannedOf(deps, first.submissionId)).toBe("2026-10-20");
    expect(plannedOf(deps, second.submissionId)).toBe("2026-10-21");
    expect(auditOf(deps, "story_planned")).toEqual([]);
  });

  it("asks again without a swap when the story lost its date before the swap", async () => {
    const deps = makeReviewDeps();
    const { first, second } = await twoStories(deps);
    setPlanned(deps, second, "2026-10-21");

    expect(
      await plan(deps, first.formId, "2026-10-21", { resolution: "swap", expected: "ST-0002" }),
    ).toEqual({
      ok: false,
      code: "conflict",
      date: "2026-10-21",
      other: "ST-0002",
      canSwap: false,
    });

    expect(plannedOf(deps, first.submissionId)).toBeNull();
    expect(plannedOf(deps, second.submissionId)).toBe("2026-10-21");
    expect(auditOf(deps, "story_planned")).toEqual([]);
  });

  it("clears a date", async () => {
    const deps = makeReviewDeps();
    const { first } = await twoStories(deps);
    setPlanned(deps, first, "2026-10-21");

    expect(await plan(deps, first.formId, "")).toEqual({ ok: true, plannedOn: null });

    expect(plannedOf(deps, first.submissionId)).toBeNull();
    expect(auditOf(deps, "story_planned").map((e) => e.details)).toEqual([
      { from: "2026-10-21", to: "none" },
    ]);
  });

  it("refuses bad dates, published stories and forms outside the plan", async () => {
    const deps = makeReviewDeps();
    const { first } = await twoStories(deps);
    expect(await plan(deps, first.formId, "2026-13-01")).toEqual({
      ok: false,
      code: "date_invalid",
    });

    const published = makeReviewDeps();
    const story = await seedStory(published, { status: "published" });
    published.stories.rows.set(story.submissionId, {
      ...emptyStory(story.submissionId, story.formId),
      plannedOn: "2026-10-16",
      publishedOn: "2026-10-16",
    });
    expect(await plan(published, story.formId, "2026-10-21")).toEqual({
      ok: false,
      code: "published",
    });
    expect(plannedOf(published, story.submissionId)).toBe("2026-10-16");

    const off = makeReviewDeps();
    const offStory = await seedStory(off, { postPlan: false });
    expect(await plan(off, offStory.formId, "2026-10-21")).toEqual({
      ok: false,
      code: "post_plan_off",
    });
    expect(await plan(deps, first.formId, "2026-10-21", { reference: "ST-9999" })).toEqual({
      ok: false,
      code: "not_found",
    });
    for (const d of [deps, published, off]) expect(auditOf(d, "story_planned")).toEqual([]);
  });

  it("a story of a form outside the plan still holds its day", async () => {
    const deps = makeReviewDeps();
    const { formId } = await seedStory(deps, { status: "viewed" });
    const event = await seedPublished(deps.definitions, {
      slug: "event-form",
      document: versionDocument(deps, formId),
      settings: { referencePrefix: "EV", usePostPlan: false },
    });
    const other = await seedAnotherStory(deps, event.formId);
    setPlanned(deps, { formId: event.formId, submissionId: other.submissionId }, "2026-10-22");

    expect(await plan(deps, formId, "2026-10-22")).toEqual({
      ok: false,
      code: "conflict",
      date: "2026-10-22",
      other: "ST-0002",
      canSwap: false,
    });
  });

  it("answers a slot refusal that escapes the day lock as a conflict", async () => {
    const deps = makeReviewDeps();
    const { first, second } = await twoStories(deps);
    setPlanned(deps, second, "2026-10-21");
    const lockDay = deps.stories.lockDay.bind(deps.stories);
    let missed = false;
    // The first look at the day misses the holder, so the write reaches the unique index.
    deps.stories.lockDay = async (uow, date) => {
      const holder = await lockDay(uow, date);
      if (missed) return holder;
      missed = true;
      return null;
    };

    expect(
      await plan(deps, first.formId, "2026-10-21", { resolution: "move", expected: "ST-0002" }),
    ).toEqual({
      ok: false,
      code: "conflict",
      date: "2026-10-21",
      other: "ST-0002",
      canSwap: false,
    });
    expect(plannedOf(deps, second.submissionId)).toBe("2026-10-21");
    expect(auditOf(deps, "story_planned")).toEqual([]);
  });
});

describe("postPlanWeek", () => {
  it("builds the week of a date", async () => {
    const deps = makeReviewDeps();
    await seedStory(deps);

    const week = await postPlanWeek(deps, OWNER, { week: "2026-10-22" });
    expect(week).toMatchObject({
      monday: "2026-10-19",
      today: "2026-10-18",
      previous: "2026-10-12",
      next: "2026-10-26",
      formsInPlan: 1,
    });
    expect(week.days.map((d) => d.date)).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
    ]);
    expect(week.days.some((d) => d.isToday || d.isPast)).toBe(false);

    const current = await postPlanWeek(deps, OWNER, { week: null });
    expect(current.monday).toBe("2026-10-12");
    expect(current.days.map((d) => [d.date, d.isToday, d.isPast])).toEqual([
      ["2026-10-12", false, true],
      ["2026-10-13", false, true],
      ["2026-10-14", false, true],
      ["2026-10-15", false, true],
      ["2026-10-16", false, true],
      ["2026-10-17", false, true],
      ["2026-10-18", true, false],
    ]);

    expect((await postPlanWeek(deps, OWNER, { week: "garbage" })).monday).toBe("2026-10-12");
  });

  it("places planned and published stories on their days", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    const versionId = versionOf(deps, story.formId);
    deps.queries.weekResult = [
      entry({
        submissionId: story.submissionId,
        formId: story.formId,
        versionId,
        plannedOn: "2026-10-20",
      }),
      entry({
        submissionId: "00000000-0000-4000-8000-000000000002",
        formId: story.formId,
        versionId,
        reference: "ST-0002",
        answers: { f_name: "  Bea Prueba " },
        status: "published",
        postUrl: LINK,
        plannedOn: "2026-10-21",
        publishedOn: "2026-10-21",
        checks: { chosen: ["m1"], photosEditedFor: ["m1"], textCheckedAt: TICKED_AT },
      }),
    ];

    const week = await postPlanWeek(deps, OWNER, { week: "2026-10-22" });

    expect(deps.queries.calls).toEqual([
      { method: "week", args: [[story.formId], "2026-10-19", "2026-10-25"] },
    ]);
    const title = deps.definitions.store.forms.get(story.formId)?.title;
    const [monday, tuesday, wednesday, ...rest] = week.days;
    expect(monday).toMatchObject({ planned: null, published: [] });
    expect(tuesday?.planned).toEqual({
      formId: story.formId,
      formTitle: title,
      reference: "ST-0001",
      label: "Ana Prueba",
      readiness: {
        photosChosen: false,
        photosEdited: false,
        textChecked: false,
        ready: false,
        done: 0,
      },
      postUrl: null,
      plannedOn: "2026-10-20",
      publishedOn: null,
    });
    expect(tuesday?.published).toEqual([]);
    expect(wednesday?.planned).toBeNull();
    expect(wednesday?.published).toEqual([
      {
        formId: story.formId,
        formTitle: title,
        reference: "ST-0002",
        label: "Bea Prueba",
        readiness: {
          photosChosen: true,
          photosEdited: true,
          textChecked: true,
          ready: true,
          done: 3,
        },
        postUrl: LINK,
        plannedOn: "2026-10-21",
        publishedOn: "2026-10-21",
      },
    ]);
    for (const day of rest) expect(day).toMatchObject({ planned: null, published: [] });
  });

  it("records each view of the plan", async () => {
    const deps = makeReviewDeps();
    await seedStory(deps);

    await postPlanWeek(deps, OWNER, { week: null });
    await postPlanWeek(deps, OWNER, { week: "2026-10-22" });

    expect(auditOf(deps, "post_plan_viewed")).toEqual([
      {
        action: "post_plan_viewed",
        actorEmail: OWNER.email,
        targetId: null,
        ip: OWNER.ip,
        details: { week: "2026-10-12" },
      },
      {
        action: "post_plan_viewed",
        actorEmail: OWNER.email,
        targetId: null,
        ip: OWNER.ip,
        details: { week: "2026-10-19" },
      },
    ]);
  });
});

describe("waitingStories", () => {
  it("lists waiting stories with the total", async () => {
    const deps = makeReviewDeps();
    const story = await seedStory(deps);
    const versionId = versionOf(deps, story.formId);
    deps.queries.waitingResult = {
      rows: [entry({ submissionId: story.submissionId, formId: story.formId, versionId })],
      total: 3,
    };

    const waiting = await waitingStories(deps, { limit: 10 });

    expect(deps.queries.calls).toEqual([{ method: "waiting", args: [[story.formId], 10] }]);
    expect(waiting.total).toBe(3);
    expect(waiting.rows).toEqual([
      {
        formId: story.formId,
        formTitle: deps.definitions.store.forms.get(story.formId)?.title,
        reference: "ST-0001",
        label: "Ana Prueba",
        readiness: {
          photosChosen: false,
          photosEdited: false,
          textChecked: false,
          ready: false,
          done: 0,
        },
        postUrl: null,
        plannedOn: null,
        publishedOn: null,
      },
    ]);
  });
});
