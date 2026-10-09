# Email

Owns: the `EmailSender` port, templates, sending domain, provider adapter.
Decision record: `decisions/0006-transactional-email-provider.md`.

## Role

Two messages exist in the first release, both sent as jobs after a submission
is committed:

| Message | To | Language | Content |
|---|---|---|---|
| Submitter confirmation | The submitter | Submitter's chosen form language | Thanks, what happens next, how to request deletion |
| Staff notification | Configured staff address or group | English | Form name, submission id, time, link to admin page |

The staff notification deliberately carries no story text and no photos.

## The `EmailSender` port

`send({ to, template, locale, data }) -> { providerMessageId }`

The adapter renders the template, calls the provider, and returns the provider
id. The job handler stores that id on the job before marking it succeeded, so a
retry after a crash can detect an already-sent message.

## Templates

- Live in `src/shared/presentation/email/`, one folder per template with an
  English and a Spanish version, each with a plain-text and an HTML body.
- Copy is sourced from the owning spec: confirmation copy from the form's UI/UX
  spec, staff notification copy from this file.
- HTML is table-based and inline-styled, uses design-system colors, and reads
  correctly with images blocked. Plain text is not generated from HTML; it is
  written.
- Rendered output is snapshot-tested per locale.

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
classes: retryable (rate limit, 5xx,
network) and permanent (invalid address, suppressed recipient). Permanent
failures mark the job `dead` immediately and record the reason.

Provider webhooks for bounces and complaints are out of scope for the first
release. Revisit if submitter follow-ups are ever added.

## Local development

A local mail catcher runs in the dev Compose stack and the `EmailSender`
adapter points at it. No real email leaves a developer machine. Tests use a
fake sender that records calls.
