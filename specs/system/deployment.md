# Deployment

Owns: the VPS, the Compose stack, the reverse proxy, the release procedure,
runbooks. Decision record: `decisions/0004-single-vps-docker-compose.md`.

## Server baseline

- One InterServer VPS, current Ubuntu LTS, United States region. Personal
  data therefore rests in the US; the builder's consent guidance tells staff
  to say so when submitters are elsewhere.
- Docker Engine with the Compose plugin, installed from Docker's repository.
- Unattended security upgrades on. Firewall allows only 22, 80, 443.
- SSH by key only, root login disabled, a dedicated `deploy` user in the
  `docker` group. Fail2ban on SSH.
- Time synced; all containers run in UTC.

Provisioning is a documented, repeatable script in `ops/provision.sh`, run
once per server and kept current. It is the only way a server is set up.

## Directory layout on the server

```
/srv/effluz-forms/
  compose.yml          production stack, copied from the repo at deploy
  .env                 secrets, mode 600, owned by deploy, never in git
  data/postgres/       database volume
  data/staging/        files awaiting upload
  data/caddy/          certificates and proxy state
  backups/             last local copy of the nightly dump before upload
```

## The Compose stack

| Service | Image | Notes |
|---|---|---|
| `proxy` | Caddy | Automatic TLS, rate limiting, body size limit, security headers, serves `app` |
| `app` | `ghcr.io/effluz/effluz-forms:<sha>` | Next.js server: renderer, builder, manager |
| `worker` | same image | Entry point runs the Node job poller, no Next.js; one replica |
| `db` | Postgres, pinned major | Named volume, internal network only |

`app` and `worker` are stateless apart from the staging directory, which they
share as a bind mount. Health checks are defined per service and Compose does
not route to an unhealthy `app`.

The worker finishes the poll in progress when it is stopped, including running
handlers (`jobs.md`, "Worker behavior"). Its `stop_grace_period` must be longer
than the job timeout, which is the lease minus 15 seconds (75 seconds by
default).

### Server environment

The server's `.env` must set `NODE_ENV=production`, and both `app` and
`worker` must receive it. The variable has no default and start-up fails
without it: `next start` sets it only when it is unset, and `tsx`, which runs
the worker, sets nothing. A copied `NODE_ENV=development` would drop `Secure`
from every cookie and accept the local adapters. In production the
configuration refuses `MEDIA_PROVIDER=local`, `EMAIL_PROVIDER=mailpit`, and a
`PUBLIC_BASE_URL`, `GOOGLE_ISSUER`, `SMTP2GO_API_URL`, `DROPBOX_API_URL` or
`DROPBOX_CONTENT_URL` that is not `https`.

### Reverse proxy

Caddy terminates TLS and applies the request body limits in front of the app,
which itself accepts up to 101 MB on every path (Next's proxy body limit is
global):

| Path | Body limit |
|---|---|
| `/f/<slug>` (the page post) | At least 101 MB plus multipart overhead: 102 MB |
| `/f/<slug>/files` (one early upload) | At least 10 MB + 64 KB: 11 MB |
| Everything else, `/admin` included | 1 MB |

Headers:

