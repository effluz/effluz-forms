# 0017. Postgres access with node-postgres and plain SQL migrations

Status: accepted
Date: 2026-10-10
Amended 2026-10-10: the runner discovers module migration folders; ids form one
global sequence.

## Context

This is the first persistence in the codebase. Modules own their tables and
reach them through ports, so the data-access layer must stay behind
`infrastructure/`. Drizzle and Prisma were considered. The team chose to
write SQL by hand with `pg` (node-postgres) and to keep migrations as plain
SQL files, so the schema is explicit, reviewable and free of generated code.

## Decision

- A single `pg` pool is created in the composition root (`src/app/`).
  Adapters never create connections; they receive a transaction client from
  the unit of work.
- Migrations are numbered `.sql` files owned by the module that owns the
  table. They are discovered in the shared folder and in each module's
  `infrastructure/migrations/` folder, applied in id order and recorded in a
  `schema_migration` table.
- Integration tests run against one throwaway database per run, created and
  dropped through `TEST_DATABASE_ADMIN_URL`, never a shared database.

## Consequences

- SQL is explicit and reviewable in the PR that introduces it. There is no
  codegen step and no query builder to learn.
- Adding a table means a migration file plus a repository adapter that maps
  rows to domain types by hand.
- Schema renames and column drops need expand and contract across releases,
  because there is no tool to automate zero-downtime changes.
- Migration ids form one global sequence across the shared and module
  folders, and the order is the id order. The runner refuses duplicate ids, so
  a new migration takes the next free number whichever module owns it.
