import type { Pool } from "pg";
import type { SubmissionStats, SubmissionSummary } from "@/modules/definitions/application";
import type { Key } from "@/shared/domain/form-model";
import { isUuid } from "@/shared/infrastructure/uuid";

const NONE: SubmissionSummary = { total: 0, lastReceivedAt: null };

/**
 * Postgres adapter for the figures `definitions` reads (its `SubmissionStats`
 * port). A form id that is not a UUID names no form and has zero figures.
 */
export class PgSubmissionStats implements SubmissionStats {
  constructor(private readonly pool: Pool) {}

  async summary(formIds: readonly string[]): Promise<Map<string, SubmissionSummary>> {
    const summary = new Map<string, SubmissionSummary>(formIds.map((id) => [id, { ...NONE }]));
    const ids = formIds.filter(isUuid);
    if (ids.length === 0) return summary;
    const { rows } = await this.pool.query<{
      form_id: string;
      total: number;
      last_received_at: Date | null;
    }>(
      `select form_id, count(*)::int as total, max(received_at) as last_received_at
         from submission where form_id = any($1::uuid[]) group by form_id`,
      [ids],
    );
    for (const row of rows)
      summary.set(row.form_id, { total: row.total, lastReceivedAt: row.last_received_at });
    return summary;
  }

  async countReceivedAfter(formId: string, after: Date): Promise<number> {
    if (!isUuid(formId)) return 0;
    const { rows } = await this.pool.query<{ n: number }>(
      "select count(*)::int as n from submission where form_id = $1 and received_at > $2",
      [formId, after],
    );
    return rows[0]?.n ?? 0;
  }

  async countOlderThan(formId: string, months: number, now: Date): Promise<number> {
    if (!isUuid(formId)) return 0;
    // Month arithmetic on a timestamptz follows the session time zone; it runs on UTC
    // wall-clock time instead, so the cutoff never depends on the server's setting.
    const { rows } = await this.pool.query<{ n: number }>(
      `select count(*)::int as n from submission
        where form_id = $1
          and received_at <
            ((($3::timestamptz) at time zone 'UTC') - make_interval(months => $2))
              at time zone 'UTC'`,
      [formId, months, now],
    );
    return rows[0]?.n ?? 0;
  }

  async answerCounts(formId: string, keys: readonly Key[]): Promise<Map<Key, number>> {
    const counts = new Map<Key, number>(keys.map((key) => [key, 0]));
    if (!isUuid(formId) || keys.length === 0) return counts;
    const { rows } = await this.pool.query<{ key: string; n: number }>(
      `select k.key, count(*)::int as n
         from submission s, jsonb_object_keys(s.answers) as k(key)
        where s.form_id = $1 and k.key = any($2::text[])
        group by k.key`,
      [formId, keys],
    );
    for (const row of rows) {
      const key = keys.find((k) => k === row.key);
      if (key !== undefined) counts.set(key, row.n);
    }
    return counts;
  }

  async hasAny(formId: string): Promise<boolean> {
    if (!isUuid(formId)) return false;
    const { rows } = await this.pool.query<{ found: boolean }>(
      "select exists (select 1 from submission where form_id = $1) as found",
      [formId],
    );
    return rows[0]?.found ?? false;
  }
}
