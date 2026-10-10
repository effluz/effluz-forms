# Use case: Operate background jobs

Module: `review`. Surface: manager. System spec: `system/jobs.md`.

## Actors

- **Operator**: a signed-in staff member, in practice whoever got the alert.

## Trigger

A dead-job alert, the dead-jobs badge in the manager, or routine checking.

## Main flow

1. The Jobs page lists jobs with status `dead` and, collapsed, recent
   `failed` ones awaiting retry: type, form, submission reference, attempts,
   last error (already scrubbed), first and last attempt times.
2. The operator opens one to see its payload (identifiers only) and the
   full attempt history.
3. **Retry** resets the job to `pending` with attempts zero and `run_at`
   now. Audit entry `job_retried`.
4. **Discard** marks it `discarded` with a required reason. Audit entry
   `job_discarded`. Discarding a `media.upload` leaves the media row
   `failed` and the staging file in place; the submission view shows the
   photo from staging with a warning.
5. The page also shows worker health: heartbeat age, pending count, oldest
   pending age, last successful backup time.

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
