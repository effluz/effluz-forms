# System Architecture

Status: first pass, revised 2026-10-09 for the form builder model (ADR 0009).
Core decisions are accepted and recorded in `decisions/`. Two tooling choices
remain proposed; see Open items.

## Purpose and scale

`effluz-forms` is a form builder and manager. Effluz staff build and publish
forms in an admin area; the public fills them in; staff review the results.
Forms are versioned data in the database, not code. Design targets:

- Tens of forms, hundreds of submissions per form, not thousands per hour.
- A single VPS, one or two developers, continuous deployment from `main`.
- New forms need no developer. Developers add capabilities.
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
  | renderer  |          |  outbox     |
  | builder   |          |  poller     |
  | manager   |          |             |
  +-----+-----+          +------+------+
        |                       |
        +-----------+-----------+
                    |
             +------+------+       +-------------------+
             |     db      |       | local staging dir |  photos until uploaded
             |  Postgres   |       +-------------------+
             +-------------+

  External: Dropbox (durable media)   SMTP2GO (email)   Google (admin sign-in)
            DeepL (translation suggestions)   Error tracker   Uptime monitor
```

All services run as one Docker Compose stack on an InterServer VPS. The `app`
and `worker` containers run the same image with different entrypoints so a
crash in job processing never takes the public forms down.

The application is built with Next.js and React (ADR 0008). `app` is the
Next.js server. `worker` is a plain Node entrypoint in the same codebase that
imports the application layer directly and never loads Next.js.

## Surfaces

| Surface | Who | Path | Owning module's presentation |
|---|---|---|---|
| **Renderer** | The public | `/f/<slug>` | `submissions` |
| **Builder** | Staff | `/admin/forms/<id>/edit` | `definitions` |
| **Manager** | Staff | `/admin/...` | `definitions` (lifecycle, settings), `review` (submissions) |

## Modules

Code is organized by capability under `src/modules/`, each with the four
layers from `CLAUDE.md`. Dependencies between modules point only downward in
this table and go through each module's public application API.

| Module | Responsibility | May depend on |
|---|---|---|
| `form-model` | The contract in `form-definition.md`: field type registry, validation rules, condition evaluation, publish validation. Pure domain, no I/O. | `shared` |
| `identity` | Staff sign-in, sessions, audit log | `shared` |
| `media` | `MediaStorage` port and adapters, photo processing, media records | `shared` |
| `notifications` | Email templates and the `EmailSender` port; job handlers for email | `shared` |
| `definitions` | Forms, drafts, versions, lifecycle, operational settings, QR codes, translation suggestions | `form-model`, `identity` |
| `submissions` | Public rendering of a published version, server validation, intake transaction, enqueuing jobs | `form-model`, `definitions`, `media`, `notifications` |
| `review` | Listing, viewing, exporting, downloading and deleting submissions; curation status and text edits; dead job retry | `form-model`, `definitions`, `submissions`, `media`, `identity` |

`shared/` holds the kernel: `LocalizedText`, ids, `Clock`, `UnitOfWork`,
`JobQueue`, logging, and nothing that belongs to one module.

Adding a module or an edge to this table requires an ADR.

## Ports

The system components in the overview are all **infrastructure adapters**
behind ports owned by the application layer. Ports available from `shared/`
or a module's public API:

| Port | Responsibility | First adapter | Spec |
|---|---|---|---|
| `UnitOfWork` | Transaction boundary; lets a use case persist state and enqueue jobs atomically | Postgres | `system/database.md` |
| `MediaStorage` | Store a file, return a reference, produce a time-limited view URL, delete | Local disk (staging), Dropbox (durable) | `system/media-storage.md` |
| `JobQueue` | Enqueue typed jobs with retry and scheduling semantics | Postgres outbox table | `system/jobs.md` |
| `EmailSender` | Send a bilingual transactional message | SMTP2GO | `system/email.md` |
| `AdminIdentity` | Verify a staff sign-in and return an allowed identity | Google OpenID Connect | `system/security.md` |
| `Clock`, `IdGenerator` | Determinism in tests | System | n/a |

| `FieldTypeRegistry` | Look up a field type's validator, normalizer, exporter | In-code registry in `form-model` | `form-definition.md` |
| `Translator` | Suggest a translation of staff-authored text; available to `definitions` only | DeepL API | `decisions/0010` |
| `TextCorrector` | Suggest spelling and grammar corrections for one text answer; available to `review` only | DeepL Write | `decisions/0011` |

Repositories belong to the module that owns the aggregate (`definitions` owns
forms and versions, `submissions` owns submissions) and are defined as ports
in that module's `application/` with adapters in its `infrastructure/`.

**Where the framework is allowed.** Next.js and React appear only in
`presentation/` folders and in the composition root under `src/app/`. Route
handlers and server actions are thin: parse input, call a use case, map the
result to a response. A use case must be callable from a test, from the worker,
and from a route handler without change. No React or Next.js import may appear
in `domain/`, `application/`, or `infrastructure/`.

## Publishing data flow

1. Staff edit the draft in the builder. Every save is validated structurally
   by `form-model` and written to the draft row.
2. Publish runs the full publish validation (labels, translations, consent,
   retention, condition references). Failures are returned as a list the
   builder shows inline.
3. In one transaction: the draft becomes an immutable version row, the form
   points at it, a new draft is cloned from it, and an audit entry is written.
4. The renderer serves the new version on the next request. No cache to
   invalidate beyond the per-process definition cache keyed by version id.

## Submission data flow

1. The browser requests `/f/<slug>`. `submissions` loads the published version
   and renders page one in the chosen locale.
2. Each page posts to `app`. Server-side, `form-model` evaluates conditions
   and validation rules against the version. Answers to hidden fields are
   discarded. Photos are written to the local staging directory under random
   names with metadata (EXIF, including GPS) stripped.
3. On the final page, in **one database transaction**, the use case stores
   the submission with its answers document and version id, one media record
   per photo with status `staged`, and the jobs: one `media.upload` per
   photo, one `email.submitter_confirmation` if the version defines one and
   the form has a submitter email field, one `email.staff_notification` per
   configured recipient group.
4. The transaction commits. The user sees the success screen. Nothing external
   has been called yet, so a provider outage never loses a submission.
5. `worker` picks jobs up. Uploads move each photo to Dropbox, mark the media
   record `stored` with its provider reference, and delete the staging copy.
   Email jobs call the provider.
6. The manager lists submissions per form and renders each answer through
   its field type's review display, using the pinned version for labels. For
   each photo it serves the staging copy if still present, otherwise a
   short-lived Dropbox link.

The staff notification links to the submission in the manager and carries
no answers or photos. Email is the least controlled channel we have.

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
- `PRIVACY_CONTACT_EMAIL` is the one configuration value shown to the
  public, in the renderer's privacy footer and consent template.

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
| Product shape | Staff-authored, versioned form definitions; modules by capability | accepted | `decisions/0009` |
| Translation suggestions | DeepL behind a `Translator` port, staff text only | accepted | `decisions/0010` |
| Submission curation | Immutable original, curated copy, DeepL Write suggestions | accepted | `decisions/0011` |
| Error tracking | Sentry with PII scrubbing | proposed | `system/observability.md` |
| Bot challenge | Cloudflare Turnstile on the final step | proposed | `system/security.md` |

## External accounts

| Account | Identity | Used for |
|---|---|---|
| Google Workspace | `effluz.com` | Admin sign-in; OAuth client lives in a Google Cloud project owned by this Workspace |
| Dropbox | Personal account `tluzcando@gmail.com` | App folder for durable media and encrypted backups |
| SMTP2GO | Effluz account, sender domain `forms.effluz.com` | Transactional email |
| InterServer | Effluz account | The VPS, United States region |
| DeepL | Effluz account, API key | Translation suggestions in the builder; DeepL Write corrections in the manager |
| GitHub | `effluz/effluz-forms` | Code, CI/CD, container registry |

Credentials for all of these live in the team password manager, never in the
repository. Each account must have at least two people able to recover it.

## Open items

None block building the builder. Still to confirm before the first production
deploy:

1. **Error tracker and bot challenge** are proposed, not decided. Both are
   adapters; the forms can be built without them.
2. **Data residency.** The VPS is in the United States. The consent text
   staff write must say so where submitters are elsewhere; the builder's
   consent guidance in `ui-ux/builder.md` covers this.
3. **Dropbox ownership.** The media account is a personal one. See ADR 0002
   for the recovery requirement that follows.

## What this architecture deliberately leaves out

Message broker, cache layer, separate worker service, multi-region, roles and
permissions beyond a single admin role, public API, embedding or iframes,
payments, form-specific code of any kind, mobile app. Each would need an ADR
explaining what changed.
