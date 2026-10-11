# Security

Owns: admin authentication, session handling, abuse protection, secrets, audit.
Decision records: `decisions/0005-google-workspace-admin-auth.md`, and
`decisions/0018-identity-implementation.md` for how it is built.

## Threat model in one paragraph

Attackers who matter: spammers filling public forms, opportunists scanning
the VPS, anyone who obtains a staff Google account or a Dropbox login, and a
staff member who, deliberately or not, authors a form that leaks or over-
collects. The assets: submitter answers, emails and photos, some of children. Impact of a leak is
reputational and human, not financial. Controls below are proportionate to
that.

## Admin authentication

The step-by-step flow is in `use-cases/sign-in.md`.

- Sign-in with Google through OpenID Connect, using `openid-client`: the
  authorization code flow with PKCE (S256), `state` and `nonce`. The request
  asks for the `openid email profile` scopes and `prompt=select_account`, so
  the account chooser always appears and someone refused for a personal account
  can pick another.
- The library validates the ID token's issuer, audience, expiry and nonce. It
  also verifies the token's signature against the issuer's published keys
  (JWKS) through `enableNonRepudiationChecks`; `openid-client` does not do that
  by default for a token received from the token endpoint. Symmetric
  algorithms are rejected. The issuer is `GOOGLE_ISSUER` (default
  `https://accounts.google.com`), and in production the configuration refuses
  one that is not `https`.
- **The `hd` parameter is a hint, not a check.** It is sent only to steer
  Google's chooser. Admission is decided afterwards, from the verified claims,
  by the identity domain policy: the email is present and `email_verified` is
  true, and the `hd` claim, compared case-insensitively, equals
  `GOOGLE_ALLOWED_HOSTED_DOMAIN` (`effluz.com` in production). A missing or
  blank `hd` claim, or a blank configured domain, never matches. Any other
  account, including personal Gmail, is rejected with a neutral message.
- The `AdminIdentity` port returns the verified claims or a refusal reason
  (`state_mismatch`, `stale`, `exchange_failed`, `invalid_token`). The
  application layer never sees Google-specific objects, and refusals carry no
  claims, tokens or addresses.
- **In-flight sign-ins are server-side.** Starting sign-in stores a
  single-use row in `sign_in_attempt` (state, nonce, PKCE verifier, the
  sanitized return path) and sets an opaque cookie that points at it:
  `effluz_signin`, `Path=/admin/auth`, `HttpOnly`, `SameSite=Lax`,
  `Max-Age=600`, `Secure` in production. The callback consumes the row in one
  statement that deletes it whether or not it has expired and returns it only
  if it is still live, so an attempt cannot be replayed. The row expires ten
  minutes after it was created.
- **A stale code or nonce restarts the flow once.** A missing or expired
  attempt, a `state` mismatch, an authorization code that is expired or already
  used, and a `nonce` that does not match are all treated as stale. The
  callback redirects to sign-in with `retried=1`, which sets a second cookie,
  `effluz_signin_retry` (same attributes and path). If the callback fails the
  same way while that cookie is present, the person gets the error page. A
  normal start clears the cookie. The automatic restart returns to `/admin`,
  not to the path first requested. Every other failure (consent denied, token
  endpoint failure, invalid token, Google unreachable) goes straight to the
  error page, and the callback clears both cookies on every final outcome.
- The return path is accepted only if it is `/admin` or starts with `/admin/`
  or `/admin?`, and is not under the auth routes (`/admin/auth` itself, or a
  path starting with `/admin/auth/`, `/admin/auth?` or `/admin/auth#`).
  Anything else, including `//`, backslashes, control characters, `://`,
  encoded dots or slashes, and `..` segments, becomes `/admin`.
- One role: admin. Everyone who passes is an admin. Roles are an ADR away if
  ever needed.
- Removing someone's access means removing them from the Workspace. There is
  no local user table to drift from it. Their existing sessions end with the
  revocation command described under "Sessions".

## Sessions

- Server-side session stored in Postgres (`admin_session`), referenced by an
  opaque cookie whose value is the random session id. Nothing else is in the
  cookie. Its name is `SESSION_COOKIE_NAME` (default `effluz_admin_session`).
