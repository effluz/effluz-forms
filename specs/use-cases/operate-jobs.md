# Use case: Operate background jobs

Module: `review`. Surface: manager. System spec: `system/jobs.md`.

## Actors

- **Operator**: a signed-in staff member, in practice whoever got the alert.

## Trigger

A dead-job alert, the dead-jobs badge in the manager, or routine checking.

## Main flow

The page is **Operations** (`/admin/operations`). This first pass has:

1. The worker heartbeat age, with OK, Warning or Critical in words, and the
   stale-worker banner.
2. One table of `dead` jobs: type, story reference (linked to the story when
   the payload resolves to one), attempts, last error (already scrubbed),
   first attempt and last attempt.
3. **Retry** resets the job to `pending` with attempts zero and `run_at` now,
   and clears the job's unique key. Audit entry `job_retried`.
4. **Discard** marks it `discarded` with a required reason of 1 to 200
   characters. Audit entry `job_discarded`. Discarding a `media.upload` leaves
   the media row `failed` and the staging file in place; the story page shows
   the photo from staging with a warning.
5. "Retry all {type} jobs ({count})" appears when more than one dead job
   shares a type.

Later: failed jobs awaiting retry, the payload view, pending counts, the last
successful backup time and the staging size.

## Alerts

Every job that goes dead, system jobs included, raises an alert email to
`ALERT_EMAIL`.

- Alerts are grouped: at most one per job type per clock hour (UTC).
- The email lists how many jobs of that type are dead when it is sent and the
  story references among them (at most 20, then "and {n} more"), with a link
  to Operations. It never carries content.
- An alert that finds no job of its type dead when it runs (all retried or
  discarded meanwhile) is skipped: no email is sent.
- An alert job that goes dead raises none.
- When email itself is failing the alert may fail too. Operations and
  `/health` still show it.

## Alternate flows and errors

- **Worker heartbeat stale.** A banner tells the operator the worker is down
  and points at the runbook. Retrying jobs is still allowed and takes effect
  when it returns.
- **Retrying a job whose submission was deleted.** The handler finds no
  submission and succeeds as a no-op by design.
- **Many dead jobs of one type at once** (provider outage). A "retry all of
  type" action, with one audit entry carrying the count.

## Rules

- Operators see identifiers and errors, never answers or addresses.
- Retry is always safe because handlers are idempotent.
- `succeeded` jobs are not listed; they are pruned by `jobs.cleanup`.

## Audit entries

`job_retried`, `job_discarded`, `jobs_retried_bulk`.

## Success criteria

- A revoked Dropbox token produces dead `media.upload` jobs within the retry
  window, an alert, and a visible banner; after the token is rotated, "retry
  all" drains them without duplicate uploads.
