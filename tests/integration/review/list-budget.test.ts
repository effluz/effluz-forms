import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPTY_QUERY, openStory } from "@/modules/review/application";
import type { ListFilter } from "@/modules/review/application/ports/review-queries";
import { OWNER } from "@/modules/review/application/testing/fixtures";
import { PgReviewQueries } from "@/modules/review/infrastructure/pg-review-queries";
import { testPool, truncateAll } from "../db";
import { seedPublishedForm } from "../submissions/factories";
import { pgReviewDeps } from "./wiring";

// specs/ui-ux/manager.md, "Performance targets".
const LIST_BUDGET_MS = 500;
const STORY_BUDGET_MS = 300;

describe("the review budgets", () => {
  const pool = testPool();
  let dir: string;
  beforeEach(async () => {
    await truncateAll(pool);
    dir = await mkdtemp(path.join(os.tmpdir(), "effluz-budget-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  /**
   * 10,000 submissions on one form, with photos on the first 1,000, 50 planned stories and a
   * job history with dead jobs. Synthetic rows only: "Prueba <n>" names, one a minute.
   */
  async function seedTenThousand(): Promise<{ formId: string }> {
    const { formId, versionId } = await seedPublishedForm(pool, undefined, { usePostPlan: true });
    await pool.query(
      `insert into submission (id, form_id, form_version_id, locale, answers, received_at,
         reference, submit_token)
       select gen_random_uuid(), $1, $2, 'es', jsonb_build_object('f_name', 'Prueba ' || n),
              timestamptz '2026-10-18 15:00:00+00' - n * interval '1 minute',
              'BT-' || lpad(n::text, 5, '0'), gen_random_uuid()
         from generate_series(1, 10000) as n`,
      [formId, versionId],
    );
    await pool.query(
      `insert into media (id, submission_id, form_id, field_key, position, kind, status,
         content_type, size, durable_key)
       select gen_random_uuid(), s.id, s.form_id, 'f_photos', p, 'image', 'stored', 'image/jpeg',
              1000, '/forms/budget/' || s.reference || '-' || p || '.jpg'
         from (select id, form_id, reference from submission order by reference limit 1000) s
        cross join generate_series(1, 2) as p`,
    );
    await pool.query(
      `insert into story (submission_id, form_id, planned_on)
       select id, form_id, date '2026-10-01' + (row_number() over (order by reference))::int
         from (select id, form_id, reference from submission order by reference limit 50) s`,
    );
    // A job history to scan for the dead flag: one job a media row, one in a hundred dead.
    await pool.query(
      `insert into job (id, type, payload, status)
       select gen_random_uuid(), 'media.upload', jsonb_build_object('mediaId', m.id::text),
              case when row_number() over (order by m.id) % 100 = 0 then 'dead' else 'succeeded' end
         from media m`,
    );
    await pool.query("analyze submission; analyze media; analyze story; analyze job");
    return { formId };
  }

  it("lists page 1 of 10,000 submissions within 500 ms", { timeout: 60_000 }, async () => {
    const { formId } = await seedTenThousand();
    const queries = new PgReviewQueries(pool);
    const filter: ListFilter = {
      formId,
      status: null,
      plan: null,
      from: null,
      to: null,
      versionId: null,
      media: false,
      search: { text: "prueba 99", keys: ["f_name"] },
    };
    await queries.list(filter, 1);
    await queries.count(filter);

    const started = performance.now();
    const { rows, total } = await queries.list(filter, 1);
    const counted = await queries.count(filter);
    const elapsed = performance.now() - started;

    expect(rows.length).toBe(50);
    expect(total).toBe(counted);
    expect(elapsed).toBeLessThan(LIST_BUDGET_MS);
  });

  it("opens a story among 10,000 within 300 ms", { timeout: 60_000 }, async () => {
    const { formId } = await seedTenThousand();
    const deps = pgReviewDeps(pool, {
      staging: path.join(dir, "staging"),
      durable: path.join(dir, "durable"),
    });
    const open = (reference: string) =>
      openStory(deps, OWNER, { formId, reference, query: EMPTY_QUERY });
    // BT-00500 has two photos whose jobs are looked up; opening BT-00499 first warms the pool.
    await open("BT-00499");

    const started = performance.now();
    const view = await open("BT-00500");
    const elapsed = performance.now() - started;

    expect(view?.reference).toBe("BT-00500");
    expect(view?.photos.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(STORY_BUDGET_MS);
  });
});
