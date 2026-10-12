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
| `enqueue(uow, type, payload, { runAt?, uniqueKey?, maxAttempts? })` | Insert a job inside the given unit of work and return its id. `runAt` defaults to now and `maxAttempts` to 8. `uniqueKey` prevents duplicates while a job with the same key is pending or running: the insert is skipped and `null` is returned. |

A payload is a flat object whose values are strings, numbers, booleans or
null.

Handlers are registered by `type` in the worker's composition root
(`src/app/worker.ts`). Each handler is a small application-layer function
that receives the payload and a context with the job id, the attempt number, the
job's `maxAttempts`, a logger already tagged with the job, and the unit of work,
queue and clock ports. Registered today: `jobs.cleanup`, `identity.cleanup`,
`media.upload`, `media.delete`, `email.submitter_confirmation` and
`email.staff_notification`.

## The `job` table

Migration `0001_job.sql`, owned by `shared`.

| Column | Purpose |
|---|---|
| `id` (uuid), `type`, `payload` (jsonb, default `{}`) | Identity and work |
| `status` | A check constraint allows `pending`, `running`, `succeeded`, `failed` (waiting for a retry), `dead` and `discarded` |
| `attempts`, `max_attempts` | `attempts` starts at 0 and counts runs started; `max_attempts` defaults to 8 |
| `run_at` | Earliest execution time, used for backoff and scheduling; defaults to now |
| `locked_at`, `locked_by` | Worker claim; the claim expires after the lease |
| `unique_key` | Partial unique index `job_unique_key_idx` where status in (`pending`, `running`) |
| `last_error` | Message with email-like tokens replaced by `[redacted]`, cut to 500 characters |
| `discard_reason` | Reason an operator gave when discarding. Nothing sets `discarded` yet; the operator action is specified in `use-cases/operate-jobs.md` |
| `created_at`, `updated_at`, `finished_at` | Lifecycle; `finished_at` is set on `succeeded` and `dead` |

`job_claim_idx` on (`status`, `run_at`) for `pending` and `failed` rows serves
the claim query.

Payloads hold identifiers, never personal data. An email job carries the
submission id and looks the address up at run time, so deleting a submission
also makes its unsent jobs no-ops.

## Worker behavior

**Poll cycle.** Each poll, in order: enqueue any recurring job that is due,
claim up to `WORKER_CONCURRENCY` jobs, run them in parallel, then write the
heartbeat. The next poll follows after `WORKER_POLL_INTERVAL_MS`, or at once
when the claim filled every slot. A poll that fails on a database error is
logged (message only, scrubbed) and retried at the next interval; handler
failures never escape the poll.

**Claiming.** One `UPDATE` selects due rows with `FOR UPDATE SKIP LOCKED`, in
`run_at` order, so two workers never take the same row. Due means `pending`
or `failed` with `run_at` in the past, or `running` with a `locked_at` older
than the lease. The same statement increments `attempts` and stamps
`locked_at` and `locked_by`, so a claimed job's `attempts` counts the run
that is starting.

**Lease and timeout.**

| Setting | Variable | Default | Bounds |
|---|---|---|---|
| Parallel jobs per worker | `WORKER_CONCURRENCY` | 4 | 1 to 32 |
| Poll interval | `WORKER_POLL_INTERVAL_MS` | 1000 | at least 100 |
| Lease | `WORKER_LEASE_SECONDS` | 90 | at least 30 |

The per-job timeout is the lease minus 15 seconds (75 seconds by default).
The worker refuses to start if the timeout plus a 10 second margin does not
fit inside the lease. A job that times out is recorded as a failure and the
worker stops waiting for it, but nothing cancels the handler, so it may still
be running when the retry starts. That is one more reason handlers are
idempotent. A crashed worker's jobs are reclaimed once the lease expires.

**Outcomes are fenced on the claim.** Success, retry and dead each update the
row only while it is still `running`, locked by this worker, at the attempt
number the claim returned. When another worker has reclaimed the job in the
meantime, the update changes nothing and the outcome is reported as lost
(a `lease lost` warning in the log).

**Failure and retry.** A failed run sets the job to `failed` with `run_at` at
`2^attempt` seconds from now plus up to 25% random jitter, capped at one
hour. Once `attempts` reaches `max_attempts` the job becomes `dead` instead.
A job reclaimed after its lease expired on the final attempt becomes `dead`
without running again. A job whose `type` has no registered handler fails like
any other. A dead job is logged at `error` level and counted in the health
endpoint's `deadJobs`. Listing dead jobs with a retry action is part of
`use-cases/operate-jobs.md`; the error-tracker event arrives with the tracker
(`observability.md`).

