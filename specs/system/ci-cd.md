# CI/CD

Owns: GitHub Actions workflows, branch protection, image registry.
Decision record: `decisions/0007-github-actions-ghcr.md`.

## Branch protection on `main`

- Pull request required, direct pushes blocked.
- `ci` status check required and up to date with `main`.
- Linear history, squash or rebase merges only.
- One approving review required when more than one developer is active;
  until then the author may merge after `ci` is green, as `CLAUDE.md` allows
  when explicitly stated here.

## Workflow: `ci`

Runs on every pull request and every push to `main`.

| Job | What it does | Needs |
|---|---|---|
| `lint` | Formatting and lint rules | nothing |
| `typecheck` | Static types | nothing |
| `unit` | Domain and application tests, no I/O; includes the field type conformance suite | nothing |
| `integration` | Infrastructure adapters against a Postgres service container, the local disk media adapter, a fake email provider | Postgres service |
| `e2e` | Build, publish, submit and review a form in a browser against the built app; invalid submission and closed form paths | Postgres service |
| `build` | Builds the production image to prove it builds; not pushed on PRs | nothing |

Jobs run in parallel where the table says they need nothing. The whole
workflow is expected to finish in under ten minutes; longer than that is a
bug to fix, not a wait to accept.

Dependency caches are keyed on the lockfile. Test reports and e2e traces are
uploaded as artifacts on failure only.

## Workflow: `deploy`

Runs on push to `main` after `ci` succeeds, under the `production` GitHub
Environment, with a concurrency group so deploys never overlap.

1. Build and push the image to GitHub Container Registry, tagged `<sha>` and
   `latest`, provenance attestation on.
2. Execute the release procedure in `system/deployment.md` over SSH.
3. Post the outcome as a commit status and, on failure, open an issue
   labelled `deploy-failed` with the log link.

Secrets held in the `production` environment: SSH host, SSH user, SSH private
key, and nothing else. Application secrets live on the server.

## Workflow: `maintenance`

Weekly schedule:

- Dependency update PRs through the platform's automated updater.
- Rebuild the image on the latest base image and run `ci` against it, so base
  image security fixes are picked up without a code change.

## Rules

- Workflow files live in `.github/workflows/` and are reviewed like code.
- Third-party actions pinned to a commit SHA, not a tag.
- No workflow echoes environment variables or secrets.
- A red `main` is the top priority for whoever caused it. Revert first, fix
  second.
