# 0025. Submission reference counter and email delivery receipts

Status: accepted
Date: 2026-10-11

## Context

References are `<prefix>-<nnnn>` per form (`form-definition.md`), must be
consecutive, and must never be taken by an intake that rolls back. Email
jobs may run twice, and a provider message must not go out twice.

## Decision

- `form.next_reference` (integer, starts at 1), owned by `definitions` and
  advanced only by its use case `allocateReference` inside the intake's unit
  of work, under the `form` row lock taken after the in-progress row lock.
  The same locked read decides again that the form is open. Taking a number
  does not touch `form.updated_at`.
- `email_delivery`, owned by `notifications`: one row per sent message,
  unique `delivery_key` = `<job type>:<submission id>`, holding the provider
  message id. A job records it before succeeding; a run that finds it sends
  nothing.

## Consequences

- A rolled-back intake gives its number back; references have no gaps
  except for deleted submissions.
- `submissions` never writes a `definitions` table.
- Delivery rows are not personal data; they go with the submission when
  `retention.purge` exists.
