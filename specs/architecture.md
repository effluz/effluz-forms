# System Architecture

Status: first pass, revised 2026-10-10 for the definitions module and the
manager's forms pages (ADRs 0016, 0021, 0022), revised 2026-10-18 for the
review module (ADRs 0028, 0029).
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
| **Manager** | Staff | `/admin/...` | `definitions` (lifecycle, settings), `review` (submissions, `/admin/plan`, `/admin/operations`) |

The manager's routes, their guards and which of them are built are listed in
`ui-ux/manager.md`, "Routes". The builder route is a placeholder page until
the builder plan lands.

## Modules

Code is organized by capability under `src/modules/`, each with the four
layers from `CLAUDE.md`. Dependencies between modules point only downward in
this table and go through each module's public application API.

| Module | Responsibility | May depend on |
|---|---|---|
| `identity` | Staff sign-in, sessions, audit log | `shared` |
| `media` | `MediaStorage` port and adapters, photo processing, media records | `shared` |
| `notifications` | Email rendering and sending ports, delivery receipts, job handlers for email; templates live in `src/shared/presentation/email/` | `shared` |
| `definitions` | Forms, drafts, versions, lifecycle, operational settings, QR codes, translation suggestions | `identity` |
| `submissions` | Public rendering of a published version, server validation, intake transaction, enqueuing jobs | `definitions`, `media`, `notifications` |
| `review` | Story page, list, export, download and delete; curation status and text edits; staff photos, readiness and the post plan; Operations and dead-job alerts | `definitions`, `submissions`, `media`, `identity`, `notifications` |

`shared/` holds the kernel: `LocalizedText`, ids, `Clock`, `UnitOfWork`,
`JobQueue`, logging, and nothing that belongs to one module.

Adding a module or an edge to this table requires an ADR.

The form model is the contract in `form-definition.md` (field type registry,
validation rules, condition evaluation, publish validation; pure domain, no
I/O). It lives in the shared kernel at `src/shared/domain/form-model/`, with
`@/shared/domain/form-model` as its entry point, and every layer of every
module may import it, `domain/` included (ADR 0022).

## Ports

The system components in the overview are all **infrastructure adapters**
behind ports owned by the application layer. Ports available from `shared/`
or a module's public API:

| Port | Responsibility | First adapter | Spec |
|---|---|---|---|
| `UnitOfWork` | Transaction boundary; lets a use case persist state and enqueue jobs atomically | Postgres | `system/database.md` |
| `MediaStorage` | Store a file, return a reference, produce a time-limited view URL, read as a stream, delete; staging adds read, prefix delete and prefix listing | Local disk (staging), Dropbox (durable) | `system/media-storage.md` |
| `JobQueue` | Enqueue typed jobs with retry and scheduling semantics | Postgres outbox table | `system/jobs.md` |
| `JobAdmin` | List dead jobs, retry, discard, and read the worker heartbeat. Shared | Postgres (`job`, `worker_heartbeat`) | `system/jobs.md` |
| `AlertSource` | The data a dead-job alert email needs, looked up at run time from a job type. Owned by `notifications`, implemented by `review` | Postgres (`review`) | `system/email.md` |
| `ReviewQueries` | The read model of ADR 0028: list, plan and export in one query each. Owned by `review` | Postgres (`PgReviewQueries`) | `decisions/0028` |
| `ZipWriter` | Write a stored (uncompressed) ZIP stream of a story's files. Owned by `review` | Stored ZIP writer (`zlib.crc32`) | `system/media-storage.md` |
| `EmailSender` | Send one rendered transactional message | SMTP2GO (Mailpit locally) | `system/email.md` |
| `EmailRenderer` | Render the two messages from their data; the implementation is the template module in `src/shared/presentation/email` | Templates, wired at the composition root | `system/email.md` |
| `MessageSource` | The data an email job needs, looked up at run time from a submission id. Owned by `notifications`, implemented by `submissions` | Postgres (`submissions`) | `system/email.md` |
| `AdminIdentity` | Start a staff sign-in and complete it into verified claims or a refusal reason; the admission policy is identity's own domain rule | Google OpenID Connect | `system/security.md` |
| `AuditLog` | Append one entry to the audit log inside the current unit of work. Owned by `identity`, which exports it and the audit action list for other modules | Postgres (`audit_log`, append-only by trigger) | `system/security.md` |
| `AuditLogReader` | List audit entries for a target, newest first and capped, paged by the composite cursor `(created_at, id)` (`before` plus `beforeId`), plus the distinct actors for a filter menu. Owned by `identity`, which exports it for other modules' activity views | Postgres (`audit_log`) | `system/security.md` |
| `SubmissionStats` | Read-only submission figures `definitions` needs: totals and last received time per form, submissions since a time, submissions older than a retention age, answers per field key, whether any exist. Owned by `definitions` | Postgres, supplied by `submissions` (`PgSubmissionStats`) | `ui-ux/manager.md` |
| `Clock`, `IdGenerator`, `Logger` | Determinism in tests; structured logging with defensive redaction | System clock, random UUIDs, pino | `system/observability.md` (`Logger`) |
| `FieldTypeRegistry` | Look up a field type's validator, normalizer, exporter | In-code registry in `shared/domain/form-model` | `form-definition.md` |
| `Translator` | Suggest a translation of staff-authored text; available to `definitions` only | DeepL API | `decisions/0010` |
| `TextCorrector` | Suggest spelling and grammar corrections for one text answer; available to `review` only; deferred, nothing calls it yet | DeepL Write | `decisions/0011` |

