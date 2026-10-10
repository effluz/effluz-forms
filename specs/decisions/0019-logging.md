# 0019. Structured logging with pino behind a Logger port

Status: accepted
Date: 2026-10-10

## Context

`specs/system/observability.md` requires structured JSON logs to stdout,
a single logging helper, and defensive redaction of personal-data fields.
Modules must log without importing a logging library, and the same port
must serve the web app and the worker.

## Decision

- `Logger` is a small port in `src/shared/application/ports/logger.ts`:
  four level methods and `child`. It exposes no library types.
- The adapter in `src/shared/infrastructure/logging/logger.ts` uses pino.
  pino was chosen for low overhead and built-in `redact` support.
- The adapter redacts the field names in `REDACTED_FIELDS` at the top level
  and up to three object levels down. This is a backstop. Callers must not
  pass personal data to the logger in the first place.
- Output is one JSON line per event with `time`, `level` (a label, not a
  number), `service`, `version` and `msg`.
- `pino-pretty` is a dev dependency. Use it only for local reading, for
  example `pnpm dev | pnpm exec pino-pretty`. It is never in production.
- `Clock` and `IdGenerator` are ports with system adapters in the same
  folder. Tests inject fixed implementations.

## Consequences

- Modules depend on the port only, so the logging library can be replaced
  without touching them.
- Redaction matches by key name. A personal-data value under an unlisted
  key, or nested deeper than three levels, is not redacted. Reviews must
  keep log calls free of answers, contact details and file names.
- Adding a sensitive field name means adding it to `REDACTED_FIELDS` and
  the test that covers it.
