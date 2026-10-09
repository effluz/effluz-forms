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
  data/staging/        photos awaiting upload
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

## Release procedure

Triggered by the CI/CD workflow on every push to `main` that passes CI
(`system/ci-cd.md`):

1. Image built and pushed to the registry, tagged with the commit SHA and
   `latest`.
2. Over SSH as `deploy`: copy `compose.yml`, write the new SHA into the
   environment, `docker compose pull`.
3. Run migrations in a one-off container against the live database.
4. `docker compose up -d` recreates `app` and `worker`.
5. Poll the health endpoint through the proxy for up to two minutes.
6. On failure: set the previous SHA, `up -d` again, exit non-zero so the
   workflow is red. Migrations are forward-compatible, so no schema rollback
   is attempted.

Deploys are serialized by a GitHub Actions concurrency group.

## Health endpoint

`GET /health` returns JSON with: app version, database reachable, worker
heartbeat age, dead job count, staging directory writable. Returns 503 if the
database is unreachable or the worker heartbeat is older than five minutes.
It is public but reveals nothing sensitive.

## Runbooks

Kept in `ops/runbooks/`, one file each, written before the first production
deploy:

- Restore the database from a backup.
- Rotate each secret listed in `security.md`.
- Retry or discard dead jobs.
- Resize the staging disk or clear stuck staging files.
- Move the whole stack to a new server (provision, restore, point DNS).

## Local development

`compose.dev.yml` starts Postgres and the mail catcher. The Next.js dev server
and the worker run on the host for fast iteration. `.env.example` is sufficient to start with the
local adapters; Dropbox and Google credentials are needed only to exercise
those adapters manually.
