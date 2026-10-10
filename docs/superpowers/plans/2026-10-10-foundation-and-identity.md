# Foundation and Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the persistence and runtime foundation every module needs (configuration, logging, Postgres access, migrations, unit of work, the jobs outbox with its worker, a health endpoint, local Compose, CI integration tests) and build the `identity` module on it: Google sign-in restricted to `effluz.com`, server-side sessions, CSRF, an append-only audit log, and the `/admin` gate. The `definitions` module follows in the next plan.

**Architecture:** Shared ports live in `src/shared/application/`, their adapters in `src/shared/infrastructure/`, and the composition root in `src/app/` wires them from a validated environment. `identity` is a module with the four layers: domain rules for sessions and admitted identities, application use cases behind ports, Postgres and OpenID Connect adapters in infrastructure, and the few staff-facing pages in presentation. Route handlers under `src/app/admin/auth/` are thin. Integration tests run against a real Postgres: Compose locally, a service container in CI, one throwaway database per run.

**Tech Stack:** as ADR 0012, plus `pg` (node-postgres) with hand-written SQL, plain SQL migration files run by an in-repo runner, `pino` for logging, `openid-client` for OIDC, `tsx` to run scripts, Postgres 17 in Compose, Mailpit in Compose for later email work.

**Spec:** `specs/architecture.md` (Ports, Configuration and secrets, Modules), `specs/system/database.md`, `specs/system/jobs.md`, `specs/system/security.md` (Admin authentication, Sessions, Audit log), `specs/system/deployment.md` (Health endpoint, Local development), `specs/system/ci-cd.md` (Workflow `ci`, integration job), `specs/system/observability.md` (Logging), `specs/use-cases/sign-in.md`, `CLAUDE.md`.

## Global Constraints

- Layers per CLAUDE.md: `domain` imports nothing but `zod`, `re2js`, `src/shared/domain` and siblings; `application` is framework-free and imports `domain` and shared application ports only; the database driver (`pg`) and `openid-client` appear only in `infrastructure/`; React and Next.js only in `presentation/` and `src/app/`. ESLint boundaries enforce it; MODULE_DEPS has `identity: []`.
- Session rules from `specs/system/security.md` and `specs/use-cases/sign-in.md`, verbatim: cookie `HttpOnly`, `Secure`, `SameSite=Lax`, scoped to the admin path; idle timeout 8 hours; absolute lifetime 7 days; rotation on sign-in; every state-changing admin request carries a CSRF token; sign-out destroys the server record.
- Identity rules: verify ID token signature, issuer, audience, expiry and nonce; require `email_verified` true and hosted-domain claim exactly `effluz.com` (configured, not hardcoded); any other account refused with a neutral page; audit `sign_in_rejected` records the attempted domain, never the address.
- Audit entries for this plan: `sign_in`, `sign_in_rejected`, `sign_out`, `session_expired` (written lazily on the next request that finds an expired session). The `audit_log` table is append-only from the application role; rows hold actor email, action, target id, timestamp, IP.
- Jobs from `specs/system/jobs.md`: `enqueue(type, payload, { runAt?, uniqueKey?, maxAttempts? })` inside the unit of work; columns `id, type, payload, status (pending|running|succeeded|failed|dead|discarded), attempts, max_attempts (default 8), run_at, locked_at, locked_by, unique_key (partial unique where status in pending, running), last_error, created_at, updated_at, finished_at`; claim with `FOR UPDATE SKIP LOCKED`; exponential backoff with jitter capped at one hour; leases expire; heartbeat row every poll; recurring jobs enqueued with `uniqueKey` `<type>:<period>`; payloads hold identifiers, never personal data.
- Database conventions: `snake_case`, singular table names, every table has `id` (random UUID), `created_at`, `updated_at` in UTC; migrations versioned, forward-only, never edited after reaching `main`; integration tests use a throwaway database per run.
- Logging: structured JSON to stdout; every line has timestamp, level, service (`app` or `worker`), request or job id, message; one logging helper is the only way to log; it redacts known PII field names; no configuration value is ever logged.
- Health: `GET /health` returns app version, database reachable, worker heartbeat age, dead job count, staging directory writable; 503 when the database is unreachable or the heartbeat is older than five minutes.
- Configuration: all through environment variables validated at process start; `.env.example` committed with a comment per variable; a missing or malformed variable fails the boot.
- All code and commits in English; Conventional Commits with scopes `shared`, `identity`, `app`, `tooling`, `ci`, `docs`. TDD throughout. `pnpm test && pnpm test:integration && pnpm lint && pnpm typecheck && pnpm format:check` green before each commit (integration needs the Compose Postgres up).
- No real personal data anywhere; test identities use `example.com` and a configured test domain.

## Review Focus

1. **A callback with a valid signature from the right issuer but `hd` missing or `gmail.com`** must create no session and audit `sign_in_rejected` with the domain only. Task 11 (adapter) and Task 12 (use case).
2. **A replayed callback** (same state and code a second time) must fail: the sign-in attempt is single-use. Task 12.
3. **A session cookie from a deleted row, or past its idle or absolute limit** must be refused on the very next request, with `session_expired` audited once. Task 12 and Task 13.
4. **Two workers claiming concurrently** must never run the same job twice, and a job whose lease expired must become claimable again. Task 6.
5. **`returnTo` must be a same-origin admin path**; an absolute URL or a path outside `/admin` falls back to `/admin`. Task 13.

---

## File structure

```
compose.dev.yml                                   Postgres 17 and Mailpit for local work
.env.example                                      every variable, commented
vitest.config.ts                                  unit tests only (excludes tests/integration)
vitest.integration.config.ts                      integration project with a global setup
.github/workflows/ci.yml                          adds the integration job

src/app/config.ts                                 zod-validated environment, loaded once
src/app/container.ts                              composition root: pool, logger, ports, use cases
src/app/worker.ts                                 worker entrypoint (pnpm worker)
src/app/cli/migrate.ts                            pnpm db:migrate
src/app/cli/revoke-sessions.ts                    pnpm sessions:revoke <email>
src/app/health/route.ts                           GET /health
src/app/admin/layout.tsx                          session gate for every /admin page
src/app/admin/page.tsx                            placeholder landing with sign-out form
src/app/admin/auth/signin/route.ts                GET: start sign-in
src/app/admin/auth/callback/route.ts              GET: finish sign-in
src/app/admin/auth/signout/route.ts               POST: sign out (CSRF)
src/app/admin/auth/denied/page.tsx                neutral refusal page
src/app/admin/auth/signed-out/page.tsx            signed-out page
src/app/admin/auth/error/page.tsx                 sign-in error page with retry

src/shared/application/ports/clock.ts             Clock
src/shared/application/ports/id-generator.ts      IdGenerator
src/shared/application/ports/logger.ts            Logger
src/shared/application/ports/unit-of-work.ts      UnitOfWork, UnitOfWorkFactory
src/shared/application/ports/job-queue.ts         JobQueue, JobHandler
src/shared/application/health.ts                  HealthReport, checkHealth
src/shared/infrastructure/clock.ts                system clock
src/shared/infrastructure/id-generator.ts         crypto.randomUUID
src/shared/infrastructure/logging/logger.ts       pino with redaction
src/shared/infrastructure/postgres/pool.ts        createPool
src/shared/infrastructure/postgres/migrate.ts     runner over SQL files
src/shared/infrastructure/postgres/migrations/    0001_job.sql, 0002_worker_heartbeat.sql
src/shared/infrastructure/postgres/unit-of-work.ts PgUnitOfWork
src/shared/infrastructure/postgres/tx.ts          TxContext: the client a uow hands to adapters
src/shared/infrastructure/jobs/pg-job-queue.ts    enqueue within a uow
src/shared/infrastructure/jobs/pg-job-store.ts    claim, succeed, fail, heartbeat, counts
src/shared/infrastructure/jobs/worker.ts          loop, handlers, scheduler, shutdown
src/shared/infrastructure/jobs/handlers/cleanup.ts jobs.cleanup

src/modules/identity/domain/staff-identity.ts     StaffIdentity, admission policy
src/modules/identity/domain/session.ts            Session, expiry rules, CSRF token
src/modules/identity/domain/audit.ts              AuditAction, AuditEntry
src/modules/identity/application/ports/*.ts       AdminIdentity, SessionRepository, AuditLog, SignInAttemptStore
src/modules/identity/application/*.ts             start-sign-in, complete-sign-in, current-session, sign-out, revoke-sessions
src/modules/identity/application/index.ts         public API
src/modules/identity/infrastructure/migrations/   0001_identity.sql
src/modules/identity/infrastructure/google-oidc.ts openid-client adapter
src/modules/identity/infrastructure/pg-*.ts       session repository, audit log, sign-in attempts
src/modules/identity/presentation/*.tsx           DeniedPage, SignedOutPage, SignInErrorPage, AdminShell, SignOutForm

tests/integration/setup.ts                        global setup: create database, migrate, provide URL
tests/integration/db.ts                           per-file pool and truncate helper
tests/integration/**/*.test.ts                    adapters, uow, jobs, worker, identity, oidc
tests/fakes/oidc-issuer.ts                        local OpenID issuer for tests
ops/runbooks/revoke-sessions.md
specs/decisions/0017-postgres-access-and-migrations.md
specs/decisions/0018-identity-implementation.md
specs/decisions/0019-logging.md
```

---

### Task 1: Local stack, environment configuration, ADR 0017

**Files:**
- Create: `compose.dev.yml`, `.env.example`, `src/app/config.ts`, `src/app/config.test.ts`
- Create: `specs/decisions/0017-postgres-access-and-migrations.md`
- Modify: `package.json` (scripts `db:up`, `db:down`), `.gitignore` (`.env`, `.env.*.local` already there; add `data/`)

**Interfaces:**
- Produces `loadConfig(env: NodeJS.ProcessEnv): AppConfig` and the `AppConfig` type:

```ts
export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  service: "app" | "worker";
  appVersion: string;                 // from APP_VERSION, default "dev"
  publicBaseUrl: string;              // PUBLIC_BASE_URL, https in production
  databaseUrl: string;                // DATABASE_URL
  logLevel: "debug" | "info" | "warn" | "error";
  stagingDir: string;                 // STAGING_DIR
  privacyContactEmail: string;        // PRIVACY_CONTACT_EMAIL
  session: { cookieName: string; idleHours: 8; absoluteDays: 7; secure: boolean };
  google: { clientId: string; clientSecret: string; allowedHostedDomain: string; issuer: string };
  worker: { concurrency: number; pollIntervalMs: number; leaseSeconds: number };
}
```

- [ ] **Step 1: Write the failing config tests**