Repositories belong to the module that owns the aggregate (`definitions` owns
forms and versions, `submissions` owns submissions) and are defined as ports
in that module's `application/` with adapters in its `infrastructure/`.
`submissions` also owns `submission_in_progress`. `definitions` exports read
use cases for the renderer (`resolvePublicForm`, `loadVersion`, `loadForm`)
and `allocateReference`, so `submissions` never reads or writes `definitions`
tables.

`identity` keeps three ports to itself: `AdminIdentity`, `SessionRepository`
(rows in `admin_session`) and `SignInAttemptStore` (single-use rows in
`sign_in_attempt`). Only its use cases call them. Their types are exported
from the module's public API solely so the composition root can assemble
`IdentityDeps`; no other module depends on them.

**Where the framework is allowed.** Next.js and React appear only in
`presentation/` folders, in the composition root under `src/app/`, and in
`src/proxy.ts`. The proxy is the one framework entry point outside `src/app/`
because Next requires that file at the `src` root; the same rules apply to it
as to `src/app/`. ESLint admits exactly that file (and its test) through the
`root-entry` file category, and any other file outside a layer still fails
the boundaries check. The composition root may also import the shared domain,
to wire registries such as `buildDefaultRegistry()`. Route handlers and server
actions are thin: parse input, call a use case, map the result to a response.
Server actions live only in `src/app/**/actions.ts`: the Settings tab's save and
the renderer's page form (`src/app/f/[slug]/actions.ts`), which, like the
Settings save, always ends in a redirect (303); a refused page post carries its
refused files to the page in the short-lived cookie `effluz_fill_state`. The
renderer's early upload (`POST /f/<slug>/files`), file removal
(`DELETE /f/<slug>/files/<id>`), blur checks (`POST /f/<slug>/check`) and
restart (`/f/<slug>/restart`) are route handlers beside it. A use
case must be callable from a test, from the worker, and from a route handler
without change. No React or Next.js import may appear in `domain/`,
`application/`, or `infrastructure/`.

Each surface has its own root layout (`src/app/admin/layout.tsx`,
`src/app/(home)/layout.tsx`, `src/app/f/[slug]/layout.tsx`), so the public
page's `<html lang>` follows the submitter; `src/app/global-not-found.tsx`
(enabled by `experimental.globalNotFound`) answers paths outside the three.

## Publishing data flow

