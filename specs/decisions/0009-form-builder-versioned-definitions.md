# 0009. Forms are staff-authored, versioned data; code is organized by capability

Status: accepted
Date: 2026-10-09
Amended 2026-10-10: the form model moved to the shared kernel, ADR 0022

## Context

The first design treated each form as a code module with its own folder,
specs and developer effort. Effluz needs new forms for events and processes
often, and wants staff to create and manage them without a developer.
Options were: forms as declarative files in the repository, a staff-facing
builder storing definitions in the database, or a hybrid.

## Decision

Build a form builder and manager. Form definitions are authored by staff in
the admin area and stored in PostgreSQL. Publishing creates an immutable
version; every submission pins the version it answered. There is no
form-specific code; a form that needs something new gets a new reusable
capability. Code is organized as modules by capability, each with the four
Clean Architecture layers, with dependencies forming a DAG defined in
`architecture.md`. The form model in `form-definition.md` is the contract
all modules consume.

## Consequences

- Staff publish forms without deploys. Developers ship field types, rules,
  operators and surfaces.
- More up-front work than hand-coding the first form: builder, renderer,
  versioning and the conformance suite exist before any form is live.
- Submissions are stored as documents keyed by field key, not as per-form
  tables. Export and review interpret them through the pinned version.
- Staff-authored text reaches the public, so it is untrusted input and is
  escaped everywhere.
- Every field type must be implemented across all consumers at once, which
  the conformance suite enforces.
- Supersedes the folder-per-form layout and the per-form use-case and UI/UX
  specs. Specs now exist per capability and per surface.