A handler that throws `PermanentJobError` (from
`src/shared/application/ports/job-queue.ts`) makes the job `dead` at once with
its message, for failures a retry cannot fix, such as an email address the
provider rejects.

**Heartbeat.** Every completed poll upserts one row in `worker_heartbeat`:

| Column | Purpose |
|---|---|
| `id` (uuid), `worker_id` (text, unique) | One row per worker process |
| `last_seen_at` | Time of the last completed poll |
| `created_at`, `updated_at` | Lifecycle |

The worker id is `<hostname>-<pid>`, so a restarted container gets a new row.
The health endpoint reads the newest `last_seen_at` across all rows; a
missing or stale heartbeat degrades `/health` (`deployment.md`). A poll that
fails does not write a heartbeat.

**Shutdown.** On `SIGTERM` or `SIGINT` the worker stops polling, waits for the
poll in progress including its handlers, closes its pool and exits 0. The
Compose `stop_grace_period` for `worker` must therefore exceed the job
timeout, or Docker kills a job mid-run and the lease has to expire first.

**Concurrency.** Starts at one worker process with `WORKER_CONCURRENCY`
parallel jobs. Scaling means raising that number, then adding a second
`worker` container; claiming and fencing already allow it.

## Handler rules

- **Idempotent.** A handler may run twice. Uploads `put` by key, which
  overwrites, and record the reference before deleting the staging copy; emails
  record the provider message id in the `email_delivery` table, not on the job,
  and skip a key already recorded.
- **Small.** One external effect per job. Fan out by enqueuing more jobs.
- **Tested in isolation** with fake ports. Worker plumbing is tested once in
  `src/shared/`.

## Recurring jobs

Defined in code in the worker's composition root as a type and a period,
`daily` or `hourly`. At the start of every poll the scheduler computes the
current UTC bucket (`YYYY-MM-DD`, or `YYYY-MM-DDTHH` for hourly) and the
unique key `<type>:<bucket>`. If no job with that key exists in any status, it
enqueues one; the check is skipped while the key is unchanged, so a restart
within the same bucket never doubles a job. The unique index only guards
`pending` and `running` rows, which is why the scheduler looks up every status.
Two workers racing at a bucket boundary could enqueue twice; that is accepted
because handlers are idempotent.

Initial set: `retention.purge` daily, `email.staff_digest` daily per form,
`backup.database` nightly, `jobs.cleanup` daily, `identity.cleanup` daily. Only
the last two are scheduled today. `jobs.cleanup` deletes succeeded jobs finished
more than 30 days ago and logs the count; it also removes in-progress submission
records past their 24 hours, their staged files first, through cleanup steps the
worker's composition root passes in, so `shared` never imports `submissions`.
`identity.cleanup` deletes sign-in attempts past their expiry and admin sessions
past the idle or absolute limit, writes no audit entries, and logs the two
counts.

## Job types in the first release

| Type | Trigger | Effect |
|---|---|---|
| `media.upload` | Submission stored | Staging to durable storage, media row to `stored` with its reference, staging copy deleted; the row becomes `failed` and staging is kept when the job is on its last attempt, or at once when the staging copy is missing (a permanent failure) |
| `media.delete` | Retention purge or admin delete | Remove the durable file, the staging copy and the media row, in that order |
| `email.submitter_confirmation` | Submission stored, version defines one | Confirmation in the submitter's locale |
| `email.staff_notification` | Submission stored, form cadence is per submission | Link to the manager, no content |
| `email.staff_digest` | Daily schedule per form with daily cadence | List of new references with links, skipped when empty |
| `retention.purge` | Daily schedule | Delete submissions past their form's retention setting |
| `backup.database` | Nightly schedule | Encrypted dump to Dropbox backup folder |
| `jobs.cleanup` | Daily schedule | Prune old succeeded jobs, expired in-progress records and their staged files |
| `identity.cleanup` | Daily schedule | Delete expired sign-in attempts and expired admin sessions, no audit entries |

Every `media.*` and `email.*` job is enqueued with `max_attempts` 36 instead of
the default 8. With the backoff above (2^attempt seconds, capped at one hour),
the waits reach the cap from the twelfth attempt, and 36 attempts keep retrying
for about a day, so an outage of Dropbox or the email provider that lasts most
of a day does not leave dead jobs that nothing re-runs.

Payloads: `media.*` carry `{ mediaId }`, `email.*` carry `{ submissionId }`.
