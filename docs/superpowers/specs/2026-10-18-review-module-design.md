# Review module: design

Date: 2026-10-18. Status: agreed with the owner in conversation, awaiting
review of this document. Mockups: Wonder file "Effluz Forms", artboards
"Page - Manager Story Detail" and "Page - Manager Post Plan Week".

This document is the brief for the review plan. It builds on the existing
specs and says where it departs from them: `specs/use-cases/review-submissions.md`,
`curate-submission.md`, `operate-jobs.md`, `specs/ui-ux/manager.md`
("Submissions tab", "Operations page"), `specs/system/media-storage.md`,
`specs/system/jobs.md`, `specs/system/observability.md`. Where this document
and those specs disagree, this document wins and the plan updates the spec.

## Intent

Effluz collects stories and photos of premature babies through a public form
and turns them into social media posts. Today the trail lives in one person's
head, a phone and an inbox. The review module puts the whole trail in one
place: read the story, gather better photos, fix the text, plan the day it
goes out, and record that it went out.

Success is the owner opening one page and seeing what goes out this week,
which days are empty, and what is still missing for each day's post, without
remembering any of it.

## Who uses it

One person: the owner, who is also the CEO. That is not expected to change
soon. Everything is designed for one person working alone; who did what is
still recorded, for the audit trail and in case the team grows. There is no
need for edit-conflict handling beyond what the specs already say (last save
wins).

## The workflow it supports

As the owner described it, in order:

1. **Read** the story: answers and photos, in the sender's language.
2. **Ask for different photos** when needed. This happens outside the tool,
   on WhatsApp, Instagram or email, as the sender agreed to be contacted.
3. **Add the new photos** to the story in the tool when they arrive.
4. **Correct** spelling and grammar. The sender's original is never changed.
5. **Plan** the story for a specific day's post.
6. **Edit the photos** for posting: cropping and text overlays, in Canva,
   outside the tool.
7. **Post**, outside the tool, then **mark the story as published**, with the
   link to the post if there is one.

## Goals

- A **story page** with the answers, the photos, the correction editor, the
  readiness checks, the planned date and the sender's contact preference.
- **Staff-added photos**: the owner uploads photos received outside the tool
  to a story. They are kept apart from the sender's own photos and labelled
  with who added them, when, and from where.
- **Choosing photos for the post**: each photo, the sender's or staff-added,
  can be marked as chosen. "Download chosen" gets the chosen photos at full
  quality; "Download all" gets every photo.
- **Readiness**: a story is ready when three checks are done: photos chosen,
  photos edited in Canva, text checked.
- **A post plan**: a top-level manager page showing a week of days, each day
  with its planned story or an empty slot, each planned story's readiness,
  and the stories still waiting for a date.
- **Publishing**: "Mark as published" with an optional `https` post link, as
  the specs describe.
- **Failure handling**: when a background job gives up (a photo that never
  reaches Dropbox, an email that fails), the owner gets an email, the story
  page shows a warning with "Try again", and the story list flags the story.
- **Export** to CSV and **delete**, as `review-submissions.md` specifies.

## Non-goals (later, or never in this module)

- **DeepL correction suggestions.** Deferred by the owner. The correction
  editor is manual. The `TextCorrector` port stays in the architecture for
  later; nothing in this plan calls an outside text service. Whether DeepL's
  free API tier includes the Write feature is unverified and will be checked
  when this comes back.
- **Messaging senders from the tool.** Contact stays on WhatsApp, Instagram
  and email.
- **Editing photos in the tool.** Canva does that.
- **Uploading the Canva results back**, or searching Canva or Dropbox for
  them from the tool. The owner rejected manual re-upload; an integration
  that finds the final images might come later.
- **Posting to social media from the tool.**
- **A Google Sheets integration.** The CSV opens in Google Sheets.
- **Bulk delete, notes and comments on stories.** As the specs already say.

## Anti-goals

- The sender's original answers or photos are ever changed, or hard to tell
  apart from the owner's corrections and additions.
- The plan says a story is ready when something is still missing.
- A failure that loses a photo goes unnoticed.
- Story text, names or photos appear in an alert email, a log or an error.

## Decided with the owner

- One-person use; no team features.
- Staff can attach photos to a story after it arrives.
- Photos edited in Canva are recorded with a tick, not an upload.
- "Ready" means: photos chosen, photos edited, text checked.
- The plan answers three questions: what goes out this week, which days are
  empty, and what is not ready yet.
- Correction is by hand; DeepL later.
- Failures: an email to the owner, a warning on the story page, a flag in
  the list.
