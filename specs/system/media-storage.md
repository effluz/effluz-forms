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
| `put(bytes, key, contentType)` | Store the bytes (files are capped at 10 MB, so no stream is needed). Returns a provider reference. Idempotent for the same key: Dropbox writes with `mode: overwrite`. |
| `refForKey(key)` | The reference `put` returns for a key, without a call to the provider. `media.delete` uses it for a row whose upload never recorded a reference. |
| `viewUrl(ref, ttl)` | A URL that serves the file for at most `ttl`. |
| `openRead(ref)` | The bytes as a stream. Dropbox fetches the temporary link server-side. Used for thumbnails, full photo views, downloads and ZIPs. |
| `delete(ref)` | Remove the file. Succeeds if it is already gone. |
| `exists(ref)` | Existence check; uploads rely on `put` overwriting by key. |
| `read(ref)` | Staging only: the bytes, for the upload job. |
| `deletePrefix(prefix)` | Staging only: remove every file under a prefix. |
| `listPrefixes(root)` | Staging only (the local disk adapter implements it, the Dropbox adapter does not): each first-level prefix under a root with the time its contents last changed; none when nothing was ever staged. The staging sweep uses it. |

Keys are human-readable so staff can browse the Dropbox folder, and carry
no personal data:

```
forms/<form slug>/<submission reference>/<nn>-<field slug>.<ext>
forms/<form slug>/<submission reference>/staff-<nn>-<8 hex>.<ext>
forms/<form slug>/assets/header-<draft or version id>.webp
backups/<YYYY-MM-DD>-db.dump.enc
```

`nn` is the file's position within the field, `field slug` is an ASCII
slug of the field label in the form's first language, truncated to 40
characters. Example: `forms/historia-prematuro-2026/HP-0042/01-sube-hasta-10-fotos.jpg`.
The original filename is never used. Two fields of one form never share a slug:
the second and later fields with the same slug get `-2`, `-3`, and a suffix is
raised until the slug is free (a label that is itself `Photos 2` cannot collide
with the suffixed `Photos`). The base is trimmed first so the suffixed slug
still fits 40 characters.

