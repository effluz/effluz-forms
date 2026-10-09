# Database

Owns: the `UnitOfWork` port, schema conventions, migrations, backups.
Decision record: `decisions/0001-postgres-in-container.md`.

## Role

PostgreSQL is the single system of record. It holds submissions, media
records, the jobs outbox, admin sessions and the audit log. Photos themselves
are never stored in the database, only references.

## Deployment

- Runs as the `db` service in the Compose stack, pinned to a specific major
  version. Data on a named volume mounted from `/srv/effluz-forms/data/postgres`.
- Not exposed outside the Docker network. No published port in production.
- One database, one application role with the least privileges that migrations
  and runtime need. The superuser is used only by backups and manual ops.

## The `UnitOfWork` port

Use cases that change state obtain a unit of work, do their repository writes
and job enqueues through it, and commit once. The Postgres adapter maps this to
a single transaction. This is what makes the outbox reliable: a submission and
its jobs are either both committed or neither is.

Rules:

- A use case opens at most one unit of work and never nests them.
- Nothing outside `infrastructure/` imports the database driver.
- Read-only queries for the admin page may bypass the unit of work but still go
  through a repository.

## Schema conventions

- Table and column names in `snake_case`, singular table names per aggregate
  (`submission`, `media`, `job`).
- Every table has `id` (random UUID), `created_at`, `updated_at` in UTC.
- Submission tables are form-specific and defined by each form's migrations.
  Shared tables (`job`, `media`, `admin_session`, `audit_log`) live in
  `src/shared/infrastructure/`.
- Personal data columns are documented as such in the migration that adds
  them, so retention and export code can find them.
- No soft deletes for submissions. Retention means the row is gone.

## Migrations

- Versioned, forward-only, committed with the code that needs them.
- Run as a deploy step before the new app version starts.
- Must be compatible with the previous app version (expand, deploy, contract),
  so a failed deploy can roll the app back without rolling the schema back.
- Never edit a migration that has reached `main`. Add a new one.

## Backups

- A nightly `pg_dump` of the whole database, compressed and encrypted with a
  key that lives only on the server and in the team password manager.
- Uploaded to a dedicated Dropbox backup folder through the same media port.
  Thirty daily copies retained, then pruned.
- The staging directory is not backed up. By design it only holds photos whose
  upload job has not yet succeeded, and the job will retry.
- **Restore is tested quarterly** against a local stack and the result is
  recorded in `specs/decisions/` as a short note. An untested backup is not a
  backup.

## Local development

Compose starts Postgres with the same major version. Integration tests run
against a throwaway database created per test run, never against the dev
database.
