# 0012. Toolchain: TypeScript strict, pnpm, Vitest, ESLint boundaries, Zod in the domain layer

Status: accepted
Date: 2026-10-10

## Context

ADR 0008 fixed Next.js and React. The language, package manager, test
runner, linter and the way layer rules are enforced were open. The form
model needs runtime validation whose types cannot drift from the schema.

## Decision

TypeScript with `strict`, `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`. pnpm with a committed lockfile and frozen
installs in CI. Vitest for unit and integration tests, Playwright for
end-to-end tests when they arrive. ESLint flat config with typescript-eslint
and eslint-plugin-boundaries encoding the layer rules of `CLAUDE.md` and
the module graph of `architecture.md`. Prettier for formatting.

Zod is permitted in `domain/` layers as the schema language. It is a
framework-free library with no I/O; the types it infers are the domain
types. No other third-party dependency is allowed in `domain/`.

## Consequences

- Layer violations fail in the editor and in CI, not in review.
- Domain types are derived from schemas; there is one definition per shape.
- Zod is a dependency of every module. Replacing it would touch every
  schema; accepted.

Versions at adoption: Next.js 16.4.0, React 19.3.0, TypeScript 5.9.3, pnpm 12.10.1, Node 24 (pinned in `.node-version`).
