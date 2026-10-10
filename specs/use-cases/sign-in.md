# Use case: Staff sign-in

Module: `identity`. Surface: manager. System spec: `system/security.md`.

## Actors

- **Staff member**: anyone with a Google Workspace account on `effluz.com`.
- **Google**: the OpenID Connect identity provider.

## Trigger

A staff member opens any `/admin` path without a valid session.

## Main flow

1. The app stores the requested path and redirects to Google with a fresh
   state and nonce.
2. The staff member authenticates with Google, including whatever second
   factor the Workspace enforces.
3. Google redirects back with a code. The app exchanges it, verifies the ID
   token signature, issuer, audience, expiry and nonce.
4. The app checks `email_verified` is true and the hosted-domain claim equals
   the configured domain, `effluz.com`.
   The `hd` request parameter only steers Google's account chooser; this
   check on the verified claims is what admits or refuses.
5. A session row is created with the identity's email and name, idle timeout
   8 hours, absolute lifetime 7 days. An opaque cookie is set as specified in
   `system/security.md`.
6. An audit entry `sign_in` is written.
7. The staff member lands on the originally requested path, or the form list.

## Alternate flows and errors

- **Wrong domain or unverified email.** No session. A neutral page says this
  account cannot access the admin area and offers "Try another account",
  which restarts sign-in with Google's account chooser
  (`prompt=select_account`). An audit entry `sign_in_rejected` records the
  attempted domain, not the address.
- **State or nonce mismatch, expired code.** Restart the flow once
  automatically, landing on `/admin` afterwards; on a second failure show an
  error page. The mechanism is in `system/security.md`, "Admin
  authentication".
- **Google unavailable.** Error page with a retry. No partial session.
- **Idle timeout reached.** Next request redirects to sign-in and returns to
  the same path afterwards. Unsaved builder changes are the builder's
  problem to protect against; see `ui-ux/builder.md` autosave.
- **Sign-out.** Session row deleted, cookie cleared, audit entry `sign_out`,
  redirect to a signed-out page. Does not sign the user out of Google.

## Rules

- One role. Every admitted identity may do everything the manager offers.
- Sessions are revocable server-side. A runbook step deletes all sessions for
  an email when someone leaves: `pnpm sessions:revoke <address>`, described in
  `ops/runbooks/revoke-sessions.md`.
- Session cookie is never readable by scripts and never sent to public form
  routes.
- No local account, password or invitation flow exists.

## Audit entries

`sign_in`, `sign_in_rejected`, `sign_out`, `session_expired` (written lazily
on the next request that finds an expired session, or a sign-out that does),
`sessions_revoked` (written by the revocation command, not by a request: the
operator is the actor, the details hold only the number of sessions removed,
and the revoked address is never recorded).

Details never carry an address. The full field list and rules are in
`system/security.md`, "Audit log".

## Success criteria

- A Workspace account reaches the form list in one round trip to Google.
- A personal Gmail account never obtains a session, verified by an
  integration test with a forged hosted-domain claim and a valid signature.
- A revoked session is refused on its very next request.
