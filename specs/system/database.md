# Database

Owns: the `UnitOfWork` port, schema conventions, migrations, backups.
Decision record: `decisions/0001-postgres-in-container.md`.

## Role

PostgreSQL is the single system of record. It holds form definitions and
their versions, submissions, media records, the jobs outbox, the worker
heartbeat, admin sessions, in-flight sign-in attempts and the audit log.
Photos themselves are never stored in the database, only references.

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
- The database driver is imported only in `infrastructure/`, in the
  composition root (type only) and in the health route's pool probe.
- Read-only queries for the admin page may bypass the unit of work but still go
  through a repository.
- Mutating use cases re-read the aggregate inside the unit of work with a row
  lock (`for update`) before writing, and decide again on the locked rows.
  Every `definitions` use case that changes an existing form (edit draft,
  publish, lifecycle, delete, settings) locks the `form` row; the ones that
  write the draft (edit draft, publish) lock the `form_draft` row after it,
  always in that order. The submissions intake locks the
  `submission_in_progress` row, then the `form` row (through
  `allocateReference`), always in that order; taking a reference does not change
  `form.updated_at`, since a submission is not a form edit. Reads outside a unit
  of work are for display and early refusals. These are transactional row locks,
  held until the unit of work ends; they are not editor-visible locks (see
  `use-cases/create-and-edit-form.md`).

## Connections

- One `pg` pool per process, created by the composition root. The web pool
  holds at most 10 connections; the worker's holds `WORKER_CONCURRENCY` plus 2.
- Pools set `statement_timeout` to 30 seconds, wait at most 5 seconds for a
  connection, and name themselves `effluz-forms` in `application_name`. An
  idle connection that drops is logged as a warning, not a crash.
- The migration runner is the one exception to the statement timeout; see
  "Migrations".

## Schema conventions

- Table and column names in `snake_case`, singular table names per aggregate.
- Every table has `id` (random UUID), `created_at`, `updated_at` in UTC.
  Exceptions: `schema_migration`, the migration ledger; and the two
  `definitions` tables whose key is their natural one, `form_draft`
  (`form_id`) and `form_visit` (`form_id`, `email`).