- Caddy adds no Content-Security-Policy on `/f/*`. The app's proxy sets a
  policy with a per-request nonce there (`security.md`, "Transport and
  headers"); a second policy without the nonce would block Next's bootstrap.
- On `/admin/*` Caddy adds `Referrer-Policy: no-referrer` and
  `Content-Security-Policy: frame-ancestors 'none'`, because the app sets
  neither on admin pages.
- Caddy sets `X-Forwarded-For` itself and never passes a client-supplied one
  through (`security.md`, "Audit log").

## Release procedure

Triggered by the CI/CD workflow on every push to `main` that passes CI
(`system/ci-cd.md`):

1. Image built and pushed to the registry, tagged with the commit SHA and
   `latest`.
2. Over SSH as `deploy`: copy `compose.yml`, write the new SHA into the
   environment, `docker compose pull`.
3. Run migrations in a one-off container against the live database
   (`pnpm db:migrate`; see "What the image must contain").
4. `docker compose up -d` recreates `app` and `worker`.
5. Poll the health endpoint through the proxy for up to two minutes.
6. On failure: set the previous SHA, `up -d` again, exit non-zero so the
   workflow is red. Migrations are forward-compatible, so no schema rollback
   is attempted.

Deploys are serialized by a GitHub Actions concurrency group.

Server Action ids change with every build. A visitor without script whose
page was rendered before a deploy posts to an id the new build does not know,
and sees the error screen once; their progress is on the in-progress record,
so "Try again" returns them to the page they were on.

## Health endpoint

`GET /health` returns JSON with these fields:

| Field | Meaning |
|---|---|
| `status` | `ok` or `degraded` |
| `version` | `APP_VERSION`, or `unknown` when the configuration is invalid |
| `database` | `select 1` succeeded |
| `workerHeartbeatSeconds` | Seconds since the newest worker heartbeat, or `null` when none exists |
| `deadJobs` | Number of `dead` jobs |
| `stagingWritable` | The staging directory is writable |

The status is `degraded`, and the response `503`, when the database is
unreachable or the worker heartbeat is missing or older than five minutes.
Dead jobs and an unwritable staging directory are reported but do not degrade
the status. Each probe is bounded to 3 seconds. A probe that fails or times
out counts as failed (database and staging `false`, heartbeat `null`, dead
jobs `0`). A probe that fails is logged as a warning with the probe name and
error class only; one that times out is not logged. An invalid configuration
yields a degraded report, never an error page. The
response is never cached. It is public but reveals nothing sensitive.

## Runbooks

Kept in `ops/runbooks/`, one file each, written before the first production
deploy:

- Revoke a person's admin sessions: `ops/runbooks/revoke-sessions.md`
  (written).
- Restore the database from a backup.
- Rotate each secret listed in `security.md`.
- Retry or discard dead jobs.
- Resize the staging disk or clear stuck staging files.
- Move the whole stack to a new server (provision, restore, point DNS).

## Local development

`compose.dev.yml` starts Postgres and the mail catcher. The Next.js dev server
and the worker run on the host for fast iteration. `.env.example` is sufficient
to start with the local adapters; Dropbox and Google credentials are needed
only to exercise those adapters manually. The variables and their defaults are
documented in `.env.example` itself.
Media goes to `MEDIA_DURABLE_DIR` on local disk and email to Mailpit
(`MAILPIT_URL`, web view at http://127.0.0.1:8025) unless
`MEDIA_PROVIDER=dropbox` or `EMAIL_PROVIDER=smtp2go` is set with its
credentials.

| Command | Does |
|---|---|
| `pnpm db:up` / `pnpm db:down` | Start or stop the Compose services |
| `pnpm db:migrate` | Apply pending migrations (`database.md`) |
| `pnpm dev` | Next.js dev server on port 3000 |
| `pnpm worker` | Job worker; it always runs as `SERVICE=worker`, whatever the environment says |
| `pnpm sessions:revoke <address>` | Revoke someone's admin sessions |
| `pnpm test` | Unit tests |
| `pnpm test:integration` | Integration tests against a throwaway database |
| `pnpm test:e2e` | HTTP end-to-end tests against the built app on port 3199; run `pnpm build` first |
| `pnpm test:e2e:browser` | Browser end-to-end tests in Chromium against the built app on port 3299; run `pnpm build` first, and once `pnpm exec playwright install chromium` |
| `pnpm lint` | ESLint, including the layer and module boundaries |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm format:check` | Prettier check (`pnpm format` fixes) |
| `pnpm build` | Production build of the Next.js app |

The Next commands (`pnpm dev`, `pnpm build`, `pnpm start`) read `.env`.
`db:migrate`, `worker` and `sessions:revoke` run through `tsx`, which does
not, so export the variables in the shell or run
`pnpm exec tsx --env-file=.env <file>`. Every entry point needs `NODE_ENV`;
`.env.example` sets `development`.

### What the image must contain

`db:migrate`, `worker` and `sessions:revoke` run TypeScript source with `tsx`,
which is a development dependency today. The migration runner also reads the
`.sql` files in `src/` at run time, resolving them relative to its own source
file. The production image, and the one-off migration container, therefore need
`tsx` and `pnpm` installed, `tsconfig.json` (for the `@/` import alias), and
the whole `src/` tree including `src/**/*.sql`. The deployment plan must ship
all of these, or compile the entry points and copy the migrations next to
them.
