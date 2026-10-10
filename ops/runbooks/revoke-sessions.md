# Revoke a person's admin sessions

## When to run it

- Someone leaves Effluz or no longer needs the admin area.
- A staff device is lost or stolen, or a session may have been exposed.

## Command

Run on the server, from `/srv/effluz-forms`. Set `OPERATOR_EMAIL` to your own
address so the audit row names who acted:

```
docker compose exec -e OPERATOR_EMAIL=you@example.com app \
  pnpm sessions:revoke someone@example.com
```

The command prints `Revoked N sessions` and exits 0. N is 0 when the person
had no active session. A missing or malformed address prints a usage line and
exits 1. Any other failure prints `revoke failed: <error class>` and exits 1;
the output never contains the address.

## What it does

- Deletes every `admin_session` row for the address, in one transaction.
  The next request carrying one of those cookies is refused and redirected
  to sign-in.
- Writes one `audit_log` row with action `sessions_revoked`, the count in
  `details`, and your `OPERATOR_EMAIL` as actor. The revoked address is not
  written to the audit log.

## What it does not do

- It does not remove the person from Google Workspace. That is the real
  offboarding step: until the account is suspended or removed there, the
  person can sign in again and get a new session. Do that first, then run
  this command.
- It does not touch Google's own sessions on their devices.

## Verify

Open a database shell and check by action and count, not by address:

```
docker compose exec db psql -U effluz -d effluz
```

```sql
select action, details->>'count' as revoked, created_at
from audit_log
where action = 'sessions_revoked'
order by created_at desc
limit 1;

select count(*) as remaining_sessions
from admin_session
where email = 'someone@example.com';
```

The first query shows a fresh row whose `revoked` matches the command's N.
`remaining_sessions` is 0. Close the shell and do not paste its output
anywhere that is not access controlled.
