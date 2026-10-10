# Observability

Owns: logging, error tracking, health, uptime, alerting. Sized for one VPS
and a small team: enough to know when something is wrong and why, nothing
more.

## Logging

- Structured JSON to stdout. Docker's log driver rotates files; nothing is
  shipped off the server in the first release.
- Every log line carries: timestamp, level, service (`app` or `worker`),
  request or job id, and a message. Submission ids are allowed; emails,
  names, story text, filenames and file contents are not.
- A single logging helper in `src/shared/infrastructure/` is the only way to
  log. It redacts known PII field names defensively.
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