- Cookie attributes: `Path=/admin; HttpOnly; SameSite=Lax; Max-Age=604800`
  (seven days), plus `Secure` when `NODE_ENV` is `production`. The path means
  the browser never sends it to public form routes.
- Idle timeout of 8 hours, measured from `last_seen_at`, which a request
  refreshes at most once a minute. Absolute lifetime of 7 days from creation.
  A timestamp exactly on a limit is still valid, and when both limits have
  passed the absolute one is reported. Expiry is enforced lazily: the first
  request that finds an expired session deletes it and writes a
  `session_expired` audit entry. A session that expires without a further
  request, and a sign-in attempt past its ten minutes, is removed by the
  daily `identity.cleanup` job without an audit entry (see `jobs.md`).
- Rotation on sign-in: every sign-in creates a new session with a new id and a
  new CSRF token. No earlier session id is reused. If the callback request
  carries a session cookie, that session is deleted in the same transaction
  that creates the new one, without an audit entry of its own, so signing in
  again replaces the browser's session instead of leaving it behind.
- A session or attempt cookie whose value is not a UUID names no row: it is
  treated exactly like an unknown id, never as a database error.
- **Gate.** Every `/admin` path outside `/admin/auth` is gated at the HTTP
  level by the Next proxy, `src/proxy.ts`. With no active session it answers
  a real `302` to `/admin/auth/signin?returnTo=<path>`, dropping Next's `_rsc`
  query parameter. If the session cannot be checked (the database is down) it
  redirects to the error page and never lets the request through. Redirects
  are built on `PUBLIC_BASE_URL`; only when the configuration itself is
  invalid does the error redirect fall back to the request's own URL. The gated
  layout under `src/app/admin/(gated)/` checks the session again as defence in
  depth; a redirect from the layout cannot change the HTTP status under
  partial prerendering, which is why the proxy exists.
- **CSRF.** Each session has a random token issued at sign-in and stored with
  it. Every state-changing admin form embeds it in a hidden `csrf` field, and
  the server compares it with the session's token in constant time. A mismatch
  answers `403` and leaves the session alone. The settings server action
  instead refuses a mismatched token with a redirect to the tab and an
  out-of-date banner rather than a `403`. Today the only such form is
  sign-out; every later state-changing admin route follows the same rule.
- Sign-out destroys the server record, not just the cookie. A sign-out POST
  that arrives without the session cookie changes nothing, writes no audit
  entry and sets no cookie, so a cross-site post cannot clear someone's cookie
  without the token. Signing out an unknown or expired session also ends in
  the signed-out page with the cookie cleared; an expired one is deleted and
  audited as `session_expired`.
- **Revocation.** `pnpm sessions:revoke <address>` deletes every session of
  an address and audits `sessions_revoked`. The procedure, including what it
  does not do, is `ops/runbooks/revoke-sessions.md`.

## Public form abuse protection

Layered, cheapest first:

1. **Proxy rate limit** per IP on form submission routes.
2. **Honeypot field** hidden from humans; a filled honeypot is a silent accept
   that stores nothing.
3. **Minimum time-to-submit** measured from form render; faster than a human
   is a silent accept.
4. **Bot challenge** (Cloudflare Turnstile, proposed) only on the final step
   and only when the form's settings enable it. It costs accessibility and
   must never be the first line.
5. **Upload limits** enforced at the proxy (body size) and the app (count,
   type by content, decode success).

Silent accepts return the normal success screen. Telling a bot it was caught
teaches it.

## Staff-authored content

Everything staff type into the builder reaches the public renderer, so it is
untrusted input:

- Escaped on every render. The restricted rich-text subset allowed by
  `form-definition.md` is sanitized server-side with an allowlist; links
  must be `https` and open with `rel="noopener"`.
- Slugs are lowercase letters, digits and hyphens, 3 to 64 characters,
  unique, and never reused after a form is archived.