1. Staff edit the draft in the builder. The builder sends typed commands
   with the draft revision it last saw; each batch is applied to the stored
   document, validated structurally by the form model and written to the
   draft row with the revision advanced, or refused as stale.
2. Publish runs the full publish validation (labels, translations, consent,
   retention, condition references). Failures are returned as a list the
   builder shows inline.
3. In one transaction, with the form and draft rows locked: the draft becomes
   an immutable version row, the form points at it, the draft row stays as the
   base of the next edits (its revision advances), and an audit entry is
   written.
4. The renderer serves the new version on the next request. No cache to
   invalidate beyond the per-process definition cache keyed by version id.

## Submission data flow

1. The browser requests `/f/<slug>`. `submissions` loads the published version
   and renders page one in the chosen locale.
2. Each page posts to `app`. Server-side, the form model evaluates conditions
   and validation rules against the version. Answers to hidden fields are
   discarded. Files arrive early with script (`POST /f/<slug>/files`, one
   request per file, while the visitor fills in the page) or with the page
   post without script. Photos are re-encoded with metadata (EXIF, including
   GPS) stripped; videos are stored as received after a container check. Both
   are written to the local staging directory under
   `in-progress/<record id>/<file id>.<ext>`.
3. On the final page, in **one database transaction**, the use case stores
   the submission with its answers document and version id, one media record
   per file (photo or video) with status `staged`, deletes the in-progress
   record, and enqueues the jobs: one `media.upload` per file, one
   `email.submitter_confirmation` if the version defines one and the form has
   a submitter email field, one `email.staff_notification` per submission,
   sent as one message to the form's recipient list as it stands when the job
   runs.
4. The transaction commits. The user sees the success screen. Nothing external
   has been called yet, so a provider outage never loses a submission.
5. `worker` picks jobs up. Uploads move each file to durable storage (Dropbox
   in production, local disk elsewhere), mark the media record `stored` with
   its provider reference, and delete the staging copy. Email jobs call the
   provider.
6. The manager lists submissions per form and renders each answer through
   its field type's review display, using the pinned version for labels. For
   each photo it serves the staging copy if still present, otherwise a
   short-lived Dropbox link.

The staff notification links to the story page in the manager and carries no
answers or photos. Email is the least controlled channel we have.

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
- `ALERT_EMAIL` is the one address dead-job alerts go to (ADR 0029).
- `PUBLIC_BASE_URL` is the public origin (no path); public links and QR codes
  are built on it. `NOTIFICATION_ALLOWED_DOMAINS` is an optional,
  comma-separated list of partner domains that form notification recipients
  may use besides the Workspace domain `GOOGLE_ALLOWED_HOSTED_DOMAIN`, which
  is always allowed.

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
| Postgres access | `pg` (node-postgres) with hand-written SQL and plain `.sql` migrations; no ORM | accepted | `decisions/0017` |
| OpenID Connect client | `openid-client` v6 behind the `AdminIdentity` port; sessions and sign-in attempts in our own tables | accepted | `decisions/0018` |
| Logging | `pino` behind the `Logger` port, JSON to stdout with redaction | accepted | `decisions/0019` |
| QR codes | `qrcode` library, rendered locally in `definitions` infrastructure | accepted | `decisions/0021` |
| Image processing | sharp, with libheif-js for HEIC; file-type for content sniffing | accepted | `decisions/0023` |
| Browser end-to-end tests | Playwright, Chromium only | accepted | `decisions/0024` |
| Error tracking | Sentry with PII scrubbing | proposed | `system/observability.md` |
| Bot challenge | Cloudflare Turnstile on the final step | proposed | `system/security.md` |

## External accounts

| Account | Identity | Used for |
|---|---|---|
| Google Workspace | `effluz.com` | Admin sign-in; OAuth client lives in a Google Cloud project owned by this Workspace |
| Dropbox | The Effluz Dropbox account (identity in `private/`, outside version control) | App folder for durable media and encrypted backups |
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
