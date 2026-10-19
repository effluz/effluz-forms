import type { PoolClient } from "pg";

export interface AlertSlot {
  key: string;
  runAt: Date;
}

const HOUR_MS = 3_600_000;

function hourKey(alertType: string, jobType: string, at: Date): string {
  return `${alertType}:${jobType}:${at.toISOString().slice(0, 13)}`;
}

/** `<alertType>:<jobType>:<YYYY-MM-DDTHH>` for the hour of `now` (UTC) and the next hour, whose run_at is that hour's start. */
export function deadAlertSlots(
  alertType: string,
  jobType: string,
  now: Date,
): { current: AlertSlot; next: AlertSlot } {
  const nextHour = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS + HOUR_MS);
  return {
    current: { key: hourKey(alertType, jobType, now), runAt: now },
    next: { key: hourKey(alertType, jobType, nextHour), runAt: nextHour },
  };
}

export interface DeadAlertOptions {
  type: string;
  maxAttempts: number;
}

async function insertSlot(
  client: PoolClient,
  alert: DeadAlertOptions,
  jobType: string,
  slot: AlertSlot,
): Promise<void> {
  await client.query(
    `insert into job (id, type, payload, status, max_attempts, run_at, unique_key)
     values ($1, $2, $3, 'pending', $4, $5, $6)
     on conflict (unique_key) where status in ('pending','running') and unique_key is not null do nothing`,
    [
      crypto.randomUUID(),
      alert.type,
      JSON.stringify({ jobType }),
      alert.maxAttempts,
      slot.runAt,
      slot.key,
    ],
  );
}

/**
 * Enqueues the grouped alert for a job of `jobType` that just went dead, on the
 * caller's transaction. A `pending` alert, or a `failed` one awaiting its retry,
 * counts as waiting; a `running` one has already read its count, so it counts as
 * finished and the death schedules the next hour. Rules: specs/system/jobs.md
 * ("Failure and retry"), decisions/0029.
 */
export async function raiseDeadAlert(
  client: PoolClient,
  alert: DeadAlertOptions,
  jobType: string,
  now: Date,
): Promise<void> {
  const { current, next } = deadAlertSlots(alert.type, jobType, now);
  const res = await client.query<{ total: number; waiting: number }>(
    `select count(*)::int as total,
            count(*) filter (where status in ('pending','failed'))::int as waiting
       from job where unique_key = $1`,
    [current.key],
  );
  const total = res.rows[0]?.total ?? 0;
  const waiting = res.rows[0]?.waiting ?? 0;
  if (total === 0) return insertSlot(client, alert, jobType, current);
  if (waiting > 0) return;
  const scheduled = await client.query("select 1 from job where unique_key = $1 limit 1", [
    next.key,
  ]);
  if ((scheduled.rowCount ?? 0) === 0) await insertSlot(client, alert, jobType, next);
}
