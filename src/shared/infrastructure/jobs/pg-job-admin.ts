import type { Pool } from "pg";
import type { DeadJob, JobAdmin } from "@/shared/application/ports/job-admin";
import type { JobPayload } from "@/shared/application/ports/job-queue";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { txOf } from "../postgres/tx";
import { isUuid } from "../uuid";
import { PgJobStore } from "./pg-job-store";

interface DeadRow {
  id: string;
  type: string;
  payload: JobPayload;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  finished_at: Date | null;
}

const DEAD_COLUMNS = "id, type, payload, attempts, last_error, created_at, finished_at";
const NEWEST_FIRST = "order by finished_at desc nulls last, id";

function toDeadJob(r: DeadRow): DeadJob {
  return {
    id: r.id,
    type: r.type,
    payload: r.payload,
    attempts: r.attempts,
    lastError: r.last_error,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  };
}

/**
 * Postgres adapter for the operator actions on the outbox. Reads are single
 * autocommitted queries; writes join the caller's unit of work. See
 * specs/use-cases/operate-jobs.md.
 */
export class PgJobAdmin implements JobAdmin {
  constructor(private readonly pool: Pool) {}

  async listDead(limit: number): Promise<DeadJob[]> {
    const res = await this.pool.query<DeadRow>(
      `select ${DEAD_COLUMNS} from job where status = 'dead' ${NEWEST_FIRST} limit $1`,
      [limit],
    );
    return res.rows.map(toDeadJob);
  }

  async deadFor(ref: { submissionId: string; mediaIds: readonly string[] }): Promise<DeadJob[]> {
    if (!isUuid(ref.submissionId)) return [];
    const mediaIds = ref.mediaIds.filter(isUuid);
    const res = await this.pool.query<DeadRow>(
      `select ${DEAD_COLUMNS} from job
        where status = 'dead'
          and (payload->>'submissionId' = $1 or payload->>'mediaId' = any($2::text[]))
        ${NEWEST_FIRST}`,
      [ref.submissionId, mediaIds],
    );
    return res.rows.map(toDeadJob);
  }

  async deadOfType(type: string, limit: number): Promise<{ count: number; jobs: DeadJob[] }> {
    const res = await this.pool.query<DeadRow & { total: number }>(
      `select ${DEAD_COLUMNS}, (count(*) over ())::int as total from job
        where status = 'dead' and type = $1
        ${NEWEST_FIRST} limit $2`,
      [type, limit],
    );
    if (res.rows.length > 0 || limit > 0) {
      return { count: res.rows[0]?.total ?? 0, jobs: res.rows.map(toDeadJob) };
    }
    // limit 0 returns no rows to carry the window count; count separately.
    const counted = await this.pool.query<{ n: number }>(
      "select count(*)::int as n from job where status = 'dead' and type = $1",
      [type],
    );
    return { count: counted.rows[0]?.n ?? 0, jobs: [] };
  }

  async retry(uow: UnitOfWork, id: string, now: Date): Promise<string | null> {
    if (!isUuid(id)) return null;
    const res = await txOf(uow).client.query<{ type: string }>(
      `update job
          set status = 'pending', attempts = 0, run_at = $2, locked_at = null, locked_by = null,
              finished_at = null, unique_key = null, updated_at = now()
        where id = $1 and status = 'dead'
        returning type`,
      [id, now],
    );
    return res.rows[0]?.type ?? null;
  }

  async discard(uow: UnitOfWork, id: string, reason: string, now: Date): Promise<string | null> {
    if (!isUuid(id)) return null;
    const res = await txOf(uow).client.query<{ type: string }>(
      `update job
          set status = 'discarded', discard_reason = $2, finished_at = $3, updated_at = now()
        where id = $1 and status = 'dead'
        returning type`,
      [id, reason, now],
    );
    return res.rows[0]?.type ?? null;
  }

  async retryAllOfType(uow: UnitOfWork, type: string, now: Date): Promise<string[]> {
    const res = await txOf(uow).client.query<{ id: string }>(
      `update job
          set status = 'pending', attempts = 0, run_at = $2, locked_at = null, locked_by = null,
              finished_at = null, unique_key = null, updated_at = now()
        where type = $1 and status = 'dead'
        returning id`,
      [type, now],
    );
    return res.rows.map((r) => r.id);
  }

  /** Reuses the worker store's heartbeat query, aged against the caller's `now`. */
  heartbeatAgeSeconds(now: Date): Promise<number | null> {
    return new PgJobStore(this.pool, { now: () => now }, { leaseSeconds: 0 }).heartbeatAgeSeconds();
  }
}