- Option keys and field keys are generated by the system, never typed.
- The builder cannot exceed system maximums. Current values, changed only
  by PR:

  | Limit | Value |
  |---|---|
  | Pages per form | 20 |
  | Input fields per page | 15 (builder warns at 7) |
  | Options per choice field | 50 |
  | Text answer length | 5,000 characters; `long_text` 20,000 |
  | Files per upload field | 10 |
  | File size | 10 MB per image, 10 MB per video, 100 MB per submission |
  | Retention | 1 to 36 months |

## Transport and headers

- TLS everywhere, HTTP redirected, HSTS enabled after the first week.
- Content-Security-Policy with no inline scripts, `frame-ancestors 'none'`,
  `Referrer-Policy: no-referrer` on admin pages so Dropbox temporary links
  never leak through referrers.
- Admin routes are not linked from public pages and are excluded from search
  indexing.

## Secrets

- Environment variables only, as described in `architecture.md`.
- Rotation procedure documented in `deployment.md` for: database password,
  Dropbox refresh token, email provider key, Google client secret, backup
  encryption key. Sessions are opaque server-side ids, so there is no session
  signing key to rotate.
- A leaked secret is rotated first and investigated second.

## Audit log

An `audit_log` table records every staff action named in the Audit entries
section of each use case under `specs/use-cases/`: sign-in and rejection,
form lifecycle and settings, draft saves, submission listing, viewing,
photo viewing, media download, text edits and reverts, correction
suggestions, status changes, export, deletion, job retry and discard. Each
row: actor email, action, target id, timestamp, IP, and an optional `details`
object. This is the only place where "who looked at a child's photo" can be
answered, so it is not optional.

- **Append-only.** A row-level database trigger (`audit_log_no_update`)
  rejects every `UPDATE` and `DELETE`; `TRUNCATE` is not covered. Kept for one
  year. No purge exists yet; when it is built it runs as a dedicated database
  role for which the trigger function makes a documented exception, and
  nothing else may delete audit rows (ADR 0020).
- **Written with the change it records.** A row joins the same unit of work as
  the state change, so both commit or neither does. A rejected sign-in has no
  state change and uses a unit of work of its own.
- **Reading.** `identity` exports an `AuditLogReader` for other modules'
  activity views: entries of one target, newest first, filterable by action,
  actor and an upper time bound, at most 200 per call, plus the distinct
  actors of a target for filter menus. It is read-only and never exposes
  the table itself.
- **Identity's actions:** `sign_in`, `sign_in_rejected`, `sign_out`,
  `session_expired` and `sessions_revoked`. Other modules register their own.
- **Details never carry an address.** Values are strings, numbers or booleans,
  and the write throws if any string contains `@`. Today's details are the
  attempted domain on `sign_in_rejected`, the expiry reason (`idle_expired` or
  `absolute_expired`) on `session_expired`, and the number of sessions on
  `sessions_revoked`. That last entry names the operator as actor when the
  command ran with `OPERATOR_EMAIL` set (otherwise the actor is empty) and
  never the person whose sessions were revoked.
- **IP** is the first value of the `X-Forwarded-For` header, so the proxy must
  set that header itself and never pass a client-supplied one through.
  `sessions_revoked` rows have no IP.

## Data sent to third parties

| Service | What leaves | When |
|---|---|---|
| DeepL (translate) | Staff-authored form text | On an editor's request in the builder |
| DeepL Write | One text answer at a time | On a curator's request in the manager |
| Dropbox | Uploaded files, encrypted database dumps | Always, by job |
| SMTP2GO | Submitter address and staff-authored confirmation copy; staff addresses and references | Always, by job |
| Google | Staff identity only | Sign-in |

Nothing else leaves. Error tracking is configured to scrub bodies.

## Dependencies and supply chain

- Lockfile committed, installs in CI are frozen to it.
- Automated dependency update PRs enabled; security updates merged within a
  week.
- GitHub secret scanning and push protection on.
- Container images pinned by digest in the Compose file, updated through PRs.

## Incident basics

If personal data may have been exposed: revoke the relevant credential, snapshot
logs, write down the timeline, and notify Effluz leadership the same day. Legal
notification duties depend on the submitters' jurisdiction and are the use-case
spec's responsibility to state.
