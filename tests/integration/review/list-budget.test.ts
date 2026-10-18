import { describe, expect, it } from "vitest";
import type { ListFilter } from "@/modules/review/application/ports/review-queries";
import { PgReviewQueries } from "@/modules/review/infrastructure/pg-review-queries";
import { testPool, truncateAll } from "../db";
import { seedPublishedForm } from "../submissions/factories";

const BUDGET_MS = 500;

describe("the review list budget", () => {
  const pool = testPool();

  it("lists page 1 of 10,000 submissions within 500 ms", { timeout: 60_000 }, async () => {
    await truncateAll(pool);
    const { formId, versionId } = await seedPublishedForm(pool);
    // Synthetic rows only: "Prueba <n>" names, one a minute.
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
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
