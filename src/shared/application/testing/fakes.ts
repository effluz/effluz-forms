/**
 * In-memory fakes for the shared ports, used by every module's use-case tests.
 *
 * - `FixedClock`: `set(date)`, `advance(ms)`; starts at 2026-10-10T09:00:00Z.
 * - `SequentialIdGenerator`: UUID-shaped ids ending in 1, 2, ..., see `fakeUuid(n)`.
 * - `FakeUnitOfWorkFactory`: runs the callback with a plain unit of work. The fakes
 *   write immediately, so rollback is NOT simulated; the Postgres integration
 *   tests cover rollback fidelity.
 * - `InMemoryAuditLog`: `entries` as `{ entry, at }`. Shared code may not import
 *   identity, which owns the audit port, so the entry shapes below are
 *   structural twins of identity's `AuditEntry`, `AuditRecord` and `AuditQuery`,
 *   and the personal-data guard is passed in (identity's `assertNoPersonalData`).
 * - `InMemoryAuditLogReader`: reads the same `entries`; ids are `audit-<n>` by
 *   insertion order. Mirrors `PgAuditLogReader` ordering, filters (including the `(createdAt, id)` cursor),
 *   cap (given to the constructor) and handling of malformed limits and cursors.
 * - `InMemoryJobQueue`: `enqueued` as `{ type, payload, opts }`, `ofType(type)`;
 *   ids are `job-<n>`; a `uniqueKey` already recorded returns null; `failAt`
 *   makes the nth enqueue (0-based) throw. `opts` is recorded as passed (no
 *   `runAt` or `maxAttempts` defaults are applied), and a unique key is never
 *   released, unlike the real queue, which frees it once the job finishes.
 * - `RecordingLogger`: `lines` as `{ level, msg, fields }`; children share them.
 * - `handlerContext(over)`: a `JobHandlerContext` built from the fakes above.
 *
 * Synthetic data only. Not for production code.
 */
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { EnqueueOptions, JobHandlerContext, JobPayload, JobQueue } from "../ports/job-queue";
import type { LogFields, Logger, LogLevel } from "../ports/logger";
import type { UnitOfWork, UnitOfWorkFactory } from "../ports/unit-of-work";

export class FixedClock implements Clock {
  private current: Date;

