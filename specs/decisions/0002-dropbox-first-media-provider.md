# 0002. Dropbox as the first durable media provider, local disk as staging

Status: accepted
Date: 2026-10-08

## Context

Photos must be stored durably and reviewed by staff in an admin page. Effluz
already uses Dropbox. Alternatives were S3-compatible storage, Supabase
Storage, Google Drive, or the VPS disk alone. Uploads run asynchronously
through the job system, so a local staging tier exists regardless.

## Decision

Define a `MediaStorage` port with two adapters: local disk for staging and
Dropbox for the durable copy. The admin page shows photos from staging while
present, otherwise through Dropbox temporary links. Dropbox access is scoped
to an App folder with a refresh token. The account is a personal Dropbox
account, not a Business team; its identity is recorded in `private/`, which
is kept out of version control.

## Consequences

- Staff can also browse photos directly in Dropbox, which is the main reason
  to prefer it over a bucket.
- Every admin photo view past staging is a Dropbox API call. Links are
  cached per process. Acceptable at hundreds of submissions; revisit if the
  admin page becomes slow or rate-limited.
- Dropbox lacks signed URLs with revocation. Temporary links must never be
  embedded anywhere that outlives a session.
- Switching provider later is a new adapter plus an ADR. The port must stay
  free of Dropbox concepts.
- Access to the Dropbox folder is a second audit surface outside the app.
  Documented in the use-case privacy sections.
- A personal account is a single point of failure for all photos and
  backups. Recovery codes and a second trusted recovery contact must be set
  up before the first production deploy. Moving to a Business team later is
  a token swap, not a code change.
- The Dropbox adapter calls the HTTP API with `fetch` and no SDK: five endpoints
  and the refresh-token exchange are less code to review than an SDK's surface,
  and a local fake server can stand in for Dropbox in tests. Adopting the SDK
  later is an adapter change.
