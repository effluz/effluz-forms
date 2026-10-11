/**
 * In-memory fakes for identity use-case tests, shared with the route tests.
 * The clock, id, unit-of-work and audit fakes live in
 * `@/shared/application/testing/fakes` and are re-exported here.
 *
 * - `makeDeps(overrides?)` builds a full `IdentityDeps` wired to the fakes below
 *   and returns the concrete fakes too, so tests can seed and inspect them.
 * - `InMemorySessionRepository`: `seed(session)`, `all()`, `has(id)`.
 * - Like the Postgres adapters, the session and attempt fakes treat an id that is
 *   not a UUID as absent (reads return null, writes keyed by it do nothing), and
 *   refuse to store a row under one.
 * - `InMemoryAuditLog`: the shared log with `assertNoPersonalData` as its guard.
 * - `InMemoryAuditLogReader`: the shared reader, typed against identity's port.
 * - `InMemorySignInAttemptStore`: `seed(attempt)`, `size()`; honours the 10-minute expiry.
 * - `ScriptedAdminIdentity`: `script(completion)` queues the next completion;
 *   `beginCalls` and `completeCalls` record the arguments received.
 *
 * Synthetic data only. Not for production code.
 */
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import {
  FakeUnitOfWorkFactory,
  FixedClock,
  InMemoryAuditLog as SharedInMemoryAuditLog,
  InMemoryAuditLogReader as SharedInMemoryAuditLogReader,
  SequentialIdGenerator,
} from "@/shared/application/testing/fakes";
import { assertNoPersonalData } from "../../domain/audit";
import type { Session } from "../../domain/session";
import type { IdentityDeps } from "../deps";
import type {
  AdminIdentity,
  CallbackInput,
  SignInCompletion,
  SignInStart,
} from "../ports/admin-identity";
import type { AuditLog } from "../ports/audit-log";
import type { AuditLogReader } from "../ports/audit-log-reader";
import type { SessionRepository } from "../ports/session-repository";
import type { SignInAttempt, SignInAttemptStore } from "../ports/sign-in-attempt-store";

// Moved to the shared kernel, which definitions also uses; re-exported so callers keep this path.
export { FakeUnitOfWorkFactory, FixedClock, SequentialIdGenerator };
export { fakeUuid } from "@/shared/application/testing/fakes";

// Mirrors infrastructure/uuid.ts, which this layer may not import.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(id: string): void {
  if (!UUID.test(id)) throw new Error("fake store: id must be a UUID, as the uuid column requires");
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly rows = new Map<string, Session>();

  seed(session: Session): void {
    requireUuid(session.id);
    this.rows.set(session.id, { ...session });
  }

  all(): Session[] {
    return [...this.rows.values()];
  }

  has(id: string): boolean {
    return this.rows.has(id);
  }

  create(_uow: UnitOfWork, session: Session): Promise<void> {
    requireUuid(session.id);
    this.rows.set(session.id, { ...session });
    return Promise.resolve();
  }

  findById(id: string): Promise<Session | null> {
    if (!UUID.test(id)) return Promise.resolve(null);
    const row = this.rows.get(id);
    return Promise.resolve(row ? { ...row } : null);
  }

  touch(id: string, lastSeenAt: Date): Promise<void> {
    if (!UUID.test(id)) return Promise.resolve();
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

/** The shared in-memory log with identity's personal-data guard wired in. */
export class InMemoryAuditLog extends SharedInMemoryAuditLog implements AuditLog {
  constructor() {
    super(assertNoPersonalData);
  }
}

/** The shared reader, checked against identity's port. */
export class InMemoryAuditLogReader
  extends SharedInMemoryAuditLogReader
  implements AuditLogReader {}

const ATTEMPT_TTL_MS = 10 * 60 * 1000;

export class InMemorySignInAttemptStore implements SignInAttemptStore {
  private readonly rows = new Map<string, SignInAttempt>();

  seed(attempt: SignInAttempt): void {
    requireUuid(attempt.id);
    this.rows.set(attempt.id, { ...attempt });
  }

  size(): number {
    return this.rows.size;
  }

  create(attempt: SignInAttempt): Promise<void> {
    requireUuid(attempt.id);
    this.rows.set(attempt.id, { ...attempt });
    return Promise.resolve();
  }

  consume(id: string, now: Date): Promise<SignInAttempt | null> {
    if (!UUID.test(id)) return Promise.resolve(null);
    const row = this.rows.get(id);
    if (!row) return Promise.resolve(null);
    this.rows.delete(id);
    const expired = now.getTime() >= row.createdAt.getTime() + ATTEMPT_TTL_MS;
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
