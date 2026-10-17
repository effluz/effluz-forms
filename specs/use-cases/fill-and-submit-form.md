# Use case: Fill in and submit a form

Module: `submissions`. Surface: renderer. Model: `form-definition.md`.
System specs: `media-storage.md`, `jobs.md`, `security.md`.

## Actors

- **Submitter**: a member of the public, often on a phone, often on a slow
  connection, possibly using assistive technology.

## Trigger

The submitter opens `/f/<slug>`, typically from a social media link or a QR
code.

## Main flow

1. The renderer loads the form's current version. If the form is bilingual
   it picks the browser language, falling back to Spanish, and offers a
   language switch that keeps entered answers.
2. Page one renders: title, description, fields, a progress indicator for
   multi-page forms, and a "Next" button. Required fields are marked and the
   marking is explained once.
3. The submitter fills fields. Validation feedback appears on blur and on
   Next, next to the field, in the current locale, and is announced.
4. On Next, answers are posted. The server evaluates visibility and
   validation rules against the version for all fields on the page. Errors
   redirect (303) to the same page at `?refused=<at>`, with the messages and
   focus on the error summary heading. Success stores the page's answers in a
   server-side in-progress record keyed by an opaque cookie and advances to the
   next visible page.
5. With script, file fields upload as soon as a file is chosen, with per-file
   progress and the ability to remove a file; without script the files travel
   with the page post. Type and size are checked on both sides: with script
   the browser pre-checks the size and the declared kind before uploading
   (cheap and advisory), and the server decides by content. Each accepted photo
   is re-encoded without metadata; a video is stored as sent once its container
   passes the check. The file is written to staging under a random key, linked
   to the in-progress record.
6. The last page shows "Submit" instead of Next. If the form enables the bot
   challenge it appears here (not built yet: a form with it enabled renders
   without it, `ui-ux/renderer.md`).
7. On submit, the server re-validates the entire submission against the
   version, discards answers to hidden fields, and in one transaction writes
   the submission, its media rows and its jobs as described in
   `architecture.md`. The in-progress record is deleted.
8. The confirmation screen renders the version's confirmation text and the
   submission's short reference. Back navigation does not resubmit.

## Alternate flows and errors

- **Form not found, archived, outside its date window or closed.** A page
  with the appropriate message in both languages, no form content.
- **Session cookie missing or expired** (in-progress records live 24 hours).
  The submitter restarts at page one with an explanation. Staged files of
  expired records are removed by the `jobs.cleanup` job, which also sweeps
  staging prefixes left without a record (`jobs.md`, "Recurring jobs").
- **A later page's condition depends on a changed earlier answer.** Going
  back and changing an answer re-evaluates visibility; answers on pages that
  become hidden are discarded at submit.
- **Version republished mid-fill.** The in-progress record pins the version
  it started with and completes against it. The submission records that
  version.
- **Upload fails** (network, type, size, decode). The file is marked failed
  with a specific message and can be retried or removed. Submission is
  blocked while a required upload field lacks the minimum count.
- **Honeypot filled or submitted faster than the minimum time.** The server
  returns the confirmation screen and stores nothing. No job, no media. The
  honeypot is checked on every post (Next, Back, the language switch, a Remove
  and Submit); the minimum time at Submit only. Both delete the in-progress
  record and its staged files.
- **Duplicate submit** (double click, retry). The last page carries a
  one-time token in the hidden field `_token`; a second submit with the same
  token returns the same confirmation without a second submission. Once a
  record exists the token is the record's. A one-page form is submitted from
  page 1 before any record exists, so page 1 of such a form renders a fresh
  token of its own, and the first Submit stores the submission under it. A
  reload renders a new token, so a Submit after a reload is a new submission.

## Rules

- Server validation is authoritative. The browser ships no validation rules:
  a check on blur asks the server (`POST /f/<slug>/check`).
- Hidden field answers are never stored.
- The renderer never exposes other submitters' data, field keys of other
  forms, or version internals beyond what rendering needs.
- Page size and performance targets live in `ui-ux/renderer.md`.
- No account, no login, no email verification for submitters.

## Audit entries

None. Submitters are not staff. Operational events go to logs with the
submission id only.

## Success criteria

- The reference form can be completed on a phone with ten photos over a
  slow connection without losing progress.
- Every validation rule in the model produces a specific, localized,
  announced message, verified by the conformance suite.
- A closed form accepts no submission even from a tab opened before closing.
- The intake transaction leaves no orphan media rows or jobs on failure,
  verified by a fault-injection integration test.
