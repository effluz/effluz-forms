import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditLog } from "@/modules/identity/application";
import {
  planStory,
  saveCorrection,
  type ReviewDeps,
  type StoryRepository,
} from "@/modules/review/application";
import { emptyStory } from "@/modules/review/application/ports/story-repository";
import { OWNER } from "@/modules/review/application/testing/fixtures";
import { PgStoryRepository } from "@/modules/review/infrastructure/pg-story-repository";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";
import { seedPublishedForm } from "../submissions/factories";
import { seedStoredStory } from "./factories";
import { pgReviewDeps } from "./wiring";

const DAY = "2026-10-21";

describe("planning in Postgres", () => {
  const pool = testPool();
  const stories = new PgStoryRepository(pool);
  let dir: string;
  beforeEach(async () => {
    await truncateAll(pool);
    dir = await mkdtemp(path.join(os.tmpdir(), "effluz-plan-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const deps = (): ReviewDeps =>
    pgReviewDeps(pool, { staging: path.join(dir, "staging"), durable: path.join(dir, "durable") });

  /** Two stories, ST-A and ST-B, on one post-plan form. */
  async function twoStories() {
    const { formId } = await seedPublishedForm(pool, undefined, { usePostPlan: true });
    const a = await seedStoredStory(pool, { formId, status: "viewed" });
    const b = await seedStoredStory(pool, {
      formId,
      status: "viewed",
      answers: { f_name: "Bea Prueba" },
    });
    return { formId, a, b };
  }

  async function setPlanned(formId: string, submissionId: string, plannedOn: string) {
    await new PgUnitOfWorkFactory(pool).run(async (uow) => {
      await stories.lockOrCreate(uow, submissionId, formId);
      await stories.save(uow, { ...emptyStory(submissionId, formId), plannedOn }, new Date());
    });
  }

  async function plannedOn(submissionId: string): Promise<string | null> {
    const { rows } = await pool.query<{ planned_on: string | null }>(
      "select planned_on::text as planned_on from story where submission_id = $1",
      [submissionId],
    );
    return rows[0]?.planned_on ?? null;
  }

  /** The story row and the audit entries of the submission, as text. */
  async function state(submissionId: string) {
    const { rows } = await pool.query<Record<string, unknown>>(
      `select (select row_to_json(t)::text from story t where t.submission_id = s.id) as story,
              (select count(*)::int from audit_log a where a.target_id = s.id::text) as audits
         from submission s where s.id = $1`,
      [submissionId],
    );
    return rows[0];
  }

  const plan = (
    review: ReviewDeps,
    formId: string,
    reference: string,
    date: string,
    resolution = "",
  ) => planStory(review, OWNER, { formId, reference, date, resolution });

  it("two planners racing for one day: one wins, one is asked", async () => {
    const { formId, a, b } = await twoStories();

    const results = await Promise.all([
      plan(deps(), formId, a.reference, DAY),
      plan(deps(), formId, b.reference, DAY),
    ]);

    const won = results.filter((r) => r.ok);
    const asked = results.filter((r) => !r.ok);
    expect(won).toEqual([{ ok: true, plannedOn: DAY }]);
    const winner = results[0].ok ? a : b;
    expect(asked).toEqual([
      { ok: false, code: "conflict", date: DAY, other: winner.reference, canSwap: false },
    ]);
    const { rows } = await pool.query<{ n: number }>(
      "select count(*)::int as n from story where planned_on = $1::date",
      [DAY],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("two crossing swaps both complete", async () => {
    const { formId, a, b } = await twoStories();
    await setPlanned(formId, a.submissionId, "2026-10-20");
    await setPlanned(formId, b.submissionId, DAY);

    const results = await Promise.all([
      plan(deps(), formId, a.reference, DAY, "swap"),
      plan(deps(), formId, b.reference, "2026-10-20", "swap"),
    ]);

    expect(results).toEqual([
      { ok: true, plannedOn: DAY },
      { ok: true, plannedOn: "2026-10-20" },
    ]);
    expect(await plannedOn(a.submissionId)).toBe(DAY);
    expect(await plannedOn(b.submissionId)).toBe("2026-10-20");
  });

  it("planning against a curation of the holder both complete", async () => {
    const { formId, a, b } = await twoStories();
    await setPlanned(formId, b.submissionId, DAY);

    const [planned, corrected] = await Promise.all([
      plan(deps(), formId, a.reference, DAY, "move"),
      saveCorrection(deps(), OWNER, {
        formId,
        reference: b.reference,
        fieldKey: "f_name",
        text: "Bea Prueba.",
      }),
    ]);

    expect(planned).toEqual({ ok: true, plannedOn: DAY });
    expect(corrected).toEqual({ ok: true, changed: true });
    expect(await plannedOn(a.submissionId)).toBe(DAY);
    expect(await plannedOn(b.submissionId)).toBeNull();
    const { rows } = await pool.query<{ curated: Record<string, string> }>(
      "select curated_answers as curated from submission where id = $1",
      [b.submissionId],
    );
    expect(rows[0]?.curated).toEqual({ f_name: "Bea Prueba." });
  });

  it("a swap whose unit of work fails leaves both stories as they were", async () => {
    const { formId, a, b } = await twoStories();
    await setPlanned(formId, a.submissionId, "2026-10-20");
    await setPlanned(formId, b.submissionId, DAY);
    const before = { a: await state(a.submissionId), b: await state(b.submissionId) };
    const real = deps();
    // The holder's entry is the last write, after every story row was saved.
    const failing: AuditLog = {
      record: (uow, entry, at) =>
        entry.action === "story_planned" && entry.targetId === b.submissionId
          ? Promise.reject(new Error("injected audit failure"))
          : real.audit.record(uow, entry, at),
    };

    await expect(
      plan({ ...real, audit: failing }, formId, a.reference, DAY, "swap"),
    ).rejects.toThrow("injected audit failure");

    expect(await state(a.submissionId)).toEqual(before.a);
    expect(await state(b.submissionId)).toEqual(before.b);
  });

  it("a slot refusal that escapes the day lock is answered as a conflict", async () => {
    const { formId, a, b } = await twoStories();
    await setPlanned(formId, b.submissionId, DAY);
    const before = { a: await state(a.submissionId), b: await state(b.submissionId) };
    let missed = false;
    // The first look at the day misses the holder, so the write reaches the unique index.
    const blind: StoryRepository = {
      find: (id) => stories.find(id),
      lockOrCreate: (uow, id, form) => stories.lockOrCreate(uow, id, form),
      lockDay: async (uow, date) => {
        const holder = await stories.lockDay(uow, date);
        if (missed) return holder;
        missed = true;
        return null;
      },
      save: (uow, row, at) => stories.save(uow, row, at),
    };

    expect(await plan({ ...deps(), stories: blind }, formId, a.reference, DAY, "move")).toEqual({
      ok: false,
      code: "conflict",
      date: DAY,
      other: b.reference,
      canSwap: false,
    });
    expect(await state(a.submissionId)).toEqual(before.a);
    expect(await state(b.submissionId)).toEqual(before.b);
  });
});
