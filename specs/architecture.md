# System Architecture

Status: first pass, 2026-10-08. Core decisions are accepted and recorded in
`decisions/`. Two tooling choices remain proposed; see Open items.

## Purpose and scale

`effluz-forms` hosts public forms for Effluz events and processes, plus a small
admin page where Effluz staff review submissions. Design targets:

- Hundreds of submissions per event, not thousands per hour.
- A single VPS, one or two developers, continuous deployment from `main`.
- Submission data is personal and sometimes about children. Every component
  is chosen to keep that data in as few places as possible.

Everything below is sized for that. Revisit if traffic grows by two orders of
magnitude or a second server appears.

## System overview

```
                 Internet
                    |
             +------+------+
             |   proxy     |  TLS termination, rate limiting   (Caddy)
             +------+------+
                    |
        +-----------+-----------+
        |                       |
  +-----+-----+          +------+------+
  |    app    |          |   worker    |  same image, job runner entrypoint
  | forms +   |          |  outbox     |
  | admin     |          |  poller     |
  +-----+-----+          +------+------+
        |                       |
        +-----------+-----------+
                    |
             +------+------+       +-------------------+
             |     db      |       | local staging dir |  photos until uploaded
             |  Postgres   |       +-------------------+
             +-------------+

  External: Dropbox (durable media)   SMTP2GO (email)   Google (admin sign-in)
            Error tracker             Uptime monitor
```

All services run as one Docker Compose stack on an InterServer VPS. The `app`
and `worker` containers run the same image with different entrypoints so a
crash in job processing never takes the public forms down.

The application is built with Next.js and React (ADR 0008). `app` is the
Next.js server. `worker` is a plain Node entrypoint in the same codebase that
imports the application layer directly and never loads Next.js.

## How Clean Architecture maps onto this system

Each form under `src/forms/<form-name>/` and the shared code under
`src/shared/` follow the four layers defined in `CLAUDE.md`. The system
components above are all **infrastructure adapters** behind ports owned by the
application layer. The ports every form can rely on from `src/shared/`:

| Port | Responsibility | First adapter | Spec |
|---|---|---|---|
| `UnitOfWork` | Transaction boundary; lets a use case persist state and enqueue jobs atomically | Postgres | `system/database.md` |
| `MediaStorage` | Store a file, return a reference, produce a time-limited view URL, delete | Local disk (staging), Dropbox (durable) | `system/media-storage.md` |
| `JobQueue` | Enqueue typed jobs with retry and scheduling semantics | Postgres outbox table | `system/jobs.md` |
| `EmailSender` | Send a bilingual transactional message | SMTP2GO | `system/email.md` |
| `AdminIdentity` | Verify a staff sign-in and return an allowed identity | Google OpenID Connect | `system/security.md` |
| `Clock`, `IdGenerator` | Determinism in tests | System | n/a |

Repositories are form-specific and live inside each form's `application/`
(port) and `infrastructure/` (adapter) folders.

**Where the framework is allowed.** Next.js and React appear only in
`presentation/` folders and in the composition root under `src/app/`. Route
handlers and server actions are thin: parse input, call a use case, map the
result to a response. A use case must be callable from a test, from the worker,
and from a route handler without change. No React or Next.js import may appear
in `domain/`, `application/`, or `infrastructure/`.

## Submission data flow

1. The browser posts the form, including photos, to `app`.
2. `app` validates fields, file count, size and type at the boundary. Photos are
   written to the local staging directory under random names, and image
   metadata (EXIF, including GPS) is stripped.
3. In **one database transaction** the use case stores the submission, one
   media record per photo with status `staged`, and the jobs: one
   `media.upload` per photo, one `email.submitter_confirmation`, one
   `email.staff_notification`.
4. The transaction commits. The user sees the success screen. Nothing external
   has been called yet, so a provider outage never loses a submission.
5. `worker` picks jobs up. Uploads move each photo to Dropbox, mark the media
   record `stored` with its provider reference, and delete the staging copy.
   Email jobs call the provider.
6. The admin page lists submissions. For each photo it serves the staging copy
   if still present, otherwise a short-lived Dropbox link.

The staff notification links to the submission in the admin page and carries
no story text or photos. Email is the least controlled channel we have.

## Environments

| Environment | Where | Purpose |
|---|---|---|
| `local` | Developer machine, Compose for Postgres and a local mail catcher | All development and test |
| `production` | The VPS | The only deployed environment |

There is no staging. Confidence comes from the test suite and from the local
stack being the same Compose definition minus TLS. See `system/deployment.md`.

## Configuration and secrets

- Twelve-factor: all configuration through environment variables, validated at
  process start. A missing or malformed variable fails the boot.
- `.env.example` is committed with placeholder values and a comment per
  variable. Real values live only in the server's `.env` and in local files
  that `.gitignore` excludes.
- GitHub holds only what deployment needs: SSH host, user, key, and the
  registry token. Application secrets never pass through CI.
- No configuration value is ever logged.

## Technology decisions

| Concern | Decision | Status | ADR |
|---|---|---|---|
| Database | PostgreSQL in a container on the VPS | accepted | `decisions/0001` |
| Durable media | Dropbox, with local disk staging | accepted | `decisions/0002` |
| Background work | Database-backed outbox, no broker | accepted | `decisions/0003` |
| Hosting | Single VPS, Docker Compose, Caddy proxy | accepted | `decisions/0004` |
| Admin sign-in | Google OpenID Connect, `effluz.com` Workspace accounts only | accepted | `decisions/0005` |
| Email | SMTP2GO behind the `EmailSender` port | accepted | `decisions/0006` |
| CI/CD | GitHub Actions, images in GitHub Container Registry | accepted | `decisions/0007` |
| Application | Next.js and React, framework confined to presentation and composition root | accepted | `decisions/0008` |
| Error tracking | Sentry with PII scrubbing | proposed | `system/observability.md` |
| Bot challenge | Cloudflare Turnstile on the final step | proposed | `system/security.md` |

## External accounts

| Account | Identity | Used for |
|---|---|---|
| Google Workspace | `effluz.com` | Admin sign-in; OAuth client lives in a Google Cloud project owned by this Workspace |
| Dropbox | Personal account `tluzcando@gmail.com` | App folder for durable media and encrypted backups |
| SMTP2GO | Effluz account, sender domain `forms.effluz.com` | Transactional email |
| InterServer | Effluz account | The VPS, United States region |
| GitHub | `effluz/effluz-forms` | Code, CI/CD, container registry |

Credentials for all of these live in the team password manager, never in the
repository. Each account must have at least two people able to recover it.

## Open items

None block the first form. Still to confirm before the first production deploy:

1. **Error tracker and bot challenge** are proposed, not decided. Both are
   adapters; the forms can be built without them.
2. **Data residency.** The VPS is in the United States. Each form's use-case
   spec must state where its submitters are and whether that is acceptable.
3. **Dropbox ownership.** The media account is a personal one. See ADR 0002
   for the recovery requirement that follows.

## What this architecture deliberately leaves out

Message broker, cache layer, separate worker service, multi-region, roles and
permissions beyond a single admin role, public API, mobile app. Each would need
an ADR explaining what changed.
