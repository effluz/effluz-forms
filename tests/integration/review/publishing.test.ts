import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditLog } from "@/modules/identity/application";
import {
  markPublished,
  unmarkPublished,
  type ReviewDeps,
  type StoryRepository,
} from "@/modules/review/application";
import { emptyStory } from "@/modules/review/application/ports/story-repository";
import { OWNER } from "@/modules/review/application/testing/fixtures";
import { PgStoryRepository } from "@/modules/review/infrastructure/pg-story-repository";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";
import { seedStoredStory } from "./factories";
import { pgReviewDeps } from "./wiring";

const DAY = "2026-10-20";
const LINK = "https://www.instagram.com/p/synthetic-post/";

describe("publishing in Postgres", () => {
  const pool = testPool();
  const stories = new PgStoryRepository(pool);
  let dir: string;
  beforeEach(async () => {
    await truncateAll(pool);
    dir = await mkdtemp(path.join(os.tmpdir(), "effluz-publishing-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const deps = (): ReviewDeps =>
    pgReviewDeps(pool, { staging: path.join(dir, "staging"), durable: path.join(dir, "durable") });

  async function plan(formId: string, submissionId: string, plannedOn: string): Promise<void> {
    await new PgUnitOfWorkFactory(pool).run(async (uow) => {
      await stories.lockOrCreate(uow, submissionId, formId);
      await stories.save(uow, { ...emptyStory(submissionId, formId), plannedOn }, new Date());
    });
  }

  /** Everything mark and unmark may write for the submission. */
  async function state(submissionId: string) {
    const { rows } = await pool.query<Record<string, unknown>>(
      `select s.status, s.published_post_url, s.status_changed_by,
              t.planned_on::text as planned_on, t.published_on::text as published_on,
              (select count(*)::int from audit_log a where a.target_id = s.id::text) as audits
         from submission s left join story t on t.submission_id = s.id where s.id = $1`,
      [submissionId],
    );
    return rows[0];
  }

  /** Story A planned on DAY and published, then story B planned on the freed DAY. */
  async function dayTakenMeanwhile() {
    const a = await seedStoredStory(pool, { status: "viewed" });
    const b = await seedStoredStory(pool, { formId: a.formId, status: "viewed" });
    await plan(a.formId, a.submissionId, DAY);
    expect(
      await markPublished(deps(), OWNER, {
        formId: a.formId,
        reference: a.reference,
        postUrl: LINK,
      }),
    ).toEqual({ ok: true, day: DAY });
    await plan(b.formId, b.submissionId, DAY);
    return { a, b };
  }

  it("unmark moves the story to waiting when its day was taken meanwhile", async () => {
    const { a, b } = await dayTakenMeanwhile();
    const holderBefore = await state(b.submissionId);

    expect(
      await unmarkPublished(deps(), OWNER, { formId: a.formId, reference: a.reference }),
    ).toEqual({ ok: true, status: "viewed", movedToWaiting: true, dayHeldBy: b.reference });

    expect(await state(a.submissionId)).toMatchObject({
      status: "viewed",
      published_post_url: null,
      planned_on: null,
      published_on: null,
    });
    expect(await state(b.submissionId)).toEqual(holderBefore);
  });

  it("an unmark whose unit of work fails leaves both stories as they were", async () => {
    const { a, b } = await dayTakenMeanwhile();
    const before = { a: await state(a.submissionId), b: await state(b.submissionId) };
    const real = deps();
    // The last write of the unit of work fails, after the curation and story writes.
    const failing: AuditLog = {
      record: (uow, entry, at) =>
        entry.action === "story_planned"
          ? Promise.reject(new Error("injected audit failure"))
          : real.audit.record(uow, entry, at),
    };

    await expect(
      unmarkPublished({ ...real, audit: failing }, OWNER, {
        formId: a.formId,
        reference: a.reference,
      }),
    ).rejects.toThrow("injected audit failure");

    expect(await state(a.submissionId)).toEqual(before.a);
    expect(await state(b.submissionId)).toEqual(before.b);
    expect(before.a).toMatchObject({ status: "published", planned_on: DAY, published_on: DAY });
  });

  it("an unmark whose slot write escapes the day lock runs once more", async () => {
    const { a, b } = await dayTakenMeanwhile();
    const holderBefore = await state(b.submissionId);
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

    expect(
      await unmarkPublished({ ...deps(), stories: blind }, OWNER, {
        formId: a.formId,
        reference: a.reference,
      }),
    ).toEqual({ ok: true, status: "viewed", movedToWaiting: true, dayHeldBy: b.reference });

    expect(await state(a.submissionId)).toMatchObject({
      status: "viewed",
      published_post_url: null,
      planned_on: null,
      published_on: null,
    });
    expect(await state(b.submissionId)).toEqual(holderBefore);
  });

  it("refusals write nothing", async () => {
    const story = await seedStoredStory(pool, { status: "viewed" });
    const before = await state(story.submissionId);
    const target = { formId: story.formId, reference: story.reference };

    expect(
      await markPublished(deps(), OWNER, { ...target, postUrl: "http://www.instagram.com/p/x/" }),
    ).toEqual({ ok: false, code: "post_url_invalid" });
    expect(await unmarkPublished(deps(), OWNER, target)).toEqual({
      ok: false,
      code: "not_published",
    });

    expect(await state(story.submissionId)).toEqual(before);
  });
});
