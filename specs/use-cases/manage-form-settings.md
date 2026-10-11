# Use case: Manage form settings and sharing

Module: `definitions`. Surface: manager. Model: `form-definition.md`,
Operational settings.

## Actors

- **Editor**: a signed-in staff member.

## Trigger

The editor opens a form's Settings tab in the manager.

## Main flow

1. The editor sees and edits:
   - **Notification recipients**: up to 20 email addresses that receive the
     staff notification. Addresses must be on the Workspace domain
     (`GOOGLE_ALLOWED_HOSTED_DOMAIN`, `effluz.com` in production) or on a
     partner domain listed in `NOTIFICATION_ALLOWED_DOMAINS`
     (`architecture.md`, "Configuration and secrets").
   - **Notification cadence**: one email per submission, or a daily digest
     at a chosen hour in the form's timezone. Default per submission.
   - **Reference prefix**: 2 to 6 uppercase letters or digits used in
     submission references and Dropbox folder names. Default derived from
     the slug. Read-only after the first submission.
   - **Retention**: whole months, 1 to 36, default 12. Help text explains it
     counts from each submission's received time and that deletion is
     permanent.
   - **Open and close dates**: optional, with a timezone picker defaulting to
     Panama time (`America/Panama`). The dates are entered in that zone,
     stored as UTC instants, and shown in both. The same zone applies to the
     daily digest hour. The close date must be after the open date.
   - **Bot challenge**: on or off, default off, with a note on the
     accessibility cost.
   - **Allow another response**: on or off, default off. When on, the
     confirmation screen offers a link to start the form again, for forms
     that invite one submission per child or per item.
   - **Slug**: editable while the form has never been published; read-only
     afterwards with an explanation. Same rules as at creation: 3 to 64
     lowercase letters, digits and hyphens, not reserved, unique.
2. Changes save on confirm, not on every keystroke, since they affect live
   behavior. All settings are submitted together and validated together;
   every settings issue is reported at once, each at its field. Nothing is
   written when nothing changed. Otherwise one audit entry
   `form_settings_changed` lists the changed keys.
3. The **Share** panel shows the public URL in a read-only field (a Copy
   button comes with the manager's first client component) and a QR code
   that encodes it, downloadable as PNG (1024 and 2048 px) and SVG
   (`decisions/0021`). A print-ready PDF with the title and URL under the
   code is deferred. The panel is available for every form and warns when
   the form is not reachable: a draft that was never published, closed,
   archived, or outside its date window, with the reason.

## Alternate flows and errors

- **Shortening retention below the age of existing submissions.** The
  editor is shown how many submissions would be purged on the next run and
  must confirm; the save is refused as `retention_confirm` with that count
  until the editor confirms. Audit entry `retention_shortened` records the
  old and new months and the count. With no submission affected, no
  confirmation is asked and no such entry is written. The confirmation is
  decided on the form row as re-read under the lock: when another editor
  changed the retention meanwhile, the save compares against that value and
  takes the count again, so a shortening it did not show is still refused
  as `retention_confirm`.
- **Removing the last notification recipient.** Allowed with a warning that
  no one will be notified; the manager still shows new submissions.
- **Invalid date window** (close before open). Inline error (`date_order`).
- **Other refusals on a field.** Each is reported with its code at the
  field's path: `recipient_domain` and `recipient_syntax` (per address),
  `too_many_recipients`, `prefix_format`, `retention_range`,
  `timezone_unknown`, `hour_range`. The slug adds `slug_format`,
  `slug_reserved` and `slug_taken`.
- **Locked values.** Changing the slug after the first publish is refused as
  `slug_locked`, and changing the reference prefix after the first
  submission as `prefix_locked`. Both are decided again when the save is
  written: the form is re-read under the lock, so a publish that landed
  meanwhile is respected, and whether submissions exist is read at request
  time, not locked.
- **A value no control can produce** (a tampered request, a date that is not
  a date) is refused as `malformed` at its path instead of failing the
  request.
- **The page was out of date** (the CSRF token does not match the session):
  nothing is saved and the tab reports it.

## Rules

- Settings never create a version and never change what a submitter sees,
  except for the challenge widget and the open or closed state.
- Retention changes apply to existing submissions. The purge job reads the
  current setting on each run.
- The QR code encodes the plain public URL, nothing else, so it stays valid
  across republishes.

## Audit entries

`form_settings_changed` with a list of setting keys (`slug` included when the
link name changed), `retention_shortened` with the old and new months and the
affected count. Details are listed in `system/security.md`, "Audit log".

## Success criteria

- A retention change is reflected in the next purge run, verified by a test
  that advances the clock.
- The QR code scans to the public URL on a phone.
- A notification recipient outside the allowed domains cannot be saved.
