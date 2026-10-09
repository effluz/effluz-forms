# 0006. Transactional email through SMTP2GO

Status: accepted
Date: 2026-10-08

## Context

Two messages per submission: a confirmation to the submitter and a
notification to staff. Volume is low. Self-hosted SMTP was rejected on
deliverability grounds. Candidates were SMTP2GO, Resend, Postmark, Amazon
SES and Brevo. Effluz chose SMTP2GO.

## Decision

Send through SMTP2GO behind the `EmailSender` port, using its HTTP API with a
send-only key, from `forms.effluz.com` with SPF, DKIM and DMARC configured
before the first production send.

## Consequences

- One external account and API key to manage and rotate.
- The HTTP API returns message ids and structured errors, which the job
  handler needs for idempotency and for separating retryable from permanent
  failures.
- Provider swap is a new adapter; templates and jobs are unaffected.
- Bounce and complaint webhooks are out of scope until follow-up emails are
  ever introduced.