- Core tables and the module that owns their migrations:

  | Table | Owner | Notes |
  |---|---|---|
  | `form` | `definitions` | `slug` (unique), `title` (jsonb `LocalizedText`) and `languages` (`bilingual`, `en`, `es`), both mirrored from the draft document so the list never reads documents, `status` (`draft`, `published`, `closed`, `archived`), `settings` (jsonb), `current_version_id` and `current_version_number` (null until the first publish), `archived_at`, `next_reference` (integer, starts at 1): the sequence of submission references, advanced only by `allocateReference` under the form row lock (ADR 0025) |
  | `form_draft` | `definitions` | one row per form, `form_id` is the key (deleted with the form); `document` (jsonb, mutable), `revision` (starts at 1, bumped by every write; an edit applies only to the revision it was based on), `updated_by`, `audited_by` and `audited_at` (the last `draft_saved` audit entry, for coalescing) |
  | `form_version` | `definitions` | `form_id`, `number` (unique per form), `document` (jsonb), `published_at`, `published_by`. **Never updated or deleted after insert**; the trigger `form_version_no_update` rejects both. |
  | `form_visit` | `definitions` | `form_id`, `email`, `last_opened_at`: when each staff member last opened each form, for the "new submissions" count. Key (`form_id`, `email`); deleted with the form. |
  | `submission_in_progress` | `submissions` | `id` (the random value of the `effluz_fill` cookie), `form_id`, `form_version_id` (the pinned version), `locale`, `page_key`, `answers` (jsonb, only valid answers), `files` (jsonb, staged files per field key), `pending` (jsonb, the last refused post's typed values and issues, or null; never a file name), `submit_token` (uuid), `started_at`, `expires_at` (24 hours after creation). Personal data; deleted at submit or by `jobs.cleanup` after expiry. |
  | `submission` | `submissions` | `form_id`, `form_version_id`, `locale`, `answers` (jsonb, **immutable after insert**: the trigger `submission_answers_immutable` rejects an update that changes it), `consent` (jsonb), `received_at`, `reference` (unique per form, `submission_form_reference_key`), `submit_token` (unique, `submission_submit_token_key`, so a repeated Submit finds the first submission), `status` (`new`, `viewed`, `edited`, `published`; default `new`), `curated_answers` (jsonb, default `{}`), `published_post_url`, `status_changed_by`, `status_changed_at` |
  | `submission_edit` | `review` | submission_id, field_key, text, source (`manual`, `suggested`), editor, created_at. Append-only. |
  | `media` | `media` | `submission_id`, `form_id`, `field_key`, `position` (1-based within the field), `kind` (`image`, `video`), `status` (`staged`, `stored`, `failed`), `content_type`, `size`, `staging_ref` (null once the staging copy is gone), `durable_key`, `provider_ref` (null until stored). No foreign key to `submission`: deletion goes through `media.delete` so a provider outage cannot leave a row pointing at nothing. |
  | `email_delivery` | `notifications` | `delivery_key` (unique: `<job type>:<submission id>`), `provider_message_id`. Lets a retried email job see the message was sent (ADR 0025). |
  | `schema_migration` | `shared` | the ledger: `id` (the four-digit migration id, text), `name`, `applied_at`. Created by the runner itself, not by a migration file. |
  | `job` | `shared` | see `jobs.md` |
  | `worker_heartbeat` | `shared` | one row per worker process: `worker_id` (unique), `last_seen_at`. See `jobs.md`. |
  | `admin_session` | `identity` | `email`, `name`, `csrf_token`, `last_seen_at`; `created_at` starts the absolute lifetime. Referenced by an opaque cookie. Expired rows go on the next request or with the daily `identity.cleanup` job. See `security.md`. |
  | `sign_in_attempt` | `identity` | `state`, `nonce`, `code_verifier`, `return_to`, `expires_at`. Single use: deleted when consumed, or by `identity.cleanup` once expired. Holds short-lived secrets, so it is never logged. See `security.md`. |
  | `audit_log` | `identity` | `action`, `actor_email`, `target_id`, `ip`, `details` (jsonb), `created_at`. **Append-only**: the trigger `audit_log_no_update` rejects every `UPDATE` and `DELETE`. See `security.md`. |

- Definitions and answers are jsonb documents validated by the form model
  (`shared/domain/form-model`) before they are written. The database does
  not know field types.
- `form.current_version_id` points at `form_version` through a deferrable
  foreign key checked at commit, so publish can insert the version and move
  the pointer in one transaction. `form_version.form_id` has no cascade: a
  form that has a version cannot be deleted, which backs the rule that only
  never-published forms are deleted.
- `answers` is personal data as a whole. Retention and export treat the
  document, never individual keys.
- Indexes: `submission (form_id, received_at desc)` for review listing;
  `submission_in_progress (expires_at)` for cleanup; the unique
  `media (submission_id, field_key, position)`, which also serves lookups by
  submission; `form (slug)` unique (`form_slug_key`) and `form (status)`;
  `audit_log (target_id, created_at desc, id desc)` (`audit_log_target_idx`) for
  the per-target activity listing and its `(created_at, id)` cursor; GIN on
  `answers` only if a real query needs it.
- No soft deletes for submissions. Retention means the row is gone. A form
  that has been published or has submissions is archived, never deleted; one
  that never was and has none can be deleted (audited), which removes its
  draft and visits with it.

## Migrations

- Versioned, forward-only, committed with the code that needs them.
- A migration is a plain `.sql` file named `NNNN_<name>.sql`: four digits,
  then lowercase letters, digits and underscores. Any other `.sql` name makes
  the runner fail.
- The module that owns a table keeps its migrations in
  `src/modules/<module>/infrastructure/migrations/`. Cross-cutting tables
  (`job`, `worker_heartbeat`) live in
  `src/shared/infrastructure/postgres/migrations/`. The runner picks up every
  module's `infrastructure/migrations/` folder that exists; a new module needs
  no registration.
- **One global sequence.** Ids are a single zero-padded four-digit sequence
  across the shared folder and every module folder. The runner merges the
  folders, sorts by id alone and refuses to start when two files share an id.
  That is why the identity tables are `0003_identity.sql` and not
  `0001_identity.sql`. Take the next free number; the module name carries no
  weight in the ordering.
- The runner (`src/shared/infrastructure/postgres/migrate.ts`) applies each
  pending migration in its own transaction and records it in
  `schema_migration`. It holds the Postgres advisory lock `727001` for the
  whole run, so concurrent deploys queue instead of interleaving. It disables
  `statement_timeout` on its own session, so a slow migration or a wait for the
  lock is never cut off, and it discards that connection afterwards.
- The ledger records the id, name and time of each migration, and has no
  checksum. A pending id lower than one already applied is still applied.
  "Never edit a migration" and "take the next number" are kept by review.
- Run as a deploy step before the new app version starts, with
  `pnpm db:migrate` (`src/app/cli/migrate.ts`). The command loads the full
  application configuration, so it needs every required variable, not just
  `DATABASE_URL`. See `deployment.md`, "Local development", for what the
  production image must contain.
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

- `pnpm db:up` starts `compose.dev.yml` (Postgres 17 on `127.0.0.1:5432`, and
  the mail catcher) and waits until they are up. `pnpm db:down` stops them and
  keeps the data volume.
- `pnpm db:migrate` applies pending migrations to `DATABASE_URL`.
- `pnpm test:integration` never touches the dev database. Its global setup
  connects with `TEST_DATABASE_ADMIN_URL` (a role that can create databases;
  when unset it falls back to
  `postgres://effluz:effluz@127.0.0.1:5432/postgres`), creates a throwaway
  database named `effluz_test_<8 hex digits>`, runs every migration into it,
  and drops it when the run ends. CI sets the same variable against its
  Postgres service; see `ci-cd.md`.
