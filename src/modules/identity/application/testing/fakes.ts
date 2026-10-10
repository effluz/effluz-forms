/**
 * In-memory fakes for identity use-case tests, shared with the route tests.
 *
 * - `makeDeps(overrides?)` builds a full `IdentityDeps` wired to the fakes below
 *   and returns the concrete fakes too, so tests can seed and inspect them.
 * - `FixedClock`: `set(date)`, `advance(ms)`; starts at 2026-10-10T09:00:00Z.
 * - `SequentialIdGenerator`: `id-1`, `id-2`, ...
 * - `InMemorySessionRepository`: `seed(session)`, `all()`, `has(id)`.
 * - `InMemoryAuditLog`: `entries` as `{ entry, at }`.
 * - `InMemorySignInAttemptStore`: `seed(attempt)`, `size()`; honours the 10-minute expiry.
 * - `ScriptedAdminIdentity`: `script(completion)` queues the next completion;
 *   `beginCalls` and `completeCalls` record the arguments received.
 * - `FakeUnitOfWorkFactory`: runs the callback with a plain unit of work. The fakes
 *   write immediately, so rollback is NOT simulated; the Postgres integration
 *   tests cover rollback fidelity.
 *
 * Synthetic data only. Not for production code.
 */
import type { Clock } from "@/shared/application/ports/clock";
import type { IdGenerator } from "@/shared/application/ports/id-generator";
import type { UnitOfWork, UnitOfWorkFactory } from "@/shared/application/ports/unit-of-work";
import type { AuditEntry } from "../../domain/audit";
import type { Session } from "../../domain/session";
import type { IdentityDeps } from "../deps";
import type {
  AdminIdentity,
  CallbackInput,
  SignInCompletion,
  SignInStart,
} from "../ports/admin-identity";
import type { AuditLog } from "../ports/audit-log";
import type { SessionRepository } from "../ports/session-repository";
import type { SignInAttempt, SignInAttemptStore } from "../ports/sign-in-attempt-store";

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

export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  newId(): string {
    this.counter += 1;
    return `id-${String(this.counter)}`;
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

export class InMemorySessionRepository implements SessionRepository {
  private readonly rows = new Map<string, Session>();

  seed(session: Session): void {
    this.rows.set(session.id, { ...session });
  }

  all(): Session[] {
    return [...this.rows.values()];
  }

  has(id: string): boolean {
    return this.rows.has(id);
  }

  create(_uow: UnitOfWork, session: Session): Promise<void> {
    this.rows.set(session.id, { ...session });
    return Promise.resolve();
  }

  findById(id: string): Promise<Session | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row ? { ...row } : null);
  }

  touch(id: string, lastSeenAt: Date): Promise<void> {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, lastSeenAt: new Date(lastSeenAt.getTime()) });
    return Promise.resolve();
  }

  delete(_uow: UnitOfWork, id: string): Promise<void> {
    this.rows.delete(id);
    return Promise.resolve();
  }

  deleteAllForEmail(_uow: UnitOfWork, email: string): Promise<number> {
    let removed = 0;
    for (const [id, row] of this.rows) {
      if (row.email === email) {
        this.rows.delete(id);
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  }
}

export class InMemoryAuditLog implements AuditLog {
  readonly entries: { entry: AuditEntry; at: Date }[] = [];

  record(_uow: UnitOfWork, entry: AuditEntry, at: Date): Promise<void> {
    this.entries.push({ entry, at: new Date(at.getTime()) });
    return Promise.resolve();
  }
}

const ATTEMPT_TTL_MS = 10 * 60 * 1000;

export class InMemorySignInAttemptStore implements SignInAttemptStore {
  private readonly rows = new Map<string, SignInAttempt>();

  seed(attempt: SignInAttempt): void {
    this.rows.set(attempt.id, { ...attempt });
  }

  size(): number {
    return this.rows.size;
  }

  create(attempt: SignInAttempt): Promise<void> {
    this.rows.set(attempt.id, { ...attempt });
    return Promise.resolve();
  }

  consume(id: string, now: Date): Promise<SignInAttempt | null> {
    const row = this.rows.get(id);
    if (!row) return Promise.resolve(null);
    this.rows.delete(id);
    const expired = now.getTime() > row.createdAt.getTime() + ATTEMPT_TTL_MS;
    return Promise.resolve(expired ? null : row);
  }
}

export interface CompleteCall {
  input: CallbackInput;
  expected: { state: string; nonce: string; codeVerifier: string; redirectUri: string };
}

export class ScriptedAdminIdentity implements AdminIdentity {
  readonly start: SignInStart = {
    authorizationUrl: "https://accounts.example.com/authorize?state=state-1",
    state: "state-1",
    nonce: "nonce-1",
    codeVerifier: "verifier-1",
  };
  readonly beginCalls: string[] = [];
  readonly completeCalls: CompleteCall[] = [];
  private readonly queue: SignInCompletion[] = [];

  script(completion: SignInCompletion): void {
    this.queue.push(completion);
  }

  beginSignIn(redirectUri: string): Promise<SignInStart> {
    this.beginCalls.push(redirectUri);
    return Promise.resolve({ ...this.start });
  }

  completeSignIn(
    input: CallbackInput,
    expected: CompleteCall["expected"],
  ): Promise<SignInCompletion> {
    this.completeCalls.push({ input, expected });
    const next = this.queue.shift();
    if (!next) return Promise.reject(new Error("ScriptedAdminIdentity: no completion scripted"));
    return Promise.resolve(next);
  }
}

export interface FakeIdentityDeps extends IdentityDeps {
  identity: ScriptedAdminIdentity;
  sessions: InMemorySessionRepository;
  audit: InMemoryAuditLog;
  attempts: InMemorySignInAttemptStore;
  uow: FakeUnitOfWorkFactory;
  clock: FixedClock;
  ids: SequentialIdGenerator;
}

export function makeDeps(overrides: Partial<FakeIdentityDeps> = {}): FakeIdentityDeps {
  return {
    identity: new ScriptedAdminIdentity(),
    sessions: new InMemorySessionRepository(),
    audit: new InMemoryAuditLog(),
    attempts: new InMemorySignInAttemptStore(),
    uow: new FakeUnitOfWorkFactory(),
    clock: new FixedClock(),
    ids: new SequentialIdGenerator(),
    allowedHostedDomain: "effluz.com",
    publicBaseUrl: "https://forms.example.com",
    ...overrides,
  };
}
