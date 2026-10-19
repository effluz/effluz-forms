# 0029. Dead-job alerts

Status: accepted
Date: 2026-10-18

## Context

A job that gives up (a photo that never reaches Dropbox, an email that fails)
must reach the owner. The job store lives in `shared`, which imports no
module, yet the alert needs story references and an email. An alert enqueued
after the dead write could be lost between the two.

## Decision

- The job store enqueues `email.job_alert` inside the dead transition, in
  `fail` and `markDead`. The alert job's own type (`email.job_alert`) and its
  `maxAttempts` are injected by the worker's composition root, so `shared`
  stays module-agnostic.
- Alerts are grouped by an hourly unique key,
  `email.job_alert:<type>:<YYYY-MM-DDTHH>` (the hour in UTC), with the rules in
  `system/jobs.md`. A dead `email.job_alert` raises nothing.
- `notifications` handles the job through an `AlertSource` port that `review`
  implements, which returns the count and the story references. New module
  edge: `review -> notifications`.
- One address, `ALERT_EMAIL`, required in production.

## Consequences

- An alert can never be lost between the dead write and its enqueue: both
  commit or neither does.
- An email outage may delay alerts about itself. The owner accepted this;
  Operations and `/health` still show dead jobs.
- A second address means a list setting later.
- The alert carries a type, counts and references, never content.