  constructor(start: Date = new Date("2026-10-10T09:00:00Z")) {
    this.current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(date: Date): void {
    this.current = new Date(date.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/**
 * The `n`th id `SequentialIdGenerator` returns: `00000001-0000-4000-8000-000000000001`
 * for 1. The counter also fills the first group (in hex), so keys derived from
 * an id's first eight hex digits, as definitions' `newKey` derives them, stay unique.
 */
export function fakeUuid(n: number): string {
  return `${n.toString(16).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  newId(): string {
    this.counter += 1;
    return fakeUuid(this.counter);
  }
}

function plainUnitOfWork(): UnitOfWork {
  return {
    handle: null,
    commit: () => Promise.resolve(),
    rollback: () => Promise.resolve(),
  };
}

export class FakeUnitOfWorkFactory implements UnitOfWorkFactory {
  begin(): Promise<UnitOfWork> {
    return Promise.resolve(plainUnitOfWork());
  }

  run<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    return fn(plainUnitOfWork());
  }
}

export type FakeAuditDetails = Record<string, string | number | boolean>;

/** Structural twin of identity's `AuditEntry`. */
export interface FakeAuditEntry {
  action: string;
  actorEmail: string | null;
  targetId: string | null;
  ip: string | null;
  details?: FakeAuditDetails;
}

/** Structural twin of identity's `AuditRecord`. */
export interface FakeAuditRecord {
  id: string;
  action: string;
  actorEmail: string | null;
  targetId: string | null;
  ip: string | null;
  details: FakeAuditDetails | null;
  at: Date;
}

/** Structural twin of identity's `AuditQuery`. */
export interface FakeAuditQuery {
  targetId: string;
  action?: string;
  actorEmail?: string;
  before?: Date;
  beforeId?: string;
  limit: number;
}

export class InMemoryAuditLog {
  readonly entries: { entry: FakeAuditEntry; at: Date }[] = [];

  /** `guard` throws on personal data in the details, as the Postgres log does. */
  constructor(private readonly guard: (details: FakeAuditDetails | undefined) => void) {}

  record(_uow: UnitOfWork, entry: FakeAuditEntry, at: Date): Promise<void> {
    this.guard(entry.details);
    this.entries.push({ entry, at: new Date(at.getTime()) });
    return Promise.resolve();
  }
}

/** The insertion number inside an `audit-<n>` id; an id that is not one sorts first. */
function fakeAuditOrdinal(id: string): number {
  const match = /^audit-(\d+)$/.exec(id);
  return match?.[1] === undefined ? 0 : Number(match[1]);
}

export class InMemoryAuditLogReader {
  /**
   * `pageMax` is identity's exported `AUDIT_PAGE_MAX`, passed in because shared
   * code may not import identity.
   */
  constructor(
    private readonly log: InMemoryAuditLog,
    private readonly pageMax: number,
  ) {}

  listByTarget(query: FakeAuditQuery): Promise<FakeAuditRecord[]> {
    if (!Number.isFinite(query.limit) || query.limit <= 0) return Promise.resolve([]);
    const limit = Math.min(Math.floor(query.limit), this.pageMax);
    // Like the Postgres reader, an unusable cursor is no cursor.
    const before =
      query.before !== undefined && !Number.isNaN(query.before.getTime())
        ? query.before
        : undefined;
    const beforeId =
      query.beforeId !== undefined && /^audit-\d+$/.test(query.beforeId)
        ? query.beforeId
        : undefined;
    const found = this.log.entries
      .map(({ entry, at }, index) => ({ entry, at, index }))
      .filter(({ entry, at, index }) => {
        if (entry.targetId !== query.targetId) return false;
        if (query.action !== undefined && entry.action !== query.action) return false;
        if (query.actorEmail !== undefined && entry.actorEmail !== query.actorEmail) return false;
        if (before !== undefined) {
          const cut = before.getTime();
          if (at.getTime() > cut) return false;
          if (at.getTime() === cut) {
            // Same instant: with an id cursor keep only rows after it, otherwise none.
            if (beforeId === undefined) return false;
            if (index + 1 >= fakeAuditOrdinal(beforeId)) return false;
          }
        }
        return true;
      })
      .sort((a, b) => b.at.getTime() - a.at.getTime() || b.index - a.index)
      .slice(0, limit)
      .map(({ entry, at, index }): FakeAuditRecord => ({
        id: `audit-${String(index + 1)}`,
        action: entry.action,
        actorEmail: entry.actorEmail,
        targetId: entry.targetId,
        ip: entry.ip,
        details: entry.details === undefined ? null : { ...entry.details },
        at: new Date(at.getTime()),
      }));
    return Promise.resolve(found);
  }

  actorsForTarget(targetId: string): Promise<string[]> {
    const actors = new Set<string>();
    for (const { entry } of this.log.entries) {
      if (entry.targetId === targetId && entry.actorEmail !== null) actors.add(entry.actorEmail);
    }
    return Promise.resolve([...actors].sort());
  }
}

export interface EnqueuedJob {
  type: string;
  payload: JobPayload;
  opts: EnqueueOptions;
}

export class InMemoryJobQueue implements JobQueue {
  readonly enqueued: EnqueuedJob[] = [];
  /** When set, the nth enqueue (0-based, over this queue's life) throws. */
  failAt: number | null = null;
  private calls = 0;

  enqueue(
    _uow: UnitOfWork,
    type: string,
    payload: JobPayload,
    opts: EnqueueOptions = {},
  ): Promise<string | null> {
    const call = this.calls;
    this.calls += 1;
    if (this.failAt === call) return Promise.reject(new Error("injected enqueue failure"));
    if (
      opts.uniqueKey !== undefined &&
      this.enqueued.some((j) => j.opts.uniqueKey === opts.uniqueKey)
    )
      return Promise.resolve(null);
    this.enqueued.push({ type, payload: { ...payload }, opts: { ...opts } });
    return Promise.resolve(`job-${String(this.enqueued.length)}`);
  }

  ofType(type: string): EnqueuedJob[] {
    return this.enqueued.filter((j) => j.type === type);
  }
}

export interface LoggedLine {
  level: LogLevel;
  msg: string;
  fields: LogFields;
}

export class RecordingLogger implements Logger {
  constructor(
    readonly lines: LoggedLine[] = [],
    private readonly base: LogFields = {},
  ) {}

  debug(msg: string, fields?: LogFields): void {
    this.write("debug", msg, fields);
  }

  info(msg: string, fields?: LogFields): void {
    this.write("info", msg, fields);
  }

  warn(msg: string, fields?: LogFields): void {
    this.write("warn", msg, fields);
  }

  error(msg: string, fields?: LogFields): void {
    this.write("error", msg, fields);
  }

  child(fields: LogFields): Logger {
    return new RecordingLogger(this.lines, { ...this.base, ...fields });
  }

  private write(level: LogLevel, msg: string, fields?: LogFields): void {
    this.lines.push({ level, msg, fields: { ...this.base, ...fields } });
  }
}

/** A handler context over the fakes; `over` replaces any of its parts. */
export function handlerContext(over: Partial<JobHandlerContext> = {}): JobHandlerContext {
  return {
    jobId: "job-under-test",
    attempt: 1,
    maxAttempts: 8,
    logger: new RecordingLogger(),
    uow: new FakeUnitOfWorkFactory(),
    queue: new InMemoryJobQueue(),
    clock: new FixedClock(),
    ...over,
  };
}