`src/app/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const base = {
  NODE_ENV: "test",
  SERVICE: "app",
  PUBLIC_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://effluz:effluz@localhost:5432/effluz",
  STAGING_DIR: "/tmp/effluz-staging",
  PRIVACY_CONTACT_EMAIL: "privacy@example.com",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_ALLOWED_HOSTED_DOMAIN: "example.com",
};

describe("loadConfig", () => {
  it("parses a complete environment with defaults applied", () => {
    const c = loadConfig(base);
    expect(c.logLevel).toBe("info");
    expect(c.session).toEqual({ cookieName: "effluz_admin_session", idleHours: 8, absoluteDays: 7, secure: false });
    expect(c.google.issuer).toBe("https://accounts.google.com");
    expect(c.worker).toEqual({ concurrency: 4, pollIntervalMs: 1000, leaseSeconds: 60 });
  });
  it("fails fast on a missing variable and names it without echoing values", () => {
    const { DATABASE_URL: _omit, ...env } = base;
    expect(() => loadConfig(env)).toThrow(/DATABASE_URL/);
    expect(() => loadConfig(env)).not.toThrow(/client-secret/);
  });
  it("requires https and secure cookies in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/PUBLIC_BASE_URL/);
    const c = loadConfig({ ...base, NODE_ENV: "production", PUBLIC_BASE_URL: "https://forms.example.com" });
    expect(c.session.secure).toBe(true);
  });
  it("rejects an unknown SERVICE or LOG_LEVEL", () => {
    expect(() => loadConfig({ ...base, SERVICE: "cron" })).toThrow(/SERVICE/);
    expect(() => loadConfig({ ...base, LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/app/config`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/app/config.ts`:

```ts
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SERVICE: z.enum(["app", "worker"]).default("app"),
  APP_VERSION: z.string().default("dev"),
  PUBLIC_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  STAGING_DIR: z.string().min(1),
  PRIVACY_CONTACT_EMAIL: z.string().email(),
  SESSION_COOKIE_NAME: z.string().default("effluz_admin_session"),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_ALLOWED_HOSTED_DOMAIN: z.string().min(1),
  GOOGLE_ISSUER: z.string().url().default("https://accounts.google.com"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(10).default(60),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  service: "app" | "worker";
  appVersion: string;
  publicBaseUrl: string;
  databaseUrl: string;
  logLevel: "debug" | "info" | "warn" | "error";
  stagingDir: string;
  privacyContactEmail: string;
  session: { cookieName: string; idleHours: 8; absoluteDays: 7; secure: boolean };
  google: { clientId: string; clientSecret: string; allowedHostedDomain: string; issuer: string };
  worker: { concurrency: number; pollIntervalMs: number; leaseSeconds: number };
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Name the variables, never their values.
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))].join(", ");
    throw new Error(`Invalid configuration: ${names}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === "production" && !e.PUBLIC_BASE_URL.startsWith("https://"))
    throw new Error("Invalid configuration: PUBLIC_BASE_URL must be https in production");
  return {
    nodeEnv: e.NODE_ENV,
    service: e.SERVICE,
    appVersion: e.APP_VERSION,
    publicBaseUrl: e.PUBLIC_BASE_URL,
    databaseUrl: e.DATABASE_URL,
    logLevel: e.LOG_LEVEL,
    stagingDir: e.STAGING_DIR,
    privacyContactEmail: e.PRIVACY_CONTACT_EMAIL,
    session: { cookieName: e.SESSION_COOKIE_NAME, idleHours: 8, absoluteDays: 7, secure: e.NODE_ENV === "production" },
    google: {
      clientId: e.GOOGLE_CLIENT_ID,
      clientSecret: e.GOOGLE_CLIENT_SECRET,
      allowedHostedDomain: e.GOOGLE_ALLOWED_HOSTED_DOMAIN,
      issuer: e.GOOGLE_ISSUER,
    },
    worker: { concurrency: e.WORKER_CONCURRENCY, pollIntervalMs: e.WORKER_POLL_INTERVAL_MS, leaseSeconds: e.WORKER_LEASE_SECONDS },
  };
}
```

`compose.dev.yml`:

```yaml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_USER: effluz
      POSTGRES_PASSWORD: effluz
      POSTGRES_DB: effluz
    ports: ["5432:5432"]
    volumes: ["effluz-dev-db:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U effluz -d effluz"]
      interval: 5s
      timeout: 3s
      retries: 10
  mail:
    image: axllent/mailpit
    ports: ["8025:8025", "1025:1025"]
volumes:
  effluz-dev-db:
```

`.env.example`: one line per variable in `envSchema`, each preceded by a comment stating what it is and an example value; `DATABASE_URL=postgres://effluz:effluz@localhost:5432/effluz`, `TEST_DATABASE_ADMIN_URL=postgres://effluz:effluz@localhost:5432/postgres` (used only by the integration test setup to create throwaway databases), `GOOGLE_ALLOWED_HOSTED_DOMAIN=effluz.com`, `STAGING_DIR=./data/staging`.

Scripts: `"db:up": "docker compose -f compose.dev.yml up -d --wait"`, `"db:down": "docker compose -f compose.dev.yml down"`.

ADR 0017 (accepted, 2026-10-10, under 45 lines): context (first persistence; the user chose node-postgres with hand-written SQL and plain SQL migrations over Drizzle and Prisma); decision (`pg` pool created in the composition root; adapters receive a transaction client from the unit of work; migrations are numbered `.sql` files owned by the module that owns the table, discovered from a fixed list of directories, applied in order and recorded in `schema_migration`; one throwaway database per integration test run); consequences (SQL is explicit and reviewable; no codegen; adding a table means a migration file plus a repository adapter; renames need expand and contract).

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm test src/app/config && pnpm lint && pnpm typecheck && pnpm format:check`
Expected: PASS. Confirm `pnpm db:up` brings Postgres up healthy on your machine.

- [ ] **Step 5: Commit**

```bash
git add compose.dev.yml .env.example src/app/config.ts src/app/config.test.ts package.json .gitignore specs/decisions/0017-postgres-access-and-migrations.md
git commit -m "feat(app): validated environment configuration and local Compose stack"
```

---

### Task 2: Shared ports and system adapters: Clock, IdGenerator, Logger

**Files:**
- Create: `src/shared/application/ports/clock.ts`, `id-generator.ts`, `logger.ts`
- Create: `src/shared/infrastructure/clock.ts`, `id-generator.ts`, `logging/logger.ts`
- Test: `src/shared/infrastructure/id-generator.test.ts`, `src/shared/infrastructure/logging/logger.test.ts`
- Create: `specs/decisions/0019-logging.md`
- Modify: `package.json` (`pino`, `pino-pretty` as dev)

**Interfaces:**

```ts
// clock.ts
export interface Clock { now(): Date }
// id-generator.ts
export interface IdGenerator { newId(): string }   // random UUID v4, lowercase
// logger.ts
export type LogLevel = "debug" | "info" | "warn" | "error";
export interface LogFields { [key: string]: unknown }
export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;   // e.g. { requestId } or { jobId }
}
// infrastructure/logging/logger.ts
export function createLogger(opts: { service: "app" | "worker"; level: LogLevel; version: string; destination?: NodeJS.WritableStream }): Logger;
export const REDACTED_FIELDS: readonly string[]; // "email","name","answers","answer","text","body","story","fileName","filename","password","token","secret","authorization","cookie","set-cookie"
```

- [ ] **Step 1: Write the failing tests**

`id-generator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { systemIdGenerator } from "./id-generator";

