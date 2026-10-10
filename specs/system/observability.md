# Observability

Owns: logging, error tracking, health, uptime, alerting. Sized for one VPS
and a small team: enough to know when something is wrong and why, nothing
more.

## Logging

- Structured JSON to stdout. Docker's log driver rotates files; nothing is
  shipped off the server in the first release.
- Every log line carries `time` (epoch milliseconds), `level` (the label),
  `service` (`app` or `worker`), `version` (`APP_VERSION`) and `msg`; a
  caller field with one of those five names is dropped, so it cannot override
  them. Lines about a job also carry `jobId`, `jobType` and `attempt`. There
  is no request id yet. Submission ids are allowed; emails, names, story text,
  filenames and file contents are not.
- A single logging helper, the pino adapter behind the `Logger` port in
  `src/shared/infrastructure/logging/`, is the only way to log. It redacts the
  field names in `REDACTED_FIELDS` (email, name, answers, text, body, story,
  file names, passwords, tokens, secrets, authorization and cookie headers) at
  the top level and up to three object levels down, array positions counting
  as levels. That is a backstop: it matches key names only, never values or
  message text, so callers must not pass personal data at all. See
  `decisions/0019-logging.md`.
- Levels: `error` means a human should look, `warn` means a retry or
  degradation happened, `info` is lifecycle, `debug` is off in production.

## Error tracking

Sentry is proposed. Requirements for whichever tool is chosen:

- Captures unhandled errors from `app` and `worker` with release tagged by
  commit SHA.
- Scrubs request bodies, cookies and headers by default. Breadcrumbs may
  carry ids only.
- Alerts on: any new error type, and any `dead` job.

## Health and uptime

- `GET /health` as defined in `system/deployment.md`.
- An external uptime monitor checks it every minute from outside the VPS and
  alerts the team channel after two consecutive failures. This is the only
  thing that catches the whole server being down.

## Metrics

No metrics system in the first release. The handful of numbers that matter
are exposed on the health endpoint and in the admin page: submissions per
form per day, pending and dead jobs, oldest pending job age, staging
directory size, last successful backup time. Add a metrics stack only when a
question cannot be answered from those.

## Alert destinations

One team channel for everything. Alerts are few by design; if they become
noisy, fix the cause rather than route them elsewhere.
