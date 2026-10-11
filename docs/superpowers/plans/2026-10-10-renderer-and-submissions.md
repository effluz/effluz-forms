# Renderer and Submissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The public can open a published form at `/f/<slug>`, fill it page by page on a phone with or without JavaScript, upload photos and videos, and submit it; the submission, its media rows and its jobs are stored in one transaction, and the worker uploads the media to durable storage and sends the emails.

**Architecture:** Three new modules. `media` owns the `MediaStorage` port, the image pipeline (content sniffing, re-encoding with metadata stripped), the local disk and Dropbox adapters, the `media` table and the `media.upload` and `media.delete` handlers. `notifications` owns the `EmailSender` and `EmailRenderer` ports, the SMTP2GO and Mailpit adapters, delivery receipts and the two email handlers; its templates live in `src/shared/presentation/email/` and are wired at the composition root. `submissions` owns the in-progress record, the intake transaction, the `submission` table, the real `SubmissionStats` adapter and the public renderer's presentation; it reaches forms and versions only through new read and reference-allocation use cases in `definitions`' public API. Pages are server components under `src/app/f/[slug]/`; the page form posts to one Server Action that answers a refused page directly (so a refused file's name never needs storing) and redirects every other post, and uploads, blur checks and restart are route handlers beside it, so the whole flow works without script; small client components add early uploads, blur checks (answered by the server, so the browser never ships the rules), focus handling, offline waiting and the submit states.

**Tech Stack:** Next.js 16 (App Router, Server Actions, route handlers, server components, Cache Components on), React 19, TypeScript strict, Zod 4, `pg` with hand-written SQL, Vitest, pino, and new: `sharp`, `libheif-js`, `file-type` (ADR 0023), `@playwright/test` with Chromium for the browser run (ADR 0024). Dropbox and SMTP2GO through plain `fetch`, no SDK.

**Spec:** `specs/architecture.md` ("Modules", "Ports", "Submission data flow" steps 1 to 5, "Configuration and secrets"), `specs/use-cases/fill-and-submit-form.md`, `specs/ui-ux/renderer.md` (all), `specs/form-definition.md` ("Field types in the first release", "Validation", "Conditional logic", "Submissions", "Privacy rules enforced by the model"), `specs/system/media-storage.md`, `specs/system/jobs.md`, `specs/system/email.md`, `specs/system/security.md` ("Public form abuse protection", "Staff-authored content", "Transport and headers"), `specs/system/database.md`, `specs/system/observability.md` ("Logging"), `specs/design.md`, `design-system/`, `specs/use-cases/reference-form-preemie-stories.md`, `specs/ui-ux/manager.md` ("Settings tab"), `specs/ui-ux/builder.md` (the consent row), ADRs 0002, 0003, 0006, 0008, 0016, 0022.

Decisions taken with the project owner before writing (2026-10-10): this plan covers "Submission data flow" steps 1 to 5 with the three modules above, the renderer, the intake transaction, the four job handlers, a real `SubmissionStats` adapter and the `jobs.cleanup` extension; review, Operations, Audit, `email.staff_digest`, `retention.purge`, `backup.database`, the builder and DeepL are later plans. `sharp` with `libheif-js` re-encodes images and `file-type` sniffs content (ADR 0023); Dropbox and SMTP2GO go through `fetch`; local email goes to Mailpit; the enhancement layer is React client components with a 150 KB compressed budget; the bot challenge is not built (honeypot and minimum fill time only); bundle size and page weight are tested here. Decisions taken with the project owner on 2026-10-11: the plan is written as tests and interfaces; consent text renders as plain escaped paragraphs (`form-definition.md` is the contract, Task 1 corrects `builder.md`); the browser run with script is in this plan, with Playwright and Chromium only (Task 30, ADR 0024); the `email_delivery` table stays (ADR 0025).

Decisions taken in this plan (each is repeated, with its reason, in the task that applies it):

- **Reference sequence.** `form.next_reference` (migration `0008_form_reference_counter.sql`, owned by `definitions`), advanced by the exported use case `allocateReference(deps, uow, formId)` under the `form` row lock, which also re-checks that the form is open and leaves `form.updated_at` alone. `submissions` never writes a `definitions` table. Format `<prefix>-<nnnn>` (`formatReference`), at least four digits. (Task 14, ADR 0025)
- **In-progress cookie.** Name `effluz_fill`, `Path=/f/<slug>`, `HttpOnly`, `SameSite=Lax`, `Max-Age=86400`, `Secure` in production. Its value is the record id while filling, `done.<submit token>` after a stored submission, and `decoy.<reference>` after a silent accept, so the browser's Back button lands on the confirmation. (Task 28)
- **Page form.** The page form posts to the Server Action `postPage` in `src/app/f/[slug]/actions.ts`, rendered through `useActionState` with the page's own URL as permalink: a refused post is answered with the page itself (HTTP 200 without script), every other post redirects with 303. Uploads, blur checks and restart stay route handlers. (Tasks 18, 25, 28)
- **Original filename never persisted.** A refused file's name travels only in the answer to its own post (`RefusedFile`, then the action's state); the in-progress record stores typed values and validation issues, never a file name. (Tasks 16, 19, 28)
- **Staging directory.** The existing `STAGING_DIR` variable; staged files live at `in-progress/<record id>/<file id>.<ext>` so an expired record's files go with one prefix delete. (Tasks 5, 21, 27)
- **Resolving `/f/<slug>`.** New `definitions` use cases `resolvePublicForm(deps, slug)`, `loadVersion(deps, versionId)` and `loadForm(deps, formId)`; `shareInfo` stays admin-only. (Task 14)
- **Media keys.** Durable key `forms/<form slug>/<reference>/<nn>-<field slug>.<ext>` with the field slug from the label in the form's first language (English first when bilingual), ASCII, at most 40 characters, `-2`, `-3` appended when two fields of one submission share a slug. Local refs are the key; Dropbox refs are `/` plus the key. (Tasks 5, 9, 21)
- **Minimum fill time.** 3 seconds from the page 1 render, carried in the hidden `_rendered` field of the first post, clamped to the last 24 hours, stored as `started_at`. An absent or unreadable value counts as the time of that first post. Checked at Submit. (Tasks 16, 21)
- **Honeypot.** An input named `website-url` (a hyphen, so it can never be a field key), off-screen, `aria-hidden`, `tabindex="-1"`, `autocomplete="off"`, checked on every page post: a filled one deletes the record and its staged files and answers the decoy confirmation. (Tasks 16, 21, 25)
- **Duplicate submit.** The submit token is checked before a reference is taken, and a token met at insert rolls the transaction back, so a duplicate commits nothing. (Task 21)
- **Per-submission size.** Every file staged for one record counts toward the 100 MB cap, early uploads included. (Task 20)
- **`file_upload` answers.** The answer is the list of media ids (UUIDs, which `mediaIdSchema` accepts) in upload order; a media row's id is the staged file's id, so the answer, the row and the `media.upload` job payload name the same file. (Tasks 6, 20, 21)
- **Upload authentication.** The `effluz_fill` cookie names the record; the posted field key must be a visible `file_upload` field of the record's current page; `SameSite=Lax` keeps cross-site posts from carrying the cookie. (Task 20)
- **Blur validation.** The client asks `POST /f/<slug>/check`, which runs the form model on the server, so the browser applies exactly the server's rules without shipping Zod or the RE2 engine. (Tasks 19, 26, 28)
- **Templates and the sender.** `EmailSender.send` takes a rendered message; rendering is the `EmailRenderer` port, whose implementation is the template module in `src/shared/presentation/email/`, wired at the composition root (infrastructure may not import presentation). (Tasks 11, 12, 27)
- **Email idempotency.** A `notifications`-owned `email_delivery` table keyed by `<job type>:<submission id>` stores the provider message id; a retry that finds the key sends nothing. (Tasks 11, 13, ADR 0025)
- **Local email.** Mailpit's HTTP send API at `MAILPIT_URL` (default `http://127.0.0.1:8025`), so the local adapter returns a message id like the real one. (Task 13)
- **Staff notification.** One `email.staff_notification` job per submission, sent as one message to the form's recipient list read at run time. (Tasks 11, 21)
- **Root layouts.** `src/app/layout.tsx` is replaced by one root layout per surface (`src/app/admin/layout.tsx`, `src/app/(home)/layout.tsx`, `src/app/f/[slug]/layout.tsx`) so the renderer's `<html lang>` follows the submitter's language; `src/app/global-not-found.tsx` answers paths outside them. (Task 28)
- **Consent text.** Plain text, split into paragraphs on blank lines and escaped; never parsed as markup. (Tasks 1, 3, 24)
- **Header image.** Not rendered in this plan: nothing can set one until the builder plan uploads it and adds its route. (Task 1 spec note)
- **Test-only boundary exception.** Test files may import other modules' `application/testing` fakes and `tests/fixtures` or `tests/fakes`; production code may not. (Task 2, ADR 0026)
- **E2E files.** The reference form allows at most ten files, so the e2e test first posts ten images and one video together (refused with `files_max`, nothing staged) and then nine images and the video (accepted), both after the minimum fill time. (Task 29)
- **Browser e2e.** Playwright, Chromium only, one phone project, against the built app on a throwaway database; one CI job. (Task 30, ADR 0024)

## Global Constraints

- WCAG 2.2 AA: "Accessibility baseline is **WCAG 2.2 AA**, non-negotiable, for the public renderer and the admin surfaces alike." "Every input has a programmatic label. Errors are associated with their field and announced to assistive technology." "Color contrast meets AA. Information is never conveyed by color alone." "Respect reduced-motion preferences." "File upload has an accessible alternative path and clear status." (CLAUDE.md)
- Both languages: "Every staff-authored text has an **English and a Spanish** value" and "Fixed chrome of the builder, renderer and manager has no hardcoded user-facing strings. Its copy lives in the surface's UI/UX spec and is the single source for translations." Renderer copy is bound in `src/modules/submissions/presentation/copy.ts`, email copy in `src/shared/presentation/email/copy.ts`, each with a test that compares it to the spec rows. Client components receive their strings as props, never the tables.
- Staff-authored text: "Escaped on every render. The restricted rich-text subset allowed by `form-definition.md` is sanitized server-side with an allowlist; links must be `https` and open with `rel="noopener"`." (security.md)
- Synthetic data: "Never use real submissions or real PII in tests, fixtures, seeds, logs, screenshots, examples, docs, or commit messages. Generate synthetic data." Addresses use `example.com`, IPs `203.0.113.x`. Test images are generated in code; the one HEIC fixture is a generated solid-color image.
- Payloads: "Payloads hold identifiers, never personal data. An email job carries the submission id and looks the address up at run time." (jobs.md)
- Logs: "Logs and error messages must not contain answers, email addresses, file contents, or anything that identifies a submitter. Form and submission ids are fine." File names are never logged or stored.
- Photos: "Validate type and size at the boundary, strip metadata, and store them only through the media port." "Verify type by content, not by extension or declared MIME type." "The original filename is never used." (CLAUDE.md, media-storage.md)
- Migrations: "A migration is a plain `.sql` file named `NNNN_<name>.sql`: four digits, then lowercase letters, digits and underscores." "One global sequence." The next free id is `0006`; this plan uses `0006_media.sql`, `0007_email_delivery.sql`, `0008_form_reference_counter.sql`, `0009_submissions.sql`.
- Lock discipline: "A use case opens at most one unit of work and never nests them." "Mutating use cases re-read the aggregate inside the unit of work with a row lock (`for update`) before writing, and decide again on the locked rows." The intake locks the in-progress row, then the form row (through `allocateReference`), always in that order.
- Framework boundary: "No React or Next.js import may appear in `domain/`, `application/`, or `infrastructure/`." Route handlers and Server Actions "parse input, call a use case, and map the result"; Server Actions live only in `src/app/**/actions.ts`. Module edges are `MODULE_DEPS` in `eslint.config.mjs`: `media: []`, `notifications: []`, `submissions: ["definitions", "media", "notifications"]`; test files get the exception of ADR 0026 and nothing more.
- Performance (renderer.md, as changed in Task 1): HTML for a page, compressed, "under 30 KB"; script for enhancement, compressed, "under 150 KB for the renderer route's client bundle, loaded `defer`"; "First page interactive on a throttled 3G profile under 3 seconds"; "Server render of a page under 200 ms at the 95th percentile".
- Layout: "Single column, maximum content width 640 px, 16 px side gutters on phones"; "Touch targets at least 44 by 44 px"; "Minimum body text 16 px to prevent mobile zoom on focus". Values come from `design-system/tokens.json` only; each CSS value names its token in a comment.
- Every page works with script disabled: "Every page is a real HTML form that submits without JavaScript."
- TypeScript strict with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`; field keys are branded `Key` values (tests build them with `asKey`); Conventional Commits scoped `docs`, `shared`, `form-model`, `media`, `notifications`, `definitions`, `submissions`, `app`, `ci`; `pnpm format:check`.
- Run at most three heavy processes (type checks, test suites, builds, the browser run) at once on the developer machine.
- How tests are written here: test listings omit their import lines (each file imports Vitest's functions and the names it uses from the paths in its task's Files and Interfaces). A case list gives each test as its quoted name, its inputs and its expected results; write one `it` per case, through the helper the list names, with exactly those names, inputs and expectations.

## Review Focus

1. A version republished while someone is on page 3 must not change what they see or what is stored: the record stays on its pinned version and the submission records that version id (Task 21 unit test "completes against the pinned version after a republish").
2. Going back and changing an answer that hides a page the submitter already filled, including an upload field with staged files, must drop those answers and delete those staged files at submit (Task 21 unit test "discards answers and files of a page hidden by a changed answer").
3. A form closed between the last page load and the Submit click must refuse the submission with the closed screen and store nothing, even when the close commits while the intake waits on the form row lock (Task 22 integration test "refuses a submission when the form closes during the intake").
4. A file whose extension or declared type lies (an HTML file named `.jpg`), a truncated JPEG, an MP4 with a broken box structure, or a body larger than the field allows must be refused with the specific message and leave nothing in staging (Task 7 adapter tests "ignores names and declared types: HTML is not an image whatever it is called" and "returns null for a truncated JPEG, bytes that do not decode as the type, and an unknown type", Task 20 unit test and Task 22 integration test, both "refuses a lying, truncated or oversized file and stages nothing").
5. A record that expired between the last page and Submit must show the expired screen, store no submission, and have its staged files removed by `jobs.cleanup` (Task 21 unit test "treats an expired record as expired at submit" and Task 27 unit test "jobs.cleanup removes an expired record and its staged files, and stores no submission", which runs the composed handler the worker registers).

---

## File structure

```
specs/...                                                   Task 1 edits, ADRs 0023 to 0026, ADR 0002 and 0008 amendments
specs/decisions/0016-field-type-hooks.md                    amended in Task 4
eslint.config.mjs                                           + the test-only exception (ADR 0026)
src/shared/application/ports/job-queue.ts                   + maxAttempts in the context, PermanentJobError
src/shared/application/testing/fakes.ts                     + InMemoryJobQueue, RecordingLogger, handlerContext
src/shared/infrastructure/jobs/worker.ts                    dead at once on PermanentJobError, maxAttempts
src/shared/infrastructure/jobs/handlers/cleanup.ts          + cleanup steps
src/shared/domain/rich-text.ts                              the restricted markdown subset
src/shared/domain/form-model/submission.ts, visibility.ts   + validatePage, visiblePages
src/shared/domain/form-model/field-type.ts                  + uploadLimits hook (file_upload implements it)
src/shared/domain/form-model/field-types/conformance-checks.ts  + the upload limits check
src/shared/presentation/RichText.tsx, rich-text-html.ts     React and HTML renderings of the subset
src/shared/presentation/testing/spec-copy.ts                + specTableRows
src/shared/presentation/email/                              copy.ts, layout.ts, confirmation.ts, staff-notification.ts, index.ts
src/modules/media/
  domain/media.ts, keys.ts, iso-bmff.ts
  application/deps.ts, job-types.ts, ports/{media-storage,content-sniffer,image-encoder,media-repository}.ts,
              stage-file.ts, attach.ts, discard.ts, jobs.ts, index.ts, testing/fakes.ts
  infrastructure/file-type-sniffer.ts, sharp-image-encoder.ts, libheif-js.d.ts, local-disk-storage.ts,
                 dropbox-storage.ts, pg-media-repository.ts, migrations/0006_media.sql
src/modules/notifications/
  application/deps.ts, ports/{email-sender,email-renderer,message-source,delivery-log}.ts,
              jobs.ts, enqueue.ts, index.ts, testing/fakes.ts
  infrastructure/smtp2go-email-sender.ts, mailpit-email-sender.ts, mailbox.ts, pg-delivery-log.ts,
                 migrations/0007_email_delivery.sql
src/modules/definitions/
  domain/reference.ts, form.ts (+ publicState)
  application/public-form.ts, ports/form-repository.ts (+ takeReferenceNumber), testing/fakes.ts, index.ts
  infrastructure/pg-form-repository.ts, migrations/0008_form_reference_counter.sql
  presentation/SettingsForm.tsx                             bot challenge note
src/modules/submissions/
  domain/in-progress.ts, navigation.ts, locale.ts, protection.ts, dates.ts, intake.ts, submission.ts,
         testing/versions.ts
  application/deps.ts, fill-state.ts, ports/{in-progress-repository,submission-repository}.ts,
              version-cache.ts, post-context.ts, view-form.ts, answers.ts, staging.ts, save-page.ts,
              check-field.ts, upload-file.ts, silent-accept.ts, submit-form.ts, expire.ts, index.ts, testing/fakes.ts
  infrastructure/migrations/0009_submissions.sql, pg-in-progress-repository.ts,
                 pg-submission-repository.ts, pg-submission-stats.ts, message-source.ts
  presentation/copy.ts, error-copy.ts, format.ts, messages.ts, decode.ts, field-views.ts, page-form-state.ts,
               cookies.ts, http.ts, csp.ts, styles.ts, renderer.module.css,
               fields/{types.ts,FieldShell.tsx,text.tsx,number.tsx,date.tsx,choice.tsx,checkbox.tsx,
                       consent.tsx,file-upload.tsx,section.tsx,index.ts},
               PublicShell.tsx, FormPage.tsx, Progress.tsx, Screens.tsx,
               client/{bus.ts,upload-queue.ts,page-state.ts,form-dom.ts,refused-files.ts,summary.ts,
                       UploadField.tsx,PageEnhancer.tsx,NavButtons.tsx,ErrorSummary.tsx}
src/app/config.ts, modules.ts, container.ts, worker.ts, worker-handlers.ts, next-config.test.ts
src/app/layout.tsx (removed) -> src/app/admin/layout.tsx, src/app/(home)/{layout,page}.tsx, src/app/global-not-found.tsx
src/app/f/[slug]/layout.tsx, page.tsx, view.ts, actions.ts, not-found.tsx, error.tsx, _lib/respond.ts,
                files/route.ts, files/[fileId]/route.ts, check/route.ts, restart/route.ts
src/proxy.ts                                                + the renderer's CSP with a nonce on /f/<slug>
next.config.ts                                              serverExternalPackages, body size limits, globalNotFound
tests/support/test-database.ts, app-server.ts               shared by integration, e2e and browser setup
tests/fakes/media-files.ts, dropbox-api.ts, http-stub.ts
tests/fixtures/media/synthetic-16x16.heic
tests/boundaries/boundaries.test.ts                         + media, notifications, submissions and test-only probes
tests/integration/{jobs,identity,media,notifications,definitions,submissions}/*.test.ts
tests/e2e/setup.ts, vitest.d.ts, http.ts, publish.ts, reference-form.test.ts, budgets.test.ts
tests/browser/global-setup.ts, reference-form.spec.ts; playwright.config.ts
vitest.e2e.config.ts, vitest.config.ts (excludes tests/e2e), package.json (test:e2e, test:e2e:browser),
.github/workflows/ci.yml (+ e2e and e2e-browser jobs)
```

---

### Task 1: Specs and ADRs first

**Files:**
- Modify: `specs/ui-ux/renderer.md`, `specs/ui-ux/builder.md`, `specs/system/security.md`, `specs/system/media-storage.md`, `specs/system/email.md`, `specs/system/jobs.md`, `specs/system/database.md`, `specs/architecture.md`, `specs/use-cases/fill-and-submit-form.md`, `specs/decisions/0002-dropbox-first-media-provider.md`, `specs/decisions/0008-nextjs-react-application.md`
- Create: `specs/decisions/0023-image-processing.md`, `0024-browser-end-to-end-tests.md`, `0025-submission-reference-counter-and-email-delivery.md`, `0026-test-only-boundary-exception.md`

**Interfaces:**
- Produces: the copy rows every later task binds (renderer chrome keys `switch_to_en`, `switch_to_es`, `wordmark`, `date_day`, `date_month`, `date_year`, `files_limits_videos`, `kinds_images`, `kinds_videos`, `kinds_mixed`, `file_row`, `removed`, `honeypot_label`, `error_summary_heading_one`, `files_count_one`; catalog rows `min length one`, `max length one`, `choice min one`, `choice max one`, `files min one`, `files max one`, `submission too large`; the email table "Staff notification, fixed parts"), and the written decisions the code follows. The manager row `set.challenge_unavailable` arrives in Task 15; the ADR 0016 amendment in Task 4.

This task changes documents only. Hand-wrap prose at 80 columns; table rows stay on one line.

- [ ] **Step 1: `specs/ui-ux/renderer.md`.**
  1. Performance targets: replace the script row with `| Script for enhancement, compressed | under 150 KB for the renderer route's client bundle, loaded \`defer\` |`, and add under the table: "The e2e suite measures the HTML of every page of the reference form and the sum of the compressed scripts the page loads, and fails above these budgets."
  2. "Validation and errors", **When.**, append: "With script, the field is checked by the server on blur (`POST /f/<slug>/check`), so the browser applies exactly the server's rules and ships none of them." **Server round trip.**, append: "A refused page post is answered directly with the page and its messages (HTTP 200); a post that goes through, and every other post, redirects (303) to `GET /f/<slug>`. A refused file's name appears only in that answer: it is never stored."
  3. "File upload", after the no-script paragraph, add: "Without script, each staged file is listed as `file_row` (the original name is not kept) with a Remove button that submits the page form with that file; the page re-renders with its answers kept. A post with more files than the field allows stages none of them and reports `files max`. With script, a chosen file larger than the field allows, or of a kind it does not take by its declared type, is refused at once without uploading; the server still checks every file by content. Every file staged for one in-progress record counts toward the per-submission size in `system/security.md`."
  4. "Closed, not yet open, not found", append: "These screens and Session expired show both languages, the page language first, since no language has been chosen. Not found has no privacy footer: without a form there is no retention period to state."
  5. "Layout", after the header image bullet, add: "First pass: no version can carry a header image until the builder uploads one, so the renderer leaves it out; it arrives with the builder plan."
  6. "Form page", after the bot challenge bullet, add: "First pass: the challenge is not built. A form with it enabled renders without it; the honeypot and the minimum fill time in `system/security.md` still apply."
  7. Add a section before "Test fixtures":

     ```markdown
     ## Routes

     | Route | What it is |
     |---|---|
     | `GET /f/<slug>` | The current screen: a form page, the confirmation, or a closed, not open, not found or expired screen (`?expired=1` asks for the expired screen) |
     | `POST /f/<slug>` | The page form, posted to a Server Action: Next, Back, Submit, a language switch or a Remove. A refused post answers with the page (200); every other post redirects (303) to `GET /f/<slug>` |
     | `POST /f/<slug>/files` | Early upload of one file with script; JSON |
     | `DELETE /f/<slug>/files/<file id>` | Removes a staged file with script; 204 |
     | `POST /f/<slug>/check` | Checks one field on blur; JSON with the message or null |
     | `GET /f/<slug>/restart` | Clears the in-progress cookie and returns to page 1 ("Start again", "Fill in another form") |
     ```
  8. Fixed chrome copy, append these rows to the table:

     ```markdown
     | switch_to_en | English | English |
     | switch_to_es | Español | Español |
     | wordmark | Effluz | Effluz |
     | date_day | Day | Día |
     | date_month | Month | Mes |
     | date_year | Year | Año |
     | files_limits_videos | Videos up to {size} each. | Videos de hasta {size} cada uno. |
     | kinds_images | JPEG, PNG, WebP or HEIC photos | fotos JPEG, PNG, WebP o HEIC |
     | kinds_videos | MP4 or MOV videos | videos MP4 o MOV |
     | kinds_mixed | JPEG, PNG, WebP or HEIC photos, or MP4 or MOV videos | fotos JPEG, PNG, WebP o HEIC, o videos MP4 o MOV |
     | file_row | File {n}, {size} | Archivo {n}, {size} |
     | removed | {file} removed | Se quitó {file} |
     | honeypot_label | Leave this field empty | Deja este campo vacío |
     | error_summary_heading_one | Please fix 1 problem before continuing | Corrige 1 problema para continuar |
     | files_count_one | {count} of 1 file | {count} de 1 archivo |
     ```

     and add below the `{contact}` sentence: "`switch_to_*` name the target language in that language. `wordmark` is the text the wordmark slot shows until `design-system/assets/` holds the SVG. `{kinds}` in the file messages is `kinds_images`, `kinds_videos` or `kinds_mixed`. `file_row` names a staged file without script. `honeypot_label` labels the hidden anti-spam field, which assistive technology never reaches."
  9. Message catalog, append the singular forms the pluralization sentence requires and the per-submission size row:

     ```markdown
     | min length one | {label} must have at least {n} character | {label} debe tener al menos {n} carácter |
     | max length one | {label} must have no more than {n} character | {label} no debe tener más de {n} carácter |
     | choice min one | Select at least {n} option for {label} | Selecciona al menos {n} opción en {label} |
     | choice max one | Select no more than {n} option for {label} | Selecciona como máximo {n} opción en {label} |
     | files min one | Upload at least {n} file for {label} | Sube al menos {n} archivo en {label} |
     | files max one | You can upload up to {n} file for {label} | Puedes subir hasta {n} archivo en {label} |
     | submission too large | {file} would take this form's files past {size} in total | {file} haría que los archivos de este formulario pasen de {size} en total |
     ```

     and change the pluralization sentence to: "Pluralization follows each language's rules: when `Intl.PluralRules` gives `one` for `{n}` (or `{count}`), the `… one` row is used, otherwise the plain row. In `submission too large`, `{size}` is the per-submission cap."
  10. "Test fixtures", append: "The script-enabled run uses a real Chromium on a phone viewport (ADR 0024); the script-disabled run talks HTTP to the built app."

- [ ] **Step 2: `specs/ui-ux/builder.md`.** In the field settings table, the Consent row's "consent text pair (markdown)" becomes "consent text pair (plain text: paragraphs separated by a blank line, no markup)". `form-definition.md` is the contract: consent text is not one of its four rich-text places.

- [ ] **Step 3: `specs/system/security.md`.**
  1. "Public form abuse protection": replace items 2 to 4 with

     ```markdown
     2. **Honeypot field** hidden from humans: an input named `website-url`
        placed off-screen, `aria-hidden="true"`, `tabindex="-1"`,
        `autocomplete="off"`. A filled honeypot on any page post is a silent
        accept: the in-progress record and its staged files are deleted and
        nothing is stored.
     3. **Minimum time-to-submit** of 3 seconds, measured from the render of
        page 1: the first post carries the render time in the hidden field
        `_rendered`, clamped to the last 24 hours and stored on the in-progress
        record as `started_at`; an absent or unreadable value counts as the time
        of that first post. Faster than that is a silent accept. A person cannot
        read and complete even a one-field form with consent in 3 seconds.
     4. **Bot challenge** (Cloudflare Turnstile, proposed) only on the final step
        and only when the form's settings enable it. It costs accessibility and
        must never be the first line. Not built yet: a form with it enabled
        renders without it.
     ```

     and add a subsection after it:

     ```markdown
     ### In-progress cookie

     The renderer's only cookie is `effluz_fill`: `Path=/f/<slug>`, `HttpOnly`,
     `SameSite=Lax`, `Max-Age=86400`, plus `Secure` in production. While a form is
     being filled its value is the random id of the in-progress record; after a
     stored submission it is `done.<submit token>` and after a silent accept
     `decoy.<reference>`, so Back after Submit shows the confirmation again. It
     carries no answers. `SameSite=Lax` keeps cross-site posts from reaching the
     record, and Next refuses a Server Action post whose `Origin` is not this
     host, which is why the public routes need no CSRF token. A value that is
     none of these shapes is treated as absent.
     ```
  2. Below the limits table, add: "The per-submission size counts every file staged on the in-progress record, early uploads included; a file that would pass it is refused with `submission too large`."
  3. "Transport and headers": "Content-Security-Policy with no inline scripts" becomes "Content-Security-Policy with no inline scripts except Next's nonce-bearing bootstrap on the renderer, allowed by a per-request nonce", and append "The renderer's pages (`/f/<slug>`, both the page and its form posts) get a per-request nonce from the proxy: `script-src 'self' 'nonce-<n>' 'strict-dynamic'` (plus `'unsafe-eval'` in development only), `style-src 'self' 'unsafe-inline'`, `img-src 'self' blob: data:`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`."

- [ ] **Step 4: `specs/system/media-storage.md`.**
  1. "The `MediaStorage` port" table: the `put` row becomes `| \`put(bytes, key, contentType)\` | Store the bytes (files are capped at 10 MB, so no stream is needed). Returns a provider reference. Idempotent for the same key: Dropbox writes with \`mode: overwrite\`. |`, and add two rows: `| \`read(ref)\` | Staging only: the bytes, for the upload job. |` and `| \`deletePrefix(prefix)\` | Staging only: remove every file under a prefix. |`.
  2. Under "Keys", add the staging scheme: "Staged files are named `in-progress/<record id>/<file id>.<ext>`: random ids only, so expiring a record removes its files with one prefix delete. Local refs are the key itself; Dropbox refs are the key with a leading `/` inside the App folder."
  3. Under "Adapters", add to each: Local disk: "`MEDIA_PROVIDER=local` (the default outside production) also uses local disk as the durable tier, rooted at `MEDIA_DURABLE_DIR` (default `./data/durable`); production refuses it." Dropbox: "`MEDIA_PROVIDER=dropbox` with `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` and `DROPBOX_REFRESH_TOKEN`. The adapter calls the HTTP API with `fetch` (no SDK): `oauth2/token` for the refresh-token exchange, `files/upload`, `files/get_metadata`, `files/delete_v2` and `files/get_temporary_link`. `DROPBOX_API_URL` and `DROPBOX_CONTENT_URL` exist so tests can point it at a local fake. A 401 renews the access token once; a 429 or 5xx fails the job so the job system retries it."
  4. "File handling rules", Images bullet, append: "JPEG, PNG and WebP are re-encoded to the same format with the EXIF orientation applied first; HEIC is decoded with `libheif-js` and encoded as JPEG (ADR 0023). Inputs above 50 megapixels are refused as unreadable." Videos bullet: "container and codec checked by content only" becomes "container checked by content (no codec inspection in the first release)", and append: "The container check walks the ISO base media file format boxes: the first box is `ftyp`, every box size fits the file, and a `moov` box is present."

- [ ] **Step 5: `specs/system/email.md`.**
  1. Replace "The `EmailSender` port" section with:

     ```markdown
     ## Ports

     `EmailRenderer.submitterConfirmation(data)` and
     `EmailRenderer.staffNotification(data)` return `{ subject, text, html }`.
     The implementation is the template module in
     `src/shared/presentation/email/`, wired at the composition root, since
     infrastructure may not import presentation.

     `EmailSender.send({ to, subject, text, html }) -> { providerMessageId }`
     sends one message from `EMAIL_FROM` with `Reply-To: EMAIL_REPLY_TO`. A
     failure is an `EmailSendError` marked retryable or permanent.

     The job handler looks the data up at run time, renders, sends, and records
     the provider id in the `email_delivery` table (owned by `notifications`)
     under the key `<job type>:<submission id>` before the job succeeds. A retry
     that finds the key sends nothing. A submission that no longer exists, or no
     longer has an address, ends the job without sending.
     ```
  2. "Templates", first bullet becomes: "Live in `src/shared/presentation/email/`: `copy.ts` (the fixed parts), `layout.ts` (the shared document), and one module per template, `confirmation.ts` and `staff-notification.ts`. Each template renders English and Spanish (the staff notification is English only), each with a plain-text and an HTML body."
  3. Add after "Templates":

     ```markdown
     ### Staff notification, fixed parts

     English only. `{date}` is the received time in the form's time zone,
     followed by UTC. `{link}` is the form's page in the manager until the
     review plan adds the submission page.

     | Part | English |
     |---|---|
     | Subject | New submission to {form title}: {ref} |
     | Preheader | {form title} received submission {ref} |
     | Intro | {form title} received a new submission. |
     | Reference | Reference: {ref} |
     | Received | Received: {date} |
     | Link | Open it in the manager: {link} |
     | Footer | This email carries no answers or files. Sign in to the manager to see them. |
     ```
  4. "Local development": replace the first sentence with "Mailpit runs in the dev Compose stack (SMTP on 127.0.0.1:1025, web and API on 127.0.0.1:8025). `EMAIL_PROVIDER=mailpit`, the default outside production, sends through Mailpit's HTTP API (`POST /api/v1/send` at `MAILPIT_URL`), which returns a message id like the real provider. Production refuses it and requires `EMAIL_PROVIDER=smtp2go` with `SMTP2GO_API_KEY`." Add under "Provider": "The adapter posts to `SMTP2GO_API_URL` (default `https://api.smtp2go.com/v3`) `/email/send`. Retryable: network errors, 401, 403, 429, 5xx. Permanent: a 400, or a 200 that reports the recipient failed."

- [ ] **Step 6: `specs/system/jobs.md`.**
  1. "The `JobQueue` port", handler paragraph: change the context list to "the job id, the attempt number, the job's `maxAttempts`, a logger already tagged with the job, and the unit of work, queue and clock ports", and replace "Only `jobs.cleanup` and `identity.cleanup` are registered so far…" with "Registered today: `jobs.cleanup`, `identity.cleanup`, `media.upload`, `media.delete`, `email.submitter_confirmation` and `email.staff_notification`."
  2. "Failure and retry", append: "A handler that throws `PermanentJobError` (from `src/shared/application/ports/job-queue.ts`) makes the job `dead` at once with its message, for failures a retry cannot fix, such as an email address the provider rejects."
  3. "Handler rules", replace the Idempotent bullet with: "**Idempotent.** A handler may run twice. Uploads `put` by key, which overwrites, and record the reference before deleting the staging copy; emails record the provider message id in the `email_delivery` table, not on the job, and skip a key already recorded."
  4. "Recurring jobs", replace "removing expired in-progress submission records (older than 24 hours) and their staged files joins it when `submissions` exists" with "it also removes in-progress submission records past their 24 hours, their staged files first, through cleanup steps the worker's composition root passes in, so `shared` never imports `submissions`".
  5. Job types table: `media.upload` effect "Staging to durable storage, media row to `stored` with its reference, staging copy deleted; on the last attempt the row becomes `failed` and staging is kept"; `media.delete` "Remove the durable file, the staging copy and the media row, in that order". Add under the table: "Payloads: `media.*` carry `{ mediaId }`, `email.*` carry `{ submissionId }`."

- [ ] **Step 7: `specs/system/database.md`.**
  1. The lock paragraph under the unit-of-work rules, after "always in that order.", add: "The submissions intake locks the `submission_in_progress` row, then the `form` row (through `allocateReference`), always in that order; taking a reference does not change `form.updated_at`, since a submission is not a form edit."
  2. Core tables: `form`: append "`next_reference` (integer, starts at 1): the sequence of submission references, advanced only by `allocateReference` under the form row lock (ADR 0025)".
  3. Replace the `submission_in_progress` row with: "`submission_in_progress` | `submissions` | `id` (the random value of the `effluz_fill` cookie), `form_id`, `form_version_id` (the pinned version), `locale`, `page_key`, `answers` (jsonb, only valid answers), `files` (jsonb, staged files per field key), `pending` (jsonb, the last refused post's typed values and issues, or null; never a file name), `submit_token` (uuid), `started_at`, `expires_at` (24 hours after creation). Personal data; deleted at submit or by `jobs.cleanup` after expiry."
  4. Replace the `submission` row with: "`submission` | `submissions` | `form_id`, `form_version_id`, `locale`, `answers` (jsonb, **immutable after insert**: the trigger `submission_answers_immutable` rejects an update that changes it), `consent` (jsonb), `received_at`, `reference` (unique per form, `submission_form_reference_key`), `submit_token` (unique, `submission_submit_token_key`, so a repeated Submit finds the first submission), `status` (`new`, `viewed`, `edited`, `published`; default `new`), `curated_answers` (jsonb, default `{}`), `published_post_url`, `status_changed_by`, `status_changed_at`".
  5. Replace the `media` row with: "`media` | `media` | `submission_id`, `form_id`, `field_key`, `position` (1-based within the field), `kind` (`image`, `video`), `status` (`staged`, `stored`, `failed`), `content_type`, `size`, `staging_ref` (null once the staging copy is gone), `durable_key`, `provider_ref` (null until stored). No foreign key to `submission`: deletion goes through `media.delete` so a provider outage cannot leave a row pointing at nothing."
  6. Add a row: "`email_delivery` | `notifications` | `delivery_key` (unique: `<job type>:<submission id>`), `provider_message_id`. Lets a retried email job see the message was sent (ADR 0025)."
  7. Indexes: add "`submission_in_progress (expires_at)` for cleanup; the unique `media (submission_id, field_key, position)`, which also serves lookups by submission".

- [ ] **Step 8: `specs/architecture.md`.**
  1. Modules table: the `notifications` row's responsibility becomes "Email rendering and sending ports, delivery receipts, job handlers for email; templates live in `src/shared/presentation/email/`".
  2. Ports table: `MediaStorage` row responsibility gains "; staging adds read and prefix delete"; `EmailSender` row becomes "Send one rendered transactional message | SMTP2GO (Mailpit locally)"; add `| EmailRenderer | Render the two messages from their data; the implementation is the template module in src/shared/presentation/email | Templates, wired at the composition root | system/email.md |` and `| MessageSource | The data an email job needs, looked up at run time from a submission id. Owned by notifications, implemented by submissions | Postgres (submissions) | system/email.md |`; the `SubmissionStats` row's first adapter becomes "Postgres, supplied by `submissions` (`PgSubmissionStats`)".
  3. The repositories paragraph, append: "`submissions` also owns `submission_in_progress`. `definitions` exports read use cases for the renderer (`resolvePublicForm`, `loadVersion`, `loadForm`) and `allocateReference`, so `submissions` never reads or writes `definitions` tables."
  4. "Where the framework is allowed": "Server actions live only in `src/app/**/actions.ts`; today that is the Settings tab's save." becomes "Server actions live only in `src/app/**/actions.ts`: the Settings tab's save and the renderer's page form (`src/app/f/[slug]/actions.ts`), which answers a refused page directly and redirects (303) otherwise. The renderer's uploads, blur checks and restart are route handlers beside it." Append: "Each surface has its own root layout (`src/app/admin/layout.tsx`, `src/app/(home)/layout.tsx`, `src/app/f/[slug]/layout.tsx`), so the public page's `<html lang>` follows the submitter; `src/app/global-not-found.tsx` answers paths outside the three."
  5. "Submission data flow": step 2, replace "Photos are written to the local staging directory under random names with metadata (EXIF, including GPS) stripped." with "Photos are re-encoded with metadata (EXIF, including GPS) stripped and written to the local staging directory under `in-progress/<record id>/<file id>.<ext>`." Step 3, replace "one `email.staff_notification` per configured recipient group" with "one `email.staff_notification` per submission, sent as one message to the form's recipient list as it stands when the job runs". The paragraph after the list, replace "The staff notification links to the submission in the manager" with "The staff notification links to the form's page in the manager until the review plan adds the submission page, and".
  6. Technology decisions: add `| Image processing | sharp, with libheif-js for HEIC; file-type for content sniffing | accepted | decisions/0023 |` and `| Browser end-to-end tests | Playwright, Chromium only | accepted | decisions/0024 |`.

- [ ] **Step 9: `specs/use-cases/fill-and-submit-form.md`**, main flow step 5: "type and size checks on both sides" becomes "type and size checks on both sides: with script the browser pre-checks the size and the declared kind before uploading (cheap and advisory), and the server decides by content".

- [ ] **Step 10: ADR 0002**, Consequences, append: "- The Dropbox adapter calls the HTTP API with `fetch` and no SDK: five endpoints and the refresh-token exchange are less code to review than an SDK's surface, and a local fake server can stand in for Dropbox in tests. Adopting the SDK later is an adapter change." **ADR 0008**, under the header: "Amended 2026-10-11: each surface has its own root layout so the public page's `<html lang>` follows the submitter, and the renderer's page form is a Server Action that answers a refused page directly".

- [ ] **Step 11: Create `specs/decisions/0023-image-processing.md`:**

  ```markdown
  # 0023. Image processing with sharp and libheif-js, sniffing with file-type

  Status: accepted
  Date: 2026-10-10

  ## Context

  Every uploaded photo must be re-encoded so that EXIF, XMP and GPS data never
  reach storage (`system/media-storage.md`), and files must be accepted by
  their content, never their name or declared type. Phones send JPEG, PNG,
  WebP and HEIC (the iPhone default) and MP4 or QuickTime video. Options were
  ImageMagick or libvips through a system binary, a WebAssembly-only stack,
  or the `sharp` binding to libvips. HEIC decoding is not in sharp's
  prebuilt binaries because of HEVC patent licensing.

  ## Decision

  - `sharp` decodes and re-encodes JPEG, PNG and WebP to the same format,
    applying the EXIF orientation first and writing no metadata. Inputs above
    50 megapixels are refused.
  - `libheif-js` (its WebAssembly bundle) decodes HEIC to RGBA pixels, which
    sharp encodes as JPEG. No native HEVC code is installed.
  - `file-type` identifies JPEG, PNG, WebP, HEIC, MP4 and QuickTime from the
    first bytes. Anything else is refused before decoding. Videos get an ISO
    base media box walk of our own, since we store them as received.
  - All three are used only in `src/modules/media/infrastructure/`, behind
    the `ContentSniffer` and `ImageEncoder` ports. `sharp` and `libheif-js`
    are listed in `serverExternalPackages` so Next.js does not bundle them.

  ## Consequences

  - One native dependency (sharp ships prebuilt libvips for linux-x64 and
    darwin-arm64); the production image must install it for its platform.
  - HEIC decoding in WebAssembly is slower than native, about a second for a
    12 MP photo, which is acceptable for early uploads and bounded by the
    10 MB file cap.
  - Re-encoding runs inside the Next.js process (ADR 0008). The file caps in
    `system/security.md` bound memory per request.
  - Swapping any of them is an adapter change behind the two ports.
  ```

- [ ] **Step 12: Create `specs/decisions/0024-browser-end-to-end-tests.md`:**

  ```markdown
  # 0024. Browser end-to-end tests with Playwright

  Status: accepted
  Date: 2026-10-11

  ## Context

  `ui-ux/renderer.md` asks the e2e suite to complete the reference form on a
  phone viewport with script enabled. Early uploads with progress, blur checks
  and the offline banner exist only in a browser; an HTTP client cannot run
  them. Options were Playwright, Cypress, or WebdriverIO.

  ## Decision

  - `@playwright/test` as a development dependency, Chromium only, run by
    `pnpm test:e2e:browser` against the built app (`next start`) on a
    throwaway database, the same way the HTTP e2e suite starts it.
  - CI installs Chromium with `playwright install --with-deps chromium` in its
    own job. Locally the browser run counts as one heavy process.
  - The HTTP suite stays: it is the script-disabled run and owns the budgets.

  ## Consequences

  - One more development dependency and a browser download in CI.
  - Firefox and WebKit are not covered; adding them is a config change.
  - Specs live in `tests/browser/*.spec.ts`, outside Vitest's `*.test.ts`.
  ```

- [ ] **Step 13: Create `specs/decisions/0025-submission-reference-counter-and-email-delivery.md`:**

  ```markdown
  # 0025. Submission reference counter and email delivery receipts

  Status: accepted
  Date: 2026-10-11

  ## Context

  References are `<prefix>-<nnnn>` per form (`form-definition.md`), must be
  consecutive, and must never be taken by an intake that rolls back. Email
  jobs may run twice, and a provider message must not go out twice.

  ## Decision

  - `form.next_reference` (integer, starts at 1), owned by `definitions` and
    advanced only by its use case `allocateReference` inside the intake's unit
    of work, under the `form` row lock taken after the in-progress row lock.
    The same locked read decides again that the form is open. Taking a number
    does not touch `form.updated_at`.
  - `email_delivery`, owned by `notifications`: one row per sent message,
    unique `delivery_key` = `<job type>:<submission id>`, holding the provider
    message id. A job records it before succeeding; a run that finds it sends
    nothing.

  ## Consequences

  - A rolled-back intake gives its number back; references have no gaps
    except for deleted submissions.
  - `submissions` never writes a `definitions` table.
  - Delivery rows are not personal data; they go with the submission when
    `retention.purge` exists.
  ```

- [ ] **Step 14: Create `specs/decisions/0026-test-only-boundary-exception.md`:**

  ```markdown
  # 0026. Test-only exception to the module boundary

  Status: accepted
  Date: 2026-10-11

  ## Context

  A module exposes one public entry point, and the boundaries lint enforces
  it. Tests of one module need another module's in-memory fakes (submissions
  tests drive media and definitions fakes), and some `src/` tests read shared
  test data from `tests/fixtures/` and `tests/fakes/`.

  ## Decision

  - Files matching `src/**/*.test.{ts,tsx}` or `src/**/testing/**` may import
    any module's `application/testing/*` and any file under `tests/fixtures/`
    or `tests/fakes/`.
  - Production code keeps the single entry point: no other file may import a
    `testing/` folder or `tests/`, its own module's included.
  - `eslint.config.mjs` encodes both rules; `tests/boundaries/` probes them.

  ## Consequences

  - Fakes are shared instead of copied, and drift with their ports in one
    place.
  - A fake must never be needed by production code; the lint refuses it.
  ```

- [ ] **Step 15: Check** `pnpm format:check` and re-read each edited section once against the decisions list at the top of this plan.
- [ ] **Step 16: Commit**

  ```bash
  git add specs
  git commit -m "docs: specify the renderer routes, copy additions, abuse protection, media and email ports, ADRs 0023 to 0026

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---

### Task 2: Shared job plumbing and the test-only boundary exception

**Files:**
- Modify: `src/shared/application/ports/job-queue.ts`, `src/shared/infrastructure/jobs/worker.ts`, `src/shared/infrastructure/jobs/handlers/cleanup.ts`, `src/shared/application/testing/fakes.ts`, `eslint.config.mjs`
- Test: `tests/integration/jobs/worker.test.ts` (two new cases), `tests/integration/jobs/cleanup.test.ts` (new), `tests/integration/identity/cleanup.test.ts` (its hand-built context gains `maxAttempts`), `src/shared/application/testing/fakes.test.ts` (new), `tests/boundaries/boundaries.test.ts` (six probes)

**Interfaces:**
- Produces:

```ts
// job-queue.ts additions
export interface JobHandlerContext {
  jobId: string;
  attempt: number;
  /** The job's attempt limit; `attempt >= maxAttempts` means this is the last run. */
  maxAttempts: number;
  logger: Logger;
  uow: UnitOfWorkFactory;
  queue: JobQueue;
  clock: Clock;
}
/** Thrown by a handler for a failure no retry can fix: the job becomes dead at once. */
export class PermanentJobError extends Error {}   // constructor(message), name "PermanentJobError"

// handlers/cleanup.ts
export type CleanupStep = (ctx: JobHandlerContext) => Promise<void>;
/** The store is narrowed to the one method the handler calls, so a unit test can stub it (Task 27). */
export function createCleanupHandler(store: Pick<PgJobStore, "pruneSucceeded">, steps?: readonly CleanupStep[]): JobHandler;

// testing/fakes.ts additions
export interface EnqueuedJob { type: string; payload: JobPayload; opts: EnqueueOptions }
export class InMemoryJobQueue implements JobQueue {
  readonly enqueued: EnqueuedJob[];
  /** When set, the nth enqueue (0-based, over this queue's life) throws. */
  failAt: number | null;
  ofType(type: string): EnqueuedJob[];
}
export interface LoggedLine { level: "debug" | "info" | "warn" | "error"; msg: string; fields: LogFields }
export class RecordingLogger implements Logger { readonly lines: LoggedLine[] }   // children share `lines`
export function handlerContext(over?: Partial<JobHandlerContext>): JobHandlerContext;
```

```js
// eslint.config.mjs additions
const TEST_FILES = ["src/**/*.test.{ts,tsx}", "src/**/testing/**/*.{ts,tsx}"];
// boundaries/files gains { category: "module-testing", pattern: "src/modules/*/application/testing/**" }
```

Decision (test-only boundary exception, ADR 0026): test code (files matching `TEST_FILES`) may import any module's `application/testing/*` fakes and the helpers under `tests/fixtures/` and `tests/fakes/`; production code keeps the single public entry point and may import neither.

- [ ] **Step 1: Failing job tests.** Append to `tests/integration/jobs/worker.test.ts`, inside `describe("Worker")`, and add `PermanentJobError` to the existing `@/shared/application/ports/job-queue` import:

```ts
  it("marks a job dead at once when its handler throws PermanentJobError", async () => {
    const id = await enqueue("test.permanent", {}, 8);
    const worker = makeWorker({
      "test.permanent": () => Promise.reject(new PermanentJobError("recipient rejected")),
    });
    await worker.tick();
    expect(await job(id)).toMatchObject({ status: "dead", attempts: 1, last_error: "recipient rejected" });
    expect(lines.some((l) => l.level === "error" && l.msg === "job failed permanently")).toBe(true);
  });

  it("tells the handler the job's attempt limit", async () => {
    await enqueue("test.limits", {}, 3);
    const seen: JobHandlerContext[] = [];
    const worker = makeWorker({
      "test.limits": (_p, ctx) => {
        seen.push(ctx);
        return Promise.resolve();
      },
    });
    await worker.tick();
    expect(seen[0]).toMatchObject({ attempt: 1, maxAttempts: 3 });
  });
```

Create `tests/integration/jobs/cleanup.test.ts`:

```ts
describe("jobs.cleanup", () => {
  const pool = testPool();
  const NOW = new Date("2026-10-10T12:00:00Z");
  const clock = { now: () => NOW };
  const store = new PgJobStore(pool, clock, { leaseSeconds: 60 });
  beforeEach(() => truncateAll(pool));

  async function succeededJob(finishedAt: Date): Promise<string> {
    const id = randomUUID();
    await pool.query("insert into job (id, type, status, finished_at) values ($1, 'x.y', 'succeeded', $2)", [id, finishedAt]);
    return id;
  }
  const exists = async (id: string) => (await pool.query("select 1 from job where id = $1", [id])).rowCount === 1;

  it("prunes succeeded jobs before running the steps, in order, with the job's context", async () => {
    const old = await succeededJob(new Date("2026-09-01T00:00:00Z"));
    const seen: string[] = [];
    const ctx = handlerContext({ clock });
    const handler = createCleanupHandler(store, [
      async (c: JobHandlerContext) => {
        seen.push(`a:${c.jobId}:${String(await exists(old))}`);
      },
      () => {
        seen.push("b");
        return Promise.resolve();
      },
    ]);
    await handler({}, ctx);
    expect(seen).toEqual([`a:${ctx.jobId}:false`, "b"]);
  });

  it("runs the remaining steps when one fails, then fails the job", async () => {
    const ran: string[] = [];
    const handler = createCleanupHandler(store, [
      () => Promise.reject(new Error("step failed")),
      () => {
        ran.push("second");
        return Promise.resolve();
      },
    ]);
    await expect(handler({}, handlerContext({ clock }))).rejects.toThrow("step failed");
    expect(ran).toEqual(["second"]);
  });
});
```

In `tests/integration/identity/cleanup.test.ts`, the `context(logger)` helper returns `maxAttempts: 8` after `attempt: 1` (it builds a `JobHandlerContext` by hand, so the new required field breaks its type check otherwise).

Create `src/shared/application/testing/fakes.test.ts`:

```ts
describe("InMemoryJobQueue", () => {
  it("records jobs, honours unique keys, and fails on request", async () => {
    const queue = new InMemoryJobQueue();
    const uow = await new FakeUnitOfWorkFactory().begin();
    expect(await queue.enqueue(uow, "media.upload", { mediaId: "m1" })).toMatch(/^job-/);
    expect(await queue.enqueue(uow, "x", {}, { uniqueKey: "k" })).not.toBeNull();
    expect(await queue.enqueue(uow, "x", {}, { uniqueKey: "k" })).toBeNull();
    queue.failAt = 3;
    await expect(queue.enqueue(uow, "y", {})).rejects.toThrow(/injected/);
    expect(queue.ofType("media.upload")).toEqual([
      { type: "media.upload", payload: { mediaId: "m1" }, opts: {} },
    ]);
  });
});

describe("RecordingLogger", () => {
  it("shares lines with its children and merges their fields", () => {
    const logger = new RecordingLogger();
    logger.child({ jobId: "j1" }).info("done", { count: 2 });
    expect(logger.lines).toEqual([{ level: "info", msg: "done", fields: { jobId: "j1", count: 2 } }]);
  });
});
```

- [ ] **Step 2: Run** `pnpm test src/shared/application` and `pnpm db:up && pnpm test:integration tests/integration/jobs tests/integration/identity`; the new cases fail (missing exports, `maxAttempts` undefined, the job is `failed` instead of `dead`).

- [ ] **Step 3: Implement.**
  - `job-queue.ts`: `maxAttempts` in `JobHandlerContext`; `PermanentJobError` with a doc comment linking `specs/system/jobs.md`, "Failure and retry".
  - `worker.ts`: import `PermanentJobError` as a value; `run()` adds `maxAttempts: job.maxAttempts` to `ctx`. In the handler's `catch`, a `PermanentJobError` goes to `store.markDead(job, workerId, e.message)` and logs `error("job failed permanently", { outcome })` (or `warn("lease lost")` when the outcome is `lost`), then returns; every other error keeps the existing `store.fail` path.
  - `handlers/cleanup.ts`: `createCleanupHandler(store, steps = [])` prunes succeeded jobs older than 30 days (`store.pruneSucceeded`, logging `pruned succeeded jobs` with the count) **before** any step, then runs every step in order with the job's `ctx`, catching each failure; after the last step it rethrows the first failure, so the job retries. `CleanupStep` is documented as housekeeping another module contributes through the worker's composition root.
  - `testing/fakes.ts`: `InMemoryJobQueue.enqueue` counts calls (the `failAt`-th call rejects with `injected enqueue failure`), returns null for a `uniqueKey` already recorded, else records copies of payload and options and returns `job-<n>`. `RecordingLogger(lines = [], base = {})` pushes `{ level, msg, fields: { ...base, ...fields } }`; `child` returns a logger over the same array with merged base fields. `handlerContext` defaults: `jobId: "job-under-test"`, `attempt: 1`, `maxAttempts: 8`, a `RecordingLogger`, `FakeUnitOfWorkFactory`, `InMemoryJobQueue`, `FixedClock`. Name the three new fakes in the file header.

- [ ] **Step 4: Run** `pnpm test && pnpm test:integration tests/integration/jobs tests/integration/identity && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(shared): permanent job failures, attempt limits in the handler context, cleanup steps and job fakes`

- [ ] **Step 6: Failing boundary probes.** **The probe pattern** (every boundary probe in this plan follows it; later tasks list probes as rows "per the probe pattern in Task 2"): `const rules = await lintVirtual(<probe file>, \`import { <name> } from "<target>";\nexport const x = <name>;\n\`)`; "clean" expects `boundaryRules(rules)` to equal `[]` (move `boundaryRules` to file scope so every describe shares it) and no `no-restricted-imports`; "refused by R" expects the rule ids to contain R. Append `describe("test-only boundary exception (ADR 0026)")` to `tests/boundaries/boundaries.test.ts` with these probes (`makeDefinitionsDeps` and identity's `makeDeps` are the existing factories in those modules' `testing/fakes.ts`):

  | Test | Probe file | Imports | Expected |
  |---|---|---|---|
  | "lets a module's test import another module's testing fakes" | `src/modules/probe-c/application/boundary-probe-fakes.test.ts` | `makeDeps` from `@/modules/identity/application/testing/fakes` | clean |
  | "lets a module's testing helper import another module's testing fakes" | `src/modules/probe-c/application/testing/boundary-probe-helper.ts` | `makeDeps` from `@/modules/identity/application/testing/fakes` | clean |
  | "lets a module's test import tests/fixtures" | `src/modules/probe-c/presentation/boundary-probe-fixture.test.ts` | `referenceFormDraft` from `../../../../tests/fixtures/reference-form` | clean |
  | "refuses production code importing another module's testing fakes" | `src/modules/definitions/application/boundary-probe-fakes.ts` | `makeDeps` from `@/modules/identity/application/testing/fakes` | refused by `boundaries/dependencies` |
  | "refuses production code importing its own module's testing fakes" | `src/modules/definitions/application/boundary-probe-own-fakes.ts` | `makeDefinitionsDeps` from `./testing/fakes` | refused by `no-restricted-imports` |
  | "refuses production code importing tests/fixtures" | `src/modules/definitions/presentation/boundary-probe-fixture.ts` | `referenceFormDraft` from `../../../../tests/fixtures/reference-form` | refused by `no-restricted-imports` |

- [ ] **Step 7: Run** `pnpm test tests/boundaries`: the three "lets" probes fail on `boundaries/dependencies` and the last two fail for want of `no-restricted-imports`; the fourth already passes.

- [ ] **Step 8: Implement** in `eslint.config.mjs`:
  - Add `TEST_FILES` and the `module-testing` file category above.
  - Move the `policies` array of `boundaries/dependencies` into a `const POLICIES`; the main block uses it unchanged. Add a block after it, `{ files: TEST_FILES, rules: { "boundaries/dependencies": ["error", { default: "disallow", checkAllOrigins: true, policies: [...POLICIES, TEST_ONLY_POLICY] }] } }` with `TEST_ONLY_POLICY = { allow: { to: { ...element("module-application"), file: { categories: "module-testing" } } } }` and the comment "Test code may use any module's testing fakes (ADR 0026)".
  - Split the `no-restricted-imports` block: production files (`files: ["src/**/*.{ts,tsx}"]`, `ignores: TEST_FILES`) get the form-model pattern plus `{ group: ["**/testing/*", "**/testing/**"], message: "Testing fakes are for tests only (ADR 0026)." }` and `{ group: ["**/tests/fixtures/*", "**/tests/fakes/*"], message: "Test fixtures are for tests only (ADR 0026)." }`; test files keep the form-model pattern alone.
- [ ] **Step 9: Run** `pnpm test tests/boundaries && pnpm lint && pnpm format:check`. `pnpm lint` passing shows no production file imports a fake today.
- [ ] **Step 10: Commit** `chore(ci): let test code import other modules' testing fakes and test fixtures (ADR 0026)`

---

### Task 3: The restricted rich-text subset and a spec table reader

**Files:**
- Create: `src/shared/domain/rich-text.ts`, `src/shared/domain/rich-text.test.ts`, `src/shared/presentation/RichText.tsx`, `src/shared/presentation/rich-text-html.ts`, `src/shared/presentation/rich-text.test.ts`
- Modify: `src/shared/presentation/testing/spec-copy.ts`, `src/shared/presentation/testing/spec-copy.test.ts`

**Interfaces:**
- Produces:

```ts
// src/shared/domain/rich-text.ts
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; children: Inline[] }
  | { kind: "italic"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "break" };
export type Block =
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "bullets"; items: Inline[][] }
  | { kind: "numbers"; items: Inline[][] };
export function parseRichText(source: string): Block[];
export function richTextToPlain(blocks: readonly Block[]): string;
// src/shared/presentation/RichText.tsx
export function RichText(props: { source: string; className?: string | undefined }): ReactElement;
export function RichBlocks(props: { blocks: readonly Block[]; className?: string | undefined }): ReactElement;
// src/shared/presentation/rich-text-html.ts
export function escapeHtml(text: string): string;
export function richTextToHtml(blocks: readonly Block[], style: { link: string; paragraph: string }): string;
// src/shared/presentation/testing/spec-copy.ts
export function specTableRows(specPath: string, heading: string): Map<string, string[]>;
```

The syntax is `specs/ui-ux/builder.md`, "Markdown inputs": `**bold**`, `_italic_`, lines starting with `- `, lines starting with `1. `, `[text](https://…)`. A blank line separates paragraphs; a single newline is a line break. Anything else renders literally. The parser never yields markup, and both renderers escape every text node. Consent text is not in the subset (`form-definition.md` names four places, and Task 1 corrects `builder.md` to match): the renderer and the emails show consent text as plain escaped paragraphs.

- [ ] **Step 1: Failing tests.** `src/shared/domain/rich-text.test.ts`:

```ts
const t = (text: string) => ({ kind: "text", text });

describe("parseRichText", () => {
  it("splits paragraphs on blank lines and keeps single newlines as breaks", () => {
    expect(parseRichText("One\ntwo\n\nThree")).toEqual([
      { kind: "paragraph", children: [t("One"), { kind: "break" }, t("two")] },
      { kind: "paragraph", children: [t("Three")] },
    ]);
  });

  it("reads bold, italic and https links, nested", () => {
    expect(parseRichText("**Bold _both_** and [site](https://example.com/a)")).toEqual([
      {
        kind: "paragraph",
        children: [
          { kind: "bold", children: [t("Bold "), { kind: "italic", children: [t("both")] }] },
          t(" and "),
          { kind: "link", href: "https://example.com/a", children: [t("site")] },
        ],
      },
    ]);
  });

  it("groups bulleted and numbered lines into lists", () => {
    expect(parseRichText("- a\n- b\n1. c")).toEqual([
      { kind: "bullets", items: [[t("a")], [t("b")]] },
      { kind: "numbers", items: [[t("c")]] },
    ]);
  });

  it("leaves everything else literal: http and javascript links, html, snake_case, lone markers", () => {
    const source = "[x](http://example.com) [y](javascript:alert(1)) <b>z</b> snake_case_name **open";
    expect(parseRichText(source)).toEqual([{ kind: "paragraph", children: [t(source)] }]);
  });

  it("never nests a link inside a link", () => {
    const [block] = parseRichText("[a [b](https://example.com/b)](https://example.com/a)");
    expect(JSON.stringify(block)).not.toMatch(/"link".*"link"/);
  });

  it("normalizes CRLF and drops leading and trailing blank lines", () => {
    expect(parseRichText("\r\n\r\nHi\r\n")).toEqual([{ kind: "paragraph", children: [t("Hi")] }]);
  });
});

describe("richTextToPlain", () => {
  it("writes lists with markers and links with their address", () => {
    expect(richTextToPlain(parseRichText("Hi **there**\n\n- one\n1. [two](https://example.com)"))).toBe(
      "Hi there\n\n- one\n\n1. two (https://example.com)",
    );
  });
});
```

`src/shared/presentation/rich-text.test.ts`:

```ts
describe("RichText", () => {
  it("renders paragraphs, lists and links that open safely, escaping text", () => {
    const html = renderToStaticMarkup(
      createElement(RichText, { source: "<i>x</i> **b**\n\n- [l](https://example.com)" }),
    );
    expect(html).toBe(
      '<div><p>&lt;i&gt;x&lt;/i&gt; <strong>b</strong></p><ul><li><a href="https://example.com" target="_blank" rel="noopener">l</a></li></ul></div>',
    );
  });
});

describe("richTextToHtml", () => {
  it("escapes text and attributes and applies the fixed inline styles", () => {
    const html = richTextToHtml(parseRichText('"q" & [a](https://example.com/?a=1&b=2)'), {
      link: "color:#372549",
      paragraph: "margin:0 0 16px",
    });
    expect(html).toBe(
      '<p style="margin:0 0 16px">&quot;q&quot; &amp; <a href="https://example.com/?a=1&amp;b=2" style="color:#372549">a</a></p>',
    );
    expect(escapeHtml("<'>")).toBe("&lt;&#39;&gt;");
  });
});
```

Append to `src/shared/presentation/testing/spec-copy.test.ts` (import `specTableRows`):

```ts
describe("specTableRows", () => {
  it("reads the first table under a heading, keyed by its first cell", () => {
    const rows = specTableRows("specs/ui-ux/renderer.md", "Fixed chrome copy");
    expect(rows.get("skip_link")).toEqual(["Skip to form", "Ir al formulario"]);
    const catalog = specTableRows("specs/ui-ux/renderer.md", "Message catalog");
    expect(catalog.get("files min one")?.[0]).toBe("Upload at least {n} file for {label}");
  });

  it("fails loudly for a heading that does not exist", () => {
    expect(() => specTableRows("specs/ui-ux/renderer.md", "No such heading")).toThrow(/No heading/);
  });
});
```

- [ ] **Step 2: Run** `pnpm test src/shared` and see them fail.

- [ ] **Step 3: Implement.**
  - `rich-text.ts` (doc comment links `form-definition.md`, "Text and languages", and `builder.md`, "Markdown inputs"): normalize `\r\n?` to `\n`, split into lines; a blank line ends the open paragraph or list; `^- (.*)$` and `^\d{1,3}\. (.*)$` lines join a list of their kind (a change of kind starts a new list); other lines join the paragraph, separated by `break`. Inline parsing scans left to right: `**…**` only with a closing marker; `_…_` only when the opening `_` does not follow a letter or digit and the closing one is not followed by one (`/[\p{L}\p{N}]/u`), so `snake_case` stays literal; `[text](url)` only when `url` matches `https://[^\s()]+` **and** `new URL(url).protocol === "https:"`, and the link text is parsed with links off, so links never nest. Adjacent text characters merge into one text node.
  - `richTextToPlain`: paragraphs joined by a blank line; list items as `- item` or `1. item`, one per line; links as `text (href)`; breaks as `\n`.
  - `RichText.tsx`: `RichBlocks` maps blocks to `<p>`, `<ul>`, `<ol>`, `<li>`, `<strong>`, `<em>`, `<br>`, and links to `<a href target="_blank" rel="noopener">` (design-system/components.md, "Link"), inside one `<div className>`; React escapes the text. `RichText` is `RichBlocks` over `parseRichText(source)`.
  - `rich-text-html.ts`: `escapeHtml` replaces `& < > " '` with `&amp; &lt; &gt; &quot; &#39;`; `richTextToHtml` writes the same elements as strings, escaping every text node and `href`, with `style.paragraph` on `<p>`, `<ul>`, `<ol>` and `style.link` on `<a>` (no `target`: mail clients open links themselves). The styles are fixed strings, never staff input.
  - `specTableRows`: find the first `##` to `####` heading whose text equals `heading` (throw `No heading "<heading>" in <path>` otherwise); skip to the first `|` line (the header row), skip the separator row, read rows until a non-table line or the next heading; key by the first trimmed cell, value the other trimmed cells.

- [ ] **Step 4: Run** `pnpm test src/shared && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(shared): restricted rich-text subset with React and email renderings, spec table reader`

---

### Task 4: Page-scoped validation, visible pages and upload limits in the form model

**Files:**
- Modify: `src/shared/domain/form-model/submission.ts`, `src/shared/domain/form-model/visibility.ts`, `src/shared/domain/form-model/field-type.ts`, `src/shared/domain/form-model/field-types/file-upload.ts`, `src/shared/domain/form-model/field-types/conformance-checks.ts`, `src/shared/domain/form-model/index.ts`, `specs/decisions/0016-field-type-hooks.md`
- Test: `src/shared/domain/form-model/page-validation.test.ts` (new), `src/shared/domain/form-model/field-types/conformance-checks.test.ts` (two cases)

**Interfaces:**
- Produces (from `@/shared/domain/form-model`):

```ts
/** Which fields take files, and their limits: a type hook, so no consumer tests a type id. */
export interface UploadLimits { kinds: readonly ("image" | "video")[]; maxFiles: number; maxSizeMb: number }
// FieldTypeDefinition<S, A> gains the optional hook:
uploadLimits?(settings: S): UploadLimits;      // file_upload: (s) => ({ kinds: s.kinds, maxFiles: s.maxFiles, maxSizeMb: s.maxSizeMb })
export interface PageValidation {
  /** Normalized answers of the page's visible input fields that passed. */
  answers: Record<string, unknown>;
  issues: ValidationIssue[];
}
export function validatePage(
  version: Version,
  registry: FieldTypeRegistry,
  body: Readonly<Record<string, unknown>>,   // stored answers of earlier pages plus this page's values
  pageKey: string,
  ctx: SubmissionContext,
  opts: { enforceRequired: boolean },        // false for Back and the language switch
): PageValidation;
export function visiblePages(version: Version, answers: Readonly<Record<string, unknown>>, registry: FieldTypeRegistry): Page[];
```

- [ ] **Step 1: Failing tests.** `src/shared/domain/form-model/page-validation.test.ts`:

```ts
const registry = buildDefaultRegistry();
const ctx = { today: "2026-10-10" };
const choice = (key: string, en: string) => ({ key, label: { en } });

function version(): Version {
  const parsed = parseDraft(
    {
      languages: "en",
      title: { en: "T" },
      confirmation: { screen: { en: "Thanks" } },
      pages: [
        {
          key: "page_one",
          fields: [
            {
              key: "has_baby",
              type: "single_choice",
              label: { en: "Baby?" },
              required: true,
              settings: { options: [choice("yes_opt", "Yes"), choice("no_opt", "No")] },
            },
            { key: "contact", type: "email", label: { en: "Email" } },
          ],
        },
        {
          key: "page_two",
          visibility: { field: "has_baby", op: "equals", value: "yes_opt" },
          fields: [{ key: "baby_name", type: "short_text", label: { en: "Name" }, required: true }],
        },
      ],
    },
    registry,
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.version;
}

const enforce = { enforceRequired: true };

describe("validatePage", () => {
  it("validates only the asked page and returns its normalized answers", () => {
    const r = validatePage(version(), registry, { has_baby: "yes_opt", contact: " A@Example.com " }, "page_one", ctx, enforce);
    expect(r).toEqual({ answers: { has_baby: "yes_opt", contact: "a@example.com" }, issues: [] });
  });

  it("reports required and invalid answers on the page", () => {
    const r = validatePage(version(), registry, { contact: "nope" }, "page_one", ctx, enforce);
    expect(r.issues.map((i) => [i.field, i.code])).toEqual([
      ["has_baby", "required"],
      ["contact", "email_syntax"],
    ]);
  });

  it("skips absent answers without enforcing required, and still drops invalid ones", () => {
    const r = validatePage(version(), registry, { contact: "nope" }, "page_one", ctx, { enforceRequired: false });
    expect(r).toEqual({ answers: {}, issues: [{ code: "email_syntax", field: "contact" }] });
  });

  it("uses earlier answers for the asked page's conditions", () => {
    const shown = validatePage(version(), registry, { has_baby: "yes_opt" }, "page_two", ctx, enforce);
    expect(shown.issues).toEqual([{ code: "required", field: "baby_name" }]);
    const hidden = validatePage(version(), registry, { has_baby: "no_opt", baby_name: "x" }, "page_two", ctx, enforce);
    expect(hidden).toEqual({ answers: {}, issues: [] });
  });

  it("returns nothing for an unknown page", () => {
    expect(validatePage(version(), registry, {}, "page_nine", ctx, enforce)).toEqual({ answers: {}, issues: [] });
  });
});

describe("visiblePages", () => {
  it("follows the page conditions", () => {
    expect(visiblePages(version(), { has_baby: "yes_opt" }, registry).map((p) => p.key)).toEqual(["page_one", "page_two"]);
    expect(visiblePages(version(), { has_baby: "no_opt" }, registry).map((p) => p.key)).toEqual(["page_one"]);
  });
});

describe("uploadLimits", () => {
  it("is defined by file_upload alone and reads its settings", () => {
    const withHook = registry.list().filter((d) => d.uploadLimits !== undefined).map((d) => d.id);
    expect(withHook).toEqual(["file_upload"]);
    expect(registry.get("file_upload").uploadLimits?.({ kinds: ["image", "video"], maxFiles: 3, maxSizeMb: 5 })).toEqual({
      kinds: ["image", "video"],
      maxFiles: 3,
      maxSizeMb: 5,
    });
  });
});
```

Append to `describe("conformanceChecks")` in `field-types/conformance-checks.test.ts`:

```ts
  it("passes file_upload's upload limits", () => {
    expect(failing(fileUpload)).toEqual([]);
  });
  it("fails the upload limits check for no kinds, an unknown kind or a non-positive limit", () => {
    for (const limits of [
      { kinds: [], maxFiles: 1, maxSizeMb: 1 },
      { kinds: ["audio"], maxFiles: 1, maxSizeMb: 1 },
      { kinds: ["image"], maxFiles: 0, maxSizeMb: 1 },
      { kinds: ["image"], maxFiles: 1.5, maxSizeMb: 1 },
      { kinds: ["image"], maxFiles: 1, maxSizeMb: 0 },
    ]) {
      const broken = defineFieldType({ ...checkbox, uploadLimits: () => limits as never });
      expect(failing(broken)).toEqual(["reports well-formed upload limits"]);
    }
  });
```

- [ ] **Step 2: Run** `pnpm test src/shared/domain/form-model`: fails on the missing exports and the missing check.

- [ ] **Step 3: Implement.**
  - `submission.ts`, below `validateSubmission`, reusing its private `issuesFor`, `isAbsent` and `evaluateCondition`: `validatePage` walks the pages in order, keeping `known` answers for conditions. A page or field is visible as in `validateSubmission` (`neverHidden` fields always). On pages before the target, a visible input field's value from `body` only feeds `known`. On the target page, each visible input field is validated with `issuesFor` (skipped when `!enforceRequired` and the value is absent); issues are collected and passing normalized values go to both `answers` and `known`. It returns at the target page; an unknown page gives `{ answers: {}, issues: [] }`. The doc comment says earlier pages were validated when posted and Submit validates the whole submission again (`renderer.md`, "Navigation and state").
  - `visibility.ts`: `visiblePages` filters `version.pages` to those `evaluateVisibility(version, answers, registry).pages` marks visible, in document order.
  - `field-type.ts`: export `UploadLimits`; add the optional `uploadLimits?(settings: S): UploadLimits` hook with the comment "The field takes files: accepted kinds and limits, read by the renderer and the intake".
  - `field-types/file-upload.ts`: `uploadLimits: (s) => ({ kinds: s.kinds, maxFiles: s.maxFiles, maxSizeMb: s.maxSizeMb })`.
  - `conformance-checks.ts`: a check named `reports well-formed upload limits`: when `def.uploadLimits` is absent it passes; otherwise, for every `def.fixtures.settings` entry, the result has a non-empty `kinds` drawn from `image` and `video` without repeats, a positive integer `maxFiles` and a positive finite `maxSizeMb`, and the type is an input (`def.isInput`); the detail names the settings and the result.
  - `index.ts`: `export { validateSubmission, validatePage, isAbsent } from "./submission"`, `export type { SubmissionContext, SubmissionResult, PageValidation } from "./submission"`, `export { evaluateVisibility, visiblePages } from "./visibility"`, and `UploadLimits` in the `./field-type` type export.
  - `specs/decisions/0016-field-type-hooks.md`: under the header add "Amended 2026-10-11: an optional `uploadLimits(settings)` hook names the fields that take files; the conformance suite checks it"; add to the Decision list, after `consentRecord`: "- `uploadLimits`: the field takes files, with the accepted kinds (`image`, `video`), the most files and the largest size in MB. The renderer and the intake read it, so neither tests a type id."; and append to the conformance sentence: ", and that upload limits are well formed where a type declares them".

- [ ] **Step 4: Run** `pnpm test src/shared/domain/form-model && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(form-model): validate one page, list the visible pages, and an upload limits hook`

---

### Task 5: Media domain: kinds, keys and the video container check

**Files:**
- Create: `src/modules/media/domain/media.ts`, `keys.ts`, `iso-bmff.ts`, with `media.test.ts`, `keys.test.ts`, `iso-bmff.test.ts` beside them
- Create: `tests/fakes/media-files.ts`, `tests/fixtures/media/synthetic-16x16.heic`
- Modify: `package.json`, `pnpm-lock.yaml` (`sharp`, `libheif-js`, `file-type`; used from Task 7, added here because the test helpers need sharp)

**Interfaces:**
- Produces:

```ts
// media.ts
export const MEDIA_KINDS: readonly ["image", "video"];
export type MediaKind = "image" | "video";
export const ACCEPTED_TYPES: {
  "image/jpeg": { kind: "image"; ext: "jpg" }; "image/png": { kind: "image"; ext: "png" };
  "image/webp": { kind: "image"; ext: "webp" }; "image/heic": { kind: "image"; ext: "heic" };
  "image/heif": { kind: "image"; ext: "heic" }; "video/mp4": { kind: "video"; ext: "mp4" };
  "video/quicktime": { kind: "video"; ext: "mov" };
};
export type AcceptedType = keyof typeof ACCEPTED_TYPES;
export function acceptedType(mime: string | null): AcceptedType | null;
export function extensionFor(contentType: string): string;            // throws outside ACCEPTED_TYPES
export const MEDIA_STATUSES: readonly ["staged", "stored", "failed"];
export type MediaStatus = "staged" | "stored" | "failed";
export interface StagedFile { id: string; stagingRef: string; kind: MediaKind; contentType: string; size: number }
export interface MediaRecord {
  id: string; submissionId: string; formId: string; fieldKey: string; position: number; kind: MediaKind;
  status: MediaStatus; contentType: string; size: number; stagingRef: string | null; durableKey: string;
  providerRef: string | null; createdAt: Date; updatedAt: Date;
}
// keys.ts
export const MAX_FIELD_SLUG = 40;
export const STAGING_ROOT = "in-progress";
export function fieldSlug(label: string): string;
export function uniqueFieldSlugs(fields: readonly { fieldKey: string; label: string }[]): Map<string, string>;
export function durableKey(parts: { formSlug: string; reference: string; position: number; fieldSlug: string; ext: string }): string;
export function stagingPrefix(recordId: string): string;              // "in-progress/<id>/"
export function stagingKey(recordId: string, fileId: string, ext: string): string;
// iso-bmff.ts
export function isWellFormedIsoBmff(bytes: Uint8Array): boolean;
// tests/fakes/media-files.ts (test support)
export function box(type: string, body?: Uint8Array): Uint8Array;
export function syntheticMp4(brand?: string): Uint8Array;
export function brokenMp4(): Uint8Array;
export async function syntheticJpegWithGps(width?: number, height?: number): Promise<Uint8Array>;
export async function syntheticPng(): Promise<Uint8Array>;
export async function syntheticWebp(): Promise<Uint8Array>;
export function syntheticHeic(): Uint8Array;
export function htmlPretendingToBeJpeg(): Uint8Array;
```

Decision (media keys): durable keys follow `media-storage.md`: `forms/<form slug>/<reference>/<nn>-<field slug>.<ext>`, the field slug being an ASCII slug of the label in the form's first language, at most 40 characters, `file` when the label has no letter or digit, and `-2`, `-3` appended in field order when two upload fields share a slug. Decision (staging directory): staged files are `in-progress/<record id>/<file id>.<ext>` under the existing `STAGING_DIR`, so one prefix delete removes an expired record's files, including any a crash left between the write and the record update.

- [ ] **Step 1: Dependencies and fixture.** `pnpm add sharp@^0.34 libheif-js@^1.19 file-type@^21`. Generate the HEIC fixture once (a solid-color square, not media anyone uploaded): `magick -size 16x16 xc:#6C344E /tmp/s.png && heif-enc -q 50 /tmp/s.png -o tests/fixtures/media/synthetic-16x16.heic` (`brew install imagemagick libheif` provides both tools). Confirm `file tests/fixtures/media/synthetic-16x16.heic` reports HEIF.

- [ ] **Step 2: Test support** `tests/fakes/media-files.ts`. Every helper builds synthetic bytes:
  - `box(type, body)`: a 32-bit big-endian size (8 plus the body), the four ASCII type characters, the body.
  - `syntheticMp4(brand = "isom")`: `ftyp` (brand, four zero bytes of minor version, brand, `mp41`), then `moov` holding an `mvhd` of 100 zero bytes, then `mdat` of 900 zero bytes. `syntheticMp4("qt  ")` is a QuickTime file.
  - `brokenMp4()`: `syntheticMp4()` with the `ftyp` size overwritten to 4096, larger than the file.
  - `syntheticJpegWithGps(width = 64, height = 48)`: a sharp-created Gaussian-noise image (mean 128, sigma 30) as JPEG `withExif({ IFD0: { Copyright: "synthetic test image" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "8/1 58/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "79/1 31/1 0/1" } })`, so stripping is observable.
  - `syntheticPng()`: 16 by 16, four channels, `#6C344E`. `syntheticWebp()`: 16 by 16, three channels, `#372549`.
  - `syntheticHeic()`: reads `tests/fixtures/media/synthetic-16x16.heic` (its comment repeats the generation command).
  - `htmlPretendingToBeJpeg()`: the ASCII bytes of `<!doctype html><title>not a photo</title>`.

- [ ] **Step 3: Failing tests.** `src/modules/media/domain/keys.test.ts`:

```ts
describe("fieldSlug", () => {
  it("is an ASCII slug of the label, accents removed, at most 40 characters", () => {
    expect(fieldSlug("Sube hasta 10 fotos sin editar del bebé")).toBe("sube-hasta-10-fotos-sin-editar-del-bebe");
    expect(fieldSlug("¿Fotos?   Ñandú  & más")).toBe("fotos-nandu-mas");
    expect(fieldSlug(`${"a".repeat(39)} bcd`)).toBe("a".repeat(39));
    expect(fieldSlug("🙂")).toBe("file");
  });
});

describe("uniqueFieldSlugs", () => {
  it("suffixes repeated slugs in field order", () => {
    expect(
      uniqueFieldSlugs([
        { fieldKey: "f_one", label: "Photos" },
        { fieldKey: "f_two", label: "photos" },
        { fieldKey: "f_three", label: "Videos" },
      ]),
    ).toEqual(new Map([["f_one", "photos"], ["f_two", "photos-2"], ["f_three", "videos"]]));
  });
});

describe("durableKey and stagingKey", () => {
  it("follow the documented schemes", () => {
    expect(
      durableKey({ formSlug: "historia-prematuro-2026", reference: "HP-0042", position: 1, fieldSlug: "sube-hasta-10-fotos", ext: "jpg" }),
    ).toBe("forms/historia-prematuro-2026/HP-0042/01-sube-hasta-10-fotos.jpg");
    expect(stagingPrefix("rec-1")).toBe("in-progress/rec-1/");
    expect(stagingKey("rec-1", "file-1", "mp4")).toBe("in-progress/rec-1/file-1.mp4");
  });
});
```

`media.test.ts`: "accept the documented types only" (`acceptedType("image/heif")` is `image/heif`, `"video/quicktime"` is itself, `"image/gif"` and null are null); "name each type's extension, HEIF as heic" (`extensionFor("image/heif")` is `heic`, `"video/quicktime"` is `mov`, `"text/html"` throws).

`iso-bmff.test.ts` (importing `tests/fakes` from a test is allowed by ADR 0026):

```ts
describe("isWellFormedIsoBmff", () => {
  it("accepts ftyp first, consistent sizes and a moov box", () => {
    expect(isWellFormedIsoBmff(syntheticMp4())).toBe(true);
    expect(isWellFormedIsoBmff(syntheticMp4("qt  "))).toBe(true);
  });

  it("refuses an overlong box, a missing moov, a wrong first box and tiny input", () => {
    expect(isWellFormedIsoBmff(brokenMp4())).toBe(false);
    expect(isWellFormedIsoBmff(box("ftyp", new Uint8Array(8)))).toBe(false);
    expect(isWellFormedIsoBmff(new Uint8Array([...box("moov"), ...box("ftyp", new Uint8Array(8))]))).toBe(false);
    expect(isWellFormedIsoBmff(new Uint8Array(4))).toBe(false);
  });
});
```

- [ ] **Step 4: Run** `pnpm test src/modules/media`: fails, the modules do not exist.

- [ ] **Step 5: Implement.**
  - `media.ts`: the constants as `as const` objects (`ACCEPTED_TYPES` with `satisfies Record<string, { kind: MediaKind; ext: string }>`, commented with `media-storage.md`, "File handling rules"); `acceptedType` uses `Object.hasOwn`; `extensionFor` throws `no extension for <type>`; `StagedFile.id` is documented as also the media row id and the `file_upload` answer entry.
  - `keys.ts` (comment: no key carries personal data): `fieldSlug` is NFD-normalize, drop `\p{M}`, lowercase, runs of non-`[a-z0-9]` to `-`, trim dashes, cut at 40, trim trailing dashes again, `file` when empty. `uniqueFieldSlugs` counts each base slug in field order and appends `-<n>` from the second. `durableKey` pads the position to two digits.
  - `iso-bmff.ts`: walk boxes from offset 0: fewer than 8 bytes left fails; size 1 reads a 64-bit large size (needs 16 bytes, must fit); size 0 means "to the end"; a size below its header or beyond the remaining bytes fails; the type must be four printable ASCII characters; the first box must be `ftyp`; the file passes when at least one box was read and a `moov` box was seen.

- [ ] **Step 6: Run** `pnpm test src/modules/media && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 7: Commit** `feat(media): accepted kinds, key schemes and the video container check`

---

### Task 6: Media application: ports, staging, attaching, discarding

**Files:**
- Create: `src/modules/media/application/ports/media-storage.ts`, `ports/content-sniffer.ts`, `ports/image-encoder.ts`, `ports/media-repository.ts`, `deps.ts`, `job-types.ts`, `stage-file.ts`, `attach.ts`, `discard.ts`, `index.ts`, `testing/fakes.ts`
- Test: `stage-file.test.ts`, `attach.test.ts`, `discard.test.ts` beside them; `tests/boundaries/boundaries.test.ts` (two probes)

**Interfaces:**
- Consumes: Task 5's domain; `InMemoryJobQueue`, `FakeUnitOfWorkFactory`, `FixedClock`, `SequentialIdGenerator` (Task 2 and the existing shared fakes).
- Produces:

```ts
// ports/media-storage.ts
export interface MediaStorage {
  /** Stores the bytes under `key`, idempotent for the same key; returns the provider reference. */
  put(bytes: Uint8Array, key: string, contentType: string): Promise<string>;
  viewUrl(ref: string, ttlSeconds: number): Promise<string>;
  /** Succeeds when the file is already gone. */
  delete(ref: string): Promise<void>;
  exists(ref: string): Promise<boolean>;
}
export interface StagingStorage extends MediaStorage {
  read(ref: string): Promise<Uint8Array>;
  deletePrefix(prefix: string): Promise<void>;
}
// ports/content-sniffer.ts
export interface ContentSniffer { sniff(bytes: Uint8Array): Promise<string | null> }   // MIME type shown by the content
// ports/image-encoder.ts
export interface EncodedImage { bytes: Uint8Array; contentType: "image/jpeg" | "image/png" | "image/webp" }
export interface ImageEncoder { reencode(bytes: Uint8Array, contentType: string): Promise<EncodedImage | null> }  // null: does not decode
// ports/media-repository.ts
export interface MediaRepository {
  insert(uow: UnitOfWork, record: MediaRecord): Promise<void>;
  findById(id: string): Promise<MediaRecord | null>;
  listBySubmission(submissionId: string): Promise<MediaRecord[]>;   // by field key, then position
  markStored(uow: UnitOfWork, id: string, providerRef: string, at: Date): Promise<void>;
  clearStaging(uow: UnitOfWork, id: string, at: Date): Promise<void>;
  markFailed(uow: UnitOfWork, id: string, at: Date): Promise<void>;
  delete(uow: UnitOfWork, id: string): Promise<void>;
}
// deps.ts
export interface MediaDeps {
  staging: StagingStorage; durable: MediaStorage; sniffer: ContentSniffer; encoder: ImageEncoder;
  media: MediaRepository; queue: JobQueue; uow: UnitOfWorkFactory; ids: IdGenerator; clock: Clock;
}
// job-types.ts
export const MEDIA_JOB_TYPES = { upload: "media.upload", delete: "media.delete" } as const;
// stage-file.ts
export type StageRefusal = "file_too_large" | "file_wrong_type" | "file_unreadable";
export interface StageFileInput { recordId: string; bytes: Uint8Array; accept: readonly MediaKind[]; maxBytes: number }
export type StageFileResult = { ok: true; file: StagedFile } | { ok: false; code: StageRefusal };
export async function stageFile(deps: MediaDeps, input: StageFileInput): Promise<StageFileResult>;
// attach.ts
export interface AttachedFile { fieldKey: string; position: number; durableKey: string; file: StagedFile }
export async function attachToSubmission(
  deps: Pick<MediaDeps, "media" | "queue" | "clock">, uow: UnitOfWork,
  input: { submissionId: string; formId: string; files: readonly AttachedFile[] },
): Promise<void>;
// discard.ts
export async function discardStaged(deps: Pick<MediaDeps, "staging">, refs: readonly string[]): Promise<void>;
export async function discardRecordFiles(deps: Pick<MediaDeps, "staging">, recordId: string): Promise<void>;
// testing/fakes.ts
export function fakeImage(type?: string, size?: number): Uint8Array;   // "mime:<type>;" padded with zeros
export class InMemoryStorage implements StagingStorage { readonly files: Map<string, { bytes: Uint8Array; contentType: string }>; failPut: boolean }
export class FakeSniffer implements ContentSniffer {}   // "ftyp" at byte 4 -> video/mp4; "mime:<type>;" -> <type>; else null
export class FakeEncoder implements ImageEncoder {}     // "broken" in the bytes -> null; else "reencoded:" + bytes
export class InMemoryMediaRepository implements MediaRepository { readonly rows: Map<string, MediaRecord> }
export interface FakeMediaDeps extends MediaDeps { staging: InMemoryStorage; durable: InMemoryStorage; media: InMemoryMediaRepository; queue: InMemoryJobQueue; ids: SequentialIdGenerator; clock: FixedClock }
export function makeMediaDeps(overrides?: Partial<FakeMediaDeps>): FakeMediaDeps;
```

Decision (`file_upload` answers): a staged file's id is a UUID from `IdGenerator`. It is the entry in the answer (`mediaIdSchema` accepts UUIDs), the media row id and the `media.upload` payload, so all three always name the same file.

- [ ] **Step 1: Failing tests.** `stage-file.test.ts` (`MB = 1024 * 1024`; each case on fresh `makeMediaDeps()` and `recordId: "rec-1"`):

```ts
describe("stageFile", () => {
  it("re-encodes an accepted image and stages it under the record prefix", async () => {
    const deps = makeMediaDeps();
    const r = await stageFile(deps, { recordId: "rec-1", bytes: fakeImage("image/jpeg"), accept: ["image"], maxBytes: 10 * MB });
    if (!r.ok) throw new Error(r.code);
    expect(r.file).toMatchObject({ kind: "image", contentType: "image/jpeg" });
    expect(r.file.stagingRef).toBe(`in-progress/rec-1/${r.file.id}.jpg`);
    const stored = deps.staging.files.get(r.file.stagingRef);
    expect(new TextDecoder().decode(stored?.bytes)).toMatch(/^reencoded:/);
    expect(r.file.size).toBe(stored?.bytes.length);
  });

  it("refuses by size, content type, kind and decoding, staging nothing", async () => {
    const deps = makeMediaDeps();
    const cases = [
      [{ bytes: fakeImage("image/jpeg", 2 * MB), accept: ["image"], maxBytes: MB }, "file_too_large"],
      [{ bytes: new TextEncoder().encode("<html>"), accept: ["image"], maxBytes: MB }, "file_wrong_type"],
      [{ bytes: syntheticMp4(), accept: ["image"], maxBytes: MB }, "file_wrong_type"],
      [{ bytes: fakeImage("image/gif"), accept: ["image"], maxBytes: MB }, "file_wrong_type"],
      [{ bytes: new TextEncoder().encode("mime:image/png;broken"), accept: ["image"], maxBytes: MB }, "file_unreadable"],
      [{ bytes: brokenMp4(), accept: ["video"], maxBytes: MB }, "file_unreadable"],
    ] as const;
    for (const [input, code] of cases) {
      expect(await stageFile(deps, { recordId: "rec-1", ...input })).toEqual({ ok: false, code });
    }
    expect(deps.staging.files.size).toBe(0);
  });
});
```

and the case "stores a well-formed video as received": `syntheticMp4()` with `accept: ["image", "video"]`, `maxBytes: 10 MB` → `ok`, `kind: "video"`, and the staged bytes equal the input.

`attach.test.ts`, "writes one staged row and one media.upload job per file, sharing the id": attach `{ fieldKey: "photos", position: 1, durableKey: "forms/s/HP-0001/01-photos.jpg", file }` with `file = { id: "00000001-0000-4000-8000-000000000001", stagingRef: "in-progress/r/x.jpg", kind: "image", contentType: "image/jpeg", size: 10 }` to `submissionId: "sub-1"`, `formId: "form-1"`; the row for `file.id` matches `{ submissionId: "sub-1", formId: "form-1", fieldKey: "photos", position: 1, status: "staged", stagingRef: "in-progress/r/x.jpg", durableKey: "forms/s/HP-0001/01-photos.jpg", providerRef: null }` and `queue.ofType("media.upload")` equals `[{ type: "media.upload", payload: { mediaId: file.id }, opts: {} }]`.

`discard.test.ts`, "deletes given refs, tolerating missing ones, and whole record prefixes": with `in-progress/a/1.jpg`, `in-progress/a/2.jpg` and `in-progress/b/3.jpg` staged, `discardStaged(["in-progress/a/1.jpg", "in-progress/a/missing.jpg"])` leaves `["in-progress/a/2.jpg", "in-progress/b/3.jpg"]`, then `discardRecordFiles("a")` leaves `["in-progress/b/3.jpg"]`.

Boundary probes inside `describe("layer boundaries")`, per the probe pattern in Task 2:

| Test | Probe file | Imports | Expected |
|---|---|---|---|
| "forbids media importing definitions, since MODULE_DEPS gives media no edges" | `src/modules/media/application/boundary-probe-defs.ts` | `publicUrl` from `@/modules/definitions/application` | refused by `boundaries/dependencies` |
| "allows submissions to import media's public entry point" | `src/modules/submissions/application/boundary-probe-media.ts` | `stageFile` from `@/modules/media/application` | clean |

- [ ] **Step 2: Run** `pnpm test src/modules/media tests/boundaries`: they fail.

- [ ] **Step 3: Implement** the four port files and `deps.ts` exactly as in Interfaces (each port file imports only shared ports and the media domain), `job-types.ts`, then:
  - `stageFile` (comment: refusals are validation errors shown to the submitter, never job failures; `media-storage.md`, "File handling rules"): in this order, a body over `maxBytes` is `file_too_large`; a sniffed type outside `ACCEPTED_TYPES`, or of a kind not in `accept`, is `file_wrong_type`; an image goes through `encoder.reencode` (null is `file_unreadable`) and takes the encoder's bytes and content type; a video must pass `isWellFormedIsoBmff` (else `file_unreadable`) and keeps its bytes. Only then a new id from `deps.ids`, the key `stagingKey(recordId, id, extensionFor(contentType))` and one `staging.put`. Nothing is written before every check passes.
  - `attachToSubmission` (inside the intake transaction, `architecture.md`, "Submission data flow" step 3): per file, one `staged` row with the staged file's id, content type, size and staging ref, `providerRef: null`, both timestamps `clock.now()`, and one `media.upload` job with `{ mediaId }`.
  - `discardStaged` deletes each ref; `discardRecordFiles` deletes `stagingPrefix(recordId)`.
  - `testing/fakes.ts` (header: synthetic bytes only): `fakeImage(type = "image/jpeg", size = 64)` is `mime:<type>;` zero-padded to `size`. `InMemoryStorage.put` copies the bytes and returns the key (rejects with `storage unavailable` when `failPut`); `viewUrl` returns `memory://<ref>`; `read` rejects for a missing ref; `deletePrefix` removes matching keys. `FakeSniffer` and `FakeEncoder` behave as in Interfaces (the encoder keeps PNG and WebP, everything else becomes JPEG). `InMemoryMediaRepository` stores copies, `insert` rejects a duplicate id, `listBySubmission` sorts by field key then position, the `mark*` and `clearStaging` methods patch the row and its `updatedAt`. `makeMediaDeps` fills every port with these fakes and the shared ones, honouring overrides.
  - `index.ts` (public API): the domain types and `MEDIA_KINDS`, `extensionFor`, `fieldSlug`, `uniqueFieldSlugs`, `durableKey`; the deps and port types; the stage, attach types; `stageFile`, `attachToSubmission`, `discardStaged`, `discardRecordFiles`, `MEDIA_JOB_TYPES`.

- [ ] **Step 4: Run** `pnpm test src/modules/media tests/boundaries && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(media): staging, attaching and discarding files behind storage, sniffer and encoder ports`

---

### Task 7: Media adapters: content sniffing and image re-encoding

**Files:**
- Create: `src/modules/media/infrastructure/file-type-sniffer.ts`, `sharp-image-encoder.ts`, `libheif-js.d.ts`, with `file-type-sniffer.test.ts` and `sharp-image-encoder.test.ts` beside them
- Modify: `next.config.ts` (`serverExternalPackages`)

**Interfaces:**
- Consumes: `ContentSniffer`, `ImageEncoder`, `EncodedImage` (Task 6); `tests/fakes/media-files.ts` (Task 5).
- Produces: `class FileTypeSniffer implements ContentSniffer`, `class SharpImageEncoder implements ImageEncoder` with `export const MAX_INPUT_PIXELS = 50_000_000`.

These adapters do no I/O beyond CPU work on bytes, so their tests run in the unit suite against the real libraries.

- [ ] **Step 1: Failing tests.** `file-type-sniffer.test.ts`:

```ts
describe("FileTypeSniffer", () => {
  const sniffer = new FileTypeSniffer();

  it("names each accepted type by its content", async () => {
    expect(await sniffer.sniff(await syntheticJpegWithGps())).toBe("image/jpeg");
    expect(await sniffer.sniff(await syntheticPng())).toBe("image/png");
    expect(await sniffer.sniff(await syntheticWebp())).toBe("image/webp");
    expect(await sniffer.sniff(syntheticHeic())).toMatch(/^image\/hei[cf]$/);
    expect(await sniffer.sniff(syntheticMp4())).toBe("video/mp4");
    expect(await sniffer.sniff(syntheticMp4("qt  "))).toBe("video/quicktime");
  });

  it("ignores names and declared types: HTML is not an image whatever it is called", async () => {
    expect(await sniffer.sniff(htmlPretendingToBeJpeg())).toBeNull();
    expect(await sniffer.sniff(new Uint8Array())).toBeNull();
  });
});
```

`sharp-image-encoder.test.ts`:

```ts
describe("SharpImageEncoder", () => {
  const encoder = new SharpImageEncoder();

  it("re-encodes a JPEG with every metadata block removed", async () => {
    const input = await syntheticJpegWithGps();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await encoder.reencode(input, "image/jpeg");
    expect(out?.contentType).toBe("image/jpeg");
    const meta = await sharp(out?.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    expect([meta.width, meta.height]).toEqual([64, 48]);
  });

  it("keeps PNG and WebP in their own format", async () => {
    expect((await encoder.reencode(await syntheticPng(), "image/png"))?.contentType).toBe("image/png");
    expect((await encoder.reencode(await syntheticWebp(), "image/webp"))?.contentType).toBe("image/webp");
  });

  it("decodes HEIC and encodes it as JPEG", async () => {
    const out = await encoder.reencode(syntheticHeic(), "image/heic");
    expect(out?.contentType).toBe("image/jpeg");
    const meta = await sharp(out?.bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 16, 16]);
  });

  it("returns null for a truncated JPEG, bytes that do not decode as the type, and an unknown type", async () => {
    const jpeg = await syntheticJpegWithGps();
    expect(await encoder.reencode(jpeg.subarray(0, Math.floor(jpeg.length / 2)), "image/jpeg")).toBeNull();
    expect(await encoder.reencode(await syntheticPng(), "image/heic")).toBeNull();
    expect(await encoder.reencode(jpeg, "image/gif")).toBeNull();
  });

  it("refuses images above the pixel limit", async () => {
    const huge = await sharp({ create: { width: 8000, height: 7000, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
    expect(await encoder.reencode(new Uint8Array(huge), "image/jpeg")).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `pnpm test src/modules/media/infrastructure`: fails, the adapters do not exist.

- [ ] **Step 3: Implement.**
  - `FileTypeSniffer.sniff`: null for empty input, else `(await fileTypeFromBuffer(bytes))?.mime ?? null` (magic numbers only, ADR 0023).
  - `libheif-js.d.ts` declares `libheif-js/wasm-bundle` (the package ships no types): a default export `{ HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImage[] } }` where `HeifImage` has `get_width()`, `get_height()` and `display(target: { data: Uint8ClampedArray; width: number; height: number }, done: (result: { data: Uint8ClampedArray } | null) => void)`.
  - `SharpImageEncoder.reencode` (doc comment: sharp writes no metadata unless asked; ADR 0023): wraps everything in `try`/`catch` returning null. JPEG, PNG and WebP go through `sharp(bytes, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).rotate()` and are written in their own format (JPEG and WebP at quality 85); `image/heic` and `image/heif` decode the first image with `libheif.HeifDecoder`, refuse above `MAX_INPUT_PIXELS`, render RGBA through `display` (a null result is null), and encode the raw pixels (`raw: { width, height, channels: 4 }`) with sharp as JPEG quality 85; any other type is null. The non-obvious point: `failOn: "error"` is what turns a truncated JPEG into a refusal instead of a grey half image.
  - `next.config.ts`: `serverExternalPackages: ["sharp", "libheif-js"]`.

- [ ] **Step 4: Run** `pnpm test src/modules/media && pnpm lint && pnpm typecheck && pnpm format:check && pnpm build`.
- [ ] **Step 5: Commit** `feat(media): content sniffing with file-type and metadata-free re-encoding with sharp and libheif-js`

---

### Task 8: Media persistence: local disk storage, the `media` table and its repository

**Files:**
- Create: `src/modules/media/infrastructure/local-disk-storage.ts`, `pg-media-repository.ts`, `migrations/0006_media.sql`
- Test: `tests/integration/media/local-disk-storage.test.ts`, `tests/integration/media/pg-media-repository.test.ts`

**Interfaces:**
- Consumes: `StagingStorage`, `MediaRepository`, `MediaRecord` (Tasks 5, 6); `txOf`, `isUuid`.
- Produces:

```ts
export class LocalDiskStorage implements StagingStorage {
  /** `viewPath` maps a ref to the admin route that will stream it (the review plan builds the route). */
  constructor(root: string, viewPath?: (ref: string) => string);
}
export class PgMediaRepository implements MediaRepository { constructor(pool: Pool) }
```

Migration `0006_media.sql` (exact):

```sql
-- Owned by the media module. No foreign key to submission: deletion runs through
-- media.delete so a provider outage never leaves a row pointing at nothing.
create table media (
  id uuid primary key,
  submission_id uuid not null,
  form_id uuid not null,
  field_key text not null,
  position integer not null check (position >= 1),
  kind text not null check (kind in ('image', 'video')),
  status text not null check (status in ('staged', 'stored', 'failed')),
  content_type text not null,
  size bigint not null check (size >= 0),
  staging_ref text,
  durable_key text not null,
  provider_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_submission_field_position_key unique (submission_id, field_key, position)
);
```

The unique constraint's index also serves lookups by `submission_id`, so no second index is created.

**The repository pattern** (every Postgres repository in this plan follows it; later tasks say "per the repository pattern in Task 8"): a `COLUMNS` constant lists the table's columns once; a `<Name>Row` interface types them in snake case and a `to<Name>` mapper converts to the domain record (camel case; `bigint` columns arrive as strings and go through `Number`; `jsonb` arrives parsed). Reads use the pool; writes and `for update` reads use `txOf(uow).client`. Any id argument that fails `isUuid` returns null or an empty list without querying, since a malformed id can never match and must not reach Postgres as a cast error. Constraint names surface in the thrown error unchanged.

- [ ] **Step 1: Failing integration tests.** `tests/integration/media/local-disk-storage.test.ts`:

```ts
describe("LocalDiskStorage", () => {
  let root: string;
  let storage: LocalDiskStorage;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "effluz-staging-"));
    storage = new LocalDiskStorage(root);
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("puts, reads, checks and deletes a file under its key, owner-only", async () => {
    const ref = await storage.put(new Uint8Array([1, 2, 3]), "in-progress/rec/a.jpg", "image/jpeg");
    expect(ref).toBe("in-progress/rec/a.jpg");
    expect(await storage.read(ref)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await storage.exists(ref)).toBe(true);
    expect((await stat(path.join(root, ref))).mode & 0o777).toBe(0o600);
    await storage.delete(ref);
    await storage.delete(ref);
    expect(await storage.exists(ref)).toBe(false);
  });
});
```

and, on the same fresh temporary root:
- "overwrites the same key and leaves no temporary files": two puts of `[1]` then `[2]` at `in-progress/rec/a.jpg` read back `[2]`, and `in-progress/rec` lists only `a.jpg`.
- "deletes a whole prefix and removes emptied directories": with `in-progress/one/a.jpg`, `in-progress/one/b.jpg` and `in-progress/two/c.jpg` stored, `deletePrefix("in-progress/one/")` leaves `in-progress` listing `["two"]`; deleting `in-progress/two/c.jpg` leaves the root empty.
- "refuses refs that escape the root": `put` at `../outside.jpg` and `read("/etc/passwd")` reject with `/escapes/`.
- "gives the admin view path for a ref": `viewUrl("in-progress/rec/a.jpg", 60)` is `/admin/media/local/in-progress%2Frec%2Fa.jpg`.

`tests/integration/media/pg-media-repository.test.ts`:

```ts
const at = new Date("2026-10-10T12:00:00.000Z");

function record(over: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: randomUUID(), submissionId: "11111111-1111-4111-8111-111111111111", formId: "22222222-2222-4222-8222-222222222222",
    fieldKey: "photos", position: 1, kind: "image", status: "staged", contentType: "image/jpeg", size: 1234,
    stagingRef: "in-progress/r/a.jpg", durableKey: "forms/s/HP-0001/01-photos.jpg", providerRef: null,
    createdAt: at, updatedAt: at, ...over,
  };
}

describe("PgMediaRepository", () => {
  const pool = testPool();
  const repo = new PgMediaRepository(pool);
  const uow = new PgUnitOfWorkFactory(pool);
  beforeEach(() => truncateAll(pool));

  it("round-trips a row and lists a submission's rows by field and position", async () => {
    const second = record({ position: 2 });
    const first = record();
    await uow.run(async (u) => {
      await repo.insert(u, second);
      await repo.insert(u, first);
    });
    expect(await repo.findById(first.id)).toEqual(first);
    expect((await repo.listBySubmission(first.submissionId)).map((r) => r.position)).toEqual([1, 2]);
    expect(await repo.findById("not-a-uuid")).toBeNull();
  });

  it("refuses two rows at the same position of a field", async () => {
    await uow.run((u) => repo.insert(u, record()));
    await expect(uow.run((u) => repo.insert(u, record()))).rejects.toThrow(/media_submission_field_position_key/);
  });

  it("marks stored, clears staging, marks failed and deletes", async () => {
    const r = record();
    await uow.run((u) => repo.insert(u, r));
    const later = new Date("2026-10-10T13:00:00.000Z");
    await uow.run((u) => repo.markStored(u, r.id, "/forms/s/HP-0001/01-photos.jpg", later));
    await uow.run((u) => repo.clearStaging(u, r.id, later));
    expect(await repo.findById(r.id)).toMatchObject({ status: "stored", providerRef: "/forms/s/HP-0001/01-photos.jpg", stagingRef: null, updatedAt: later });
    await uow.run((u) => repo.markFailed(u, r.id, later));
    expect((await repo.findById(r.id))?.status).toBe("failed");
    await uow.run((u) => repo.delete(u, r.id));
    expect(await repo.findById(r.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `pnpm db:up && pnpm test:integration tests/integration/media`: fails.

- [ ] **Step 3: Implement.** Write the migration above.
  - `LocalDiskStorage` (doc comment: the staging tier, and the durable tier when `MEDIA_PROVIDER=local`; `media-storage.md`): the root is `path.resolve`d; every ref resolves under it or throws `media ref escapes the storage root`. `put` creates parent directories with mode `0o700`, writes `<file>.<uuid>.tmp` with mode `0o600` and renames it over the target (atomic, idempotent per key), returning the key. `delete` is `rm --force` and then removes emptied parent directories up to, not including, the root. `exists` is false for a missing file but rethrows the escape error. `deletePrefix` removes the prefix directory recursively, then emptied parents. `viewUrl` returns `viewPath(ref)`, by default `/admin/media/local/<encodeURIComponent(ref)>`.
  - `PgMediaRepository` per the repository pattern above; `listBySubmission` orders by `field_key, position`; the three updates set their columns and `updated_at`.

- [ ] **Step 4: Run** `pnpm test:integration tests/integration/media && pnpm test && pnpm lint && pnpm typecheck && pnpm format:check`; confirm the migration runner picked up `src/modules/media/infrastructure/migrations/`.
- [ ] **Step 5: Commit** `feat(media): local disk storage, the media table and its repository`

---

### Task 9: Media adapter: Dropbox over `fetch`

**Files:**
- Create: `src/modules/media/infrastructure/dropbox-storage.ts`, `tests/fakes/dropbox-api.ts`
- Test: `tests/integration/media/dropbox-storage.test.ts`

**Interfaces:**
- Consumes: `MediaStorage` (Task 6).
- Produces:

```ts
export interface DropboxConfig {
  appKey: string; appSecret: string; refreshToken: string;
  apiUrl: string;        // https://api.dropboxapi.com
  contentUrl: string;    // https://content.dropboxapi.com
  fetch?: typeof fetch;
  now?: () => number;
}
export class DropboxStorage implements MediaStorage { constructor(config: DropboxConfig) }
// tests/fakes/dropbox-api.ts
export interface FakeDropbox {
  url: string;                                   // serves both the api and content hosts
  files: Map<string, Uint8Array>;                // by path
  calls: string[];                               // endpoint paths in order
  tokenRefreshes: number;
  failNext(status: number, body?: unknown): void;
  revokeTokens(): void;                          // the next authenticated call gets 401 expired_access_token
  close(): Promise<void>;
}
export async function startFakeDropbox(): Promise<FakeDropbox>;
```

Refs are the key with a leading `/` (the path inside the App folder). Error messages carry the endpoint and status, never a path.

- [ ] **Step 1: The fake server** `tests/fakes/dropbox-api.ts`: a `node:http` server on `127.0.0.1:0` (synthetic data only) that records every request path in `calls` and answers:
  - `/oauth2/token`: counts a refresh, issues `token-<n+1>` with `expires_in: 14400`, 200.
  - Any other path without `Authorization: Bearer <current token>`: 401 `{ error_summary: "expired_access_token/", error: { ".tag": "expired_access_token" } }`.
  - A status queued by `failNext(status, body = { error_summary: "too_many_requests/" })`: answered once, before the endpoint logic.
  - `/2/files/upload`: stores the body under the `Dropbox-API-Arg` header's `path`; 200 `{ id: "id:fake", path_lower, size }`.
  - `/2/files/get_metadata` and `/2/files/get_temporary_link` (JSON body `{ path }`): 200 `{ ".tag": "file", path_lower }` or `{ link: "https://dl.example.com<path>" }` when the file exists, else 409 `{ error_summary: "path/not_found/", error: { ".tag": "path", path: { ".tag": "not_found" } } }`.
  - `/2/files/delete_v2`: deletes and answers 200 `{ metadata: { path_lower } }`, or 409 `{ error_summary: "path_lookup/not_found/", … }` for a missing file.
  - Anything else: 404. `revokeTokens()` sets the current token to `revoked`; `tokenRefreshes` is a getter over the counter.

- [ ] **Step 2: Failing integration test** `tests/integration/media/dropbox-storage.test.ts`:

```ts
describe("DropboxStorage against a fake Dropbox", () => {
  let fake: FakeDropbox;
  let clock: number;
  let storage: DropboxStorage;
  beforeEach(async () => {
    fake = await startFakeDropbox();
    clock = Date.parse("2026-10-10T12:00:00Z");
    storage = new DropboxStorage({
      appKey: "app-key", appSecret: "app-secret", refreshToken: "refresh-token",
      apiUrl: fake.url, contentUrl: fake.url, now: () => clock,
    });
  });
  afterEach(() => fake.close());

  const key = "forms/historia-prematuro-2026/HP-0001/01-photos.jpg";

  it("exchanges the refresh token once, uploads with overwrite, and answers exists", async () => {
    const ref = await storage.put(new Uint8Array([1, 2]), key, "image/jpeg");
    expect(ref).toBe(`/${key}`);
    expect(fake.files.get(ref)).toEqual(new Uint8Array([1, 2]));
    expect(await storage.exists(ref)).toBe(true);
    expect(await storage.exists("/forms/missing.jpg")).toBe(false);
    expect(fake.tokenRefreshes).toBe(1);
  });

  it("renews the access token once on a 401 and retries the call", async () => {
    await storage.put(new Uint8Array([1]), key, "image/jpeg");
    fake.revokeTokens();
    expect(await storage.exists(`/${key}`)).toBe(true);
    expect(fake.tokenRefreshes).toBe(2);
  });

  it("treats deleting a missing file as success", async () => {
    await storage.put(new Uint8Array([1]), key, "image/jpeg");
    await storage.delete(`/${key}`);
    await storage.delete(`/${key}`);
    expect(fake.files.size).toBe(0);
  });

  it("caches temporary links for less than their four hours", async () => {
    await storage.put(new Uint8Array([1]), key, "image/jpeg");
    const first = await storage.viewUrl(`/${key}`, 3600);
    expect(first).toBe(`https://dl.example.com/${key}`);
    await storage.viewUrl(`/${key}`, 3600);
    expect(fake.calls.filter((c) => c === "/2/files/get_temporary_link")).toHaveLength(1);
    clock += 3600 * 1000;
    await storage.viewUrl(`/${key}`, 3600);
    expect(fake.calls.filter((c) => c === "/2/files/get_temporary_link")).toHaveLength(2);
  });

  it("throws a retryable error naming only the endpoint and status on 429 and 5xx", async () => {
    fake.failNext(429);
    await expect(storage.put(new Uint8Array([1]), key, "image/jpeg")).rejects.toThrow("dropbox files/upload failed with 429");
    fake.failNext(503);
    await expect(storage.exists(`/${key}`)).rejects.toThrow("dropbox files/get_metadata failed with 503");
  });
});
```

- [ ] **Step 3: Run** `pnpm test:integration tests/integration/media/dropbox-storage.test.ts`: fails.

- [ ] **Step 4: Implement** `DropboxStorage` (doc comment: an App folder reached with a refresh token through plain `fetch`, ADR 0002; rate limits and server errors throw so the job system retries, nothing retries inline):
  - `put` posts the bytes to `<contentUrl>/2/files/upload` with `Content-Type: application/octet-stream` and `Dropbox-API-Arg` = `{ path: "/" + key, mode: "overwrite", mute: true }` as JSON with every character above U+007E escaped as `\uXXXX` (the header must be ASCII); returns the path.
  - `exists` (`files/get_metadata`) and `delete` (`files/delete_v2`) post JSON `{ path }` to `<apiUrl>/2/<endpoint>`; a 409 whose body contains `not_found` means false and success respectively. `delete` also drops the cached link.
  - `viewUrl` returns a cached link while it is valid; otherwise `files/get_temporary_link`, cached for `min(ttlSeconds, 4 hours minus 5 minutes)`.
  - Every call carries `Authorization: Bearer <access token>`. The token comes from `<apiUrl>/oauth2/token` (form body `grant_type=refresh_token`, `refresh_token`, `client_id`, `client_secret`) and is kept in memory until 60 seconds before `expires_in` runs out. A 401 discards the token and retries the call once.
  - Any other non-2xx throws `dropbox <endpoint> failed with <status>` after cancelling the body.

- [ ] **Step 5: Run** `pnpm test:integration tests/integration/media && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 6: Commit** `feat(media): Dropbox storage over fetch with token renewal and cached temporary links`

---

### Task 10: Media job handlers: `media.upload` and `media.delete`

**Files:**
- Create: `src/modules/media/application/jobs.ts`, `jobs.test.ts`
- Modify: `src/modules/media/application/index.ts` (export the two factories)
- Test: `tests/integration/media/upload-job.test.ts`

**Interfaces:**
- Consumes: `MediaDeps`, `MEDIA_JOB_TYPES` (Task 6); `PermanentJobError`, `handlerContext` (Task 2).
- Produces:

```ts
export function createMediaUploadHandler(deps: MediaDeps): JobHandler;   // payload { mediaId }
export function createMediaDeleteHandler(deps: MediaDeps): JobHandler;   // payload { mediaId }
```

Behavior. Upload: a missing row ends the job (the submission was deleted); without a provider ref, read staging, `put` under `durableKey` (idempotent), `markStored`; then delete the staging copy and `clearStaging`. Each step is safe to repeat, so a crash anywhere is fixed by the retry. On the last attempt, or a `PermanentJobError` such as a missing staging copy, the row becomes `failed` (staging kept) before the error is rethrown. Delete: the durable copy, then staging, then the row, in that order (`media-storage.md`, "Lifecycle"). Logs carry the media id only.

- [ ] **Step 1: Failing unit tests** `jobs.test.ts`:

```ts
const ID = "00000009-0000-4000-8000-000000000009";

async function seed(deps: FakeMediaDeps): Promise<void> {
  await deps.staging.put(new Uint8Array([7]), "in-progress/r/x.jpg", "image/jpeg");
  await deps.media.insert(await deps.uow.begin(), {
    id: ID, submissionId: "sub-1", formId: "form-1", fieldKey: "photos", position: 1, kind: "image",
    status: "staged", contentType: "image/jpeg", size: 1, stagingRef: "in-progress/r/x.jpg",
    durableKey: "forms/s/HP-0001/01-photos.jpg", providerRef: null, createdAt: deps.clock.now(), updatedAt: deps.clock.now(),
  });
}

describe("media.upload", () => {
  it("copies staging to durable storage, records the ref, then drops the staging copy", async () => {
    const deps = makeMediaDeps();
    await seed(deps);
    await createMediaUploadHandler(deps)({ mediaId: ID }, handlerContext());
    expect(deps.durable.files.get("forms/s/HP-0001/01-photos.jpg")?.bytes).toEqual(new Uint8Array([7]));
    expect(deps.staging.files.size).toBe(0);
    expect(deps.media.rows.get(ID)).toMatchObject({ status: "stored", providerRef: "forms/s/HP-0001/01-photos.jpg", stagingRef: null });
  });

  it("is idempotent: a second run after success changes nothing", async () => {
    const deps = makeMediaDeps();
    await seed(deps);
    const handler = createMediaUploadHandler(deps);
    await handler({ mediaId: ID }, handlerContext());
    await handler({ mediaId: ID }, handlerContext());
    expect(deps.media.rows.get(ID)?.status).toBe("stored");
  });

  it("ends quietly when the row no longer exists", async () => {
    const deps = makeMediaDeps();
    await expect(createMediaUploadHandler(deps)({ mediaId: ID }, handlerContext())).resolves.toBeUndefined();
  });

  it("keeps staging and the row staged on an ordinary failure, and marks failed on the last attempt", async () => {
    const deps = makeMediaDeps();
    await seed(deps);
    deps.durable.failPut = true;
    const handler = createMediaUploadHandler(deps);
    await expect(handler({ mediaId: ID }, handlerContext({ attempt: 1, maxAttempts: 8 }))).rejects.toThrow();
    expect(deps.media.rows.get(ID)?.status).toBe("staged");
    await expect(handler({ mediaId: ID }, handlerContext({ attempt: 8, maxAttempts: 8 }))).rejects.toThrow();
    expect(deps.media.rows.get(ID)?.status).toBe("failed");
    expect(deps.staging.files.size).toBe(1);
  });

  it("fails permanently on a payload without a media id", async () => {
    await expect(createMediaUploadHandler(makeMediaDeps())({}, handlerContext())).rejects.toThrow(/mediaId/);
  });
});

describe("media.delete", () => {
  it("removes the durable copy, the staging copy and the row", async () => {
    const deps = makeMediaDeps();
    await seed(deps);
    await createMediaUploadHandler(deps)({ mediaId: ID }, handlerContext());
    await createMediaDeleteHandler(deps)({ mediaId: ID }, handlerContext());
    expect(deps.durable.files.size).toBe(0);
    expect(deps.media.rows.has(ID)).toBe(false);
  });
});
```

`tests/integration/media/upload-job.test.ts`, one case, "moves a staged file to the durable directory and marks the row stored": real adapters (`LocalDiskStorage` for staging and durable under a `mkdtemp` directory removed after the test, `FileTypeSniffer`, `SharpImageEncoder`, `PgMediaRepository`, `PgJobQueue(systemIdGenerator, systemClock)`, `PgUnitOfWorkFactory`, `systemIdGenerator`, `systemClock`); stage the bytes `[9]` at `in-progress/r/a.jpg`, insert a `staged` row with id `33333333-3333-4333-8333-333333333333`, `durableKey: "forms/s/HP-0001/01-photos.jpg"`; run the handler with `handlerContext({ uow })`; expect `durable.read("forms/s/HP-0001/01-photos.jpg")` to equal `[9]`, `staging.exists("in-progress/r/a.jpg")` false, and the row `{ status: "stored", stagingRef: null }`.

- [ ] **Step 2: Run** `pnpm test src/modules/media/application/jobs.test.ts`: fails.

- [ ] **Step 3: Implement** `jobs.ts` (doc comment links `jobs.md` and `media-storage.md`, "Lifecycle"). A `mediaIdOf(payload)` helper throws `PermanentJobError("payload has no mediaId")` when `payload.mediaId` is not a string. The upload handler follows Behavior above, each repository write in its own `deps.uow.run`; the `catch` marks the row `failed` only when the error is a `PermanentJobError` or `ctx.attempt >= ctx.maxAttempts`, then rethrows. It logs `media no longer exists` or `media stored` with `{ mediaId }`. The delete handler returns quietly for a missing row and logs `media deleted`. Export both from `index.ts`.

- [ ] **Step 4: Run** `pnpm test src/modules/media && pnpm test:integration tests/integration/media && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(media): idempotent media.upload and media.delete job handlers`

---

### Task 11: Notifications application: ports, delivery and the two email handlers

**Files:**
- Create: `src/modules/notifications/application/ports/email-sender.ts`, `ports/email-renderer.ts`, `ports/message-source.ts`, `ports/delivery-log.ts`, `deps.ts`, `jobs.ts`, `enqueue.ts`, `index.ts`, `testing/fakes.ts`
- Test: `jobs.test.ts`, `enqueue.test.ts` beside them; `tests/boundaries/boundaries.test.ts` (one probe)

**Interfaces:**
- Consumes: `PermanentJobError`, `handlerContext`, `InMemoryJobQueue` (Task 2).
- Produces:

```ts
// ports/email-sender.ts
export interface OutgoingEmail { to: readonly string[]; subject: string; text: string; html: string }
export interface EmailSender { send(email: OutgoingEmail): Promise<{ providerMessageId: string }> }
export class EmailSendError extends Error { constructor(message: string, readonly permanent: boolean) }   // name "EmailSendError"
// ports/email-renderer.ts
export interface RenderedEmail { subject: string; text: string; html: string }
export interface SubmitterConfirmationData {
  locale: Locale; formTitle: string; subject: string; body: string;   // body: rich-text source from the version
  receivedOn: string; reference: string; retentionMonths: number; contact: string;
}
export interface StaffNotificationData { formTitle: string; reference: string; receivedAt: string; link: string }
export interface EmailRenderer {
  submitterConfirmation(data: SubmitterConfirmationData): RenderedEmail;
  staffNotification(data: StaffNotificationData): RenderedEmail;
}
// ports/message-source.ts
export interface MessageSource {
  submitterConfirmation(submissionId: string): Promise<{ to: string; data: SubmitterConfirmationData } | null>;
  staffNotification(submissionId: string): Promise<{ to: string[]; data: StaffNotificationData } | null>;
}
// ports/delivery-log.ts
export interface DeliveryLog {
  find(key: string): Promise<string | null>;                          // the provider message id, or null
  record(key: string, providerMessageId: string, at: Date): Promise<void>;
}
// deps.ts
export interface NotificationsDeps { sender: EmailSender; renderer: EmailRenderer; source: MessageSource; deliveries: DeliveryLog }
// jobs.ts
export const EMAIL_JOB_TYPES = {
  submitterConfirmation: "email.submitter_confirmation", staffNotification: "email.staff_notification",
} as const;
export function createSubmitterConfirmationHandler(deps: NotificationsDeps): JobHandler;   // payload { submissionId }
export function createStaffNotificationHandler(deps: NotificationsDeps): JobHandler;       // payload { submissionId }
// enqueue.ts
export async function enqueueSubmissionEmails(
  queue: JobQueue, uow: UnitOfWork,
  input: { submissionId: string; submitterConfirmation: boolean; staffNotification: boolean },
): Promise<void>;
// testing/fakes.ts
export class RecordingEmailSender implements EmailSender { readonly sent: OutgoingEmail[]; failWith: EmailSendError | null }
export class StubMessageSource implements MessageSource {
  confirmation: { to: string; data: SubmitterConfirmationData } | null;
  staff: { to: string[]; data: StaffNotificationData } | null;
}
export class InMemoryDeliveryLog implements DeliveryLog { readonly entries: Map<string, string> }
export const stubRenderer: EmailRenderer;   // subject/text/html built from the data fields, for assertions
export interface FakeNotificationsDeps extends NotificationsDeps { sender: RecordingEmailSender; source: StubMessageSource; deliveries: InMemoryDeliveryLog }
export function makeNotificationsDeps(over?: Partial<FakeNotificationsDeps>): FakeNotificationsDeps;
```

Decision (email idempotency): the delivery key is `<job type>:<submission id>`; the provider id is recorded in the `notifications`-owned `email_delivery` table under it before the job succeeds, and a run that finds the key sends nothing (ADR 0025). Decision (staff notification): one job per submission, one message to the form's recipient list as it stands when the job runs.

- [ ] **Step 1: Failing tests.** `jobs.test.ts`:

```ts
const SUB = "00000005-0000-4000-8000-000000000005";
const confirmation = {
  to: "family@example.com",
  data: {
    locale: "es" as const, formTitle: "Historias", subject: "Gracias", body: "Recibimos **todo**.",
    receivedOn: "10 de octubre de 2026", reference: "HP-0001", retentionMonths: 12, contact: "privacy@example.com",
  },
};

describe("email.submitter_confirmation", () => {
  it("renders, sends once to the submitter and records the provider id", async () => {
    const deps = makeNotificationsDeps();
    deps.source.confirmation = confirmation;
    const handler = createSubmitterConfirmationHandler(deps);
    await handler({ submissionId: SUB }, handlerContext());
    await handler({ submissionId: SUB }, handlerContext());
    expect(deps.sender.sent).toHaveLength(1);
    expect(deps.sender.sent[0]).toMatchObject({ to: ["family@example.com"], subject: "Gracias" });
    expect(deps.deliveries.entries.get(`email.submitter_confirmation:${SUB}`)).toBe("msg-1");
  });

  it("logs the submission id and never the address", async () => {
    const deps = makeNotificationsDeps();
    deps.source.confirmation = confirmation;
    const ctx = handlerContext();
    await createSubmitterConfirmationHandler(deps)({ submissionId: SUB }, ctx);
    const lines = JSON.stringify((ctx.logger as unknown as { lines: unknown[] }).lines);
    expect(lines).toContain(SUB);
    expect(lines).not.toContain("@");
  });
});
```

More cases, on fresh `makeNotificationsDeps()`:
- "ends without sending when the submission is gone or has no address": no `source.confirmation` → the handler resolves and `sender.sent` is `[]`.
- "fails permanently on a permanent provider error and retries otherwise": with `source.confirmation = confirmation`, `failWith = new EmailSendError("smtp2go rejected the recipient", true)` rejects with `{ name: "PermanentJobError" }`; `failWith = new EmailSendError("smtp2go failed with 503", false)` rejects with `{ name: "EmailSendError" }`; `deliveries.entries` stays empty.
- `describe("email.staff_notification")`, "sends one message to every recipient": `source.staff = { to: ["stories@example.com", "team@example.com"], data: { formTitle: "Stories", reference: "HP-0001", receivedAt: "2026-10-10 09:00 America/Panama, 14:00 UTC", link: "https://forms.example.com/admin/forms/f1" } }` → `sent.map((m) => m.to)` equals `[["stories@example.com", "team@example.com"]]`.
- `enqueue.test.ts`, "enqueues only the messages asked for, with the submission id as the only payload": `enqueueSubmissionEmails(queue, uow, { submissionId: "s1", submitterConfirmation: false, staffNotification: true })` → `queue.enqueued` equals `[{ type: "email.staff_notification", payload: { submissionId: "s1" }, opts: {} }]`.

Boundary probe inside `describe("layer boundaries")`, per the probe pattern in Task 2 (`notifications` has no edges at all; media's entry point stands for any other module): "forbids notifications importing any other module", probe file `src/modules/notifications/application/boundary-probe-subs.ts`, importing `stageFile` from `@/modules/media/application`, refused by `boundaries/dependencies`.

- [ ] **Step 2: Run** `pnpm test src/modules/notifications tests/boundaries`: fails.

- [ ] **Step 3: Implement** the ports and `deps.ts` as listed, then:
  - `jobs.ts`: `submissionIdOf(payload)` throws `PermanentJobError("payload has no submissionId")` for a non-string. A private `deliver(deps, ctx, type, submissionId, build)` (doc comment links `email.md`, "Ports") checks `deliveries.find("<type>:<id>")` first (found: log `email already sent`, return); calls `build()`, which asks the `MessageSource` and renders through the `EmailRenderer` (null or no recipients: log `email not applicable`, return); sends `{ to, ...rendered }`; records the provider id with `ctx.clock.now()`; logs `email sent`. Every log line carries `{ submissionId }` only. An `EmailSendError` with `permanent` becomes `PermanentJobError(message)`; anything else is rethrown. The confirmation handler sends to `[found.to]`, the staff handler to `found.to`.
  - `enqueue.ts` (inside the intake transaction; payload ids only): one `queue.enqueue` per message asked for, confirmation first, with `{ submissionId }`.
  - `testing/fakes.ts` (header: synthetic addresses only, example.com): `RecordingEmailSender.send` rejects with `failWith` when set, else records a copy and returns `msg-<n>`. `StubMessageSource` returns its two fields. `InMemoryDeliveryLog.record` keeps the first id for a key. `stubRenderer` builds `subject: d.subject`, `text: "<body> <reference>"` for the confirmation and `subject: "New <reference>"`, `text: d.link` for staff, `html: "<p><reference></p>"` for both. `makeNotificationsDeps` uses these unless overridden.
  - `index.ts` (public API): `NotificationsDeps`; `EmailSender`, `OutgoingEmail`, `EmailSendError`; `EmailRenderer`, `RenderedEmail`, `StaffNotificationData`, `SubmitterConfirmationData`; `MessageSource`; `DeliveryLog`; `EMAIL_JOB_TYPES` and both handler factories; `enqueueSubmissionEmails`.

- [ ] **Step 4: Run** `pnpm test src/modules/notifications tests/boundaries && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(notifications): email ports, idempotent delivery and the confirmation and staff notification handlers`

---

### Task 12: Email templates in `src/shared/presentation/email/`

**Files:**
- Create: `src/shared/presentation/email/copy.ts`, `layout.ts`, `confirmation.ts`, `staff-notification.ts`, `index.ts`, `email.test.ts`, `copy.test.ts`

**Interfaces:**
- Consumes: `parseRichText`, `richTextToPlain`, `escapeHtml`, `richTextToHtml`, `specTableRows` (Task 3).
- Produces:

```ts
// copy.ts
export const confirmationParts: Record<"Preheader" | "Footer line 1" | "Footer line 2", { en: string; es: string }>;
export const staffParts: Record<"Subject" | "Preheader" | "Intro" | "Reference" | "Received" | "Link" | "Footer", string>;
export function fillTemplate(text: string, vars: Readonly<Record<string, string>>): string;  // {form title}, {ref}, ...
// layout.ts
export const BODY_STYLE: { paragraph: string; link: string };
export function emailDocument(input: { lang: "en" | "es"; title: string; preheader: string; bodyHtml: string; footer: readonly string[] }): string;
// confirmation.ts, structural twins of notifications' types (shared may not import modules)
export interface ConfirmationEmailData { locale: "en" | "es"; formTitle: string; subject: string; body: string; receivedOn: string; reference: string; retentionMonths: number; contact: string }
export interface EmailParts { subject: string; text: string; html: string }
export function renderSubmitterConfirmation(data: ConfirmationEmailData): EmailParts;
// staff-notification.ts
export interface StaffEmailData { formTitle: string; reference: string; receivedAt: string; link: string }
export function renderStaffNotification(data: StaffEmailData): EmailParts;
// index.ts
export const emailTemplates: { submitterConfirmation: typeof renderSubmitterConfirmation; staffNotification: typeof renderStaffNotification };
```

The layout is flat, as Task 1 writes into `email.md`, "Templates": `copy.ts`, `layout.ts`, one module per template, each rendering EN and ES (the staff notification is English only), each with a text and an HTML body. The templates are plain TypeScript (no React), so the worker can render them without loading Next.js. HTML is table-based, inline-styled with design-system colors, readable with images blocked (there are none). Plain text is written, not derived from the HTML, and carries the same words. Staff-authored subject and body are escaped; newlines in the subject become spaces so no header can be injected.

- [ ] **Step 1: Failing tests.** `copy.test.ts`:

```ts
describe("email copy", () => {
  it("matches the confirmation email's fixed parts in renderer.md, both languages", () => {
    const rows = specTableRows("specs/ui-ux/renderer.md", "Confirmation email, fixed parts");
    expect(Object.fromEntries([...rows].map(([k, [en, es]]) => [k, { en, es }]))).toEqual(confirmationParts);
  });

  it("matches the staff notification's fixed parts in email.md", () => {
    const rows = specTableRows("specs/system/email.md", "Staff notification, fixed parts");
    expect(Object.fromEntries([...rows].map(([k, [en]]) => [k, en]))).toEqual(staffParts);
  });

  it("fills placeholders with spaces in their names and leaves unknown ones", () => {
    expect(fillTemplate("{form title}: {ref} {x}", { "form title": "Stories", ref: "HP-0001" })).toBe("Stories: HP-0001 {x}");
  });
});
```

`email.test.ts`:

```ts
const base = {
  formTitle: "Historias <de prueba>",
  subject: "Gracias\r\nBcc: someone@example.com",
  body: "Recibimos tu historia.\n\n- Revisaremos las **fotos**\n- [Ejemplo](https://example.com/post)",
  receivedOn: "10 de octubre de 2026",
  reference: "HP-0001",
  retentionMonths: 12,
  contact: "privacy@example.com",
};

describe("renderSubmitterConfirmation", () => {
  for (const locale of ["en", "es"] as const) {
    it(`renders the ${locale} message, text and HTML with the same words`, () => {
      const email = renderSubmitterConfirmation({ ...base, locale });
      expect(email).toMatchSnapshot();
      expect(email.subject).toBe("Gracias Bcc: someone@example.com");
      expect(email.html).not.toContain("<de prueba>");
      expect(email.html).toContain("Historias &lt;de prueba&gt;");
      expect(email.html).not.toMatch(/<img|<script|tracking/i);
      expect(email.html).toContain(`lang="${locale}"`);
      for (const words of ["HP-0001", "12", "privacy@example.com", "Revisaremos las"]) {
        expect(email.text).toContain(words);
        expect(email.html).toContain(words);
      }
    });
  }
});

describe("renderStaffNotification", () => {
  it("renders the English notification with no answers", () => {
    const email = renderStaffNotification({
      formTitle: "Stories",
      reference: "HP-0001",
      receivedAt: "2026-10-10 09:00 America/Panama, 14:00 UTC",
      link: "https://forms.example.com/admin/forms/f1",
    });
    expect(email).toMatchSnapshot();
    expect(email.subject).toBe("New submission to Stories: HP-0001");
    expect(email.text).toContain("Open it in the manager: https://forms.example.com/admin/forms/f1");
    expect(email.html).toContain('href="https://forms.example.com/admin/forms/f1"');
  });
});
```

- [ ] **Step 2: Run** `pnpm test src/shared/presentation/email`: fails.

- [ ] **Step 3: Implement.**
  - `copy.ts` (header names the owning spec tables; `copy.test.ts` keeps them equal): transcribe every row of `renderer.md`, "Confirmation email, fixed parts" into `confirmationParts` (`{ en, es }` per part) and every row of `email.md`, "Staff notification, fixed parts" into `staffParts`, `as const`. `fillTemplate` replaces `/\{([a-z][a-z ]*)\}/g` with the variable or leaves the placeholder; the result is text, never markup.
  - `layout.ts`: colors from `design-system/tokens.json`, each named in a comment: text `color.text.default` (#372549), muted `color.text.muted` (#774C60), page `color.surface.page.public` (#FFF3EF), card `color.surface.card` (#FFFFFF), border `color.border.default` (#EFF0F5); font stack `font.family.sans`. `BODY_STYLE.paragraph` is `margin:0 0 16px;font:17px/1.6 <font>;color:<text>`, `BODY_STYLE.link` is `color:<text>;text-decoration:underline`. `emailDocument` writes `<!doctype html><html lang>`, a charset and viewport meta, the escaped `<title>`, a hidden preheader span, an outer presentation table on the page color and an inner one (`max-width:640px`, card color, 1 px border, 12 px radius) holding `bodyHtml` and the escaped footer lines in the muted color at 15 px. Every argument but `bodyHtml` is escaped.
  - `renderSubmitterConfirmation`: variables `form title`, `date` (= `receivedOn`), `ref`, `retention`, `contact`; the subject is the staff subject with `[\r\n]+` collapsed to a space and trimmed; text is preheader, blank line, `richTextToPlain(body)`, blank line, `--`, the two footer lines; HTML is `emailDocument` with `richTextToHtml(body, BODY_STYLE)`.
  - `renderStaffNotification`: variables `form title`, `ref`, `date` (= `receivedAt`), `link`; body paragraphs Intro, Reference, Received, then the Link label followed by `<a href>` of the escaped link; text lists the same lines and the filled Link line, then `--` and the Footer; `lang="en"`.
  - `index.ts` exports both renderers, their types, and `emailTemplates` (comment: satisfies notifications' `EmailRenderer` structurally; wired at the composition root).

- [ ] **Step 4: Run** `pnpm test src/shared/presentation/email`; read the two written snapshots in `__snapshots__/email.test.ts.snap` once and confirm both locales read correctly with no placeholders left; then `pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(shared): confirmation and staff notification email templates, snapshot-tested per locale`

---

### Task 13: Notifications adapters: SMTP2GO, Mailpit and the delivery log

**Files:**
- Create: `src/modules/notifications/infrastructure/smtp2go-email-sender.ts`, `mailpit-email-sender.ts`, `mailbox.ts`, `pg-delivery-log.ts`, `migrations/0007_email_delivery.sql`, `tests/fakes/http-stub.ts`
- Test: `src/modules/notifications/infrastructure/mailbox.test.ts`; `tests/integration/notifications/smtp2go-email-sender.test.ts`, `mailpit-email-sender.test.ts`, `pg-delivery-log.test.ts`

**Interfaces:**
- Consumes: `EmailSender`, `EmailSendError`, `DeliveryLog` (Task 11).
- Produces:

```ts
export function parseMailbox(value: string): { name: string | null; email: string };   // "Effluz Forms <forms@forms.effluz.com>"
export class Smtp2goEmailSender implements EmailSender {
  constructor(config: { apiKey: string; apiUrl: string; from: string; replyTo: string; fetch?: typeof fetch });
}
export class MailpitEmailSender implements EmailSender {
  constructor(config: { url: string; from: string; replyTo: string; fetch?: typeof fetch });
}
export class PgDeliveryLog implements DeliveryLog { constructor(pool: Pool) }
// tests/fakes/http-stub.ts
export interface StubRequest { method: string; path: string; headers: Record<string, string>; body: string }
export interface HttpStub { url: string; requests: StubRequest[]; reply(status: number, body: unknown): void; close(): Promise<void> }
export async function startHttpStub(): Promise<HttpStub>;   // answers each request with the queued replies, then 200 {}
```

Migration `0007_email_delivery.sql` (exact):

```sql
-- Owned by notifications. One row per sent message, so a retried job sends nothing.
create table email_delivery (
  id uuid primary key,
  delivery_key text not null,
  provider_message_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_delivery_key unique (delivery_key)
);
```

Decision (local email): `MailpitEmailSender` posts to Mailpit's `POST /api/v1/send`, which returns an `ID`, so the local path exercises the same message-id bookkeeping as SMTP2GO.

- [ ] **Step 1: The stub server** `tests/fakes/http-stub.ts`: a `node:http` server on `127.0.0.1:0` that records every request (method, path, headers stringified, UTF-8 body) and answers JSON with the next queued `reply(status, body)`, or 200 `{}` when none is queued.

- [ ] **Step 2: Failing tests.** `mailbox.test.ts`:

```ts
describe("parseMailbox", () => {
  it("reads a display name and address, or a bare address", () => {
    expect(parseMailbox("Effluz Forms <forms@forms.example.com>")).toEqual({ name: "Effluz Forms", email: "forms@forms.example.com" });
    expect(parseMailbox("forms@forms.example.com")).toEqual({ name: null, email: "forms@forms.example.com" });
  });
});
```

`tests/integration/notifications/smtp2go-email-sender.test.ts`:

```ts
const message = { to: ["family@example.com"], subject: "Gracias", text: "Hola", html: "<p>Hola</p>" };

describe("Smtp2goEmailSender", () => {
  let stub: HttpStub;
  let sender: Smtp2goEmailSender;
  beforeEach(async () => {
    stub = await startHttpStub();
    sender = new Smtp2goEmailSender({ apiKey: "api-key", apiUrl: stub.url, from: "Effluz Forms <forms@forms.example.com>", replyTo: "team@example.com" });
  });
  afterEach(() => stub.close());

  it("posts the message with the key header and returns the email id", async () => {
    stub.reply(200, { request_id: "r1", data: { succeeded: 1, failed: 0, failures: [], email_id: "1qHg2-abc" } });
    expect(await sender.send(message)).toEqual({ providerMessageId: "1qHg2-abc" });
    const [req] = stub.requests;
    expect(req?.path).toBe("/email/send");
    expect(req?.headers["x-smtp2go-api-key"]).toBe("api-key");
    expect(JSON.parse(req?.body ?? "{}")).toEqual({
      sender: "Effluz Forms <forms@forms.example.com>",
      to: ["family@example.com"],
      subject: "Gracias",
      text_body: "Hola",
      html_body: "<p>Hola</p>",
      custom_headers: [{ header: "Reply-To", value: "team@example.com" }],
    });
  });

  it("classes a 400 and a failed recipient as permanent, 429 and 5xx as retryable, without addresses in messages", async () => {
    stub.reply(400, { data: { error_code: "E_ApiResponseCodes.NON_VALIDATING_IN_PAYLOAD" } });
    await expect(sender.send(message)).rejects.toMatchObject({ permanent: true });
    stub.reply(200, { data: { succeeded: 0, failed: 1, failures: ["family@example.com"] } });
    const failed = await sender.send(message).catch((e: unknown) => e);
    expect(failed).toMatchObject({ permanent: true });
    expect(String((failed as Error).message)).not.toContain("@");
    stub.reply(429, {});
    await expect(sender.send(message)).rejects.toMatchObject({ permanent: false });
    stub.reply(503, {});
    await expect(sender.send(message)).rejects.toMatchObject({ permanent: false });
  });

  it("classes an unreachable provider as retryable", async () => {
    const offline = new Smtp2goEmailSender({ apiKey: "k", apiUrl: "http://127.0.0.1:1", from: "a@example.com", replyTo: "b@example.com" });
    await expect(offline.send(message)).rejects.toMatchObject({ permanent: false });
  });
});
```

`tests/integration/notifications/mailpit-email-sender.test.ts`, "sends through Mailpit's API and returns its message id": with the stub replying 200 `{ ID: "mailpit-1" }`, a sender `{ url: stub.url, from: "Effluz Forms <forms@forms.example.com>", replyTo: "team@example.com" }` sending `{ to: ["a@example.com", "b@example.com"], subject: "S", text: "T", html: "<p>H</p>" }` returns `{ providerMessageId: "mailpit-1" }`, posts to `/api/v1/send`, and its JSON body equals `{ From: { Email: "forms@forms.example.com", Name: "Effluz Forms" }, To: [{ Email: "a@example.com" }, { Email: "b@example.com" }], ReplyTo: [{ Email: "team@example.com" }], Subject: "S", Text: "T", HTML: "<p>H</p>" }`.

`tests/integration/notifications/pg-delivery-log.test.ts`, "records a key once and finds it": `find("email.staff_notification:s1")` is null; after `record(…, "msg-1")` and `record(…, "msg-2")` it is `msg-1`.

- [ ] **Step 3: Run** `pnpm test src/modules/notifications && pnpm test:integration tests/integration/notifications`: fails.

- [ ] **Step 4: Implement.**
  - `parseMailbox`: `/^\s*(.*?)\s*<([^<>\s]+)>\s*$/` gives name (null when empty) and address; anything else is a bare trimmed address.
  - `Smtp2goEmailSender.send` (doc comment: ADR 0006; messages carry provider codes and statuses only, never addresses): POST `<apiUrl>/email/send` with `X-Smtp2go-Api-Key` and the JSON body the test shows (`sender` is `EMAIL_FROM` as configured). A thrown `fetch` is `EmailSendError("smtp2go is unreachable", false)`; 400 is permanent `smtp2go refused the message (<error_code or "no code">)`; other non-2xx is retryable `smtp2go failed with <status>` (this covers 401, 403, 429 and 5xx); a 200 with `succeeded < 1` or no `email_id` is permanent `smtp2go rejected the recipient`.
  - `MailpitEmailSender.send`: POST `<url>/api/v1/send` with the JSON body the test shows (`From.Name` only when the mailbox has one); unreachable is retryable; a non-2xx is `mailpit failed with <status>`, permanent only for 400; returns `ID`.
  - `PgDeliveryLog`: `find` selects `provider_message_id` by `delivery_key`; `record` inserts with a random id and `created_at = updated_at = at`, `on conflict (delivery_key) do nothing`, so the first write wins.

- [ ] **Step 5: Run** `pnpm test src/modules/notifications && pnpm test:integration tests/integration/notifications && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 6: Commit** `feat(notifications): SMTP2GO and Mailpit senders and the email delivery log`

---

### Task 14: Definitions for the renderer: public lookup, versions and reference allocation

**Files:**
- Create: `src/modules/definitions/domain/reference.ts`, `reference.test.ts`, `src/modules/definitions/application/public-form.ts`, `public-form.test.ts`, `src/modules/definitions/infrastructure/migrations/0008_form_reference_counter.sql`
- Modify: `src/modules/definitions/domain/form.ts` (+ `publicState`), `form.test.ts`, `application/ports/form-repository.ts` (+ `takeReferenceNumber`), `infrastructure/pg-form-repository.ts`, `application/testing/fakes.ts` (counter, `seedPublished`, `publishAgain`), `application/index.ts`
- Test: `tests/integration/definitions/allocate-reference.test.ts`

**Interfaces:**
- Consumes: `Form`, `reachability`, `FormRepository` (with `findForUpdate`), `VersionRepository`, `DefinitionsDeps` (existing).
- Produces:

```ts
// domain/reference.ts
export function formatReference(prefix: string, n: number): string;     // "HP-0001"; at least four digits
// domain/form.ts
export type PublicState = "open" | "closed" | "not_open_yet" | "not_found";
export function publicState(form: Form, now: Date): PublicState;
// ports/form-repository.ts
/** Takes the form's next reference number and advances the counter; the caller holds the form row lock. Never touches updated_at. */
takeReferenceNumber(uow: UnitOfWork, formId: string): Promise<number>;
// application/public-form.ts
export type PublicFormResult =
  | { state: "open"; form: Form; version: FormVersion }
  | { state: "closed"; form: Form }
  | { state: "not_open_yet"; form: Form; opensAt: string }
  | { state: "not_found" };
export async function resolvePublicForm(deps: DefinitionsDeps, slug: string): Promise<PublicFormResult>;
export async function loadVersion(deps: DefinitionsDeps, versionId: string): Promise<FormVersion | null>;
export async function loadForm(deps: DefinitionsDeps, formId: string): Promise<Form | null>;
export type AllocateReferenceResult =
  | { ok: true; reference: string; form: Form }
  | { ok: false; state: "closed" | "not_open_yet" | "not_found" };
export async function allocateReference(deps: DefinitionsDeps, uow: UnitOfWork, formId: string): Promise<AllocateReferenceResult>;
// testing/fakes.ts
export async function seedPublished(deps: FakeDefinitionsDeps, input: { slug: string; document: Version; settings?: Partial<FormSettings>; status?: FormStatus }): Promise<{ formId: string; versionId: string }>;
export function publishAgain(deps: FakeDefinitionsDeps, formId: string, document: Version): string;   // a new version id, made current
```

Public states from the form: never published, or archived without a version, is `not_found`; `closed`, archived after publishing, and past the close date are `closed`; before the open date is `not_open_yet`; otherwise `open`.

Decision (reference sequence, ADR 0025): `form.next_reference` (starts at 1) is advanced only by `allocateReference`, which locks the form row with `findForUpdate`, decides `publicState` again on the locked row (so a close that commits first wins), and takes the number in the same unit of work as the submission, so a rolled-back intake gives its number back. Taking a number leaves `form.updated_at` alone: a submission is not a form edit, and the manager's "last edited" must not move. `submissions` never writes a `definitions` table. Decision (resolving `/f/<slug>`): `resolvePublicForm`, `loadVersion` and `loadForm` are read use cases for the renderer; `shareInfo` stays admin-only.

Migration `0008_form_reference_counter.sql` (exact):

```sql
-- The per-form submission reference sequence; see allocateReference.
alter table form add column next_reference integer not null default 1 check (next_reference >= 1);
```

- [ ] **Step 1: Failing tests.** `reference.test.ts`:

```ts
describe("formatReference", () => {
  it("pads to four digits and grows past them", () => {
    expect(formatReference("HP", 1)).toBe("HP-0001");
    expect(formatReference("HP", 12345)).toBe("HP-12345");
  });
});
```

Append to `form.test.ts`, with the helper `sampleFormForState(patch)` at the top (a draft `Form` with id `00000000-0000-4000-8000-000000000001`, slug `sample-form`, title `{ en: "Sample" }`, `languages: "en"`, `defaultSettings("sample-form")`, no current version, not archived, both timestamps `2026-10-01T00:00:00Z`, then `...patch`):

```ts
describe("publicState", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const published = sampleFormForState({ status: "published", currentVersionId: "v1" });
  it("follows status, then the date window", () => {
    expect(publicState(sampleFormForState({ status: "draft" }), now)).toBe("not_found");
    expect(publicState(sampleFormForState({ status: "archived" }), now)).toBe("not_found");
    expect(publicState(sampleFormForState({ status: "archived", currentVersionId: "v1" }), now)).toBe("closed");
    expect(publicState(sampleFormForState({ status: "closed", currentVersionId: "v1" }), now)).toBe("closed");
    expect(publicState(published, now)).toBe("open");
    expect(publicState({ ...published, settings: { ...published.settings, opensAt: "2026-10-11T00:00:00.000Z" } }, now)).toBe("not_open_yet");
    expect(publicState({ ...published, settings: { ...published.settings, closesAt: "2026-10-10T12:00:00.000Z" } }, now)).toBe("closed");
  });
});
```

`public-form.test.ts`, with `document(title = "Stories")` parsing an English draft (confirmation `Thanks`, one page `page_one` with a `short_text` `f_name` labelled `Name`) and each case on fresh `makeDefinitionsDeps()`:
- `resolvePublicForm`, "returns the current version of an open form, and the state otherwise": after `seedPublished({ slug: "spring-stories", document: document() })` the slug resolves to `open` with that version id; `missing-form` is `{ state: "not_found" }`; with the stored form's status set to `closed`, the slug's state is `closed`.
- `resolvePublicForm`, "gives the open date when not yet open": `later-form` seeded with `opensAt: "2026-12-01T12:00:00.000Z"` matches `{ state: "not_open_yet", opensAt: "2026-12-01T12:00:00.000Z" }`.
- `loadVersion`, "still returns an older version after a republish": after `publishAgain(deps, formId, document("Stories v2"))`, the first version id still loads with title `{ en: "Stories" }`.
- `allocateReference`, "hands out the prefix and a sequence per form, and refuses a closed form": seeded with `referencePrefix: "SS"`, two calls in one unit of work give `SS-0001` and `SS-0002`; with the form closed the third is `{ ok: false, state: "closed" }`.

`tests/integration/definitions/allocate-reference.test.ts` builds real `DefinitionsDeps` (`PgFormRepository`, `PgDraftRepository`, `PgVersionRepository`, `NullSubmissionStats`, `PgAuditLog`, `PgAuditLogReader`, `PgUnitOfWorkFactory`, `systemClock`, `systemIdGenerator`, `buildDefaultRegistry()`, `allowedRecipientDomains: ["effluz.com"]`, `publicBaseUrl: "http://localhost:3000"`) and a helper `publishedForm()` that inserts `sampleForm({ status: "published" })` and `sampleVersion(form.id, 1)` from `./factories` and makes the version current. Cases:

```ts
  it("gives five concurrent intakes five distinct consecutive references", async () => {
    const formId = await publishedForm();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => deps.uow.run((uow) => allocateReference(deps, uow, formId))),
    );
    const refs = results.map((r) => (r.ok ? r.reference.split("-")[1] : "x")).sort();
    expect(refs).toEqual(["0001", "0002", "0003", "0004", "0005"]);
  });

  it("gives a rolled-back number back", async () => {
    const formId = await publishedForm();
    await expect(
      deps.uow.run(async (uow) => {
        await allocateReference(deps, uow, formId);
        throw new Error("intake failed");
      }),
    ).rejects.toThrow("intake failed");
    const next = await deps.uow.run((uow) => allocateReference(deps, uow, formId));
    expect(next.ok && next.reference.endsWith("-0001")).toBe(true);
  });

  it("advances next_reference without touching the form's updated_at", async () => {
    const formId = await publishedForm();
    const row = async () =>
      (await pool.query<{ next_reference: number; updated_at: Date }>("select next_reference, updated_at from form where id = $1", [formId])).rows[0];
    const before = await row();
    await deps.uow.run((uow) => allocateReference(deps, uow, formId));
    const after = await row();
    expect(after?.next_reference).toBe((before?.next_reference ?? 0) + 1);
    expect(after?.updated_at).toEqual(before?.updated_at);
  });
```

- [ ] **Step 2: Run** `pnpm test src/modules/definitions && pnpm test:integration tests/integration/definitions`: fails.

- [ ] **Step 3: Implement.**
  - `formatReference`: `<prefix>-<n padded to 4>` (`form-definition.md`, "Submissions").
  - `publicState` maps `reachability(form, now)`: reachable is `open`; reason `draft` is `not_found`; `archived` is `not_found` without a current version and `closed` with one; `closed` and `past_close` are `closed`; `not_open_yet` stays. Doc comment links `fill-and-submit-form.md`.
  - `PgFormRepository.takeReferenceNumber`: `update form set next_reference = next_reference + 1 where id = $1 returning next_reference - 1 as n` through `txOf(uow)`; no row throws `form <id> does not exist`. The statement does not set `updated_at`.
  - `resolvePublicForm`: `findBySlug`; null is `not_found`; otherwise the `publicState` result, with `opensAt` from the settings for `not_open_yet`, and for `open` the current version (`findCurrent`; none is `not_found`). `loadVersion` is `versions.findById` (versions are immutable, so callers may cache); `loadForm` is `forms.findById`.
  - `allocateReference` (doc comment links `database.md`): `findForUpdate(uow, formId)` (null is `not_found`), `publicState` on the locked row, then `takeReferenceNumber` and `formatReference(form.settings.referencePrefix, n)`.
  - Fakes: `InMemoryFormRepository` keeps a `counters` map; `takeReferenceNumber` requires the form, returns the current counter (default 1) and advances it, leaving the stored form untouched. `seedPublished` calls `seedForm` with the slug, languages and title of the document, stores version 1 (`publishedBy: EDITOR.email`), and sets status (default `published`), the current version and merged settings. `publishAgain` stores the next version number and makes it current.
  - `index.ts`: export `resolvePublicForm`, `loadVersion`, `loadForm`, `allocateReference`, `formatReference`, `publicState` and the types `PublicFormResult`, `AllocateReferenceResult`, `PublicState`.

- [ ] **Step 4: Run** `pnpm test && pnpm test:integration tests/integration/definitions && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(definitions): public form lookup, version loading and reference allocation under the form lock`

---

### Task 15: Manager: say that the bot challenge is not available yet

**Files:**
- Modify: `specs/ui-ux/manager.md` ("Settings tab" first-pass bullets and the "Settings and share" copy table), `src/shared/presentation/copy.ts`, `src/modules/definitions/presentation/SettingsForm.tsx`, `src/modules/definitions/presentation/settings-form.test.ts`

**Interfaces:**
- Produces: copy key `set.challenge_unavailable`; the bot challenge checkbox's `aria-describedby` names its hint and the unavailable note.

This ships the manager spec change with the code that binds it, so `src/shared/presentation/copy.test.ts` never sees a spec row without a binding.

- [ ] **Step 1: Spec.** In `specs/ui-ux/manager.md`, "Settings tab", first-pass list, add: "- The bot challenge is not built yet. The toggle still saves, and `set.challenge_unavailable` sits under its help line." In "Settings and share", after the `set.challenge_hint` row, add `| set.challenge_unavailable | Not available yet: forms show no bot check even when this is on. | Aún no está disponible: los formularios no muestran la verificación aunque esté activada. |`.

- [ ] **Step 2: Failing test.** In `settings-form.test.ts`, beside "links every field to its help line" (which keeps its `botChallenge` row), add:

```ts
  it("tells staff the bot challenge is not available yet, next to the setting", () => {
    const html = render();
    const ids = describedBy(control(html, "botChallenge"));
    const texts = ids.map((id) => {
      const start = html.indexOf(tagWithId(html, id));
      return html.slice(start, html.indexOf("</p>", start));
    });
    expect(texts.join(" ")).toContain(copy["set.challenge_hint"].en);
    expect(texts.join(" ")).toContain(copy["set.challenge_unavailable"].en);
  });
```

- [ ] **Step 3: Run** `pnpm test src/shared/presentation src/modules/definitions/presentation`: the copy test fails (spec row without binding) and the new test fails.

- [ ] **Step 4: Implement.** `src/shared/presentation/copy.ts`, after `set.challenge_hint`, binds the row (both languages as in Step 1). `SettingsForm.tsx`, Protection section: the checkbox's `aria` call becomes `aria("challenge", [id("challenge", "hint"), id("challenge", "unavailable")])`, and after `{hint("challenge", "set.challenge_hint")}` add `{hint("challenge", "set.challenge_unavailable", "unavailable")}`.

- [ ] **Step 5: Run** `pnpm test && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 6: Commit** `feat(definitions): note in Settings that the bot challenge is not available yet`

---

### Task 16: Submissions domain: the in-progress record, navigation, protection and intake planning

**Files:**
- Create: `src/modules/submissions/domain/in-progress.ts`, `navigation.ts`, `locale.ts`, `protection.ts`, `dates.ts`, `intake.ts`, `submission.ts`, `testing/versions.ts`
- Test: `in-progress.test.ts`, `navigation.test.ts`, `locale.test.ts`, `protection.test.ts`, `intake.test.ts` beside them

**Interfaces:**
- Consumes: `validatePage`, `visiblePages`, `UploadLimits`, `asKey` (Task 4 and the form model).
- Produces:

```ts
// in-progress.ts
export const IN_PROGRESS_TTL_MS = 86_400_000;
export type RawValues = Record<string, string | string[]>;
export type FileIssueCode = "file_too_large" | "file_wrong_type" | "file_unreadable" | "upload_failed" | "submission_too_large";
/** A refused file of a post without script: the browser's name, carried in that post's own answer only, never stored. */
export interface RefusedFile { fieldKey: string; code: FileIssueCode; name: string }
/** The last refused post of a page: what was typed and why it was refused. No file is named. */
export interface PendingPage { pageKey: string; raw: RawValues; issues: ValidationIssue[] }
/** Structural twin of media's StagedFile; a domain may not import another module. */
export interface StagedUpload { id: string; stagingRef: string; kind: "image" | "video"; contentType: string; size: number }
export interface InProgress {
  id: string; formId: string; versionId: string; locale: Locale; pageKey: string;
  answers: Record<string, unknown>;                 // valid, normalized answers; never file fields
  files: Record<string, StagedUpload[]>;            // by field key, in upload order
  pending: PendingPage | null; submitToken: string; startedAt: Date; expiresAt: Date; createdAt: Date; updatedAt: Date;
}
export function newInProgress(input: { id: string; formId: string; versionId: string; locale: Locale; pageKey: string; submitToken: string; startedAt: Date; now: Date }): InProgress;
export function isExpired(record: Pick<InProgress, "expiresAt">, now: Date): boolean;
export function clampStartedAt(renderedAt: Date | null, now: Date): Date;
export function withFileAnswers(answers: Readonly<Record<string, unknown>>, files: Readonly<Record<string, readonly StagedUpload[]>>): Record<string, unknown>;
export function removeUpload(files: Readonly<Record<string, readonly StagedUpload[]>>, fileId: string): { files: Record<string, StagedUpload[]>; removed: StagedUpload | null };
export function stagedBytes(files: Readonly<Record<string, readonly StagedUpload[]>>): number;   // sum of sizes across fields
// navigation.ts
export function visiblePageKeys(version: Version, answers: Readonly<Record<string, unknown>>, registry: FieldTypeRegistry): string[];
export function firstPageKey(version: Version, registry: FieldTypeRegistry): string;
export function nextPageKey(version: Version, answers: Readonly<Record<string, unknown>>, registry: FieldTypeRegistry, current: string): string | null;
export function previousPageKey(version: Version, answers: Readonly<Record<string, unknown>>, registry: FieldTypeRegistry, current: string): string | null;
export function pagePosition(version: Version, answers: Readonly<Record<string, unknown>>, registry: FieldTypeRegistry, current: string): { n: number; total: number };
// locale.ts
export function pickLocale(languages: Languages, acceptLanguage: string | null): Locale;   // bilingual: browser, falling back to Spanish
export function localeFor(languages: Languages, wanted: Locale): Locale;                  // wanted when the form offers it
// protection.ts
export const MIN_FILL_MS = 3_000;
export const HONEYPOT_FIELD = "website-url";
export function isHoneypotFilled(honeypot: string): boolean;
export function isSilentAccept(input: { honeypot: string; startedAt: Date; now: Date }): boolean;
export function decoyReference(prefix: string, random: () => number): string;
// dates.ts
export function todayIn(timeZone: string, now: Date): string;                              // YYYY-MM-DD in that zone
// intake.ts
export function uploadFields(version: Version, registry: FieldTypeRegistry): { field: Field; limits: UploadLimits }[];
export function firstLanguage(languages: Languages): Locale;                               // en unless the form is es-only
export interface PlannedFile { fieldKey: string; position: number; upload: StagedUpload }
export function planFiles(answers: Readonly<Record<string, unknown>>, files: Readonly<Record<string, readonly StagedUpload[]>>): { attached: PlannedFile[]; discarded: StagedUpload[] };
export function submitterAddress(version: Version, registry: FieldTypeRegistry, answers: Readonly<Record<string, unknown>>): string | null;
export function firstPageWithIssue(version: Version, issues: readonly ValidationIssue[]): string | null;
// submission.ts
export interface Submission {
  id: string; formId: string; versionId: string; locale: Locale; answers: Record<string, unknown>;
  consent: { fieldKey: string; textVersion: string; acceptedAt: Date } | null;
  receivedAt: Date; reference: string; submitToken: string;
}
// testing/versions.ts (shared by the module's tests)
export const registry: FieldTypeRegistry;
export const CONSENT_TEXT: LocalizedText;
export function storyVersion(): Version;   // three pages: contact (name, submitter email, has_baby), baby (photos, shown when has_baby = yes_opt), consent
```

Decision (minimum fill time): 3 seconds from the page 1 render; `clampStartedAt` turns the first post's `_rendered` value into `started_at`, never in the future and never older than 24 hours, and an absent or unreadable value into the time of that post. Decision (honeypot): the input `website-url`; any non-blank value is a silent accept, checked on every post (Task 19 and Task 21). Decision (original filename never persisted): a refused file's name lives only in `RefusedFile`, which the post's own answer renders (Tasks 19, 28). `PendingPage` stores the typed values and the validation issues and nothing about refused files: such a file was never staged, so there is nothing to show about it later.

- [ ] **Step 1: The test fixture** `src/modules/submissions/domain/testing/versions.ts` (synthetic, shared by the module's tests): `registry = buildDefaultRegistry()`; `CONSENT_TEXT` is `{ en: "I am an adult and agree that Effluz keeps these synthetic answers for 12 months.", es: "Soy mayor de edad y acepto que Effluz guarde estas respuestas sintéticas durante 12 meses." }`; `storyVersion()` parses (and throws on issues) a bilingual draft titled `Stories` / `Historias` with confirmation screen `Thank you.` / `Gracias.` and email subject `Thanks` / `Gracias`, body `We got it.` / `Lo recibimos.`, and three pages:
  - `page_contact` (`Contact` / `Contacto`): `f_name` `short_text` `Name` / `Nombre`, required; `f_email` `email` `Email` / `Correo` with `isSubmitterAddress: true`; `f_baby` `single_choice` `Baby?` / `¿Bebé?`, required, options `yes_opt` (`Yes` / `Sí`) and `no_opt` (`No` / `No`).
  - `page_baby` (`Photos` / `Fotos`), visible when `f_baby` equals `yes_opt`: `f_photos` `file_upload` `Photos` / `Fotos`, required, rule `min_files` 1, settings `{ kinds: ["image", "video"], maxFiles: 3, maxSizeMb: 10 }`.
  - `page_consent` (`Consent` / `Consentimiento`): `f_consent` `consent` `Consent` / `Consentimiento`, required, settings `{ text: CONSENT_TEXT, coveredItems: [...consentItems] }`.

- [ ] **Step 2: Failing tests.** `in-progress.test.ts`:

```ts
const now = new Date("2026-10-10T12:00:00Z");
const upload = (id: string, size = 1) => ({ id, stagingRef: `in-progress/r/${id}.jpg`, kind: "image" as const, contentType: "image/jpeg", size });

describe("in-progress record", () => {
  it("lives 24 hours from creation, expiring exactly at the limit", () => {
    const r = newInProgress({ id: "r", formId: "f", versionId: "v", locale: "es", pageKey: "page_contact", submitToken: "t", startedAt: now, now });
    expect(r.expiresAt.toISOString()).toBe("2026-10-11T12:00:00.000Z");
    expect(isExpired(r, new Date("2026-10-11T11:59:59.999Z"))).toBe(false);
    expect(isExpired(r, new Date("2026-10-11T12:00:00.000Z"))).toBe(true);
  });

  it("clamps the render time into the last 24 hours, and reads absent or broken as now", () => {
    expect(clampStartedAt(new Date("2026-10-10T11:59:50Z"), now)).toEqual(new Date("2026-10-10T11:59:50Z"));
    expect(clampStartedAt(new Date("2026-10-10T13:00:00Z"), now)).toEqual(now);
    expect(clampStartedAt(new Date("2026-10-08T00:00:00Z"), now)).toEqual(new Date("2026-10-09T12:00:00Z"));
    expect(clampStartedAt(null, now)).toEqual(now);
    expect(clampStartedAt(new Date("garbage"), now)).toEqual(now);
  });

  it("answers file fields with the staged ids in upload order, and removes one upload", () => {
    const files = { f_photos: [upload("a"), upload("b")] };
    expect(withFileAnswers({ f_name: "Ana" }, files)).toEqual({ f_name: "Ana", f_photos: ["a", "b"] });
    const { files: left, removed } = removeUpload(files, "a");
    expect(left).toEqual({ f_photos: [upload("b")] });
    expect(removed?.id).toBe("a");
    expect(removeUpload(files, "zzz").removed).toBeNull();
  });

  it("sums the staged sizes across fields", () => {
    expect(stagedBytes({ f_photos: [upload("a", 10), upload("b", 5)], f_video: [upload("c", 100)] })).toBe(115);
    expect(stagedBytes({})).toBe(0);
  });
});
```

More domain cases:
- `navigation.test.ts`, "skips a hidden page in both directions and in the count", on `storyVersion()`: `firstPageKey` is `page_contact`; `nextPageKey` from `page_contact` is `page_consent` with `{ f_baby: "no_opt" }` and `page_baby` with `{ f_baby: "yes_opt" }`; `previousPageKey` from `page_consent` with `no_opt` is `page_contact`; `nextPageKey` from `page_consent` with `{}` is null; `pagePosition` of `page_consent` is `{ n: 2, total: 2 }` with `no_opt` and `{ n: 3, total: 3 }` with `yes_opt`.
- `locale.test.ts`, "uses the form's only language, else the browser's preference, else Spanish": `pickLocale("en", "es-PA,es;q=0.9")` is `en`; `pickLocale("bilingual", …)` is `en` for `fr-FR,en-US;q=0.8,es;q=0.5` and for `es;q=0.4,en;q=0.9`, and `es` for `de, fr` and for null. "keeps a wanted locale only when the form offers it": `localeFor("bilingual", "en")` is `en`; `localeFor("es", "en")` is `es`.
- `protection.test.ts` (`startedAt = 2026-10-10T12:00:00.000Z`): "catches a filled honeypot and anything faster than 3 seconds" (honeypot `http://spam.example` at 12:05 is true; blank at 12:00:02.999 is true; `"  "` at 12:00:03.000 is false); "calls a honeypot filled only when it holds more than blanks" (`"x"` true, `" \t"` false); "makes a four-digit decoy reference with the form's prefix" (`decoyReference("HP", () => 0)` is `HP-1000`, with `() => 0.9999` `HP-9999`).

`intake.test.ts`:

```ts
const upload = (id: string) => ({ id, stagingRef: `in-progress/r/${id}.jpg`, kind: "image" as const, contentType: "image/jpeg", size: 1 });

describe("intake planning", () => {
  it("attaches files the final answers name, in answer order, and discards the rest", () => {
    const plan = planFiles({ f_photos: ["b", "a"] }, { f_photos: [upload("a"), upload("b"), upload("c")], f_hidden: [upload("d")] });
    expect(plan.attached.map((p) => [p.fieldKey, p.position, p.upload.id])).toEqual([["f_photos", 1, "b"], ["f_photos", 2, "a"]]);
    expect(plan.discarded.map((u) => u.id).sort()).toEqual(["c", "d"]);
  });

  it("finds upload fields, the submitter's address and the first page with an issue", () => {
    const v = storyVersion();
    expect(uploadFields(v, registry).map((u) => [u.field.key, u.limits.maxFiles])).toEqual([["f_photos", 3]]);
    expect(submitterAddress(v, registry, { f_email: "family@example.com" })).toBe("family@example.com");
    expect(submitterAddress(v, registry, {})).toBeNull();
    expect(
      firstPageWithIssue(v, [
        { code: "consent", field: asKey("f_consent") },
        { code: "required", field: asKey("f_photos") },
      ]),
    ).toBe("page_baby");
    expect(firstLanguage("bilingual")).toBe("en");
    expect(firstLanguage("es")).toBe("es");
  });

  it("gives today's date in the form's time zone", () => {
    expect(todayIn("America/Panama", new Date("2026-10-11T03:00:00Z"))).toBe("2026-10-10");
    expect(todayIn("UTC", new Date("2026-10-11T03:00:00Z"))).toBe("2026-10-11");
  });
});
```

- [ ] **Step 3: Run** `pnpm test src/modules/submissions/domain`: fails.

- [ ] **Step 4: Implement.**
  - `in-progress.ts` (TTL comment links `fill-and-submit-form.md`; `RefusedFile` and `PendingPage` carry the doc comments above): `newInProgress` adds empty answers, files and pending, `expiresAt = now + 24 h`, both timestamps `now`. `isExpired` is `now >= expiresAt`. `clampStartedAt` returns `now` for null or an invalid date, else the render time clamped into `[now - 24 h, now]` (comment links `security.md`). `withFileAnswers` sets each upload field to its staged ids in order. `removeUpload` filters the id out of every field and returns the removed upload or null. `stagedBytes` sums `size` over every field.
  - `navigation.ts`: `visiblePageKeys` maps `visiblePages`; `firstPageKey` is the first visible page with no answers (falling back to the first page); `nextPageKey` and `previousPageKey` walk `version.pages` from the current index to the nearest visible page. `pagePosition` counts visible pages; when the current page is not visible (its condition just changed) it counts the visible pages before it plus one, and the total plus one.
  - `locale.ts` (comment links `fill-and-submit-form.md`): a single-language form returns its language; otherwise parse `Accept-Language` into base tags with `q` (default 1, `q=0` dropped), sort by `q` descending then position, and take the first `en` or `es`, else `es`. `localeFor` returns `wanted` when `requiredLocales(languages)` includes it, else the first offered locale.
  - `protection.ts` (comment links `security.md`): `isHoneypotFilled` is `honeypot.trim() !== ""`; `isSilentAccept` is a filled honeypot or `now - startedAt < MIN_FILL_MS`; `decoyReference` is `<prefix>-<1000 + floor(random() * 9000)>` (nothing is stored under it).
  - `dates.ts`: `Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })` gives `YYYY-MM-DD` (for the `not_future` rule).
  - `intake.ts`: `uploadFields` collects the fields whose type declares `uploadLimits` (ADR 0016), in document order. `firstLanguage` is `es` only for an es-only form (the slug language, `media-storage.md`, "Keys"). `planFiles` attaches, per field, the staged files the answer names in answer order (positions from 1) and discards every other staged file, including fields the answers no longer hold. `submitterAddress` returns the non-empty string answer of the field whose `exclusiveRoles` include `submitter_address`, else null. `firstPageWithIssue` is the first page holding a field named by an issue.
  - `submission.ts`: the `Submission` record (comment: answers never change after insert; `form-definition.md`, "Submissions").

- [ ] **Step 5: Run** `pnpm test src/modules/submissions && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 6: Commit** `feat(submissions): in-progress record, page navigation, locale choice, abuse rules and intake planning`

---

### Task 17: Submissions persistence: migration, repositories and the real `SubmissionStats`

**Files:**
- Create: `src/modules/submissions/application/ports/in-progress-repository.ts`, `ports/submission-repository.ts`
- Create: `src/modules/submissions/infrastructure/migrations/0009_submissions.sql`, `pg-in-progress-repository.ts`, `pg-submission-repository.ts`, `pg-submission-stats.ts`
- Test: `tests/integration/submissions/pg-in-progress-repository.test.ts`, `pg-submission-repository.test.ts`, `pg-submission-stats.test.ts`, `tests/integration/submissions/factories.ts`

**Interfaces:**
- Consumes: `InProgress`, `Submission` (Task 16); `SubmissionStats`, `SubmissionSummary` from `@/modules/definitions/application`.
- Produces:

```ts
// ports/in-progress-repository.ts
export interface InProgressRepository {
  insert(uow: UnitOfWork, record: InProgress): Promise<void>;
  find(id: string): Promise<InProgress | null>;                         // null for a non-UUID id
  findForUpdate(uow: UnitOfWork, id: string): Promise<InProgress | null>;
  update(uow: UnitOfWork, record: InProgress): Promise<void>;
  delete(uow: UnitOfWork, id: string): Promise<void>;
  listExpired(now: Date, limit: number): Promise<string[]>;
}
// ports/submission-repository.ts
export interface SubmissionRepository {
  /** "duplicate_token" when a submission with the same submit token exists; never aborts the transaction. */
  insert(uow: UnitOfWork, submission: Submission): Promise<"inserted" | "duplicate_token">;
  findBySubmitToken(token: string): Promise<Submission | null>;
  findById(id: string): Promise<Submission | null>;
}
export class PgInProgressRepository implements InProgressRepository { constructor(pool: Pool) }
export class PgSubmissionRepository implements SubmissionRepository { constructor(pool: Pool) }
export class PgSubmissionStats implements SubmissionStats { constructor(pool: Pool) }
// tests/integration/submissions/factories.ts
export async function seedPublishedForm(pool: Pool, document?: Version): Promise<{ formId: string; versionId: string; slug: string }>;
```

Migration `0009_submissions.sql` (exact):

```sql
-- Owned by submissions. Personal data: in-progress rows go at submit or after 24 hours.
create table submission_in_progress (
  id uuid primary key,
  form_id uuid not null references form (id) on delete cascade,
  form_version_id uuid not null references form_version (id),
  locale text not null check (locale in ('en', 'es')),
  page_key text not null,
  answers jsonb not null default '{}',
  files jsonb not null default '{}',
  pending jsonb,
  submit_token uuid not null,
  started_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index submission_in_progress_expires_idx on submission_in_progress (expires_at);

create table submission (
  id uuid primary key,
  form_id uuid not null references form (id),
  form_version_id uuid not null references form_version (id),
  locale text not null check (locale in ('en', 'es')),
  answers jsonb not null,
  consent jsonb,
  received_at timestamptz not null,
  reference text not null,
  submit_token uuid not null,
  status text not null default 'new' check (status in ('new', 'viewed', 'edited', 'published')),
  curated_answers jsonb not null default '{}',
  published_post_url text,
  status_changed_by text,
  status_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint submission_form_reference_key unique (form_id, reference),
  constraint submission_submit_token_key unique (submit_token)
);
create index submission_form_received_idx on submission (form_id, received_at desc);

create function submission_answers_immutable() returns trigger language plpgsql as $$
begin
  if new.answers is distinct from old.answers then
    raise exception 'submission answers are immutable';
  end if;
  return new;
end $$;
create trigger submission_answers_immutable before update on submission
  for each row execute function submission_answers_immutable();
```

- [ ] **Step 1: Test factory** `tests/integration/submissions/factories.ts`: `seedPublishedForm(pool, document = storyVersion())` inserts `sampleForm({ status: "published", languages: document.languages })` and `{ ...sampleVersion(form.id, 1), document }` (from `../definitions/factories`) through the Postgres definitions repositories in one unit of work, makes the version current, and returns the ids and slug.

- [ ] **Step 2: Failing integration tests.** `pg-in-progress-repository.test.ts`:

```ts
describe("PgInProgressRepository", () => {
  const pool = testPool();
  const repo = new PgInProgressRepository(pool);
  const uow = new PgUnitOfWorkFactory(pool);
  beforeEach(() => truncateAll(pool));

  it("round-trips a record with answers, files and a pending page", async () => {
    const { formId, versionId } = await seedPublishedForm(pool);
    const now = new Date("2026-10-10T12:00:00.000Z");
    const record = {
      ...newInProgress({ id: randomUUID(), formId, versionId, locale: "es" as const, pageKey: "page_contact", submitToken: randomUUID(), startedAt: now, now }),
      answers: { f_name: "Ana Prueba" },
      files: { f_photos: [{ id: randomUUID(), stagingRef: "in-progress/r/a.jpg", kind: "image" as const, contentType: "image/jpeg", size: 3 }] },
      pending: {
        pageKey: "page_contact",
        raw: { f_email: "nope" },
        issues: [{ code: "email_syntax" as const, field: asKey("f_email") }],
      },
    };
    await uow.run((u) => repo.insert(u, record));
    expect(await repo.find(record.id)).toEqual(record);
    const updated = { ...record, pageKey: "page_baby", pending: null, updatedAt: new Date("2026-10-10T12:01:00.000Z") };
    await uow.run(async (u) => {
      expect(await repo.findForUpdate(u, record.id)).toEqual(record);
      await repo.update(u, updated);
    });
    expect(await repo.find(record.id)).toEqual(updated);
    expect(await repo.find("not-a-uuid")).toBeNull();
  });
});
```

and the cases:
- "lists expired ids, oldest first, and deletes": records created at `2026-10-08T00:00:00Z` (old) and `2026-10-10T00:00:00Z` (fresh), inserted fresh first; `listExpired(2026-10-10T12:00:00Z, 10)` is `[old.id]`; after `delete(old.id)`, `find(old.id)` is null.
- `pg-submission-repository.test.ts`, with `sample(over)` seeding a form and returning a `Submission` (`locale: "es"`, answers `{ f_name: "Ana Prueba" }`, consent `{ fieldKey: "f_consent", textVersion: "0123456789abcdef", acceptedAt: 2026-10-10T12:00:00.000Z }`, `receivedAt` the same instant, `reference: "ST-0001"`, random id and token, then `...over`): "inserts, finds by id and by submit token" (`inserted`; both finders return it equal; `findBySubmitToken("nope")` is null); "reports a repeated submit token without aborting the transaction" (inside one unit of work, a second insert with a new id and `ST-0002` but the same token is `duplicate_token`, `findById` through the pool is still null before commit, and the first row exists after it); "refuses any change to answers, but not to the status" (`update submission set answers = '{}'` rejects with `/immutable/`; `update submission set status = 'viewed'` succeeds).

`pg-submission-stats.test.ts`:

```ts
describe("PgSubmissionStats", () => {
  const pool = testPool();
  const stats = new PgSubmissionStats(pool);
  const repo = new PgSubmissionRepository(pool);
  const uow = new PgUnitOfWorkFactory(pool);
  beforeEach(() => truncateAll(pool));

  it("answers the figures definitions asks for", async () => {
    const { formId, versionId } = await seedPublishedForm(pool);
    const { formId: other } = await seedPublishedForm(pool);
    const at = (iso: string, n: number, answers: Record<string, unknown>) =>
      uow.run((u) =>
        repo.insert(u, { id: randomUUID(), formId, versionId, locale: "en", answers, consent: null, receivedAt: new Date(iso), reference: `ST-000${String(n)}`, submitToken: randomUUID() }),
      );
    await at("2025-09-01T00:00:00Z", 1, { f_name: "A" });
    await at("2026-10-01T00:00:00Z", 2, { f_name: "B", f_email: "b@example.com" });
    await at("2026-10-09T00:00:00Z", 3, { f_name: "C" });
    const summary = await stats.summary([formId, other, "not-a-uuid"]);
    expect(summary.get(formId)).toEqual({ total: 3, lastReceivedAt: new Date("2026-10-09T00:00:00Z") });
    expect(summary.get(other)).toEqual({ total: 0, lastReceivedAt: null });
    expect(await stats.countReceivedAfter(formId, new Date("2026-09-30T00:00:00Z"))).toBe(2);
    expect(await stats.countOlderThan(formId, 12, new Date("2026-10-10T00:00:00Z"))).toBe(1);
    const keys = ["f_name", "f_email", "f_missing"].map(asKey);
    expect(await stats.answerCounts(formId, keys)).toEqual(new Map([["f_name", 3], ["f_email", 1], ["f_missing", 0]]));
    expect(await stats.hasAny(formId)).toBe(true);
    expect(await stats.hasAny(other)).toBe(false);
  });
});
```

- [ ] **Step 3: Run** `pnpm test:integration tests/integration/submissions`: fails.

- [ ] **Step 4: Implement** the two ports exactly as in Interfaces, the migration above, and the three adapters per the repository pattern in Task 8 (JSON columns are written with `JSON.stringify`, a null `pending` or `consent` as SQL null):
  - `PgInProgressRepository` (comment: the row holds personal data, never logged, gone at submit or expiry): `findForUpdate` is `select … for update` through the unit of work; `update` writes `locale`, `page_key`, `answers`, `files`, `pending` and `updated_at` only (the pinned version, token and dates never change); `listExpired` is `where expires_at <= $1 order by expires_at limit $2`.
  - `PgSubmissionRepository` (comment: answers written once, the trigger refuses any later change): `insert` is `insert … on conflict (submit_token) do nothing returning id`, so a duplicate token returns `duplicate_token` without aborting the transaction; `consent.acceptedAt` is stored as an ISO string inside the jsonb and read back as a `Date`.
  - `PgSubmissionStats` (definitions' `SubmissionStats` port): non-UUID form ids are skipped and give zero figures; `summary` is one `count(*)::int, max(received_at) … where form_id = any($1::uuid[]) group by form_id`, every asked id present in the map; `countReceivedAfter` is `received_at > $2`; `countOlderThan` is `received_at < $3::timestamptz - make_interval(months => $2)`; `answerCounts` counts `jsonb_object_keys(answers)` matching `any($2::text[])`, every asked key present; `hasAny` is `exists (…)`.

- [ ] **Step 5: Run** `pnpm test:integration tests/integration/submissions && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 6: Commit** `feat(submissions): in-progress and submission tables with immutable answers, repositories and Postgres submission stats`

---

### Task 18: Submissions application: dependencies, fakes, post context and the form view

**Files:**
- Create: `src/modules/submissions/application/deps.ts`, `fill-state.ts`, `version-cache.ts`, `post-context.ts`, `view-form.ts`, `index.ts`, `testing/fakes.ts`
- Test: `version-cache.test.ts`, `view-form.test.ts`, `post-context.test.ts` beside them; `tests/boundaries/boundaries.test.ts` (one probe)

**Interfaces:**
- Consumes: Tasks 14, 16, 17; `MediaDeps`, `makeMediaDeps` (Task 6); `makeDefinitionsDeps`, `seedPublished`, `publishAgain` (Task 14). The testing fakes import other modules' fakes under ADR 0026.
- Produces:

```ts
// deps.ts
export interface SubmissionsDeps {
  definitions: DefinitionsDeps; media: MediaDeps; inProgress: InProgressRepository; submissions: SubmissionRepository;
  queue: JobQueue; uow: UnitOfWorkFactory; clock: Clock; ids: IdGenerator; registry: FieldTypeRegistry;
  logger: Logger; versions: VersionCache; random: () => number;
}
// fill-state.ts
export type FillState =
  | { kind: "none" } | { kind: "record"; id: string } | { kind: "done"; submitToken: string } | { kind: "decoy"; reference: string };
export type Gate = "not_found" | "closed" | "not_open_yet";
export type PageAction =
  | { kind: "next" } | { kind: "back" } | { kind: "submit" } | { kind: "language"; locale: Locale } | { kind: "remove"; fileId: string };
export interface IncomingFile { fieldKey: string; name: string; bytes: Uint8Array }
export interface PagePost {
  pageKey: string; action: PageAction; answers: Record<string, unknown>; decodeIssues: ValidationIssue[];
  raw: RawValues; incoming: IncomingFile[]; renderedAt: Date | null; honeypot: string;
  submitToken: string | null; acceptLanguage: string | null; state: FillState;
}
export type PostOutcome =
  | { kind: "show"; recordId: string }                                                       // redirect to the page
  | { kind: "refused"; recordId: string; locale: Locale; refusedFiles: RefusedFile[] }       // answer the post with the page
  | { kind: "submitted"; submitToken: string } | { kind: "decoy"; reference: string }
  | { kind: "expired" } | { kind: "gate"; state: Gate };
// version-cache.ts
export class VersionCache { constructor(max?: number); get(definitions: DefinitionsDeps, id: string): Promise<FormVersion | null> }
// post-context.ts
export interface OpenContext { form: Form; version: FormVersion; record: InProgress | null }
export type PostContext = ({ ok: true } & OpenContext) | { ok: false; outcome: PostOutcome };
export async function postContext(deps: SubmissionsDeps, input: { slug: string; state: FillState; submitToken: string | null }): Promise<PostContext>;
// view-form.ts
export interface PageView {
  locale: Locale; pageKey: string; position: { n: number; total: number }; isFirst: boolean; isLast: boolean;
  answers: Record<string, unknown>; files: Record<string, StagedUpload[]>; pending: PendingPage | null;
  submitToken: string | null; renderedAt: Date; hasRecord: boolean;
}
export type ViewResult =
  | { screen: "not_found" }
  | { screen: "closed"; form: Form }
  | { screen: "not_open"; form: Form; opensAt: string }
  | { screen: "expired"; form: Form }
  | { screen: "confirmation"; form: Form; version: FormVersion; locale: Locale; reference: string }
  | { screen: "page"; form: Form; version: FormVersion; page: PageView };
export async function viewForm(deps: SubmissionsDeps, input: { slug: string; state: FillState; acceptLanguage: string | null; expired: boolean }): Promise<ViewResult>;
// testing/fakes.ts
export class InMemoryInProgressRepository implements InProgressRepository { readonly rows: Map<string, InProgress> }
export class InMemorySubmissionRepository implements SubmissionRepository { readonly rows: Map<string, Submission> }
export interface FakeSubmissionsDeps extends SubmissionsDeps {
  definitions: FakeDefinitionsDeps; media: FakeMediaDeps; inProgress: InMemoryInProgressRepository;
  submissions: InMemorySubmissionRepository; queue: InMemoryJobQueue; clock: FixedClock; logger: RecordingLogger;
}
export function makeSubmissionsDeps(): FakeSubmissionsDeps;              // one clock, one id generator, one queue across the three modules
export async function publishStory(deps: FakeSubmissionsDeps, settings?: Partial<FormSettings>): Promise<{ formId: string; versionId: string; slug: "story-form" }>;
export function post(over: Partial<PagePost>): PagePost;               // defaults: page_contact, next, no answers
```

The version cache is per process and keyed by version id, which is safe because versions never change (architecture.md, "Publishing data flow" step 4). Decision (answering a post): `refused` is the only outcome the page form answers directly; every other outcome redirects (Task 28).

- [ ] **Step 1: Fakes** `testing/fakes.ts` (header: one clock, id generator and queue shared by every module):
  - `InMemoryInProgressRepository` stores `structuredClone`s; `insert` rejects an existing id, `update` a missing one; `findForUpdate` is `find`; `listExpired` filters `expiresAt <= now`, up to `limit`.
  - `InMemorySubmissionRepository.insert` returns `duplicate_token` when any row has the token, else stores a clone; the finders return clones.
  - `makeSubmissionsDeps()` builds one `FixedClock`, `SequentialIdGenerator`, `InMemoryJobQueue` and `FakeUnitOfWorkFactory`, passes them into `makeDefinitionsDeps({ clock, ids, uow, registry })` and `makeMediaDeps({ clock, ids, queue, uow })`, and adds the two repositories, a `RecordingLogger`, a `VersionCache` and `random: () => 0.5`.
  - `publishStory(deps, settings)` is `seedPublished` with slug `story-form`, `storyVersion()` and settings `{ referencePrefix: "ST", notificationRecipients: ["stories@example.com"], ...settings }`.
  - `post(over)` defaults: `pageKey: "page_contact"`, `action: { kind: "next" }`, empty answers, decode issues, raw values and files, `renderedAt: null`, `honeypot: ""`, `submitToken: null`, `acceptLanguage: "es"`, `state: { kind: "none" }`.

- [ ] **Step 2: Failing tests.** `version-cache.test.ts`:

```ts
describe("VersionCache", () => {
  it("reads each version once and evicts the least recently used beyond its size", async () => {
    const deps = makeSubmissionsDeps();
    const { versionId } = await publishStory(deps);
    const spy = vi.spyOn(deps.definitions.versions, "findById");
    const cache = new VersionCache(1);
    await cache.get(deps.definitions, versionId);
    await cache.get(deps.definitions, versionId);
    expect(spy).toHaveBeenCalledTimes(1);
    await cache.get(deps.definitions, "00000000-0000-4000-8000-0000000000ff");
    await cache.get(deps.definitions, versionId);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
```

`view-form.test.ts`:

```ts
describe("viewForm", () => {
  it("shows page 1 fresh, in the browser's language, without a record", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const view = await viewForm(deps, { slug: "story-form", state: { kind: "none" }, acceptLanguage: "en-US", expired: false });
    expect(view.screen).toBe("page");
    if (view.screen !== "page") return;
    expect(view.page).toMatchObject({ locale: "en", pageKey: "page_contact", isFirst: true, isLast: false, hasRecord: false, submitToken: null });
    expect(view.page.position).toEqual({ n: 1, total: 2 });
  });

  it("shows a record's page on its pinned version, with the pending post", async () => {
    const deps = makeSubmissionsDeps();
    const { formId, versionId } = await publishStory(deps);
    const now = deps.clock.now();
    const record = {
      ...newInProgress({ id: "00000000-0000-4000-8000-0000000000aa", formId, versionId, locale: "es", pageKey: "page_contact", submitToken: "00000000-0000-4000-8000-0000000000bb", startedAt: now, now }),
      pending: { pageKey: "page_contact", raw: { f_name: "" }, issues: [{ code: "required" as const, field: asKey("f_name") }] },
    };
    await deps.inProgress.insert(await deps.uow.begin(), record);
    const view = await viewForm(deps, { slug: "story-form", state: { kind: "record", id: record.id }, acceptLanguage: "en", expired: false });
    expect(view.screen === "page" && view.page.pending?.issues).toEqual([{ code: "required", field: "f_name" }]);
    expect(view.screen === "page" && view.page.locale).toBe("es");
  });
});
```

More cases, each on fresh `makeSubmissionsDeps()` with `publishStory`:
- `viewForm`, "shows the gate screens and the expired screen": slug `nope` → `not_found`; a record cookie for the unknown id `00000000-0000-4000-8000-00000000abcd` → `expired`; no cookie with `expired: true` → `expired`; after setting the stored form's status to `closed`, no cookie → `closed`.
- `viewForm`, "shows the confirmation for a done cookie and for a decoy": with a submission `{ id: "00000000-0000-4000-8000-0000000000cc", locale: "en", answers: {}, consent: null, reference: "ST-0007", submitToken: "00000000-0000-4000-8000-0000000000dd" }` on the story form, a `done` cookie with that token and `acceptLanguage: "es"` → `{ screen: "confirmation", reference: "ST-0007", locale: "en" }`; a `decoy` cookie `ST-4321` → `{ screen: "confirmation", reference: "ST-4321", locale: "es" }`.
- `postContext`, "answers submitted for a repeated Submit whose record is gone": with that submission stored under the token `00000000-0000-4000-8000-0000000000dd`, a record cookie for the absent `…0000aa` plus that token → `{ ok: false, outcome: { kind: "submitted", submitToken } }`, and a `done` cookie with it → the same.
- `postContext`, "refuses a record of another form or past its 24 hours as expired": a record `newInProgress({ id: "…0000aa", pageKey: "page_contact", submitToken: "…0000bb", … })` stored, the clock advanced 24 hours → `{ ok: false, outcome: { kind: "expired" } }`.

Boundary probe inside `describe("layer boundaries")`, per the probe pattern in Task 2: "forbids definitions importing submissions, which would make a cycle", probe file `src/modules/definitions/application/boundary-probe-subs.ts`, importing `viewForm` from `@/modules/submissions/application`, refused by `boundaries/dependencies`.

- [ ] **Step 3: Run** `pnpm test src/modules/submissions tests/boundaries`: fails.

- [ ] **Step 4: Implement** `deps.ts` and `fill-state.ts` exactly as in Interfaces (types only), then:
  - `VersionCache` (comment links the publishing data flow; nothing invalidates it): a `Map` used as an LRU of at most `max` (default 100) entries; a hit is deleted and re-set to become the newest; a miss calls `loadVersion` and stores non-null results, evicting the oldest key past `max`.
  - `postContext` (comment: read without locks; the use cases lock the record before writing): `resolvePublicForm`; not open is `{ kind: "gate", state }`. The token to check is the `done` cookie's, else the posted one. A `done` cookie whose submission exists for this form answers `submitted`. Without a record cookie the context is the current version with `record: null`. A record cookie whose row is missing answers `submitted` when the token names a submission of this form, else `expired`; a row of another form, past `expiresAt`, or whose pinned version cannot be loaded is `expired`; otherwise the context is the pinned version (through the cache) and the record.
  - `viewForm` (comment links `renderer.md`, "Screens"): a `done` cookie whose submission belongs to this slug shows its confirmation in the submission's locale, on its own version. Otherwise resolve the form: `not_found`, `closed`, `not_open` (with `opensAt`) map one to one; a `decoy` cookie shows the confirmation with the decoy reference in `pickLocale(languages, acceptLanguage)`. A record cookie shows the record's page on its pinned version (missing, foreign, expired or unloadable is `expired`): position, `isFirst` and `isLast` come from the navigation functions over `withFileAnswers(answers, files)`, `pending` only when it belongs to the current page, `submitToken` the record's, `renderedAt` now, `hasRecord: true`. No cookie and `expired` asked is the expired screen; otherwise page 1 of the current version, fresh, in the browser's language, `submitToken: null`, `hasRecord: false`.
  - `index.ts` (header: only `src/app` imports it; no module depends on submissions): the types `SubmissionsDeps`, `FillState`, `Gate`, `PageAction`, `PagePost`, `PostOutcome`, `IncomingFile`, `OpenContext`, `PostContext`, `PageView`, `ViewResult`, `InProgressRepository`, `SubmissionRepository`, `InProgress`, `PendingPage`, `StagedUpload`, `RawValues`, `FileIssueCode`, `RefusedFile`, `Submission`; the values `VersionCache`, `postContext`, `viewForm`, `HONEYPOT_FIELD`, `MIN_FILL_MS`, `uploadFields`, `withFileAnswers`, `localeFor`, `pickLocale` (later tasks add theirs).

- [ ] **Step 5: Run** `pnpm test src/modules/submissions tests/boundaries && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 6: Commit** `feat(submissions): post context, form view and a per-process version cache`

---

### Task 19: Submissions application: saving a page and checking a field

**Files:**
- Create: `src/modules/submissions/application/staging.ts`, `answers.ts`, `save-page.ts`, `check-field.ts`
- Test: `save-page.test.ts`, `check-field.test.ts` beside them
- Modify: `src/modules/submissions/application/index.ts`

**Interfaces:**
- Consumes: Task 18's context and fakes; `stageFile`, `discardStaged` (Task 6); `validatePage` (Task 4).
- Produces:

```ts
// staging.ts
export interface StagedBatch { added: Record<string, StagedUpload[]>; refused: RefusedFile[]; countIssues: ValidationIssue[]; refs: string[] }
export async function stageIncoming(deps: SubmissionsDeps, input: {
  recordId: string; version: Version; pageKey: string;
  existing: Readonly<Record<string, readonly StagedUpload[]>>; incoming: readonly IncomingFile[];
}): Promise<StagedBatch>;
export function mergeBatch(record: InProgress, batch: StagedBatch, version: Version, registry: FieldTypeRegistry):
  { record: InProgress; overflow: string[]; issues: ValidationIssue[] };   // re-checks counts on the locked record
export async function discardQuietly(deps: SubmissionsDeps, refs: readonly string[]): Promise<void>;
// answers.ts
export function pageInputKeys(version: Version, registry: FieldTypeRegistry, pageKey: string): { answers: string[]; uploads: string[] };
export function storePageAnswers(stored: Readonly<Record<string, unknown>>, version: Version, registry: FieldTypeRegistry, pageKey: string, valid: Readonly<Record<string, unknown>>): Record<string, unknown>;
// save-page.ts
export async function savePage(deps: SubmissionsDeps, context: OpenContext, post: PagePost): Promise<PostOutcome>;   // next, back, language, remove
// check-field.ts
export function checkField(deps: SubmissionsDeps, context: OpenContext, input: { fieldKey: string; answer: unknown; decodeIssue: ValidationCode | null }):
  { field: Field; issue: ValidationIssue | null } | null;     // null: no such input field in the version
```

Rules savePage keeps, each pinned by a test below: a post without a record is accepted only for the first page (otherwise `expired`), and creates the record with the post's version, the browser's language and `started_at` from `_rendered`; files are staged before the unit of work, and on any failure the files staged by this post are removed; Next enforces required, Back and the language switch do not, and an invalid answer is never stored; the stored answers of the page are replaced by the page's valid answers; decode issues (a number that is not a number, an impossible date) replace the form model's issue for that field; a refused Next keeps the raw values and issues as `pending`, stays on the page and answers `refused` with the post's refused files; the language switch and a Remove keep the raw values without issues and answer `show`, or `refused` when a file of theirs was refused; Remove deletes the staging copy after commit; no file name reaches the record.

- [ ] **Step 1: Failing tests.** `save-page.test.ts`:

```ts
async function context(deps: FakeSubmissionsDeps, state: Parameters<typeof postContext>[1]["state"] = { kind: "none" }) {
  const ctx = await postContext(deps, { slug: "story-form", state, submitToken: null });
  if (!ctx.ok) throw new Error(ctx.outcome.kind);
  return ctx;
}

async function startOnPhotos(deps: FakeSubmissionsDeps): Promise<string> {
  const first = await savePage(deps, await context(deps), post({ answers: { f_name: "Ana Prueba", f_baby: "yes_opt" } }));
  if (first.kind !== "show") throw new Error(first.kind);
  return first.recordId;
}

describe("savePage", () => {
  it("creates the record on the first page and moves to the next visible page", async () => {
    const deps = makeSubmissionsDeps();
    const { versionId } = await publishStory(deps);
    const rendered = new Date(deps.clock.now().getTime() - 20_000);
    const out = await savePage(deps, await context(deps), post({ answers: { f_name: " Ana Prueba ", f_baby: "no_opt" }, renderedAt: rendered, acceptLanguage: "en" }));
    if (out.kind !== "show") throw new Error(out.kind);
    const record = deps.inProgress.rows.get(out.recordId);
    expect(record).toMatchObject({ versionId, locale: "en", pageKey: "page_consent", answers: { f_name: "Ana Prueba", f_baby: "no_opt" }, pending: null, startedAt: rendered });
  });

  it("refuses a later page without a record as expired", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    expect(await savePage(deps, await context(deps), post({ pageKey: "page_consent" }))).toEqual({ kind: "expired" });
    expect(deps.inProgress.rows.size).toBe(0);
  });

  it("keeps a refused Next as pending, with decode issues replacing the model's", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const out = await savePage(deps, await context(deps), post({
      answers: { f_email: "nope" }, raw: { f_name: "", f_email: "nope" },
      decodeIssues: [{ code: "invalid_shape", field: asKey("f_baby") }],
    }));
    if (out.kind !== "refused") throw new Error(out.kind);
    expect(out.refusedFiles).toEqual([]);
    const record = deps.inProgress.rows.get(out.recordId);
    expect(record?.pageKey).toBe("page_contact");
    expect(record?.pending?.issues.map((i) => [i.field, i.code])).toEqual([["f_name", "required"], ["f_email", "email_syntax"], ["f_baby", "invalid_shape"]]);
    expect(record?.pending?.raw).toEqual({ f_name: "", f_email: "nope" });
    expect(record?.answers).toEqual({});
  });

  it("goes back without enforcing required, storing only valid answers", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    const back = await savePage(deps, await context(deps, { kind: "record", id }), post({ pageKey: "page_baby", action: { kind: "back" } }));
    expect(back).toEqual({ kind: "show", recordId: id });
    expect(deps.inProgress.rows.get(id)).toMatchObject({ pageKey: "page_contact", pending: null });
  });

  it("switches language on the same page and keeps what was typed", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const out = await savePage(deps, await context(deps), post({ action: { kind: "language", locale: "en" }, answers: { f_name: "Ana" }, raw: { f_name: "Ana", f_email: "half@" } }));
    if (out.kind !== "show") throw new Error(out.kind);
    expect(deps.inProgress.rows.get(out.recordId)).toMatchObject({
      locale: "en", pageKey: "page_contact", answers: { f_name: "Ana" },
      pending: { pageKey: "page_contact", raw: { f_name: "Ana", f_email: "half@" }, issues: [] },
    });
  });

  it("stages files posted without script, refuses more than the field allows, and removes on request", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    const ctx = await context(deps, { kind: "record", id });
    const four = Array.from({ length: 4 }, (_, i) => ({ fieldKey: "f_photos", name: `p${String(i)}.jpg`, bytes: fakeImage() }));
    expect((await savePage(deps, ctx, post({ pageKey: "page_baby", incoming: four }))).kind).toBe("refused");
    expect(deps.inProgress.rows.get(id)?.pending?.issues).toEqual([{ code: "files_max", field: "f_photos", params: { n: 3 } }]);
    expect(deps.media.staging.files.size).toBe(0);

    await savePage(deps, await context(deps, { kind: "record", id }), post({ pageKey: "page_baby", action: { kind: "language", locale: "es" }, incoming: four.slice(0, 2) }));
    const files = deps.inProgress.rows.get(id)?.files["f_photos"] ?? [];
    expect(files).toHaveLength(2);
    expect(deps.media.staging.files.size).toBe(2);

    const removed = files[0];
    if (!removed) throw new Error("no file");
    await savePage(deps, await context(deps, { kind: "record", id }), post({ pageKey: "page_baby", action: { kind: "remove", fileId: removed.id } }));
    expect(deps.inProgress.rows.get(id)?.files["f_photos"]?.map((f) => f.id)).toEqual([files[1]?.id]);
    expect(deps.media.staging.files.has(removed.stagingRef)).toBe(false);
  });

  it("answers a refused file by name and stores the name nowhere", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    const out = await savePage(deps, await context(deps, { kind: "record", id }), post({ pageKey: "page_baby", incoming: [{ fieldKey: "f_photos", name: "notes.txt", bytes: new TextEncoder().encode("hello") }] }));
    expect(out).toEqual({ kind: "refused", recordId: id, locale: "es", refusedFiles: [{ fieldKey: "f_photos", code: "file_wrong_type", name: "notes.txt" }] });
    expect(JSON.stringify(deps.inProgress.rows.get(id))).not.toContain("notes.txt");
  });

  it("removes the files it staged when the save fails", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    deps.inProgress.update = () => Promise.reject(new Error("database down"));
    await expect(
      savePage(deps, await context(deps, { kind: "record", id }), post({ pageKey: "page_baby", incoming: [{ fieldKey: "f_photos", name: "a.jpg", bytes: fakeImage() }] })),
    ).rejects.toThrow("database down");
    expect(deps.media.staging.files.size).toBe(0);
  });
});
```

`check-field.test.ts`:

```ts
describe("checkField", () => {
  it("runs the server's rules for one field, and passes decode issues through", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const ctx = await postContext(deps, { slug: "story-form", state: { kind: "none" }, submitToken: null });
    if (!ctx.ok) throw new Error("closed");
    expect(checkField(deps, ctx, { fieldKey: "f_email", answer: "nope", decodeIssue: null })?.issue).toEqual({ code: "email_syntax", field: "f_email" });
    expect(checkField(deps, ctx, { fieldKey: "f_email", answer: "a@example.com", decodeIssue: null })?.issue).toBeNull();
    expect(checkField(deps, ctx, { fieldKey: "f_name", answer: "", decodeIssue: null })?.issue?.code).toBe("required");
    expect(checkField(deps, ctx, { fieldKey: "f_baby", answer: undefined, decodeIssue: "invalid_shape" })?.issue).toEqual({ code: "invalid_shape", field: "f_baby" });
    expect(checkField(deps, ctx, { fieldKey: "f_nope", answer: "x", decodeIssue: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `pnpm test src/modules/submissions/application`: fails.

- [ ] **Step 3: Implement.**
  - `answers.ts`: `pageInputKeys` splits the page's input fields into answer fields and upload fields (those whose type declares `uploadLimits`; uploads live in `files`). `storePageAnswers` deletes every answer key of the page from the stored answers and sets the valid ones back.
  - `staging.ts`: `stageIncoming` (before any transaction) walks the version's upload fields that sit on the page; empty file parts (no file chosen) are ignored; a field asked for more files than `maxFiles` minus those already staged gets one `files_max` count issue (`params: { n: maxFiles }`) and stages none of them; every other file goes through `stageFile` with the field's kinds and `maxSizeMb`, a refusal becoming a `RefusedFile` with the browser's name, a success joining `added` and `refs`. `mergeBatch` adds the batch to the locked record field by field; a field the batch would push past `maxFiles` (a concurrent early upload) keeps its files, and the batch's files for it become `overflow` refs with a `files_max` issue. `discardQuietly` deletes refs through `discardStaged` and on failure only logs `staged files not removed` with the count and the error class (the record's prefix delete at expiry catches them).
  - `savePage` (comment: every post stores the page's valid answers server-side, which lets Back, Next and a refresh keep them; `renderer.md`, "Navigation and state"): checks the first-page rule and that the page exists, stages the batch under the record id (a new id when there is no record), then in one unit of work: lock the record (`findForUpdate`; missing or expired is `expired`, the batch discarded); or create it with `newInProgress` (locale from the language action or `pickLocale`, `clampStartedAt(renderedAt)`, a new submit token); `mergeBatch`; apply a Remove with `removeUpload`; validate with `validatePage` over `withFileAnswers({ ...stored, ...posted }, files)` and `{ today: todayIn(timezone, now) }`, `enforceRequired` only for Next; issues are the model's except for fields that have a decode or count issue, which replace them; store the page's valid answers; then move: a Next with issues or refused files stays with `pending { pageKey, raw, issues }` and answers `refused` with the record's locale and the batch's refused files; a clean Next moves to `nextPageKey` with `pending: null`; Back moves to `previousPageKey` with `pending: null`; language and Remove stay with `pending { raw, issues: [] }`, answering `refused` only when the batch refused a file. Insert or update the record. After commit, discard the overflow and removed refs; when the unit of work throws, discard the batch's refs and rethrow. (Submit never reaches `savePage`; the action sends it to `submitForm`, Task 21.)
  - `checkField` (the blur check: the server's own rules for one field, so the browser ships none of them): find the page holding the field; a non-input or unknown field is null; a decode issue answers at once as `{ code, field: field.key }`; otherwise `validatePage` with `enforceRequired: true` over the record's answers and files plus this one answer, returning the issue for that field or null.
  - `index.ts`: export `savePage` and `checkField`.

- [ ] **Step 4: Run** `pnpm test src/modules/submissions && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(submissions): save a page on Next, Back, language switch and Remove; check one field`

---

### Task 20: Submissions application: early uploads, removal and the per-submission size

**Files:**
- Create: `src/modules/submissions/application/upload-file.ts`, `upload-file.test.ts`
- Modify: `src/modules/submissions/application/staging.ts` (the per-submission size), `save-page.test.ts` (one case), `index.ts`

**Interfaces:**
- Consumes: `OpenContext` (Task 18); `stageFile` (Task 6) called directly for the single file; `discardQuietly`, `mergeBatch`, `stageIncoming` (Task 19); `stagedBytes` (Task 16); `LIMITS.submissionSizeMb`.
- Produces:

```ts
// upload-file.ts
export type UploadRefusal = StageRefusal | "files_max" | "submission_too_large" | "not_allowed" | "expired";
export type UploadOutcome =
  | { ok: true; recordId: string; file: { id: string; kind: "image" | "video"; size: number }; count: number }
  | { ok: false; code: UploadRefusal; params?: { n: number } };
export async function uploadFile(deps: SubmissionsDeps, context: OpenContext, input: {
  fieldKey: string; bytes: Uint8Array; renderedAt: Date | null; acceptLanguage: string | null;
}): Promise<UploadOutcome>;
export async function removeFile(deps: SubmissionsDeps, context: OpenContext, fileId: string): Promise<boolean>;
// staging.ts addition
export const SUBMISSION_BYTES: number;   // LIMITS.submissionSizeMb MB
```

Decision (upload authentication): the cookie's record, and the posted field key must name a visible upload field of the record's current page (the first page when there is no record yet, which this call then creates). Anything else is `not_allowed` and nothing is staged. Decision (per-submission size, `security.md`): a file that would take the record's staged bytes (`stagedBytes`, every field, early uploads included) past `SUBMISSION_BYTES` is refused with `submission_too_large` before staging, by `uploadFile` and by `stageIncoming` alike, and again on the locked record in the unit of work.

- [ ] **Step 1: Failing tests** `upload-file.test.ts`, with the helper `onPhotos(deps)`: `savePage` on a fresh context with `{ f_name: "Ana Prueba", f_baby: "yes_opt" }` (must answer `show`), then the `postContext` of that record:

```ts
const MB = 1024 * 1024;

describe("uploadFile", () => {
  it("stages a file for a visible upload field of the current page and counts it", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const ctx = await onPhotos(deps);
    const out = await uploadFile(deps, ctx, { fieldKey: "f_photos", bytes: fakeImage(), renderedAt: null, acceptLanguage: "es" });
    expect(out).toMatchObject({ ok: true, recordId: ctx.record?.id, file: { kind: "image" }, count: 1 });
    expect(deps.inProgress.rows.get(ctx.record?.id ?? "")?.files["f_photos"]).toHaveLength(1);
  });

  it("refuses a field that is not an upload field of the current page", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const none = await postContext(deps, { slug: "story-form", state: { kind: "none" }, submitToken: null });
    if (!none.ok) throw new Error("closed");
    expect(await uploadFile(deps, none, { fieldKey: "f_photos", bytes: fakeImage(), renderedAt: null, acceptLanguage: "es" })).toEqual({ ok: false, code: "not_allowed" });
    expect(await uploadFile(deps, none, { fieldKey: "f_name", bytes: fakeImage(), renderedAt: null, acceptLanguage: "es" })).toEqual({ ok: false, code: "not_allowed" });
    expect(deps.media.staging.files.size).toBe(0);
  });

  it("refuses a lying, truncated or oversized file and stages nothing", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const ctx = await onPhotos(deps);
    const upload = (bytes: Uint8Array) => uploadFile(deps, ctx, { fieldKey: "f_photos", bytes, renderedAt: null, acceptLanguage: "es" });
    expect(await upload(new TextEncoder().encode("<!doctype html>"))).toEqual({ ok: false, code: "file_wrong_type" });
    expect(await upload(new TextEncoder().encode("mime:image/jpeg;broken"))).toEqual({ ok: false, code: "file_unreadable" });
    expect(await upload(fakeImage("image/jpeg", 11 * MB))).toEqual({ ok: false, code: "file_too_large" });
    expect(deps.media.staging.files.size).toBe(0);
  });

  it("refuses the file past the field's maximum", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const ctx = await onPhotos(deps);
    for (let i = 0; i < 3; i++) await uploadFile(deps, ctx, { fieldKey: "f_photos", bytes: fakeImage(), renderedAt: null, acceptLanguage: "es" });
    const fresh = await postContext(deps, { slug: "story-form", state: { kind: "record", id: ctx.record?.id ?? "" }, submitToken: null });
    if (!fresh.ok) throw new Error("expired");
    expect(await uploadFile(deps, fresh, { fieldKey: "f_photos", bytes: fakeImage(), renderedAt: null, acceptLanguage: "es" })).toEqual({ ok: false, code: "files_max", params: { n: 3 } });
    expect(deps.media.staging.files.size).toBe(3);
  });

  it("refuses a file that would take the record's staged files past 100 MB", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const ctx = await onPhotos(deps);
    const id = ctx.record?.id ?? "";
    const big = (n: string, size: number) => ({ id: n, stagingRef: `in-progress/${id}/${n}.mp4`, kind: "video" as const, contentType: "video/mp4", size });
    const r = deps.inProgress.rows.get(id);
    if (r) deps.inProgress.rows.set(id, { ...r, files: { f_photos: [big("a", 50 * MB), big("b", 46 * MB)] } });
    const full = await postContext(deps, { slug: "story-form", state: { kind: "record", id }, submitToken: null });
    if (!full.ok) throw new Error("expired");
    expect(await uploadFile(deps, full, { fieldKey: "f_photos", bytes: fakeImage("image/jpeg", 5 * MB), renderedAt: null, acceptLanguage: "es" })).toEqual({ ok: false, code: "submission_too_large" });
    expect(deps.media.staging.files.size).toBe(0);
    expect((await uploadFile(deps, full, { fieldKey: "f_photos", bytes: fakeImage("image/jpeg", 3 * MB), renderedAt: null, acceptLanguage: "es" })).ok).toBe(true);
  });
});

describe("removeFile", () => {
  it("drops the file from the record and from staging, and reports unknown ids", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const ctx = await onPhotos(deps);
    const out = await uploadFile(deps, ctx, { fieldKey: "f_photos", bytes: fakeImage(), renderedAt: null, acceptLanguage: "es" });
    if (!out.ok) throw new Error(out.code);
    expect(await removeFile(deps, ctx, out.file.id)).toBe(true);
    expect(deps.media.staging.files.size).toBe(0);
    expect(await removeFile(deps, ctx, out.file.id)).toBe(false);
  });
});
```

(`FakeEncoder` prefixes ten bytes, so the 3 MB image stays within the remaining 4 MB.) Append to `save-page.test.ts`:

```ts
  it("refuses a file posted without script that would pass the per-submission size", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    const r = deps.inProgress.rows.get(id);
    const big = { id: "a", stagingRef: `in-progress/${id}/a.mp4`, kind: "video" as const, contentType: "video/mp4", size: 98 * 1024 * 1024 };
    if (r) deps.inProgress.rows.set(id, { ...r, files: { f_photos: [big] } });
    const out = await savePage(deps, await context(deps, { kind: "record", id }), post({ pageKey: "page_baby", incoming: [{ fieldKey: "f_photos", name: "b.jpg", bytes: fakeImage("image/jpeg", 3 * 1024 * 1024) }] }));
    expect(out).toMatchObject({ kind: "refused", refusedFiles: [{ fieldKey: "f_photos", code: "submission_too_large", name: "b.jpg" }] });
    expect(deps.media.staging.files.size).toBe(0);
  });
```

- [ ] **Step 2: Run** `pnpm test src/modules/submissions/application`: fails.

- [ ] **Step 3: Implement.**
  - `staging.ts`: `SUBMISSION_BYTES = LIMITS.submissionSizeMb * MB`; `stageIncoming` keeps a running total starting at `stagedBytes(existing)` and refuses, as a `RefusedFile` with `submission_too_large`, any file whose bytes would pass it, before calling `stageFile`; staged sizes add to the total. `mergeBatch` also overflows a field whose added files would take the locked record past `SUBMISSION_BYTES`.
  - `uploadFile` (comment links `renderer.md`, "File upload"): the page is the record's current page or the first page; the field must be one of `uploadFields`, sit on that page and be visible (`evaluateVisibility` over the record's answers with files), else `not_allowed`. Refuse `files_max` when the field already holds `maxFiles`, and `submission_too_large` when `stagedBytes(record.files) + bytes.length > SUBMISSION_BYTES`. Stage with `stageFile` under the record id (a new id when there is none). Then one unit of work: lock the record (missing or expired is `expired`) or create it as `savePage` does on the first page; `mergeBatch` with the one file (overflow is `files_max`; over the total is `submission_too_large`); write the record; answer `ok` with the file's id, kind and size and the field's new count. Any refusal after staging, or a thrown error, discards the staged file.
  - `removeFile`: without a record, false. Otherwise one unit of work locks the record (missing or expired: false), removes the upload (unknown id: false) and updates the record; after commit `discardQuietly` the staging ref and answer true.
  - `index.ts`: export `uploadFile`, `removeFile`, `UploadOutcome`, `UploadRefusal`.

- [ ] **Step 4: Run** `pnpm test src/modules/submissions && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(submissions): early uploads linked to the in-progress record, removal, and the per-submission size`

---

### Task 21: Submissions application: the intake transaction, silent accepts on every post, and expiry

**Files:**
- Create: `src/modules/submissions/application/submit-form.ts`, `submit-form.test.ts`, `silent-accept.ts`, `expire.ts`, `expire.test.ts`
- Modify: `src/modules/submissions/application/save-page.ts` (the honeypot on every post), `index.ts`

**Interfaces:**
- Consumes: everything above; `allocateReference` (Task 14); `attachToSubmission`, `durableKey`, `uniqueFieldSlugs`, `extensionFor`, `discardRecordFiles` (Tasks 5, 6); `enqueueSubmissionEmails` (Task 11); `validateSubmission`; `isHoneypotFilled`, `isSilentAccept`, `decoyReference` (Task 16).
- Produces:

```ts
// submit-form.ts
export async function submitForm(deps: SubmissionsDeps, context: OpenContext, post: PagePost): Promise<PostOutcome>;
// silent-accept.ts: inside a unit of work; the caller discards `refs` and the record's prefix after commit
export async function silentAccept(deps: SubmissionsDeps, uow: UnitOfWork, input: { form: Form; recordId: string; locked: boolean }): Promise<{ kind: "decoy"; reference: string }>;
// expire.ts
export async function expireInProgress(deps: SubmissionsDeps, input: { now: Date; logger: Logger; limit?: number }): Promise<number>;
```

The single transaction, in order: lock the in-progress row; a missing row with a known submit token answers `submitted` (a double click); an expired row answers `expired`; the honeypot or the minimum time answers with a decoy reference after deleting the record (its files go after commit), storing nothing; the last page is validated as on Next; the whole submission is validated with `validateSubmission`, which drops answers to hidden fields (a refusal stores `pending` on the first page with an issue and answers `refused`); a submission already holding this record's submit token answers `submitted` **before** any reference is taken; `allocateReference` locks the form row and re-checks that it is open; then the submission, one media row and one `media.upload` job per attached file, the email jobs, and the deletion of the in-progress row. Should the insert still meet the token (a race the pre-check lost), the transaction is rolled back by throwing a private `DuplicateSubmit` sentinel, caught outside the unit of work and answered `submitted`, so a duplicate commits nothing: `form.next_reference` and `form.updated_at` keep their values. After commit, staged files no answer names (hidden fields, never attached) are deleted. Logs carry the form and submission ids only.

Decision (honeypot on every post): `savePage` checks `isHoneypotFilled` first in its unit of work, and a filled honeypot on Next, Back, a language switch or a Remove calls `silentAccept` exactly as Submit does. The minimum time is checked at Submit only. Decision (media keys, applied here): field slugs come from `uniqueFieldSlugs` over the version's upload fields in field order, with labels in `firstLanguage(languages)`. Decision (staff notification, applied here): enqueued when the cadence is per submission and the form has at least one recipient; the submitter confirmation when the version defines a confirmation email and the submitter-address field was answered.

- [ ] **Step 1: Failing tests** `submit-form.test.ts`. Shared helpers, described once: `consent = { accepted: true, textVersion: consentTextVersion(CONSENT_TEXT) }`; `ctxOf(deps, id, submitToken?)` is `postContext` for that record (or none) and throws on a refusal; `reachConsent(deps)` posts page 1 with `{ f_name: "Ana Prueba", f_email: "family@example.com", f_baby: "yes_opt" }` and `renderedAt: now`, uploads two `fakeImage()`s to `f_photos`, posts `page_baby` with Next, advances the clock 60 seconds and returns the record id; `submit(deps, id, over)` posts `page_consent` with `action: submit`, `answers: { f_consent: consent }`, the record's token and state, merged with `over`.

```ts
describe("submitForm", () => {
  it("stores the submission, media rows and jobs in one go and deletes the record", async () => {
    const deps = makeSubmissionsDeps();
    const { formId, versionId } = await publishStory(deps);
    const id = await reachConsent(deps);
    const token = deps.inProgress.rows.get(id)?.submitToken;
    const out = await submit(deps, id);
    expect(out).toEqual({ kind: "submitted", submitToken: token });
    const [s] = [...deps.submissions.rows.values()];
    expect(s).toMatchObject({ formId, versionId, locale: "es", reference: "ST-0001", submitToken: token });
    expect(Object.keys(s?.answers ?? {}).sort()).toEqual(["f_baby", "f_consent", "f_email", "f_name", "f_photos"]);
    expect(s?.consent).toEqual({ fieldKey: "f_consent", textVersion: consent.textVersion, acceptedAt: deps.clock.now() });
    const media = [...deps.media.media.rows.values()];
    expect(media.map((m) => [m.position, m.durableKey])).toEqual([
      [1, "forms/story-form/ST-0001/01-photos.jpg"],
      [2, "forms/story-form/ST-0001/02-photos.jpg"],
    ]);
    expect(deps.queue.enqueued.map((j) => j.type).sort()).toEqual([
      "email.staff_notification", "email.submitter_confirmation", "media.upload", "media.upload",
    ]);
    expect(deps.queue.enqueued.every((j) => Object.keys(j.payload).length === 1)).toBe(true);
    expect(deps.inProgress.rows.has(id)).toBe(false);
    expect(JSON.stringify(deps.logger.lines)).not.toMatch(/@|Ana/);
  });

  it("answers a repeated submit with the same confirmation, no second submission and no second reference", async () => {
    const deps = makeSubmissionsDeps();
    const { formId } = await publishStory(deps);
    const id = await reachConsent(deps);
    const token = deps.inProgress.rows.get(id)?.submitToken ?? null;
    await submit(deps, id);
    const updatedAt = deps.definitions.store.forms.get(formId)?.updatedAt;
    const again = await postContext(deps, { slug: "story-form", state: { kind: "record", id }, submitToken: token });
    expect(again).toEqual({ ok: false, outcome: { kind: "submitted", submitToken: token } });
    expect(deps.submissions.rows.size).toBe(1);
    expect(deps.definitions.store.forms.get(formId)?.updatedAt).toEqual(updatedAt);
    const uow = await deps.uow.begin();
    expect(await allocateReference(deps.definitions, uow, formId)).toMatchObject({ ok: true, reference: "ST-0002" });
  });

  it("answers a token already used with the confirmation before taking a reference", async () => {
    const deps = makeSubmissionsDeps();
    const { formId, versionId } = await publishStory(deps);
    const id = await reachConsent(deps);
    const token = deps.inProgress.rows.get(id)?.submitToken ?? "";
    await deps.submissions.insert(await deps.uow.begin(), {
      id: "00000000-0000-4000-8000-0000000000ee", formId, versionId, locale: "es", answers: {}, consent: null,
      receivedAt: deps.clock.now(), reference: "ST-0009", submitToken: token,
    });
    const updatedAt = deps.definitions.store.forms.get(formId)?.updatedAt;
    expect(await submit(deps, id)).toEqual({ kind: "submitted", submitToken: token });
    expect(deps.submissions.rows.size).toBe(1);
    expect(deps.media.media.rows.size).toBe(0);
    expect(deps.queue.ofType("media.upload")).toEqual([]);
    expect(deps.definitions.store.forms.get(formId)?.updatedAt).toEqual(updatedAt);
    const uow = await deps.uow.begin();
    expect(await allocateReference(deps.definitions, uow, formId)).toMatchObject({ ok: true, reference: "ST-0001" });
  });

  it("silently accepts a filled honeypot or a too-fast submission, storing nothing", async () => {
    for (const variant of ["honeypot", "fast"] as const) {
      const deps = makeSubmissionsDeps();
      await publishStory(deps);
      const id = await reachConsent(deps);
      if (variant === "fast") {
        const r = deps.inProgress.rows.get(id);
        if (r) deps.inProgress.rows.set(id, { ...r, startedAt: new Date(deps.clock.now().getTime() - 2_000) });
      }
      const out = await submit(deps, id, variant === "honeypot" ? { honeypot: "http://spam.example" } : {});
      expect(out).toEqual({ kind: "decoy", reference: "ST-5500" });
      expect(deps.submissions.rows.size).toBe(0);
      expect(deps.media.media.rows.size).toBe(0);
      expect(deps.queue.enqueued).toEqual([]);
      expect(deps.inProgress.rows.size).toBe(0);
      expect(deps.media.staging.files.size).toBe(0);
    }
  });

  it("completes against the pinned version after a republish", async () => {
    const deps = makeSubmissionsDeps();
    const { formId, versionId } = await publishStory(deps);
    const id = await reachConsent(deps);
    const v2: Version = { ...storyVersion(), title: { en: "Stories 2", es: "Historias 2" } };
    publishAgain(deps.definitions, formId, v2);
    await submit(deps, id);
    expect([...deps.submissions.rows.values()][0]?.versionId).toBe(versionId);
  });

  it("discards answers and files of a page hidden by a changed answer", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await reachConsent(deps);
    const staged = [...deps.media.staging.files.keys()];
    expect(staged).toHaveLength(2);
    await savePage(deps, await ctxOf(deps, id), post({ pageKey: "page_consent", action: { kind: "back" }, state: { kind: "record", id } }));
    await savePage(deps, await ctxOf(deps, id), post({ pageKey: "page_baby", action: { kind: "back" }, state: { kind: "record", id } }));
    await savePage(deps, await ctxOf(deps, id), post({ answers: { f_name: "Ana Prueba", f_email: "family@example.com", f_baby: "no_opt" }, state: { kind: "record", id } }));
    await submit(deps, id);
    const [s] = [...deps.submissions.rows.values()];
    expect(s?.answers).not.toHaveProperty("f_photos");
    expect(deps.media.media.rows.size).toBe(0);
    expect(deps.media.staging.files.size).toBe(0);
    expect(deps.queue.ofType("media.upload")).toEqual([]);
  });

  it("returns to the first page with a problem when the whole submission is invalid", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await reachConsent(deps);
    const r = deps.inProgress.rows.get(id);
    if (r) deps.inProgress.rows.set(id, { ...r, answers: { ...r.answers, f_name: undefined }, files: {} });
    expect(await submit(deps, id)).toMatchObject({ kind: "refused", recordId: id, refusedFiles: [] });
    expect(deps.inProgress.rows.get(id)).toMatchObject({ pageKey: "page_contact", pending: { issues: [{ code: "required", field: "f_name" }] } });
    expect(deps.submissions.rows.size).toBe(0);
  });

  it("treats an expired record as expired at submit", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await reachConsent(deps);
    const ctx = await ctxOf(deps, id);
    deps.clock.advance(24 * 60 * 60 * 1000);
    expect(await submitForm(deps, ctx, post({ pageKey: "page_consent", action: { kind: "submit" }, answers: { f_consent: consent }, state: { kind: "record", id } }))).toEqual({ kind: "expired" });
    expect(deps.submissions.rows.size).toBe(0);
  });

  it("refuses a form closed before the reference is taken, storing nothing", async () => {
    const deps = makeSubmissionsDeps();
    const { formId } = await publishStory(deps);
    const id = await reachConsent(deps);
    const ctx = await ctxOf(deps, id, deps.inProgress.rows.get(id)?.submitToken ?? null);
    const stored = deps.definitions.store.forms.get(formId);
    if (stored) deps.definitions.store.forms.set(formId, { ...stored, status: "closed" });
    expect(await submitForm(deps, ctx, post({ pageKey: "page_consent", action: { kind: "submit" }, answers: { f_consent: consent }, state: { kind: "record", id } }))).toEqual({ kind: "gate", state: "closed" });
    expect(deps.submissions.rows.size).toBe(0);
    expect(deps.queue.enqueued).toEqual([]);
    expect(deps.inProgress.rows.has(id)).toBe(true);
  });

  it("enqueues no staff notification for a daily cadence or no recipients", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps, { notificationCadence: "daily" });
    const id = await reachConsent(deps);
    await submit(deps, id);
    expect(deps.queue.ofType("email.staff_notification")).toEqual([]);
  });
});

describe("a filled honeypot on any post", () => {
  it("deletes the record and its staged files on Next, Back and the language switch, and answers the decoy", async () => {
    for (const action of [{ kind: "next" }, { kind: "back" }, { kind: "language", locale: "en" }] as const) {
      const deps = makeSubmissionsDeps();
      await publishStory(deps);
      const id = await reachConsent(deps);
      expect(deps.media.staging.files.size).toBe(2);
      const out = await savePage(deps, await ctxOf(deps, id), post({ pageKey: "page_consent", action, honeypot: "x", state: { kind: "record", id } }));
      expect(out).toEqual({ kind: "decoy", reference: "ST-5500" });
      expect(deps.inProgress.rows.size).toBe(0);
      expect(deps.media.staging.files.size).toBe(0);
      expect(deps.submissions.rows.size).toBe(0);
    }
  });

  it("stores nothing for a filled honeypot on page 1, where there is no record yet", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    expect(await savePage(deps, await ctxOf(deps, null), post({ answers: { f_name: "Ana Prueba", f_baby: "no_opt" }, honeypot: "x" }))).toEqual({ kind: "decoy", reference: "ST-5500" });
    expect(deps.inProgress.rows.size).toBe(0);
  });
});
```

(`random: () => 0.5` in the fakes gives the decoy `ST-5500`. Imports: `allocateReference` and `publishAgain` from definitions' testing fakes and public API, `fakeImage` from media's fakes, `consentTextVersion` and `Version` from the form model, `CONSENT_TEXT` and `storyVersion` from `../domain/testing/versions`.)

`expire.test.ts`:

```ts
describe("expireInProgress", () => {
  it("removes records past 24 hours with their staged files, and keeps fresh ones", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const none = await postContext(deps, { slug: "story-form", state: { kind: "none" }, submitToken: null });
    if (!none.ok) throw new Error("closed");
    const out = await savePage(deps, none, post({ answers: { f_name: "Ana Prueba", f_baby: "yes_opt" } }));
    if (out.kind !== "show") throw new Error(out.kind);
    const ctx = await postContext(deps, { slug: "story-form", state: { kind: "record", id: out.recordId }, submitToken: null });
    if (!ctx.ok) throw new Error("expired");
    await uploadFile(deps, ctx, { fieldKey: "f_photos", bytes: fakeImage(), renderedAt: null, acceptLanguage: "es" });
    expect(await expireInProgress(deps, { now: deps.clock.now(), logger: deps.logger })).toBe(0);
    const later = new Date(deps.clock.now().getTime() + 24 * 60 * 60 * 1000);
    expect(await expireInProgress(deps, { now: later, logger: deps.logger })).toBe(1);
    expect(deps.inProgress.rows.size).toBe(0);
    expect(deps.media.staging.files.size).toBe(0);
    expect(deps.logger.lines.at(-1)).toMatchObject({ msg: "expired in-progress records removed", fields: { removed: 1 } });
  });
});
```

- [ ] **Step 2: Run** `pnpm test src/modules/submissions/application`: fails.

- [ ] **Step 3: Implement.**
  - `silentAccept`: when `locked`, deletes the in-progress row in the given unit of work; returns `{ kind: "decoy", reference: decoyReference(form.settings.referencePrefix, deps.random) }`. Both callers, after commit, `discardQuietly` the post's staged refs and `discardRecordFiles(deps.media, recordId)` (errors swallowed: the prefix goes at expiry anyway).
  - `savePage` gains, first inside its unit of work (after locking or deciding to create), `if (isHoneypotFilled(post.honeypot))` returning `silentAccept` with `locked: locked !== null`; nothing is inserted for a post without a record.
  - `submitForm` (comment: the intake transaction of `architecture.md`, "Submission data flow" step 3; nothing external is called, the jobs do that after commit) follows the order above. Staging and merging are as in `savePage`; a refusal on the posted page stores `pending { pageKey, raw, issues }` and answers `refused` with the record's locale and the batch's refused files; a whole-submission refusal stores `pending` with the issues of `firstPageWithIssue` on that page (raw values empty unless it is the posted page) and answers `refused` with no files. The pre-check is `deps.submissions.findBySubmitToken(record.submitToken)` of this form. Attached files come from `planFiles(full.answers, record.files)`; each gets `durableKey({ formSlug: allocated.form.slug, reference, position, fieldSlug, ext: extensionFor(contentType) })`. The consent record is `{ ...full.consent, acceptedAt: now }` or null. The info log is `submission received` with `{ formId, submissionId }`. After commit: discard the overflow and the discarded plan refs; for a decoy also the record prefix. If the unit of work throws anything but `DuplicateSubmit`, discard the batch refs and rethrow.
  - `expireInProgress` (comment: the `jobs.cleanup` step for submissions; files first and under the row lock, so a failure leaves the row for the next run rather than orphaned files; `jobs.md`, "Recurring jobs"): `listExpired(now, limit ?? 500)`; per id one unit of work locks the row, re-checks `isExpired`, calls `discardRecordFiles`, deletes the row; logs `expired in-progress records removed` with `{ removed }` and returns the count.
  - `index.ts`: export `submitForm` and `expireInProgress`.

- [ ] **Step 4: Run** `pnpm test src/modules/submissions && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(submissions): the intake transaction with silent accepts on every post, duplicate submits and expiry`

---

### Task 22: Submissions against Postgres: fault injection, the close race, duplicates, cleanup, and the message source

**Files:**
- Create: `src/modules/submissions/infrastructure/message-source.ts`
- Test: `tests/integration/submissions/intake.test.ts`, `tests/integration/submissions/message-source.test.ts`, `tests/integration/submissions/wiring.ts`

**Interfaces:**
- Consumes: Tasks 8, 13, 14, 17, 21.
- Produces:

```ts
// message-source.ts: notifications' MessageSource, implemented over submissions and definitions
export class SubmissionMessageSource implements MessageSource {
  constructor(deps: {
    submissions: SubmissionRepository; definitions: DefinitionsDeps; versions: VersionCache; registry: FieldTypeRegistry;
    publicBaseUrl: string; privacyContact: string;
  });
}
// tests/integration/submissions/wiring.ts
export function pgSubmissionsDeps(pool: Pool, dirs: { staging: string; durable: string }, over?: { queue?: JobQueue }): SubmissionsDeps;
```

The message source formats the received time per locale in the form's time zone (`Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone })` for the submitter; `YYYY-MM-DD HH:mm <zone>, HH:mm UTC` for staff, from `en-CA` parts with `hourCycle: "h23"`) and builds the manager link `${publicBaseUrl}/admin/forms/<form id>` (the form's page until the review plan adds the submission page). It returns null when the submission is gone, when the version has no confirmation email or no submitter address was answered, or, for staff, when the cadence is not per submission or there are no recipients.

- [ ] **Step 1: Wiring helper** `tests/integration/submissions/wiring.ts`: `pgSubmissionsDeps` builds the real adapters of the three modules the way the container does: `DefinitionsDeps` over the Postgres form, draft and version repositories, `PgSubmissionStats`, `PgAuditLog`, `PgAuditLogReader`, `allowedRecipientDomains: ["example.com"]`, `publicBaseUrl: "http://localhost:3000"`; `MediaDeps` with `LocalDiskStorage` for both directories, `FileTypeSniffer`, `SharpImageEncoder`, `PgMediaRepository`; the Postgres in-progress and submission repositories; one `PgUnitOfWorkFactory`, the queue (`over.queue` or `PgJobQueue(systemIdGenerator, systemClock)`) shared by all three; `systemClock`, `systemIdGenerator`, `buildDefaultRegistry()`, a `RecordingLogger`, a `VersionCache` and `Math.random`.

- [ ] **Step 2: Failing integration tests** `tests/integration/submissions/intake.test.ts`. Setup and helpers, described once: each test truncates, makes a `mkdtemp` directory (removed afterwards) and seeds `({ slug, formId, versionId } = await seedPublishedForm(pool))`; `count(table)`; `stagedFiles()` lists files (names with a dot) under `<dir>/staging`; `contextOf(deps, id)`; `emptyPost(id)` is a `PagePost` on `page_consent` with Next, nothing posted, `state: { kind: "record", id }`; `reachPhotos(deps)` posts page 1 with `{ f_name: "Ana Prueba", f_email: "family@example.com", f_baby: "yes_opt" }` and `renderedAt` a minute ago, returning the record id; `reachConsent(deps)` adds two real uploads (`syntheticJpegWithGps()`, `syntheticPng()`) and posts `page_baby`; `submit(deps, id, over)` reads the record's token from `submission_in_progress`, takes `postContext` (a refusal is returned as the outcome) and calls `submitForm` with Submit, `{ f_consent: consent }` and the token, merged with `over`; `formRow()` selects `next_reference, updated_at` of the seeded form; `FailingQueue(inner, failAt)` is a `JobQueue` whose `failAt`-th enqueue rejects with `injected enqueue failure`.

```ts
  it("stores everything in one transaction", async () => {
    const deps = pgSubmissionsDeps(pool, { staging: path.join(dir, "staging"), durable: path.join(dir, "durable") });
    const id = await reachConsent(deps);
    const out = await submit(deps, id);
    expect(out.kind).toBe("submitted");
    expect([await count("submission"), await count("media"), await count("submission_in_progress")]).toEqual([1, 2, 0]);
    const jobs = (await pool.query<{ type: string }>("select type from job order by type")).rows.map((r) => r.type);
    expect(jobs).toEqual(["email.staff_notification", "email.submitter_confirmation", "media.upload", "media.upload"]);
    expect(await stagedFiles()).toHaveLength(2);
  });

  it("leaves no orphan media rows or jobs when the intake fails, and keeps the record and its files", async () => {
    for (const failAt of [0, 1, 2, 3]) {
      await truncateAll(pool);
      ({ slug, formId } = await seedPublishedForm(pool));
      const queue = new FailingQueue(new PgJobQueue(systemIdGenerator, systemClock), failAt);
      const deps = pgSubmissionsDeps(pool, { staging: path.join(dir, `staging-${String(failAt)}`), durable: path.join(dir, "durable") }, { queue });
      const id = await reachConsent(deps);
      await expect(submit(deps, id)).rejects.toThrow("injected enqueue failure");
      expect([await count("submission"), await count("media"), await count("job")]).toEqual([0, 0, 0]);
      expect(await count("submission_in_progress")).toBe(1);
      expect((await formRow())?.next_reference).toBe(1);
      expect((await readdir(path.join(dir, `staging-${String(failAt)}`), { recursive: true })).filter((f) => String(f).includes("."))).toHaveLength(2);
    }
  });

  it("refuses a submission when the form closes during the intake", async () => {
    const deps = pgSubmissionsDeps(pool, { staging: path.join(dir, "staging"), durable: path.join(dir, "durable") });
    const id = await reachConsent(deps);
    const closer = await pool.connect();
    try {
      await closer.query("begin");
      await closer.query("select id from form where id = $1 for update", [formId]);
      const pending = submit(deps, id);
      await waitForLockWaiters(pool);
      await closer.query("update form set status = 'closed' where id = $1", [formId]);
      await closer.query("commit");
      expect(await pending).toEqual({ kind: "gate", state: "closed" });
    } finally {
      closer.release();
    }
    expect([await count("submission"), await count("media"), await count("job")]).toEqual([0, 0, 0]);
  });

  it("answers two simultaneous Submits with one submission and one reference", async () => {
    const deps = pgSubmissionsDeps(pool, { staging: path.join(dir, "staging"), durable: path.join(dir, "durable") });
    const id = await reachConsent(deps);
    const before = await formRow();
    const [a, b] = await Promise.all([submit(deps, id), submit(deps, id)]);
    expect(a).toEqual(b);
    expect(a.kind).toBe("submitted");
    expect(await count("submission")).toBe(1);
    expect(await formRow()).toEqual({ next_reference: 2, updated_at: before?.updated_at });
  });

  it("commits nothing for a submit token that already has a submission", async () => {
    const deps = pgSubmissionsDeps(pool, { staging: path.join(dir, "staging"), durable: path.join(dir, "durable") });
    const id = await reachConsent(deps);
    const token = (await pool.query<{ t: string }>("select submit_token as t from submission_in_progress where id = $1", [id])).rows[0]?.t ?? "";
    await deps.uow.run((u) =>
      deps.submissions.insert(u, { id: randomUUID(), formId, versionId, locale: "es", answers: {}, consent: null, receivedAt: new Date(), reference: "SF-0009", submitToken: token }),
    );
    const before = await formRow();
    expect(await submit(deps, id)).toEqual({ kind: "submitted", submitToken: token });
    expect([await count("submission"), await count("media"), await count("job")]).toEqual([1, 0, 0]);
    expect(await formRow()).toEqual(before);
  });

  it("refuses a lying, truncated or oversized file and stages nothing", async () => {
    const deps = pgSubmissionsDeps(pool, { staging: path.join(dir, "staging"), durable: path.join(dir, "durable") });
    const id = await reachPhotos(deps);
    const jpeg = await syntheticJpegWithGps();
    const tries = [
      [htmlPretendingToBeJpeg(), "file_wrong_type"],
      [jpeg.subarray(0, Math.floor(jpeg.length / 2)), "file_unreadable"],
      [brokenMp4(), "file_unreadable"],
      [new Uint8Array(11 * 1024 * 1024), "file_too_large"],
    ] as const;
    for (const [bytes, code] of tries) {
      const out = await uploadFile(deps, await contextOf(deps, id), { fieldKey: "f_photos", bytes, renderedAt: null, acceptLanguage: "es" });
      expect(out).toMatchObject({ ok: false, code });
    }
    expect(await stagedFiles()).toEqual([]);
  });

  it("deletes the record and its staged files for a filled honeypot on a Next post", async () => {
    const deps = pgSubmissionsDeps(pool, { staging: path.join(dir, "staging"), durable: path.join(dir, "durable") });
    const id = await reachConsent(deps);
    expect(await stagedFiles()).toHaveLength(2);
    const out = await savePage(deps, await contextOf(deps, id), { ...emptyPost(id), honeypot: "https://spam.example" });
    expect(out.kind).toBe("decoy");
    expect([await count("submission"), await count("submission_in_progress"), await count("media")]).toEqual([0, 0, 0]);
    expect(await stagedFiles()).toEqual([]);
  });

  it("expireInProgress removes expired records and their staged files", async () => {
    const deps = pgSubmissionsDeps(pool, { staging: path.join(dir, "staging"), durable: path.join(dir, "durable") });
    await reachConsent(deps);
    expect(await stagedFiles()).toHaveLength(2);
    const removed = await expireInProgress(deps, { now: new Date(Date.now() + 25 * 60 * 60 * 1000), logger: new RecordingLogger() });
    expect(removed).toBe(1);
    expect(await count("submission_in_progress")).toBe(0);
    expect(await stagedFiles()).toEqual([]);
  });

  it("closes through the lifecycle use case and the open tab is refused", async () => {
    const deps = pgSubmissionsDeps(pool, { staging: path.join(dir, "staging"), durable: path.join(dir, "durable") });
    const id = await reachConsent(deps);
    expect((await applyLifecycle(deps.definitions, { email: "editor@example.com", ip: "203.0.113.7" }, { formId, action: "close" })).ok).toBe(true);
    expect(await submit(deps, id)).toEqual({ kind: "gate", state: "closed" });
  });
```

`tests/integration/submissions/message-source.test.ts`:

```ts
describe("SubmissionMessageSource", () => {
  const pool = testPool();
  beforeEach(() => truncateAll(pool));

  it("builds both messages from the stored submission at run time", async () => {
    const { formId, versionId } = await seedPublishedForm(pool);
    const deps = pgSubmissionsDeps(pool, { staging: "/tmp/unused", durable: "/tmp/unused" });
    const form = await deps.definitions.forms.findById(formId);
    if (!form) throw new Error("no form");
    await updateSettings(deps.definitions, { email: "editor@example.com", ip: "203.0.113.7" }, {
      formId, settings: { ...form.settings, notificationRecipients: ["stories@example.com"], timezone: "America/Panama" },
    });
    const repo = new PgSubmissionRepository(pool);
    const id = randomUUID();
    await deps.uow.run((u) =>
      repo.insert(u, {
        id, formId, versionId, locale: "es", answers: { f_name: "Ana Prueba", f_email: "family@example.com" }, consent: null,
        receivedAt: new Date("2026-10-10T14:00:00Z"), reference: "SF-0001", submitToken: randomUUID(),
      }),
    );
    const source = new SubmissionMessageSource({
      submissions: repo, definitions: deps.definitions, versions: new VersionCache(), registry,
      publicBaseUrl: "https://forms.example.com", privacyContact: "privacy@example.com",
    });
    expect(await source.submitterConfirmation(id)).toEqual({
      to: "family@example.com",
      data: { locale: "es", formTitle: "Historias", subject: "Gracias", body: "Lo recibimos.", receivedOn: "10 de octubre de 2026", reference: "SF-0001", retentionMonths: 12, contact: "privacy@example.com" },
    });
    expect(await source.staffNotification(id)).toEqual({
      to: ["stories@example.com"],
      data: { formTitle: "Sample form", reference: "SF-0001", receivedAt: "2026-10-10 09:00 America/Panama, 14:00 UTC", link: `https://forms.example.com/admin/forms/${formId}` },
    });
    expect(await source.submitterConfirmation(randomUUID())).toBeNull();
  });
});
```

- [ ] **Step 3: Run** `pnpm test:integration tests/integration/submissions`: the intake tests fail only on behavior the earlier tasks did not cover (none expected) and the message source test fails on the missing class.

- [ ] **Step 4: Implement** `SubmissionMessageSource` (comment: the data the two email jobs need, read at run time from a submission id; `jobs.md`). `submitterConfirmation`: load the submission, the form (`loadForm`) and the pinned version (cache); null unless the version has a confirmation email and `submitterAddress` answers; the data resolves title, subject and body in the submission's locale, `receivedOn` as above in the form's time zone, the reference, the form's retention months and the privacy contact. `staffNotification`: load the submission and the form; null unless the cadence is `per_submission` and recipients exist; `to` is a copy of the recipients, the title in English, `receivedAt` and `link` as above.

- [ ] **Step 5: Run** `pnpm test:integration tests/integration/submissions && pnpm test && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 6: Commit** `test(submissions): intake atomicity, the close race, duplicate submits and cleanup against Postgres; email message source`

---

### Task 23: Renderer copy, formatting and validation messages

**Files:**
- Create: `src/modules/submissions/presentation/copy.ts`, `format.ts`, `messages.ts`, with `copy.test.ts`, `format.test.ts`, `messages.test.ts` beside them

**Interfaces:**
- Consumes: `fill`, `Text` from `@/shared/presentation/copy`; `specTableRows` (Task 3); `validationCodes`, `ValidationIssue`, `UploadLimits`; `RefusedFile`, `UploadRefusal` (Tasks 16, 20).
- Produces:

```ts
// copy.ts
export const chrome: { readonly [K in ChromeKey]: Text };       // every row of renderer.md "Fixed chrome copy"
export const catalog: { readonly [K in CatalogKey]: Text };     // every row of renderer.md "Message catalog"
export type ChromeKey = keyof typeof chrome;
export type CatalogKey = keyof typeof catalog;
export function t(locale: Locale, key: ChromeKey, vars?: Readonly<Record<string, string>>): string;
export function isOne(locale: Locale, n: number): boolean;     // Intl.PluralRules gives "one"
// format.ts
export function formatNumber(n: number, locale: Locale): string;
export function formatMegabytes(mb: number, locale: Locale): string;          // "10 MB"
export function formatBytes(bytes: number, locale: Locale): string;           // "512 kB", "1.5 MB" / "1,5 MB"
export function formatIsoDate(iso: string, locale: Locale): string;           // "November 9, 2026" / "9 de noviembre de 2026"
export function formatInstant(iso: string, locale: Locale, timeZone: string): string;
export function kindsKey(kinds: readonly ("image" | "video")[]): "kinds_images" | "kinds_videos" | "kinds_mixed";
export function limitsKey(kinds: readonly ("image" | "video")[]): "files_limits_images" | "files_limits_videos" | "files_limits_mixed";
export function acceptAttribute(kinds: readonly ("image" | "video")[]): string;
// messages.ts
export function issueMessage(issue: Pick<ValidationIssue, "code" | "params">, label: string, locale: Locale): string;
export function fileIssueMessage(issue: Pick<RefusedFile, "code" | "name">, limits: UploadLimits, locale: Locale): string;
export function uploadRefusalMessage(code: UploadRefusal, ctx: { file: string; label: string; limits: UploadLimits }, locale: Locale): string;
export function errorSummaryHeading(count: number, locale: Locale): string;
export function filesCount(count: number, max: number, locale: Locale): string;
```

A catalog row is found from the code by replacing underscores with spaces (`files_min` is "files min"); when `{n}` is one in that language the `… one` row is used if it exists (renderer.md, "Message catalog"). Messages take the code and parameters only, never a field key, so production code never builds a `ValidationIssue` it does not have.

- [ ] **Step 1: Failing tests.** `copy.test.ts`:

```ts
const asText = (rows: Map<string, string[]>) => Object.fromEntries([...rows].map(([k, [en, es]]) => [k, { en, es }]));

describe("renderer copy", () => {
  it("binds every row of the fixed chrome copy in renderer.md, which owns the text", () => {
    expect(chrome).toEqual(asText(specTableRows("specs/ui-ux/renderer.md", "Fixed chrome copy")));
  });

  it("binds every row of the message catalog", () => {
    expect(catalog).toEqual(asText(specTableRows("specs/ui-ux/renderer.md", "Message catalog")));
  });

  it("has a catalog row for every validation code and every file refusal", () => {
    for (const code of [...validationCodes, "file_too_large", "file_wrong_type", "file_unreadable", "upload_failed", "submission_too_large"]) {
      expect(Object.hasOwn(catalog, code.replaceAll("_", " ")), code).toBe(true);
    }
  });

  it("fills placeholders in the chosen language", () => {
    expect(t("es", "progress", { n: "2", total: "5" })).toBe("Página 2 de 5");
  });
});
```

`format.test.ts`:

```ts
describe("format", () => {
  it("formats sizes and dates per locale", () => {
    expect(formatMegabytes(10, "en")).toBe("10 MB");
    expect(formatMegabytes(10, "es")).toBe("10 MB");
    expect(formatBytes(1536 * 1024, "en")).toBe("1.5 MB");
    expect(formatBytes(1536 * 1024, "es")).toBe("1,5 MB");
    expect(formatIsoDate("2026-11-09", "en")).toBe("November 9, 2026");
    expect(formatIsoDate("2026-11-09", "es")).toBe("9 de noviembre de 2026");
  });

  it("names the accepted kinds and the input's accept list", () => {
    expect(kindsKey(["image"])).toBe("kinds_images");
    expect(kindsKey(["video"])).toBe("kinds_videos");
    expect(kindsKey(["image", "video"])).toBe("kinds_mixed");
    expect(limitsKey(["video", "image"])).toBe("files_limits_mixed");
    expect(acceptAttribute(["image"])).toBe("image/jpeg,image/png,image/webp,image/heic,image/heif,.heic");
    expect(acceptAttribute(["video"])).toBe("video/mp4,video/quicktime");
  });
});
```

`messages.test.ts`:

```ts
const limits = { kinds: ["image", "video"] as const, maxFiles: 10, maxSizeMb: 10 };

describe("messages", () => {
  it("builds each message from the rule and the label, in the locale", () => {
    expect(issueMessage({ code: "required" }, "Celular", "es")).toBe("Celular es obligatorio");
    expect(issueMessage({ code: "email_syntax" }, "E-mail", "en")).toBe("Enter a valid email address, like name@example.com");
    expect(issueMessage({ code: "date_min", params: { date: "2026-01-31" } }, "Birth", "en")).toBe("Birth must be on or after January 31, 2026");
  });

  it("uses the singular row when n is one", () => {
    expect(issueMessage({ code: "files_min", params: { n: 1 } }, "Fotos", "es")).toBe("Sube al menos 1 archivo en Fotos");
    expect(issueMessage({ code: "files_min", params: { n: 2 } }, "Fotos", "es")).toBe("Sube al menos 2 archivos en Fotos");
    expect(issueMessage({ code: "max_length", params: { n: 1 } }, "Code", "en")).toBe("Code must have no more than 1 character");
    expect(errorSummaryHeading(1, "en")).toBe("Please fix 1 problem before continuing");
    expect(errorSummaryHeading(3, "es")).toBe("Corrige 3 problemas para continuar");
    expect(filesCount(0, 1, "en")).toBe("0 of 1 file");
    expect(filesCount(2, 10, "es")).toBe("2 de 10 archivos");
  });

  it("names the file, the size and the kinds in file messages", () => {
    expect(fileIssueMessage({ code: "file_too_large", name: "a.jpg" }, limits, "en")).toBe("a.jpg is larger than 10 MB");
    expect(fileIssueMessage({ code: "file_wrong_type", name: "a.txt" }, limits, "es")).toBe(
      "a.txt no es un tipo permitido. Usa fotos JPEG, PNG, WebP o HEIC, o videos MP4 o MOV",
    );
    expect(fileIssueMessage({ code: "submission_too_large", name: "v.mp4" }, limits, "en")).toBe("v.mp4 would take this form's files past 100 MB in total");
    expect(uploadRefusalMessage("files_max", { file: "a.jpg", label: "Fotos", limits }, "es")).toBe("Puedes subir hasta 10 archivos en Fotos");
    expect(uploadRefusalMessage("expired", { file: "a.jpg", label: "Fotos", limits }, "en")).toBe("a.jpg did not upload. Check your connection and retry");
  });
});
```

- [ ] **Step 2: Run** `pnpm test src/modules/submissions/presentation`: fails.

- [ ] **Step 3: Implement.**
  - `copy.ts` (header: the text is owned by `renderer.md`, "Fixed chrome copy" and "Message catalog"; `copy.test.ts` keeps these objects equal to those rows): transcribe every row of both spec tables, as they stand after Task 1, into `chrome` (keyed by the chrome key) and `catalog` (keyed by the rule name with spaces), each `{ en, es }`, `as const satisfies Record<string, Text>`. The copy test enforces completeness and exact text. `t` is `fill(chrome[key][locale], vars)`; `isOne` is `new Intl.PluralRules(locale).select(n) === "one"`.
  - `format.ts`: `Intl.NumberFormat` throughout; megabytes with `style: "unit", unit: "megabyte", unitDisplay: "short", maximumFractionDigits: 1`; `formatBytes` uses megabytes from 1 MB and kilobytes (at least 1, no decimals) below; `formatIsoDate` formats `<iso>T00:00:00Z` with `dateStyle: "long", timeZone: "UTC"` (an unreadable date is returned as given); `formatInstant` uses `dateStyle: "long", timeStyle: "short"` in the zone with its short name; `kindsKey` and `limitsKey` map the kinds as the tests show; `acceptAttribute` is a picker hint only (the server decides by content).
  - `messages.ts` (the renderer builds every message from the rule and the label; staff never write them): `issueMessage` picks the row (the `one` variant when `isOne(locale, n)` and it exists) and fills `label`, `n` (formatted) and `date` (`formatIsoDate`); rows without `{label}` simply ignore it. `fileIssueMessage` fills `file` (the name), `size` (`formatMegabytes(maxSizeMb)`, or `LIMITS.submissionSizeMb` for `submission_too_large`) and `kinds` (`t(locale, kindsKey(kinds))`). `uploadRefusalMessage` sends `files_max` through `issueMessage({ code: "files_max", params: { n: maxFiles } }, label, locale)`, reads `expired` and `not_allowed` as "upload failed", and otherwise uses the code's file row. `errorSummaryHeading` and `filesCount` use the `_one` chrome rows when `isOne` holds for the count (or the maximum).

- [ ] **Step 4: Run** `pnpm test src/modules/submissions/presentation && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(submissions): renderer copy bound to the spec, locale formatting and validation messages`

---

### Task 24: Field renderers, the upload field, form decoding and the renderer conformance test

**Files:**
- Create: `src/modules/submissions/presentation/fields/types.ts`, `FieldShell.tsx`, `text.tsx`, `number.tsx`, `date.tsx`, `choice.tsx`, `checkbox.tsx`, `consent.tsx`, `file-upload.tsx`, `section.tsx`, `index.ts`
- Create: `src/modules/submissions/presentation/page-form-state.ts`, `client/UploadField.tsx`, `client/refused-files.ts`, `client/UploadField.test.ts` (the no-script markup; Task 26 adds the behavior)
- Create: `src/modules/submissions/presentation/styles.ts` and an empty `renderer.module.css` (Task 25 fills the stylesheet)
- Create: `src/modules/submissions/presentation/decode.ts`, `decode.test.ts`
- Test: `src/modules/submissions/presentation/fields/conformance.test.ts`, `fields/fields.test.ts`

**Interfaces:**
- Consumes: Task 23 copy and messages; `RichText` (Task 3); `effectiveDisplay`, `consentTextVersion`, `fieldTypeIds`, `FieldTypeId`, `Field`, `ValidationCode`, form model fixtures through `fieldTypes`; `PageAction`, `IncomingFile`, `RawValues`, `HONEYPOT_FIELD` (Task 18).
- Produces:

```ts
// fields/types.ts
export type FormValues = Readonly<Record<string, string | string[]>>;
export interface FieldInput { get(name: string): string | null; getAll(name: string): string[] }
export interface Decoded { value: unknown; issue: ValidationCode | null }   // value undefined: no answer
export interface FileRowView { id: string; kind: "image" | "video"; label: string; size: string }
export interface FieldProps {
  field: Field; locale: Locale; languages: Languages; slug: string;
  label: string; help: string | null; required: boolean;
  values: FormValues;            // the page's posted values when refused, else the stored answer encoded
  error: string | null;          // the localized message for this field, or null
  files: readonly FileRowView[];
}
export interface FieldRenderer {
  decode(input: FieldInput, field: Field): Decoded;
  encode(value: unknown, field: Field): FormValues;
  Component(props: FieldProps): ReactElement | null;
}
export function ids(key: string): { control: string; help: string; error: string; legend: string };
export const one: (values: FormValues, name: string) => string;      // first value or ""
export const many: (values: FormValues, name: string) => string[];
// fields/FieldShell.tsx
export function describedBy(props: FieldProps, extra?: readonly string[]): string;
export function Star(props: { required: boolean }): ReactElement | null;
export function Help(props: { props: FieldProps }): ReactElement | null;
export function ErrorSlot(props: { props: FieldProps }): ReactElement;
export function FieldShell(props: { props: FieldProps; children: ReactNode }): ReactElement;
export function GroupShell(props: { props: FieldProps; legend?: ReactNode; children: ReactNode }): ReactElement;
// fields/index.ts
export const fieldRenderers: Record<FieldTypeId, FieldRenderer>;
// page-form-state.ts (no directive: shared by the Server Action and the client components)
export interface RefusedFileMessage { fieldKey: string; message: string }
export interface PageFormState { refusedFiles: RefusedFileMessage[] }       // what a refused post answers beyond the stored record
export const EMPTY_PAGE_FORM_STATE: PageFormState;                          // { refusedFiles: [] }
export type PageFormAction = (state: PageFormState, form: FormData) => Promise<PageFormState>;
// client/refused-files.ts ('use client')
export const RefusedFilesContext: Context<readonly RefusedFileMessage[]>;   // default []
// client/UploadField.tsx ('use client')
export interface UploadFieldProps {
  slug: string; fieldKey: string; inputId: string; errorId: string; countId: string; describedBy: string; accept: string;
  required: boolean; maxFiles: number; maxBytes: number; kinds: readonly ("image" | "video")[]; error: string | null;
  initial: FileRowView[]; initialCount: string;
  text: {
    chooseFiles: string; uploading: string; uploaded: string; remove: string; retry: string; removed: string;
    count: string; countOne: string; failed: string; tooLarge: string; wrongType: string;   // "{file}" left for the client
  };
  locale: Locale;
}
export function UploadField(props: UploadFieldProps): ReactElement;
// decode.ts
export interface DecodedPost {
  pageKey: string; action: PageAction; answers: Record<string, unknown>; decodeIssues: ValidationIssue[];
  raw: RawValues; incoming: IncomingFile[]; renderedAt: Date | null; honeypot: string; submitToken: string | null;
}
export function parseAction(value: string | null): PageAction | null;
export function formInput(form: FormData): FieldInput;
export async function decodePagePost(form: FormData, version: Version, registry: FieldTypeRegistry): Promise<DecodedPost | null>;
export function decodeField(form: FormData, field: Field): Decoded;
```

Control names: a field's inputs use its key (`<key>`, or `<key>.day`, `<key>.month`, `<key>.year` for dates). The page's own fields are `_page`, `_action`, `_rendered`, `_token` and the honeypot `website-url`; none can be a field key (keys match `^[a-z][a-z0-9_]{3,31}$`). Next's own hidden fields for the Server Action (names starting with `$`) are never read.

Markup rules every component keeps (renderer.md, "Field rendering", and design-system/accessibility.md, "Forms"): `<label for>` or `<fieldset>` with `<legend>`; help before the control, linked with `aria-describedby`; the error slot `<p id="<key>-error">` always present, linked and `aria-invalid="true"` when it holds a message; `required` and `aria-required` on required inputs and the star after the label with `aria-hidden`; no `type="number"`, no native date picker, no custom widgets.

- [ ] **Step 1: Failing conformance test** `fields/conformance.test.ts`:

```ts
const input = (values: Record<string, string | string[]>): FieldInput => ({
  get: (n) => {
    const v = values[n];
    return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? null) : null;
  },
  getAll: (n) => {
    const v = values[n];
    return v === undefined ? [] : Array.isArray(v) ? v : [v];
  },
});

function fieldOf(id: (typeof fieldTypeIds)[number], settings: unknown): Field {
  return { key: asKey("f_probe"), type: id, label: { en: "Probe", es: "Sonda" }, required: true, personal: false, validation: [], settings };
}

describe("renderer conformance", () => {
  it("has a renderer for every registered field type", () => {
    expect(Object.keys(fieldRenderers).sort()).toEqual([...fieldTypeIds].sort());
  });

  for (const id of fieldTypeIds) {
    const def = fieldTypes[id];
    for (const [i, settings] of def.fixtures.settings.entries()) {
      for (const locale of ["en", "es"] as const) {
        it(`${id} renders settings fixture ${String(i)} in ${locale}, labelled and with an error slot`, () => {
          const html = renderToStaticMarkup(
            createElement(fieldRenderers[id].Component, {
              field: fieldOf(id, settings), locale, languages: "bilingual", slug: "probe-form",
              label: locale === "en" ? "Probe" : "Sonda", help: null, required: def.isInput, values: {},
              error: def.isInput ? "Probe is required" : null, files: [],
            }),
          );
          if (!def.isInput) {
            expect(html).toMatch(/<h2/);
            return;
          }
          expect(html).toMatch(/<label[^>]*for="f-f_probe"|<legend/);
          expect(html).toContain('id="f_probe-error"');
          expect(html).toContain('aria-invalid="true"');
          expect(html).toContain("Probe is required");
          expect(html).not.toMatch(/type="number"|type="date"/);
        });
      }
      it(`${id} decodes what it encodes for every valid answer fixture`, () => {
        const field = fieldOf(id, def.settingsSchema.parse(settings));
        const renderer = fieldRenderers[id];
        for (const answer of def.fixtures.validAnswers) {
          const encoded = renderer.encode(answer, field);
          if (Object.keys(encoded).length === 0) continue; // file_upload and section carry no form value
          const decoded = renderer.decode(input({ ...encoded }), field);
          expect(decoded.issue).toBeNull();
          expect(def.normalize(def.answerSchema.parse(decoded.value), field.settings)).toEqual(
            def.normalize(answer, field.settings),
          );
        }
      });
    }
  }
});
```

`fields/fields.test.ts` (per-type behavior the conformance loop does not reach). Helpers: `base(field)` is a `Field` with key `asKey("f_probe")`, label `{ en: "Probe", es: "Sonda" }`, not required, not personal, no rules, then `...field`; `render(props)` renders the type's `Component` with `locale: "en"`, `languages: "bilingual"`, `slug: "probe-form"`, `label: "Probe"`, no help, not required, empty values, no error, no files, then `...props`; `input(values)` is a `FieldInput` over a plain record. Cases:
- "number: text input with a decimal keypad, unit after it, and not_a_number for words": `base({ type: "number", settings: { integerOnly: false, unit: { en: "weeks", es: "semanas" } } })` renders `inputmode="decimal"` and `weeks`; decoding `"2,5"` gives `{ value: 2.5, issue: null }`, `"thirty"` gives `{ value: undefined, issue: "not_a_number" }`, `" "` gives `{ value: undefined, issue: null }`.
- "date: day, month and year in the locale's order inside a fieldset, impossible input is date_invalid": in `en`, `f_probe.month` comes before `f_probe.day`; in `es`, `f_probe.day` before `f_probe.month`, and the markup matches `/<fieldset[^>]*>\s*<legend/`; decoding `{ "f_probe.day": "9", "f_probe.month": "11", "f_probe.year": "2026" }` gives `{ value: "2026-11-09", issue: null }`, and without the month `{ value: undefined, issue: "date_invalid" }`.
- "single choice: radio by default, dropdown only from seven options, with the Choose one placeholder": options `opt_0` to `opt_6` (`Option <i>` / `Opción <i>`); six of them with `display: "dropdown"` still render `type="radio"`; all seven render `<select` and `Choose one`.
- "consent: the text as legend in plain paragraphs, never pre-checked, decoded with the pinned text version": `text = { en: "I agree to **synthetic** terms.\n\nSecond paragraph.", es: "Acepto términos sintéticos." }`, `coveredItems: []`; the markup holds `<legend`, the literal `I agree to **synthetic** terms.`, no `<strong>`, `Second paragraph.`, `I have read and agree`, and no `checked`; decoding `accepted` gives `{ value: { accepted: true, textVersion: consentTextVersion(text) }, issue: null }`.
- "long text: counter only with a max length": `{ rows: 4 }` renders no `characters`; with `validation: [{ rule: "max_length", value: 500 }]` and value `abc` it renders `3 of 500 characters`.
- "file upload: the video notice before the input, limits as help, rows with Remove, and the count": settings `{ kinds: ["image", "video"], maxFiles: 10, maxSizeMb: 10 }` and one file `{ id: "00000000-0000-4000-8000-000000000001", kind: "image", label: "File 1, 12 kB", size: "12 kB" }`; `Videos are stored exactly as sent` comes before `type="file"`; the markup holds `Photos and videos up to 10 MB each.`, `name="_action" value="remove:00000000-0000-4000-8000-000000000001"`, `1 of 10 files` and `accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,video/mp4,video/quicktime"`.
- "short text infers autocomplete only where safe": label `Full name` renders `autocomplete="name"`; label `Hospital` renders `autocomplete="off"`.

`client/UploadField.test.ts` (the server rendering, which is the no-script page). Helper `props(over)` builds `UploadFieldProps` for `f_photos` (`inputId: "f-f_photos"`, `errorId: "f_photos-error"`, `countId: "f_photos-count"`, `describedBy: "f_photos-limits f_photos-count"`, `accept: "image/jpeg"`, required, `maxFiles: 3`, `maxBytes: 10 MB`, `kinds: ["image"]`, no error, one initial row `{ id: "00000000-0000-4000-8000-000000000001", kind: "image", label: "File 1, 12 kB", size: "12 kB" }`, `initialCount: "1 of 3 files"`, the English chrome strings, `locale: "en"`, then `...over`):

```ts
describe("UploadField without script", () => {
  it("renders the native input, the count and a Remove submit button per staged file", () => {
    const html = renderToStaticMarkup(createElement(UploadField, props()));
    expect(html).toMatch(/<input[^>]*type="file"[^>]*multiple[^>]*name="f_photos"|<input[^>]*name="f_photos"[^>]*type="file"/);
    expect(html).toContain('aria-describedby="f_photos-limits f_photos-count"');
    expect(html).toContain("1 of 3 files");
    expect(html).toContain("File 1, 12 kB");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*name="_action"[^>]*value="remove:00000000-0000-4000-8000-000000000001"/);
    expect(html).toContain('id="f_photos-error"');
  });

  it("shows this field's refused files from the post's answer in its error slot, instead of the stored error", () => {
    const html = renderToStaticMarkup(
      createElement(
        RefusedFilesContext.Provider,
        { value: [{ fieldKey: "f_photos", message: "notes.txt is not a supported type." }, { fieldKey: "f_other", message: "x" }] },
        createElement(UploadField, props({ error: "Photos is required" })),
      ),
    );
    expect(html).toMatch(/id="f_photos-error"[^>]*>[\s\S]*notes\.txt is not a supported type\./);
    expect(html).not.toContain("Photos is required");
    expect(html).toContain('aria-invalid="true"');
  });
});
```

`decode.test.ts`, over `storyVersion()` and its registry:
- "reads the page's answers, control fields and files, ignoring other pages' fields and Next's own fields": a form with `$ACTION_REF_1: ""`, `_page: page_contact`, `_action: next`, `_rendered: 2026-10-10T11:59:00.000Z`, `website-url: ""`, `f_name: Ana Prueba`, `f_baby: yes_opt`, `f_consent: accepted` decodes to a post matching `{ pageKey: "page_contact", action: { kind: "next" }, answers: { f_name: "Ana Prueba", f_baby: "yes_opt" }, raw: { f_name: "Ana Prueba", f_baby: "yes_opt" }, renderedAt: new Date("2026-10-10T11:59:00.000Z"), honeypot: "", submitToken: null }`, without `f_consent` in its answers.
- "collects posted files of the page's upload fields with their names": `_page: page_baby`, `_action: next` and two `f_photos` entries, `new File([new Uint8Array([1, 2])], "a.jpg")` and `new File([], "")` → `incoming` as `[fieldKey, name, length]` is `[["f_photos", "a.jpg", 2], ["f_photos", "", 0]]`.
- "refuses an unknown page or action": `_page: page_nope` decodes to null; `parseAction("language:fr")` is null; `parseAction("remove:00000000-0000-4000-8000-000000000001")` is `{ kind: "remove", fileId: "00000000-0000-4000-8000-000000000001" }`; `parseAction("language:es")` is `{ kind: "language", locale: "es" }`.

- [ ] **Step 2: Run** `pnpm test src/modules/submissions/presentation`: fails.

- [ ] **Step 3: Implement** `fields/types.ts` exactly as in Interfaces (`ids(key)` is `{ control: "f-<key>", help: "<key>-help", error: "<key>-error", legend: "<key>-legend" }`; `one` and `many` read a value or a list from `FormValues`), and the shells in `fields/FieldShell.tsx`:

```tsx
/** `aria-describedby` for a control: help, fixed hints, then the error when there is one. */
export function describedBy(props: FieldProps, extra: readonly string[] = []): string {
  const id = ids(props.field.key);
  return [props.help ? id.help : null, ...extra, props.error ? id.error : null].filter(Boolean).join(" ");
}

export function Star({ required }: { required: boolean }) {
  return required ? <span aria-hidden="true" className={styles.star}> *</span> : null;
}

export function Help({ props }: { props: FieldProps }) {
  return props.help ? <RichText source={props.help} className={styles.help} /> : null;
}

/** The error slot is always present so a script can fill it; empty, it says nothing. */
export function ErrorSlot({ props }: { props: FieldProps }) {
  return (
    <p id={ids(props.field.key).error} className={styles.error} aria-live="assertive">
      {props.error ? (
        <>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" className={styles.errorIcon}>
            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 4v5M8 11.5v.5" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          {props.error}
        </>
      ) : null}
    </p>
  );
}

/** Label, help, control, error: one visual group (Law of Proximity). */
export function FieldShell({ props, children }: { props: FieldProps; children: ReactNode }) {
  const id = ids(props.field.key);
  return (
    <div className={styles.field} data-field={props.field.key}>
      <label htmlFor={id.control} className={styles.label}>
        {props.label}
        <Star required={props.required} />
      </label>
      {props.help ? <div id={id.help}><Help props={props} /></div> : null}
      {children}
      <ErrorSlot props={props} />
    </div>
  );
}

/** The group variant: fieldset and legend for radios, checkboxes, dates and consent. */
export function GroupShell({ props, legend, children }: { props: FieldProps; legend?: ReactNode; children: ReactNode }) {
  const id = ids(props.field.key);
  return (
    <fieldset
      className={styles.group}
      data-field={props.field.key}
      aria-describedby={describedBy(props) || undefined}
      aria-invalid={props.error ? true : undefined}
    >
      <legend id={id.legend} className={styles.label}>
        {legend ?? props.label}
        <Star required={props.required} />
      </legend>
      {props.help ? <div id={id.help}><Help props={props} /></div> : null}
      {children}
      <ErrorSlot props={props} />
    </fieldset>
  );
}
```

`styles.ts` is `/// <reference types="next" />` and `export { default as styles } from "./renderer.module.css"` (the renderer's class names). The one input every text type shares, in `fields/text.tsx`, is the pattern the other inputs follow:

```tsx
function Input(props: FieldProps & { type: string; inputMode?: "email" | "tel" | "text"; autoComplete: string }) {
  const id = ids(props.field.key);
  return (
    <FieldShell props={props}>
      <input
        id={id.control}
        name={props.field.key}
        type={props.type}
        inputMode={props.inputMode}
        autoComplete={props.autoComplete}
        className={styles.input}
        defaultValue={one(props.values, props.field.key)}
        placeholder={placeholder(props)}
        required={props.required}
        aria-required={props.required || undefined}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy(props) || undefined}
      />
    </FieldShell>
  );
}
```

The decoders, which turn posted strings into answers and decode issues:

```ts
// number.tsx: Postel, "2,5" and "2.5" both read as 2.5; empty is no answer.
function parseNumber(raw: string): { value: number | undefined; ok: boolean } {
  const s = raw.trim().replace(/\s/g, "");
  if (s === "") return { value: undefined, ok: true };
  const normalized = s.includes(".") ? s.replace(/,/g, "") : s.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return { value: undefined, ok: false };
  return { value: Number(normalized), ok: true };
}
decode: (input, field) => {
  const { value, ok } = parseNumber(input.get(field.key) ?? "");
  return ok ? { value, issue: null } : { value: undefined, issue: "not_a_number" };
},

// date.tsx
decode: (input, field) => {
  const [d, m, y] = ["day", "month", "year"].map((p) => (input.get(`${field.key}.${p}`) ?? "").trim());
  if (d === "" && m === "" && y === "") return { value: undefined, issue: null };
  if (!/^\d{1,2}$/.test(d ?? "") || !/^\d{1,2}$/.test(m ?? "") || !/^\d{4}$/.test(y ?? "")) {
    return { value: undefined, issue: "date_invalid" };
  }
  return { value: `${y ?? ""}-${(m ?? "").padStart(2, "0")}-${(d ?? "").padStart(2, "0")}`, issue: null };
},

// decode.ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function parseAction(value: string | null): PageAction | null {
  if (value === "next" || value === "back" || value === "submit") return { kind: value };
  if (value === "language:en" || value === "language:es") return { kind: "language", locale: value.slice(9) as "en" | "es" };
  if (value?.startsWith("remove:") && UUID.test(value.slice(7))) return { kind: "remove", fileId: value.slice(7) };
  return null;
}
export async function decodePagePost(form: FormData, version: Version, registry: FieldTypeRegistry): Promise<DecodedPost | null> {
  const pageKey = str(form.get("_page"));
  const action = parseAction(str(form.get("_action")));
  const page = version.pages.find((p) => p.key === pageKey);
  if (!page || !action) return null;
  const answers: Record<string, unknown> = {};
  const decodeIssues: ValidationIssue[] = [];
  const raw: RawValues = {};
  const incoming: IncomingFile[] = [];
  const keys = new Set<string>(page.fields.map((f) => f.key));
  for (const [name, value] of form.entries()) {
    const owner = name.split(".")[0] ?? "";
    if (typeof value !== "string" || !keys.has(owner)) continue;
    const prev = raw[name];
    raw[name] = prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
  }
  for (const field of page.fields) {
    const def = registry.get(field.type);
    if (!def.isInput) continue;
    if (def.uploadLimits) {
      for (const entry of form.getAll(field.key)) {
        if (typeof entry !== "string") incoming.push({ fieldKey: field.key, name: entry.name, bytes: new Uint8Array(await entry.arrayBuffer()) });
      }
      continue;
    }
    const decoded = decodeField(form, field);
    if (decoded.issue !== null) decodeIssues.push({ code: decoded.issue, field: field.key });
    else if (decoded.value !== undefined) answers[field.key] = decoded.value;
  }
  const rendered = str(form.get("_rendered"));
  const renderedAt = rendered === null ? null : new Date(rendered);
  const token = str(form.get("_token"));
  return {
    pageKey: page.key, action, answers, decodeIssues, raw, incoming,
    renderedAt: renderedAt && !Number.isNaN(renderedAt.getTime()) ? renderedAt : null,
    honeypot: str(form.get(HONEYPOT_FIELD)) ?? "",
    submitToken: token && UUID.test(token) ? token : null,
  };
}
```

(`str` is the string-or-null reader over `FormData` entries; `formInput` wraps `FormData` as a `FieldInput`; `decodeField` runs one field's decoder over `formInput(form)`.)

The other renderers, each a `FieldRenderer` with the attributes the tests check:
  - `text.tsx`: `shortText` (`type="text"`, `autoComplete` from the label: `name` for full-name labels in either language, `organization` for organization labels, else `off`), `email` (`type="email"`, `inputMode="email"`, `autocomplete="email"`), `phone` (`type="tel"`, `inputMode="tel"`, `autocomplete="tel"`), `longText` (a `<textarea rows data-autogrow>` with the same aria attributes; with a `max_length` rule a counter `<p id="<key>-count" data-counter-for data-max data-template>` showing `char_count`, linked in `aria-describedby`; the server's grapheme count is the one that validates). The text decoders return the string or undefined; the encoders write a string answer under the key. Placeholders resolve from the settings in the locale.
  - `number.tsx`: the decoder above; encodes a number as its string. The input is `type="text"` with `inputMode` `numeric` for integer-only and `decimal` otherwise, `autocomplete="off"`, the unit in `<span id="<key>-unit">` after it and linked.
  - `date.tsx`: three `type="text" inputMode="numeric"` inputs named `<key>.day`, `<key>.month`, `<key>.year` (`maxLength` 2, 2, 4, ids `f-<key>-<part>`, labelled with `date_day`, `date_month`, `date_year`) in the locale's order (en: month, day, year; es: day, month, year) inside `GroupShell`, with the decoder above. The encoder splits an ISO date back into the three parts.
  - `choice.tsx`: `singleChoice` renders radios in a `GroupShell` (the first radio carries the control id) unless `effectiveDisplay(settings)` is `dropdown`, then a `<select>` in a `FieldShell` with a disabled `choose_one` placeholder option; `multipleChoice` renders checkboxes in a `GroupShell`, decoding the list of checked keys (none is no answer). Selection limits reach the help through `pageFieldViews` (Task 25).
  - `checkbox.tsx`: one checkbox inside its own `<label>` with the star, help before it and the error slot after; decodes `on` as true and absence as false (only the page's own fields are decoded, so absent means unchecked).
  - `consent.tsx`: consent text is plain text (form-definition.md; Task 1 corrected builder.md): the `legend` of a `GroupShell` holds the resolved text split on blank lines into one `<span className={styles.consentParagraph}>` per paragraph, React escaping it, never parsed as markup; then a checkbox `value="accepted"`, always `required`, labelled `consent_checkbox`, checked only when the posted values say so. Decoder: `accepted` gives `{ accepted: true, textVersion: consentTextVersion(text) }`.
  - `section.tsx`: `<section>` with an `<h2>` title and the description through `RichText`; no value.
  - `file-upload.tsx`: the video notice `<p id="<key>-notice">` (when video is accepted) before the label, the label with the star, help, the limits hint `<p id="<key>-limits">` (`limitsKey` with `formatMegabytes`), then `UploadField` with `describedBy` = notice, help, limits, count and error ids, `accept` from `acceptAttribute`, `maxBytes = maxSizeMb MB`, `initialCount` from `filesCount`, and the chrome strings; `text.failed`, `text.tooLarge` and `text.wrongType` are the catalog rows `upload failed`, `file too large` and `file wrong type` in the page language with `{size}` and `{kinds}` filled and `{file}` left for the client. No value is decoded: files travel as `incoming`.
  - `fields/index.ts`: `fieldRenderers = { short_text, long_text, email, phone, number, date, single_choice, multiple_choice, checkbox, consent, file_upload, section } as const satisfies Record<FieldTypeId, FieldRenderer>` (a missing type fails both the type check and the conformance test), re-exporting the types and `ids`.
  - `page-form-state.ts` exactly as in Interfaces; `client/refused-files.ts` creates the context, default `[]`.
  - `client/UploadField.tsx` (no-script markup only in this task; comment: rendered on the server it is the no-script control): a dropzone `<div>` holding the native `<input type="file">` (`id`, `name` = field key, `multiple` when `maxFiles > 1`, `accept`, `aria-required`, `aria-invalid` when it shows an error, `aria-describedby`), the count `<p id={countId} aria-live="polite">` showing `initialCount`, a `<ul>` with one row per initial file (its label and size, and a `<button type="submit" name="_action" value="remove:<id>" aria-describedby="<id>-name">` showing `text.remove`), a polite announcement `<p>`, and the error slot `<p id={errorId} aria-live="assertive">` holding this field's messages from `RefusedFilesContext` (one per line) or else `props.error`.
  - `decode.ts`: the code above; Next's `$` fields and the control fields fall out of `raw` because only the page's field keys are kept, and a refused file's name stays in `incoming` for the message only.

- [ ] **Step 4: Run** `pnpm test src/modules/submissions/presentation && pnpm lint && pnpm typecheck && pnpm format:check`. The conformance test must fail if any entry is removed from `fieldRenderers`: delete `section` locally, see both `typecheck` and the test fail, restore it.
- [ ] **Step 5: Commit** `feat(submissions): a renderer for every field type, the no-script upload field, form decoding and the renderer conformance suite`

---

### Task 25: Renderer screens, the page form, layout styles and the page weight check

**Files:**
- Create: `src/modules/submissions/presentation/PublicShell.tsx`, `FormPage.tsx`, `Progress.tsx`, `Screens.tsx`, `field-views.ts`, `screens.test.ts`, `page-weight.test.ts`
- Create: `src/modules/submissions/presentation/client/PageEnhancer.tsx`, `client/NavButtons.tsx`, `client/ErrorSummary.tsx`, `client/summary.ts`, `client/summary.test.ts` (markup and merging; Task 26 adds the behavior)
- Modify: `src/modules/submissions/presentation/renderer.module.css` (the whole stylesheet)

**Interfaces:**
- Consumes: `ViewResult`, `PageView`, `withFileAnswers`, `HONEYPOT_FIELD` (Task 18); `fieldRenderers`, `PageFormAction`, `PageFormState`, `EMPTY_PAGE_FORM_STATE`, `RefusedFilesContext` (Task 24); Task 23 copy and messages.
- Produces:

```ts
// field-views.ts (framework-free)
export interface SummaryItem { fieldKey: string; href: string; message: string }
export function pageFieldViews(view: { version: FormVersion; page: PageView; slug: string }, registry: FieldTypeRegistry):
  { field: Field; props: FieldProps }[];          // visible fields of the current page, with labels, help, values, errors, files
export function summaryItems(view: { version: FormVersion; page: PageView }, registry: FieldTypeRegistry): SummaryItem[];
export function pageTitle(view: Extract<ViewResult, { screen: "page" }>): { h1: string; documentTitle: string; subtitle: string | null };
// Screens.tsx
export function RendererScreen(props: { view: Exclude<ViewResult, { screen: "not_found" }>; slug: string; contact: string; registry: FieldTypeRegistry; formAction: PageFormAction }): ReactElement;
export function NotFoundScreen(): ReactElement;
export function viewLocale(view: ViewResult): Locale;   // page and confirmation locale; "es" otherwise
// client/summary.ts (no React)
export function summaryEntries(items: readonly SummaryItem[], refused: readonly RefusedFileMessage[]): { href: string; message: string }[];
export function summaryHeading(count: number, locale: Locale, headings: { one: string; other: string }): string;
// client/ErrorSummary.tsx ('use client')
export function ErrorSummary(props: { items: readonly SummaryItem[]; locale: Locale; headings: { one: string; other: string } }): ReactElement | null;
// client/PageEnhancer.tsx ('use client'): the page form itself, and (Task 26) its enhancement
export interface PageEnhancerProps {
  action: PageFormAction; permalink: string; slug: string; pageKey: string; locale: Locale;
  navigated: boolean;                                   // a page change, so focus goes to the heading
  text: { submitting: string; uploadsPending: string; offline: string; submitFailed: string };
  children: ReactNode;
}
export function PageEnhancer(props: PageEnhancerProps): ReactElement;
// client/NavButtons.tsx ('use client')
export function NavButtons(props: { back: string | null; primary: { value: "next" | "submit"; label: string }; submitting: string; uploadsPending: string }): ReactElement;
```

Decision (the page form): the form is rendered by `PageEnhancer` with `useActionState(action, EMPTY_PAGE_FORM_STATE, permalink)`, so without script the browser posts to the page's own URL and Next answers a refused post with this page (the state carries the refused files' messages, which `RefusedFilesContext` hands to `UploadField` and `ErrorSummary`), and a successful post with a 303. The client never receives the copy tables: every string arrives as a prop, already localized.

Layout per renderer.md "Layout" and design.md: one column, 640 px maximum, 16 px gutters to 480 px and 24 px above, 44 px targets, inputs full width, navigation buttons full width on phones and side by side from 480 px, body 17 px, inputs at least 16 px, focus ring 2 px rose with 2 px offset, no motion under `prefers-reduced-motion`. Every value comes from `design-system/tokens.json` and names its token.

Page structure, top to bottom: the default submit button (hidden, first in tree order, `form="page-form"`, so Enter in a single-line field means Next, or Submit on the last page); the skip link "Skip to form"; the header with the wordmark text (`wordmark`), the language switch on bilingual forms (one button naming the other language in that language, `form="page-form" name="_action" value="language:<lang>" lang="<lang>"`), and the progress text and bar on multi-page forms; `<main id="content">` with the `<h1>`; the page form holding the error summary above the first field when the page holds a refused post, the required legend once when any visible field is required, the fields, the hidden `_page`, `_rendered` (page 1 without a record only) and `_token` (last page) inputs, the honeypot, the navigation row (Back unless first, then Next or Submit) and the status line; and the privacy footer on every screen with a form.

- [ ] **Step 1: Failing tests.** `screens.test.ts`. Helpers, described once: `noop: PageFormAction` returns its state; `screen(view, slug = "story-form")` is `renderToStaticMarkup(createElement(RendererScreen, { view, slug, contact: "privacy@example.com", registry, formAction: noop }))`; `pageHtml(acceptLanguage = "en")` publishes the story form, takes `viewForm` with no cookie and returns `{ html, deps, view }`.

```ts
describe("RendererScreen", () => {
  it("renders page 1 as a real form with skip link, one h1, progress, legend, fields, honeypot and Next", async () => {
    const { html } = await pageHtml();
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('href="#content"');
    expect(html).toContain("Skip to form");
    expect(html).toMatch(/<form[^>]*id="page-form"/);
    expect(html).toContain("Page 1 of 2");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("Fields marked with * are required");
    expect(html).toMatch(/name="_page" value="page_contact"/);
    expect(html).toMatch(/name="_rendered" value="2026-10-10T09:00:00.000Z"/);
    expect(html).toMatch(/name="website-url"[^>]*tabindex="-1"[^>]*autocomplete="off"|name="website-url"[^>]*autocomplete="off"[^>]*tabindex="-1"/);
    expect(html).not.toContain(">Back<");
    expect(html).toContain('value="next"');
    expect(html).toContain("This form is run by Effluz. Answers are stored in the United States and deleted after 12 months.");
    expect(html).toContain('href="mailto:privacy@example.com"');
  });
});
```

More `RendererScreen` cases:
- "puts the hidden default action first, so Enter means Next": in `pageHtml()`, `value="next"` comes before `value="language:es"`.
- "offers the other language, named in that language": `pageHtml()` matches `/<button[^>]*form="page-form"[^>]*name="_action"[^>]*value="language:es"[^>]*lang="es"[^>]*>Español</`.
- "shows the error summary with links and a count, and the messages under the fields": a stored record on the story form (`id …0000aa`, `locale: "en"`, `pageKey: "page_contact"`, token `…0000bb`, expiring later) with `pending: { pageKey: "page_contact", raw: { f_email: "nope" }, issues: [{ code: "required", field: asKey("f_name") }, { code: "email_syntax", field: asKey("f_email") }] }`, viewed through its cookie, renders `Please fix 2 problems before continuing`, matches `/<div[^>]*role="alert"[^>]*data-error-summary/`, links `href="#f-f_name"`, holds `Name is required` and `value="nope"`, and the heading comes before `id="f-f_name"`.
- "renders the confirmation, the closed screen in both languages, and not found": a `decoy` cookie `ST-1234` with `acceptLanguage: "es"` renders `Gracias.`, `Tu referencia: `, `ST-1234` and `Puedes cerrar esta página.` but not `Llenar otro formulario`; with the form closed, the closed screen renders `Este formulario está cerrado`, matches `/<span lang="en"[^>]*>This form is closed/` and has no `<form`; `NotFoundScreen` renders `No encontramos este formulario` and not `Effluz. Answers are stored`.
- "shows a multiple choice field's selection limits in its help": an English form `probe-form` (seeded with `seedPublished`) whose one field `f_pick` is `multiple_choice` with options `opt_a`, `opt_b`, `opt_c` and `min_selected` 2 renders `Select at least 2 options for Probe`.
- "gives the opening date in each language's own format": `later-form` with `storyVersion()`, `opensAt: "2026-12-01T17:00:00.000Z"`, `timezone: "America/Panama"` renders `Abre el 1 de diciembre de 2026` and `It opens on December 1, 2026`.

`client/summary.test.ts` (the `ErrorSummary` case renders inside the context a refused post's answer provides; the end-to-end path through `useActionState` is covered in Tasks 29 and 30):

```ts
describe("ErrorSummary", () => {
  it("lists a refused post's files, counted in the heading, linked to the field", () => {
    const html = renderToStaticMarkup(
      createElement(RefusedFilesContext.Provider, { value: [{ fieldKey: "f_photos", message: "notes.txt is not a supported type." }] },
        createElement(ErrorSummary, { items: [], locale: "en", headings: { one: "Please fix 1 problem before continuing", other: "Please fix {count} problems before continuing" } })),
    );
    expect(html).toMatch(/<div[^>]*role="alert"[^>]*data-error-summary/);
    expect(html).toContain("Please fix 1 problem before continuing");
    expect(html).toContain('<a href="#f-f_photos">notes.txt is not a supported type.</a>');
  });
});
```

and the cases:
- `summaryEntries`, "replaces a field's stored entry with its refused files, in field order": items `f_name` (`#f-f_name`, `Name is required`) and `f_photos` (`#f-f_photos`, `Photos is required`) with refused `f_photos` messages `a.txt is not a supported type.` and `b.jpg is larger than 10 MB` give `[{ href: "#f-f_name", message: "Name is required" }, { href: "#f-f_photos", message: "a.txt is not a supported type." }, { href: "#f-f_photos", message: "b.jpg is larger than 10 MB" }]`; no items with one refused `f_photos` message `x` give `[{ href: "#f-f_photos", message: "x" }]`.
- `summaryHeading`, "picks the heading by the language's plural rule": headings `{ one: "Corrige 1 problema para continuar", other: "Corrige {count} problemas para continuar" }` give the first for 1 and `Corrige 3 problemas para continuar` for 3 in `es`.

`page-weight.test.ts` (it reads `tests/fixtures/reference-form`, allowed for tests by ADR 0026), "keeps every page of the reference form well under 30 KB compressed": seed the parsed `referenceFormDraft` as `historia-prematuro-2026`; for each page, store a record on that page (ids `00000000-0000-4000-8000-<page index, 12 digits>`, `locale: "es"`), view it through its cookie, render `RendererScreen` with a pass-through `formAction`, and expect `gzipSync(html).length` below 15 KB (our markup alone; the e2e budget test measures the full response, framework payload included).

- [ ] **Step 2: Run** `pnpm test src/modules/submissions/presentation`: fails.

- [ ] **Step 3: Implement.**
  - `field-views.ts`: `pageFieldViews` takes the visible fields of the current page (`evaluateVisibility` over `withFileAnswers(answers, files)`); per field: the label in the locale; the error is `issueMessage` of the pending issue for that field; the values are the pending raw values of that field (names equal to the key or starting with `<key>.`) when pending exists, else the renderer's `encode` of the stored answer; files become `FileRowView`s labelled `file_row` with `formatBytes`; the help is the staff help plus, for `min_selected` and `max_selected` rules, the `choice_min` and `choice_max` messages, joined by blank lines; `required` is `isInput && (required || alwaysRequired)`. `summaryItems` lists fields with an error, `href` the first control (`#f-<key>`, or `#f-<key>-month` in English and `#f-<key>-day` in Spanish for dates). `pageTitle`: on the first page the h1 is the form title and the page title becomes the subtitle when it differs; later pages use the page title for the h1 and `<form title>: <page title>` for the document title.
  - `Progress.tsx`: nothing below two pages; else the `progress` text in `<p id="progress-text" aria-live="polite">` and a `role="progressbar"` labelled by it with `aria-valuemin`, `aria-valuemax`, `aria-valuenow` and a fill of `n / total`.
  - `PublicShell.tsx`: `Both` renders a chrome row in the page language and then, in `<span lang="<other>">`, the other language (per-language variables allowed, for dates); `PrivacyFooter` fills `privacy_footer` with the retention and a `mailto:` link for the contact, in one language or both; `PublicShell` lays out the default action, skip link, header (wordmark, language switch only when `languages === "bilingual"`), progress, `<main id="content" tabIndex={-1}>` and footer.
  - `FormPage.tsx`: the structure above. `PageEnhancer` receives the action, `permalink` `/f/<slug>`, the page key, `navigated` (`hasRecord && pending === null`), the locale and the four strings; it wraps the summary, legend, fields, hidden inputs, honeypot (`<div className={styles.honeypot} aria-hidden="true">` with a `<label for="website-url">` of `honeypot_label` and `<input id="website-url" name="website-url" type="text" tabIndex={-1} autoComplete="off" defaultValue="">`) and `NavButtons`. `ErrorSummary` receives `summaryItems` and the two heading strings (`error_summary_heading_one`, `error_summary_heading`).
  - `Screens.tsx`: `viewLocale`; closed, not open (the date through `formatInstant` per language in the form's time zone) and expired (with a Start again link to `/f/<slug>/restart`) share a `Message` screen in both languages with the privacy footer in both; `NotFoundScreen` has no footer; the confirmation shows the first block of the confirmation text as the h1 (plain text), the remaining blocks through `RichBlocks`, `confirmation_reference` with the reference in a `<code>`, `confirmation_close`, and `fill_another` linking to restart only when `allowAnotherResponse`.
  - `client/summary.ts`: `summaryEntries` keeps item order and swaps each field's stored entry for its refused-file messages (a field with only refused files gets them at the end); `summaryHeading` uses `headings.one` when `new Intl.PluralRules(locale).select(count) === "one"`, else fills `{count}`.
  - `client/ErrorSummary.tsx`: reads `RefusedFilesContext`; with no entries renders nothing; else `<div role="alert" data-error-summary>` with `<h2 id="error-summary-heading" tabIndex={-1}>` and a list of links.
  - `client/PageEnhancer.tsx` (this task: markup only): `const [state, formAction] = useActionState(props.action, EMPTY_PAGE_FORM_STATE, props.permalink)`; renders `<form id="page-form" action={formAction} noValidate className={styles.form} data-slug data-page data-navigated={navigated ? "" : undefined}>` with the children inside `RefusedFilesContext.Provider value={state.refusedFiles}`, followed inside the form by the status line `<p role="status" data-status className={styles.status}>`, empty until Task 26.
  - `client/NavButtons.tsx` (this task: markup only): `<div className={styles.navigation}>` with Back (`type="submit" name="_action" value="back"`, secondary) unless `back` is null, and the primary (`value` next or submit, `data-primary`).
  - `renderer.module.css`: the classes below, each value commented with its token from `design-system/tokens.json`; run `pnpm format` once so Prettier lays it out one declaration per line.

    | Classes | Rules (token) |
    |---|---|
    | `.page` | `min-height: 100vh`; background `surface.page.public` (#fff3ef); color `color.text.default` (#372549); `font.family.sans`; 17 px `font.size.public.body`; line height 1.6 `font.lineHeight.body` |
    | `.skip`, `.skip:focus` | off-screen (`top: -100px`) until focused (`top: 8px` `space.2`); padding `space.3 space.4`; `surface.card`; radius 12 px `radius.md` |
    | `.header`, `.progress`, `.main`, `.footer` | `max-width: 640px` `size.contentWidthPublic`, centered, side padding 16 px `space.4`, 24 px `space.5` from 480 px `breakpoint.sm` |
    | `.header`, `.wordmark`, `.languages` | flex row, space between, `min-height: 64px` `space.8`; wordmark 24 px, `font.weight.semibold` |
    | `.progressText`, `.progressTrack`, `.progressFill` | text 15 px `font.size.public.small` in `color.text.muted` (#774c60); 4 px track `surface.subtle` (#eff0f5), `radius.full`; fill `action.primary.bg`, `transition: width 160ms cubic-bezier(0.2, 0, 0, 1)` |
    | `.main`, `.title`, `.subtitle`, `.sectionTitle`, `.description`, `.help` | main padding 24 / 48 px (`space.5`, `space.7`); title 28 px `font.size.public.display`, 1.2 `font.lineHeight.tight`, semibold, no focus outline; subtitle and section title 22 px `font.size.public.heading`, 1.3; help 15 px, 1.5 `font.lineHeight.small`, muted |
    | `.form`, `.field`, `.group`, `.label`, `.star`, `.legend`, `.hint`, `.counter` | form column with 24 px gap `space.5`; field and group columns with 8 px gap `space.2`, fieldset reset; label 16 px `font.size.public.label`, `font.weight.medium`, 1.4; star `color.text.error` (#9b1c1c, reinforcement only); legend, hint, counter 15 px muted |
    | `.input`, `.textarea`, `.select` | full width, `min-height: 48px` (public input height), padding 12 px `space.3`, 17 px (at least `font.size.public.inputMin`), `surface.card`, 1 px `border.input` (#774c60), `radius.md`; focus 2 px `border.inputFocus` (#372549) with 11 px padding; `aria-invalid="true"` border `border.error` |
    | focus ring | every control, button and link `:focus-visible`: `outline: 2px solid` `color.focus.ring` (#b75d69), `outline-offset: 2px` |
    | `.error`, `.errorIcon` | `color.text.error`, 15 px, flex with 8 px gap; `:empty` hidden; icon `margin-top: 4px` |
    | `.withUnit`, `.unit`, `.dateRow`, `.datePart`, `.dateYear`, `.subLabel` | unit row 8 px gap, unit muted; date row 12 px gap; parts 5.5 rem, year 7 rem; sub-labels 15 px |
    | `.options`, `.option` | column, 8 px gap; option `min-height: 44px` `size.touchTarget`, padding 8 / 12 px, `surface.card`, 1 px `border.default` (#eff0f5), `radius.md`; its input 24 px with `accent-color` `action.primary.bg` |
    | `.consent .group`, `.consentParagraph`, `.section`, `.notice` | consent box padding 16 px, card, 1 px `border.input`; paragraphs block, weight 400, 8 px below; section padding 16 px, `border.default`; notice padding 16 px on `surface.warning` (#fff4d6) in `color.text.warning` (#7a4b00) |
    | `.dropzone`, `.fileRows`, `.fileRow`, `.thumb`, `.fileName`, `.fileBar` | dropzone padding 24 px, 2 px dashed `border.input` (`[data-drag]`: `border.inputFocus`); rows list reset, 8 px gap; row grid `56px 1fr auto`; thumb 56 px, `radius.sm` (8 px), `surface.subtle`; name ellipsis; bar 4 px `surface.subtle` with an `action.primary.bg` fill |
    | `.summary`, `.summaryHeading`, `.summaryList` | padding 16 px on `surface.error` (#fbecec) in `color.text.error`; heading 22 px with the focus ring when focused; list indent 24 px, links in the error color |
    | `.navigation` | column with 12 px gap `space.3`; row, space between, from 480 px |
    | `.primary`, `.primaryLink`, `.secondary`, `.secondaryLink`, `.tertiary` | 48 px high (public button), padding 0 16 px, `radius.md`, 16 px `font.size.public.button`, medium; primary `action.primary.bg` / `action.primary.fg` (#fff3ef), hover `action.primary.hoverBg` (#6c344e); secondary `action.secondary.bg` with 1 px `action.secondary.border`, hover `action.secondary.hoverBg`; disabled `action.disabledBg` / `action.disabledFg`; tertiary 44 px, underlined, hover `action.tertiary.hoverFg` |
    | `.status`, `.banner`, `.reference`, `.referenceCode`, `.secondLanguage`, `.footer` | status error color, hidden when empty; banner padding 16 px on `surface.subtle`; reference flex wrap; code in `font.family.mono`, card, `border.default`, `user-select: all`; second language block, muted; footer 15 px muted, padding 24 / 48 px |
    | `.honeypot`, `.defaultAction`, `.visuallyHidden` | off-screen (`left: -10000px`, 1 px, overflow hidden); visually hidden with `clip: rect(0 0 0 0)` |
    | `.spinner`, motion | 16 px ring, `border-right-color: transparent`, 800 ms spin; `@media (prefers-reduced-motion: reduce)` removes the progress transition and the spin |

- [ ] **Step 4: Run** `pnpm test src/modules/submissions && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(submissions): renderer screens, the page form, error summary, progress, privacy footer and layout styles`

---

### Task 26: The enhancement layer: early uploads, pre-checks, blur checks, focus, offline and submit states

**Files:**
- Create: `src/modules/submissions/presentation/client/bus.ts`, `upload-queue.ts`, `page-state.ts`, `form-dom.ts`
- Modify: `client/UploadField.tsx`, `client/PageEnhancer.tsx`, `client/NavButtons.tsx` (the behavior; their props stay as Tasks 24 and 25 defined them)
- Test: `client/upload-queue.test.ts`, `client/bus.test.ts`, `client/page-state.test.ts`

**Interfaces:**
- Consumes: the upload, remove and check routes' JSON (Task 28): `POST /f/<slug>/files` answers `{ ok: true, file: { id, kind, size }, label, count }` or `{ ok: false, message }`; `DELETE /f/<slug>/files/<id>` answers 204; `POST /f/<slug>/check` answers `{ message: string | null }`. The bound Server Action of the page (Task 28) through `PageEnhancerProps.action`.
- Produces:

```ts
// bus.ts
export function uploadStarted(): void; export function uploadFinished(): void; export function inFlight(): number;
export function onUploadsChange(listener: (count: number) => void): () => void;
// upload-queue.ts
export type RowState =
  | { status: "uploading"; percent: number } | { status: "uploaded" } | { status: "failed"; message: string };
export interface Row { localId: string; id: string | null; name: string; size: string; kind: "image" | "video"; thumb: string | null; state: RowState }
export type QueueAction =
  | { type: "add"; rows: Row[] } | { type: "progress"; localId: string; percent: number }
  | { type: "done"; localId: string; id: string; label: string } | { type: "fail"; localId: string; message: string }
  | { type: "retry"; localId: string } | { type: "remove"; localId: string };
export function queueReducer(rows: readonly Row[], action: QueueAction): Row[];
export function middleEllipsis(name: string, max?: number): string;
export function precheckFile(file: { size: number; type: string }, limits: { maxBytes: number; kinds: readonly ("image" | "video")[] }): "file_too_large" | "file_wrong_type" | null;
// page-state.ts
export type SubmitPhase = "idle" | "submitting" | "waiting_uploads" | "waiting_online" | "failed";
export interface PageState {
  phase: SubmitPhase; online: boolean; resend: string | null;     // the submitter value to send again when back online
  checks: Readonly<Record<string, number>>;                       // latest blur check id per field
  focus: "summary" | "heading" | null;
}
export type PageEvent =
  | { type: "loaded"; hasSummary: boolean; navigated: boolean }
  | { type: "submit"; action: string; uploadsInFlight: number }
  | { type: "refused" } | { type: "failed" } | { type: "uploads_settled" }
  | { type: "offline" } | { type: "online" }
  | { type: "check"; key: string };                                // a blur check is sent with the new id
export const initialPageState: PageState;
export function pageReducer(state: PageState, event: PageEvent): PageState;
export function checkIsCurrent(state: PageState, key: string, id: number): boolean;   // latest check wins
export function navButtonsState(input: { pending: boolean; pendingAction: string | null; uploadsInFlight: number }): { disabled: boolean; primaryDisabled: boolean; submitting: boolean };
// form-dom.ts (browser helpers, no React)
export function fieldFormData(form: HTMLFormElement, key: string): FormData;   // the inputs named key or key.* plus _field
export const fill: (text: string, vars: Record<string, string>) => string;
```

The client never ships the validation rules or the copy tables: messages come back from the server already localized, and chrome strings arrive as props. Without script nothing in this task runs: the server markup of Tasks 24 and 25 works on its own.

- [ ] **Step 1: Failing tests.** `upload-queue.test.ts`:

```ts
const row = (localId: string): Row => ({ localId, id: null, name: `${localId}.jpg`, size: "12 kB", kind: "image", thumb: null, state: { status: "uploading", percent: 0 } });

describe("queueReducer", () => {
  it("tracks progress, success, failure, retry and removal per file", () => {
    let rows = queueReducer([], { type: "add", rows: [row("a"), row("b")] });
    rows = queueReducer(rows, { type: "progress", localId: "a", percent: 40 });
    rows = queueReducer(rows, { type: "done", localId: "a", id: "srv-a", label: "File 1, 12 kB" });
    rows = queueReducer(rows, { type: "fail", localId: "b", message: "b.jpg did not upload. Check your connection and retry" });
    expect(rows.map((r) => [r.localId, r.id, r.state.status])).toEqual([["a", "srv-a", "uploaded"], ["b", null, "failed"]]);
    rows = queueReducer(rows, { type: "retry", localId: "b" });
    expect(rows[1]?.state).toEqual({ status: "uploading", percent: 0 });
    rows = queueReducer(rows, { type: "remove", localId: "a" });
    expect(rows.map((r) => r.localId)).toEqual(["b"]);
  });

  it("adds a pre-checked refusal as a failed row that never uploads", () => {
    const refused: Row = { ...row("c"), state: { status: "failed", message: "c.jpg is larger than 10 MB" } };
    expect(queueReducer([], { type: "add", rows: [refused] })[0]?.state).toEqual({ status: "failed", message: "c.jpg is larger than 10 MB" });
  });

  it("truncates long names in the middle", () => {
    expect(middleEllipsis("IMG_20261010_123456789_HDR_final.jpeg", 20)).toBe("IMG_20261…final.jpeg");
    expect(middleEllipsis("short.jpg", 20)).toBe("short.jpg");
  });
});

describe("precheckFile", () => {
  const limits = { maxBytes: 10 * 1024 * 1024, kinds: ["image"] as const };
  it("refuses by declared size and kind before uploading, and lets an unknown type through to the server", () => {
    expect(precheckFile({ size: 11 * 1024 * 1024, type: "image/jpeg" }, limits)).toBe("file_too_large");
    expect(precheckFile({ size: 1024, type: "video/mp4" }, limits)).toBe("file_wrong_type");
    expect(precheckFile({ size: 1024, type: "image/heic" }, limits)).toBeNull();
    expect(precheckFile({ size: 1024, type: "" }, limits)).toBeNull();
  });
});
```

`bus.test.ts`:

```ts
describe("upload bus", () => {
  it("counts uploads in flight and tells listeners", () => {
    const seen: number[] = [];
    const off = onUploadsChange((n) => seen.push(n));
    uploadStarted();
    uploadStarted();
    uploadFinished();
    off();
    uploadFinished();
    expect(seen).toEqual([1, 2, 1]);
    expect(inFlight()).toBe(0);
  });
});
```

`page-state.test.ts`:

```ts
const run = (events: PageEvent[], from: PageState = initialPageState) => events.reduce(pageReducer, from);

describe("focus target", () => {
  it("is the summary after a refused post, the heading after a page change, and nothing on a fresh page 1", () => {
    expect(run([{ type: "loaded", hasSummary: true, navigated: true }]).focus).toBe("summary");
    expect(run([{ type: "loaded", hasSummary: false, navigated: true }]).focus).toBe("heading");
    expect(run([{ type: "loaded", hasSummary: false, navigated: false }]).focus).toBeNull();
    expect(run([{ type: "loaded", hasSummary: false, navigated: false }, { type: "submit", action: "next", uploadsInFlight: 0 }, { type: "refused" }]).focus).toBe("summary");
  });
});

describe("blur queue", () => {
  it("applies only the latest check of a field", () => {
    const state = run([{ type: "check", key: "f_email" }, { type: "check", key: "f_email" }, { type: "check", key: "f_name" }]);
    expect(checkIsCurrent(state, "f_email", 1)).toBe(false);
    expect(checkIsCurrent(state, "f_email", 2)).toBe(true);
    expect(checkIsCurrent(state, "f_name", 1)).toBe(true);
  });
});

describe("offline state", () => {
  it("waits for the connection and sends the same action again when it returns", () => {
    const waiting = run([{ type: "offline" }, { type: "submit", action: "next", uploadsInFlight: 0 }]);
    expect(waiting).toMatchObject({ phase: "waiting_online", online: false, resend: "next" });
    expect(run([{ type: "online" }], waiting)).toMatchObject({ phase: "submitting", online: true, resend: "next" });
  });
});

describe("submitting state", () => {
  it("submits once, waits for uploads, and re-enables with the failure message", () => {
    const submitting = run([{ type: "submit", action: "submit", uploadsInFlight: 0 }]);
    expect(submitting.phase).toBe("submitting");
    expect(run([{ type: "submit", action: "submit", uploadsInFlight: 0 }], submitting)).toBe(submitting);
    expect(run([{ type: "failed" }], submitting).phase).toBe("failed");
    const waiting = run([{ type: "submit", action: "next", uploadsInFlight: 2 }]);
    expect(waiting.phase).toBe("waiting_uploads");
    expect(run([{ type: "uploads_settled" }], waiting).phase).toBe("idle");
    expect(run([{ type: "submit", action: "back", uploadsInFlight: 2 }]).phase).toBe("submitting");
  });

  it("disables every button while submitting, shows Submitting only for Submit, and holds the primary for uploads", () => {
    expect(navButtonsState({ pending: true, pendingAction: "submit", uploadsInFlight: 0 })).toEqual({ disabled: true, primaryDisabled: true, submitting: true });
    expect(navButtonsState({ pending: true, pendingAction: "next", uploadsInFlight: 0 })).toEqual({ disabled: true, primaryDisabled: true, submitting: false });
    expect(navButtonsState({ pending: false, pendingAction: null, uploadsInFlight: 1 })).toEqual({ disabled: false, primaryDisabled: true, submitting: false });
  });
});
```

- [ ] **Step 2: Run** `pnpm test src/modules/submissions/presentation/client`: fails.

- [ ] **Step 3: Implement.**
  - `bus.ts` (comment: uploads in flight on this page, so Next and Submit can wait for them; `renderer.md`, "File upload"): a module counter (never below 0) and a listener set notified on every change.
  - `upload-queue.ts`: the reducer as the tests show (`add` appends, the others patch one row by `localId`, `remove` filters); `middleEllipsis(name, max = 32)` keeps `ceil((max - 1) / 2)` leading and the rest trailing characters around `…`; `precheckFile` refuses `size > maxBytes`, and a declared type starting `image/` or `video/` whose kind is not accepted; an empty or other declared type passes, since the server decides by content (advisory only).
  - `page-state.ts`: the reducer as the tests show. `loaded` sets the focus target (summary when the page shows one, else heading when `navigated`, else none). `submit` is ignored while `submitting`; Next or Submit with uploads in flight is `waiting_uploads`; offline is `waiting_online` keeping the action in `resend`; otherwise `submitting`. `refused` is `idle` with focus on the summary; `failed` is `failed`; `uploads_settled` returns `waiting_uploads` to `idle`; `online` sets `online` and turns `waiting_online` into `submitting`; `offline` clears it. `check` increments the field's id; `checkIsCurrent` compares. `navButtonsState`: everything disabled while pending; the primary also while uploads are in flight; `submitting` only when the pending action is `submit`.
  - `form-dom.ts`: `fieldFormData` copies the string entries named `key` or `key.*` from the form and sets `_field`; `fill` replaces `{word}` placeholders.
  - `UploadField` (comment: with script, each chosen file uploads at once with its own progress row, and the input is cleared so the page post does not resend it): after mount it is `enhanced`. Choosing files (the input's change, or a drop on the dropzone, which sets `data-drag` while dragging) runs `precheckFile` per file: a refusal adds a failed row with `text.tooLarge` or `text.wrongType` filled with the truncated name; others add an uploading row (an object-URL thumbnail for images) and start an `XMLHttpRequest` to `/f/<slug>/files` with `field`, `_locale` and `file`, reporting `upload.onprogress` percentages, calling `uploadStarted`/`uploadFinished`, and on load parsing the JSON (`done` with the server's `label` and an announcement of `text.uploaded`, or `fail` with the server's `message`, `{file}` filled), on error `fail` with `text.failed`. Retry resends the kept `File`. Remove with script is a `type="button"` that sends `DELETE /f/<slug>/files/<id>` (a 404 counts as gone), revokes the thumbnail, removes the row and announces `text.removed`; without script it stays the submit button of Task 24. The count shows uploaded rows with `text.count` or `text.countOne`.
  - `PageEnhancer` (comment links `renderer.md`, "Validation and errors" and "Navigation and state"; removing it never blocks completion) keeps `useActionState` from Task 25 for the no-script path and adds, with `useReducer(pageReducer)`:
    - on mount and on every new `pageKey`: `loaded` with whether `#error-summary-heading` exists; focus the summary heading or `[data-page-heading]` accordingly; restore this page's session-storage draft (`effluz:<slug>:<page>`) into empty text inputs and textareas unless a summary is shown;
    - on `input`/`change` inside a `[data-field]`: mark the field touched, save the draft (string entries not starting with `_` or `$`), auto-grow `[data-autogrow]` textareas, update the `[data-counter-for]` counter from its template (polite live region from 90 % of the maximum), and re-check a field that already shows an error; on `focusout` of a touched field, `check`: post `fieldFormData` plus `_locale` to `/f/<slug>/check` and, when `checkIsCurrent`, write the message into `<key>-error` and set or clear `aria-invalid` on its controls (a failed request is ignored: the server checks again on Next);
    - on `submit`: dispatch `submit` with the submitter's `_action` value and `inFlight()`; when the next phase is not `submitting`, `preventDefault`; when it is, `preventDefault` too and, in `startTransition`, call `props.action(currentState, new FormData(form, submitter))`, setting the returned state (refused: dispatch `refused`), dispatching `failed` on a rejection whose `digest` does not start with `NEXT_REDIRECT` (a redirect is Next's navigation and is rethrown), and clearing the draft before a non-refused send; React shows the form as pending for that transition, which `NavButtons` reads;
    - `online`/`offline` window events, `onUploadsChange` (zero dispatches `uploads_settled`), and on `online` while waiting, `form.requestSubmit(<the button with value resend>)`;
    - it renders the offline banner (`<div role="status" className={styles.banner}>` with `text.offline`) above the form while offline, and the status line `<p role="status" data-status>` with `text.uploadsPending` while `waiting_uploads`, `text.submitFailed` after `failed`, else empty. No string is ever parsed as HTML.
  - `NavButtons`: `useFormStatus()` gives `pending` and the pending `FormData`; `navButtonsState` with its `_action` and the bus count decides `disabled` on every button and on the primary; while `submitting`, the Submit button shows an `aria-hidden` spinner and `submitting` text.

- [ ] **Step 4: Run** `pnpm test src/modules/submissions/presentation && pnpm lint && pnpm typecheck && pnpm format:check && pnpm build`.
- [ ] **Step 5: Commit** `feat(submissions): client enhancements for early uploads, pre-checks, blur checks, focus, offline and submit states`

---

### Task 27: Configuration, the composition roots and worker registration

**Files:**
- Create: `src/app/modules.ts`, `src/app/modules.test.ts`, `src/app/worker-handlers.ts`, `src/app/worker-handlers.test.ts`
- Modify: `src/app/config.ts`, `src/app/config.test.ts`, `src/app/container.ts`, `src/app/container.test.ts`, `src/app/worker.ts`, `.env.example`, `specs/system/deployment.md` ("Local development")

**Interfaces:**
- Consumes: every adapter and use case above.
- Produces:

```ts
// config.ts additions
AppConfig.media:
  | { provider: "local"; durableDir: string }
  | { provider: "dropbox"; appKey: string; appSecret: string; refreshToken: string; apiUrl: string; contentUrl: string };
AppConfig.email:
  | { provider: "mailpit"; url: string; from: string; replyTo: string }
  | { provider: "smtp2go"; apiKey: string; apiUrl: string; from: string; replyTo: string };
// modules.ts
export function buildDefinitions(config: AppConfig, pool: Pool, uow: UnitOfWorkFactory, audit: AuditLog, auditReader: AuditLogReader): DefinitionsDeps;
export function buildMedia(config: AppConfig, pool: Pool, uow: UnitOfWorkFactory, queue: JobQueue): MediaDeps;
export function buildSubmissions(input: { pool: Pool; uow: UnitOfWorkFactory; queue: JobQueue; definitions: DefinitionsDeps; media: MediaDeps; logger: Logger }): SubmissionsDeps;
export function buildNotifications(config: AppConfig, pool: Pool, submissions: SubmissionsDeps): NotificationsDeps;
// container.ts
Container gains: media: MediaDeps; submissions: SubmissionsDeps;
// worker-handlers.ts
export const RECURRING: RecurringJob[];   // jobs.cleanup and identity.cleanup, daily
export function workerHandlers(input: { store: Pick<PgJobStore, "pruneSucceeded">; pool: Pool; media: MediaDeps; notifications: NotificationsDeps; submissions: SubmissionsDeps }): Record<string, JobHandler>;
```

New variables, all with defaults that let `.env.example` start the local stack: `MEDIA_PROVIDER` (`local` default, or `dropbox`), `MEDIA_DURABLE_DIR` (`./data/durable`), `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN` (required with `dropbox`), `DROPBOX_API_URL` (`https://api.dropboxapi.com`), `DROPBOX_CONTENT_URL` (`https://content.dropboxapi.com`), `EMAIL_PROVIDER` (`mailpit` default, or `smtp2go`), `SMTP2GO_API_KEY` (required with `smtp2go`), `SMTP2GO_API_URL` (`https://api.smtp2go.com/v3`), `MAILPIT_URL` (`http://127.0.0.1:8025`), `EMAIL_FROM` (`Effluz Forms <forms@forms.effluz.com>`), `EMAIL_REPLY_TO` (defaults to `PRIVACY_CONTACT_EMAIL`). Production refuses `MEDIA_PROVIDER=local` and `EMAIL_PROVIDER=mailpit`. Errors name variables, never values.

- [ ] **Step 1: Failing tests.** Append to `src/app/config.test.ts`:

```ts
describe("media and email configuration", () => {
  it("defaults to local media and Mailpit outside production", () => {
    const c = loadConfig(base);
    expect(c.media).toEqual({ provider: "local", durableDir: "./data/durable" });
    expect(c.email).toEqual({ provider: "mailpit", url: "http://127.0.0.1:8025", from: "Effluz Forms <forms@forms.effluz.com>", replyTo: "privacy@example.com" });
  });

  it("reads Dropbox and SMTP2GO, and names the missing variables", () => {
    const c = loadConfig({ ...base, MEDIA_PROVIDER: "dropbox", DROPBOX_APP_KEY: "k", DROPBOX_APP_SECRET: "s", DROPBOX_REFRESH_TOKEN: "r", EMAIL_PROVIDER: "smtp2go", SMTP2GO_API_KEY: "api" });
    expect(c.media).toMatchObject({ provider: "dropbox", appKey: "k", apiUrl: "https://api.dropboxapi.com" });
    expect(c.email).toMatchObject({ provider: "smtp2go", apiKey: "api", apiUrl: "https://api.smtp2go.com/v3" });
    expect(() => loadConfig({ ...base, MEDIA_PROVIDER: "dropbox" })).toThrow("Invalid configuration: DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN");
    expect(() => loadConfig({ ...base, EMAIL_PROVIDER: "smtp2go" })).toThrow("Invalid configuration: SMTP2GO_API_KEY");
  });

  it("refuses the local adapters in production", () => {
    const prod = { ...base, NODE_ENV: "production", PUBLIC_BASE_URL: "https://forms.example.com" };
    expect(() => loadConfig(prod)).toThrow(/MEDIA_PROVIDER/);
    expect(() => loadConfig({ ...prod, MEDIA_PROVIDER: "dropbox", DROPBOX_APP_KEY: "k", DROPBOX_APP_SECRET: "s", DROPBOX_REFRESH_TOKEN: "r" })).toThrow(/EMAIL_PROVIDER/);
  });
});
```

`src/app/worker-handlers.test.ts`, which also pins Review Focus 5:

```ts
const store = { pruneSucceeded: () => Promise.resolve(0) };

describe("workerHandlers", () => {
  it("registers every job type of this release that has a handler", () => {
    const handlers = workerHandlers({
      store, pool: {} as Pool, media: makeMediaDeps(), notifications: makeNotificationsDeps(), submissions: makeSubmissionsDeps(),
    });
    expect(Object.keys(handlers).sort()).toEqual([
      "email.staff_notification", "email.submitter_confirmation", "identity.cleanup", "jobs.cleanup", "media.delete", "media.upload",
    ]);
    expect(RECURRING).toEqual([{ type: "jobs.cleanup", period: "daily" }, { type: "identity.cleanup", period: "daily" }]);
  });

  it("jobs.cleanup removes an expired record and its staged files, and stores no submission", async () => {
    const submissions = makeSubmissionsDeps();
    await publishStory(submissions);
    const none = await postContext(submissions, { slug: "story-form", state: { kind: "none" }, submitToken: null });
    if (!none.ok) throw new Error("closed");
    const first = await savePage(submissions, none, post({ answers: { f_name: "Ana Prueba", f_baby: "yes_opt" } }));
    if (first.kind !== "show") throw new Error(first.kind);
    const ctx = await postContext(submissions, { slug: "story-form", state: { kind: "record", id: first.recordId }, submitToken: null });
    if (!ctx.ok) throw new Error("expired");
    await uploadFile(submissions, ctx, { fieldKey: "f_photos", bytes: fakeImage(), renderedAt: null, acceptLanguage: "es" });
    expect(submissions.media.staging.files.size).toBe(1);

    const handlers = workerHandlers({ store, pool: {} as Pool, media: submissions.media, notifications: makeNotificationsDeps(), submissions });
    const cleanup = handlers["jobs.cleanup"];
    if (!cleanup) throw new Error("jobs.cleanup is not registered");
    submissions.clock.advance(24 * 60 * 60 * 1000);
    await cleanup({}, handlerContext({ clock: submissions.clock }));
    expect(submissions.inProgress.rows.size).toBe(0);
    expect(submissions.media.staging.files.size).toBe(0);
    expect(submissions.submissions.rows.size).toBe(0);
  });
});
```

`src/app/modules.test.ts`:

```ts
const env = {
  NODE_ENV: "test", PUBLIC_BASE_URL: "http://localhost:3000", DATABASE_URL: "postgres://u:p@localhost:5432/none",
  STAGING_DIR: "./data/staging", PRIVACY_CONTACT_EMAIL: "privacy@example.com", GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret", GOOGLE_ALLOWED_HOSTED_DOMAIN: "example.com",
};
const pool = {} as unknown as Pool;
const uow = new FakeUnitOfWorkFactory();
const queue = new InMemoryJobQueue();

describe("module wiring", () => {
  it("uses local disk and Mailpit by default, Dropbox and SMTP2GO when configured", () => {
    const local = loadConfig(env);
    expect(buildMedia(local, pool, uow, queue).durable).toBeInstanceOf(LocalDiskStorage);
    const remote = loadConfig({ ...env, MEDIA_PROVIDER: "dropbox", DROPBOX_APP_KEY: "k", DROPBOX_APP_SECRET: "s", DROPBOX_REFRESH_TOKEN: "r", EMAIL_PROVIDER: "smtp2go", SMTP2GO_API_KEY: "a" });
    expect(buildMedia(remote, pool, uow, queue).durable).toBeInstanceOf(DropboxStorage);
    const definitions = buildDefinitions(local, pool, uow, new PgAuditLog(), new PgAuditLogReader(pool));
    expect(definitions.stats).toBeInstanceOf(PgSubmissionStats);
    const submissions = buildSubmissions({ pool, uow, queue, definitions, media: buildMedia(local, pool, uow, queue), logger: new RecordingLogger() });
    const notifications = buildNotifications(local, pool, submissions);
    expect(notifications.sender).toBeInstanceOf(MailpitEmailSender);
    expect(notifications.renderer).toBe(emailTemplates);
    expect(buildNotifications(remote, pool, submissions).sender).toBeInstanceOf(Smtp2goEmailSender);
  });
});
```

Extend `container.test.ts` with: `expect(c.submissions.definitions).toBe(c.definitions)`, `expect(c.submissions.media).toBe(c.media)`, and `expect(c.definitions.stats).toBeInstanceOf(PgSubmissionStats)`; remove its `NullSubmissionStats` expectation.

- [ ] **Step 2: Run** `pnpm test src/app`: fails.

- [ ] **Step 3: Implement.**
  - `config.ts`, `envSchema` gains: `MEDIA_PROVIDER: z.enum(["local", "dropbox"]).default("local")`, `MEDIA_DURABLE_DIR: z.string().min(1).default("./data/durable")`, `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN` (each `z.string().min(1).optional()`), `DROPBOX_API_URL: z.url().default("https://api.dropboxapi.com")`, `DROPBOX_CONTENT_URL: z.url().default("https://content.dropboxapi.com")`, `EMAIL_PROVIDER: z.enum(["mailpit", "smtp2go"]).default("mailpit")`, `SMTP2GO_API_KEY: z.string().min(1).optional()`, `SMTP2GO_API_URL: z.url().default("https://api.smtp2go.com/v3")`, `MAILPIT_URL: z.url().default("http://127.0.0.1:8025")`, `EMAIL_FROM: z.string().min(3).default("Effluz Forms <forms@forms.effluz.com>")`, `EMAIL_REPLY_TO: z.email().optional()`. After the existing production checks, `loadConfig` throws `Invalid configuration: MEDIA_PROVIDER must be dropbox in production` and `Invalid configuration: EMAIL_PROVIDER must be smtp2go in production`, then `Invalid configuration: <missing names, comma-separated>` for the three Dropbox variables when `dropbox`, and `Invalid configuration: SMTP2GO_API_KEY` when `smtp2go` lacks it. The returned config gains `media` and `email` as in Interfaces (`replyTo` is `EMAIL_REPLY_TO ?? PRIVACY_CONTACT_EMAIL`).
  - `.env.example`, appended after `STAGING_DIR` in the file's style:

    ```bash
    # Durable media storage: "local" (default; local disk, refused in production)
    # or "dropbox".
    MEDIA_PROVIDER=local

    # Durable directory when MEDIA_PROVIDER=local. Default: ./data/durable.
    MEDIA_DURABLE_DIR=./data/durable

    # Dropbox App folder credentials, required when MEDIA_PROVIDER=dropbox.
    # Keep them out of the repository and CI.
    DROPBOX_APP_KEY=
    DROPBOX_APP_SECRET=
    DROPBOX_REFRESH_TOKEN=

    # Dropbox API hosts. Change only to point tests at a fake.
    DROPBOX_API_URL=https://api.dropboxapi.com
    DROPBOX_CONTENT_URL=https://content.dropboxapi.com

    # Email sending: "mailpit" (default; the local mail catcher, refused in
    # production) or "smtp2go".
    EMAIL_PROVIDER=mailpit

    # SMTP2GO API key, required when EMAIL_PROVIDER=smtp2go. Keep it out of the
    # repository and CI.
    SMTP2GO_API_KEY=

    # SMTP2GO API base. Default: https://api.smtp2go.com/v3.
    SMTP2GO_API_URL=https://api.smtp2go.com/v3

    # Mailpit's web and API address in the dev Compose stack.
    MAILPIT_URL=http://127.0.0.1:8025

    # Sender of every email, "Name <address>" or a bare address.
    EMAIL_FROM=Effluz Forms <forms@forms.effluz.com>

    # Reply-To of every email. Default: PRIVACY_CONTACT_EMAIL.
    EMAIL_REPLY_TO=
    ```
  - `specs/system/deployment.md`, "Local development", after "The variables and their defaults are documented in `.env.example` itself.", add: "Media goes to `MEDIA_DURABLE_DIR` on local disk and email to Mailpit (`MAILPIT_URL`, web view at http://127.0.0.1:8025) unless `MEDIA_PROVIDER=dropbox` or `EMAIL_PROVIDER=smtp2go` is set with its credentials."
  - `modules.ts` (comment: module wiring shared by the web container and the worker; `architecture.md`, "Ports"), one `buildDefaultRegistry()` per process:
    - `buildDefinitions`: the three Postgres definitions repositories, `stats: new PgSubmissionStats(pool)`, the given audit log and reader, `uow`, `systemClock`, `systemIdGenerator`, the registry, `allowedRecipientDomains: config.notificationAllowedDomains`, `publicBaseUrl: config.publicBaseUrl`.
    - `buildMedia`: `staging: new LocalDiskStorage(config.stagingDir)`; `durable`: `new DropboxStorage({ appKey, appSecret, refreshToken, apiUrl, contentUrl })` from `config.media` when `dropbox`, else `new LocalDiskStorage(config.media.durableDir)`; `FileTypeSniffer`, `SharpImageEncoder`, `PgMediaRepository(pool)`, the queue, `uow`, `systemIdGenerator`, `systemClock`.
    - `buildSubmissions`: the given definitions and media, `PgInProgressRepository(pool)`, `PgSubmissionRepository(pool)`, the queue, `uow`, `systemClock`, `systemIdGenerator`, the registry, the logger, `new VersionCache()`, `random: Math.random`.
    - `buildNotifications`: `sender` is `new Smtp2goEmailSender({ apiKey, apiUrl, from, replyTo })` or `new MailpitEmailSender({ url, from, replyTo })` from `config.email`; `renderer: emailTemplates`; `source: new SubmissionMessageSource({ submissions: submissions.submissions, definitions: submissions.definitions, versions: submissions.versions, registry, publicBaseUrl: config.publicBaseUrl, privacyContact: config.privacyContactEmail })`; `deliveries: new PgDeliveryLog(pool)`.
  - `container.ts`: `buildDefinitions` comes from `./modules`; after the existing identity wiring:

    ```ts
    const queue = overrides.queue ?? new PgJobQueue(systemIdGenerator, systemClock);
    const definitions = overrides.definitions ?? buildDefinitions(config, pool, uow, identity.audit, auditReader);
    const media = overrides.media ?? buildMedia(config, pool, uow, queue);
    const submissions = overrides.submissions ?? buildSubmissions({ pool, uow, queue, definitions, media, logger });
    ```

    returned alongside the rest; `Container` gains `media` and `submissions`; the `NullSubmissionStats` import goes (the class stays for definitions' tests).
  - `worker-handlers.ts`: `RECURRING` as tested; `workerHandlers` maps `jobs.cleanup` to `createCleanupHandler(input.store, [(ctx) => expireInProgress(input.submissions, { now: ctx.clock.now(), logger: ctx.logger }).then(() => undefined)])`, `identity.cleanup` to `createIdentityCleanupHandler(input.pool)`, `MEDIA_JOB_TYPES.upload` and `.delete` to the two media factories over `input.media`, and `EMAIL_JOB_TYPES.submitterConfirmation` and `.staffNotification` to the two email factories over `input.notifications`.
  - `worker.ts`, `main()` after `store`: 

    ```ts
    const uow = new PgUnitOfWorkFactory(pool);
    const queue = new PgJobQueue(systemIdGenerator, systemClock);
    const definitions = buildDefinitions(config, pool, uow, new PgAuditLog(), new PgAuditLogReader(pool));
    const media = buildMedia(config, pool, uow, queue);
    const submissions = buildSubmissions({ pool, uow, queue, definitions, media, logger });
    const notifications = buildNotifications(config, pool, submissions);
    ```

    and the `Worker` gets `{ store, queue, uow, clock: systemClock, logger }` and `handlers: workerHandlers({ store, pool, media, notifications, submissions })`, `recurring: RECURRING` in place of the inline handler and recurring literals. The worker still never imports Next.js: `src/shared/presentation/email/` is plain TypeScript.

- [ ] **Step 4: Run** `pnpm test && pnpm lint && pnpm typecheck && pnpm format:check && pnpm build`; then `pnpm db:up && pnpm exec tsx --env-file=.env src/app/worker.ts` for ten seconds and see `worker started` and no error.
- [ ] **Step 5: Commit** `feat(app): media and email configuration, module wiring, and the six job handlers in the worker`

---

### Task 28: The page form's Server Action, public routes, root layouts, cookies and the renderer's Content-Security-Policy

**Files:**
- Create: `src/modules/submissions/presentation/cookies.ts`, `cookies.test.ts`, `http.ts`, `http.test.ts`, `csp.ts`, `csp.test.ts`, `error-copy.ts`
- Modify: `src/modules/submissions/presentation/copy.test.ts`
- Create: `src/app/f/[slug]/actions.ts`, `actions.test.ts`, `layout.tsx`, `page.tsx`, `view.ts`, `not-found.tsx`, `error.tsx`, `files/route.ts`, `files/[fileId]/route.ts`, `check/route.ts`, `restart/route.ts`, `_lib/respond.ts`, `routes.test.ts`
- Create: `src/app/global-not-found.tsx`, `src/app/(home)/layout.tsx`; move `src/app/page.tsx` to `src/app/(home)/page.tsx`
- Modify: `src/app/admin/layout.tsx` (becomes the staff root layout with `<html lang="en">` and `<body>`), delete `src/app/layout.tsx`, `src/proxy.ts`, `src/proxy.test.ts` (the matcher assertion and the renderer policy), `next.config.ts`
- Test: `src/app/next-config.test.ts`

**Interfaces:**
- Consumes: Tasks 18 to 26.
- Produces:

```ts
// cookies.ts
export const FILL_COOKIE = "effluz_fill";
export const FILL_COOKIE_MAX_AGE_SECONDS = 86_400;
export function fillCookiePath(slug: string): string;                            // "/f/<slug>"
export function encodeFillState(state: FillState): string | null;               // null for { kind: "none" }
export function parseFillState(value: string | null): FillState;                // anything malformed is { kind: "none" }
export function fillCookie(slug: string, state: FillState, secure: boolean): string;          // a Set-Cookie value
export function clearedFillCookie(slug: string, secure: boolean): string;
export function fillCookieOptions(slug: string, secure: boolean, maxAge: number): { path: string; httpOnly: true; sameSite: "lax"; secure: boolean; maxAge: number };
export function readCookie(header: string | null, name: string): string | null;
// http.ts
export const FILE_BODY_LIMIT: number;                                           // LIMITS.fileSizeMb MB + 64 KB
export async function readFormData(request: Request, maxBytes: number): Promise<FormData | "too_large" | "malformed">;
export function seeOther(location: string, cookies?: readonly string[]): Response;
export function json(body: unknown, status?: number, cookies?: readonly string[]): Response;
export function plain(status: number): Response;
// csp.ts
export function rendererCsp(nonce: string, development: boolean): string;
// src/app/f/[slug]/_lib/respond.ts
export function outcomeLocation(slug: string, outcome: Exclude<PostOutcome, { kind: "refused" }>): string;   // "/f/<slug>" or "/f/<slug>?expired=1"
export function outcomeFillState(outcome: Exclude<PostOutcome, { kind: "refused" }>): FillState | "clear" | "keep";
// src/app/f/[slug]/actions.ts ("use server")
export async function postPage(slug: string, previous: PageFormState, form: FormData): Promise<PageFormState>;
// src/app/f/[slug]/view.ts
export const loadView: (slug: string, expired: boolean) => Promise<{ view: ViewResult; container: Container }>;   // React cache(), shared by layout and page
```

Decision (in-progress cookie): `effluz_fill`, `Path=/f/<slug>`, `HttpOnly`, `SameSite=Lax`, `Max-Age=86400`, `Secure` in production; values `<record id>`, `done.<submit token>`, `decoy.<reference>`; `SameSite=Lax` and Next's `Origin` check on Server Actions are the CSRF defence for the public posts. Decision (answering the page form): the page form posts to the Server Action `postPage`, bound to the slug by the page. A `refused` outcome sets the record cookie, calls `refresh()` and returns `{ refusedFiles }` with each refused file's message built here (`fileIssueMessage` in the record's locale with the field's limits), so the page renders in the post's own answer (HTTP 200 without script); every other outcome sets or clears the cookie and calls `redirect(outcomeLocation(...))`, which Next answers with 303. No file name is written anywhere. Decision (root layouts): `src/app/layout.tsx` gives way to three root layouts (`admin/`, `(home)/`, `f/[slug]/`) so the renderer's `<html lang>` follows the submitter's language, plus `global-not-found.tsx` for paths outside them; the renderer layout and page share one `viewForm` call through React's `cache`.

**The route handler pattern** (the four route handlers below follow it; they are named "per the route handler pattern"): `const { slug } = await params; const container = getContainer();` the fill state is `parseFillState(readCookie(request.headers.get("cookie"), FILL_COOKIE))`; the context is `postContext(container.submissions, { slug, state, submitToken: null })`; a body is read with `readFormData(request, limit)`, `malformed` answering `plain(400)`; one use case is called and its result mapped to `json`, `plain` or `seeOther`, all with `Cache-Control: no-store`; the body runs in `try`/`catch`, an unexpected error logging `<route> failed` with `{ slug, error: <error class> }` (never a value) and answering `json({ ok: false, message: null }, 500)` for JSON routes or `plain(500)`.

- [ ] **Step 1: Failing tests.** Presentation cases (`ID = "00000000-0000-4000-8000-0000000000aa"`):
- `cookies.test.ts`, "is scoped to the form, httpOnly, lax, a day long, secure in production": `fillCookie("story-form", { kind: "record", id: ID }, true)` is `` `effluz_fill=${ID}; Path=/f/story-form; HttpOnly; SameSite=Lax; Max-Age=86400; Secure` ``; `clearedFillCookie("story-form", false)` is `effluz_fill=; Path=/f/story-form; HttpOnly; SameSite=Lax; Max-Age=0`; `fillCookieOptions("story-form", false, 86_400)` equals `{ path: "/f/story-form", httpOnly: true, sameSite: "lax", secure: false, maxAge: 86_400 }`.
- `cookies.test.ts`, "round-trips each state and reads anything else as none": `{ kind: "record", id: ID }`, `{ kind: "done", submitToken: ID }` and `{ kind: "decoy", reference: "HP-1234" }` survive `parseFillState(encodeFillState(state))`; `null`, `""`, `"nope"`, `"done.not-a-uuid"`, `"decoy.<script>"`, `"decoy.hp-1"` and `` `${ID};x` `` parse as `{ kind: "none" }`.
- `http.test.ts` (requests to `http://localhost/f/x/files`, `duplex: "half"`): "parses a body within the limit" (a `FormData` with `a=1` under 1024 bytes reads back `a` as `1`); "refuses by Content-Length before reading, and by counting a body without one" (`content-length: 5000` with a 1024 limit is `too_large`; a 2048-byte stream without a length, `content-type: multipart/form-data; boundary=x`, is `too_large`); "calls an unparsable body malformed" (`garbage` as multipart is `malformed`); `seeOther`, "is an uncached 303 with each cookie as its own header" (`seeOther("/f/x", ["a=1", "b=2"])` has status 303, `location` `/f/x`, `getSetCookie()` `["a=1", "b=2"]`, `cache-control` `no-store`).
- `csp.test.ts`, "allows only this origin's scripts carrying the nonce, and no framing": `rendererCsp("abc123", false)` contains `script-src 'self' 'nonce-abc123' 'strict-dynamic'`, `frame-ancestors 'none'`, `form-action 'self'` and `img-src 'self' blob: data:`, and no `unsafe-eval`; with `true` it contains `'unsafe-eval'`.

`src/app/f/[slug]/actions.test.ts`, mocking Next the way the Settings action's test does: `next/headers` gives a cookie jar backed by a `Map` (`get` returns `{ name, value }` for a non-empty value, `set(name, value, options)` records both) and `headers()` with `accept-language: es`; `next/navigation`'s `redirect(url)` throws `Error("REDIRECT <url>")`; `next/cache`'s `refresh` is a `vi.fn()`; `getContainer` returns `buildContainer(config, { pool: {} as Pool, submissions: deps, definitions: deps.definitions, media: deps.media })` over `makeSubmissionsDeps()` with the story form published; the jar, the deps and the `refresh` mock are fresh before each test. `form(fields)` builds a `FormData` from strings and `File`s.

```ts
describe("postPage", () => {
  it("creates the record on page 1 and redirects with the cookie", async () => {
    await expect(postPage("story-form", EMPTY_PAGE_FORM_STATE, form({ _page: "page_contact", _action: "next", _rendered: deps.clock.now().toISOString(), "website-url": "", f_name: "Ana Prueba", f_baby: "no_opt" }))).rejects.toThrow("REDIRECT /f/story-form");
    const cookie = jar.get("effluz_fill");
    expect(cookie?.value).toMatch(/^[0-9a-f-]{36}$/);
    expect(cookie?.options).toEqual({ path: "/f/story-form", httpOnly: true, sameSite: "lax", secure: false, maxAge: 86_400 });
    expect(deps.inProgress.rows.size).toBe(1);
  });

  it("answers a refused page directly, naming the refused file, and redirects nowhere", async () => {
    await postPage("story-form", EMPTY_PAGE_FORM_STATE, form({ _page: "page_contact", _action: "next", f_name: "Ana Prueba", f_baby: "yes_opt" })).catch(() => undefined);
    const state = await postPage("story-form", EMPTY_PAGE_FORM_STATE, form({ _page: "page_baby", _action: "next", f_photos: new File(["hello"], "notes.txt") }));
    expect(state).toEqual({ refusedFiles: [{ fieldKey: "f_photos", message: "notes.txt no es un tipo permitido. Usa fotos JPEG, PNG, WebP o HEIC, o videos MP4 o MOV" }] });
    expect(vi.mocked(refresh)).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([...deps.inProgress.rows.values()])).not.toContain("notes.txt");
  });
});
```

and:
- "sends an expired cookie to the expired screen and clears it": the jar holds `effluz_fill` = `00000000-0000-4000-8000-0000000000aa` (no such record); a `page_contact` Next rejects with `REDIRECT /f/story-form?expired=1` and the jar's cookie becomes `{ value: "", options: { maxAge: 0 } }`.
- "submits a one-page path end to end and sets the done cookie": page 1 with `f_baby: no_opt` and `_rendered` a minute ago (its redirect caught), then `page_consent` Submit with the record's token and `f_consent: accepted` rejects with `REDIRECT /f/story-form`; the cookie is `done.<token>`; one submission is stored, its consent text version `consentTextVersion(CONSENT_TEXT)`.
- "redirects a malformed post back to the page and stores nothing": `_action: "jump"` on `page_contact` rejects with `REDIRECT /f/story-form` and no record exists.

`src/app/f/[slug]/routes.test.ts`, with the same container mock; `onPhotos()` saves page 1 with `{ f_name: "Ana Prueba", f_baby: "yes_opt" }` through `savePage` on `deps` and returns the cookie header `effluz_fill=<record id>`; `req(path, body, cookie?)` builds the POST to `https://forms.example.com/f/story-form<path>`:
- "uploads one file as JSON, refuses with a localized message, and removes": `files` `POST` with `field: f_photos`, `_locale: es` and `new File([fakeImage()], "a.jpg")` answers 200 matching `{ ok: true, label: "Archivo 1, 1 kB" }`; `new File(["<html>"], "notes.jpg")` answers 422 with `{ ok: false, message: "notes.jpg no es un tipo permitido. Usa fotos JPEG, PNG, WebP o HEIC, o videos MP4 o MOV" }`; `DELETE /f/story-form/files/<id>` with the cookie answers 204.
- "checks one field with the server's rules": `check` with `_field: f_email`, `_locale: en`, `f_email: nope` answers `{ message: "Enter a valid email address, like name@example.com" }`; with `a@example.com`, `{ message: null }`.
- "restarts by clearing the cookie": `GET /f/story-form/restart` answers 303 to `/f/story-form` with a `Set-Cookie` holding `Max-Age=0`.

In `src/proxy.test.ts`, the existing matcher assertion `expect(proxyConfig.matcher).toEqual(["/admin/:path*"])` becomes the second case below, and add (resetting the mocked `getContainer`'s calls in this describe's `beforeEach`):

```ts
describe("the renderer's Content-Security-Policy", () => {
  it("adds a per-request nonce policy to the page and to its form posts, and leaves the session gate alone", async () => {
    const res = await proxy(new NextRequest("https://forms.example.com/f/story-form"));
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    const again = await proxy(new NextRequest("https://forms.example.com/f/story-form", { method: "POST" }));
    expect(again.headers.get("content-security-policy")).toMatch(/'nonce-/);
    expect(again.headers.get("content-security-policy")).not.toBe(csp);
    expect(vi.mocked(getContainer)).not.toHaveBeenCalled();
  });

  it("matches /f/<slug> as well as /admin", () => {
    expect(proxyConfig.matcher).toEqual(["/admin/:path*", "/f/:slug"]);
  });
});
```

`src/app/next-config.test.ts`:

```ts
describe("next.config", () => {
  it("lets a page post carry every file of a submission, through the proxy and the Server Action", () => {
    const limit = `${String(LIMITS.submissionSizeMb + 1)}mb`;
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe(limit);
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe(limit);
    expect(nextConfig.serverExternalPackages).toEqual(["sharp", "libheif-js"]);
  });
});
```

`copy.test.ts` gains:

```ts
  it("keeps the client error boundary's copy equal to the chrome rows", () => {
    expect(errorCopy).toEqual({ title: chrome.error_title, body: chrome.error_body, tryAgain: chrome.try_again });
  });
```

- [ ] **Step 2: Run** `pnpm test src/modules/submissions/presentation src/app src/proxy.test.ts`: fails.

- [ ] **Step 3: Implement.**
  - `cookies.ts` (comment links `security.md`, "In-progress cookie"): `encodeFillState`/`parseFillState` as tested (a record id is a UUID; `done.` takes a UUID; `decoy.` takes `^[A-Z0-9]{2,6}-\d{4,}$`); `fillCookie` builds `effluz_fill=<value>; Path=…; HttpOnly; SameSite=Lax; Max-Age=…` plus `; Secure`, a `none` state clearing; `readCookie` finds one name in a `Cookie` header (empty is null).
  - `http.ts` (comment links `security.md`, "Public form abuse protection"): `readFormData` refuses a declared `Content-Length` above the limit before reading, otherwise pipes the body through a counting `TransformStream` that errors past the limit (so an oversized upload is never buffered whole) and parses with `new Response(limited, { headers: { "Content-Type": … } }).formData()`, a failure being `too_large` when the counter tripped and `malformed` otherwise. The response helpers set `Cache-Control: no-store` and append each cookie as its own `Set-Cookie`.
  - `csp.ts`: `default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic'` (+ ` 'unsafe-eval'` in development)`; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`.
  - `src/proxy.ts`: first in `proxy()`, `if (pathname.startsWith("/f/")) return withRendererCsp(request)`, where `withRendererCsp` makes a nonce from `crypto.randomUUID()` (base64), sets the policy on the forwarded request headers (Next reads the nonce from them and stamps its scripts) and on the response; the matcher becomes `["/admin/:path*", "/f/:slug"]` (the page and its form posts; uploads, checks and restart answer JSON or redirects and need no policy). The doc comment says it also sets the renderer's policy.
  - `next.config.ts`: `serverExternalPackages: ["sharp", "libheif-js"]` (Task 7) and `experimental: { serverActions: { bodySizeLimit: "101mb" }, proxyClientMaxBodySize: "101mb", globalNotFound: true }`, the comment naming `LIMITS.submissionSizeMb` + 1 MB for the text fields.
  - `_lib/respond.ts`: `outcomeLocation` is `/f/<slug>`, or `/f/<slug>?expired=1` for `expired`; `outcomeFillState` is the record for `show`, `done` for `submitted`, `decoy` for `decoy`, `clear` for `expired`, `keep` for `gate`.
  - `actions.ts` (`"use server"`; comment: the renderer's page form, with or without script; a refused page is answered directly, everything else redirects; `renderer.md`, "Routes"): read the cookie jar and `accept-language` (`cookies()`, `headers()`), the fill state and the posted `_token`; `postContext`; a refused context sets the cookie its outcome asks for and redirects. `decodePagePost` null (an unknown page or action) redirects to the page and changes nothing. Otherwise `submitForm` for Submit, `savePage` for the rest, with `{ ...decoded, state, acceptLanguage }`. `refused`: set the record cookie, `refresh()`, and return the refused files' messages (the field's label and `uploadLimits` from the version, `fileIssueMessage({ code, name }, limits, outcome.locale)`). Others: set the cookie (`fillCookieOptions(slug, secure, FILL_COOKIE_MAX_AGE_SECONDS)`, or an empty value with `maxAge: 0` to clear), then `redirect(outcomeLocation(slug, outcome))`. An unexpected error is logged as `form post failed` with `{ slug, error: <error class> }` and rethrown, so the segment's error boundary answers.
  - `files/route.ts`, per the route handler pattern, `POST` with `FILE_BODY_LIMIT`: a refused context answers `json({ ok: false, message: null }, 410)`; the locale is the posted `_locale` if the form offers it, else the record's, else `pickLocale`; `too_large` answers 413 with the `file_too_large` message of the current page's upload field and `{file}` left for the client (no field: `plain(413)`); an unknown `field` or a missing `file` is `plain(400)`; then `uploadFile` with the file's bytes; a refusal answers `{ ok: false, message: uploadRefusalMessage(code, { file: <name>, label, limits }, locale) }` with 410 for `expired` and 422 otherwise; success answers `{ ok: true, file, count, label: t(locale, "file_row", { n: count, size: formatBytes(size) }) }` with the record cookie.
  - `files/[fileId]/route.ts`, per the pattern, `DELETE`: a refused context is `plain(410)`; `removeFile` true is 204, false 404.
  - `check/route.ts`, per the pattern, `POST` with a 64 KB limit: a refused context answers `{ message: null }`; an unknown `_field` is 400; `decodeField`, then `checkField`; the answer is `{ message: issueMessage(issue, label, locale) }` or `{ message: null }`, in `localeFor(languages, _locale)`.
  - `restart/route.ts`, per the pattern, `GET`: `seeOther("/f/<slug>", [clearedFillCookie(slug, secure)])`.
  - `view.ts`: `loadView = cache(async (slug, expired) => …)` reads `cookies()` and `headers()` and calls `viewForm` once per request.
  - `layout.tsx` (`export const instant = false`): `<html lang={viewLocale(view)}><body>{children}</body></html>`.
  - `page.tsx` (`instant = false`): `generateMetadata` gives the page's document title, or the confirmation's form title, or both languages of the closed, not open, expired and not found titles, with `robots: { index: false }` on everything but form pages; the page calls `notFound()` for `not_found` and otherwise renders `RendererScreen` with the privacy contact, the registry and `formAction={postPage.bind(null, slug)}`.
  - `not-found.tsx` renders `NotFoundScreen`. `error-copy.ts` holds the three rows the client boundary needs (`error_title`, `error_body`, `try_again`), alone, so the boundary does not load the copy tables; `error.tsx` (`"use client"`) shows them in both languages with a Try again link back to the page.
  - Root layouts: `src/app/admin/layout.tsx` becomes the staff root layout (`metadata = adminMetadata`, `<html lang="en"><body style={{ margin: 0 }}>`); `src/app/(home)/layout.tsx` is the same wrapper with `metadata = { title: "Effluz Forms" }` (the old root layout's content); `git mv src/app/page.tsx "src/app/(home)/page.tsx"`; `git rm src/app/layout.tsx`; `src/app/global-not-found.tsx` renders `<html lang="es"><body><NotFoundScreen /></body></html>` with the renderer stylesheet. Search for imports of `@/app/layout` (there are none today) and for tests that render the old root layout.

- [ ] **Step 4: Run** `pnpm test && pnpm lint && pnpm typecheck && pnpm format:check && pnpm build`. Then check the 404s against the built app: `pnpm start -p 3100` in one shell and, in another, `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3100/no-such-path` and the same for `/f/no-such-form`; both print `404` (the first through `global-not-found.tsx`, the second through `not-found.tsx`). Stop the server. The first manual run in a browser needs a published form, which the e2e helper of Task 29 creates; it is part of Task 31, Step 3.
- [ ] **Step 5: Commit** `feat(app): the page form's Server Action, public routes, root layouts per surface, the in-progress cookie and the renderer CSP`

---

### Task 29: End to end without script: the reference form, failure paths, and the budgets

**Files:**
- Create: `tests/support/test-database.ts`, `tests/support/app-server.ts`, `vitest.e2e.config.ts`, `tests/e2e/setup.ts`, `tests/e2e/vitest.d.ts`, `tests/e2e/http.ts`, `tests/e2e/publish.ts`, `tests/e2e/reference-form.test.ts`, `tests/e2e/budgets.test.ts`
- Modify: `tests/integration/setup.ts` (uses `createTestDatabase`), `vitest.config.ts` (the unit run excludes `tests/e2e/**`), `package.json` (`test:e2e`), `.github/workflows/ci.yml` (job `e2e`), `specs/system/ci-cd.md` ("As built")

**Interfaces:**
- Consumes: the built app (`pnpm build`), every route and the Server Action of Task 28, the definitions use cases (`createForm`, `updateSettings`, `publishPreview`, `publishForm`, `applyLifecycle`), `referenceFormDraft` and `referenceSubmission` (`tests/fixtures/reference-form.ts`), `syntheticJpegWithGps`, `syntheticMp4` (Task 5).
- Produces:

```ts
// tests/support/test-database.ts
export async function createTestDatabase(): Promise<{ url: string; drop(): Promise<void> }>;
// tests/support/app-server.ts
export async function startApp(input: { port: number; databaseUrl: string }): Promise<{ baseUrl: string; stagingDir: string; stop(): Promise<void> }>;
// tests/e2e/http.ts
export class Visitor {
  constructor(base: string, headers?: Record<string, string>);
  get(path: string): Promise<{ status: number; html: string; location: string | null }>;
  /** Posts the page form found in `html`: its hidden inputs (Next's Server Action fields included), then `fields`, then `files`. */
  submit(html: string, fields: Record<string, string>, files?: readonly { field: string; file: File }[]): Promise<{ status: number; html: string; location: string | null }>;
  cookie(): string | null;                          // the effluz_fill value
}
export function hidden(html: string, name: string): string | null;
export function textOf(html: string): string;
// tests/e2e/publish.ts
export async function publishReferenceForm(pool: Pool, over?: Partial<FormSettings>): Promise<{ formId: string; slug: string; deps: DefinitionsDeps }>;
export function pageAnswers(pageKey: string): Record<string, string>;   // the reference submission's values for one page, as form fields
```

This suite talks HTTP to `next start` exactly as a browser with script disabled does: it reads the page form from the HTML (action, hidden inputs) and posts it multipart, keeps the cookie, follows nothing automatically, and checks 303s and the 200 answers of refused posts. The browser run with script is Task 30.

Decision (e2e files): the reference form allows ten files; the test first posts ten images and one video together, which is refused with `files_max` and stages nothing, then nine images and the video, which go through. Both Submits wait for the minimum fill time, so the first is refused for its files and not silently accepted.

- [ ] **Step 1: Shared helpers.** `tests/support/test-database.ts` takes the database creation and drop out of `tests/integration/setup.ts` unchanged in behavior: a random `effluz_test_<hex>` database created through `TEST_DATABASE_ADMIN_URL` (default `postgres://effluz:effluz@127.0.0.1:5432/postgres`), migrated with `migrate(pool, loadMigrations(MIGRATION_DIRS))` through a one-connection pool without a statement timeout, dropped (after terminating its connections) on failure or by `drop()`. `tests/integration/setup.ts` becomes:

```ts
import type { TestProject } from "vitest/node";
import { createTestDatabase } from "../support/test-database";

/** Creates a throwaway database, migrates it, hands its URL to the tests and drops it afterwards. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const db = await createTestDatabase();
  project.provide("databaseUrl", db.url);
  return db.drop;
}
```

`tests/support/app-server.ts`: `startApp` makes a `mkdtemp` root, spawns `node node_modules/next/dist/bin/next start -p <port> -H 127.0.0.1` with `NODE_ENV=test`, `SERVICE=app`, `PUBLIC_BASE_URL=http://127.0.0.1:<port>`, `DATABASE_URL`, `STAGING_DIR=<root>/staging`, `MEDIA_PROVIDER=local`, `MEDIA_DURABLE_DIR=<root>/durable`, `EMAIL_PROVIDER=mailpit`, `PRIVACY_CONTACT_EMAIL=privacy@example.com`, `GOOGLE_CLIENT_ID=e2e-client`, `GOOGLE_CLIENT_SECRET=e2e-secret`, `GOOGLE_ALLOWED_HOSTED_DOMAIN=effluz.com`, `NOTIFICATION_ALLOWED_DOMAINS=example.com`, `LOG_LEVEL=warn` (stdout and stderr inherited), polls `GET /f/e2e-probe` every 250 ms for up to 60 seconds until it answers, and `stop()` sends `SIGTERM`, waits for `exit` and removes the root. Run `pnpm test:integration` once to confirm nothing changed.

- [ ] **Step 2: The harness.** `vitest.e2e.config.ts`: `include: ["tests/e2e/**/*.test.ts"]`, node environment, the `@` alias, `globalSetup: ["tests/e2e/setup.ts"]`, `fileParallelism: false`, test and hook timeouts 120 seconds, with the comment "End-to-end tests against the built app (`pnpm build` first). See specs/system/ci-cd.md." `vitest.config.ts` adds `"tests/e2e/**"` to `exclude`. `tests/e2e/vitest.d.ts` declares `ProvidedContext { databaseUrl: string; baseUrl: string; stagingDir: string }`. `tests/e2e/setup.ts`: `createTestDatabase()`, `startApp({ port: 3199, databaseUrl })`, provide the three values, and on teardown stop the app and drop the database.

`tests/e2e/http.ts` (header: a browser without script; synthetic data only):
  - `Visitor` sends its headers (default `accept-language: es-PA,es;q=0.9`) and `cookie: effluz_fill=<value>` when it holds one, with `redirect: "manual"`; every response's `Set-Cookie` for `effluz_fill` updates or clears the value.
  - `submit(html, fields, files)` finds `<form … id="page-form" …>` in `html`, takes its `action` attribute (the page's own URL), collects every `<input type="hidden" name value>` inside it with `&quot;`, `&amp;`, `&#x27;`, `&#39;`, `&lt;` and `&gt;` decoded, sets `fields` over them, appends each file under its field name, and posts multipart with `origin: <base>`; it returns the status, the `Location` and the body text.
  - `hidden(html, name)` reads one hidden input's value; `textOf(html)` drops scripts and tags, decodes the entities above and collapses whitespace.

`tests/e2e/publish.ts`: `publishReferenceForm(pool, over)` builds `DefinitionsDeps` over the Postgres definitions repositories (`PgSubmissionStats`, the identity audit log and reader, `allowedRecipientDomains: ["effluz.com", "example.com"]`, `publicBaseUrl: "http://127.0.0.1:3199"`), creates a form under a random slug `historia-prematuro-<6 chars>` (`languages: "es"`, title `{ es: "Historias" }`), saves the parsed `referenceFormDraft` as its draft at the draft's revision, updates the settings to `referencePrefix: "HP"`, `retentionMonths: 12`, `notificationRecipients: ["staff-group@example.com"]`, `notificationCadence: "per_submission"`, `closesAt` in 30 days and `...over`, then publishes with the preview's own numbers:

```ts
  const preview = await publishPreview(deps, form.id);
  if (!preview) throw new Error("no preview");
  const published = await publishForm(deps, editor, { formId: form.id, expectedNumber: preview.nextNumber, expectedRevision: preview.draftRevision });
  if (!published.ok) throw new Error(published.code);
```

`pageAnswers(pageKey)` returns, for each field of that page of `referenceFormDraft`, the string value of `referenceSubmission`, and `accepted` for the consent field.

- [ ] **Step 3: Failing e2e tests.** `tests/e2e/reference-form.test.ts`. Shared helpers: a two-connection pool on `inject("databaseUrl")`, closed after all; `count(sql, args)`; `stagedFiles()` lists names with a dot under `inject("stagingDir")`; `photos(n)` makes `n` `syntheticJpegWithGps(64 + i, 48)` files `IMG_<i>.jpg` of type `image/jpeg`; `video()` is `syntheticMp4()` as `mensaje.mp4`; `asFiles(list)` maps them to `{ field: "photos", file }`; `waitForMinimumTime(renderedAt)` sleeps until 3.2 seconds after it; `fillToPhotos(slug)` GETs page 1 (200, text contains `Historias`), notes the time, and for `page1` to `page4` GETs the page and submits `{ _action: "next", "website-url": "", ...pageAnswers(page) }`, expecting 303 to `/f/<slug>`, then GETs page 5 (text contains `Página 5 de 5`) and returns `{ v, renderedAt, html }`.

```ts
describe("the reference form without script", () => {
  it("is completed with nine photos and a video, and stored with its media rows and jobs", async () => {
    const { slug, formId } = await publishReferenceForm(pool);
    const { v, renderedAt, html } = await fillToPhotos(slug);
    await waitForMinimumTime(renderedAt);

    const tooMany = await v.submit(html, { _action: "submit", "website-url": "", ...pageAnswers("page5") }, asFiles([...(await photos(10)), video()]));
    expect(tooMany.status).toBe(200);
    expect(textOf(tooMany.html)).toContain("Puedes subir hasta 10 archivos en Sube hasta 10 fotos sin editar del bebé");
    expect(textOf(tooMany.html)).toContain("Corrige 1 problema para continuar");
    expect(await count("select count(*)::int as n from submission where form_id = $1", [formId])).toBe(0);
    expect(await stagedFiles()).toHaveLength(0);

    const sent = await v.submit(tooMany.html, { _action: "submit", "website-url": "", ...pageAnswers("page5") }, asFiles([...(await photos(9)), video()]));
    expect(sent.status).toBe(303);
    expect(v.cookie()).toMatch(/^done\./);

    const confirmation = await v.get(`/f/${slug}`);
    expect(textOf(confirmation.html)).toContain("Gracias por la información.");
    expect(textOf(confirmation.html)).toContain("Tu referencia:");
    expect(textOf(confirmation.html)).toContain("HP-0001");

    const { rows: [submission] } = await pool.query<{ id: string; reference: string; locale: string; answers: Record<string, unknown> }>(
      "select id, reference, locale, answers from submission where form_id = $1", [formId]);
    expect(submission).toMatchObject({ reference: "HP-0001", locale: "es" });
    expect((submission?.answers["photos"] as string[]).length).toBe(10);
    const media = await pool.query<{ kind: string; content_type: string; durable_key: string; staging_ref: string }>(
      "select kind, content_type, durable_key, staging_ref from media where submission_id = $1 order by position", [submission?.id]);
    expect(media.rows).toHaveLength(10);
    expect(media.rows[0]?.durable_key).toBe(`forms/${slug}/HP-0001/01-sube-hasta-10-fotos-sin-editar-del-bebe.jpg`);
    expect(media.rows[9]).toMatchObject({ kind: "video", content_type: "video/mp4" });
    expect(media.rows[9]?.durable_key).toBe(`forms/${slug}/HP-0001/10-sube-hasta-10-fotos-sin-editar-del-bebe.mp4`);
    for (const row of media.rows.filter((r) => r.kind === "image")) {
      const meta = await sharp(path.join(inject("stagingDir"), row.staging_ref)).metadata();
      expect(meta.exif, row.staging_ref).toBeUndefined();
    }
    const jobs = await pool.query<{ type: string; payload: Record<string, unknown> }>(
      `select type, payload from job
        where payload->>'submissionId' = $1
           or payload->>'mediaId' in (select id::text from media where submission_id = $1)
        order by type`,
      [submission?.id],
    );
    expect(jobs.rows.filter((j) => j.type === "media.upload")).toHaveLength(10);
    expect(jobs.rows.filter((j) => j.type === "email.staff_notification")).toEqual([{ type: "email.staff_notification", payload: { submissionId: submission?.id } }]);
    expect(jobs.rows.filter((j) => j.type === "email.submitter_confirmation")).toEqual([]);
    expect(await count("select count(*)::int as n from submission_in_progress where form_id = $1", [formId])).toBe(0);

    const back = await v.get(`/f/${slug}`);
    expect(textOf(back.html)).toContain("HP-0001");
  });
});
```

and, each on its own published form:
- "answers an invalid page with the page itself: the error summary and what was typed": page 1 submitted with `pageAnswers("page1")` but `adult_name: ""` and `email: "no-es-un-correo"` answers 200; its text holds `Corrige 2 problemas para continuar`, `Nombre y apellido completo del adulto responsable es obligatorio` and `Escribe un correo válido, como nombre@ejemplo.com`; its HTML holds `value="no-es-un-correo"`.
- "names a refused file only in the answer to its post": on page 5, after the minimum time, Next with `pageAnswers("page5")` and one file `new File(["solo texto"], "notas-privadas.jpg", { type: "image/jpeg" })` answers 200 whose text holds `notas-privadas.jpg no es un tipo permitido`; no `submission_in_progress` row of the form has `notas-privadas` in `pending::text` or `files::text`; a following `GET` does not contain `notas-privadas`.
- "refuses a submission once the form is closed, even from a tab opened before": on page 5, close the form with `applyLifecycle(deps, { email: "editor@example.com", ip: "203.0.113.7" }, { formId, action: "close" })`, wait the minimum time, Submit with one photo → 303; the next `GET` holds `Este formulario está cerrado`; no submission is stored.
- "answers a repeated Submit with the same confirmation and one submission": on page 5, after the minimum time, two Submits of the same page HTML, each with one photo, in parallel → both 303; one submission; the `GET` holds `HP-0001`.
- "silently accepts a filled honeypot: the confirmation, and nothing stored": on page 5, after the minimum time, Submit with `"website-url": "https://spam.example"` and two photos; the `GET` matches `/Tu referencia: HP-\d{4}/`; no submission, media row or in-progress record of the form remains.
- "answers an unknown form with 404 and the not found screen": `GET /f/no-such-form` is 404 with `No encontramos este formulario`.

(Each test publishes its own form under a random slug, so tests never share references or records. The staging check in the first test counts files of every record; it runs first in the file, so the directory is empty before it.)

`tests/e2e/budgets.test.ts` (`scriptUrls(html)` collects every `<script src>` and every `<link rel="preload|modulepreload" as="script" href>`):
- "keeps every page's HTML under 30 KB and its scripts under 150 KB, compressed": for `page1` to `page4`, `GET` the page, keep its HTML and submit `{ _action: "next", ...pageAnswers(page) }` (expect 303), then keep page 5's HTML; each page's `gzipSync` length is under 30 KB; page 1 lists at least one script URL, and the summed `gzipSync` sizes of their bodies are under 150 KB.
- "renders page 1 in under 200 ms at the 95th percentile": five warm-up `GET`s, then 40 timed `GET`s of page 1 (body read); the sorted sample at index `floor(40 × 0.95) - 1` is under 200 ms.

`package.json`: add `"test:e2e": "vitest run --config vitest.e2e.config.ts"`.

- [ ] **Step 4: Run** `pnpm build && pnpm db:up && pnpm test:e2e`. The first run fails wherever the earlier tasks left a gap; fix the gap in the task that owns the code (with a failing unit test there first), never by loosening an e2e expectation. If the script budget fails, list the chunk sizes, find what pulled a large module into the client bundle (the copy tables, Zod, the form model) and move it server-side; the budget does not move.

- [ ] **Step 5: CI.** In `.github/workflows/ci.yml`, replace the `# the e2e job is added by the renderer plan` comment with:

```yaml
  e2e:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env: { POSTGRES_USER: effluz, POSTGRES_PASSWORD: effluz, POSTGRES_DB: postgres }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U effluz" --health-interval 5s --health-timeout 3s --health-retries 10
    env:
      TEST_DATABASE_ADMIN_URL: postgres://effluz:effluz@localhost:5432/postgres
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with: { node-version-file: .node-version, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm test:e2e --reporter=default --reporter=junit --outputFile=reports/e2e.xml
      - if: failure()
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with: { name: e2e-report, path: reports/ }
```

and add `e2e` to the `ci` job's `needs` and its result loop. In `specs/system/ci-cd.md`, "As built", replace "and `e2e` with the renderer plan" with: "`e2e` builds the app, starts it with `next start` against a throwaway database and temporary media directories, and drives the reference form over HTTP exactly as a browser without script does, plus the budgets of `ui-ux/renderer.md`."

- [ ] **Step 6: Run** `pnpm test:e2e` until green, then `pnpm test && pnpm test:integration && pnpm lint && pnpm typecheck && pnpm format:check` (at most three of these at once).
- [ ] **Step 7: Commit** `test(app): end-to-end reference form without script, failure paths and renderer budgets in CI`

---

### Task 30: End to end in a browser: the reference form on a phone with script (Playwright)

**Files:**
- Create: `playwright.config.ts`, `tests/browser/global-setup.ts`, `tests/browser/reference-form.spec.ts`
- Modify: `package.json`, `pnpm-lock.yaml` (`@playwright/test` as a dev dependency, `test:e2e:browser`), `.gitignore`, `.github/workflows/ci.yml` (job `e2e-browser`), `specs/system/ci-cd.md` ("As built")

**Interfaces:**
- Consumes: the built app; `createTestDatabase`, `startApp` (Task 29, `tests/support/`); `publishReferenceForm`, `pageAnswers` (`tests/e2e/publish.ts`); `syntheticJpegWithGps` (Task 5).
- Produces: `pnpm test:e2e:browser`, which runs `playwright test` against `next start` on port 3299 with a throwaway database; the CI job `e2e-browser`.

Decision (browser e2e, ADR 0024): Playwright with Chromium only, one phone project (`devices["Pixel 7"]`), one worker; the run counts as one heavy process on the developer machine, so start it only while at most two others run. The HTTP suite of Task 29 stays the script-disabled run and owns the budgets, which keep measuring the compressed client bundle.

- [ ] **Step 1: Dependency.** `pnpm add -D @playwright/test@^1.56`, then `pnpm exec playwright install chromium`. `package.json` scripts gain `"test:e2e:browser": "playwright test"`; `.gitignore` gains, under `# testing`, `/playwright-report/` and `/test-results/`.

- [ ] **Step 2: Config and setup.** `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

// Browser end-to-end run against the built app (`pnpm build` first). See ADR 0024 and specs/system/ci-cd.md.
export default defineConfig({
  testDir: "tests/browser",
  testMatch: "**/*.spec.ts",
  workers: 1,
  timeout: 120_000,
  globalSetup: "./tests/browser/global-setup.ts",
  reporter: process.env["CI"] ? [["list"], ["junit", { outputFile: "reports/e2e-browser.xml" }]] : "list",
  use: { baseURL: "http://127.0.0.1:3299", trace: "retain-on-failure" },
  projects: [{ name: "chromium-phone", use: { ...devices["Pixel 7"] } }],
});
```

`tests/browser/global-setup.ts`: `createTestDatabase()`, `startApp({ port: 3299, databaseUrl: db.url })`, `process.env["E2E_DATABASE_URL"] = db.url` (the test workers start after it and inherit it), and return the teardown that stops the app and drops the database.

- [ ] **Step 3: The browser test** `tests/browser/reference-form.spec.ts`. Helper `fillPage(page, answers)`: for each name and value, check `input[name="<name>"][value="<value>"]` when such a radio or checkbox exists, else `fill` `[name="<name>"]`.

```ts
test("completes the reference form on a phone with script: a blur check, focus, the offline banner, early uploads, Submit", async ({ page, context }) => {
  const pool = new pg.Pool({ connectionString: process.env["E2E_DATABASE_URL"], max: 2 });
  try {
    const { slug, formId } = await publishReferenceForm(pool);
    await page.goto(`/f/${slug}`);

    await page.locator('[name="email"]').fill("no-es-un-correo");
    await page.locator('[name="instagram"]').focus();
    await expect(page.locator("#email-error")).toHaveText("Escribe un correo válido, como nombre@ejemplo.com");
    await expect(page).toHaveURL(new RegExp(`/f/${slug}$`));

    for (const key of ["page1", "page2", "page3", "page4"]) {
      await fillPage(page, pageAnswers(key));
      await page.locator("[data-primary]").click();
      await expect(page.locator("[data-page-heading]")).toBeFocused();
    }
    await expect(page.getByText("Página 5 de 5")).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByText("Parece que no tienes conexión")).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText("Parece que no tienes conexión")).toBeHidden();

    const files = await Promise.all(
      [0, 1].map(async (i) => ({ name: `IMG_${String(i)}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(await syntheticJpegWithGps(64 + i, 48)) })),
    );
    await page.locator('input[type="file"][name="photos"]').setInputFiles(files);
    await expect(page.getByText("Subido", { exact: true })).toHaveCount(2);
    await expect(page.locator("#photos-count")).toHaveText("2 de 10 archivos");

    await fillPage(page, pageAnswers("page5"));
    await page.locator("[data-primary]").click();
    await expect(page.getByText("Tu referencia:")).toBeVisible();
    await expect(page.getByText("HP-0001")).toBeVisible();
    const { rows } = await pool.query<{ n: number }>("select count(*)::int as n from media where form_id = $1", [formId]);
    expect(rows[0]?.n).toBe(2);
  } finally {
    await pool.end();
  }
});
```

- [ ] **Step 4: Run** `pnpm build && pnpm db:up && pnpm test:e2e:browser`. A failure is fixed in the task that owns the behavior, with a failing unit test there first (the reducers of Task 26 for focus, offline and submitting; the upload queue for the rows), never by loosening this test.

- [ ] **Step 5: CI.** In `.github/workflows/ci.yml`, after the `e2e` job, add:

```yaml
  e2e-browser:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env: { POSTGRES_USER: effluz, POSTGRES_PASSWORD: effluz, POSTGRES_DB: postgres }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U effluz" --health-interval 5s --health-timeout 3s --health-retries 10
    env:
      TEST_DATABASE_ADMIN_URL: postgres://effluz:effluz@localhost:5432/postgres
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with: { node-version-file: .node-version, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm build
      - run: pnpm test:e2e:browser
      - if: failure()
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with: { name: e2e-browser-report, path: "reports/\ntest-results/" }
```

and add `e2e-browser` to the `ci` job's `needs` and its result loop. In `specs/system/ci-cd.md`, "As built", after the `e2e` sentence add: "`e2e-browser` installs Chromium with `playwright install --with-deps chromium`, builds the app and completes the reference form on a phone viewport with script enabled (ADR 0024)."

- [ ] **Step 6: Run** `pnpm lint && pnpm typecheck && pnpm format:check`, then `pnpm test:e2e:browser` once more alone.
- [ ] **Step 7: Commit** `test(app): the reference form in Chromium on a phone with script, in CI (ADR 0024)`

---

### Task 31: Full verification, spec sync and the pull request

**Files:**
- Modify: `README.md` (one line: the public forms live at `/f/<slug>`), any spec section whose wording no longer matches the code as built

- [ ] **Step 1: Verify everything**, no more than three heavy commands at once: `pnpm db:up`, then `pnpm test && pnpm lint && pnpm typecheck`, then `pnpm test:integration && pnpm format:check`, then `pnpm build && pnpm test:e2e`, then `pnpm test:e2e:browser` alone. All must pass.
- [ ] **Step 2: Spec sync.** Read, against the code: `specs/architecture.md` (modules and ports rows, the framework paragraph, data flow steps 2 and 3, technology rows), `specs/system/database.md` (the lock sentence, the four new or changed tables, column names as migrated), `specs/system/jobs.md` (registered handlers, `PermanentJobError`, `maxAttempts`, cleanup steps, delivery receipts), `specs/system/media-storage.md`, `specs/system/email.md`, `specs/system/security.md` (honeypot on every post, 3 seconds, cookie, per-submission size, CSP), `specs/ui-ux/renderer.md` (routes, the direct answer to refused posts, budget, copy rows), `specs/ui-ux/builder.md` (consent text), `specs/ui-ux/manager.md` (Settings note), `specs/use-cases/fill-and-submit-form.md` (step 5), ADRs 0002, 0008, 0016, 0023 to 0026. Fix any drift in the same branch with a `docs:` commit.
- [ ] **Step 3: Manual checks recorded for the PR.** Publish the reference form into the dev database and print its slug:

  ```bash
  pnpm db:up && pnpm exec tsx --env-file=.env src/app/cli/migrate.ts
  pnpm exec tsx --env-file=.env -e 'import pg from "pg"; import { publishReferenceForm } from "./tests/e2e/publish"; const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL }); publishReferenceForm(pool).then((r) => { console.log(r.slug); return pool.end(); });'
  ```

  With `pnpm dev` and `pnpm exec tsx --env-file=.env src/app/worker.ts` running against Mailpit and local media, open `http://localhost:3000/f/<slug>` and fill the reference form on a phone-sized window with script on (early uploads, Remove, a pre-checked oversized file, a refused file, the offline banner by toggling the network, Submit) and with script off (a refused file named in the answer, then gone after a reload); keyboard only; VoiceOver or NVDA on one page with an error; 400% zoom; reduced motion; DevTools with the "Slow 3G" profile, page 1 interactive under 3 seconds. Watch the worker move the files to `MEDIA_DURABLE_DIR` and the staff notification arrive in Mailpit (http://127.0.0.1:8025) with no answers in it. Note results, not screenshots of real data.
- [ ] **Step 4: Push and open the PR** against `main`, titled `feat: public renderer, submission intake, media and email jobs`, with a body that links the spec sections implemented (architecture.md "Submission data flow" 1 to 5, use-cases/fill-and-submit-form.md, ui-ux/renderer.md, system/media-storage.md, jobs.md, email.md, security.md "Public form abuse protection"), ADRs 0023 to 0026 and the ADR 0002, 0008 and 0016 amendments, the decisions list at the top of this plan, the spec additions that need review (the fifteen chrome rows, six singular catalog rows and `submission too large`, the staff notification table, `set.challenge_unavailable`, the routes table), the open question (the privacy footer left off the not-found screen), and what is deliberately absent: review, Operations and Audit pages, `email.staff_digest`, `retention.purge`, `backup.database`, the builder and header images, DeepL, the bot challenge, the proxy rate limit on form routes (deployment plan), and Firefox and WebKit in the browser run. End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] **Step 5: Confirm** the eight CI jobs pass (`lint`, `typecheck`, `unit`, `build`, `integration`, `e2e`, `e2e-browser`, `ci`). The controller merges.

---

## Self-review notes

- **Spec coverage.** architecture.md "Submission data flow": step 1 (Tasks 14, 18, 28), step 2 (Tasks 4, 7, 16, 19, 20), step 3 (Tasks 6, 11, 14, 21), step 4 (Tasks 21, 28), step 5 (Tasks 10, 11, 13, 27). use-cases/fill-and-submit-form.md: main flow 1 to 8 (Tasks 18 to 21, 24 to 28), step 5's checks on both sides (Tasks 20, 26); every alternate flow: not found, archived, outside the window or closed (Tasks 14, 18, 25), session expired with cleanup (Tasks 16, 21, 22, 27), a changed earlier answer (Task 21), republished mid-fill (Tasks 18, 21), upload failures (Tasks 7, 19, 20, 26), honeypot on every post and minimum time (Tasks 16, 21, 22, 29), duplicate submit (Tasks 18, 21, 22, 29); success criteria: ten files over a slow connection without losing progress (Tasks 19, 20, 29, 30), every rule's message localized and announced (Tasks 23, 24, 25), a closed form refusing an open tab (Tasks 22, 29), no orphans on intake failure (Task 22). ui-ux/renderer.md: layout, screens, field rendering table, file upload, validation and the message catalog, the direct answer to refused posts, navigation and state, accessibility notes, performance targets, fixed chrome copy, confirmation email fixed parts, routes, both e2e runs of "Test fixtures" (Tasks 12, 23 to 30). media-storage.md: the port, both adapters, keys, file handling rules, lifecycle (Tasks 5 to 10). jobs.md: the four handlers, idempotency, permanent failure, cleanup (Tasks 2, 10, 11, 21, 27). email.md: ports, templates, provider, local development (Tasks 11 to 13). security.md: abuse protection layers 2 to 5, the cookie, the per-submission size, staff-authored content, CSP (Tasks 3, 16, 20, 21, 28). database.md: four tables, the counter and the lock order (Tasks 8, 13, 14, 17, 21). builder.md consent row (Task 1). manager.md Settings note (Task 15). Not covered, by decision: review, staff digest, purge, backup, builder, header images, bot challenge, Firefox and WebKit.
- **Placeholder scan.** No "TBD" and no "similar to Task N" for a requirement. Named patterns are defined once and referenced by name: the probe pattern (Task 2, used in Tasks 6, 11, 18), the repository pattern (Task 8, used in Task 17) and the route handler pattern (Task 28). Case lists follow the convention in Global Constraints: every test keeps its name, inputs and expected results. Two choices are left to the implementer on purpose, each with the rule that decides it: a Prettier layout pass on the CSS (Task 25) and fixing e2e gaps in the owning task (Tasks 29, 30).
- **Type consistency.** `StagedFile` (media) and `StagedUpload` (submissions domain) are structural twins by design; `attachToSubmission` takes `StagedUpload` values as `StagedFile`. `FillState`, `PostOutcome` (with `refused`), `PagePost`, `OpenContext` are defined in Task 18 and used unchanged in Tasks 19 to 21 and 28. `RefusedFile` (Task 16) flows from `stageIncoming` (Task 19) through `PostOutcome` to `fileIssueMessage` (Task 23) and the action's `PageFormState` (Tasks 24, 28); `PendingPage` never holds one. `UploadRefusal` (Task 20) feeds `uploadRefusalMessage` (Task 23). Messages take `Pick<ValidationIssue, "code" | "params">`, so no production code builds an issue with a fabricated `Key`. `EmailRenderer` (Task 11) is satisfied by `emailTemplates` (Task 12), checked in Task 27. `MEDIA_JOB_TYPES` and `EMAIL_JOB_TYPES` name the job types in Tasks 6, 10, 11, 21, 27. `createCleanupHandler` takes `Pick<PgJobStore, "pruneSucceeded">` (Task 2), which lets Task 27 run the composed handler on a stub. `UploadField` and `PageEnhancer` are created before their first consumer (Tasks 24 and 25) and gain behavior in Task 26 without changing their props. `publishReferenceForm` passes the preview's `nextNumber` and `draftRevision` to `publishForm` (Task 29).
- **Review Focus tests pinned:** 1 in Task 21 ("completes against the pinned version after a republish"); 2 in Task 21 ("discards answers and files of a page hidden by a changed answer"); 3 in Task 22 ("refuses a submission when the form closes during the intake"); 4 in Task 7 (the sniffer's "ignores names and declared types" and the encoder's truncated-JPEG case), Task 20 and Task 22 ("refuses a lying, truncated or oversized file and stages nothing"); 5 in Task 21 ("treats an expired record as expired at submit") and Task 27 ("jobs.cleanup removes an expired record and its staged files, and stores no submission").
- **Known coupling to revisit.** The renderer's root layout and page share one `viewForm` through React's `cache`; if Next changes how layouts and pages share a request, the layout's `lang` read is the one to re-check. The page form relies on React 19 honouring `preventDefault` in `onSubmit` before a form action and on Next answering a Server Action posted without script with the re-rendered page; Tasks 29 and 30 exercise both paths against the built app. The blur check is a server round trip per field; at Effluz's scale that is cheap, and it keeps the client bundle free of the rules.
