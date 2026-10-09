# Jobs and the Outbox

Owns: the `JobQueue` port, the `job` table, the worker process.
Decision record: `decisions/0003-db-backed-outbox.md`.

## Role

Anything that touches an external system after a user action runs as a job:
media uploads, emails, retention purges, backup uploads. Jobs are rows in
Postgres, written in the same transaction as the state change that caused
them, and executed by the `worker` container. There is no broker.

## The `JobQueue` port

| Operation | Behavior |
|---|---|
| `enqueue(type, payload, { runAt?, uniqueKey?, maxAttempts? })` | Insert a job inside the current unit of work. `uniqueKey` prevents duplicates while a job with the same key is pending or running. |

Handlers are registered by `type` in the worker's composition root. Each
handler is a small application-layer function that receives the payload and
the shared ports.

## The `job` table

| Column | Purpose |
|---|---|
| `id`, `type`, `payload` (jsonb) | Identity and work |
| `status` | `pending`, `running`, `succeeded`, `failed`, `dead`, `discarded` (by an operator, with a reason) |
| `attempts`, `max_attempts` | Default 8 attempts |
| `run_at` | Earliest execution time, used for backoff and scheduling |
| `locked_at`, `locked_by` | Worker claim, expires after a lease period |
| `unique_key` | Partial unique index where status in (`pending`, `running`) |
| `last_error` | Truncated, PII-scrubbed message |
| `created_at`, `updated_at`, `finished_at` | Lifecycle |

Payloads hold identifiers, never personal data. An email job carries the
submission id and looks the address up at run time, so deleting a submission
also makes its unsent jobs no-ops.

## Worker behavior

- Polls with `SELECT ... FOR UPDATE SKIP LOCKED`, claims a small batch, runs
  handlers with a per-job timeout, commits the outcome.
- Failure schedules a retry at exponential backoff with jitter, capped at one
  hour. After `max_attempts` the job becomes `dead`.
- A dead job raises an error-tracker event and increments the `dead_jobs`
  health metric. Dead jobs are listed in the admin page with a retry action.
- Leases expire, so a worker that crashes mid-job releases it automatically.
- The worker writes a heartbeat row every poll. A stale heartbeat is a health
  check failure.
- Concurrency starts at one worker process with a handful of parallel jobs.
  Scaling means raising that number, then adding a second `worker` container.

## Handler rules

- **Idempotent.** A handler may run twice. Uploads check `exists` first,
  emails record the provider message id before sending is considered done.
- **Small.** One external effect per job. Fan out by enqueuing more jobs.
- **Tested in isolation** with fake ports. Worker plumbing is tested once in
  `src/shared/`.

## Recurring jobs

Defined in code with a schedule. The worker's scheduler loop enqueues them with
a `uniqueKey` of `<type>:<period>` so a restart never doubles them. Initial
set: `retention.purge` daily, `backup.database` nightly, `jobs.cleanup`
daily (removes succeeded jobs older than 30 days, expired in-progress
submission records older than 24 hours, and their staged files).

## Job types in the first release

| Type | Trigger | Effect |
|---|---|---|
| `media.upload` | Submission stored | Staging to Dropbox, media row to `stored` |
| `media.delete` | Retention purge or admin delete | Remove from Dropbox and staging |
| `email.submitter_confirmation` | Submission stored, version defines one | Confirmation in the submitter's locale |
| `email.staff_notification` | Submission stored | Link to the manager, no content |
| `retention.purge` | Daily schedule | Delete submissions past their form's retention setting |
| `backup.database` | Nightly schedule | Encrypted dump to Dropbox backup folder |
| `jobs.cleanup` | Daily schedule | Prune old succeeded jobs, expired in-progress records and their staged files |
