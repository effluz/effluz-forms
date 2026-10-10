# 0018. Identity implementation: openid-client and server-side state

Status: accepted
Date: 2026-10-10

## Context

ADR 0005 chose Google sign-in restricted to the Effluz Workspace domain and
server-side sessions. It left the mechanics open: which OpenID Connect
library, where an in-flight sign-in lives, how sessions are referenced, and
where the domain restriction is enforced. This ADR implements 0005 and does
not supersede it.

## Decision

- **Library.** `openid-client` v6 with its functional API. Auth.js was
  rejected: it owns sessions and storage, which we want in our own Postgres
  tables behind our own ports. A hand-rolled flow was rejected: PKCE, state,
  nonce and token validation are easy to get subtly wrong. `openid-client`
  does not verify the signature of an ID token received from the token
  endpoint by default, so the adapter enables its non-repudiation checks
  (`enableNonRepudiationChecks`), which verify it against the issuer's JWKS.
- **Flow.** Authorization code with PKCE (S256), `state` and `nonce`.
- **Attempts.** An in-flight sign-in is stored server-side in
  `sign_in_attempt`, keyed by an opaque cookie. It is single-use and expires
  after ten minutes.
- **Sessions.** Server-side rows in `admin_session`, referenced by an opaque
  cookie. No claims or tokens are kept in the cookie.
- **CSRF.** Each session has a token compared on every state-changing request.
- **Domain restriction.** The `hd` authorization parameter is a hint for the
  Google account chooser only. Admission is decided from the verified claims
  (`email_verified` and the hosted-domain claim) by the domain policy, never
  by what was requested.
- **Audit.** `audit_log` rows are append-only, enforced by a database trigger.

## Consequences

- The adapter sits behind the `AdminIdentity` port, so the application layer
  never sees `openid-client` or Google specifics, and tests use a local fake
  issuer instead of Google.
- Only `openid-client` is a new runtime dependency; `jose` is test-only.
- Refusals carry only a reason code. Claims, tokens and addresses are never
  logged.
- Changing identity provider means a new adapter, no application change.
