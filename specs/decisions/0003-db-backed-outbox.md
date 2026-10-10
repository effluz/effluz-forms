# 0003. Database-backed outbox and worker, no message broker

Status: accepted
Date: 2026-10-08

## Context

Uploads, emails, purges and backups must not run inside the request and must
not be lost if a provider is down. Options were a broker (Redis-backed queue,
RabbitMQ), a hosted queue, or a jobs table in the application database.

## Decision

A `job` table in PostgreSQL, rows inserted in the same transaction as the
business change, polled by a `worker` container using `FOR UPDATE SKIP
LOCKED`, with retries, leases, unique keys and a dead state. Recurring jobs
are scheduled by the same worker.

## Consequences

- Exactly the guarantee we need: a committed submission always produces its
  jobs, and a job never exists without its submission.
- No additional infrastructure to run, secure, or back up.
- Throughput is bounded by polling and a single database. Far above what
  forms generate; a broker is the upgrade path if that ever changes, and the
  `JobQueue` port isolates the swap.
- Handlers must be idempotent. This is a rule in `system/jobs.md` and in
  code review.
