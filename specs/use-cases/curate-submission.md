# Use case: Curate a submission

Module: `review`. Surface: manager. Model: `form-definition.md`, section
Submissions. Decision record: `decisions/0011-submission-curation-deepl-write.md`.

Curation is everything staff do to a submission after it arrives: track its
status toward publication and correct the spelling and grammar of text
answers for publishing. The submitter's original is never changed.

## Actors

- **Curator**: a signed-in staff member.
- **Correction service**: DeepL Write, behind the `TextCorrector` port.

## Statuses

| Status | Set by | Meaning |
|---|---|---|
| `new` | System on receipt | Nobody has opened it |
| `viewed` | System, on the first time a curator opens the detail | Seen, untouched |
| `edited` | System, on the first saved edit | At least one text answer has a curated version |
| `published` | Curator, manually | Used in a campaign; optional link to the post |

Rules: `new` becomes `viewed` automatically and never returns. An edit on a
`viewed` or `new` submission makes it `edited`. "Mark as published" works
from any status and stores an optional `https` post URL. "Unmark published"
returns to `edited` if any edits exist, otherwise `viewed`.

## Main flow: edit a text answer

1. The curator opens a submission and chooses "Edit" on a `short_text` or
   `long_text` answer. Other types have no edit action.
2. The answer opens in a two-column editor: **Original** on the left, read
   only, and **Curated** on the right, prefilled with the current curated
   text or the original if none exists.
3. The curator edits by hand, or clicks "Suggest correction". The suggestion
   fills the Curated column in suggested style with Accept, Edit, Dismiss,
   and the differences from the original are highlighted word by word. The
   instruction sent with the text is fixed: correct spelling, grammar and
   punctuation only, keep the author's words, tone and dialect, do not
   shorten or add. Language is the submission's locale.
4. Save stores the curated text as a new `submission_edit` row (field key,
   text, editor, time, source `manual` or `suggested`) and updates the
   submission's current curated answers. Status becomes `edited` if it was
   not `published`. Audit entry `submission_edited`.
5. The detail view shows the curated text with an "Edited" tag and a
   "Compare" action that opens the two columns with highlights. "Revert to
   original" removes the curated version for that field; if no curated
   fields remain and the status is `edited`, it returns to `viewed`.

## Main flow: change status

1. "Mark as published" opens a small dialog with an optional post URL.
2. Confirm stores status, URL, actor and time. Audit entry
   `submission_status_changed`.

## Alternate flows and errors

- **Correction service unavailable.** The button reports it; manual editing
  continues.
- **Suggestion identical to the original.** Shown as "No changes suggested".
- **Two curators edit the same field.** Last save wins; both edits remain in
  history; the loser is told whose version is current.
- **Submission deleted or purged.** Edits, history and status go with it.

## Rules

- `answers` on the submission is immutable from the moment of receipt. All
  curation lives in separate columns and tables.
- Only text answers are editable. The curated text obeys the same length
  limit as the field.
- Export offers original, curated, or both columns; review shows both.
- Each suggestion request sends exactly one answer's text and the fixed
  instruction. Never the whole submission, never the submitter's name or
  address as a separate field. Requests are not cached across submissions.
- The consent text covers automated correction, item 9 of the checklist.
- Notes and comments on submissions are not in the first release.

## Audit entries

`submission_edited` (field key, source), `submission_reverted`,
`correction_suggested` (field key), `submission_status_changed` (from, to).

## Success criteria

- After any number of edits and reverts, the original is byte-identical to
  what was received, verified by a property-based test.
- A suggestion never changes a word that was spelled correctly, verified
  with a fixture of correct Spanish and English texts that must come back
  unchanged.
- The compare view makes every changed word findable by keyboard.
