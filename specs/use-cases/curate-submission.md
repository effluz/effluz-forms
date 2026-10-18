# Use case: Curate a submission

Module: `review`. Surface: manager. Model: `form-definition.md`, section
Submissions. Decision record: `decisions/0011-submission-curation-deepl-write.md`.

Curation is everything staff do to a submission after it arrives: track its
status toward publication and correct the spelling and grammar of text
answers for publishing. The submitter's original is never changed.

## Actors

- **Curator**: a signed-in staff member.

DeepL Write suggestions are deferred (design, 2026-10-18): the first review
release ships manual correction only. The `TextCorrector` port stays specified
in `architecture.md` for later and nothing calls it yet.

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
returns to `edited` if any edits exist, otherwise `viewed`; see "Main flow:
change status".

## Main flow: edit a text answer

1. The curator opens a submission and chooses "Edit" on a `short_text` or
   `long_text` answer. Other types have no edit action.
2. The answer opens in a two-column editor: **Original** on the left, read
   only, and **Curated** on the right, prefilled with the current curated
   text or the original if none exists.
3. The curator edits by hand. Deferred: "Suggest correction". The suggestion
   would fill the Curated column in suggested style with Accept, Edit,
   Dismiss, and the differences from the original highlighted word by word.
   The instruction sent with the text is fixed: correct spelling, grammar and
   punctuation only, keep the author's words, tone and dialect, do not
   shorten or add. Language is the submission's locale.
4. Save stores the curated text as a new `submission_edit` row (field key,
   text, editor, time, source `manual` or `suggested`) and updates the
   submission's current curated answers. Status becomes `edited` if it was
   not `published`. A saved correction also sets the "Text checked" readiness
   check. Audit entry `submission_edited`.
5. The detail view shows the curated text with an "Edited" tag and a
   "Compare" action that opens the two columns with highlights. "Revert to
   original" removes the curated version for that field; if no curated
   fields remain and the status is `edited`, it returns to `viewed`.

## Readiness

On forms with the post-plan setting on (`manage-form-settings.md`) a story has
three checks. They are worked out when read, never stored as a "ready" flag.

- **Photos chosen**: at least one photo, the sender's or a staff photo, is
  chosen for the post.
- **Photos edited in Canva**: a tick that records the chosen set at that
  moment. It reads as done only while the chosen set is the same, so choosing,
  unchoosing or removing a chosen photo clears it. It cannot be ticked with no
  photo chosen.
- **Text checked**: set by a saved correction or ticked by hand. Reverting does
  not clear it.

Ready means all three. Audit entries `photo_choice_changed` (media id, chosen)
and `story_check_changed` (check, value, `by` = `hand` or `correction`).

## Planning

A planned date is a field of the story, not a status.

- One unpublished story per day across every post-plan form.
- Planning on a taken day asks to swap the two dates (only when this story has
  a date) or to move the other story to "Waiting for a date".
- A published story cannot be re-planned.
- Audit entry `story_planned` (from, to, `resolution` when given), one entry
  per story whose date changed.

## Main flow: change status

1. "Mark as published" opens a small dialog with an optional post URL.
2. Mark as published works from any status. It stores the optional `https`
   link (marking again replaces it) and records the day the story went out:
   its planned date, or today in `America/Panama` when it had none. That day
   does not take or block a slot.
3. Confirm stores status, link, actor and time. Audit entry
   `submission_status_changed` carrying `from`, `to` and `link` (a boolean).
4. "Unmark published" returns the story to `edited` or `viewed` as before. It
   keeps the planned date when the day is still free; otherwise, or when the
   story had no planned date, it moves the story to "Waiting for a date".

## Alternate flows and errors

- **Correction service unavailable.** Deferred with suggestions. The button
  would report it; manual editing continues.
- **Suggestion identical to the original.** Deferred with suggestions. Would
  be shown as "No changes suggested".
- **Two curators edit the same field.** Last save wins; both edits remain in
  history. There is no conflict message; one person uses the tool.
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
`submission_status_changed` (from, to, link), `photo_choice_changed`,
`story_check_changed`, `story_planned`. `correction_suggested` (field key) is
not written yet: it comes with suggestions.

## Success criteria

- After any number of edits and reverts, the original is byte-identical to
  what was received, verified by a property-based test.
- Deferred with suggestions: a suggestion never changes a word that was
  spelled correctly, verified with a fixture of correct Spanish and English
  texts that must come back unchanged.
- The compare view makes every changed word findable by keyboard.