- Bulk data leaves the tool as CSV, opened in Google Sheets when needed.
- The story page and the post plan look as in the two Wonder mockups,
  except the "Contact the sender" card (see the designer's calls).
- **Consent for photos sent later.** Photos a sender sends after the form,
  on WhatsApp, Instagram or email, are part of the same story, under the
  form's consent and retention. The story form's consent text gains one
  line to that effect (for example "Photos you send us later for this story
  are kept and used the same way", in both languages), which means
  publishing a new version of that form. When the owner adds photos she
  ticks "The sender sent these for this story" before the upload goes
  through; the tick is required and recorded with the photos and in the
  audit log.

## Decided by the designer (calls for the owner to check)

- **The story page is a full page, not a drawer.** `ui-ux/manager.md`
  specifies a 720 px drawer over the list; the mockup and this design use a
  full page at `/admin/forms/[id]/submissions/[reference]` (or similar) with
  Newer and Older links that follow the list's filters. Reason: the page
  holds the photos, the correction editor and the readiness panel, which do
  not fit a drawer comfortably.
- **The full story page applies to every form**, replacing the drawer. The
  post-plan features on it (adding staff photos, choosing photos, readiness
  checks, the planned date) appear only on forms with the post-plan setting
  on. Turning the setting off later is allowed; planned dates and ticks are
  kept but hidden until it is turned back on. Photos the team already added
  stay shown and removable; adding and choosing photos are hidden.
- **No special contact card.** A form is data, so the page cannot know which
  answers are the sender's contact details. The mockup's "Contact the
  sender" card is dropped; the contact answers show as ordinary answers in
  the answers card. A way to mark contact fields can come with the builder.
- **"Text checked" fills in on its own** when a corrected version is saved,
  and can also be ticked by hand for a story that needs no corrections.
  Reverting every correction does not clear the tick; it is the owner's
  statement that she read the text.
- **"Photos chosen" is done when at least one photo is chosen.**
- **"Photos edited in Canva" is one tick per story**, and it clears itself
  when the set of chosen photos changes after it was ticked, so the plan
  never shows a story as ready for photos that were not edited. Readiness is
  worked out when read, from the stored ticks and choices.
- **Planning is a date on the story, not a new status.** The status ladder
  stays `new`, `viewed`, `edited`, `published` as specified. A planned,
  unpublished story shows "Planned · <date>" in place of its status badge.
  Marking as published keeps the planned date as the day it went out.
- **One story per day.** Planning a story on a day that already has one asks
  whether to swap the two or move the other back to "Waiting for a date".
  The rule binds unpublished stories only, across every form: a story keeps
  holding its day after its form leaves the post plan, and the question
  names it. The answer acts only on the story the question named.
- **Published stories stay on their day.** The week view shows a published
  story on its planned date, with its post link. A story published with no
  planned date gets the publish date as its day, without taking or blocking
  that day's slot for an unpublished story. Unmarking keeps the date.
- **The post plan covers forms marked for it.** A form setting, "Use
  submissions in the post plan", off by default, on for the story form.
  Event and process forms stay out of the plan. Stories from several such
  forms share the one plan.
- **"Waiting for a date"** lists unpublished, unplanned stories from those
  forms, newest first.
- **Staff photos** go through the same pipeline as public uploads: type
  checked by content, re-encoded with metadata stripped, size limits, into
  the same Dropbox folder as the story's other photos with a key that cannot
  collide with the sender's files. They count toward no per-field limit and
  are not answers: the sender's `answers` stay byte-identical. Removing a
  staff photo is allowed; the sender's photos cannot be removed one by one.
  Photos and videos are both accepted, with the public limits. "From where"
  is a fixed list in both languages: WhatsApp, Instagram, Email, Other.
  Staff photos are deleted with the story and by its retention purge, counted
  from the story's received date.
- **Alert email recipient** is one configured address (for example
  `ALERT_EMAIL`), sent through the existing email adapters. Every job that
  goes dead raises an alert, system jobs included. Alerts are grouped: at
  most one email per job type per hour, listing how many went dead and the
  story references where there are any, with a link, never content. When the
  failing job is itself an email, the alert may fail the same way; that is
  accepted, and the Operations page and the health endpoint still show it.
  This replaces "the team channel" in `observability.md` for now. Where the
  alert is raised (the job store lives in `shared`, which imports no module)
  is the builder's to design inside the dependency rules, with an ADR if a
  module edge changes.
- **The Operations page is minimal**: one list of dead jobs with "Try again",
  plus the worker heartbeat age. "Discard" and "retry all of type" from
  `operate-jobs.md` stay, since they are small.
- **The Audit page** listed in `manager.md` is not in this plan.
- **Consent text item 9** (automated correction by DeepL) stays in the
  checklist; it remains true as a permission even while the feature is off.
- **A tenth consent checklist item**, "photos sent later for this
  submission are kept and used the same way", is added to
  `form-definition.md` and required at publish only for forms with the
  post-plan setting on. Turning the setting on for a published form whose
  current version lacks it shows a notice that staff photos stay disabled
  until a version with that line is published.

## Constraints

Everything in `CLAUDE.md` holds, in particular:

- The `review` module may depend on `definitions`, `submissions`, `media` and
  `identity` (`specs/architecture.md`); the alert email goes through
  `notifications`, which needs `review` or `submissions` to be allowed to use
  it, and the architecture table updated in the same plan.
- `submission.answers` is immutable (database trigger). Curation, readiness,
  the planned date, chosen photos and staff photos live in separate columns
  or tables.
- Every view of personal data is audited, as `review-submissions.md` lists,
  plus new entries for adding, choosing and removing staff photos, ticking
  readiness checks and planning a story.
- Manager chrome is bilingual (English label, Spanish beneath), with every
  string in `ui-ux/manager.md`'s copy tables.
- WCAG 2.2 AA: the photo choice, the checks and the plan are fully
  keyboard-operable, and state is never shown by colour alone (the mockups
  pair every colour with a tick or words).
- Synthetic data only in tests, fixtures and screenshots.
- Next 16.4 with Cache Components: the measured behaviour in ADR 0027 applies
  to admin pages too (a thrown not-found or error renders an empty document
  without script).

## Left to the builder

- Route names, table and column names, and the exact audit entry names.
- How the week view handles the current day, past days and weeks with
  nothing planned.
- Thumbnail sizes, the full-size photo viewer, and whether the ZIP of chosen
  photos and the ZIP of all photos share one route.
- Retry behaviour details beyond what `operate-jobs.md` says.
- How the list's existing filters gain "Planned" and "Not ready".
