# Use case: Publish a form and manage its lifecycle

Module: `definitions`. Surface: manager and builder. Model:
`form-definition.md`, section Lifecycle.

## Actors

- **Editor**: a signed-in staff member.
- **The public**: affected by, but not present in, this flow.

## Trigger

The editor clicks "Publish" in the builder, or a lifecycle action in the
manager (close, reopen, archive, unarchive).

## Main flow: publish

1. The system runs publish validation on the draft: at least one page with
   one input field; every field labeled in every required language; every
   option labeled; consent field and retention present when the form
   collects personal data; confirmation screen text present; no condition
   references a missing or later field; header image alt text present in
   each required language when an image is set; no settings exceed system
   maximums.
2. Violations are returned as a list with a link to each offending field.
   Publishing stops here if the list is not empty.
3. The editor sees a summary: version number to be created, number of pages
   and fields, languages, and, for a republish, a diff of added, removed and
   changed field keys with a warning for each removed field that has answers.
4. On confirm, in one transaction: a `form_version` row is inserted from the
   draft with the next number; the form's `current_version_id` points at it;
   the form's status becomes `published` if it was `draft`; the draft row
   stays with the published content as the base of further edits, and its
   revision advances. Audit entry `form_published`.
5. The public URL `/f/<slug>` serves the new version from the next request.

The publish call carries the version number the preview announced and the
draft revision it checked. It is refused, in this order, as `not_found`,
`archived`, `conflict` (the number is no longer the next one, or the draft
was saved since the preview), `issues` (with the list of step 2) or
`unchanged`; the first refusal found is the one reported.

## Main flow: close, reopen, archive

- **Close**: status `closed`. The public URL shows the closed message from
  the version. In-progress submitters who reach the final page after the
  close receive the closed message and their partial answers are discarded.
- **Reopen**: status back to `published`, same current version.
- **Archive**: hidden from the default manager list. Allowed from any status;
  closes the form first if it was published. Submissions remain reviewable
  and still subject to retention.
- **Unarchive**: returns to `closed`, or to `draft` when the form was never
  published.

Each writes its audit entry.

## Alternate flows and errors

- **Open and close dates.** Set in settings. The form is served only inside
  the window; outside it the renderer shows a "not yet open" or closed
  message. Dates narrow a `published` status, they never change it.
- **Publishing with no changes since the last version.** Refused with a
  message; nothing to publish.
- **Concurrent publish.** The publish carries the preview's draft revision
  and version number. If either moved (another publish, or a draft save after
  the preview), checked first on a plain read and again once it holds the
  form and draft rows, it is refused as `conflict` and asked to reload. The
  version number uniqueness constraint backs this up.
- **Publishing an archived form.** Refused as `archived`; unarchive it first.
- **A lifecycle action the status no longer allows**, because someone else
  acted first, is refused as `invalid_transition` and changes nothing.
- **Deleting a form.** Only a form with zero submissions and no published
  version can be deleted, from the manager, with confirmation by typing the
  form's slug exactly, and audit entry `form_deleted`. A wrong slug is
  refused as `slug_mismatch`, and one that no longer qualifies as
  `not_allowed`: the form is re-read under the lock, so a publish that landed
  meanwhile is caught, and the submission count is read at request time (a
  submission needs a published version, which the re-read sees). Deleting
  removes the form with its draft; the audit entries remain. Anything else is
  archived.

## Rules

- Versions are immutable. The database enforces it with a trigger, the
  application never exposes an update path.
- Publishing is the only way the public sees a change. There is no "save and
  go live".
- A removed field's answers are not deleted. They are still exported under
  their key for the versions that had them.
- Only one version is current. There is no scheduled publish in the first
  release.

## Audit entries

`form_published` (with version number), `form_closed`, `form_reopened`,
`form_archived`, `form_unarchived`, `form_deleted` (with the slug, since the
form no longer exists to resolve it). Details are listed in
`system/security.md`, "Audit log".

## Success criteria

- A draft that fails any publish rule cannot become a version, verified by
  one test per rule.
- A submission made against version 1 renders identically in review after
  versions 2 and 3 are published.
- Close takes effect for the next public request without a restart.
