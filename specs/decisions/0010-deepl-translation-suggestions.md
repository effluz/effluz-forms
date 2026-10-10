# 0010. Machine translation suggestions through DeepL

Status: accepted
Date: 2026-10-09

## Context

Every staff-authored text needs English and Spanish. Staff write mostly in
Spanish. Translating by hand is the main cost of the bilingual rule.
Options were DeepL, Google Cloud Translation, or an LLM such as the Claude
API. Only staff-authored form text would be sent; submission data never.

## Decision

A `Translator` port in `shared/` with a DeepL API adapter. Suggestions are
requested explicitly by an editor, shown as suggestions, and applied only
on Accept. Accepted suggestions carry a "machine translated, not reviewed"
tag until an editor marks them reviewed. Results are cached by source text,
source language and target language. The port is available to
`definitions` only.

## Consequences

- One more external account and API key, with the free tier sufficient for
  expected volume.
- Translation quality is reviewed by a human before publish is encouraged
  but not forced: unreviewed machine text is a suggestion, not an error.
- No submitter data reaches this port, enforced by module dependencies:
  `submissions` and `review` cannot use it. Submission text corrections
  use a separate port under ADR 0011.
- Switching provider is a new adapter.
