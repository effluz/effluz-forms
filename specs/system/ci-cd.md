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
| `integration` | Infrastructure adapters against a Postgres 17 service container (identity's Google adapter runs against a local fake OIDC issuer), plus the local disk media adapter, a fake Dropbox (`tests/fakes/dropbox-api.ts`), and HTTP stubs for SMTP2GO and Mailpit | Postgres service |
| `e2e` | Builds the app, then publishes and submits the reference form over HTTP without script; covers an invalid page, a refused file, a closed form, the honeypot, a repeated Submit and the renderer budgets; then reviews the submission as staff without script (story page, correction, staff photos, photo choice, checks, plan, publishing, ZIP and CSV export, delete) with its failure paths and the dead-job warning, Try again and Operations | Postgres service |
| `e2e-browser` | Builds the app and completes the reference form in Chromium on a phone viewport with script enabled (ADR 0024) | Postgres service |
| `build` | Builds the production image to prove it builds; not pushed on PRs | nothing |

Jobs run in parallel where the table says they need nothing. The whole
workflow is expected to finish in under ten minutes; longer than that is a
bug to fix, not a wait to accept.

Dependency caches are keyed on the lockfile. Test reports and e2e traces are
uploaded as artifacts on failure only.

As built (`.github/workflows/ci.yml`):

- `integration` starts `postgres:17` as a service with a health check and sets
  `TEST_DATABASE_ADMIN_URL` to it. `pnpm test:integration` then creates and
  drops its own throwaway database (`database.md`, "Local development") and
  writes a junit report to `reports/integration.xml`, uploaded as the
  `integration-report` artifact when the job fails. `unit` does the same with
  `reports/unit.xml`.
- `build` runs the Next.js production build, `pnpm build`. Building the image
  joins it with the deployment plan.
- `e2e` builds the app, starts it with `next start` on port 3199 against a
  throwaway database and temporary media directories, and drives the reference
  form over HTTP exactly as a browser without script does, plus the budgets of
  `ui-ux/renderer.md`. It then reviews the stored submission over HTTP as
  staff without script (`tests/e2e/review.test.ts`, `operations.test.ts`):
  the story page, a correction, staff photos, the photo choice, the checks,
  the plan, publishing, the ZIP and CSV downloads and delete, the refusals
  (unconfirmed sender, over-long correction, a taken day, an unknown story,
  no session, a stale token) and dead jobs (the list flag, the story warning
  with Try again, Operations). Staff reach the manager through an
  `admin_session` row the suite inserts (`tests/support/admin-session.ts`),
  as a completed sign-in would; no worker runs, so dead jobs are inserted. It
  writes `reports/e2e.xml`, uploaded as the
  `e2e-report` artifact when the job fails. The throwaway database lives in a
  holder process (`tests/support/database-holder.ts`) that drops it when the
  run ends, however it ends, so an interrupted local run leaves none behind.
- `e2e-browser` installs Chromium with `playwright install --with-deps
  chromium`, builds the app and completes the reference form on a phone
  viewport with script enabled (ADR 0024), plus a small bilingual form for the
  language switch. The browser download is cached under
  `~/.cache/ms-playwright`, keyed on the lockfile. The run starts the app as
  `e2e` does, on port 3299, writes `reports/e2e-browser.xml`, and uploads it
  with Playwright's traces in `test-results/` as the `e2e-browser-report`
  artifact when the job fails. On CI a stray `test.only` fails the run
  (`forbidOnly`); Vitest refuses `.only` on CI by default.
- A final job named `ci` waits for all the others and fails unless each one
  succeeded. It is the single status check branch protection requires.

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
