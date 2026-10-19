# 0011. Submissions keep an immutable original; curated text and DeepL Write corrections live beside it

Status: accepted
Date: 2026-10-09
Amended 2026-10-18: the review module ships manual correction only; DeepL Write suggestions are deferred and nothing calls the `TextCorrector` port yet (design 2026-10-18-review-module-design.md).

## Context

Effluz publishes submitted stories on social media after fixing spelling
and grammar. Staff asked to do that in the manager, by hand and with an AI
suggestion, and to always be able to compare with what the family wrote.
They also want a status per submission toward publication. Options for the
correction service were DeepL Write, the Claude API, or manual only.

## Decision

The received `answers` document is immutable. Curation adds a separate
current `curated_answers` document, an append-only `submission_edit`
history, and a `status` of `new`, `viewed`, `edited` or `published`. Only
`short_text` and `long_text` answers may be curated.

Corrections are suggested through a `TextCorrector` port with a DeepL Write
adapter, available to the `review` module only. One answer's text per
request, with a fixed instruction to correct spelling, grammar and
punctuation and change nothing else. Suggestions apply only on accept.

## Consequences

- Submission text leaves the system for a third party. The consent
  checklist gains an item naming automated correction, and the privacy
  footer's statement stays accurate because storage does not change.
- Export and review carry both versions; publication copy comes from the
  curated one.
- Two external capabilities now sit with DeepL. A provider swap is two
  adapters.
- The `review` module gains write paths to curation tables, never to
  `answers`, enforced by a database trigger on the `answers` column.
