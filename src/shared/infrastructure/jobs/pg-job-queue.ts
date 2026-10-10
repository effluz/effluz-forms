import type { Clock } from "@/shared/application/ports/clock";
import type { IdGenerator } from "@/shared/application/ports/id-generator";
import {
  DEFAULT_MAX_ATTEMPTS,
  type EnqueueOptions,
  type JobPayload,
  type JobQueue,
} from "@/shared/application/ports/job-queue";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { txOf } from "../postgres/tx";

/** Postgres outbox adapter; see specs/system/jobs.md. */
export class PgJobQueue implements JobQueue {
  constructor(
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async enqueue(
    uow: UnitOfWork,
    type: string,
    payload: JobPayload,
    opts: EnqueueOptions = {},
  ): Promise<string | null> {
    const { client } = txOf(uow);
    const id = this.ids.newId();
    const res = await client.query(
      `insert into job (id, type, payload, status, max_attempts, run_at, unique_key)
       values ($1, $2, $3, 'pending', $4, $5, $6)
       on conflict (unique_key) where status in ('pending','running') and unique_key is not null do nothing
       returning id`,
      [
        id,
        type,
        JSON.stringify(payload),
        opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        opts.runAt ?? this.clock.now(),
        opts.uniqueKey ?? null,
      ],
    );
    return res.rowCount === 1 ? id : null;
  }
}