describe("systemIdGenerator", () => {
  it("returns lowercase v4 UUIDs that do not repeat", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => systemIdGenerator.newId()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
```

`logger.test.ts` (captures output through a writable stream and parses the JSON lines):

```ts
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({ write(chunk, _enc, cb) { for (const l of chunk.toString().split("\n")) if (l) lines.push(JSON.parse(l)); cb(); } });
  return { lines, stream };
}

describe("createLogger", () => {
  it("emits JSON with service, version, level and message", () => {
    const { lines, stream } = capture();
    createLogger({ service: "worker", level: "info", version: "1.2.3", destination: stream }).info("started", { jobId: "j1" });
    expect(lines[0]).toMatchObject({ service: "worker", version: "1.2.3", level: "info", msg: "started", jobId: "j1" });
    expect(typeof lines[0]?.["time"]).toBe("number");
  });
  it("redacts personal data fields at any depth", () => {
    const { lines, stream } = capture();
    createLogger({ service: "app", level: "info", version: "x", destination: stream }).info("submission", {
      submissionId: "s1", email: "ana@example.com", answers: { story: "secret" }, nested: { name: "Ana" },
    });
    const line = JSON.stringify(lines[0]);
    expect(line).toContain("s1");
    expect(line).not.toContain("ana@example.com");
    expect(line).not.toContain("secret");
    expect(line).not.toContain("Ana");
    expect(line).toContain("[Redacted]");
  });
  it("respects the level and child fields", () => {
    const { lines, stream } = capture();
    const log = createLogger({ service: "app", level: "warn", version: "x", destination: stream }).child({ requestId: "r1" });
    log.info("hidden");
    log.warn("shown");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ requestId: "r1", msg: "shown" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/shared/infrastructure`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`pnpm add pino && pnpm add -D pino-pretty`. The ports are the interfaces above, one file each. `clock.ts`: `export const systemClock: Clock = { now: () => new Date() }`. `id-generator.ts`: `export const systemIdGenerator: IdGenerator = { newId: () => crypto.randomUUID() }` (global Web Crypto, allowed in infrastructure anyway).

`logging/logger.ts`:

```ts
import pino, { type Logger as Pino } from "pino";
import type { LogFields, Logger, LogLevel } from "@/shared/application/ports/logger";

export const REDACTED_FIELDS = [
  "email", "name", "answers", "answer", "text", "body", "story", "fileName", "filename",
  "password", "token", "secret", "authorization", "cookie", "set-cookie",
] as const;

// pino redact paths: each field at the top level and nested up to three levels.
const redactPaths = REDACTED_FIELDS.flatMap((f) => [f, `*.${f}`, `*.*.${f}`, `*.*.*.${f}`]);

function wrap(p: Pino): Logger {
  return {
    debug: (msg, fields) => { p.debug(fields ?? {}, msg); },
    info: (msg, fields) => { p.info(fields ?? {}, msg); },
    warn: (msg, fields) => { p.warn(fields ?? {}, msg); },
    error: (msg, fields) => { p.error(fields ?? {}, msg); },
    child: (fields: LogFields) => wrap(p.child(fields)),
  };
}

export function createLogger(opts: {
  service: "app" | "worker";
  level: LogLevel;
  version: string;
  destination?: NodeJS.WritableStream;
}): Logger {
  const p = pino(
    {
      level: opts.level,
      base: { service: opts.service, version: opts.version },
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: redactPaths, censor: "[Redacted]" },
    },
    opts.destination ?? process.stdout,
  );
  return wrap(p);
}
```

ADR 0019 (accepted, under 30 lines): pino chosen for speed and built-in redaction; the single helper is the only logging entry point; redaction list is defensive, not the primary control, which is never passing personal data to the logger; `pino-pretty` only for local development through `pnpm dev | pnpm exec pino-pretty`.

- [ ] **Step 4: Run tests, lint, typecheck**

Run: `pnpm test src/shared && pnpm lint && pnpm typecheck && pnpm format:check`
Expected: PASS. If `boundaries/no-unknown-files` flags `src/shared/application/ports/*.ts`, the element `shared-application` covers them; if it flags nothing, continue.

- [ ] **Step 5: Commit**

```bash
git add src/shared package.json pnpm-lock.yaml specs/decisions/0019-logging.md
git commit -m "feat(shared): clock, id generator and redacting logger behind ports"
```

---

### Task 3: Postgres pool, migration runner, integration test harness

**Files:**
- Create: `src/shared/infrastructure/postgres/pool.ts`, `migrate.ts`, `migrate.test.ts` (unit: ordering and parsing), `src/shared/infrastructure/postgres/migrations/.gitkeep`
- Create: `src/app/cli/migrate.ts`
- Create: `vitest.integration.config.ts`, `tests/integration/setup.ts`, `tests/integration/db.ts`, `tests/integration/postgres/migrate.test.ts`
- Modify: `vitest.config.ts` (exclude `tests/integration/**`), `package.json` (`pg`, `@types/pg`, `tsx`; scripts `db:migrate`, `test:integration`)

**Interfaces:**

```ts
// pool.ts
export function createPool(databaseUrl: string, opts?: { max?: number }): Pool;   // pg.Pool, application_name set, statement_timeout 30s
// migrate.ts
export interface MigrationFile { id: string; name: string; sql: string }           // id "0001", from "0001_job.sql"
export const MIGRATION_DIRS: readonly string[];  // absolute paths: shared/infrastructure/postgres/migrations, then each src/modules/*/infrastructure/migrations that exists
export function loadMigrations(dirs: readonly string[]): MigrationFile[];           // sorted by id, duplicate id across dirs is an error
export async function migrate(pool: Pool, migrations: MigrationFile[], log?: Logger): Promise<{ applied: string[] }>;
//   creates schema_migration(id text primary key, name text, applied_at timestamptz) if missing,
//   takes pg_advisory_lock(727001), applies each unapplied file in one transaction each, records it.
```

- [ ] **Step 1: Write the failing tests**

`migrate.test.ts` (unit, uses a temp dir):

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadMigrations } from "./migrate";

describe("loadMigrations", () => {
  it("orders by numeric id across directories and parses names", () => {
    const a = mkdtempSync(path.join(tmpdir(), "mig-a-"));
    const b = mkdtempSync(path.join(tmpdir(), "mig-b-"));
    writeFileSync(path.join(a, "0002_second.sql"), "select 2;");
    writeFileSync(path.join(b, "0001_first.sql"), "select 1;");
    writeFileSync(path.join(b, "notes.md"), "ignored");
    expect(loadMigrations([a, b]).map((m) => [m.id, m.name])).toEqual([["0001", "first"], ["0002", "second"]]);
  });
  it("rejects a duplicate id", () => {
    const a = mkdtempSync(path.join(tmpdir(), "mig-a-"));
    const b = mkdtempSync(path.join(tmpdir(), "mig-b-"));
    writeFileSync(path.join(a, "0001_x.sql"), "");
    writeFileSync(path.join(b, "0001_y.sql"), "");
    expect(() => loadMigrations([a, b])).toThrow(/duplicate migration id 0001/);
  });
  it("rejects a malformed file name", () => {
    const a = mkdtempSync(path.join(tmpdir(), "mig-a-"));
    writeFileSync(path.join(a, "1_bad.sql"), "");
    expect(() => loadMigrations([a])).toThrow(/1_bad.sql/);
  });
});
```

`tests/integration/postgres/migrate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { migrate } from "@/shared/infrastructure/postgres/migrate";
import { testPool } from "../db";

describe("migrate", () => {
  it("is idempotent and records applied ids", async () => {
    const pool = testPool();
    const first = await migrate(pool, [{ id: "9001", name: "probe", sql: "create table probe_t (id int);" }]);
    expect(first.applied).toEqual(["9001"]);
    const second = await migrate(pool, [{ id: "9001", name: "probe", sql: "create table probe_t (id int);" }]);
    expect(second.applied).toEqual([]);
    const rows = await pool.query("select id from schema_migration where id = '9001'");
    expect(rows.rowCount).toBe(1);
    await pool.query("drop table probe_t; delete from schema_migration where id = '9001'");
  });
  it("rolls back a failing migration and records nothing", async () => {
    const pool = testPool();
    await expect(migrate(pool, [{ id: "9002", name: "bad", sql: "create table ok_t (id int); select 1/0;" }])).rejects.toThrow();
    expect((await pool.query("select to_regclass('ok_t') as t")).rows[0]?.t).toBeNull();
    expect((await pool.query("select 1 from schema_migration where id = '9002'")).rowCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/shared/infrastructure/postgres`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`pnpm add pg && pnpm add -D @types/pg tsx`.

`pool.ts`:

```ts
import { Pool } from "pg";

export function createPool(databaseUrl: string, opts: { max?: number } = {}): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: opts.max ?? 10,
    application_name: "effluz-forms",
    statement_timeout: 30_000,
  });
}
```

`migrate.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import type { Logger } from "@/shared/application/ports/logger";

export interface MigrationFile { id: string; name: string; sql: string }

const FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const LOCK_KEY = 727001;

export const MIGRATION_DIRS: readonly string[] = (() => {
  const root = path.resolve(import.meta.dirname, "../../..");          // src/
  const shared = path.join(root, "shared/infrastructure/postgres/migrations");
  const modules = path.join(root, "modules");
  const moduleDirs = existsSync(modules)
    ? readdirSync(modules).map((m) => path.join(modules, m, "infrastructure/migrations")).filter(existsSync)
    : [];
  return [shared, ...moduleDirs];
})();

export function loadMigrations(dirs: readonly string[]): MigrationFile[] {
  const files: MigrationFile[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".sql")) continue;
      const m = FILE.exec(entry);
      if (!m) throw new Error(`malformed migration file name: ${entry}`);
      files.push({ id: m[1] as string, name: m[2] as string, sql: readFileSync(path.join(dir, entry), "utf8") });
    }
  }
  files.sort((a, b) => a.id.localeCompare(b.id));
  for (let i = 1; i < files.length; i++)
    if (files[i]?.id === files[i - 1]?.id) throw new Error(`duplicate migration id ${String(files[i]?.id)}`);
  return files;
}

export async function migrate(pool: Pool, migrations: MigrationFile[], log?: Logger): Promise<{ applied: string[] }> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query(`create table if not exists schema_migration (
      id text primary key, name text not null, applied_at timestamptz not null default now())`);
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    const done = new Set((await client.query<{ id: string }>("select id from schema_migration")).rows.map((r) => r.id));
    for (const m of migrations) {
      if (done.has(m.id)) continue;
      await client.query("begin");
      try {
        await client.query(m.sql);
        await client.query("insert into schema_migration (id, name) values ($1, $2)", [m.id, m.name]);
        await client.query("commit");
        applied.push(m.id);
        log?.info("migration applied", { migration: `${m.id}_${m.name}` });
      } catch (e) {
        await client.query("rollback");
        throw e;
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
  return { applied };
}
```

`src/app/cli/migrate.ts`: loads config, creates pool, `migrate(pool, loadMigrations(MIGRATION_DIRS), logger)`, exits 0 or 1. Script: `"db:migrate": "tsx src/app/cli/migrate.ts"`.

`vitest.integration.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/integration/setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
```

`tests/integration/setup.ts` (global setup): reads `TEST_DATABASE_ADMIN_URL` (default `postgres://effluz:effluz@localhost:5432/postgres`), connects, `create database effluz_test_<8 hex>`, builds the test URL, runs `migrate(pool, loadMigrations(MIGRATION_DIRS))`, `provide("databaseUrl", url)`; teardown terminates connections and drops the database. `tests/integration/db.ts`: `testPool()` returns a memoized `Pool` from `inject("databaseUrl")`; `truncateAll(pool)` truncates every table in `public` except `schema_migration` with `restart identity cascade`. Declare `databaseUrl` in a `vitest` module augmentation for `ProvidedContext`.

`vitest.config.ts`: add `exclude: ["tests/integration/**", "node_modules/**"]` to `test`. Script: `"test:integration": "vitest run --config vitest.integration.config.ts"`.

- [ ] **Step 4: Run both suites, lint, typecheck**

Run: `pnpm db:up && pnpm test && pnpm test:integration && pnpm lint && pnpm typecheck && pnpm format:check`
Expected: PASS; the integration run creates and drops a database (check with `psql` that no `effluz_test_*` remains).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shared): Postgres pool, SQL migration runner and integration test harness"
```

---

### Task 4: UnitOfWork port and Postgres adapter

**Files:**
- Create: `src/shared/application/ports/unit-of-work.ts`, `src/shared/infrastructure/postgres/tx.ts`, `src/shared/infrastructure/postgres/unit-of-work.ts`
- Test: `tests/integration/postgres/unit-of-work.test.ts`

**Interfaces:**

```ts
// ports/unit-of-work.ts
export interface UnitOfWork {
  /** Opaque handle adapters use to join the transaction; typed by the infrastructure layer. */
  readonly handle: unknown;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
export interface UnitOfWorkFactory {
  begin(): Promise<UnitOfWork>;
  /** Runs fn in a unit of work, commits on return, rolls back on throw, never nests. */
  run<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T>;
}
// infrastructure/postgres/tx.ts
export interface TxContext { client: PoolClient }
export function txOf(uow: UnitOfWork): TxContext;   // throws if the handle is not a Postgres transaction
// infrastructure/postgres/unit-of-work.ts
export class PgUnitOfWorkFactory implements UnitOfWorkFactory { constructor(pool: Pool) }
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { txOf } from "@/shared/infrastructure/postgres/tx";
import { testPool, truncateAll } from "../db";

describe("PgUnitOfWork", () => {
  const pool = testPool();
  beforeEach(async () => { await truncateAll(pool); await pool.query("create table if not exists uow_probe (v text)"); await pool.query("delete from uow_probe"); });

  it("commits writes made through the transaction client", async () => {
    const f = new PgUnitOfWorkFactory(pool);
    await f.run(async (uow) => { await txOf(uow).client.query("insert into uow_probe values ('a')"); });
    expect((await pool.query("select count(*)::int as n from uow_probe")).rows[0]?.n).toBe(1);
  });
  it("rolls back when the function throws and rethrows", async () => {
    const f = new PgUnitOfWorkFactory(pool);
    await expect(f.run(async (uow) => { await txOf(uow).client.query("insert into uow_probe values ('b')"); throw new Error("boom"); })).rejects.toThrow("boom");
    expect((await pool.query("select count(*)::int as n from uow_probe")).rows[0]?.n).toBe(0);
  });
  it("refuses a double commit and releases the client", async () => {
    const f = new PgUnitOfWorkFactory(pool);
    const uow = await f.begin();
    await uow.commit();
    await expect(uow.commit()).rejects.toThrow(/finished/);
    expect(pool.idleCount + pool.waitingCount).toBeGreaterThanOrEqual(0); // no leak: the next run must not hang
    await f.run(async () => undefined);
  });
  it("txOf rejects a foreign unit of work", () => {
    expect(() => txOf({ handle: {}, commit: async () => undefined, rollback: async () => undefined })).toThrow(/Postgres/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:integration tests/integration/postgres/unit-of-work`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`tx.ts`:

```ts
import type { PoolClient } from "pg";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";

export interface TxContext { client: PoolClient }
const TX = Symbol.for("effluz.pg.tx");
export function markTx(client: PoolClient): TxContext & { [TX]: true } { return { client, [TX]: true }; }
export function txOf(uow: UnitOfWork): TxContext {
  const h = uow.handle as { [TX]?: true; client?: PoolClient } | null;
  if (!h || h[TX] !== true || !h.client) throw new Error("unit of work is not a Postgres transaction");
  return { client: h.client };
}
```

`unit-of-work.ts`:

```ts
import type { Pool } from "pg";
import type { UnitOfWork, UnitOfWorkFactory } from "@/shared/application/ports/unit-of-work";
import { markTx } from "./tx";

export class PgUnitOfWorkFactory implements UnitOfWorkFactory {
  constructor(private readonly pool: Pool) {}

  async begin(): Promise<UnitOfWork> {
    const client = await this.pool.connect();
    let finished = false;
    const finish = async (sql: "commit" | "rollback") => {
      if (finished) throw new Error("unit of work already finished");
      finished = true;
      try { await client.query(sql); } finally { client.release(); }
    };
    try {
      await client.query("begin");
    } catch (e) { client.release(); throw e; }
    return { handle: markTx(client), commit: () => finish("commit"), rollback: () => finish("rollback") };
  }

  async run<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    const uow = await this.begin();
    try {
      const result = await fn(uow);
      await uow.commit();
      return result;
    } catch (e) {
      await uow.rollback().catch(() => undefined);
      throw e;
    }
  }
}
```

- [ ] **Step 4: Run, lint, typecheck**

Run: `pnpm test:integration && pnpm lint && pnpm typecheck && pnpm format:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared tests/integration
git commit -m "feat(shared): unit of work port with a Postgres transaction adapter"
```

---

### Task 5: Job table, JobQueue port and Postgres enqueue

**Files:**
- Create: `src/shared/infrastructure/postgres/migrations/0001_job.sql`
- Create: `src/shared/application/ports/job-queue.ts`, `src/shared/infrastructure/jobs/pg-job-queue.ts`
- Test: `tests/integration/jobs/pg-job-queue.test.ts`

**Interfaces:**

```ts
// ports/job-queue.ts
export type JobPayload = Record<string, string | number | boolean | null>;   // identifiers only
export interface EnqueueOptions { runAt?: Date; uniqueKey?: string; maxAttempts?: number }
export interface JobQueue {
  /** Inserts inside the given unit of work. Returns the job id, or null when uniqueKey is already pending or running. */
  enqueue(uow: UnitOfWork, type: string, payload: JobPayload, opts?: EnqueueOptions): Promise<string | null>;
}
export interface JobHandlerContext { jobId: string; attempt: number; logger: Logger; uow: UnitOfWorkFactory; queue: JobQueue; clock: Clock }
export type JobHandler = (payload: JobPayload, ctx: JobHandlerContext) => Promise<void>;
export const DEFAULT_MAX_ATTEMPTS = 8;
```

Migration `0001_job.sql` (exact):

```sql
create table job (
  id uuid primary key,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('pending','running','succeeded','failed','dead','discarded')),
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  unique_key text,
  last_error text,
  discard_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index job_claim_idx on job (status, run_at) where status in ('pending','failed');
create unique index job_unique_key_idx on job (unique_key) where status in ('pending','running') and unique_key is not null;
```

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { PgJobQueue } from "@/shared/infrastructure/jobs/pg-job-queue";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";

const fixedIds = (...ids: string[]) => { let i = 0; return { newId: () => ids[i++] ?? crypto.randomUUID() }; };
const clock = { now: () => new Date("2026-10-10T12:00:00Z") };

describe("PgJobQueue.enqueue", () => {
  const pool = testPool();
  const uowf = new PgUnitOfWorkFactory(pool);
  beforeEach(() => truncateAll(pool));

  it("inserts a pending job with defaults inside the unit of work", async () => {
    const q = new PgJobQueue(fixedIds("11111111-1111-4111-8111-111111111111"), clock);
    const id = await uowf.run((uow) => q.enqueue(uow, "email.staff_notification", { submissionId: "s1" }));
    expect(id).toBe("11111111-1111-4111-8111-111111111111");
    const row = (await pool.query("select type, status, attempts, max_attempts, payload, run_at from job")).rows[0];
    expect(row).toMatchObject({ type: "email.staff_notification", status: "pending", attempts: 0, max_attempts: 8, payload: { submissionId: "s1" } });
    expect(new Date(row.run_at).toISOString()).toBe("2026-10-10T12:00:00.000Z");
  });
  it("is rolled back with the unit of work", async () => {
    const q = new PgJobQueue(fixedIds(), clock);
    await expect(uowf.run(async (uow) => { await q.enqueue(uow, "x.y", {}); throw new Error("abort"); })).rejects.toThrow("abort");
    expect((await pool.query("select count(*)::int as n from job")).rows[0]?.n).toBe(0);
  });
  it("returns null for a duplicate uniqueKey while pending, and allows it again after success", async () => {
    const q = new PgJobQueue(fixedIds(), clock);
    const first = await uowf.run((uow) => q.enqueue(uow, "retention.purge", {}, { uniqueKey: "retention.purge:2026-10-10" }));
    const dup = await uowf.run((uow) => q.enqueue(uow, "retention.purge", {}, { uniqueKey: "retention.purge:2026-10-10" }));
    expect(first).not.toBeNull();
    expect(dup).toBeNull();
    await pool.query("update job set status = 'succeeded'");
    const again = await uowf.run((uow) => q.enqueue(uow, "retention.purge", {}, { uniqueKey: "retention.purge:2026-10-10" }));
    expect(again).not.toBeNull();
  });
  it("honors runAt and maxAttempts", async () => {
    const q = new PgJobQueue(fixedIds(), clock);
    await uowf.run((uow) => q.enqueue(uow, "x.y", {}, { runAt: new Date("2026-10-11T00:00:00Z"), maxAttempts: 3 }));
    const row = (await pool.query("select run_at, max_attempts from job")).rows[0];
    expect(new Date(row.run_at).toISOString()).toBe("2026-10-11T00:00:00.000Z");
    expect(row.max_attempts).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:integration tests/integration/jobs`
Expected: FAIL.

- [ ] **Step 3: Implement**

`pg-job-queue.ts`:

```ts
import type { Clock } from "@/shared/application/ports/clock";
import type { IdGenerator } from "@/shared/application/ports/id-generator";
import { DEFAULT_MAX_ATTEMPTS, type EnqueueOptions, type JobPayload, type JobQueue } from "@/shared/application/ports/job-queue";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { txOf } from "../postgres/tx";

export class PgJobQueue implements JobQueue {
  constructor(private readonly ids: IdGenerator, private readonly clock: Clock) {}

  async enqueue(uow: UnitOfWork, type: string, payload: JobPayload, opts: EnqueueOptions = {}): Promise<string | null> {
    const { client } = txOf(uow);
    const id = this.ids.newId();
    const res = await client.query(
      `insert into job (id, type, payload, status, max_attempts, run_at, unique_key)
       values ($1, $2, $3, 'pending', $4, $5, $6)
       on conflict (unique_key) where status in ('pending','running') and unique_key is not null do nothing
       returning id`,
      [id, type, JSON.stringify(payload), opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, opts.runAt ?? this.clock.now(), opts.uniqueKey ?? null],
    );
    return res.rowCount === 1 ? id : null;
  }
}
```

If Postgres rejects `on conflict` against the partial unique index in this form, use `on conflict do nothing` with an explicit `where not exists (select 1 from job where unique_key = $6 and status in ('pending','running'))` guard in an `insert ... select`, and keep the test expectations.

- [ ] **Step 4: Run, lint, typecheck**

Run: `pnpm test:integration && pnpm lint && pnpm typecheck && pnpm format:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shared): job table and outbox enqueue within the unit of work"
```

---

### Task 6: Job store, worker loop, heartbeat, scheduler, cleanup handler

**Files:**
- Create: `src/shared/infrastructure/postgres/migrations/0002_worker_heartbeat.sql`
- Create: `src/shared/infrastructure/jobs/pg-job-store.ts`, `worker.ts`, `backoff.ts`, `backoff.test.ts`, `handlers/cleanup.ts`
- Create: `src/app/worker.ts`
- Test: `tests/integration/jobs/pg-job-store.test.ts`, `tests/integration/jobs/worker.test.ts`
- Modify: `package.json` (script `worker`)

**Interfaces:**

```ts
// migrations/0002_worker_heartbeat.sql
create table worker_heartbeat (
  id uuid primary key, worker_id text not null unique, last_seen_at timestamptz not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

// backoff.ts
export function backoffMs(attempt: number, random: () => number = Math.random): number;
//  min(3600_000, 2^attempt * 1000) plus jitter of up to 25%; attempt 1 is about 2 s.

// pg-job-store.ts
export interface ClaimedJob { id: string; type: string; payload: JobPayload; attempts: number; maxAttempts: number }
export class PgJobStore {
  constructor(pool: Pool, clock: Clock, opts: { leaseSeconds: number })
  claim(workerId: string, limit: number): Promise<ClaimedJob[]>;
  //  update job set status='running', attempts=attempts+1, locked_at=now, locked_by=workerId
  //  where id in (select id from job where (status in ('pending','failed') and run_at <= now)
  //     or (status='running' and locked_at < now - lease) order by run_at for update skip locked limit $limit)
  //  returning ...
  succeed(id: string): Promise<void>;                                   // status succeeded, finished_at, locked_* null
  fail(id: string, error: string, attempts: number, maxAttempts: number): Promise<"retry" | "dead">;
  //  truncates error to 500 chars; if attempts >= maxAttempts: dead with finished_at; else failed with run_at = now + backoff
  heartbeat(workerId: string): Promise<void>;                           // upsert worker_heartbeat
  counts(): Promise<{ pending: number; running: number; dead: number; oldestPendingAgeSeconds: number | null }>;
  heartbeatAgeSeconds(): Promise<number | null>;                        // newest last_seen_at, or null if none
  pruneSucceeded(olderThan: Date): Promise<number>;
}

// worker.ts
export interface RecurringJob { type: string; period: "daily" | "hourly"; payload?: JobPayload }
export interface WorkerOptions { workerId: string; concurrency: number; pollIntervalMs: number; jobTimeoutMs: number; handlers: Record<string, JobHandler>; recurring: RecurringJob[] }
export class Worker {
  constructor(deps: { store: PgJobStore; queue: JobQueue; uow: UnitOfWorkFactory; clock: Clock; logger: Logger }, opts: WorkerOptions)
  tick(): Promise<number>;     // one poll: schedule recurring (uniqueKey `${type}:${bucket}`), claim up to concurrency, run with timeout, heartbeat; returns jobs run
  start(): void;               // loop with setTimeout(pollIntervalMs) until stop()
  stop(): Promise<void>;       // waits for in-flight jobs
}
//  A job whose handler type is unknown fails with "no handler for <type>".
//  Handler errors never escape the worker; messages are passed to fail() after redacting '@'-containing tokens.

// handlers/cleanup.ts
export const cleanupHandler: JobHandler;   // store.pruneSucceeded(now - 30 days); logs the count. Registered as "jobs.cleanup", recurring daily.
```

Daily bucket: `YYYY-MM-DD` in UTC from `clock.now()`; hourly: `YYYY-MM-DDTHH`.

- [ ] **Step 1: Write the failing tests**

`backoff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { backoffMs } from "./backoff";
describe("backoffMs", () => {
  it("doubles per attempt with jitter and caps at one hour", () => {
    expect(backoffMs(1, () => 0)).toBe(2_000);
    expect(backoffMs(3, () => 0)).toBe(8_000);
    expect(backoffMs(3, () => 1)).toBe(10_000);
    expect(backoffMs(20, () => 1)).toBe(3_600_000);
  });
});
```

`pg-job-store.test.ts` (highlights; write each as its own `it`):
- claim returns pending jobs ordered by `run_at`, marks them running with `locked_by` and attempts 1, and does not return jobs whose `run_at` is in the future.
- two stores claiming concurrently (`Promise.all` of two `claim(…, 5)` on 10 jobs) return disjoint id sets covering all 10 (Review Focus 4).
- a running job whose `locked_at` is older than the lease is claimable again; one inside the lease is not.
- `fail` below max attempts sets `failed`, `run_at` in the future and `last_error` truncated to 500 characters; at max attempts sets `dead` with `finished_at`.
- `succeed` sets `succeeded`, `finished_at`, clears the lock.
- `heartbeat` upserts; `heartbeatAgeSeconds` reflects the clock; `counts` reports pending, running, dead and the oldest pending age.
- `pruneSucceeded` removes only succeeded jobs older than the cutoff.

`worker.test.ts` (highlights):
- `tick` runs a registered handler with its payload and a context whose `logger` is a child with `jobId`, then the job is `succeeded`.
- a throwing handler leaves the job `failed` with the error message, no exception escapes `tick`.
- an unknown type is failed with `no handler for x.y`.
- a handler that exceeds `jobTimeoutMs` (use 50 ms) is failed with a timeout message.
- `tick` enqueues `jobs.cleanup` once per day bucket: two ticks on the same clock day produce one job.
- `tick` writes a heartbeat row.
- `stop` waits for an in-flight handler to finish before resolving.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/shared/infrastructure/jobs && pnpm test:integration tests/integration/jobs`
Expected: FAIL.

- [ ] **Step 3: Implement**

`backoff.ts`:

```ts
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(3_600_000, 2 ** attempt * 1000);
  return Math.min(3_600_000, Math.round(base * (1 + 0.25 * random())));
}
```

`pg-job-store.ts` implements the SQL in the interface comments; `claim` uses one `update … where id in (select … for update skip locked) returning id, type, payload, attempts, max_attempts`. `fail` scrubs the message with `error.replace(/\S+@\S+/g, "[redacted]").slice(0, 500)`.

`worker.ts` core of `tick`:

```ts
async tick(): Promise<number> {
  await this.scheduleRecurring();
  const jobs = await this.store.claim(this.opts.workerId, this.opts.concurrency);
  await Promise.all(jobs.map((j) => this.run(j)));
  await this.store.heartbeat(this.opts.workerId);
  return jobs.length;
}
private async run(job: ClaimedJob) {
  const handler = this.opts.handlers[job.type];
  const log = this.deps.logger.child({ jobId: job.id, jobType: job.type, attempt: job.attempts });
  if (!handler) { await this.store.fail(job.id, `no handler for ${job.type}`, job.attempts, job.maxAttempts); return; }
  const ctx = { jobId: job.id, attempt: job.attempts, logger: log, uow: this.deps.uow, queue: this.deps.queue, clock: this.deps.clock };
  try {
    await withTimeout(handler(job.payload, ctx), this.opts.jobTimeoutMs, `job timed out after ${String(this.opts.jobTimeoutMs)} ms`);
    await this.store.succeed(job.id);
  } catch (e) {
    const outcome = await this.store.fail(job.id, e instanceof Error ? e.message : String(e), job.attempts, job.maxAttempts);
    (outcome === "dead" ? log.error : log.warn).call(log, "job failed", { outcome });
  }
}
```

`scheduleRecurring` enqueues each `RecurringJob` through `queue.enqueue` inside `uow.run`, with `uniqueKey` `${type}:${bucket}`; a null result means already scheduled. `start`/`stop` keep a `running` flag and a promise for the in-flight tick.

`src/app/worker.ts`: loads config with `SERVICE=worker`, builds pool, logger, store, queue, uow, registers `{ "jobs.cleanup": cleanupHandler }`, recurring `[{ type: "jobs.cleanup", period: "daily" }]`, starts the worker, and on `SIGTERM`/`SIGINT` calls `stop()` then ends the pool. Script: `"worker": "tsx src/app/worker.ts"`.

- [ ] **Step 4: Run everything**

Run: `pnpm test && pnpm test:integration && pnpm lint && pnpm typecheck && pnpm format:check`
Expected: PASS. Manually: `SERVICE=worker pnpm worker` against the dev database logs a heartbeat and exits cleanly on Ctrl-C.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shared): outbox worker with claiming, retries, leases, heartbeat and scheduler"
```

---

### Task 7: Health endpoint

**Files:**
- Create: `src/shared/application/health.ts`, `src/shared/application/health.test.ts`, `src/app/health/route.ts`

**Interfaces:**

```ts
export interface HealthProbe {
  databaseReachable(): Promise<boolean>;
  heartbeatAgeSeconds(): Promise<number | null>;
  deadJobs(): Promise<number>;
  stagingWritable(): Promise<boolean>;
}
export interface HealthReport {
  status: "ok" | "degraded";
  version: string;
  database: boolean;
  workerHeartbeatSeconds: number | null;
  deadJobs: number;
  stagingWritable: boolean;
}
export const HEARTBEAT_STALE_SECONDS = 300;
export async function checkHealth(probe: HealthProbe, version: string): Promise<HealthReport>;
//  status is "degraded" when database is false or heartbeat is null or older than 300 s. Nothing else degrades.
```

- [ ] **Step 1: Write the failing test** with a fake probe: ok case; database false gives degraded; heartbeat 301 gives degraded; heartbeat null gives degraded; dead jobs 5 and staging false do not degrade; a probe that throws counts as false/null without the report throwing.

- [ ] **Step 2: Run to verify failure**, then **Step 3: implement** `checkHealth` and the route handler: `GET /health` builds the probe from the container (pool `select 1`, store heartbeat age and counts, `fs.access(stagingDir, W_OK)`), returns the report as JSON with status 200 or 503 and `Cache-Control: no-store`. The route imports only `@/app/container` and `@/shared/application/health`.

- [ ] **Step 4: Run** `pnpm test && pnpm lint && pnpm typecheck && pnpm format:check`, then `pnpm dev` and `curl -i localhost:3000/health` shows 503 with `workerHeartbeatSeconds: null` until a worker runs, then 200.

- [ ] **Step 5: Commit** `feat(app): health endpoint reporting database, worker heartbeat and dead jobs`

---

### Task 8: CI integration job

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the job** after `unit`, with the same pinned actions:

```yaml
  integration:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env: { POSTGRES_USER: effluz, POSTGRES_PASSWORD: effluz, POSTGRES_DB: postgres }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U effluz" --health-interval 5s --health-timeout 3s --health-retries 10
    env:
      TEST_DATABASE_ADMIN_URL: postgres://effluz:effluz@localhost:5432/postgres
    steps:
      - uses: actions/checkout@<same pin>
      - uses: pnpm/action-setup@<same pin>
      - uses: actions/setup-node@<same pin>
        with: { node-version-file: .node-version, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:integration --reporter=default --reporter=junit --outputFile=reports/integration.xml
      - if: failure()
        uses: actions/upload-artifact@<same pin>
        with: { name: integration-report, path: reports/ }
```

Add `integration` to the aggregate `ci` job's `needs` and result loop. Remove the comment that said integration arrives later; leave the `e2e` note.

- [ ] **Step 2: Commit, push, confirm** the `integration` job is green on the PR. Commit: `ci: run integration tests against a Postgres service container`.

---

### Task 9: Identity domain: admitted identities, sessions, audit actions

**Files:**
- Create: `src/modules/identity/domain/staff-identity.ts`, `session.ts`, `audit.ts`
- Test: `staff-identity.test.ts`, `session.test.ts`, `audit.test.ts` beside them

**Interfaces:**

```ts
// staff-identity.ts
export interface StaffIdentity { email: string; name: string }
export interface IdentityClaims { email?: string; emailVerified?: boolean; hostedDomain?: string; name?: string }
export type Admission = { admitted: true; identity: StaffIdentity } | { admitted: false; reason: "unverified_email" | "wrong_domain" | "missing_email"; attemptedDomain: string | null };
export function admit(claims: IdentityClaims, allowedHostedDomain: string): Admission;
//  requires email present, emailVerified true, hostedDomain === allowedHostedDomain (case-insensitive compare, stored lowercase);
//  attemptedDomain is the hostedDomain claim if present, else the part after "@" in email, else null; never the full address.
//  name falls back to the local part of the email when absent.

// session.ts
export const IDLE_HOURS = 8; export const ABSOLUTE_DAYS = 7;
export interface Session { id: string; email: string; name: string; csrfToken: string; createdAt: Date; lastSeenAt: Date }
export type SessionState = "active" | "idle_expired" | "absolute_expired";
export function sessionState(s: Session, now: Date): SessionState;   // absolute wins over idle when both apply
export function touch(s: Session, now: Date): Session;               // returns a copy with lastSeenAt = now
export function sessionCookieMaxAgeSeconds(): number;                 // 7 days

// audit.ts
export const auditActions = ["sign_in", "sign_in_rejected", "sign_out", "session_expired", "sessions_revoked"] as const;  // identity's actions; other modules add their own
export type AuditAction = (typeof auditActions)[number] | (string & {});   // open for other modules' actions
export interface AuditEntry { action: AuditAction; actorEmail: string | null; targetId: string | null; ip: string | null; details?: Record<string, string | number | boolean> }
//  details must never contain an email; `assertNoPersonalData(details)` throws if any string value contains "@".
export function assertNoPersonalData(details: AuditEntry["details"]): void;
```

- [ ] **Step 1: Write the failing tests**

`staff-identity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { admit } from "./staff-identity";

describe("admit", () => {
  it("admits a verified account on the allowed hosted domain", () => {
    expect(admit({ email: "Ana@Example.com", emailVerified: true, hostedDomain: "Example.com", name: "Ana" }, "example.com"))
      .toEqual({ admitted: true, identity: { email: "ana@example.com", name: "Ana" } });
  });
  it("refuses an unverified email", () => {
    expect(admit({ email: "ana@example.com", emailVerified: false, hostedDomain: "example.com" }, "example.com"))
      .toEqual({ admitted: false, reason: "unverified_email", attemptedDomain: "example.com" });
  });
  it("refuses a missing or different hosted domain and reports only the domain", () => {
    expect(admit({ email: "ana@gmail.com", emailVerified: true }, "example.com"))
      .toEqual({ admitted: false, reason: "wrong_domain", attemptedDomain: "gmail.com" });
    expect(admit({ email: "ana@other.com", emailVerified: true, hostedDomain: "other.com" }, "example.com"))
      .toEqual({ admitted: false, reason: "wrong_domain", attemptedDomain: "other.com" });
  });
  it("refuses a missing email and falls back to the local part for a missing name", () => {
    expect(admit({ emailVerified: true, hostedDomain: "example.com" }, "example.com")).toMatchObject({ admitted: false, reason: "missing_email", attemptedDomain: "example.com" });
    expect(admit({ email: "ana.m@example.com", emailVerified: true, hostedDomain: "example.com" }, "example.com")).toMatchObject({ identity: { name: "ana.m" } });
  });
});
```

`session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sessionState, touch } from "./session";
const base = { id: "s", email: "a@example.com", name: "A", csrfToken: "c", createdAt: new Date("2026-10-10T00:00:00Z"), lastSeenAt: new Date("2026-10-10T00:00:00Z") };
describe("sessionState", () => {
  it("is active within both limits", () => { expect(sessionState(base, new Date("2026-10-10T07:59:00Z"))).toBe("active"); });
  it("expires idle after 8 hours since last seen", () => { expect(sessionState(base, new Date("2026-10-10T08:00:01Z"))).toBe("idle_expired"); });
  it("expires absolutely after 7 days since creation even when recently seen", () => {
    const s = touch(base, new Date("2026-10-16T23:00:00Z"));
    expect(sessionState(s, new Date("2026-10-17T00:00:01Z"))).toBe("absolute_expired");
  });
  it("touch returns a copy and leaves the original unchanged", () => {
    const t = touch(base, new Date("2026-10-10T01:00:00Z"));
    expect(t.lastSeenAt.toISOString()).toBe("2026-10-10T01:00:00.000Z");
    expect(base.lastSeenAt.toISOString()).toBe("2026-10-10T00:00:00.000Z");
  });
});
```

`audit.test.ts`: `assertNoPersonalData({ domain: "gmail.com" })` passes; `assertNoPersonalData({ who: "ana@example.com" })` throws `/personal data/`.

- [ ] **Step 2: Run to verify failure**, **Step 3: implement** exactly the interfaces (pure functions, no I/O), **Step 4: run** `pnpm test src/modules/identity && pnpm lint && pnpm typecheck && pnpm format:check`.

- [ ] **Step 5: Commit** `feat(identity): admission policy, session expiry rules and audit entry types`

---

### Task 10: Identity ports, migration and Postgres adapters

**Files:**
- Create: `src/modules/identity/application/ports/admin-identity.ts`, `session-repository.ts`, `audit-log.ts`, `sign-in-attempt-store.ts`
- Create: `src/modules/identity/infrastructure/migrations/0001_identity.sql`
- Create: `src/modules/identity/infrastructure/pg-session-repository.ts`, `pg-audit-log.ts`, `pg-sign-in-attempt-store.ts`
- Test: `tests/integration/identity/pg-session-repository.test.ts`, `pg-audit-log.test.ts`, `pg-sign-in-attempt-store.test.ts`

**Interfaces:**

```ts
// ports/admin-identity.ts
export interface SignInStart { authorizationUrl: string; state: string; nonce: string; codeVerifier: string }
export interface CallbackInput { url: string }   // the full callback URL with query string
export type SignInCompletion = { ok: true; claims: IdentityClaims } | { ok: false; reason: "state_mismatch" | "exchange_failed" | "invalid_token" };
export interface AdminIdentity {
  beginSignIn(redirectUri: string): Promise<SignInStart>;
  completeSignIn(input: CallbackInput, expected: { state: string; nonce: string; codeVerifier: string; redirectUri: string }): Promise<SignInCompletion>;
}
// ports/session-repository.ts
export interface SessionRepository {
  create(uow: UnitOfWork, session: Session): Promise<void>;
  findById(id: string): Promise<Session | null>;          // read path, no uow
  touch(id: string, lastSeenAt: Date): Promise<void>;     // read path write, no uow (idempotent)
  delete(uow: UnitOfWork, id: string): Promise<void>;
  deleteAllForEmail(uow: UnitOfWork, email: string): Promise<number>;
}
// ports/audit-log.ts
export interface AuditLog { record(uow: UnitOfWork, entry: AuditEntry, at: Date): Promise<void> }
// ports/sign-in-attempt-store.ts
export interface SignInAttempt { id: string; state: string; nonce: string; codeVerifier: string; returnTo: string; createdAt: Date }
export interface SignInAttemptStore {
  create(attempt: SignInAttempt): Promise<void>;                         // autonomous, expires after 10 minutes
  consume(id: string, now: Date): Promise<SignInAttempt | null>;        // returns and deletes atomically; null if missing or expired
}
```

Migration `0001_identity.sql` (exact):

```sql
create table admin_session (
  id uuid primary key,
  email text not null,
  name text not null,
  csrf_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index admin_session_email_idx on admin_session (email);

create table sign_in_attempt (
  id uuid primary key,
  state text not null,
  nonce text not null,
  code_verifier text not null,
  return_to text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table audit_log (
  id uuid primary key,
  action text not null,
  actor_email text,
  target_id text,
  ip text,
  details jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audit_log_created_idx on audit_log (created_at desc);
create index audit_log_actor_idx on audit_log (actor_email, created_at desc);

create function audit_log_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function audit_log_append_only();
```

- [ ] **Step 1: Write the failing integration tests** (highlights, one `it` each):
- sessions: `create` inside a uow then `findById` returns an equal `Session` with Date fields; `touch` updates `last_seen_at`; `delete` removes; `deleteAllForEmail` returns the count removed and leaves other emails; `findById` on an unknown id returns null.
- audit: `record` stores action, actor, target, ip, details and the given timestamp; an `update` or `delete` on the row raises `audit_log is append-only` (assert with `rejects.toThrow(/append-only/)`); `record` with details containing an "@" string is rejected before any SQL (unit-level `assertNoPersonalData` call in the adapter).
- attempts: `create` then `consume` returns the attempt once and null the second time; an attempt older than 10 minutes by the supplied `now` returns null and is deleted.

- [ ] **Step 2: Run to verify failure**, **Step 3: implement** the adapters with parameterized SQL; `consume` is one statement: `delete from sign_in_attempt where id = $1 and expires_at > $2 returning *`; `create` sets `expires_at = created_at + interval '10 minutes'`.

- [ ] **Step 4: Run** `pnpm test:integration && pnpm lint && pnpm typecheck && pnpm format:check`. Confirm `MIGRATION_DIRS` picked up `src/modules/identity/infrastructure/migrations` (the global setup applied it; the tests would fail otherwise).

- [ ] **Step 5: Commit** `feat(identity): session, audit log and sign-in attempt ports with Postgres adapters`

---

### Task 11: Google OpenID Connect adapter and a local test issuer

**Files:**
- Create: `src/modules/identity/infrastructure/google-oidc.ts`
- Create: `tests/fakes/oidc-issuer.ts`
- Test: `tests/integration/identity/google-oidc.test.ts`
- Create: `specs/decisions/0018-identity-implementation.md`
- Modify: `package.json` (`openid-client`; `jose` as dev dependency for the fake issuer)

**Interfaces:**

```ts
// google-oidc.ts
export class GoogleOidcAdmin implements AdminIdentity {
  constructor(opts: { issuer: string; clientId: string; clientSecret: string; allowedHostedDomain: string; fetch?: typeof fetch })
  //  Discovery is performed once lazily and cached. beginSignIn generates state, nonce and a PKCE verifier via openid-client's
  //  randomState/randomNonce/randomPKCECodeVerifier, and builds the authorization URL with scope "openid email profile",
  //  the `hd` parameter set to allowedHostedDomain (a hint only; admission is decided by the claims), response_type code, S256.
  //  completeSignIn validates state, exchanges the code with the verifier and expected nonce, and maps the ID token claims
  //  to IdentityClaims { email, emailVerified: email_verified, hostedDomain: hd, name }. Any openid-client error maps to
  //  "exchange_failed" (token endpoint, network) or "invalid_token" (signature, issuer, audience, expiry, nonce).
}

// tests/fakes/oidc-issuer.ts
export interface FakeIssuer {
  issuer: string;                 // http://127.0.0.1:<port>
  clientId: string; clientSecret: string;
  /** Registers what the next token exchange will return for a given code. */
  grant(code: string, claims: Record<string, unknown>, opts?: { signWithWrongKey?: boolean; omitNonce?: boolean }): void;
  close(): Promise<void>;
}
export async function startFakeIssuer(): Promise<FakeIssuer>;
//  node:http server with: GET /.well-known/openid-configuration (issuer, authorization_endpoint, token_endpoint, jwks_uri,
//  id_token_signing_alg_values_supported ["RS256"], code_challenge_methods_supported ["S256"]), GET /jwks (the RSA public key),
//  POST /token (form body with code; returns access_token "x", token_type "bearer", id_token signed RS256 with jose using the
//  registered claims plus iss, aud, iat, exp, and nonce taken from the stored authorization request unless omitNonce).
//  GET /authorize records nonce and state per client and redirects to redirect_uri with code and state. Tests drive it with fetch(redirect: "manual").
```

- [ ] **Step 1: Write the failing test**

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GoogleOidcAdmin } from "@/modules/identity/infrastructure/google-oidc";
import { startFakeIssuer, type FakeIssuer } from "../../fakes/oidc-issuer";

let issuer: FakeIssuer;
beforeAll(async () => { issuer = await startFakeIssuer(); });
afterAll(() => issuer.close());

const redirectUri = "http://localhost:3000/admin/auth/callback";
function adapter() { return new GoogleOidcAdmin({ issuer: issuer.issuer, clientId: issuer.clientId, clientSecret: issuer.clientSecret, allowedHostedDomain: "example.com" }); }

/** Follows the authorization URL against the fake issuer and returns the callback URL it redirects to. */
async function authorize(url: string) {
  const res = await fetch(url, { redirect: "manual" });
  return res.headers.get("location") ?? "";
}

describe("GoogleOidcAdmin", () => {
  it("builds an authorization URL with PKCE, state, nonce and the hd hint", async () => {
    const start = await adapter().beginSignIn(redirectUri);
    const u = new URL(start.authorizationUrl);
    expect(u.origin).toBe(issuer.issuer);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toBe(start.state);
    expect(u.searchParams.get("nonce")).toBe(start.nonce);
    expect(u.searchParams.get("hd")).toBe("example.com");
    expect(u.searchParams.get("scope")).toContain("openid");
  });
  it("completes a sign-in and returns the claims", async () => {
    const a = adapter();
    const start = await a.beginSignIn(redirectUri);
    issuer.grant("code-1", { sub: "1", email: "ana@example.com", email_verified: true, hd: "example.com", name: "Ana" });
    const cb = await authorize(start.authorizationUrl + "&__code=code-1");
    const done = await a.completeSignIn({ url: cb }, { ...start, redirectUri });
    expect(done).toEqual({ ok: true, claims: { email: "ana@example.com", emailVerified: true, hostedDomain: "example.com", name: "Ana" } });
  });
  it("passes through claims for a wrong domain unchanged; admission is the domain's job", async () => {
    const a = adapter(); const start = await a.beginSignIn(redirectUri);
    issuer.grant("code-2", { sub: "2", email: "x@gmail.com", email_verified: true, name: "X" });
    const done = await a.completeSignIn({ url: await authorize(start.authorizationUrl + "&__code=code-2") }, { ...start, redirectUri });
    expect(done).toMatchObject({ ok: true, claims: { email: "x@gmail.com", hostedDomain: undefined } });
  });
  it("rejects a state mismatch, a bad signature and a wrong nonce", async () => {
    const a = adapter(); const start = await a.beginSignIn(redirectUri);
    issuer.grant("code-3", { sub: "3", email: "ana@example.com", email_verified: true, hd: "example.com" });
    const cb = await authorize(start.authorizationUrl + "&__code=code-3");
    expect(await a.completeSignIn({ url: cb }, { ...start, state: "other", redirectUri })).toEqual({ ok: false, reason: "state_mismatch" });
    issuer.grant("code-4", { sub: "4", email: "ana@example.com", email_verified: true, hd: "example.com" }, { signWithWrongKey: true });
    const start4 = await a.beginSignIn(redirectUri);
    expect(await a.completeSignIn({ url: await authorize(start4.authorizationUrl + "&__code=code-4") }, { ...start4, redirectUri })).toEqual({ ok: false, reason: "invalid_token" });
    issuer.grant("code-5", { sub: "5", email: "ana@example.com", email_verified: true, hd: "example.com" }, { omitNonce: true });
    const start5 = await a.beginSignIn(redirectUri);
    expect(await a.completeSignIn({ url: await authorize(start5.authorizationUrl + "&__code=code-5") }, { ...start5, redirectUri })).toEqual({ ok: false, reason: "invalid_token" });
  });
  it("reports exchange_failed when the token endpoint errors", async () => {
    const a = adapter(); const start = await a.beginSignIn(redirectUri);
    const cb = await authorize(start.authorizationUrl + "&__code=unknown-code");
    expect(await a.completeSignIn({ url: cb }, { ...start, redirectUri })).toEqual({ ok: false, reason: "exchange_failed" });
  });
});
```

The `__code` query parameter is a test-only convention the fake issuer reads to decide which registered grant to return on `/authorize`; a real issuer ignores unknown parameters.

- [ ] **Step 2: Run to verify failure**, **Step 3: implement**. `pnpm add openid-client && pnpm add -D jose`. Use openid-client v6's functional API: `discovery(new URL(issuer), clientId, clientSecret, undefined, { execute: [allowInsecureRequests] only when issuer starts with "http://127.0.0.1" })`, `buildAuthorizationUrl`, `authorizationCodeGrant(config, new URL(input.url), { pkceCodeVerifier, expectedNonce, expectedState })`, `tokens.claims()`. Map errors by inspecting the thrown error's `code`/class: `ResponseBodyError`/`AuthorizationResponseError` → `exchange_failed`; claim or JWT validation errors → `invalid_token`; state mismatch is checked before calling the library by comparing the callback `state` to the expected one. Confirm the exact export names against `node_modules/openid-client/build/index.d.ts` and record them in the report.

ADR 0018 (accepted, under 45 lines): openid-client over Auth.js and hand-rolled flows; PKCE plus state and nonce; sign-in attempts stored server-side in `sign_in_attempt` keyed by an opaque cookie, single-use, ten-minute expiry; server-side sessions in `admin_session` referenced by an opaque cookie; CSRF by a per-session token compared on every state-changing request; the `hd` parameter is a hint and admission is decided from the claims by the domain policy; audit rows are append-only by trigger.

- [ ] **Step 4: Run** `pnpm test:integration tests/integration/identity && pnpm lint && pnpm typecheck && pnpm format:check`.

- [ ] **Step 5: Commit** `feat(identity): Google OpenID Connect adapter with a local test issuer`

---

### Task 12: Identity use cases and public API

**Files:**
- Create: `src/modules/identity/application/start-sign-in.ts`, `complete-sign-in.ts`, `current-session.ts`, `sign-out.ts`, `revoke-sessions.ts`, `index.ts`
- Create: `src/modules/identity/application/testing/fakes.ts` (in-memory `SessionRepository`, `AuditLog`, `SignInAttemptStore`, `AdminIdentity`, `UnitOfWorkFactory` for unit tests)
- Test: one `*.test.ts` beside each use case

**Interfaces:**

```ts
export interface IdentityDeps {
  identity: AdminIdentity; sessions: SessionRepository; audit: AuditLog; attempts: SignInAttemptStore;
  uow: UnitOfWorkFactory; clock: Clock; ids: IdGenerator; allowedHostedDomain: string; publicBaseUrl: string;
}
export interface RequestMeta { ip: string | null }

// start-sign-in.ts
export async function startSignIn(deps, input: { returnTo: string }): Promise<{ attemptId: string; authorizationUrl: string }>;
//  returnTo is sanitized by sanitizeReturnTo (exported): must start with "/admin" and contain no scheme or "//"; else "/admin".
//  redirectUri = `${publicBaseUrl}/admin/auth/callback`. Stores a SignInAttempt (state, nonce, codeVerifier, returnTo).

// complete-sign-in.ts
export type CompleteSignInResult =
  | { outcome: "signed_in"; session: Session; returnTo: string }
  | { outcome: "denied" }                       // admission refused; audit sign_in_rejected { domain }
  | { outcome: "retry" }                        // attempt missing/expired or state mismatch: the route restarts once
  | { outcome: "error" };                       // exchange failed or invalid token
export async function completeSignIn(deps, input: { attemptId: string | null; callbackUrl: string; meta: RequestMeta }): Promise<CompleteSignInResult>;
//  consumes the attempt (single use), completes with the adapter, admits, then in one unit of work creates the session
//  (new id, new csrf token from ids.newId(), createdAt = lastSeenAt = now) and audits sign_in with actorEmail and ip.

// current-session.ts
export type CurrentSession = { state: "active"; session: Session } | { state: "none" } | { state: "expired"; reason: SessionState };
export async function currentSession(deps, input: { sessionId: string | null; meta: RequestMeta }): Promise<CurrentSession>;
//  none when no cookie or no row. On expiry: deletes the row and audits session_expired once (actorEmail set, details { reason }) in a uow,
//  returns expired. On active: touches lastSeenAt at most once per 60 seconds (skip the write when lastSeenAt is within 60 s).

// sign-out.ts
export async function signOut(deps, input: { sessionId: string; csrfToken: string; meta: RequestMeta }): Promise<"signed_out" | "csrf_mismatch" | "no_session">;
//  compares tokens with a constant-time comparison; on match deletes the session and audits sign_out in one uow.

// revoke-sessions.ts
export async function revokeSessionsForEmail(deps, input: { email: string; actorEmail: string | null }): Promise<number>;
//  deletes all sessions for the email and audits action "sessions_revoked" with actorEmail = the operator, targetId null
//  (a target id must never be an address) and details { count }.

// index.ts: the public API
export type { StaffIdentity, Session, AuditEntry, AuditAction, IdentityDeps, RequestMeta, CurrentSession, CompleteSignInResult };
export type { AdminIdentity, SessionRepository, AuditLog, SignInAttemptStore } from "./ports/...";
export { startSignIn, completeSignIn, currentSession, signOut, revokeSessionsForEmail, sanitizeReturnTo, auditActions, assertNoPersonalData, IDLE_HOURS, ABSOLUTE_DAYS, sessionCookieMaxAgeSeconds };
```

- [ ] **Step 1: Write the failing tests** with the fakes (highlights, one `it` each; the fake `AdminIdentity` returns scripted completions and records the redirect URI it was given):
- `startSignIn` stores an attempt whose `returnTo` is sanitized: `/admin/forms/1` kept; `https://evil.example/admin` → `/admin`; `//evil.example` → `/admin`; `/f/slug` → `/admin`; passes `${publicBaseUrl}/admin/auth/callback` as redirect URI.
- `completeSignIn` happy path: session created with `createdAt === lastSeenAt === clock.now()`, csrf token present, audit `sign_in` with actor and ip, returns the attempt's `returnTo`.
- a second call with the same attempt id returns `retry` and creates nothing (Review Focus 2).
- admission refused (hd gmail.com, valid signature per the fake) returns `denied`, no session, audit `sign_in_rejected` with `details.domain === "gmail.com"`, `actorEmail` null (Review Focus 1).
- adapter `invalid_token` returns `error` and audits nothing; adapter `state_mismatch` returns `retry`.
- `currentSession`: active within limits and touches when stale by more than 60 s, not when touched 30 s ago; idle-expired deletes the row and audits `session_expired` once with `details.reason === "idle_expired"`; absolute-expired likewise; unknown id returns `none` with no audit (Review Focus 3).
- `signOut`: matching token deletes and audits `sign_out`; wrong token returns `csrf_mismatch` and leaves the session; unknown session returns `no_session`.
- `revokeSessionsForEmail` deletes 2 of 3 sessions and audits `sessions_revoked` with `details.count === 2` and no address in details.

- [ ] **Step 2: Run to verify failure**, **Step 3: implement**. Constant-time compare: `timingSafeEqual` is a Node core module, which application code may not import; implement a plain loop that XORs char codes over the longer length and never short-circuits. Put `sanitizeReturnTo` in `start-sign-in.ts`:

```ts
export function sanitizeReturnTo(input: string | null | undefined): string {
  if (!input) return "/admin";
  if (!input.startsWith("/admin") || input.startsWith("//") || /[\\\u0000-\u001f]/.test(input) || input.includes("://")) return "/admin";
  return input;
}
```

- [ ] **Step 4: Run** `pnpm test src/modules/identity && pnpm lint && pnpm typecheck && pnpm format:check`.

- [ ] **Step 5: Commit** `feat(identity): sign-in, session, sign-out and revocation use cases with a public API`

---

### Task 13: Composition root, routes, admin gate and pages

**Files:**
- Create: `src/app/container.ts`, `src/app/admin/layout.tsx`, `src/app/admin/page.tsx`
- Create: `src/app/admin/auth/signin/route.ts`, `callback/route.ts`, `signout/route.ts`, `denied/page.tsx`, `signed-out/page.tsx`, `error/page.tsx`
- Create: `src/modules/identity/presentation/DeniedPage.tsx`, `SignedOutPage.tsx`, `SignInErrorPage.tsx`, `AdminShell.tsx`, `SignOutForm.tsx`, `cookies.ts`
- Test: `src/app/admin/auth/routes.test.ts` (route handlers called with `Request` objects against a container built on the identity fakes), `src/modules/identity/presentation/cookies.test.ts`

**Interfaces:**

```ts
// src/app/container.ts
export interface Container { config: AppConfig; logger: Logger; pool: Pool; uow: UnitOfWorkFactory; queue: JobQueue; jobStore: PgJobStore; identity: IdentityDeps }
export function getContainer(): Container;             // lazily built singleton from loadConfig(process.env); in tests, buildContainer(overrides)
export function buildContainer(config: AppConfig, overrides?: Partial<Container>): Container;

// presentation/cookies.ts (framework-free helpers over Set-Cookie strings)
export const ATTEMPT_COOKIE = "effluz_signin";
export function sessionCookie(name: string, value: string, opts: { secure: boolean; maxAgeSeconds: number }): string;
//  `${name}=${value}; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=...; Secure` (Secure only when opts.secure)
export function clearedCookie(name: string, secure: boolean): string;    // Max-Age=0
export function readCookie(header: string | null, name: string): string | null;
```

Routes (each reads the container, calls one use case, maps the result):
- `GET /admin/auth/signin?returnTo=…` → `startSignIn`; sets the attempt cookie (`Path=/admin/auth`, HttpOnly, SameSite=Lax, Max-Age 600, Secure per config) and 302s to the authorization URL.
- `GET /admin/auth/callback` → `completeSignIn` with the attempt cookie and the full URL. `signed_in`: set the session cookie, clear the attempt cookie, 302 to `returnTo`. `denied`: 302 `/admin/auth/denied`. `retry`: if the query has no `retried=1`, 302 to `/admin/auth/signin?returnTo=/admin&retried=1`, else 302 `/admin/auth/error`. `error`: 302 `/admin/auth/error`. Client IP from `x-forwarded-for` first value, else null.
- `POST /admin/auth/signout` with form field `csrf` → `signOut`; on `signed_out` clear the cookie and 302 `/admin/auth/signed-out`; on `csrf_mismatch` 403; on `no_session` 302 `/admin/auth/signed-out`.
- `src/app/admin/(gated)/layout.tsx` (server component): reads the session cookie via `next/headers`, calls `currentSession`; `none` or `expired` → `redirect` to `/admin/auth/signin?returnTo=<path>`, where the path is taken from an `x-pathname` request header when present and falls back to `/admin` (Next.js server layouts do not expose the request path; the manager plan may add a proxy that sets that header); `active` → renders `AdminShell` with the identity and children. The auth pages under `/admin/auth/*` live outside this layout: put the gated pages under `src/app/admin/(gated)/layout.tsx` and `(gated)/page.tsx`, and the auth routes and pages under `src/app/admin/auth/` with no gate.
- `AdminShell` renders a header with the wordmark text placeholder "Effluz", the signed-in name, and `SignOutForm` (a plain `<form method="post" action="/admin/auth/signout">` with a hidden `csrf` input). Pages are static server components with the copy from `specs/ui-ux/manager.md` where it exists (`nav.sign_out`), otherwise plain English and Spanish placeholders marked for the manager plan.

- [ ] **Step 1: Write the failing tests**

`cookies.test.ts`: `sessionCookie("s", "v", { secure: true, maxAgeSeconds: 10 })` equals `s=v; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=10; Secure`; without secure no `Secure`; `readCookie("a=1; s=v; b=2", "s")` is `v`; `readCookie(null, "s")` is null.

`routes.test.ts` (with `buildContainer(testConfig, { identity: fakesDeps })`):
- signin: response 302, `Location` is the fake authorization URL, `Set-Cookie` has the attempt cookie with `Path=/admin/auth; HttpOnly`.
- callback happy path: 302 to `/admin/forms` (the sanitized returnTo), `Set-Cookie` includes the session cookie with `Path=/admin; HttpOnly; SameSite=Lax` and the cleared attempt cookie.
- callback denied: 302 `/admin/auth/denied`, no session cookie.
- callback retry without `retried=1`: 302 to the signin route with `retried=1`; with it: 302 `/admin/auth/error`.
- callback with `returnTo` of `https://evil.example/admin` in the stored attempt was already sanitized at start; assert a start with that value ends at `/admin` (Review Focus 5).
- signout with the right csrf: 302 `/admin/auth/signed-out` and a cleared cookie; wrong csrf: 403.

- [ ] **Step 2: Run to verify failure**, **Step 3: implement**. Keep `src/app/*` files thin; all string building for cookies and redirects goes through `presentation/cookies.ts` and the use cases.

- [ ] **Step 4: Run** `pnpm test && pnpm lint && pnpm typecheck && pnpm format:check && pnpm build`. Then a manual check against a real Google OAuth client if you have one configured in `.env`; otherwise note it as not exercised.

- [ ] **Step 5: Commit** `feat(app): admin sign-in routes, session gate and placeholder admin shell`

---

### Task 14: Session revocation CLI and runbook

**Files:**
- Create: `src/app/cli/revoke-sessions.ts`, `ops/runbooks/revoke-sessions.md`, `ops/README.md`
- Modify: `package.json` (script `sessions:revoke`)

- [ ] **Step 1: Write the CLI** (no unit test beyond the use case already tested; verify by hand): parses one argument, the email; refuses when missing or not containing `@`; builds the container with `SERVICE=app`; calls `revokeSessionsForEmail` with `actorEmail` from `OPERATOR_EMAIL` env or null; prints `Revoked N sessions` and exits 0. Script: `"sessions:revoke": "tsx src/app/cli/revoke-sessions.ts"`.

- [ ] **Step 2: Write the runbook** `ops/runbooks/revoke-sessions.md`: when (someone leaves, a device is lost), command on the server (`docker compose exec app pnpm sessions:revoke <email>`), what it does (deletes every `admin_session` row for the address, audits `sessions_revoked`), what it does not do (remove them from the Workspace, which is the real offboarding step), verification query. `ops/README.md`: one paragraph on what lives here, per `specs/system/deployment.md` (provisioning script and Compose files arrive with the deployment plan).

- [ ] **Step 3: Verify by hand** against the dev database: create a session row by signing in, or insert one with `psql`, then `pnpm sessions:revoke a@example.com` prints the count and the audit row exists.

- [ ] **Step 4: Commit** `feat(app): session revocation command and runbook`

---

### Task 15: Specs, ADR cross-references, README

**Files:**
- Modify: `specs/architecture.md` (Technology decisions table: rows for Postgres access `pg` with hand-written SQL, ADR 0017; logging `pino`, ADR 0019; OIDC `openid-client`, ADR 0018. Ports table: add `Logger` to `Clock`, `IdGenerator` row; add `AuditLog` with first adapter Postgres and spec `system/security.md`; note `SessionRepository` and `SignInAttemptStore` as identity-internal ports)
- Modify: `specs/system/database.md` (tables: add `schema_migration` (shared), `worker_heartbeat` (shared), `sign_in_attempt` (identity); note the `audit_log` append-only trigger; Local development: `pnpm db:up`, `pnpm db:migrate`, throwaway databases named `effluz_test_*`)
- Modify: `specs/system/security.md` (Sessions: "CSRF token: a per-session random token issued at sign-in, embedded in every state-changing form, compared in constant time"; sign-in attempts single-use, 10 minutes)
- Modify: `specs/system/deployment.md` (Local development: `pnpm db:up`, `pnpm db:migrate`, `pnpm dev`, `SERVICE=worker pnpm worker`; the `.env.example` variables list lives in the file itself)
- Modify: `specs/system/jobs.md` (add `discard_reason` column; heartbeat table name; worker id)
- Modify: `README.md` Develop section:

```
    corepack enable
    pnpm install
    cp .env.example .env
    pnpm db:up && pnpm db:migrate
    pnpm dev            # app on :3000
    pnpm worker         # in a second terminal
    pnpm test && pnpm test:integration
```

- [ ] **Step 1: Make the edits**, hand-wrapped at 80 columns, each statement checked against the code as built (table names, scripts, cookie attributes, timeouts).
- [ ] **Step 2: Run** `pnpm format:check` (specs are ignored; code untouched) and read each changed spec section once more against the implementation.
- [ ] **Step 3: Commit** `docs: sync architecture, database, security and deployment specs with the foundation and identity code`

---

### Task 16: PR and CI

- [ ] **Step 1: Full verification**: `pnpm db:up && pnpm test && pnpm test:integration && pnpm lint && pnpm typecheck && pnpm format:check && pnpm build`.
- [ ] **Step 2: Push and open the PR** against `main`, title `feat: persistence foundation and identity module`, body listing the spec sections implemented (`system/database.md` UnitOfWork and Migrations, `system/jobs.md` port, table and worker, `system/security.md` Admin authentication, Sessions, Audit log, `use-cases/sign-in.md`, `system/deployment.md` Health endpoint and Local development, `system/ci-cd.md` integration job), ADRs 0017 to 0019, and what is deliberately absent (manager UI beyond a placeholder shell, e2e job, Dockerfile). End with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] **Step 3: Confirm** all six CI jobs pass (`lint`, `typecheck`, `unit`, `integration`, `build`, `ci`). The controller merges and cleans up.

---

## Self-review notes

- **Spec coverage.** Database: UnitOfWork, conventions, migrations, local dev (Tasks 3, 4, 15); backups and restore belong to the deployment plan. Jobs: port, table, worker behavior, recurring jobs, `jobs.cleanup` (Tasks 5, 6); other handlers arrive with their modules. Security: admin authentication, sessions, CSRF, audit log (Tasks 9 to 13); abuse protection and headers belong to the renderer and deployment plans. Sign-in use case: every flow and audit entry (Tasks 11 to 13), the runbook step (Task 14). Deployment: health endpoint and local development (Tasks 1, 7, 15); provisioning, Compose production stack and release procedure are the deployment plan. CI: integration job (Task 8); e2e waits for the renderer. Observability: logging (Task 2); error tracker and uptime monitor are proposed items, not in scope.
- **Deliberately absent.** The manager's real shell and navigation (manager plan), the e2e job and Playwright, the production Dockerfile and `compose.yml` (deployment plan), Sentry, rate limiting at the proxy.
- **Type consistency.** `UnitOfWork.handle` is `unknown` in the port and narrowed by `txOf` in infrastructure; every Postgres adapter takes a `UnitOfWork` for writes and the pool for reads. `IdentityClaims` is defined once in the domain and reused by the adapter. `Session` is the domain type the repository stores verbatim.
- **Review Focus** tests: 1 in Tasks 11 and 12; 2 in Task 12; 3 in Tasks 12 and 13; 4 in Task 6; 5 in Tasks 12 and 13.
- **Known coupling to revisit.** `src/app/admin/(gated)/layout.tsx` derives the return path imperfectly because Next.js server layouts do not expose the request path; the manager plan can add a tiny proxy that sets an `x-pathname` header if the fallback proves annoying.
