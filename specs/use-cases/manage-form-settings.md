# Use case: Manage form settings and sharing

Module: `definitions`. Surface: manager. Model: `form-definition.md`,
Operational settings.

## Actors

- **Editor**: a signed-in staff member.

## Trigger

The editor opens a form's Settings tab in the manager.

## Main flow

1. The editor sees and edits:
   - **Notification recipients**: one or more email addresses that receive
     the staff notification. Addresses must be on `effluz.com` or in a
     configured allowlist of partner domains.
   - **Retention**: whole months, 1 to 36, default 12. Help text explains it
     counts from each submission's received time and that deletion is
     permanent.
   - **Open and close dates**: optional, with a timezone picker defaulting to
     Panama time. Shown in both local and UTC.
   - **Bot challenge**: on or off, default off, with a note on the
     accessibility cost.
   - **Slug**: editable while the form has never been published; read-only
     afterwards with an explanation.
2. Changes save on confirm, not on every keystroke, since they affect live
   behavior. Audit entry `form_settings_changed` with the changed keys.
3. The **Share** panel shows the public URL with a copy button and a QR code
   that encodes it, downloadable as PNG and SVG, sized for print. The panel
   is available only for published forms and warns when the form is closed
   or outside its date window.

## Alternate flows and errors

- **Shortening retention below the age of existing submissions.** The
  editor is shown how many submissions would be purged on the next run and
  must confirm. Audit entry records the count.
- **Removing the last notification recipient.** Allowed with a warning that
  no one will be notified; the manager still shows new submissions.
- **Invalid date window** (close before open). Inline error.

## Rules

- Settings never create a version and never change what a submitter sees,
  except for the challenge widget and the open or closed state.
- Retention changes apply to existing submissions. The purge job reads the
  current setting on each run.
- The QR code encodes the plain public URL, nothing else, so it stays valid
  across republishes.

## Audit entries

`form_settings_changed` with a list of setting keys, `retention_shortened`
with the affected count.

## Success criteria

- A retention change is reflected in the next purge run, verified by a test
  that advances the clock.
- The QR code scans to the public URL on a phone.
- A notification recipient outside the allowed domains cannot be saved.