Photos staff add to a story (`use-cases/review-submissions.md`, "Main flow:
staff photos") use the `staff-` key: `nn` is the next position among the
story's staff photos and the hex is the first eight characters of the media
id, so a removed photo's pending delete never reaches a newer file. They are
media rows under the reserved field key `staff-photos`
(`decisions/0028`).

Staged files are named `in-progress/<record id>/<file id>.<ext>`: random ids
only, so expiring a record removes its files with one prefix delete. Both ids
must be UUIDs: a prefix or key built from anything else is refused, so a bad id
can never resolve to the staging root. Local refs
are the key itself; Dropbox refs are the key with a leading `/` inside the App
folder.

## Adapters

**Local disk (staging).** Root at `/srv/effluz-forms/data/staging`, outside the
web root. `viewUrl` returns an app route that streams the file to an
authenticated admin only. Used by every environment, and the only durable tier
in tests. `MEDIA_PROVIDER=local` (the default outside production) also uses
local disk as the durable tier, rooted at `MEDIA_DURABLE_DIR` (default
`./data/durable`); production refuses it.

**Dropbox (durable).** An app registered under the Effluz Dropbox account
(its identity is recorded in `private/`, outside version control) using an App
folder, so the token can reach nothing else in that account. Uses the refresh-token
flow; the refresh token is an environment variable, access tokens are renewed
in memory. `viewUrl` wraps the temporary-link API and the result is cached in
process for slightly less than its validity window so the admin page does not
hit the API on every render. Respects rate-limit responses by retrying through
the job system, never inline.

`MEDIA_PROVIDER=dropbox` with `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` and
`DROPBOX_REFRESH_TOKEN`. The adapter calls the HTTP API with `fetch` (no SDK):
`oauth2/token` for the refresh-token exchange, `files/upload`,
`files/get_metadata`, `files/delete_v2` and `files/get_temporary_link`.
`DROPBOX_API_URL` and `DROPBOX_CONTENT_URL` exist so tests can point it at a
local fake. A 401 renews the access token once. Any other non-2xx answer (429, 5xx, and
also 4xx such as a refused path) fails the job, which the job system retries
until it is dead; there is no permanent class for Dropbox answers. Every call
stops waiting after 60 seconds, which counts as a failed attempt.

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
  JPEG, PNG and WebP are re-encoded to the same format with the EXIF orientation
  applied first; HEIC is decoded with `libheif-js` and encoded as JPEG (ADR
  0023). Inputs above 50 megapixels are refused as unreadable.
- **Videos** are stored as received: pass-through bytes, container checked
  by content (no codec inspection in the first release), no re-encoding, no
  metadata stripping guarantee. The renderer tells the submitter this before
  they upload. A file whose container cannot be parsed is rejected as a
  validation error. The container check walks the ISO base media file format
  boxes: the first box is `ftyp`, every box size fits the file, and a `moov`
  box is present.
- The size limit applies twice: to the received bytes, and again to the
  re-encoded image, which can be larger than the original (a palette PNG, for
  instance). A file over the limit after re-encoding is `file_too_large`.
- Rename to the key scheme above. The original filename is not stored.

## Staff-uploaded header images

A form's optional header image goes through the same port and the same
image rules: type verified by content, re-encoded to WebP at 1600 px wide
with metadata stripped, rejected above 300 KB after encoding or if it
fails to decode. It is uploaded synchronously from the builder, stored
under the form's `assets/` path, and served by the app with long cache
headers keyed by version. It is not personal data and is not subject to
submission retention; it is deleted when no draft or version references
it.

## Downloads

The manager offers a per-file download and two ZIPs per story: all files,
named `<form slug>-<reference>.zip`, and, on post-plan forms, the chosen
photos, named `<form slug>-<reference>-chosen.zip`. Entries are named
`<reference>/<file name>` and stored without compression, since photos are
compressed already. All stream through the app from the staging copy or the
durable file (`openRead`), and all write an audit entry. Thumbnails are 320 px
WebP, made on request and not audited. Files are also directly in the Dropbox
folder above for staff who prefer to work there.

## Lifecycle

```
received  -->  staged (local disk, DB row)  -->  stored (Dropbox, staging deleted)
                                              \->  failed (job dead, staging kept, alert)
```

Staff photos are deleted with the story and by the retention purge, through
their media rows like every other file of the story.

Deletion for retention removes the Dropbox file, the staging copy if any, and
the media row, in that order, through a job so a provider outage cannot leave
the row pointing at nothing. The job finds the file through its row: the stored
reference, or `refForKey` of the row's durable key when no reference was
recorded. It never parses a key back into a reference.

When a delete overlaps an upload, the upload's final write can land after the
row is gone. Recording the reference then updates no row, and the upload job
deletes the file it just wrote instead of leaving it in the folder.

Staged files can outlive their row (a crash before the first commit, or a
failed delete after a silent accept or a Submit). The recurring step
`submissions.sweep_staging` (`system/jobs.md`, "Recurring jobs") lists the
`in-progress/` prefixes, and removes those older than 24 hours that no
`submission_in_progress` row and no `media.staging_ref` claims.

`viewUrl` on local disk returns `/admin/media/local/<ref>`, the admin route
that streams the file, and ignores the `ttl` (the route checks the session on
every request). The route exists now. It requires a session, answers 404
unless `MEDIA_PROVIDER=local`, serves only the durable key of a stored video
media row of an existing submission (any other key under `forms/`, and
`assets/`, is a 404), and records the view as `photo_viewed` like the media
route does. It is reached only by a video redirect from the audited media
route; photos and staging copies stream through that audited route instead.

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
