# 0005. Admin sign-in with Google, restricted to the Effluz Workspace domain

Status: accepted
Date: 2026-10-08

## Context

Staff need an admin page to review submissions and photos. Options were a
Google allowlist of specific accounts, any account on the Effluz Google
Workspace domain, or a local user and password store.

## Decision

OpenID Connect with Google. Only identities whose hosted-domain claim is
`effluz.com` are admitted. A single admin role.
Sessions are server-side in PostgreSQL.

## Consequences

- No passwords to store or reset. Offboarding is handled in Workspace.
- Everyone in the company is an admin. Acceptable now; roles would be a new
  ADR and a permission table.
- Requires a Google Cloud OAuth client owned by the `effluz.com` Workspace.
- An audit log is required to know who viewed what, since access is broad.
