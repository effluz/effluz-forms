# 0026. Test-only exception to the module boundary

Status: accepted
Date: 2026-10-11

## Context

A module exposes one public entry point, and the boundaries lint enforces
it. Tests of one module need another module's in-memory fakes (submissions
tests drive media and definitions fakes), and some `src/` tests read shared
test data from `tests/fixtures/` and `tests/fakes/`.

## Decision

- Files matching `src/**/*.test.{ts,tsx}` or `src/**/testing/**` may import
  any module's `application/testing/*` and any file under `tests/fixtures/`
  or `tests/fakes/`.
- Tests also use their own module's `domain/testing/*` and the kernel's
  `src/shared/application/testing/*` and `src/shared/presentation/testing/*`.
  These need no exception: the layer rules already let a test reach its own
  module's domain and the shared layers its layer may use, and the
  restricted-imports rule below does not apply to test files.
- Production code keeps the single entry point: no other file may import a
  `testing` folder (`**/testing`, `**/testing/**`) or anything under
  `tests/` (`**/tests/**`), its own module's included.
- `eslint.config.mjs` encodes both rules; `tests/boundaries/` probes each
  allowance (`application/testing/*`, `tests/fixtures/`, `tests/fakes/`,
  `domain/testing/*`, `shared/presentation/testing/*`) and each refusal.

## Consequences

- Fakes are shared instead of copied, and drift with their ports in one
  place.
- A fake must never be needed by production code; the lint refuses it.
