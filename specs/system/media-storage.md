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

Keys are opaque, random, and carry no personal data: `<form>/<submission-id>/<media-id>.<ext>`.

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

## Photo handling rules

Applied by the application layer before `put`, independent of provider:

- Accept only the types and limits the form's use-case spec lists. Defaults:
  JPEG, PNG, WebP, HEIC; 10 MB per file; count per submission set by the form.
- Verify type by content, not by extension or declared MIME type.
- Strip all metadata (EXIF, XMP, GPS) by re-encoding. Submitters rarely know
  their photos carry location.
- Rename to the opaque key. The original filename is not stored.
- Reject anything that fails decoding. A corrupt image is a validation error
  shown to the submitter, not a job failure.

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
- Team members with Dropbox access can see photos outside the app's audit
  log. Document this in the use-case spec's privacy section.
