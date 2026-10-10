# 0020. Audit log retention through a privileged retention job

Status: accepted
Date: 2026-10-10

## Context

`audit_log` is append-only: the row trigger `audit_log_no_update` rejects
every `UPDATE` and `DELETE` (ADR 0018, `specs/system/security.md`). The same
spec keeps audit rows for one year. The two rules conflict once the first rows
turn a year old. Options were: a retention job that runs under a dedicated
database role for which the trigger makes an exception; monthly partitions
dropped whole; or dropping the one-year limit and keeping the log forever.

## Decision

A dedicated retention job, built with the retention capability, deletes audit
rows older than one year. It connects as its own database role. The trigger
function is amended, by a migration shipped with that job, to allow `DELETE`
only when `current_user` is that role; `UPDATE` stays rejected for everyone.
The application's ordinary role never gains delete rights on `audit_log`, and
no application code path other than the retention job may delete audit rows.
Until that job exists nothing is deleted, and the spec says so.

## Consequences

- The append-only guarantee holds for every request the application serves;
  only the retention job, with its own credentials, can shorten the log.
- The deployment plan must provision the extra role and keep its credentials
  out of the application container.
- Partitioning stays available later if the table grows beyond what a nightly
  `DELETE` handles; it would replace the delete, not the role boundary.
- The one-year figure stays a spec value in `security.md`; changing it is a
  spec edit, not an ADR.
