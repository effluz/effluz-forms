# ops

Everything needed to set up and run Effluz Forms on a server lives here,
as described in `specs/system/deployment.md`: the server provisioning
script (`provision.sh`), the production Compose files, and the runbooks in
`runbooks/`, one file per operator task.

Only the runbooks exist so far. The provisioning script and the Compose
files arrive with the deployment plan.

## Runbooks

- `runbooks/revoke-sessions.md`: end every admin session of someone who
  leaves or loses a device.

Runbooks are written in English, hand-wrapped at 80 columns, and never
contain real names or addresses. Use `someone@example.com` in examples.
