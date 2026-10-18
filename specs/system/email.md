# Email

Owns: the `EmailSender` port, templates, sending domain, provider adapter.
Decision record: `decisions/0006-transactional-email-provider.md`.

## Role

These messages exist in the first release. The first three are sent as jobs
after a submission is committed; the job alert is sent as a job when a job goes
dead (`use-cases/operate-jobs.md`, "Alerts"):

| Message | To | Language | Content |
|---|---|---|---|
| Submitter confirmation | The field marked as submitter address, if the form has one and the version defines a confirmation email | Submitter's locale | Staff-authored subject and body from the version, inside a fixed template that adds how to request deletion |
| Staff notification | Recipients in the form's settings, when cadence is per submission | English | Form name, reference, time, link to the manager |
| Job alert | `ALERT_EMAIL` | English | Job type, count, story references, link to Operations, no content |
| Staff daily digest | Recipients in the form's settings, when cadence is daily | English | Form name, count of new submissions since the last digest, list of references with links. Not sent when the count is zero |

The staff notification deliberately carries no story text and no photos.

## Ports

`EmailRenderer.submitterConfirmation(data)`,
`EmailRenderer.staffNotification(data)` and `EmailRenderer.jobAlert(data)`
return `{ subject, text, html }`.
The implementation is the template module in
`src/shared/presentation/email/`, wired at the composition root, since
infrastructure may not import presentation.

`EmailSender.send({ to, subject, text, html }) -> { providerMessageId }`
sends one message from `EMAIL_FROM` with `Reply-To: EMAIL_REPLY_TO`.
`EMAIL_FROM` defaults to `Effluz Forms <forms@forms.effluz.com>`.
`EMAIL_REPLY_TO` is optional and falls back to `PRIVACY_CONTACT_EMAIL`. A
failure is an `EmailSendError` marked retryable or permanent.

The job handler looks the data up at run time, renders, sends, and records
the provider id in the `email_delivery` table (owned by `notifications`)
under the key `<job type>:<submission id>` (`email.job_alert:<job id>` for a
job alert) before the job succeeds. A retry
that finds the key sends nothing. A submission that no longer exists, or no
longer has an address, ends the job without sending. The data comes through
the `MessageSource` port, owned by `notifications` and implemented by
`submissions`, which returns what an email needs from a submission id. The
job alert gets its data through the `AlertSource` port, also owned by
`notifications` and implemented by `review`: `AlertSource.jobAlert(jobType)`
returns the count of dead jobs of that type and the story references among
them (`decisions/0029`).

## Templates

- Live in `src/shared/presentation/email/`: `copy.ts` (the fixed parts),
  `layout.ts` (the shared document), and one module per template,
  `confirmation.ts` and `staff-notification.ts`. Each template renders English
  and Spanish (the staff notification is English only), each with a plain-text
  and an HTML body.
- The fixed parts of both templates are specified in `ui-ux/renderer.md`
  (confirmation) and this file (notification). The variable parts of the
  confirmation come from the published version and are escaped and
  sanitized like all staff-authored text.
- HTML is table-based and inline-styled, uses design-system colors, and reads
  correctly with images blocked. Plain text is not generated from HTML; it is
  written.
- Rendered output is snapshot-tested per locale.

### Staff notification, fixed parts

English only. `{date}` is the received time in the form's time zone,
followed by UTC. `{link}` is the story page in the manager.

| Part | English |
|---|---|
| Subject | New submission to {form title}: {ref} |
| Preheader | {form title} received submission {ref} |
| Intro | {form title} received a new submission. |
| Reference | Reference: {ref} |
| Received | Received: {date} |
| Link | Open it in the manager: {link} |
| Footer | This email carries no answers or files. Sign in to the manager to see them. |

### Job alert, fixed parts

English only. `{link}` is the Operations page in the manager.

| Part | English |
|---|---|
| Subject | Jobs need attention: {job type} ({count}) |
| Preheader | {count} {job type} jobs stopped retrying |
| Intro | {count} background jobs of type {job type} stopped retrying and need attention. |
| References | Stories affected: {refs} |
| More | and {n} more |
| Link | Open Operations in the manager: {link} |
| Footer | This email carries no answers or files. Sign in to the manager to see them. |

The References line is left out when no story is affected; More follows the
references when there are more than 20.

## Sending domain

- Send from `forms.effluz.com`, a dedicated subdomain, so a reputation
  problem never affects company mail at `effluz.com`.
- SPF, DKIM and DMARC (`p=quarantine` at minimum) configured before the first
  production send. Verified as part of the deployment checklist.
- `Reply-To` is a monitored Effluz address. Submitters will reply.

## Provider

SMTP2GO, through its HTTP API rather than SMTP relay, so the adapter gets a
message id and a structured error back instead of parsing SMTP responses. The
API key is scoped to sending only. The adapter maps provider errors into two
classes: retryable (network, any
non-2xx answer except 400) and permanent (invalid address, suppressed
recipient). Permanent failures mark the job `dead` immediately and record the
reason.

The adapter posts to `SMTP2GO_API_URL` (default `https://api.smtp2go.com/v3`)
`/email/send`. Retryable: network errors (including a request that takes longer
than 30 seconds) and every non-2xx answer except 400. Permanent: a 400, or a
200 that reports the recipient failed.

Provider webhooks for bounces and complaints are out of scope for the first
release. Revisit if submitter follow-ups are ever added.

## Local development

Mailpit runs in the dev Compose stack (SMTP on 127.0.0.1:1025, web and API on
127.0.0.1:8025). `EMAIL_PROVIDER=mailpit`, the default outside production, sends
through Mailpit's HTTP API (`POST /api/v1/send` at `MAILPIT_URL`), which returns
a message id like the real provider. Production refuses it and requires
`EMAIL_PROVIDER=smtp2go` with `SMTP2GO_API_KEY`. No real email leaves a
developer machine. Tests use a fake sender that records calls.
