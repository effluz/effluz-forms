# Media Storage

Owns: the `MediaStorage` port and its adapters, photo handling rules.
Decision record: `decisions/0002-dropbox-first-media-provider.md`.

## Role

Photos are the largest and most sensitive thing we store. They pass through two
tiers: a local staging directory on the VPS, then durable storage in Dropbox.
Each tier is an adapter of the same port.

## The `MediaStorage` port

| Operation | Behavior |
|---|---|
| `put(stream, key, contentType)` | Store the bytes. Returns a provider reference. Idempotent for the same key. |
| `viewUrl(ref, ttl)` | A URL that serves the file for at most `ttl`. |
| `delete(ref)` | Remove the file. Succeeds if it is already gone. |
| `exists(ref)` | For upload idempotency checks. |

Keys are human-readable so staff can browse the Dropbox folder, and carry
no personal data:

```
forms/<form slug>/<submission reference>/<nn>-<field slug>.<ext>
backups/<YYYY-MM-DD>-db.dump.enc
```

`nn` is the file's position within the field, `field slug` is an ASCII
slug of the field label in the form's first language, truncated to 40
characters. Example: `forms/historia-prematuro-2026/HP-0042/01-sube-hasta-10-fotos.jpg`.
The original filename is never used.

## Adapters

**Local disk (staging).** Root at `/srv/effluz-forms/data/staging`, outside the
web root. `viewUrl` returns an app route that streams the file to an
authenticated admin only. Used by every environment, and the only durable tier
in tests.

**Dropbox (durable).** An app registered under the Dropbox account
`tluzcando@gmail.com` using an App folder, so the token can reach nothing
else in that account. Uses the refresh-token
flow; the refresh token is an environment variable, access tokens are renewed
in memory. `viewUrl` wraps the temporary-link API and the result is cached in
process for slightly less than its validity window so the admin page does not
hit the API on every render. Respects rate-limit responses by retrying through
the job system, never inline.

Any further provider (S3-compatible, Supabase Storage, Google Drive) is a new
adapter and an ADR. No other code changes.

## File handling rules

Applied by the application layer before `put`, independent of provider:

- Accept only the kinds and limits the `file_upload` field's settings allow,
  capped by the system maximums in `security.md`. Kinds: `image` is JPEG,
  PNG, WebP, HEIC; `video` is MP4 and QuickTime MOV.
- Verify type by content, not by extension or declared MIME type.
- **Images** are re-encoded, which strips all metadata (EXIF, XMP, GPS).
  Submitters rarely know their photos carry location. Anything that fails
  decoding is a validation error shown to the submitter, not a job failure.
- **Videos** are stored as received: pass-through bytes, container and
  codec checked by content only, no re-encoding, no metadata stripping
  guarantee. The renderer tells the submitter this before they upload. A
  file whose container cannot be parsed is rejected as a validation error.
- Rename to the key scheme above. The original filename is not stored.

## Downloads

The manager offers a per-file download and a per-submission ZIP named
`<form slug>-<reference>.zip` with the same paths inside. Both stream
through the app from the staging copy or the Dropbox temporary link, and
both write an audit entry. Files are also directly in the Dropbox folder
above for staff who prefer to work there.

## Lifecycle

```
received  -->  staged (local disk, DB row)  -->  stored (Dropbox, staging deleted)
                                              \->  failed (job dead, staging kept, alert)
```

Deletion for retention removes the Dropbox file, the staging copy if any, and
the media row, in that order, through a job so a provider outage cannot leave
the row pointing at nothing.

## Dropbox-specific risks to monitor

- Refresh token revoked or expired: every upload job fails. Alert on the first
  dead `media.upload` job.
- Temporary links are 4 hours and not revocable. Admin pages never embed them
  in anything that leaves the browser session.
- Video playback in the manager streams through the same temporary link
  with HTTP range support from Dropbox; the app does not proxy video bytes.
- Team members with Dropbox access can see photos outside the app's audit
  log. The builder's consent guidance in `ui-ux/builder.md` must reflect
  this.
