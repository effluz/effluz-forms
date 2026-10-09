# 0001. PostgreSQL in a container on the VPS

Status: accepted
Date: 2026-10-08

## Context

Form data needs a transactional store that also hosts the jobs outbox.
Traffic is low and the first deployment is a single VPS. Supabase is a
plausible future host. SQLite was the lightest alternative.

## Decision

Run PostgreSQL in a container in the Compose stack, pinned to a specific
major version, data on a host-mounted volume, not exposed outside the Docker
network.

## Consequences

- Supabase is PostgreSQL, so a later move is a connection string and a data
  copy. No migration dialect change.
- Row-level locking (`SKIP LOCKED`) makes the outbox worker simple and safe.
- One more process to run and back up compared with SQLite. Backups are
  therefore specified from day one in `system/database.md`.
- Supabase-only features (its auth, RLS policies, storage) are not used, so
  the app stays portable.
