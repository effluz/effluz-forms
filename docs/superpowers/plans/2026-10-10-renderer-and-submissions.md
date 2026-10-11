# Renderer and Submissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The public can open a published form at `/f/<slug>`, fill it page by page on a phone with or without JavaScript, upload photos and videos, and submit it; the submission, its media rows and its jobs are stored in one transaction, and the worker uploads the media to durable storage and sends the emails.

**Architecture:** Three new modules. `media` owns the `MediaStorage` port, the image pipeline (content sniffing, re-encoding with metadata stripped), the local disk and Dropbox adapters, the `media` table and the `media.upload` and `media.delete` handlers. `notifications` owns the `EmailSender` and `EmailRenderer` ports, the SMTP2GO and Mailpit adapters, delivery idempotency and the two email handlers; its templates live in `src/shared/presentation/email/` and are wired at the composition root. `submissions` owns the in-progress record, the intake transaction, the `submission` table, the real `SubmissionStats` adapter and the public renderer's presentation; it reaches forms and versions only through new read and reference-allocation use cases in `definitions`' public API. Pages are server components under `src/app/f/[slug]/` and every post is a route handler that answers with Post/Redirect/Get, so the whole flow works without script; small client components add early uploads, blur checks (answered by the server, so the browser never ships the rules), focus handling and offline waiting.

**Tech Stack:** Next.js 16 (App Router, route handlers, server components, Cache Components on), React 19, TypeScript strict, Zod 4, `pg` with hand-written SQL, Vitest, pino, and new: `sharp`, `libheif-js`, `file-type` (ADR 0023). Dropbox and SMTP2GO through plain `fetch`, no SDK.

**Spec:** `specs/architecture.md` ("Modules", "Ports", "Submission data flow" steps 1 to 5, "Configuration and secrets"), `specs/use-cases/fill-and-submit-form.md`, `specs/ui-ux/renderer.md` (all), `specs/form-definition.md` ("Field types in the first release", "Validation", "Conditional logic", "Submissions", "Privacy rules enforced by the model"), `specs/system/media-storage.md`, `specs/system/jobs.md`, `specs/system/email.md`, `specs/system/security.md` ("Public form abuse protection", "Staff-authored content", "Transport and headers"), `specs/system/database.md`, `specs/system/observability.md` ("Logging"), `specs/design.md`, `design-system/`, `specs/use-cases/reference-form-preemie-stories.md`, `specs/ui-ux/manager.md` ("Settings tab"), ADRs 0002, 0003, 0006, 0008, 0016, 0022.

Decisions taken with the project owner before writing (2026-10-10): this plan covers "Submission data flow" steps 1 to 5 with the three modules above, the renderer, the intake transaction, the four job handlers, a real `SubmissionStats` adapter and the `jobs.cleanup` extension; review, Operations, Audit, `email.staff_digest`, `retention.purge`, `backup.database`, the builder and DeepL are later plans. `sharp` with `libheif-js` re-encodes images and `file-type` sniffs content (ADR 0023); Dropbox and SMTP2GO go through `fetch`; local email goes to Mailpit; the enhancement layer is React client components with a 150 KB compressed budget; the bot challenge is not built (honeypot and minimum fill time only); bundle size and page weight are tested here.

Decisions taken in this plan (each is repeated, with its reason, in the task that applies it):

- **Reference sequence.** `form.next_reference` (migration `0008_form_reference_counter.sql`, owned by `definitions`), advanced by the exported use case `allocateReference(deps, uow, formId)` under the `form` row lock, which also re-checks that the form is open. `submissions` never writes a `definitions` table. Format `<prefix>-<nnnn>` (`formatReference`), at least four digits. (Task 14)
- **In-progress cookie.** Name `effluz_fill`, `Path=/f/<slug>`, `HttpOnly`, `SameSite=Lax`, `Max-Age=86400`, `Secure` in production. Its value is the record id while filling, `done.<submit token>` after a stored submission, and `decoy.<reference>` after a silent accept, so the browser's Back button lands on the confirmation. (Task 28)
- **Staging directory.** The existing `STAGING_DIR` variable; staged files live at `in-progress/<record id>/<file id>.<ext>` so an expired record's files go with one prefix delete. (Tasks 5, 21, 27)
- **Resolving `/f/<slug>`.** New `definitions` use cases `resolvePublicForm(deps, slug)`, `loadVersion(deps, versionId)` and `loadForm(deps, formId)`; `shareInfo` stays admin-only. (Task 14)
- **Media keys.** Durable key `forms/<form slug>/<reference>/<nn>-<field slug>.<ext>` with the field slug from the label in the form's first language (English first when bilingual), ASCII, at most 40 characters, `-2`, `-3` appended when two fields of one submission share a slug. Local refs are the key; Dropbox refs are `/` plus the key. (Tasks 5, 9, 21)
- **Minimum fill time.** 3 seconds from the page 1 render, carried in the hidden `_rendered` field of the first post, clamped to the last 24 hours, stored as `started_at`. An absent or unreadable value counts as the time of that first post. (Tasks 16, 21)
- **Honeypot.** An input named `website-url` (a hyphen, so it can never be a field key), off-screen, `aria-hidden`, `tabindex="-1"`, `autocomplete="off"`. (Tasks 16, 25)
- **`file_upload` answers.** The answer is the list of media ids (UUIDs, which `mediaIdSchema` accepts) in upload order; a media row's id is the staged file's id, so the answer, the row and the `media.upload` job payload name the same file. (Tasks 6, 20, 21)
- **Upload authentication.** The `effluz_fill` cookie names the record; the posted field key must be a visible `file_upload` field of the record's current page; `SameSite=Lax` keeps cross-site posts from carrying the cookie. (Task 20)
- **Blur validation.** The client asks `POST /f/<slug>/check`, which runs the form model on the server, so the browser applies exactly the server's rules without shipping Zod or the RE2 engine. (Tasks 19, 26, 28)
- **Templates and the sender.** `EmailSender.send` takes a rendered message; rendering is the `EmailRenderer` port, whose implementation is the template module in `src/shared/presentation/email/`, wired at the composition root (infrastructure may not import presentation). (Tasks 11, 12, 27)
- **Email idempotency.** A `notifications`-owned `email_delivery` table keyed by `<job type>:<submission id>` stores the provider message id; a retry that finds the key sends nothing. (Tasks 11, 13)
- **Local email.** Mailpit's HTTP send API at `MAILPIT_URL` (default `http://127.0.0.1:8025`), so the local adapter returns a message id like the real one. (Task 13)
- **Staff notification.** One `email.staff_notification` job per submission, sent as one message to the form's recipient list read at run time. (Tasks 11, 21)
- **Root layouts.** `src/app/layout.tsx` is replaced by one root layout per surface (`src/app/admin/layout.tsx`, `src/app/(home)/layout.tsx`, `src/app/f/[slug]/layout.tsx`) so the renderer's `<html lang>` follows the submitter's language. (Task 28)
- **Header image.** Not rendered in this plan: nothing can set one until the builder plan uploads it and adds its route. (Task 1 spec note)
- **E2E files.** The reference form allows at most ten files, so the e2e test first posts ten images and one video together (refused with `files_max`, nothing staged) and then nine images and the video (accepted). (Task 29)

## Global Constraints

- WCAG 2.2 AA: "Accessibility baseline is **WCAG 2.2 AA**, non-negotiable, for the public renderer and the admin surfaces alike." "Every input has a programmatic label. Errors are associated with their field and announced to assistive technology." "Color contrast meets AA. Information is never conveyed by color alone." "Respect reduced-motion preferences." "File upload has an accessible alternative path and clear status." (CLAUDE.md)
- Both languages: "Every staff-authored text has an **English and a Spanish** value" and "Fixed chrome of the builder, renderer and manager has no hardcoded user-facing strings. Its copy lives in the surface's UI/UX spec and is the single source for translations." Renderer copy is bound in `src/modules/submissions/presentation/copy.ts`, email copy in `src/shared/presentation/email/copy.ts`, each with a test that compares it to the spec rows.
- Staff-authored text: "Escaped on every render. The restricted rich-text subset allowed by `form-definition.md` is sanitized server-side with an allowlist; links must be `https` and open with `rel="noopener"`." (security.md)
- Synthetic data: "Never use real submissions or real PII in tests, fixtures, seeds, logs, screenshots, examples, docs, or commit messages. Generate synthetic data." Addresses use `example.com`, IPs `203.0.113.x`. Test images are generated in code; the one HEIC fixture is a generated solid-color image.
- Payloads: "Payloads hold identifiers, never personal data. An email job carries the submission id and looks the address up at run time." (jobs.md)
- Logs: "Logs and error messages must not contain answers, email addresses, file contents, or anything that identifies a submitter. Form and submission ids are fine." File names are never logged.
- Photos: "Validate type and size at the boundary, strip metadata, and store them only through the media port." "Verify type by content, not by extension or declared MIME type." "The original filename is never used." (CLAUDE.md, media-storage.md)
- Migrations: "A migration is a plain `.sql` file named `NNNN_<name>.sql`: four digits, then lowercase letters, digits and underscores." "One global sequence." The next free id is `0006`; this plan uses `0006_media.sql`, `0007_email_delivery.sql`, `0008_form_reference_counter.sql`, `0009_submissions.sql`.
- Lock discipline: "A use case opens at most one unit of work and never nests them." "Mutating use cases re-read the aggregate inside the unit of work with a row lock (`for update`) before writing, and decide again on the locked rows." The intake locks the in-progress row, then the form row (through `allocateReference`), always in that order.
- Framework boundary: "No React or Next.js import may appear in `domain/`, `application/`, or `infrastructure/`." Route handlers "parse input, call a use case, and map the result". Module edges are `MODULE_DEPS` in `eslint.config.mjs`: `media: []`, `notifications: []`, `submissions: ["definitions", "media", "notifications"]`.
- Performance (renderer.md, as changed in Task 1): HTML for a page, compressed, "under 30 KB"; script for enhancement, compressed, "under 150 KB for the renderer route's client bundle, loaded `defer`"; "First page interactive on a throttled 3G profile under 3 seconds"; "Server render of a page under 200 ms at the 95th percentile".
- Layout: "Single column, maximum content width 640 px, 16 px side gutters on phones"; "Touch targets at least 44 by 44 px"; "Minimum body text 16 px to prevent mobile zoom on focus". Values come from `design-system/tokens.json` only; each CSS value names its token in a comment.
- Every page works with script disabled: "Every page is a real HTML form that submits without JavaScript."
- TypeScript strict with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`; Conventional Commits scoped `docs`, `shared`, `form-model`, `media`, `notifications`, `definitions`, `submissions`, `app`, `ci`; `pnpm format:check`.
- Run at most three heavy processes (type checks, test suites, builds) at once on the developer machine.

## Review Focus

1. A version republished while someone is on page 3 must not change what they see or what is stored: the record stays on its pinned version and the submission records that version id (Task 21 unit test "completes against the pinned version after a republish").
2. Going back and changing an answer that hides a page the submitter already filled, including an upload field with staged files, must drop those answers and delete those staged files at submit (Task 21 unit test "discards answers and files of a page hidden by a changed answer").
3. A form closed between the last page load and the Submit click must refuse the submission with the closed screen and store nothing, even when the close commits while the intake waits on the form row lock (Task 22 integration test "refuses a submission when the form closes during the intake").
4. A file whose extension or declared type lies (an HTML file named `.jpg`, a PNG named `.heic`), a truncated JPEG, an MP4 with a broken box structure, or a body larger than the field allows must be refused with the specific message and leave nothing in staging (Task 7 adapter tests "ignores names and declared types" and "returns null for a truncated image, a PNG claimed as HEIC, and an unknown type", Task 20 unit test and Task 22 integration test, both "refuses a lying, truncated or oversized file and stages nothing").
5. A record that expired between the last page and Submit must show the expired screen, store no submission, and have its staged files removed by `jobs.cleanup` (Task 21 unit test "treats an expired record as expired at submit" and Task 22 integration test "jobs.cleanup removes expired records and their staged files").

---

## File structure

```
specs/...                                                   Task 1 edits, ADR 0023, ADR 0002 and 0016 amendments
src/shared/application/ports/job-queue.ts                   + maxAttempts in the context, PermanentJobError
src/shared/application/testing/fakes.ts                     + InMemoryJobQueue, RecordingLogger, handlerContext
src/shared/infrastructure/jobs/worker.ts                    dead at once on PermanentJobError, maxAttempts
src/shared/infrastructure/jobs/handlers/cleanup.ts          + cleanup steps
src/shared/domain/rich-text.ts                              the restricted markdown subset
src/shared/domain/form-model/submission.ts, visibility.ts   + validatePage, visiblePages
src/shared/domain/form-model/field-type.ts                  + uploadLimits hook (file_upload implements it)
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
              check-field.ts, upload-file.ts, submit-form.ts, expire.ts, index.ts, testing/fakes.ts
  infrastructure/migrations/0009_submissions.sql, pg-in-progress-repository.ts,
                 pg-submission-repository.ts, pg-submission-stats.ts, message-source.ts
  presentation/copy.ts, error-copy.ts, format.ts, messages.ts, decode.ts, field-views.ts,
               cookies.ts, http.ts, csp.ts, styles.ts, renderer.module.css, error-page.ts,
               fields/{types.ts,FieldShell.tsx,text.tsx,number.tsx,date.tsx,choice.tsx,checkbox.tsx,
                       consent.tsx,file-upload.tsx,section.tsx,index.ts},
               PublicShell.tsx, FormPage.tsx, ErrorSummary.tsx, Progress.tsx, Screens.tsx,
               client/{bus.ts,upload-queue.ts,form-dom.ts,UploadField.tsx,PageEnhancer.tsx}
src/app/config.ts, modules.ts, container.ts, worker.ts, worker-handlers.ts
src/app/layout.tsx (removed) -> src/app/admin/layout.tsx, src/app/(home)/{layout,page}.tsx
src/app/f/[slug]/layout.tsx, page.tsx, view.ts, not-found.tsx, error.tsx, _lib/respond.ts,
                answers/route.ts, files/route.ts, files/[fileId]/route.ts, check/route.ts, restart/route.ts
src/proxy.ts                                                + the renderer's CSP with a nonce on /f
next.config.ts                                              serverExternalPackages
tests/support/test-database.ts                              shared by integration and e2e setup
tests/fakes/media-files.ts, dropbox-api.ts, http-stub.ts
tests/fixtures/media/synthetic-16x16.heic
tests/integration/{jobs,media,notifications,definitions,submissions}/*.test.ts
tests/e2e/setup.ts, vitest.d.ts, http.ts, publish.ts, reference-form.test.ts, budgets.test.ts
vitest.e2e.config.ts, package.json (test:e2e), .github/workflows/ci.yml (+ e2e job)
```

---

### Task 1: Specs and ADRs first

**Files:**
- Modify: `specs/ui-ux/renderer.md`, `specs/system/security.md`, `specs/system/media-storage.md`, `specs/system/email.md`, `specs/system/jobs.md`, `specs/system/database.md`, `specs/architecture.md`, `specs/decisions/0002-dropbox-first-media-provider.md`
- Create: `specs/decisions/0023-image-processing.md`

**Interfaces:**
- Produces: the copy rows every later task binds (renderer chrome keys `switch_to_en`, `switch_to_es`, `wordmark`, `date_day`, `date_month`, `date_year`, `files_limits_videos`, `kinds_images`, `kinds_videos`, `kinds_mixed`, `file_row`, `removed`, `honeypot_label`, `error_summary_heading_one`, `files_count_one`; catalog rows `min length one`, `max length one`, `choice min one`, `choice max one`, `files min one`, `files max one`; the email table "Staff notification, fixed parts"), and the written decisions the code follows. The manager row `set.challenge_unavailable` arrives in Task 15.

This task changes documents only. Hand-wrap prose at 80 columns; table rows stay on one line.

- [ ] **Step 1: `specs/ui-ux/renderer.md`.**
  1. Performance targets: replace the script row with `| Script for enhancement, compressed | under 150 KB for the renderer route's client bundle, loaded \`defer\` |`, and add under the table: "The e2e suite measures the HTML of every page of the reference form and the sum of the compressed scripts the page loads, and fails above these budgets."
  2. "Validation and errors", **When.**, append: "With script, the field is checked by the server on blur (`POST /f/<slug>/check`), so the browser applies exactly the server's rules and ships none of them."
  3. "File upload", after the no-script paragraph, add: "Without script, each staged file is listed as `file_row` (the original name is not kept) with a Remove button that submits the page form with that file; the page re-renders with its answers kept. A post with more files than the field allows stages none of them and reports `files max`."
  4. "Closed, not yet open, not found", append: "These screens and Session expired show both languages, the page language first, since no language has been chosen. Not found has no privacy footer: without a form there is no retention period to state."
  5. "Layout", after the header image bullet, add: "First pass: no version can carry a header image until the builder uploads one, so the renderer leaves it out; it arrives with the builder plan."
  6. "Form page", after the bot challenge bullet, add: "First pass: the challenge is not built. A form with it enabled renders without it; the honeypot and the minimum fill time in `system/security.md` still apply."
  7. Add a section before "Test fixtures":

     ```markdown
     ## Routes

     | Route | What it is |
     |---|---|
     | `GET /f/<slug>` | The current screen: a form page, the confirmation, or a closed, not open, not found or expired screen (`?expired=1` asks for the expired screen) |
     | `POST /f/<slug>/answers` | The page form: Next, Back, Submit, a language switch or a Remove; always 303 back to `GET /f/<slug>` |
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
  9. Message catalog, append the singular forms the pluralization sentence requires:

     ```markdown
     | min length one | {label} must have at least {n} character | {label} debe tener al menos {n} carácter |
     | max length one | {label} must have no more than {n} character | {label} no debe tener más de {n} carácter |
     | choice min one | Select at least {n} option for {label} | Selecciona al menos {n} opción en {label} |
     | choice max one | Select no more than {n} option for {label} | Selecciona como máximo {n} opción en {label} |
     | files min one | Upload at least {n} file for {label} | Sube al menos {n} archivo en {label} |
     | files max one | You can upload up to {n} file for {label} | Puedes subir hasta {n} archivo en {label} |
     ```

     and change the pluralization sentence to: "Pluralization follows each language's rules: when `Intl.PluralRules` gives `one` for `{n}` (or `{count}`), the `… one` row is used, otherwise the plain row."

- [ ] **Step 2: `specs/system/security.md`**, "Public form abuse protection": replace items 2 to 4 with

  ```markdown
  2. **Honeypot field** hidden from humans: an input named `website-url`
     placed off-screen, `aria-hidden="true"`, `tabindex="-1"`,
     `autocomplete="off"`. A filled honeypot is a silent accept that stores
     nothing.
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

  Add a subsection after it:

  ```markdown
  ### In-progress cookie

  The renderer's only cookie is `effluz_fill`: `Path=/f/<slug>`, `HttpOnly`,
  `SameSite=Lax`, `Max-Age=86400`, plus `Secure` in production. While a form is
  being filled its value is the random id of the in-progress record; after a
  stored submission it is `done.<submit token>` and after a silent accept
  `decoy.<reference>`, so Back after Submit shows the confirmation again. It
  carries no answers. `SameSite=Lax` keeps cross-site posts from reaching the
  record, which is why the public routes need no CSRF token. A value that is
  none of these shapes is treated as absent.
  ```

  "Transport and headers": append "The renderer's pages (`/f/...`) get a per-request nonce from the proxy: `script-src 'self' 'nonce-<n>' 'strict-dynamic'` (plus `'unsafe-eval'` in development only), `style-src 'self' 'unsafe-inline'`, `img-src 'self' blob: data:`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`."

- [ ] **Step 3: `specs/system/media-storage.md`.** Under "The `MediaStorage` port", add: "`put` takes the bytes (files are capped at 10 MB, so no stream is needed) and is idempotent for the same key: Dropbox writes with `mode: overwrite`. The staging adapter adds two operations nothing else needs: `read(ref)` returns the bytes for the upload job, and `deletePrefix(prefix)` removes every file under a prefix." Under "Keys", add the staging scheme: "Staged files are named `in-progress/<record id>/<file id>.<ext>`: random ids only, so expiring a record removes its files with one prefix delete. Local refs are the key itself; Dropbox refs are the key with a leading `/` inside the App folder." Under "Adapters", add to each: Local disk: "`MEDIA_PROVIDER=local` (the default outside production) also uses local disk as the durable tier, rooted at `MEDIA_DURABLE_DIR` (default `./data/durable`); production refuses it." Dropbox: "`MEDIA_PROVIDER=dropbox` with `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` and `DROPBOX_REFRESH_TOKEN`. The adapter calls the HTTP API with `fetch` (no SDK): `oauth2/token` for the refresh-token exchange, `files/upload`, `files/get_metadata`, `files/delete_v2` and `files/get_temporary_link`. `DROPBOX_API_URL` and `DROPBOX_CONTENT_URL` exist so tests can point it at a local fake. A 401 renews the access token once; a 429 or 5xx fails the job so the job system retries it." Under "File handling rules", Images bullet, append: "JPEG, PNG and WebP are re-encoded to the same format with the EXIF orientation applied first; HEIC is decoded with `libheif-js` and encoded as JPEG (ADR 0023). Inputs above 50 megapixels are refused as unreadable." Videos bullet, append: "The container check walks the ISO base media file format boxes: the first box is `ftyp`, every box size fits the file, and a `moov` box is present."

- [ ] **Step 4: `specs/system/email.md`.** Replace "The `EmailSender` port" section with:

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
  the provider id in `email_delivery` under the key `<job type>:<submission
  id>` before the job succeeds. A retry that finds the key sends nothing. A
  submission that no longer exists, or no longer has an address, ends the job
  without sending.
  ```

  Add after "Templates":

  ```markdown
  ### Staff notification, fixed parts

  English only. `{date}` is the received time in the form's time zone,
  followed by UTC. `{link}` is the form's page in the manager.

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

  "Local development": replace the first sentence with "Mailpit runs in the dev Compose stack (SMTP on 127.0.0.1:1025, web and API on 127.0.0.1:8025). `EMAIL_PROVIDER=mailpit`, the default outside production, sends through Mailpit's HTTP API (`POST /api/v1/send` at `MAILPIT_URL`), which returns a message id like the real provider. Production refuses it and requires `EMAIL_PROVIDER=smtp2go` with `SMTP2GO_API_KEY`." Add under "Provider": "The adapter posts to `SMTP2GO_API_URL` (default `https://api.smtp2go.com/v3`) `/email/send`. Retryable: network errors, 401, 403, 429, 5xx. Permanent: a 400, or a 200 that reports the recipient failed."

- [ ] **Step 5: `specs/system/jobs.md`.**
  1. "The `JobQueue` port", handler paragraph: change the context list to "the job id, the attempt number, the job's `maxAttempts`, a logger already tagged with the job, and the unit of work, queue and clock ports", and replace "Only `jobs.cleanup` and `identity.cleanup` are registered so far…" with "Registered today: `jobs.cleanup`, `identity.cleanup`, `media.upload`, `media.delete`, `email.submitter_confirmation` and `email.staff_notification`."
  2. "Failure and retry", append: "A handler that throws `PermanentJobError` (from `src/shared/application/ports/job-queue.ts`) makes the job `dead` at once with its message, for failures a retry cannot fix, such as an email address the provider rejects."
  3. "Handler rules", replace the Idempotent bullet with: "**Idempotent.** A handler may run twice. Uploads `put` by key, which overwrites, and record the reference before deleting the staging copy; emails record the provider message id in `email_delivery` and skip a key already recorded."
  4. "Recurring jobs", replace "removing expired in-progress submission records (older than 24 hours) and their staged files joins it when `submissions` exists" with "it also removes in-progress submission records past their 24 hours, their staged files first, through cleanup steps the worker's composition root passes in, so `shared` never imports `submissions`".
  5. Job types table: `media.upload` effect "Staging to durable storage, media row to `stored` with its reference, staging copy deleted; on the last attempt the row becomes `failed` and staging is kept"; `media.delete` "Remove the durable file, the staging copy and the media row, in that order". Payloads: add a sentence under the table: "Payloads: `media.*` carry `{ mediaId }`, `email.*` carry `{ submissionId }`."

- [ ] **Step 6: `specs/system/database.md`**, core tables:
  - `form`: append "`next_reference` (integer, starts at 1): the sequence of submission references, advanced only by `allocateReference` under the form row lock".
  - Replace the `submission_in_progress` row with: "`submission_in_progress` | `submissions` | `id` (the random value of the `effluz_fill` cookie), `form_id`, `form_version_id` (the pinned version), `locale`, `page_key`, `answers` (jsonb, only valid answers), `files` (jsonb, staged files per field key), `pending` (jsonb, the last refused post's values and issues, or null), `submit_token` (uuid), `started_at`, `expires_at` (24 hours after creation). Personal data; deleted at submit or by `jobs.cleanup` after expiry."
  - Replace the `submission` row with: "`submission` | `submissions` | `form_id`, `form_version_id`, `locale`, `answers` (jsonb, **immutable after insert**: the trigger `submission_answers_immutable` rejects an update that changes it), `consent` (jsonb), `received_at`, `reference` (unique per form, `submission_form_reference_key`), `submit_token` (unique, `submission_submit_token_key`, so a repeated Submit finds the first submission), `status` (`new`, `viewed`, `edited`, `published`; default `new`), `curated_answers` (jsonb, default `{}`), `published_post_url`, `status_changed_by`, `status_changed_at`".
  - Replace the `media` row with: "`media` | `media` | `submission_id`, `form_id`, `field_key`, `position` (1-based within the field), `kind` (`image`, `video`), `status` (`staged`, `stored`, `failed`), `content_type`, `size`, `staging_ref` (null once the staging copy is gone), `durable_key`, `provider_ref` (null until stored). No foreign key to `submission`: deletion goes through `media.delete` so a provider outage cannot leave a row pointing at nothing."
  - Add a row: "`email_delivery` | `notifications` | `delivery_key` (unique: `<job type>:<submission id>`), `provider_message_id`. Lets a retried email job see the message was sent."
  - Indexes: add "`submission_in_progress (expires_at)` for cleanup; the unique `media (submission_id, field_key, position)`, which also serves lookups by submission".

- [ ] **Step 7: `specs/architecture.md`.**
  - Ports table: `MediaStorage` row responsibility gains "; staging adds read and prefix delete"; `EmailSender` row becomes "Send one rendered transactional message | SMTP2GO (Mailpit locally)"; add a row `| EmailRenderer | Render the two messages from their data; the implementation is the template module in src/shared/presentation/email | Templates, wired at the composition root | system/email.md |`; add `| MessageSource | The data an email job needs, looked up at run time from a submission id. Owned by notifications, implemented by submissions | Postgres (submissions) | system/email.md |`; the `SubmissionStats` row's first adapter becomes "Postgres, supplied by `submissions` (`PgSubmissionStats`)".
  - Ports paragraph about repositories: append "`submissions` also owns `submission_in_progress`. `definitions` exports read use cases for the renderer (`resolvePublicForm`, `loadVersion`, `loadForm`) and `allocateReference`, so `submissions` never reads or writes `definitions` tables."
  - "Submission data flow" step 2: replace "Photos are written to the local staging directory under random names with metadata (EXIF, including GPS) stripped." with "Photos are re-encoded with metadata (EXIF, including GPS) stripped and written to the local staging directory under `in-progress/<record id>/<file id>.<ext>`."
  - Technology decisions: add `| Image processing | sharp, with libheif-js for HEIC; file-type for content sniffing | accepted | decisions/0023 |`.
  - "Where the framework is allowed": append "The renderer's posts are route handlers under `src/app/f/[slug]/`, each a thin Post/Redirect/Get."

- [ ] **Step 8: `specs/ui-ux/manager.md`** changes in Task 15, with the code that binds its new copy row, so the manager copy test (`src/shared/presentation/copy.test.ts`) never sees a spec row without a binding.

- [ ] **Step 9: ADR 0002**, Consequences, append: "- The Dropbox adapter calls the HTTP API with `fetch` and no SDK: five endpoints and the refresh-token exchange are less code to review than an SDK's surface, and a local fake server can stand in for Dropbox in tests. Adopting the SDK later is an adapter change."

- [ ] **Step 10: Create `specs/decisions/0023-image-processing.md`:**

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

- [ ] **Step 11: Check** `pnpm format:check` and re-read each edited section once against the decisions list at the top of this plan.
- [ ] **Step 12: Commit**

  ```bash
  git add specs
  git commit -m "docs: specify the renderer routes, copy additions, abuse protection, media and email ports, ADR 0023

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

---
### Task 2: Shared job plumbing: permanent failures, attempt limits, cleanup steps, fakes

**Files:**
- Modify: `src/shared/application/ports/job-queue.ts`, `src/shared/infrastructure/jobs/worker.ts`, `src/shared/infrastructure/jobs/handlers/cleanup.ts`, `src/shared/application/testing/fakes.ts`
- Test: `tests/integration/jobs/worker.test.ts` (two new cases), `tests/integration/jobs/cleanup.test.ts` (new), `src/shared/application/testing/fakes.test.ts` (new)

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
export class PermanentJobError extends Error {}

// handlers/cleanup.ts
export type CleanupStep = (ctx: JobHandlerContext) => Promise<void>;
export function createCleanupHandler(store: PgJobStore, steps?: readonly CleanupStep[]): JobHandler;

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

- [ ] **Step 1: Failing tests.** Append to `tests/integration/jobs/worker.test.ts`, inside `describe("Worker")`, and add `PermanentJobError` to the existing `@/shared/application/ports/job-queue` import:

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
import { beforeEach, describe, expect, it } from "vitest";
import type { JobHandlerContext } from "@/shared/application/ports/job-queue";
import { handlerContext } from "@/shared/application/testing/fakes";
import { createCleanupHandler } from "@/shared/infrastructure/jobs/handlers/cleanup";
import { PgJobStore } from "@/shared/infrastructure/jobs/pg-job-store";
import { testPool, truncateAll } from "../db";

describe("jobs.cleanup", () => {
  const pool = testPool();
  const clock = { now: () => new Date("2026-10-10T12:00:00Z") };
  const store = new PgJobStore(pool, clock, { leaseSeconds: 60 });
  beforeEach(() => truncateAll(pool));

  it("runs every cleanup step after pruning, in order, with the job's context", async () => {
    const order: string[] = [];
    const ctx = handlerContext();
    const handler = createCleanupHandler(store, [
      (c: JobHandlerContext) => {
        order.push(`a:${c.jobId}`);
        return Promise.resolve();
      },
      () => {
        order.push("b");
        return Promise.resolve();
      },
    ]);
    await handler({}, ctx);
    expect(order).toEqual([`a:${ctx.jobId}`, "b"]);
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
    await expect(handler({}, handlerContext())).rejects.toThrow("step failed");
    expect(ran).toEqual(["second"]);
  });
});
```

Create `src/shared/application/testing/fakes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FakeUnitOfWorkFactory, InMemoryJobQueue, RecordingLogger } from "./fakes";

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

- [ ] **Step 2: Run** `pnpm test src/shared/application` and `pnpm db:up && pnpm test:integration tests/integration/jobs`; the new cases fail (missing exports, `maxAttempts` undefined, the job is `failed` instead of `dead`).

- [ ] **Step 3: Implement.** `job-queue.ts`: add `maxAttempts` to `JobHandlerContext` and

```ts
/**
 * Thrown by a handler for a failure no retry can fix, such as an address the
 * email provider rejects. The worker marks the job dead at once with this
 * message. See specs/system/jobs.md, "Failure and retry".
 */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}
```

`worker.ts`: import `PermanentJobError` as a value; in `run()`, add `maxAttempts: job.maxAttempts` to `ctx` and replace the inner `catch (e)` around the handler call with:

```ts
      } catch (e) {
        if (e instanceof PermanentJobError) {
          const outcome = await store.markDead(job, workerId, e.message);
          if (outcome === "lost") log.warn("lease lost");
          else log.error("job failed permanently", { outcome });
          return;
        }
        const outcome = await store.fail(job, workerId, e instanceof Error ? e.message : String(e));
        if (outcome === "lost") log.warn("lease lost");
        else if (outcome === "dead") log.error("job failed", { outcome });
        else log.warn("job failed", { outcome });
        return;
      }
```

`handlers/cleanup.ts`:

```ts
import type { JobHandler, JobHandlerContext } from "@/shared/application/ports/job-queue";
import type { PgJobStore } from "../pg-job-store";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Housekeeping another module contributes, passed in by the worker's composition root. */
export type CleanupStep = (ctx: JobHandlerContext) => Promise<void>;

/**
 * `jobs.cleanup`: prunes succeeded jobs older than 30 days, then runs each
 * cleanup step. Every step runs even when an earlier one fails; the first
 * failure then fails the job, which is retried. See specs/system/jobs.md,
 * "Recurring jobs".
 */
export function createCleanupHandler(
  store: PgJobStore,
  steps: readonly CleanupStep[] = [],
): JobHandler {
  return async (_payload, ctx) => {
    const pruned = await store.pruneSucceeded(new Date(ctx.clock.now().getTime() - RETENTION_MS));
    ctx.logger.info("pruned succeeded jobs", { pruned });
    let failure: unknown = null;
    for (const step of steps) {
      try {
        await step(ctx);
      } catch (e) {
        failure ??= e;
      }
    }
    if (failure !== null) throw failure;
  };
}
```

Append to `src/shared/application/testing/fakes.ts`, merging the type imports into its import block and naming the three new fakes in the file header:

```ts
import type { EnqueueOptions, JobHandlerContext, JobPayload, JobQueue } from "../ports/job-queue";
import type { LogFields, Logger } from "../ports/logger";

export interface EnqueuedJob {
  type: string;
  payload: JobPayload;
  opts: EnqueueOptions;
}

export class InMemoryJobQueue implements JobQueue {
  readonly enqueued: EnqueuedJob[] = [];
  failAt: number | null = null;
  private calls = 0;

  enqueue(
    _uow: UnitOfWork,
    type: string,
    payload: JobPayload,
    opts: EnqueueOptions = {},
  ): Promise<string | null> {
    const index = this.calls++;
    if (this.failAt === index) return Promise.reject(new Error("injected enqueue failure"));
    const key = opts.uniqueKey;
    if (key !== undefined && this.enqueued.some((j) => j.opts.uniqueKey === key)) {
      return Promise.resolve(null);
    }
    this.enqueued.push({ type, payload: { ...payload }, opts: { ...opts } });
    return Promise.resolve(`job-${String(this.enqueued.length)}`);
  }

  ofType(type: string): EnqueuedJob[] {
    return this.enqueued.filter((j) => j.type === type);
  }
}

export interface LoggedLine {
  level: "debug" | "info" | "warn" | "error";
  msg: string;
  fields: LogFields;
}

export class RecordingLogger implements Logger {
  constructor(
    readonly lines: LoggedLine[] = [],
    private readonly base: LogFields = {},
  ) {}

  private write(level: LoggedLine["level"], msg: string, fields: LogFields = {}): void {
    this.lines.push({ level, msg, fields: { ...this.base, ...fields } });
  }
  debug(msg: string, fields?: LogFields): void {
    this.write("debug", msg, fields);
  }
  info(msg: string, fields?: LogFields): void {
    this.write("info", msg, fields);
  }
  warn(msg: string, fields?: LogFields): void {
    this.write("warn", msg, fields);
  }
  error(msg: string, fields?: LogFields): void {
    this.write("error", msg, fields);
  }
  child(fields: LogFields): Logger {
    return new RecordingLogger(this.lines, { ...this.base, ...fields });
  }
}

/** A handler context built from fakes, for unit tests of job handlers. */
export function handlerContext(over: Partial<JobHandlerContext> = {}): JobHandlerContext {
  return {
    jobId: "job-under-test",
    attempt: 1,
    maxAttempts: 8,
    logger: new RecordingLogger(),
    uow: new FakeUnitOfWorkFactory(),
    queue: new InMemoryJobQueue(),
    clock: new FixedClock(),
    ...over,
  };
}
```

- [ ] **Step 4: Run** `pnpm test && pnpm test:integration tests/integration/jobs && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(shared): permanent job failures, attempt limits in the handler context, cleanup steps and job fakes`

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

The syntax is `specs/ui-ux/builder.md`, "Markdown inputs": `**bold**`, `_italic_`, lines starting with `- `, lines starting with `1. `, `[text](https://…)`. A blank line separates paragraphs; a single newline is a line break. Anything else renders literally. The parser never yields markup, and both renderers escape every text node. Consent text is not in the subset (`form-definition.md` names four places); `specs/ui-ux/builder.md` calls it a markdown pair, a contradiction this plan reports instead of resolving, and the renderer shows consent text as plain paragraphs.

- [ ] **Step 1: Failing tests.** `src/shared/domain/rich-text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseRichText, richTextToPlain } from "./rich-text";

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
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseRichText } from "@/shared/domain/rich-text";
import { RichText } from "./RichText";
import { escapeHtml, richTextToHtml } from "./rich-text-html";

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

- [ ] **Step 3: Implement** `src/shared/domain/rich-text.ts`:

```ts
/**
 * The restricted rich-text subset of page descriptions, field help, section
 * descriptions and confirmation copy (specs/form-definition.md, "Text and
 * languages"; syntax in specs/ui-ux/builder.md, "Markdown inputs"). Parsing
 * never yields markup: renderers escape every text node.
 */
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

const BULLET = /^- (.*)$/;
const NUMBERED = /^\d{1,3}\. (.*)$/;
const LINK = /^\[([^\][]+)\]\((https:\/\/[^\s()]+)\)/;
const WORD = /[\p{L}\p{N}]/u;

function isHttps(href: string): boolean {
  try {
    return new URL(href).protocol === "https:";
  } catch {
    return false;
  }
}

function pushText(out: Inline[], text: string): void {
  const last = out[out.length - 1];
  if (last?.kind === "text") last.text += text;
  else out.push({ kind: "text", text });
}

/** Inline markers. `links: false` inside a link, so links never nest. */
function parseInline(text: string, links = true): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        out.push({ kind: "bold", children: parseInline(text.slice(i + 2, end), links) });
        i = end + 2;
        continue;
      }
    }
    // Underscores inside words (snake_case) stay literal.
    if (text[i] === "_" && !WORD.test(text[i - 1] ?? "")) {
      let end = text.indexOf("_", i + 1);
      while (end !== -1 && WORD.test(text[end + 1] ?? "")) end = text.indexOf("_", end + 1);
      if (end > i + 1) {
        out.push({ kind: "italic", children: parseInline(text.slice(i + 1, end), links) });
        i = end + 1;
        continue;
      }
    }
    if (links && text[i] === "[") {
      const match = LINK.exec(text.slice(i));
      if (match?.[1] !== undefined && match[2] !== undefined && isHttps(match[2])) {
        out.push({ kind: "link", href: match[2], children: parseInline(match[1], false) });
        i += match[0].length;
        continue;
      }
    }
    pushText(out, text.charAt(i));
    i += 1;
  }
  return out;
}

function joinLines(lines: readonly string[]): Inline[] {
  return lines.flatMap((line, index) =>
    index === 0 ? parseInline(line) : [{ kind: "break" as const }, ...parseInline(line)],
  );
}

export function parseRichText(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { kind: "bullets" | "numbers"; items: string[] } | null = null;
  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", children: joinLines(paragraph) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: list.kind, items: list.items.map((item) => parseInline(item)) });
    list = null;
  };
  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet?.[1] ?? numbered?.[1];
    if (item !== undefined) {
      flushParagraph();
      const kind = bullet ? "bullets" : "numbers";
      if (list !== null && list.kind !== kind) flushList();
      list ??= { kind, items: [] };
      list.items.push(item);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

function inlineToPlain(nodes: readonly Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case "text":
          return n.text;
        case "break":
          return "\n";
        case "link":
          return `${inlineToPlain(n.children)} (${n.href})`;
        default:
          return inlineToPlain(n.children);
      }
    })
    .join("");
}

/** The plain-text email body: the same words, lists with markers, links with addresses. */
export function richTextToPlain(blocks: readonly Block[]): string {
  return blocks
    .map((b) => {
      if (b.kind === "paragraph") return inlineToPlain(b.children);
      return b.items
        .map((item, i) => `${b.kind === "bullets" ? "-" : `${String(i + 1)}.`} ${inlineToPlain(item)}`)
        .join("\n");
    })
    .join("\n\n");
}
```

`src/shared/presentation/RichText.tsx`:

```tsx
import type { ReactNode } from "react";
import { parseRichText, type Block, type Inline } from "@/shared/domain/rich-text";

function inline(nodes: readonly Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case "text":
        return n.text;
      case "break":
        return <br key={i} />;
      case "bold":
        return <strong key={i}>{inline(n.children)}</strong>;
      case "italic":
        return <em key={i}>{inline(n.children)}</em>;
      case "link":
        // Staff-authored links open in a new tab; design-system/components.md, "Link".
        return (
          <a key={i} href={n.href} target="_blank" rel="noopener">
            {inline(n.children)}
          </a>
        );
    }
  });
}

function block(b: Block, key: number): ReactNode {
  if (b.kind === "paragraph") return <p key={key}>{inline(b.children)}</p>;
  const items = b.items.map((item, i) => <li key={i}>{inline(item)}</li>);
  return b.kind === "bullets" ? <ul key={key}>{items}</ul> : <ol key={key}>{items}</ol>;
}

/** Already-parsed blocks, for callers that place the first block elsewhere (a heading). */
export function RichBlocks({ blocks, className }: { blocks: readonly Block[]; className?: string | undefined }) {
  return <div className={className}>{blocks.map(block)}</div>;
}

/** Staff-authored rich text from the restricted subset; React escapes every text node. */
export function RichText({ source, className }: { source: string; className?: string | undefined }) {
  return <RichBlocks blocks={parseRichText(source)} className={className} />;
}
```

`src/shared/presentation/rich-text-html.ts`:

```ts
import type { Block, Inline } from "@/shared/domain/rich-text";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inline(nodes: readonly Inline[], style: { link: string }): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case "text":
          return escapeHtml(n.text);
        case "break":
          return "<br>";
        case "bold":
          return `<strong>${inline(n.children, style)}</strong>`;
        case "italic":
          return `<em>${inline(n.children, style)}</em>`;
        case "link":
          return `<a href="${escapeHtml(n.href)}" style="${style.link}">${inline(n.children, style)}</a>`;
      }
    })
    .join("");
}

/** Inline-styled HTML for email bodies. The styles are fixed strings, never staff input. */
export function richTextToHtml(
  blocks: readonly Block[],
  style: { link: string; paragraph: string },
): string {
  return blocks
    .map((b) => {
      if (b.kind === "paragraph") {
        return `<p style="${style.paragraph}">${inline(b.children, style)}</p>`;
      }
      const tag = b.kind === "bullets" ? "ul" : "ol";
      const items = b.items.map((item) => `<li>${inline(item, style)}</li>`).join("");
      return `<${tag} style="${style.paragraph}">${items}</${tag}>`;
    })
    .join("");
}
```

Append to `spec-copy.ts`:

```ts
/**
 * The rows of the first table under `heading` (levels ## to ####), keyed by
 * the first cell, the other cells in order. Test-only, like `specCopyRows`,
 * for tables whose keys are not `group.key` names.
 */
export function specTableRows(specPath: string, heading: string): Map<string, string[]> {
  const lines = readFileSync(path.resolve(REPO_ROOT, specPath), "utf8").split("\n");
  const start = lines.findIndex(
    (l) => /^#{2,4} /.test(l) && l.replace(/^#+ /, "").trim() === heading,
  );
  if (start === -1) throw new Error(`No heading "${heading}" in ${specPath}`);
  const rows = new Map<string, string[]>();
  let seenHeader = false;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,4} /.test(line)) break;
    if (!line.startsWith("|")) {
      if (seenHeader) break;
      continue;
    }
    if (!seenHeader) {
      seenHeader = true;
      continue;
    }
    if (/^\|[\s|:-]+\|$/.test(line)) continue;
    const [key, ...rest] = line.split("|").slice(1, -1).map((c) => c.trim());
    if (key !== undefined) rows.set(key, rest);
  }
  return rows;
}
```

- [ ] **Step 4: Run** `pnpm test src/shared && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(shared): restricted rich-text subset with React and email renderings, spec table reader`

---

### Task 4: Page-scoped validation, visible pages and upload limits in the form model

**Files:**
- Modify: `src/shared/domain/form-model/submission.ts`, `src/shared/domain/form-model/visibility.ts`, `src/shared/domain/form-model/field-type.ts`, `src/shared/domain/form-model/field-types/file-upload.ts`, `src/shared/domain/form-model/index.ts`, `specs/decisions/0016-field-type-hooks.md`
- Test: `src/shared/domain/form-model/page-validation.test.ts` (new)

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

- [ ] **Step 1: Failing test** `src/shared/domain/form-model/page-validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildDefaultRegistry, parseDraft, validatePage, visiblePages, type Version } from "./index";

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

- [ ] **Step 2: Run** `pnpm test src/shared/domain/form-model/page-validation.test.ts`: fails on the missing exports.

- [ ] **Step 3: Implement.** In `submission.ts`, below `validateSubmission` (it reuses the module's private `issuesFor`, `isAbsent` and `evaluateCondition`):

```ts
export interface PageValidation {
  answers: Record<string, unknown>;
  issues: ValidationIssue[];
}

/**
 * One page's validation for Next, Back and the language switch. Earlier
 * pages' stored answers only feed the conditions: they were validated when
 * their page was posted, and Submit validates the whole submission again
 * with `validateSubmission`. See specs/ui-ux/renderer.md, "Navigation and state".
 */
export function validatePage(
  version: Version,
  registry: FieldTypeRegistry,
  body: Readonly<Record<string, unknown>>,
  pageKey: string,
  ctx: SubmissionContext,
  opts: { enforceRequired: boolean },
): PageValidation {
  const known: Record<string, unknown> = {};
  for (const page of version.pages) {
    const isTarget = page.key === pageKey;
    const pageVisible = page.visibility ? evaluateCondition(page.visibility, known) : true;
    const answers: Record<string, unknown> = {};
    const issues: ValidationIssue[] = [];
    for (const field of page.fields) {
      const def = registry.get(field.type);
      if (!def.isInput) continue;
      const visible =
        def.neverHidden === true ||
        (pageVisible && (field.visibility ? evaluateCondition(field.visibility, known) : true));
      if (!visible) continue;
      const own = Object.hasOwn(body, field.key) ? body[field.key] : undefined;
      if (!isTarget) {
        if (own !== undefined) known[field.key] = own;
        continue;
      }
      if (!opts.enforceRequired && isAbsent(own)) continue;
      const result = issuesFor(field, registry, own, ctx);
      issues.push(...result.issues);
      if (result.issues.length === 0 && result.normalized !== undefined) {
        answers[field.key] = result.normalized;
        known[field.key] = result.normalized;
      }
    }
    if (isTarget) return { answers, issues };
  }
  return { answers: {}, issues: [] };
}
```

In `visibility.ts`:

```ts
/** The pages conditions show for these answers, in document order. */
export function visiblePages(
  version: Version,
  answers: Readonly<Record<string, unknown>>,
  registry: FieldTypeRegistry,
): Version["pages"] {
  const { pages } = evaluateVisibility(version, answers, registry);
  return version.pages.filter((p) => pages.get(p.key) === true);
}
```

In `field-type.ts`, export `UploadLimits` and add to `FieldTypeDefinition`, among the optional hooks:

```ts
  /** The field takes files: accepted kinds and limits, read by the renderer and the intake. */
  uploadLimits?(settings: S): UploadLimits;
```

In `field-types/file-upload.ts`, add `uploadLimits: (s) => ({ kinds: s.kinds, maxFiles: s.maxFiles, maxSizeMb: s.maxSizeMb }),` to the definition. In `specs/decisions/0016-field-type-hooks.md`, add under the header: "Amended 2026-10-10: an optional `uploadLimits(settings)` hook names the fields that take files and their limits, so the renderer and the intake never test a type id".

In `index.ts`: `export { validateSubmission, validatePage, isAbsent } from "./submission";`, `export type { SubmissionContext, SubmissionResult, PageValidation } from "./submission";`, `export { evaluateVisibility, visiblePages } from "./visibility";` and add `UploadLimits` to the `./field-type` type export.

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

- [ ] **Step 1: Dependencies and fixture.** `pnpm add sharp@^0.34 libheif-js@^1.19 file-type@^21`. Generate the HEIC fixture once (it is a solid-color square, not media anyone uploaded): `magick -size 16x16 xc:#6C344E /tmp/s.png && heif-enc -q 50 /tmp/s.png -o tests/fixtures/media/synthetic-16x16.heic` (`brew install imagemagick libheif` provides both tools). Confirm `file tests/fixtures/media/synthetic-16x16.heic` reports HEIF.

- [ ] **Step 2: Test support** `tests/fakes/media-files.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ascii = (s: string) => new TextEncoder().encode(s);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** One ISO base media box: 32-bit size, four-character type, body. */
export function box(type: string, body: Uint8Array = new Uint8Array()): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(ascii(type), 4);
  out.set(body, 8);
  return out;
}

/** A minimal MP4 (QuickTime with brand "qt  "): ftyp, moov holding an mvhd, and mdat. */
export function syntheticMp4(brand = "isom"): Uint8Array {
  const ftyp = box("ftyp", concat(ascii(brand), new Uint8Array(4), ascii(brand), ascii("mp41")));
  return concat(ftyp, box("moov", box("mvhd", new Uint8Array(100))), box("mdat", new Uint8Array(900)));
}

/** The ftyp box claims 4 KB in a file of about one. */
export function brokenMp4(): Uint8Array {
  const file = syntheticMp4();
  new DataView(file.buffer).setUint32(0, 4096);
  return file;
}

/** A noisy JPEG carrying a copyright and a GPS position, so stripping is observable. */
export async function syntheticJpegWithGps(width = 64, height = 48): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width, height, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 30 } },
  })
    .jpeg()
    .withExif({
      IFD0: { Copyright: "synthetic test image" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "8/1 58/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "79/1 31/1 0/1" },
    })
    .toBuffer();
  return new Uint8Array(buffer);
}

export async function syntheticPng(): Promise<Uint8Array> {
  const image = sharp({ create: { width: 16, height: 16, channels: 4, background: "#6C344E" } });
  return new Uint8Array(await image.png().toBuffer());
}

export async function syntheticWebp(): Promise<Uint8Array> {
  const image = sharp({ create: { width: 16, height: 16, channels: 3, background: "#372549" } });
  return new Uint8Array(await image.webp().toBuffer());
}

/**
 * A generated 16x16 solid-color HEIC, committed because nothing in the
 * toolchain encodes HEIC: `magick -size 16x16 xc:#6C344E s.png && heif-enc
 * -q 50 s.png -o tests/fixtures/media/synthetic-16x16.heic`.
 */
export function syntheticHeic(): Uint8Array {
  return new Uint8Array(readFileSync(path.join(__dirname, "../fixtures/media/synthetic-16x16.heic")));
}

export function htmlPretendingToBeJpeg(): Uint8Array {
  return ascii("<!doctype html><title>not a photo</title>");
}
```

- [ ] **Step 3: Failing tests.** `src/modules/media/domain/keys.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { durableKey, fieldSlug, stagingKey, stagingPrefix, uniqueFieldSlugs } from "./keys";

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

`media.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { acceptedType, extensionFor } from "./media";

describe("acceptedType and extensionFor", () => {
  it("accept the documented types only", () => {
    expect(acceptedType("image/heif")).toBe("image/heif");
    expect(acceptedType("video/quicktime")).toBe("video/quicktime");
    expect(acceptedType("image/gif")).toBeNull();
    expect(acceptedType(null)).toBeNull();
  });

  it("name each type's extension, HEIF as heic", () => {
    expect(extensionFor("image/heif")).toBe("heic");
    expect(extensionFor("video/quicktime")).toBe("mov");
    expect(() => extensionFor("text/html")).toThrow();
  });
});
```

`iso-bmff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { box, brokenMp4, syntheticMp4 } from "../../../../tests/fakes/media-files";
import { isWellFormedIsoBmff } from "./iso-bmff";

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

(Tests may import test helpers; the boundaries rules cover `src/` code, and tests are not production code.)

- [ ] **Step 4: Run** `pnpm test src/modules/media`: fails, the modules do not exist.

- [ ] **Step 5: Implement** `media.ts`:

```ts
export const MEDIA_KINDS = ["image", "video"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Types accepted by content; specs/system/media-storage.md, "File handling rules". */
export const ACCEPTED_TYPES = {
  "image/jpeg": { kind: "image", ext: "jpg" },
  "image/png": { kind: "image", ext: "png" },
  "image/webp": { kind: "image", ext: "webp" },
  "image/heic": { kind: "image", ext: "heic" },
  "image/heif": { kind: "image", ext: "heic" },
  "video/mp4": { kind: "video", ext: "mp4" },
  "video/quicktime": { kind: "video", ext: "mov" },
} as const satisfies Record<string, { kind: MediaKind; ext: string }>;
export type AcceptedType = keyof typeof ACCEPTED_TYPES;

export function acceptedType(mime: string | null): AcceptedType | null {
  return mime !== null && Object.hasOwn(ACCEPTED_TYPES, mime) ? (mime as AcceptedType) : null;
}

export function extensionFor(contentType: string): string {
  const type = acceptedType(contentType);
  if (type === null) throw new Error(`no extension for ${contentType}`);
  return ACCEPTED_TYPES[type].ext;
}

export const MEDIA_STATUSES = ["staged", "stored", "failed"] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

/** A file accepted by content, re-encoded when it is an image, and written to staging. */
export interface StagedFile {
  /** Also the media row id and the entry in the `file_upload` answer. */
  id: string;
  stagingRef: string;
  kind: MediaKind;
  contentType: string;
  size: number;
}

/** A row of the `media` table; specs/system/database.md. */
export interface MediaRecord {
  id: string;
  submissionId: string;
  formId: string;
  fieldKey: string;
  position: number;
  kind: MediaKind;
  status: MediaStatus;
  contentType: string;
  size: number;
  stagingRef: string | null;
  durableKey: string;
  providerRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

`keys.ts`:

```ts
/** Key schemes; specs/system/media-storage.md, "Keys". No key carries personal data. */
export const MAX_FIELD_SLUG = 40;
export const STAGING_ROOT = "in-progress";

export function fieldSlug(label: string): string {
  const slug = label
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_FIELD_SLUG)
    .replace(/-+$/g, "");
  return slug === "" ? "file" : slug;
}

export function uniqueFieldSlugs(
  fields: readonly { fieldKey: string; label: string }[],
): Map<string, string> {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const { fieldKey, label } of fields) {
    const base = fieldSlug(label);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.set(fieldKey, n === 1 ? base : `${base}-${String(n)}`);
  }
  return out;
}

export function durableKey(parts: {
  formSlug: string;
  reference: string;
  position: number;
  fieldSlug: string;
  ext: string;
}): string {
  const nn = String(parts.position).padStart(2, "0");
  return `forms/${parts.formSlug}/${parts.reference}/${nn}-${parts.fieldSlug}.${parts.ext}`;
}

export function stagingPrefix(recordId: string): string {
  return `${STAGING_ROOT}/${recordId}/`;
}

export function stagingKey(recordId: string, fileId: string, ext: string): string {
  return `${stagingPrefix(recordId)}${fileId}.${ext}`;
}
```

`iso-bmff.ts`:

```ts
/**
 * The container check for videos, stored as received: boxes from start to end
 * whose sizes fit, `ftyp` first, and a `moov` box present.
 * See specs/system/media-storage.md, "File handling rules".
 */
export function isWellFormedIsoBmff(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let boxes = 0;
  let sawMoov = false;
  while (offset < bytes.length) {
    const remaining = bytes.length - offset;
    if (remaining < 8) return false;
    let size = view.getUint32(offset);
    let header = 8;
    if (size === 1) {
      if (remaining < 16) return false;
      const large = view.getBigUint64(offset + 8);
      if (large > BigInt(remaining)) return false;
      size = Number(large);
      header = 16;
    } else if (size === 0) {
      size = remaining;
    }
    if (size < header || size > remaining) return false;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!/^[\x20-\x7e]{4}$/.test(type)) return false;
    if (boxes === 0 && type !== "ftyp") return false;
    if (type === "moov") sawMoov = true;
    boxes += 1;
    offset += size;
  }
  return boxes > 0 && sawMoov;
}
```

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

- [ ] **Step 1: Failing tests.** `stage-file.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { brokenMp4, syntheticMp4 } from "../../../../tests/fakes/media-files";
import { stageFile } from "./stage-file";
import { fakeImage, makeMediaDeps } from "./testing/fakes";

const MB = 1024 * 1024;

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

  it("stores a well-formed video as received", async () => {
    const deps = makeMediaDeps();
    const bytes = syntheticMp4();
    const r = await stageFile(deps, { recordId: "rec-1", bytes, accept: ["image", "video"], maxBytes: 10 * MB });
    if (!r.ok) throw new Error(r.code);
    expect(r.file.kind).toBe("video");
    expect(deps.staging.files.get(r.file.stagingRef)?.bytes).toEqual(bytes);
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

`attach.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { attachToSubmission } from "./attach";
import { makeMediaDeps } from "./testing/fakes";

describe("attachToSubmission", () => {
  it("writes one staged row and one media.upload job per file, sharing the id", async () => {
    const deps = makeMediaDeps();
    const uow = await deps.uow.begin();
    const file = {
      id: "00000001-0000-4000-8000-000000000001",
      stagingRef: "in-progress/r/x.jpg",
      kind: "image" as const,
      contentType: "image/jpeg",
      size: 10,
    };
    await attachToSubmission(deps, uow, {
      submissionId: "sub-1",
      formId: "form-1",
      files: [{ fieldKey: "photos", position: 1, durableKey: "forms/s/HP-0001/01-photos.jpg", file }],
    });
    expect(deps.media.rows.get(file.id)).toMatchObject({
      submissionId: "sub-1", formId: "form-1", fieldKey: "photos", position: 1, status: "staged",
      stagingRef: "in-progress/r/x.jpg", durableKey: "forms/s/HP-0001/01-photos.jpg", providerRef: null,
    });
    expect(deps.queue.ofType("media.upload")).toEqual([
      { type: "media.upload", payload: { mediaId: file.id }, opts: {} },
    ]);
  });
});
```

`discard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { discardRecordFiles, discardStaged } from "./discard";
import { makeMediaDeps } from "./testing/fakes";

describe("discard", () => {
  it("deletes given refs, tolerating missing ones, and whole record prefixes", async () => {
    const deps = makeMediaDeps();
    for (const key of ["in-progress/a/1.jpg", "in-progress/a/2.jpg", "in-progress/b/3.jpg"])
      await deps.staging.put(new Uint8Array([1]), key, "image/jpeg");
    await discardStaged(deps, ["in-progress/a/1.jpg", "in-progress/a/missing.jpg"]);
    expect([...deps.staging.files.keys()]).toEqual(["in-progress/a/2.jpg", "in-progress/b/3.jpg"]);
    await discardRecordFiles(deps, "a");
    expect([...deps.staging.files.keys()]).toEqual(["in-progress/b/3.jpg"]);
  });
});
```

Append inside `describe("layer boundaries")` of `tests/boundaries/boundaries.test.ts`:

```ts
  it("forbids media importing definitions, since MODULE_DEPS gives media no edges", async () => {
    const rules = await lintVirtual(
      "src/modules/media/application/boundary-probe-defs.ts",
      `import { publicUrl } from "@/modules/definitions/application";\nexport const f = publicUrl;\n`,
    );
    expect(rules.map((m) => m.ruleId)).toContain("boundaries/dependencies");
  });

  it("allows submissions to import media's public entry point", async () => {
    const rules = await lintVirtual(
      "src/modules/submissions/application/boundary-probe-media.ts",
      `import { stageFile } from "@/modules/media/application";\nexport const s = stageFile;\n`,
    );
    expect(rules.filter((m) => m.ruleId?.startsWith("boundaries/"))).toEqual([]);
  });
```

- [ ] **Step 2: Run** `pnpm test src/modules/media tests/boundaries`: they fail.

- [ ] **Step 3: Implement** the four port files and `deps.ts` exactly as in Interfaces (each port file imports only shared ports and the media domain), `job-types.ts` with `MEDIA_JOB_TYPES`, then `stage-file.ts`:

```ts
import { isWellFormedIsoBmff } from "../domain/iso-bmff";
import { stagingKey } from "../domain/keys";
import { ACCEPTED_TYPES, acceptedType, extensionFor, type MediaKind, type StagedFile } from "../domain/media";
import type { MediaDeps } from "./deps";

export type StageRefusal = "file_too_large" | "file_wrong_type" | "file_unreadable";

export interface StageFileInput {
  recordId: string;
  bytes: Uint8Array;
  accept: readonly MediaKind[];
  maxBytes: number;
}

export type StageFileResult = { ok: true; file: StagedFile } | { ok: false; code: StageRefusal };

/**
 * Accepts a file by its content, re-encodes images (which strips every
 * metadata block), checks a video's container, and writes the result to
 * staging. Refusals are validation errors shown to the submitter, never job
 * failures. See specs/system/media-storage.md, "File handling rules".
 */
export async function stageFile(deps: MediaDeps, input: StageFileInput): Promise<StageFileResult> {
  if (input.bytes.byteLength > input.maxBytes) return { ok: false, code: "file_too_large" };
  const type = acceptedType(await deps.sniffer.sniff(input.bytes));
  if (type === null) return { ok: false, code: "file_wrong_type" };
  const { kind } = ACCEPTED_TYPES[type];
  if (!input.accept.includes(kind)) return { ok: false, code: "file_wrong_type" };

  let bytes = input.bytes;
  let contentType: string = type;
  if (kind === "image") {
    const encoded = await deps.encoder.reencode(input.bytes, type);
    if (encoded === null) return { ok: false, code: "file_unreadable" };
    bytes = encoded.bytes;
    contentType = encoded.contentType;
  } else if (!isWellFormedIsoBmff(input.bytes)) {
    return { ok: false, code: "file_unreadable" };
  }

  const id = deps.ids.newId();
  const key = stagingKey(input.recordId, id, extensionFor(contentType));
  const stagingRef = await deps.staging.put(bytes, key, contentType);
  return { ok: true, file: { id, stagingRef, kind, contentType, size: bytes.byteLength } };
}
```

`attach.ts`:

```ts
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { StagedFile } from "../domain/media";
import type { MediaDeps } from "./deps";
import { MEDIA_JOB_TYPES } from "./job-types";

export interface AttachedFile {
  fieldKey: string;
  position: number;
  durableKey: string;
  file: StagedFile;
}

/**
 * Inside the intake transaction: one `staged` media row and one `media.upload`
 * job per file. See specs/architecture.md, "Submission data flow" step 3.
 */
export async function attachToSubmission(
  deps: Pick<MediaDeps, "media" | "queue" | "clock">,
  uow: UnitOfWork,
  input: { submissionId: string; formId: string; files: readonly AttachedFile[] },
): Promise<void> {
  const now = deps.clock.now();
  for (const { fieldKey, position, durableKey, file } of input.files) {
    await deps.media.insert(uow, {
      id: file.id,
      submissionId: input.submissionId,
      formId: input.formId,
      fieldKey,
      position,
      kind: file.kind,
      status: "staged",
      contentType: file.contentType,
      size: file.size,
      stagingRef: file.stagingRef,
      durableKey,
      providerRef: null,
      createdAt: now,
      updatedAt: now,
    });
    await deps.queue.enqueue(uow, MEDIA_JOB_TYPES.upload, { mediaId: file.id });
  }
}
```

`discard.ts`:

```ts
import { stagingPrefix } from "../domain/keys";
import type { MediaDeps } from "./deps";

/** Removes staged files that will never be attached: removed, hidden at submit, silent accept. */
export async function discardStaged(
  deps: Pick<MediaDeps, "staging">,
  refs: readonly string[],
): Promise<void> {
  for (const ref of refs) await deps.staging.delete(ref);
}

/** Removes every staged file of an in-progress record, including any a crash left behind. */
export async function discardRecordFiles(
  deps: Pick<MediaDeps, "staging">,
  recordId: string,
): Promise<void> {
  await deps.staging.deletePrefix(stagingPrefix(recordId));
}
```

`testing/fakes.ts`:

```ts
/**
 * In-memory fakes for the media ports. Synthetic bytes only: `fakeImage(type)`
 * is the text "mime:<type>;" padded with zeros, which `FakeSniffer` reads back;
 * `FakeEncoder` prefixes "reencoded:" and refuses anything containing "broken".
 */
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import {
  FakeUnitOfWorkFactory,
  FixedClock,
  InMemoryJobQueue,
  SequentialIdGenerator,
} from "@/shared/application/testing/fakes";
import type { MediaRecord } from "../../domain/media";
import type { MediaDeps } from "../deps";
import type { ContentSniffer } from "../ports/content-sniffer";
import type { EncodedImage, ImageEncoder } from "../ports/image-encoder";
import type { MediaRepository } from "../ports/media-repository";
import type { StagingStorage } from "../ports/media-storage";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

export function fakeImage(type = "image/jpeg", size = 64): Uint8Array {
  const head = new TextEncoder().encode(`mime:${type};`);
  const out = new Uint8Array(Math.max(size, head.length));
  out.set(head);
  return out;
}

export class InMemoryStorage implements StagingStorage {
  readonly files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  failPut = false;

  put(bytes: Uint8Array, key: string, contentType: string): Promise<string> {
    if (this.failPut) return Promise.reject(new Error("storage unavailable"));
    this.files.set(key, { bytes: bytes.slice(), contentType });
    return Promise.resolve(key);
  }
  viewUrl(ref: string): Promise<string> {
    return Promise.resolve(`memory://${ref}`);
  }
  delete(ref: string): Promise<void> {
    this.files.delete(ref);
    return Promise.resolve();
  }
  exists(ref: string): Promise<boolean> {
    return Promise.resolve(this.files.has(ref));
  }
  read(ref: string): Promise<Uint8Array> {
    const file = this.files.get(ref);
    return file ? Promise.resolve(file.bytes.slice()) : Promise.reject(new Error("no such file"));
  }
  deletePrefix(prefix: string): Promise<void> {
    for (const key of [...this.files.keys()]) if (key.startsWith(prefix)) this.files.delete(key);
    return Promise.resolve();
  }
}

export class FakeSniffer implements ContentSniffer {
  sniff(bytes: Uint8Array): Promise<string | null> {
    if (decode(bytes.subarray(4, 8)) === "ftyp") return Promise.resolve("video/mp4");
    const match = /^mime:([a-z]+\/[a-z0-9.+-]+);/.exec(decode(bytes.subarray(0, 64)));
    return Promise.resolve(match?.[1] ?? null);
  }
}

export class FakeEncoder implements ImageEncoder {
  reencode(bytes: Uint8Array, contentType: string): Promise<EncodedImage | null> {
    if (decode(bytes).includes("broken")) return Promise.resolve(null);
    const type =
      contentType === "image/png" || contentType === "image/webp" ? contentType : "image/jpeg";
    const out = new Uint8Array([...new TextEncoder().encode("reencoded:"), ...bytes]);
    return Promise.resolve({ bytes: out, contentType: type });
  }
}

export class InMemoryMediaRepository implements MediaRepository {
  readonly rows = new Map<string, MediaRecord>();

  insert(_uow: UnitOfWork, record: MediaRecord): Promise<void> {
    if (this.rows.has(record.id)) return Promise.reject(new Error(`media ${record.id} exists`));
    this.rows.set(record.id, { ...record });
    return Promise.resolve();
  }
  findById(id: string): Promise<MediaRecord | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row ? { ...row } : null);
  }
  listBySubmission(submissionId: string): Promise<MediaRecord[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((r) => r.submissionId === submissionId)
        .sort((a, b) => a.fieldKey.localeCompare(b.fieldKey) || a.position - b.position)
        .map((r) => ({ ...r })),
    );
  }
  private patch(id: string, change: Partial<MediaRecord>): Promise<void> {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, ...change });
    return Promise.resolve();
  }
  markStored(_uow: UnitOfWork, id: string, providerRef: string, at: Date): Promise<void> {
    return this.patch(id, { status: "stored", providerRef, updatedAt: at });
  }
  clearStaging(_uow: UnitOfWork, id: string, at: Date): Promise<void> {
    return this.patch(id, { stagingRef: null, updatedAt: at });
  }
  markFailed(_uow: UnitOfWork, id: string, at: Date): Promise<void> {
    return this.patch(id, { status: "failed", updatedAt: at });
  }
  delete(_uow: UnitOfWork, id: string): Promise<void> {
    this.rows.delete(id);
    return Promise.resolve();
  }
}

export interface FakeMediaDeps extends MediaDeps {
  staging: InMemoryStorage;
  durable: InMemoryStorage;
  media: InMemoryMediaRepository;
  queue: InMemoryJobQueue;
  ids: SequentialIdGenerator;
  clock: FixedClock;
}

export function makeMediaDeps(overrides: Partial<FakeMediaDeps> = {}): FakeMediaDeps {
  return {
    staging: overrides.staging ?? new InMemoryStorage(),
    durable: overrides.durable ?? new InMemoryStorage(),
    sniffer: overrides.sniffer ?? new FakeSniffer(),
    encoder: overrides.encoder ?? new FakeEncoder(),
    media: overrides.media ?? new InMemoryMediaRepository(),
    queue: overrides.queue ?? new InMemoryJobQueue(),
    uow: overrides.uow ?? new FakeUnitOfWorkFactory(),
    ids: overrides.ids ?? new SequentialIdGenerator(),
    clock: overrides.clock ?? new FixedClock(),
  };
}
```

`index.ts`:

```ts
/** Public API of the media module. Other modules and the app import only this. */
export type { MediaKind, MediaRecord, MediaStatus, StagedFile } from "../domain/media";
export { MEDIA_KINDS, extensionFor } from "../domain/media";
export { fieldSlug, uniqueFieldSlugs, durableKey } from "../domain/keys";
export type { MediaDeps } from "./deps";
export type { MediaStorage, StagingStorage } from "./ports/media-storage";
export type { ContentSniffer } from "./ports/content-sniffer";
export type { ImageEncoder, EncodedImage } from "./ports/image-encoder";
export type { MediaRepository } from "./ports/media-repository";
export type { StageFileInput, StageFileResult, StageRefusal } from "./stage-file";
export type { AttachedFile } from "./attach";
export { stageFile } from "./stage-file";
export { attachToSubmission } from "./attach";
export { discardStaged, discardRecordFiles } from "./discard";
export { MEDIA_JOB_TYPES } from "./job-types";
```

- [ ] **Step 4: Run** `pnpm test src/modules/media tests/boundaries && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(media): staging, attaching and discarding files behind storage, sniffer and encoder ports`

---

### Task 7: Media adapters: content sniffing and image re-encoding

**Files:**
- Create: `src/modules/media/infrastructure/file-type-sniffer.ts`, `sharp-image-encoder.ts`, `libheif-js.d.ts`, with `file-type-sniffer.test.ts` and `sharp-image-encoder.test.ts` beside them
- Modify: `next.config.ts` (`serverExternalPackages`)

**Interfaces:**
- Consumes: `ContentSniffer`, `ImageEncoder`, `EncodedImage` (Task 6); `tests/fakes/media-files.ts` (Task 5).
- Produces: `class FileTypeSniffer implements ContentSniffer`, `class SharpImageEncoder implements ImageEncoder` with `MAX_INPUT_PIXELS = 50_000_000`.

These adapters do no I/O beyond CPU work on bytes, so their tests run in the unit suite against the real libraries.

- [ ] **Step 1: Failing tests.** `file-type-sniffer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  htmlPretendingToBeJpeg,
  syntheticHeic,
  syntheticJpegWithGps,
  syntheticMp4,
  syntheticPng,
  syntheticWebp,
} from "../../../../tests/fakes/media-files";
import { FileTypeSniffer } from "./file-type-sniffer";

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
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  syntheticHeic,
  syntheticJpegWithGps,
  syntheticPng,
  syntheticWebp,
} from "../../../../tests/fakes/media-files";
import { SharpImageEncoder } from "./sharp-image-encoder";

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

  it("returns null for a truncated image, a PNG claimed as HEIC, and an unknown type", async () => {
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

- [ ] **Step 3: Implement.** `file-type-sniffer.ts`:

```ts
import { fileTypeFromBuffer } from "file-type";
import type { ContentSniffer } from "../application/ports/content-sniffer";

/** Content sniffing with `file-type` (ADR 0023): magic numbers only, never names. */
export class FileTypeSniffer implements ContentSniffer {
  async sniff(bytes: Uint8Array): Promise<string | null> {
    if (bytes.byteLength === 0) return null;
    return (await fileTypeFromBuffer(bytes))?.mime ?? null;
  }
}
```

`libheif-js.d.ts` (the package ships no types):

```ts
declare module "libheif-js/wasm-bundle" {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    display(
      target: { data: Uint8ClampedArray; width: number; height: number },
      done: (result: { data: Uint8ClampedArray } | null) => void,
    ): void;
  }
  const libheif: { HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImage[] } };
  export default libheif;
}
```

`sharp-image-encoder.ts`:

```ts
import libheif from "libheif-js/wasm-bundle";
import sharp from "sharp";
import type { EncodedImage, ImageEncoder } from "../application/ports/image-encoder";

export const MAX_INPUT_PIXELS = 50_000_000;
const QUALITY = 85;

/**
 * Re-encodes images so no metadata survives (sharp writes none unless asked),
 * applying the EXIF orientation first. HEIC is decoded by libheif-js and
 * written as JPEG. Any decoding failure is null: the submitter sees
 * "could not be read". See ADR 0023.
 */
export class SharpImageEncoder implements ImageEncoder {
  async reencode(bytes: Uint8Array, contentType: string): Promise<EncodedImage | null> {
    try {
      if (contentType === "image/heic" || contentType === "image/heif") return await this.fromHeic(bytes);
      const image = sharp(bytes, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).rotate();
      if (contentType === "image/jpeg") {
        return { bytes: new Uint8Array(await image.jpeg({ quality: QUALITY }).toBuffer()), contentType };
      }
      if (contentType === "image/png") {
        return { bytes: new Uint8Array(await image.png().toBuffer()), contentType };
      }
      if (contentType === "image/webp") {
        return { bytes: new Uint8Array(await image.webp({ quality: QUALITY }).toBuffer()), contentType };
      }
      return null;
    } catch {
      return null;
    }
  }

  private async fromHeic(bytes: Uint8Array): Promise<EncodedImage | null> {
    const [first] = new libheif.HeifDecoder().decode(bytes);
    if (!first) return null;
    const width = first.get_width();
    const height = first.get_height();
    if (width * height > MAX_INPUT_PIXELS) return null;
    const pixels = await new Promise<Uint8ClampedArray | null>((resolve) => {
      first.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (result) => {
        resolve(result ? result.data : null);
      });
    });
    if (pixels === null) return null;
    const jpeg = await sharp(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength), {
      raw: { width, height, channels: 4 },
    })
      .jpeg({ quality: QUALITY })
      .toBuffer();
    return { bytes: new Uint8Array(jpeg), contentType: "image/jpeg" };
  }
}
```

`next.config.ts`: add `serverExternalPackages: ["sharp", "libheif-js"]` to `nextConfig`.

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

- [ ] **Step 1: Failing integration tests.** `tests/integration/media/local-disk-storage.test.ts`:

```ts
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalDiskStorage } from "@/modules/media/infrastructure/local-disk-storage";

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

  it("overwrites the same key and leaves no temporary files", async () => {
    await storage.put(new Uint8Array([1]), "in-progress/rec/a.jpg", "image/jpeg");
    await storage.put(new Uint8Array([2]), "in-progress/rec/a.jpg", "image/jpeg");
    expect(await storage.read("in-progress/rec/a.jpg")).toEqual(new Uint8Array([2]));
    expect(await readdir(path.join(root, "in-progress/rec"))).toEqual(["a.jpg"]);
  });

  it("deletes a whole prefix and removes emptied directories", async () => {
    await storage.put(new Uint8Array([1]), "in-progress/one/a.jpg", "image/jpeg");
    await storage.put(new Uint8Array([1]), "in-progress/one/b.jpg", "image/jpeg");
    await storage.put(new Uint8Array([1]), "in-progress/two/c.jpg", "image/jpeg");
    await storage.deletePrefix("in-progress/one/");
    expect(await readdir(path.join(root, "in-progress"))).toEqual(["two"]);
    await storage.delete("in-progress/two/c.jpg");
    expect(await readdir(root)).toEqual([]);
  });

  it("refuses refs that escape the root", async () => {
    await expect(storage.put(new Uint8Array([1]), "../outside.jpg", "image/jpeg")).rejects.toThrow(/escapes/);
    await expect(storage.read("/etc/passwd")).rejects.toThrow(/escapes/);
  });

  it("gives the admin view path for a ref", async () => {
    expect(await storage.viewUrl("in-progress/rec/a.jpg", 60)).toBe("/admin/media/local/in-progress%2Frec%2Fa.jpg");
  });
});
```

`tests/integration/media/pg-media-repository.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { MediaRecord } from "@/modules/media/application";
import { PgMediaRepository } from "@/modules/media/infrastructure/pg-media-repository";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";

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

- [ ] **Step 3: Implement.** Write the migration above. `local-disk-storage.ts`:

```ts
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StagingStorage } from "../application/ports/media-storage";

/**
 * The staging tier, and the durable tier when MEDIA_PROVIDER=local. Files are
 * written owner-only, atomically (temporary file, then rename), under a root
 * outside the web root. Refs are the keys. See specs/system/media-storage.md.
 */
export class LocalDiskStorage implements StagingStorage {
  private readonly root: string;

  constructor(
    root: string,
    private readonly viewPath: (ref: string) => string = (ref) =>
      `/admin/media/local/${encodeURIComponent(ref)}`,
  ) {
    this.root = path.resolve(root);
  }

  private pathOf(ref: string): string {
    const full = path.resolve(this.root, ref);
    if (!full.startsWith(this.root + path.sep)) throw new Error("media ref escapes the storage root");
    return full;
  }

  async put(bytes: Uint8Array, key: string, _contentType: string): Promise<string> {
    const file = this.pathOf(key);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, file);
    return key;
  }

  viewUrl(ref: string, _ttlSeconds: number): Promise<string> {
    return Promise.resolve(this.viewPath(ref));
  }

  async delete(ref: string): Promise<void> {
    const file = this.pathOf(ref);
    await rm(file, { force: true });
    await this.removeEmptyParents(path.dirname(file));
  }

  async exists(ref: string): Promise<boolean> {
    try {
      return (await stat(this.pathOf(ref))).isFile();
    } catch (e) {
      if (e instanceof Error && e.message.includes("escapes")) throw e;
      return false;
    }
  }

  async read(ref: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.pathOf(ref)));
  }

  async deletePrefix(prefix: string): Promise<void> {
    const dir = this.pathOf(prefix.replace(/\/+$/, ""));
    await rm(dir, { recursive: true, force: true });
    await this.removeEmptyParents(path.dirname(dir));
  }

  /** Removes emptied directories up to, not including, the root. */
  private async removeEmptyParents(dir: string): Promise<void> {
    for (let d = dir; d.startsWith(this.root + path.sep); d = path.dirname(d)) {
      try {
        await rmdir(d);
      } catch {
        return;
      }
    }
  }
}
```

`pg-media-repository.ts`:

```ts
import type { Pool } from "pg";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { txOf } from "@/shared/infrastructure/postgres/tx";
import { isUuid } from "@/shared/infrastructure/uuid";
import type { MediaRepository } from "../application/ports/media-repository";
import type { MediaKind, MediaRecord, MediaStatus } from "../domain/media";

const COLUMNS = `id, submission_id, form_id, field_key, position, kind, status, content_type, size,
  staging_ref, durable_key, provider_ref, created_at, updated_at`;

interface MediaRow {
  id: string;
  submission_id: string;
  form_id: string;
  field_key: string;
  position: number;
  kind: MediaKind;
  status: MediaStatus;
  content_type: string;
  size: string;
  staging_ref: string | null;
  durable_key: string;
  provider_ref: string | null;
  created_at: Date;
  updated_at: Date;
}

function toRecord(r: MediaRow): MediaRecord {
  return {
    id: r.id,
    submissionId: r.submission_id,
    formId: r.form_id,
    fieldKey: r.field_key,
    position: r.position,
    kind: r.kind,
    status: r.status,
    contentType: r.content_type,
    size: Number(r.size),
    stagingRef: r.staging_ref,
    durableKey: r.durable_key,
    providerRef: r.provider_ref,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** The `media` table; specs/system/database.md. Reads use the pool, writes the unit of work. */
export class PgMediaRepository implements MediaRepository {
  constructor(private readonly pool: Pool) {}

  async insert(uow: UnitOfWork, m: MediaRecord): Promise<void> {
    await txOf(uow).client.query(
      `insert into media (${COLUMNS}) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [m.id, m.submissionId, m.formId, m.fieldKey, m.position, m.kind, m.status, m.contentType,
        m.size, m.stagingRef, m.durableKey, m.providerRef, m.createdAt, m.updatedAt],
    );
  }

  async findById(id: string): Promise<MediaRecord | null> {
    if (!isUuid(id)) return null;
    const { rows } = await this.pool.query<MediaRow>(`select ${COLUMNS} from media where id = $1`, [id]);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async listBySubmission(submissionId: string): Promise<MediaRecord[]> {
    if (!isUuid(submissionId)) return [];
    const { rows } = await this.pool.query<MediaRow>(
      `select ${COLUMNS} from media where submission_id = $1 order by field_key, position`,
      [submissionId],
    );
    return rows.map(toRecord);
  }

  async markStored(uow: UnitOfWork, id: string, providerRef: string, at: Date): Promise<void> {
    await txOf(uow).client.query(
      "update media set status = 'stored', provider_ref = $2, updated_at = $3 where id = $1",
      [id, providerRef, at],
    );
  }

  async clearStaging(uow: UnitOfWork, id: string, at: Date): Promise<void> {
    await txOf(uow).client.query("update media set staging_ref = null, updated_at = $2 where id = $1", [id, at]);
  }

  async markFailed(uow: UnitOfWork, id: string, at: Date): Promise<void> {
    await txOf(uow).client.query("update media set status = 'failed', updated_at = $2 where id = $1", [id, at]);
  }

  async delete(uow: UnitOfWork, id: string): Promise<void> {
    await txOf(uow).client.query("delete from media where id = $1", [id]);
  }
}
```

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

- [ ] **Step 1: The fake server** `tests/fakes/dropbox-api.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeDropbox {
  url: string;
  files: Map<string, Uint8Array>;
  calls: string[];
  tokenRefreshes: number;
  failNext(status: number, body?: unknown): void;
  revokeTokens(): void;
  close(): Promise<void>;
}

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function send(res: ServerResponse, status: number, json: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(json));
}

/** A local stand-in for the five Dropbox endpoints the adapter uses. Synthetic data only. */
export async function startFakeDropbox(): Promise<FakeDropbox> {
  let token = "token-1";
  let pending: { status: number; body: unknown } | null = null;
  const state = { files: new Map<string, Uint8Array>(), calls: [] as string[], tokenRefreshes: 0 };
  const notFound = { error_summary: "path/not_found/", error: { ".tag": "path", path: { ".tag": "not_found" } } };

  const server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? "";
      state.calls.push(url);
      const raw = await body(req);
      if (url === "/oauth2/token") {
        state.tokenRefreshes += 1;
        token = `token-${String(state.tokenRefreshes + 1)}`;
        return send(res, 200, { access_token: token, expires_in: 14400, token_type: "bearer" });
      }
      if (req.headers.authorization !== `Bearer ${token}`) {
        return send(res, 401, { error_summary: "expired_access_token/", error: { ".tag": "expired_access_token" } });
      }
      if (pending) {
        const p = pending;
        pending = null;
        return send(res, p.status, p.body);
      }
      if (url === "/2/files/upload") {
        const arg = JSON.parse(String(req.headers["dropbox-api-arg"])) as { path: string };
        state.files.set(arg.path, new Uint8Array(raw));
        return send(res, 200, { id: "id:fake", path_lower: arg.path.toLowerCase(), size: raw.length });
      }
      const { path } = JSON.parse(raw.toString() || "{}") as { path: string };
      if (url === "/2/files/get_metadata") {
        return state.files.has(path) ? send(res, 200, { ".tag": "file", path_lower: path }) : send(res, 409, notFound);
      }
      if (url === "/2/files/delete_v2") {
        if (!state.files.delete(path)) return send(res, 409, { error_summary: "path_lookup/not_found/", error: { ".tag": "path_lookup", path_lookup: { ".tag": "not_found" } } });
        return send(res, 200, { metadata: { path_lower: path } });
      }
      if (url === "/2/files/get_temporary_link") {
        return state.files.has(path) ? send(res, 200, { link: `https://dl.example.com${path}` }) : send(res, 409, notFound);
      }
      return send(res, 404, { error_summary: "unknown endpoint" });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    files: state.files,
    calls: state.calls,
    get tokenRefreshes() {
      return state.tokenRefreshes;
    },
    failNext(status, json = { error_summary: "too_many_requests/" }) {
      pending = { status, body: json };
    },
    revokeTokens() {
      token = "revoked";
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
```

- [ ] **Step 2: Failing integration test** `tests/integration/media/dropbox-storage.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DropboxStorage } from "@/modules/media/infrastructure/dropbox-storage";
import { startFakeDropbox, type FakeDropbox } from "../../fakes/dropbox-api";

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

- [ ] **Step 4: Implement** `dropbox-storage.ts`:

```ts
import type { MediaStorage } from "../application/ports/media-storage";

export interface DropboxConfig {
  appKey: string;
  appSecret: string;
  refreshToken: string;
  apiUrl: string;
  contentUrl: string;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Dropbox temporary links live four hours; cache them a little less. */
const LINK_LIFETIME_MS = 4 * 60 * 60 * 1000 - 5 * 60 * 1000;
const TOKEN_MARGIN_MS = 60 * 1000;

/** JSON for the Dropbox-API-Arg header, which must be ASCII. */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

async function isNotFound(res: Response): Promise<boolean> {
  const text = await res.text();
  return res.status === 409 && text.includes("not_found");
}

/**
 * The durable tier: an App folder reached with a refresh token through plain
 * `fetch` (ADR 0002). Access tokens are renewed in memory. Rate limits and
 * server errors throw, so the job system retries; nothing retries inline.
 * Errors name the endpoint and status only. See specs/system/media-storage.md.
 */
export class DropboxStorage implements MediaStorage {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly links = new Map<string, { url: string; until: number }>();
  private readonly fetch: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly config: DropboxConfig) {
    this.fetch = config.fetch ?? globalThis.fetch;
    this.now = config.now ?? Date.now;
  }

  async put(bytes: Uint8Array, key: string, _contentType: string): Promise<string> {
    const path = `/${key}`;
    const res = await this.call(`${this.config.contentUrl}/2/files/upload`, {
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": asciiJson({ path, mode: "overwrite", mute: true }),
    }, bytes);
    await this.ensureOk(res, "files/upload");
    return path;
  }

  async exists(ref: string): Promise<boolean> {
    const res = await this.rpc("files/get_metadata", { path: ref });
    if (res.status === 409 && (await isNotFound(res))) return false;
    await this.ensureOk(res, "files/get_metadata");
    return true;
  }

  async delete(ref: string): Promise<void> {
    const res = await this.rpc("files/delete_v2", { path: ref });
    if (res.status === 409 && (await isNotFound(res))) return;
    await this.ensureOk(res, "files/delete_v2");
    this.links.delete(ref);
  }

  async viewUrl(ref: string, ttlSeconds: number): Promise<string> {
    const cached = this.links.get(ref);
    if (cached && cached.until > this.now()) return cached.url;
    const res = await this.rpc("files/get_temporary_link", { path: ref });
    await this.ensureOk(res, "files/get_temporary_link");
    const { link } = (await res.json()) as { link: string };
    this.links.set(ref, { url: link, until: this.now() + Math.min(ttlSeconds * 1000, LINK_LIFETIME_MS) });
    return link;
  }

  private rpc(endpoint: string, arg: unknown): Promise<Response> {
    return this.call(`${this.config.apiUrl}/2/${endpoint}`, { "Content-Type": "application/json" }, JSON.stringify(arg));
  }

  private async call(url: string, headers: Record<string, string>, body: BodyInit, retried = false): Promise<Response> {
    const token = await this.accessToken();
    const res = await this.fetch(url, { method: "POST", headers: { ...headers, Authorization: `Bearer ${token}` }, body });
    if (res.status === 401 && !retried) {
      await res.body?.cancel();
      this.token = null;
      return this.call(url, headers, body, true);
    }
    return res;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_MARGIN_MS > this.now()) return this.token.value;
    const res = await this.fetch(`${this.config.apiUrl}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.config.refreshToken,
        client_id: this.config.appKey,
        client_secret: this.config.appSecret,
      }),
    });
    await this.ensureOk(res, "oauth2/token");
    const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: access_token, expiresAt: this.now() + expires_in * 1000 };
    return access_token;
  }

  private async ensureOk(res: Response, endpoint: string): Promise<void> {
    if (res.ok) return;
    if (!res.bodyUsed) await res.body?.cancel();
    throw new Error(`dropbox ${endpoint} failed with ${String(res.status)}`);
  }
}
```

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
import { describe, expect, it } from "vitest";
import { handlerContext } from "@/shared/application/testing/fakes";
import { createMediaDeleteHandler, createMediaUploadHandler } from "./jobs";
import { makeMediaDeps, type FakeMediaDeps } from "./testing/fakes";

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

`tests/integration/media/upload-job.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMediaUploadHandler } from "@/modules/media/application/jobs";
import { FileTypeSniffer } from "@/modules/media/infrastructure/file-type-sniffer";
import { LocalDiskStorage } from "@/modules/media/infrastructure/local-disk-storage";
import { PgMediaRepository } from "@/modules/media/infrastructure/pg-media-repository";
import { SharpImageEncoder } from "@/modules/media/infrastructure/sharp-image-encoder";
import { handlerContext } from "@/shared/application/testing/fakes";
import { systemClock } from "@/shared/infrastructure/clock";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { PgJobQueue } from "@/shared/infrastructure/jobs/pg-job-queue";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";

describe("media.upload with local disk and Postgres", () => {
  const pool = testPool();
  let dir: string;
  beforeEach(async () => {
    await truncateAll(pool);
    dir = await mkdtemp(path.join(os.tmpdir(), "effluz-media-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("moves a staged file to the durable directory and marks the row stored", async () => {
    const uow = new PgUnitOfWorkFactory(pool);
    const deps = {
      staging: new LocalDiskStorage(path.join(dir, "staging")),
      durable: new LocalDiskStorage(path.join(dir, "durable")),
      sniffer: new FileTypeSniffer(),
      encoder: new SharpImageEncoder(),
      media: new PgMediaRepository(pool),
      queue: new PgJobQueue(systemIdGenerator, systemClock),
      uow,
      ids: systemIdGenerator,
      clock: systemClock,
    };
    const id = "33333333-3333-4333-8333-333333333333";
    await deps.staging.put(new Uint8Array([9]), "in-progress/r/a.jpg", "image/jpeg");
    await uow.run((u) =>
      deps.media.insert(u, {
        id, submissionId: "11111111-1111-4111-8111-111111111111", formId: "22222222-2222-4222-8222-222222222222",
        fieldKey: "photos", position: 1, kind: "image", status: "staged", contentType: "image/jpeg", size: 1,
        stagingRef: "in-progress/r/a.jpg", durableKey: "forms/s/HP-0001/01-photos.jpg", providerRef: null,
        createdAt: new Date(), updatedAt: new Date(),
      }),
    );
    await createMediaUploadHandler(deps)({ mediaId: id }, handlerContext({ uow }));
    expect(await deps.durable.read("forms/s/HP-0001/01-photos.jpg")).toEqual(new Uint8Array([9]));
    expect(await deps.staging.exists("in-progress/r/a.jpg")).toBe(false);
    expect(await deps.media.findById(id)).toMatchObject({ status: "stored", stagingRef: null });
  });
});
```

- [ ] **Step 2: Run** `pnpm test src/modules/media/application/jobs.test.ts`: fails.

- [ ] **Step 3: Implement** `jobs.ts`:

```ts
import { PermanentJobError, type JobHandler, type JobPayload } from "@/shared/application/ports/job-queue";
import type { MediaDeps } from "./deps";

function mediaIdOf(payload: JobPayload): string {
  const id = payload["mediaId"];
  if (typeof id !== "string") throw new PermanentJobError("payload has no mediaId");
  return id;
}

/**
 * `media.upload`: staging to durable storage, the row to `stored` with its
 * reference, then the staging copy deleted. Every step is safe to repeat.
 * See specs/system/jobs.md and specs/system/media-storage.md, "Lifecycle".
 */
export function createMediaUploadHandler(deps: MediaDeps): JobHandler {
  return async (payload, ctx) => {
    const id = mediaIdOf(payload);
    const row = await deps.media.findById(id);
    if (row === null) {
      ctx.logger.info("media no longer exists", { mediaId: id });
      return;
    }
    try {
      if (row.providerRef === null) {
        if (row.stagingRef === null) throw new PermanentJobError("staging copy is missing");
        const bytes = await deps.staging.read(row.stagingRef);
        const providerRef = await deps.durable.put(bytes, row.durableKey, row.contentType);
        await deps.uow.run((uow) => deps.media.markStored(uow, id, providerRef, ctx.clock.now()));
      }
      if (row.stagingRef !== null) {
        const stagingRef = row.stagingRef;
        await deps.staging.delete(stagingRef);
        await deps.uow.run((uow) => deps.media.clearStaging(uow, id, ctx.clock.now()));
      }
      ctx.logger.info("media stored", { mediaId: id });
    } catch (e) {
      if (e instanceof PermanentJobError || ctx.attempt >= ctx.maxAttempts) {
        await deps.uow.run((uow) => deps.media.markFailed(uow, id, ctx.clock.now()));
      }
      throw e;
    }
  };
}

/** `media.delete`: the durable copy, the staging copy, then the row. */
export function createMediaDeleteHandler(deps: MediaDeps): JobHandler {
  return async (payload, ctx) => {
    const id = mediaIdOf(payload);
    const row = await deps.media.findById(id);
    if (row === null) return;
    if (row.providerRef !== null) await deps.durable.delete(row.providerRef);
    if (row.stagingRef !== null) await deps.staging.delete(row.stagingRef);
    await deps.uow.run((uow) => deps.media.delete(uow, id));
    ctx.logger.info("media deleted", { mediaId: id });
  };
}
```

Add `export { createMediaUploadHandler, createMediaDeleteHandler } from "./jobs";` to `index.ts`.

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
export class EmailSendError extends Error { constructor(message: string, readonly permanent: boolean) }
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
export class StubMessageSource implements MessageSource { confirmation: {...} | null; staff: {...} | null }
export class InMemoryDeliveryLog implements DeliveryLog { readonly entries: Map<string, string> }
export const stubRenderer: EmailRenderer;   // subject/text/html built from the data fields, for assertions
export function makeNotificationsDeps(over?: Partial<FakeNotificationsDeps>): FakeNotificationsDeps;
```

Decision (email idempotency): the delivery key is `<job type>:<submission id>`; the provider id is recorded under it before the job succeeds, and a run that finds the key sends nothing. Decision (staff notification): one job per submission, one message to the form's recipient list as it stands when the job runs.

- [ ] **Step 1: Failing tests.** `jobs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { handlerContext } from "@/shared/application/testing/fakes";
import { EmailSendError } from "./ports/email-sender";
import { createStaffNotificationHandler, createSubmitterConfirmationHandler } from "./jobs";
import { makeNotificationsDeps } from "./testing/fakes";

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

  it("ends without sending when the submission is gone or has no address", async () => {
    const deps = makeNotificationsDeps();
    await createSubmitterConfirmationHandler(deps)({ submissionId: SUB }, handlerContext());
    expect(deps.sender.sent).toEqual([]);
  });

  it("fails permanently on a permanent provider error and retries otherwise", async () => {
    const deps = makeNotificationsDeps();
    deps.source.confirmation = confirmation;
    deps.sender.failWith = new EmailSendError("smtp2go rejected the recipient", true);
    await expect(createSubmitterConfirmationHandler(deps)({ submissionId: SUB }, handlerContext())).rejects.toMatchObject({ name: "PermanentJobError" });
    deps.sender.failWith = new EmailSendError("smtp2go failed with 503", false);
    await expect(createSubmitterConfirmationHandler(deps)({ submissionId: SUB }, handlerContext())).rejects.toMatchObject({ name: "EmailSendError" });
    expect(deps.deliveries.entries.size).toBe(0);
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

describe("email.staff_notification", () => {
  it("sends one message to every recipient", async () => {
    const deps = makeNotificationsDeps();
    deps.source.staff = {
      to: ["stories@example.com", "team@example.com"],
      data: { formTitle: "Stories", reference: "HP-0001", receivedAt: "2026-10-10 09:00 America/Panama, 14:00 UTC", link: "https://forms.example.com/admin/forms/f1" },
    };
    await createStaffNotificationHandler(deps)({ submissionId: SUB }, handlerContext());
    expect(deps.sender.sent.map((m) => m.to)).toEqual([["stories@example.com", "team@example.com"]]);
  });
});
```

`enqueue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FakeUnitOfWorkFactory, InMemoryJobQueue } from "@/shared/application/testing/fakes";
import { enqueueSubmissionEmails } from "./enqueue";

describe("enqueueSubmissionEmails", () => {
  it("enqueues only the messages asked for, with the submission id as the only payload", async () => {
    const queue = new InMemoryJobQueue();
    const uow = await new FakeUnitOfWorkFactory().begin();
    await enqueueSubmissionEmails(queue, uow, { submissionId: "s1", submitterConfirmation: false, staffNotification: true });
    expect(queue.enqueued).toEqual([{ type: "email.staff_notification", payload: { submissionId: "s1" }, opts: {} }]);
  });
});
```

Boundary probe, inside `describe("layer boundaries")`:

```ts
  it("forbids notifications importing any other module", async () => {
    const rules = await lintVirtual(
      "src/modules/notifications/application/boundary-probe-subs.ts",
      `import { stageFile } from "@/modules/media/application";\nexport const s = stageFile;\n`,
    );
    expect(rules.map((m) => m.ruleId)).toContain("boundaries/dependencies");
  });
```

(`notifications` has no edges at all; media's entry point stands for any other module.)

- [ ] **Step 2: Run** `pnpm test src/modules/notifications tests/boundaries`: fails.

- [ ] **Step 3: Implement** the ports and `deps.ts` as listed (`EmailSendError` sets `this.name = "EmailSendError"`), then `jobs.ts`:

```ts
import {
  PermanentJobError,
  type JobHandler,
  type JobHandlerContext,
  type JobPayload,
} from "@/shared/application/ports/job-queue";
import type { NotificationsDeps } from "./deps";
import { EmailSendError } from "./ports/email-sender";
import type { RenderedEmail } from "./ports/email-renderer";

export const EMAIL_JOB_TYPES = {
  submitterConfirmation: "email.submitter_confirmation",
  staffNotification: "email.staff_notification",
} as const;

function submissionIdOf(payload: JobPayload): string {
  const id = payload["submissionId"];
  if (typeof id !== "string") throw new PermanentJobError("payload has no submissionId");
  return id;
}

/**
 * Looks the message up at run time, sends it, and records the provider id
 * under `<type>:<submission id>` before the job succeeds; a key already
 * recorded means the message went out. See specs/system/email.md, "Ports".
 */
async function deliver(
  deps: NotificationsDeps,
  ctx: JobHandlerContext,
  type: string,
  submissionId: string,
  build: () => Promise<{ to: readonly string[]; email: RenderedEmail } | null>,
): Promise<void> {
  const key = `${type}:${submissionId}`;
  if ((await deps.deliveries.find(key)) !== null) {
    ctx.logger.info("email already sent", { submissionId });
    return;
  }
  const message = await build();
  if (message === null || message.to.length === 0) {
    ctx.logger.info("email not applicable", { submissionId });
    return;
  }
  try {
    const { providerMessageId } = await deps.sender.send({ to: message.to, ...message.email });
    await deps.deliveries.record(key, providerMessageId, ctx.clock.now());
    ctx.logger.info("email sent", { submissionId });
  } catch (e) {
    if (e instanceof EmailSendError && e.permanent) throw new PermanentJobError(e.message);
    throw e;
  }
}

export function createSubmitterConfirmationHandler(deps: NotificationsDeps): JobHandler {
  return (payload, ctx) => {
    const submissionId = submissionIdOf(payload);
    return deliver(deps, ctx, EMAIL_JOB_TYPES.submitterConfirmation, submissionId, async () => {
      const found = await deps.source.submitterConfirmation(submissionId);
      return found && { to: [found.to], email: deps.renderer.submitterConfirmation(found.data) };
    });
  };
}

export function createStaffNotificationHandler(deps: NotificationsDeps): JobHandler {
  return (payload, ctx) => {
    const submissionId = submissionIdOf(payload);
    return deliver(deps, ctx, EMAIL_JOB_TYPES.staffNotification, submissionId, async () => {
      const found = await deps.source.staffNotification(submissionId);
      return found && { to: found.to, email: deps.renderer.staffNotification(found.data) };
    });
  };
}
```

`enqueue.ts`:

```ts
import type { JobQueue } from "@/shared/application/ports/job-queue";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { EMAIL_JOB_TYPES } from "./jobs";

/** Inside the intake transaction: the email jobs a submission causes. Payload: ids only. */
export async function enqueueSubmissionEmails(
  queue: JobQueue,
  uow: UnitOfWork,
  input: { submissionId: string; submitterConfirmation: boolean; staffNotification: boolean },
): Promise<void> {
  const payload = { submissionId: input.submissionId };
  if (input.submitterConfirmation) await queue.enqueue(uow, EMAIL_JOB_TYPES.submitterConfirmation, payload);
  if (input.staffNotification) await queue.enqueue(uow, EMAIL_JOB_TYPES.staffNotification, payload);
}
```

`testing/fakes.ts`:

```ts
/** Fakes for the notifications ports. Synthetic addresses only (example.com). */
import type { NotificationsDeps } from "../deps";
import type { DeliveryLog } from "../ports/delivery-log";
import type { EmailRenderer, StaffNotificationData, SubmitterConfirmationData } from "../ports/email-renderer";
import type { EmailSendError, EmailSender, OutgoingEmail } from "../ports/email-sender";
import type { MessageSource } from "../ports/message-source";

export class RecordingEmailSender implements EmailSender {
  readonly sent: OutgoingEmail[] = [];
  failWith: EmailSendError | null = null;
  send(email: OutgoingEmail): Promise<{ providerMessageId: string }> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push({ ...email, to: [...email.to] });
    return Promise.resolve({ providerMessageId: `msg-${String(this.sent.length)}` });
  }
}

export class StubMessageSource implements MessageSource {
  confirmation: { to: string; data: SubmitterConfirmationData } | null = null;
  staff: { to: string[]; data: StaffNotificationData } | null = null;
  submitterConfirmation(): Promise<{ to: string; data: SubmitterConfirmationData } | null> {
    return Promise.resolve(this.confirmation);
  }
  staffNotification(): Promise<{ to: string[]; data: StaffNotificationData } | null> {
    return Promise.resolve(this.staff);
  }
}

export class InMemoryDeliveryLog implements DeliveryLog {
  readonly entries = new Map<string, string>();
  find(key: string): Promise<string | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }
  record(key: string, providerMessageId: string): Promise<void> {
    if (!this.entries.has(key)) this.entries.set(key, providerMessageId);
    return Promise.resolve();
  }
}

export const stubRenderer: EmailRenderer = {
  submitterConfirmation: (d) => ({ subject: d.subject, text: `${d.body} ${d.reference}`, html: `<p>${d.reference}</p>` }),
  staffNotification: (d) => ({ subject: `New ${d.reference}`, text: d.link, html: `<p>${d.reference}</p>` }),
};

export interface FakeNotificationsDeps extends NotificationsDeps {
  sender: RecordingEmailSender;
  source: StubMessageSource;
  deliveries: InMemoryDeliveryLog;
}

export function makeNotificationsDeps(over: Partial<FakeNotificationsDeps> = {}): FakeNotificationsDeps {
  return {
    sender: over.sender ?? new RecordingEmailSender(),
    renderer: over.renderer ?? stubRenderer,
    source: over.source ?? new StubMessageSource(),
    deliveries: over.deliveries ?? new InMemoryDeliveryLog(),
  };
}
```

`index.ts`:

```ts
/** Public API of the notifications module. Other modules and the app import only this. */
export type { NotificationsDeps } from "./deps";
export type { EmailSender, OutgoingEmail } from "./ports/email-sender";
export { EmailSendError } from "./ports/email-sender";
export type {
  EmailRenderer,
  RenderedEmail,
  StaffNotificationData,
  SubmitterConfirmationData,
} from "./ports/email-renderer";
export type { MessageSource } from "./ports/message-source";
export type { DeliveryLog } from "./ports/delivery-log";
export { EMAIL_JOB_TYPES, createStaffNotificationHandler, createSubmitterConfirmationHandler } from "./jobs";
export { enqueueSubmissionEmails } from "./enqueue";
```

- [ ] **Step 4: Run** `pnpm test src/modules/notifications tests/boundaries && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(notifications): email ports, idempotent delivery and the confirmation and staff notification handlers`

---

### Task 12: Email templates in `src/shared/presentation/email/`

**Files:**
- Create: `src/shared/presentation/email/copy.ts`, `layout.ts`, `confirmation.ts`, `staff-notification.ts`, `index.ts`, `email.test.ts`, `copy.test.ts`

**Interfaces:**
- Consumes: `parseRichText`, `richTextToPlain` (Task 3), `escapeHtml`, `richTextToHtml` (Task 3), `specTableRows` (Task 3).
- Produces:

```ts
// copy.ts
export const confirmationParts: Record<"Preheader" | "Footer line 1" | "Footer line 2", { en: string; es: string }>;
export const staffParts: Record<"Subject" | "Preheader" | "Intro" | "Reference" | "Received" | "Link" | "Footer", string>;
export function fillTemplate(text: string, vars: Readonly<Record<string, string>>): string;  // {form title}, {ref}, ...
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

The templates are plain TypeScript (no React), so the worker can render them without loading Next.js. HTML is table-based, inline-styled with design-system colors, readable with images blocked (there are none). Plain text is written, not derived from the HTML, and carries the same words. Staff-authored subject and body are escaped; newlines in the subject become spaces so no header can be injected.

- [ ] **Step 1: Failing tests.** `copy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { specTableRows } from "../testing/spec-copy";
import { confirmationParts, fillTemplate, staffParts } from "./copy";

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
import { describe, expect, it } from "vitest";
import { renderStaffNotification, renderSubmitterConfirmation } from "./index";

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

- [ ] **Step 3: Implement.** `copy.ts`:

```ts
/**
 * Fixed parts of the two emails. The text is owned by specs/ui-ux/renderer.md
 * ("Confirmation email, fixed parts") and specs/system/email.md ("Staff
 * notification, fixed parts"); copy.test.ts keeps these equal to those rows.
 */
export const confirmationParts = {
  Preheader: {
    en: "Your response to {form title} was received",
    es: "Recibimos tu respuesta a {form title}",
  },
  "Footer line 1": {
    en: 'You received this email because you submitted "{form title}" on {date}. Reference {ref}.',
    es: 'Recibes este correo porque enviaste "{form title}" el {date}. Referencia {ref}.',
  },
  "Footer line 2": {
    en: "Effluz stores your answers in the United States for {retention} months. To ask for earlier deletion, reply to this email or write to {contact}.",
    es: "Effluz guarda tus respuestas en Estados Unidos durante {retention} meses. Para pedir que se eliminen antes, responde a este correo o escribe a {contact}.",
  },
} as const;

export const staffParts = {
  Subject: "New submission to {form title}: {ref}",
  Preheader: "{form title} received submission {ref}",
  Intro: "{form title} received a new submission.",
  Reference: "Reference: {ref}",
  Received: "Received: {date}",
  Link: "Open it in the manager: {link}",
  Footer: "This email carries no answers or files. Sign in to the manager to see them.",
} as const;

/** Replaces `{name}` placeholders, names may hold spaces; the result is text, never markup. */
export function fillTemplate(text: string, vars: Readonly<Record<string, string>>): string {
  return text.replace(/\{([a-z][a-z ]*)\}/g, (whole, key: string) => vars[key] ?? whole);
}
```

`layout.ts`:

```ts
import { escapeHtml } from "../rich-text-html";

// Values from design-system/tokens.json.
const TEXT = "#372549"; // color.text.default
const MUTED = "#774C60"; // color.text.muted
const PAGE = "#FFF3EF"; // color.surface.page.public
const CARD = "#FFFFFF"; // color.surface.card
const BORDER = "#EFF0F5"; // color.border.default
const FONT = "Poppins, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"; // font.family.sans

export const BODY_STYLE = { paragraph: `margin:0 0 16px;font:17px/1.6 ${FONT};color:${TEXT}`, link: `color:${TEXT};text-decoration:underline` };

/** A table-based, inline-styled document; every argument but `bodyHtml` is plain text. */
export function emailDocument(input: {
  lang: "en" | "es";
  title: string;
  preheader: string;
  bodyHtml: string;
  footer: readonly string[];
}): string {
  const footer = input.footer
    .map((line) => `<p style="margin:0 0 8px;font:15px/1.5 ${FONT};color:${MUTED}">${escapeHtml(line)}</p>`)
    .join("");
  return [
    `<!doctype html><html lang="${input.lang}"><head><meta charset="utf-8">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(input.title)}</title></head>`,
    `<body style="margin:0;padding:0;background:${PAGE}">`,
    `<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(input.preheader)}</span>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE}"><tr><td align="center" style="padding:24px 16px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:${CARD};border:1px solid ${BORDER};border-radius:12px">`,
    `<tr><td style="padding:24px">${input.bodyHtml}</td></tr>`,
    `<tr><td style="padding:0 24px 24px">${footer}</td></tr>`,
    "</table></td></tr></table></body></html>",
  ].join("");
}
```

`confirmation.ts`:

```ts
import { parseRichText, richTextToPlain } from "@/shared/domain/rich-text";
import { richTextToHtml } from "../rich-text-html";
import { confirmationParts, fillTemplate } from "./copy";
import { BODY_STYLE, emailDocument } from "./layout";

/** Structural twin of notifications' SubmitterConfirmationData; shared may not import modules. */
export interface ConfirmationEmailData {
  locale: "en" | "es";
  formTitle: string;
  subject: string;
  body: string;
  receivedOn: string;
  reference: string;
  retentionMonths: number;
  contact: string;
}

export interface EmailParts {
  subject: string;
  text: string;
  html: string;
}

/** The submitter confirmation: staff subject and body inside the fixed parts. */
export function renderSubmitterConfirmation(d: ConfirmationEmailData): EmailParts {
  const vars = {
    "form title": d.formTitle,
    date: d.receivedOn,
    ref: d.reference,
    retention: String(d.retentionMonths),
    contact: d.contact,
  };
  const preheader = fillTemplate(confirmationParts.Preheader[d.locale], vars);
  const footer = [
    fillTemplate(confirmationParts["Footer line 1"][d.locale], vars),
    fillTemplate(confirmationParts["Footer line 2"][d.locale], vars),
  ];
  const blocks = parseRichText(d.body);
  const subject = d.subject.replace(/[\r\n]+/g, " ").trim();
  return {
    subject,
    text: [preheader, "", richTextToPlain(blocks), "", "--", ...footer].join("\n"),
    html: emailDocument({ lang: d.locale, title: subject, preheader, bodyHtml: richTextToHtml(blocks, BODY_STYLE), footer }),
  };
}
```

`staff-notification.ts`:

```ts
import { escapeHtml } from "../rich-text-html";
import { fillTemplate, staffParts } from "./copy";
import { BODY_STYLE, emailDocument } from "./layout";
import type { EmailParts } from "./confirmation";

/** Structural twin of notifications' StaffNotificationData. */
export interface StaffEmailData {
  formTitle: string;
  reference: string;
  receivedAt: string;
  link: string;
}

/** The staff notification: English, no answers, no files. See specs/system/email.md. */
export function renderStaffNotification(d: StaffEmailData): EmailParts {
  const vars = { "form title": d.formTitle, ref: d.reference, date: d.receivedAt, link: d.link };
  const lines = [staffParts.Intro, staffParts.Reference, staffParts.Received].map((t) => fillTemplate(t, vars));
  const linkLabel = fillTemplate(staffParts.Link, { ...vars, link: "" }).trim();
  const p = (text: string) => `<p style="${BODY_STYLE.paragraph}">${escapeHtml(text)}</p>`;
  const bodyHtml =
    lines.map(p).join("") +
    `<p style="${BODY_STYLE.paragraph}">${escapeHtml(linkLabel)} <a href="${escapeHtml(d.link)}" style="${BODY_STYLE.link}">${escapeHtml(d.link)}</a></p>`;
  const subject = fillTemplate(staffParts.Subject, vars).replace(/[\r\n]+/g, " ");
  const preheader = fillTemplate(staffParts.Preheader, vars);
  return {
    subject,
    text: [preheader, "", ...lines, fillTemplate(staffParts.Link, vars), "", "--", staffParts.Footer].join("\n"),
    html: emailDocument({ lang: "en", title: subject, preheader, bodyHtml, footer: [staffParts.Footer] }),
  };
}
```

`index.ts`:

```ts
export type { ConfirmationEmailData, EmailParts } from "./confirmation";
export type { StaffEmailData } from "./staff-notification";
export { renderSubmitterConfirmation } from "./confirmation";
export { renderStaffNotification } from "./staff-notification";
import { renderSubmitterConfirmation } from "./confirmation";
import { renderStaffNotification } from "./staff-notification";

/** Satisfies notifications' EmailRenderer structurally; wired at the composition root. */
export const emailTemplates = {
  submitterConfirmation: renderSubmitterConfirmation,
  staffNotification: renderStaffNotification,
};
```

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

- [ ] **Step 1: The stub server** `tests/fakes/http-stub.ts`:

```ts
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface StubRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface HttpStub {
  url: string;
  requests: StubRequest[];
  reply(status: number, body: unknown): void;
  close(): Promise<void>;
}

/** A JSON HTTP stub: records requests and answers with queued replies, then 200 {}. */
export async function startHttpStub(): Promise<HttpStub> {
  const requests: StubRequest[] = [];
  const replies: { status: number; body: unknown }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      requests.push({
        method: req.method ?? "",
        path: req.url ?? "",
        headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
        body: Buffer.concat(chunks).toString("utf8"),
      });
      const next = replies.shift() ?? { status: 200, body: {} };
      res.writeHead(next.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(next.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    reply: (status, body) => {
      replies.push({ status, body });
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
```

- [ ] **Step 2: Failing tests.** `mailbox.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseMailbox } from "./mailbox";

describe("parseMailbox", () => {
  it("reads a display name and address, or a bare address", () => {
    expect(parseMailbox("Effluz Forms <forms@forms.example.com>")).toEqual({ name: "Effluz Forms", email: "forms@forms.example.com" });
    expect(parseMailbox("forms@forms.example.com")).toEqual({ name: null, email: "forms@forms.example.com" });
  });
});
```

`tests/integration/notifications/smtp2go-email-sender.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Smtp2goEmailSender } from "@/modules/notifications/infrastructure/smtp2go-email-sender";
import { startHttpStub, type HttpStub } from "../../fakes/http-stub";

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

`tests/integration/notifications/mailpit-email-sender.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MailpitEmailSender } from "@/modules/notifications/infrastructure/mailpit-email-sender";
import { startHttpStub, type HttpStub } from "../../fakes/http-stub";

describe("MailpitEmailSender", () => {
  let stub: HttpStub;
  beforeEach(async () => {
    stub = await startHttpStub();
  });
  afterEach(() => stub.close());

  it("sends through Mailpit's API and returns its message id", async () => {
    stub.reply(200, { ID: "mailpit-1" });
    const sender = new MailpitEmailSender({ url: stub.url, from: "Effluz Forms <forms@forms.example.com>", replyTo: "team@example.com" });
    expect(await sender.send({ to: ["a@example.com", "b@example.com"], subject: "S", text: "T", html: "<p>H</p>" })).toEqual({ providerMessageId: "mailpit-1" });
    expect(stub.requests[0]?.path).toBe("/api/v1/send");
    expect(JSON.parse(stub.requests[0]?.body ?? "{}")).toEqual({
      From: { Email: "forms@forms.example.com", Name: "Effluz Forms" },
      To: [{ Email: "a@example.com" }, { Email: "b@example.com" }],
      ReplyTo: [{ Email: "team@example.com" }],
      Subject: "S",
      Text: "T",
      HTML: "<p>H</p>",
    });
  });
});
```

`tests/integration/notifications/pg-delivery-log.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { PgDeliveryLog } from "@/modules/notifications/infrastructure/pg-delivery-log";
import { testPool, truncateAll } from "../db";

describe("PgDeliveryLog", () => {
  const pool = testPool();
  const log = new PgDeliveryLog(pool);
  beforeEach(() => truncateAll(pool));

  it("records a key once and finds it", async () => {
    expect(await log.find("email.staff_notification:s1")).toBeNull();
    await log.record("email.staff_notification:s1", "msg-1", new Date());
    await log.record("email.staff_notification:s1", "msg-2", new Date());
    expect(await log.find("email.staff_notification:s1")).toBe("msg-1");
  });
});
```

- [ ] **Step 3: Run** `pnpm test src/modules/notifications && pnpm test:integration tests/integration/notifications`: fails.

- [ ] **Step 4: Implement.** `mailbox.ts`:

```ts
/** "Name <address>" or a bare address, as configured in EMAIL_FROM. */
export function parseMailbox(value: string): { name: string | null; email: string } {
  const match = /^\s*(.*?)\s*<([^<>\s]+)>\s*$/.exec(value);
  if (match?.[2] !== undefined) return { name: match[1] ? match[1] : null, email: match[2] };
  return { name: null, email: value.trim() };
}
```

`smtp2go-email-sender.ts`:

```ts
import { EmailSendError, type EmailSender, type OutgoingEmail } from "../application/ports/email-sender";

interface Smtp2goResponse {
  data?: { succeeded?: number; failed?: number; email_id?: string; error_code?: string };
}

/**
 * SMTP2GO's HTTP API (ADR 0006). Retryable: network errors, 401, 403, 429, 5xx.
 * Permanent: a 400, or a 200 reporting a failed recipient. Messages carry
 * provider codes and statuses only, never addresses. See specs/system/email.md.
 */
export class Smtp2goEmailSender implements EmailSender {
  private readonly fetch: typeof fetch;

  constructor(
    private readonly config: { apiKey: string; apiUrl: string; from: string; replyTo: string; fetch?: typeof fetch },
  ) {
    this.fetch = config.fetch ?? globalThis.fetch;
  }

  async send(email: OutgoingEmail): Promise<{ providerMessageId: string }> {
    let res: Response;
    try {
      res = await this.fetch(`${this.config.apiUrl}/email/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-Smtp2go-Api-Key": this.config.apiKey },
        body: JSON.stringify({
          sender: this.config.from,
          to: email.to,
          subject: email.subject,
          text_body: email.text,
          html_body: email.html,
          custom_headers: [{ header: "Reply-To", value: this.config.replyTo }],
        }),
      });
    } catch {
      throw new EmailSendError("smtp2go is unreachable", false);
    }
    const body = (await res.json().catch(() => null)) as Smtp2goResponse | null;
    if (res.status === 400) {
      throw new EmailSendError(`smtp2go refused the message (${body?.data?.error_code ?? "no code"})`, true);
    }
    if (!res.ok) throw new EmailSendError(`smtp2go failed with ${String(res.status)}`, false);
    const id = body?.data?.email_id;
    if ((body?.data?.succeeded ?? 0) < 1 || id === undefined) {
      throw new EmailSendError("smtp2go rejected the recipient", true);
    }
    return { providerMessageId: id };
  }
}
```

`mailpit-email-sender.ts`:

```ts
import { EmailSendError, type EmailSender, type OutgoingEmail } from "../application/ports/email-sender";
import { parseMailbox } from "./mailbox";

/** Local development only: Mailpit's send API (specs/system/email.md, "Local development"). */
export class MailpitEmailSender implements EmailSender {
  private readonly fetch: typeof fetch;

  constructor(private readonly config: { url: string; from: string; replyTo: string; fetch?: typeof fetch }) {
    this.fetch = config.fetch ?? globalThis.fetch;
  }

  async send(email: OutgoingEmail): Promise<{ providerMessageId: string }> {
    const from = parseMailbox(this.config.from);
    let res: Response;
    try {
      res = await this.fetch(`${this.config.url}/api/v1/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          From: from.name === null ? { Email: from.email } : { Email: from.email, Name: from.name },
          To: email.to.map((address) => ({ Email: address })),
          ReplyTo: [{ Email: this.config.replyTo }],
          Subject: email.subject,
          Text: email.text,
          HTML: email.html,
        }),
      });
    } catch {
      throw new EmailSendError("mailpit is unreachable", false);
    }
    if (!res.ok) throw new EmailSendError(`mailpit failed with ${String(res.status)}`, res.status === 400);
    const { ID } = (await res.json()) as { ID: string };
    return { providerMessageId: ID };
  }
}
```

`pg-delivery-log.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { DeliveryLog } from "../application/ports/delivery-log";

/** The `email_delivery` table: one row per sent message, first write wins. */
export class PgDeliveryLog implements DeliveryLog {
  constructor(private readonly pool: Pool) {}

  async find(key: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ provider_message_id: string }>(
      "select provider_message_id from email_delivery where delivery_key = $1",
      [key],
    );
    return rows[0]?.provider_message_id ?? null;
  }

  async record(key: string, providerMessageId: string, at: Date): Promise<void> {
    await this.pool.query(
      `insert into email_delivery (id, delivery_key, provider_message_id, created_at, updated_at)
       values ($1, $2, $3, $4, $4) on conflict (delivery_key) do nothing`,
      [randomUUID(), key, providerMessageId, at],
    );
  }
}
```

- [ ] **Step 5: Run** `pnpm test src/modules/notifications && pnpm test:integration tests/integration/notifications && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 6: Commit** `feat(notifications): SMTP2GO and Mailpit senders and the email delivery log`

---

### Task 14: Definitions for the renderer: public lookup, versions and reference allocation

**Files:**
- Create: `src/modules/definitions/domain/reference.ts`, `reference.test.ts`, `src/modules/definitions/application/public-form.ts`, `public-form.test.ts`, `src/modules/definitions/infrastructure/migrations/0008_form_reference_counter.sql`
- Modify: `src/modules/definitions/domain/form.ts` (+ `publicState`), `form.test.ts`, `application/ports/form-repository.ts` (+ `takeReferenceNumber`), `infrastructure/pg-form-repository.ts`, `application/testing/fakes.ts` (counter, `seedPublished`), `application/index.ts`
- Test: `tests/integration/definitions/allocate-reference.test.ts`

**Interfaces:**
- Consumes: `Form`, `reachability`, `FormRepository`, `VersionRepository`, `DefinitionsDeps` (existing).
- Produces:

```ts
// domain/reference.ts
export function formatReference(prefix: string, n: number): string;     // "HP-0001"; at least four digits
// domain/form.ts
export type PublicState = "open" | "closed" | "not_open_yet" | "not_found";
export function publicState(form: Form, now: Date): PublicState;
// ports/form-repository.ts
takeReferenceNumber(uow: UnitOfWork, formId: string): Promise<number>;   // returns the number taken and advances the counter
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

Decision (reference sequence): `form.next_reference` (starts at 1) is advanced only by `allocateReference`, which locks the form row with `findForUpdate`, decides `publicState` again on the locked row (so a close that commits first wins), and takes the number in the same unit of work as the submission, so a rolled-back intake gives its number back. `submissions` never writes a `definitions` table. Decision (resolving `/f/<slug>`): `resolvePublicForm`, `loadVersion` and `loadForm` are read use cases for the renderer; `shareInfo` stays admin-only.

Migration `0008_form_reference_counter.sql` (exact):

```sql
-- The per-form submission reference sequence; see allocateReference.
alter table form add column next_reference integer not null default 1 check (next_reference >= 1);
```

- [ ] **Step 1: Failing tests.** `reference.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatReference } from "./reference";

describe("formatReference", () => {
  it("pads to four digits and grows past them", () => {
    expect(formatReference("HP", 1)).toBe("HP-0001");
    expect(formatReference("HP", 12345)).toBe("HP-12345");
  });
});
```

Append to `form.test.ts`:

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

with this helper at the top of `form.test.ts` (import `defaultSettings` from `./settings` and the `Form` type from `./form`):

```ts
function sampleFormForState(patch: Partial<Form>): Form {
  const at = new Date("2026-10-01T00:00:00Z");
  return {
    id: "00000000-0000-4000-8000-000000000001", slug: "sample-form", title: { en: "Sample" }, languages: "en",
    status: "draft", settings: defaultSettings("sample-form"), currentVersionId: null, currentVersionNumber: null,
    archivedAt: null, createdAt: at, updatedAt: at, ...patch,
  };
}
```

`public-form.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseDraft } from "@/shared/domain/form-model";
import { allocateReference, loadVersion, resolvePublicForm } from "./public-form";
import { makeDefinitionsDeps, publishAgain, seedPublished } from "./testing/fakes";

function document(title = "Stories") {
  const parsed = parseDraft(
    { languages: "en", title: { en: title }, confirmation: { screen: { en: "Thanks" } }, pages: [{ key: "page_one", fields: [{ key: "f_name", type: "short_text", label: { en: "Name" } }] }] },
    makeDefinitionsDeps().registry,
  );
  if (!parsed.ok) throw new Error("fixture");
  return parsed.version;
}

describe("resolvePublicForm", () => {
  it("returns the current version of an open form, and the state otherwise", async () => {
    const deps = makeDefinitionsDeps();
    const { formId, versionId } = await seedPublished(deps, { slug: "spring-stories", document: document() });
    const open = await resolvePublicForm(deps, "spring-stories");
    expect(open.state === "open" && open.version.id).toBe(versionId);
    expect(await resolvePublicForm(deps, "missing-form")).toEqual({ state: "not_found" });
    const stored = deps.store.forms.get(formId);
    if (stored) deps.store.forms.set(formId, { ...stored, status: "closed" });
    expect((await resolvePublicForm(deps, "spring-stories")).state).toBe("closed");
  });

  it("gives the open date when not yet open", async () => {
    const deps = makeDefinitionsDeps();
    await seedPublished(deps, { slug: "later-form", document: document(), settings: { opensAt: "2026-12-01T12:00:00.000Z" } });
    expect(await resolvePublicForm(deps, "later-form")).toMatchObject({ state: "not_open_yet", opensAt: "2026-12-01T12:00:00.000Z" });
  });
});

describe("loadVersion", () => {
  it("still returns an older version after a republish", async () => {
    const deps = makeDefinitionsDeps();
    const { formId, versionId } = await seedPublished(deps, { slug: "spring-stories", document: document() });
    publishAgain(deps, formId, document("Stories v2"));
    expect((await loadVersion(deps, versionId))?.document.title).toEqual({ en: "Stories" });
  });
});

describe("allocateReference", () => {
  it("hands out the prefix and a sequence per form, and refuses a closed form", async () => {
    const deps = makeDefinitionsDeps();
    const { formId } = await seedPublished(deps, { slug: "spring-stories", document: document(), settings: { referencePrefix: "SS" } });
    const uow = await deps.uow.begin();
    expect(await allocateReference(deps, uow, formId)).toMatchObject({ ok: true, reference: "SS-0001" });
    expect(await allocateReference(deps, uow, formId)).toMatchObject({ ok: true, reference: "SS-0002" });
    const stored = deps.store.forms.get(formId);
    if (stored) deps.store.forms.set(formId, { ...stored, status: "closed" });
    expect(await allocateReference(deps, uow, formId)).toEqual({ ok: false, state: "closed" });
  });
});
```

`tests/integration/definitions/allocate-reference.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { allocateReference } from "@/modules/definitions/application";
import type { DefinitionsDeps } from "@/modules/definitions/application/deps";
import { NullSubmissionStats } from "@/modules/definitions/infrastructure/null-submission-stats";
import { PgDraftRepository } from "@/modules/definitions/infrastructure/pg-draft-repository";
import { PgFormRepository } from "@/modules/definitions/infrastructure/pg-form-repository";
import { PgVersionRepository } from "@/modules/definitions/infrastructure/pg-version-repository";
import { PgAuditLog } from "@/modules/identity/infrastructure/pg-audit-log";
import { PgAuditLogReader } from "@/modules/identity/infrastructure/pg-audit-log-reader";
import { buildDefaultRegistry } from "@/shared/domain/form-model";
import { systemClock } from "@/shared/infrastructure/clock";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";
import { sampleForm, sampleVersion } from "./factories";

describe("allocateReference against Postgres", () => {
  const pool = testPool();
  const deps: DefinitionsDeps = {
    forms: new PgFormRepository(pool), drafts: new PgDraftRepository(pool), versions: new PgVersionRepository(pool),
    stats: new NullSubmissionStats(), audit: new PgAuditLog(), auditReader: new PgAuditLogReader(pool),
    uow: new PgUnitOfWorkFactory(pool), clock: systemClock, ids: systemIdGenerator, registry: buildDefaultRegistry(),
    allowedRecipientDomains: ["effluz.com"], publicBaseUrl: "http://localhost:3000",
  };
  beforeEach(() => truncateAll(pool));

  async function publishedForm(): Promise<string> {
    const form = sampleForm({ status: "published" });
    const version = sampleVersion(form.id, 1);
    await deps.uow.run(async (uow) => {
      await deps.forms.insert(uow, form);
      await deps.versions.insert(uow, version);
      await deps.forms.update(uow, { ...form, currentVersionId: version.id, currentVersionNumber: 1 });
    });
    return form.id;
  }

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
});
```

- [ ] **Step 2: Run** `pnpm test src/modules/definitions && pnpm test:integration tests/integration/definitions`: fails.

- [ ] **Step 3: Implement.** `reference.ts`:

```ts
/** `<prefix>-<sequence>`, the sequence zero-padded to four digits; specs/form-definition.md, "Submissions". */
export function formatReference(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, "0")}`;
}
```

`form.ts`:

```ts
export type PublicState = "open" | "closed" | "not_open_yet" | "not_found";

/**
 * What the public sees at `/f/<slug>`. A form that never had a version does
 * not exist for the public; one that had one and is archived or closed shows
 * the closed message. See specs/use-cases/fill-and-submit-form.md.
 */
export function publicState(form: Form, now: Date): PublicState {
  const r = reachability(form, now);
  if (r.reachable) return "open";
  switch (r.reason) {
    case "draft":
      return "not_found";
    case "archived":
      return form.currentVersionId === null ? "not_found" : "closed";
    case "closed":
    case "past_close":
      return "closed";
    case "not_open_yet":
      return "not_open_yet";
  }
}
```

`form-repository.ts`: add

```ts
  /**
   * Takes the form's next reference number and advances the counter, inside
   * the unit of work; the caller holds the form row lock from findForUpdate.
   */
  takeReferenceNumber(uow: UnitOfWork, formId: string): Promise<number>;
```

`pg-form-repository.ts`:

```ts
  async takeReferenceNumber(uow: UnitOfWork, formId: string): Promise<number> {
    const { rows } = await txOf(uow).client.query<{ n: number }>(
      `update form set next_reference = next_reference + 1, updated_at = now()
        where id = $1 returning next_reference - 1 as n`,
      [formId],
    );
    const n = rows[0]?.n;
    if (n === undefined) throw new Error(`form ${formId} does not exist`);
    return n;
  }
```

`public-form.ts`:

```ts
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { publicState, type Form } from "../domain/form";
import { formatReference } from "../domain/reference";
import type { DefinitionsDeps } from "./deps";
import type { FormVersion } from "./ports/version-repository";

export type PublicFormResult =
  | { state: "open"; form: Form; version: FormVersion }
  | { state: "closed"; form: Form }
  | { state: "not_open_yet"; form: Form; opensAt: string }
  | { state: "not_found" };

/** The renderer's view of `/f/<slug>`. Read-only; see specs/architecture.md, "Submission data flow". */
export async function resolvePublicForm(deps: DefinitionsDeps, slug: string): Promise<PublicFormResult> {
  const form = await deps.forms.findBySlug(slug);
  if (form === null) return { state: "not_found" };
  const state = publicState(form, deps.clock.now());
  if (state === "not_found") return { state };
  if (state === "closed") return { state, form };
  if (state === "not_open_yet") return { state, form, opensAt: form.settings.opensAt ?? "" };
  const version = await deps.versions.findCurrent(form.id);
  return version === null ? { state: "not_found" } : { state: "open", form, version };
}

/** A version by id; versions are immutable, so any reader may cache the result. */
export function loadVersion(deps: DefinitionsDeps, versionId: string): Promise<FormVersion | null> {
  return deps.versions.findById(versionId);
}

export function loadForm(deps: DefinitionsDeps, formId: string): Promise<Form | null> {
  return deps.forms.findById(formId);
}

export type AllocateReferenceResult =
  | { ok: true; reference: string; form: Form }
  | { ok: false; state: "closed" | "not_open_yet" | "not_found" };

/**
 * Inside the intake's unit of work: locks the form row, decides again that
 * the form accepts submissions, and takes the next reference. A form closed
 * by a transaction that committed first refuses. See specs/system/database.md.
 */
export async function allocateReference(
  deps: DefinitionsDeps,
  uow: UnitOfWork,
  formId: string,
): Promise<AllocateReferenceResult> {
  const form = await deps.forms.findForUpdate(uow, formId);
  if (form === null) return { ok: false, state: "not_found" };
  const state = publicState(form, deps.clock.now());
  if (state !== "open") return { ok: false, state };
  const n = await deps.forms.takeReferenceNumber(uow, formId);
  return { ok: true, reference: formatReference(form.settings.referencePrefix, n), form };
}
```

`testing/fakes.ts`: `InMemoryFormRepository` gains `private readonly counters = new Map<string, number>()` and

```ts
  takeReferenceNumber(_uow: UnitOfWork, formId: string): Promise<number> {
    this.store.requireForm(formId);
    const n = this.counters.get(formId) ?? 1;
    this.counters.set(formId, n + 1);
    return Promise.resolve(n);
  }
```

and add the two seeding helpers:

```ts
/** Writes a published form and its version straight into the store; returns both ids. */
export async function seedPublished(
  deps: FakeDefinitionsDeps,
  input: { slug: string; document: Version; settings?: Partial<FormSettings>; status?: FormStatus },
): Promise<{ formId: string; versionId: string }> {
  const formId = await seedForm(deps, { slug: input.slug, languages: input.document.languages, title: input.document.title });
  const versionId = deps.ids.newId();
  deps.store.versions.set(versionId, {
    id: versionId, formId, number: 1, document: structuredClone(input.document),
    publishedAt: deps.clock.now(), publishedBy: EDITOR.email,
  });
  const stored = deps.store.forms.get(formId);
  if (!stored) throw new Error("seedPublished: form missing");
  deps.store.forms.set(formId, {
    ...stored, status: input.status ?? "published", currentVersionId: versionId, currentVersionNumber: 1,
    settings: { ...stored.settings, ...input.settings },
  });
  return { formId, versionId };
}

/** Publishes `document` as the form's next version and makes it current. */
export function publishAgain(deps: FakeDefinitionsDeps, formId: string, document: Version): string {
  const stored = deps.store.forms.get(formId);
  if (!stored) throw new Error("publishAgain: form missing");
  const number = (stored.currentVersionNumber ?? 0) + 1;
  const versionId = deps.ids.newId();
  deps.store.versions.set(versionId, { id: versionId, formId, number, document: structuredClone(document), publishedAt: deps.clock.now(), publishedBy: EDITOR.email });
  deps.store.forms.set(formId, { ...stored, currentVersionId: versionId, currentVersionNumber: number });
  return versionId;
}
```

(`seedForm` takes `title`, which must be complete for `languages`; the fixtures above pass complete titles.) `index.ts`: export `resolvePublicForm`, `loadVersion`, `loadForm`, `allocateReference`, `formatReference`, `publicState` and the types `PublicFormResult`, `AllocateReferenceResult`, `PublicState`.

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

- [ ] **Step 4: Implement.** `src/shared/presentation/copy.ts`, after `set.challenge_hint`:

```ts
  "set.challenge_unavailable": {
    en: "Not available yet: forms show no bot check even when this is on.",
    es: "Aún no está disponible: los formularios no muestran la verificación aunque esté activada.",
  },
```

`SettingsForm.tsx`, Protection section: the checkbox's `aria` call becomes `aria("challenge", [id("challenge", "hint"), id("challenge", "unavailable")])`, and after `{hint("challenge", "set.challenge_hint")}` add `{hint("challenge", "set.challenge_unavailable", "unavailable")}`.

- [ ] **Step 5: Run** `pnpm test && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 6: Commit** `feat(definitions): note in Settings that the bot challenge is not available yet`

---

### Task 16: Submissions domain: the in-progress record, navigation, protection and intake planning

**Files:**
- Create: `src/modules/submissions/domain/in-progress.ts`, `navigation.ts`, `locale.ts`, `protection.ts`, `dates.ts`, `intake.ts`, `submission.ts`, `testing/versions.ts`
- Test: `in-progress.test.ts`, `navigation.test.ts`, `locale.test.ts`, `protection.test.ts`, `intake.test.ts` beside them

**Interfaces:**
- Consumes: `validatePage`, `visiblePages`, `UploadLimits` (Task 4); form model exports.
- Produces:

```ts
// in-progress.ts
export const IN_PROGRESS_TTL_MS = 86_400_000;
export type RawValues = Record<string, string | string[]>;
export type FileIssueCode = "file_too_large" | "file_wrong_type" | "file_unreadable" | "upload_failed";
export interface FileIssue { fieldKey: string; code: FileIssueCode; file: string }
export interface PendingPage { pageKey: string; raw: RawValues; issues: ValidationIssue[]; fileIssues: FileIssue[] }
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

Decision (minimum fill time): 3 seconds from the page 1 render; `clampStartedAt` turns the first post's `_rendered` value into `started_at`, never in the future and never older than 24 hours, and an absent or unreadable value into the time of that post. Decision (honeypot): the input `website-url`; any non-blank value is a silent accept.

- [ ] **Step 1: The test fixture** `src/modules/submissions/domain/testing/versions.ts`:

```ts
import { buildDefaultRegistry, consentItems, parseDraft, type Version } from "@/shared/domain/form-model";
import type { LocalizedText } from "@/shared/domain/localized-text";

/** Synthetic three-page form shared by the submissions tests. */
export const registry = buildDefaultRegistry();

export const CONSENT_TEXT: LocalizedText = {
  en: "I am an adult and agree that Effluz keeps these synthetic answers for 12 months.",
  es: "Soy mayor de edad y acepto que Effluz guarde estas respuestas sintéticas durante 12 meses.",
};

export function storyVersion(): Version {
  const parsed = parseDraft(
    {
      languages: "bilingual",
      title: { en: "Stories", es: "Historias" },
      confirmation: {
        screen: { en: "Thank you.", es: "Gracias." },
        email: { subject: { en: "Thanks", es: "Gracias" }, body: { en: "We got it.", es: "Lo recibimos." } },
      },
      pages: [
        {
          key: "page_contact",
          title: { en: "Contact", es: "Contacto" },
          fields: [
            { key: "f_name", type: "short_text", label: { en: "Name", es: "Nombre" }, required: true },
            { key: "f_email", type: "email", label: { en: "Email", es: "Correo" }, settings: { isSubmitterAddress: true } },
            {
              key: "f_baby",
              type: "single_choice",
              label: { en: "Baby?", es: "¿Bebé?" },
              required: true,
              settings: { options: [{ key: "yes_opt", label: { en: "Yes", es: "Sí" } }, { key: "no_opt", label: { en: "No", es: "No" } }] },
            },
          ],
        },
        {
          key: "page_baby",
          title: { en: "Photos", es: "Fotos" },
          visibility: { field: "f_baby", op: "equals", value: "yes_opt" },
          fields: [
            {
              key: "f_photos",
              type: "file_upload",
              label: { en: "Photos", es: "Fotos" },
              required: true,
              validation: [{ rule: "min_files", value: 1 }],
              settings: { kinds: ["image", "video"], maxFiles: 3, maxSizeMb: 10 },
            },
          ],
        },
        {
          key: "page_consent",
          title: { en: "Consent", es: "Consentimiento" },
          fields: [
            { key: "f_consent", type: "consent", label: { en: "Consent", es: "Consentimiento" }, required: true,
              settings: { text: CONSENT_TEXT, coveredItems: [...consentItems] } },
          ],
        },
      ],
    },
    registry,
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.version;
}
```

- [ ] **Step 2: Failing tests.** `in-progress.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clampStartedAt, isExpired, newInProgress, removeUpload, withFileAnswers } from "./in-progress";

const now = new Date("2026-10-10T12:00:00Z");
const upload = (id: string) => ({ id, stagingRef: `in-progress/r/${id}.jpg`, kind: "image" as const, contentType: "image/jpeg", size: 1 });

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
});
```

`navigation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { firstPageKey, nextPageKey, pagePosition, previousPageKey } from "./navigation";
import { registry, storyVersion } from "./testing/versions";

describe("navigation", () => {
  const v = storyVersion();
  it("skips a hidden page in both directions and in the count", () => {
    expect(firstPageKey(v, registry)).toBe("page_contact");
    expect(nextPageKey(v, { f_baby: "no_opt" }, registry, "page_contact")).toBe("page_consent");
    expect(nextPageKey(v, { f_baby: "yes_opt" }, registry, "page_contact")).toBe("page_baby");
    expect(previousPageKey(v, { f_baby: "no_opt" }, registry, "page_consent")).toBe("page_contact");
    expect(nextPageKey(v, {}, registry, "page_consent")).toBeNull();
    expect(pagePosition(v, { f_baby: "no_opt" }, registry, "page_consent")).toEqual({ n: 2, total: 2 });
    expect(pagePosition(v, { f_baby: "yes_opt" }, registry, "page_consent")).toEqual({ n: 3, total: 3 });
  });
});
```

`locale.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { localeFor, pickLocale } from "./locale";

describe("pickLocale", () => {
  it("uses the form's only language, else the browser's preference, else Spanish", () => {
    expect(pickLocale("en", "es-PA,es;q=0.9")).toBe("en");
    expect(pickLocale("bilingual", "fr-FR,en-US;q=0.8,es;q=0.5")).toBe("en");
    expect(pickLocale("bilingual", "es;q=0.4,en;q=0.9")).toBe("en");
    expect(pickLocale("bilingual", "de, fr")).toBe("es");
    expect(pickLocale("bilingual", null)).toBe("es");
  });
  it("keeps a wanted locale only when the form offers it", () => {
    expect(localeFor("bilingual", "en")).toBe("en");
    expect(localeFor("es", "en")).toBe("es");
  });
});
```

`protection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decoyReference, isSilentAccept } from "./protection";

describe("isSilentAccept", () => {
  const startedAt = new Date("2026-10-10T12:00:00.000Z");
  it("catches a filled honeypot and anything faster than 3 seconds", () => {
    expect(isSilentAccept({ honeypot: "http://spam.example", startedAt, now: new Date("2026-10-10T12:05:00Z") })).toBe(true);
    expect(isSilentAccept({ honeypot: "", startedAt, now: new Date("2026-10-10T12:00:02.999Z") })).toBe(true);
    expect(isSilentAccept({ honeypot: "  ", startedAt, now: new Date("2026-10-10T12:00:03.000Z") })).toBe(false);
  });
  it("makes a four-digit decoy reference with the form's prefix", () => {
    expect(decoyReference("HP", () => 0)).toBe("HP-1000");
    expect(decoyReference("HP", () => 0.9999)).toBe("HP-9999");
  });
});
```

`intake.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { firstLanguage, firstPageWithIssue, planFiles, submitterAddress, uploadFields } from "./intake";
import { todayIn } from "./dates";
import { registry, storyVersion } from "./testing/versions";

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
    expect(firstPageWithIssue(v, [{ code: "consent", field: "f_consent" }, { code: "required", field: "f_photos" }])).toBe("page_baby");
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

- [ ] **Step 4: Implement.** `in-progress.ts`:

```ts
import type { ValidationIssue } from "@/shared/domain/form-model";
import type { Locale } from "@/shared/domain/localized-text";

/** In-progress records live 24 hours from creation; specs/use-cases/fill-and-submit-form.md. */
export const IN_PROGRESS_TTL_MS = 24 * 60 * 60 * 1000;

export type RawValues = Record<string, string | string[]>;
export type FileIssueCode = "file_too_large" | "file_wrong_type" | "file_unreadable" | "upload_failed";
/** A refused file of a post without script. `file` is the name the browser sent, kept for the message only. */
export interface FileIssue {
  fieldKey: string;
  code: FileIssueCode;
  file: string;
}
/** The last refused post of a page: what was typed and why it was refused, shown once. */
export interface PendingPage {
  pageKey: string;
  raw: RawValues;
  issues: ValidationIssue[];
  fileIssues: FileIssue[];
}
export interface StagedUpload {
  id: string;
  stagingRef: string;
  kind: "image" | "video";
  contentType: string;
  size: number;
}
export interface InProgress {
  id: string;
  formId: string;
  versionId: string;
  locale: Locale;
  pageKey: string;
  answers: Record<string, unknown>;
  files: Record<string, StagedUpload[]>;
  pending: PendingPage | null;
  submitToken: string;
  startedAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export function newInProgress(input: {
  id: string;
  formId: string;
  versionId: string;
  locale: Locale;
  pageKey: string;
  submitToken: string;
  startedAt: Date;
  now: Date;
}): InProgress {
  const { now, ...rest } = input;
  return {
    ...rest,
    answers: {},
    files: {},
    pending: null,
    expiresAt: new Date(now.getTime() + IN_PROGRESS_TTL_MS),
    createdAt: now,
    updatedAt: now,
  };
}

export function isExpired(record: Pick<InProgress, "expiresAt">, now: Date): boolean {
  return now.getTime() >= record.expiresAt.getTime();
}

/** The page 1 render time as the start of the minimum fill time; specs/system/security.md. */
export function clampStartedAt(renderedAt: Date | null, now: Date): Date {
  if (renderedAt === null || Number.isNaN(renderedAt.getTime())) return now;
  const earliest = now.getTime() - IN_PROGRESS_TTL_MS;
  return new Date(Math.min(now.getTime(), Math.max(renderedAt.getTime(), earliest)));
}

/** The answers with each upload field answered by its staged file ids, in upload order. */
export function withFileAnswers(
  answers: Readonly<Record<string, unknown>>,
  files: Readonly<Record<string, readonly StagedUpload[]>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...answers };
  for (const [key, uploads] of Object.entries(files)) out[key] = uploads.map((u) => u.id);
  return out;
}

export function removeUpload(
  files: Readonly<Record<string, readonly StagedUpload[]>>,
  fileId: string,
): { files: Record<string, StagedUpload[]>; removed: StagedUpload | null } {
  let removed: StagedUpload | null = null;
  const out: Record<string, StagedUpload[]> = {};
  for (const [key, uploads] of Object.entries(files)) {
    out[key] = uploads.filter((u) => {
      if (u.id !== fileId) return true;
      removed = u;
      return false;
    });
  }
  return { files: out, removed };
}
```

`navigation.ts`:

```ts
import { visiblePages, type FieldTypeRegistry, type Version } from "@/shared/domain/form-model";

type Answers = Readonly<Record<string, unknown>>;

export function visiblePageKeys(version: Version, answers: Answers, registry: FieldTypeRegistry): string[] {
  return visiblePages(version, answers, registry).map((p) => p.key);
}

export function firstPageKey(version: Version, registry: FieldTypeRegistry): string {
  return visiblePageKeys(version, {}, registry)[0] ?? version.pages[0]?.key ?? "";
}

export function nextPageKey(version: Version, answers: Answers, registry: FieldTypeRegistry, current: string): string | null {
  const visible = new Set(visiblePageKeys(version, answers, registry));
  const index = version.pages.findIndex((p) => p.key === current);
  return version.pages.slice(index + 1).find((p) => visible.has(p.key))?.key ?? null;
}

export function previousPageKey(version: Version, answers: Answers, registry: FieldTypeRegistry, current: string): string | null {
  const visible = new Set(visiblePageKeys(version, answers, registry));
  const index = version.pages.findIndex((p) => p.key === current);
  return [...version.pages.slice(0, Math.max(index, 0))].reverse().find((p) => visible.has(p.key))?.key ?? null;
}

/** "Page n of total" counts visible pages, so it changes when conditions do. */
export function pagePosition(version: Version, answers: Answers, registry: FieldTypeRegistry, current: string): { n: number; total: number } {
  const visible = visiblePageKeys(version, answers, registry);
  const index = visible.indexOf(current);
  if (index >= 0) return { n: index + 1, total: visible.length };
  const at = version.pages.findIndex((p) => p.key === current);
  const before = version.pages.slice(0, Math.max(at, 0)).filter((p) => visible.includes(p.key)).length;
  return { n: before + 1, total: visible.length + 1 };
}
```

`locale.ts`:

```ts
import { requiredLocales, type Languages, type Locale } from "@/shared/domain/localized-text";

/** Bilingual forms follow the browser, falling back to Spanish; specs/use-cases/fill-and-submit-form.md. */
export function pickLocale(languages: Languages, acceptLanguage: string | null): Locale {
  if (languages !== "bilingual") return languages;
  const ranked = (acceptLanguage ?? "")
    .split(",")
    .map((part, order) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { base: tag.toLowerCase().split("-")[0] ?? "", q: q ? Number(q.slice(2)) : 1, order };
    })
    .filter((x) => x.base !== "" && x.q > 0)
    .sort((a, b) => b.q - a.q || a.order - b.order);
  const hit = ranked.find((x) => x.base === "en" || x.base === "es");
  return hit ? (hit.base as Locale) : "es";
}

export function localeFor(languages: Languages, wanted: Locale): Locale {
  const offered = requiredLocales(languages);
  return offered.includes(wanted) ? wanted : (offered[0] ?? "es");
}
```

`protection.ts`:

```ts
/** Cheap abuse protection before any bot challenge; specs/system/security.md. */
export const MIN_FILL_MS = 3_000;
export const HONEYPOT_FIELD = "website-url";

export function isSilentAccept(input: { honeypot: string; startedAt: Date; now: Date }): boolean {
  return input.honeypot.trim() !== "" || input.now.getTime() - input.startedAt.getTime() < MIN_FILL_MS;
}

/** A plausible reference for the silent-accept confirmation; nothing is stored under it. */
export function decoyReference(prefix: string, random: () => number): string {
  return `${prefix}-${String(1000 + Math.floor(random() * 9000))}`;
}
```

`dates.ts`:

```ts
/** Today's date in `timeZone`, as YYYY-MM-DD, for the `not_future` rule. */
export function todayIn(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
```

`intake.ts`:

```ts
import type { Field, FieldTypeRegistry, UploadLimits, ValidationIssue, Version } from "@/shared/domain/form-model";
import type { Languages, Locale } from "@/shared/domain/localized-text";
import type { StagedUpload } from "./in-progress";

/** Fields that take files, found through the `uploadLimits` hook (ADR 0016). */
export function uploadFields(version: Version, registry: FieldTypeRegistry): { field: Field; limits: UploadLimits }[] {
  return version.pages.flatMap((p) =>
    p.fields.flatMap((field) => {
      const limits = registry.get(field.type).uploadLimits?.(field.settings);
      return limits ? [{ field, limits }] : [];
    }),
  );
}

/** The language field slugs come from; specs/system/media-storage.md, "Keys". */
export function firstLanguage(languages: Languages): Locale {
  return languages === "es" ? "es" : "en";
}

export interface PlannedFile {
  fieldKey: string;
  position: number;
  upload: StagedUpload;
}

/** Files the validated answers name are attached in answer order; every other staged file is discarded. */
export function planFiles(
  answers: Readonly<Record<string, unknown>>,
  files: Readonly<Record<string, readonly StagedUpload[]>>,
): { attached: PlannedFile[]; discarded: StagedUpload[] } {
  const attached: PlannedFile[] = [];
  const discarded: StagedUpload[] = [];
  for (const [fieldKey, uploads] of Object.entries(files)) {
    const answer = answers[fieldKey];
    const ids = Array.isArray(answer) ? answer.filter((x): x is string => typeof x === "string") : [];
    const byId = new Map(uploads.map((u) => [u.id, u]));
    ids.forEach((id, i) => {
      const upload = byId.get(id);
      if (upload) attached.push({ fieldKey, position: i + 1, upload });
      byId.delete(id);
    });
    discarded.push(...byId.values());
  }
  return { attached, discarded };
}

/** The answer of the field holding the `submitter_address` role, when it has one. */
export function submitterAddress(
  version: Version,
  registry: FieldTypeRegistry,
  answers: Readonly<Record<string, unknown>>,
): string | null {
  for (const page of version.pages) {
    for (const field of page.fields) {
      const roles = registry.get(field.type).exclusiveRoles?.(field.settings) ?? [];
      if (roles.some((r) => r.role === "submitter_address")) {
        const value = answers[field.key];
        return typeof value === "string" && value !== "" ? value : null;
      }
    }
  }
  return null;
}

export function firstPageWithIssue(version: Version, issues: readonly ValidationIssue[]): string | null {
  const keys = new Set(issues.map((i) => i.field));
  return version.pages.find((p) => p.fields.some((f) => keys.has(f.key)))?.key ?? null;
}
```

`submission.ts`:

```ts
import type { Locale } from "@/shared/domain/localized-text";

/** A completed response; specs/form-definition.md, "Submissions". Answers never change after insert. */
export interface Submission {
  id: string;
  formId: string;
  versionId: string;
  locale: Locale;
  answers: Record<string, unknown>;
  consent: { fieldKey: string; textVersion: string; acceptedAt: Date } | null;
  receivedAt: Date;
  reference: string;
  submitToken: string;
}
```

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

- [ ] **Step 1: Test factory** `tests/integration/submissions/factories.ts`:

```ts
import type { Pool } from "pg";
import type { Version } from "@/shared/domain/form-model";
import { PgFormRepository } from "@/modules/definitions/infrastructure/pg-form-repository";
import { PgVersionRepository } from "@/modules/definitions/infrastructure/pg-version-repository";
import { storyVersion } from "@/modules/submissions/domain/testing/versions";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { sampleForm, sampleVersion } from "../definitions/factories";

/** A published form holding `document` (the synthetic story form by default). */
export async function seedPublishedForm(
  pool: Pool,
  document: Version = storyVersion(),
): Promise<{ formId: string; versionId: string; slug: string }> {
  const forms = new PgFormRepository(pool);
  const versions = new PgVersionRepository(pool);
  const form = sampleForm({ status: "published", languages: document.languages });
  const version = { ...sampleVersion(form.id, 1), document };
  await new PgUnitOfWorkFactory(pool).run(async (uow) => {
    await forms.insert(uow, form);
    await versions.insert(uow, version);
    await forms.update(uow, { ...form, currentVersionId: version.id, currentVersionNumber: 1 });
  });
  return { formId: form.id, versionId: version.id, slug: form.slug };
}
```

- [ ] **Step 2: Failing integration tests.** `pg-in-progress-repository.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { newInProgress } from "@/modules/submissions/domain/in-progress";
import { PgInProgressRepository } from "@/modules/submissions/infrastructure/pg-in-progress-repository";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";
import { seedPublishedForm } from "./factories";

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
      pending: { pageKey: "page_contact", raw: { f_email: "nope" }, issues: [{ code: "email_syntax" as const, field: "f_email" }], fileIssues: [] },
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

  it("lists expired ids, oldest first, and deletes", async () => {
    const { formId, versionId } = await seedPublishedForm(pool);
    const old = newInProgress({ id: randomUUID(), formId, versionId, locale: "en", pageKey: "page_contact", submitToken: randomUUID(), startedAt: new Date("2026-10-08T00:00:00Z"), now: new Date("2026-10-08T00:00:00Z") });
    const fresh = newInProgress({ id: randomUUID(), formId, versionId, locale: "en", pageKey: "page_contact", submitToken: randomUUID(), startedAt: new Date("2026-10-10T00:00:00Z"), now: new Date("2026-10-10T00:00:00Z") });
    await uow.run(async (u) => {
      await repo.insert(u, fresh);
      await repo.insert(u, old);
    });
    expect(await repo.listExpired(new Date("2026-10-10T12:00:00Z"), 10)).toEqual([old.id]);
    await uow.run((u) => repo.delete(u, old.id));
    expect(await repo.find(old.id)).toBeNull();
  });
});
```

`pg-submission-repository.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Submission } from "@/modules/submissions/domain/submission";
import { PgSubmissionRepository } from "@/modules/submissions/infrastructure/pg-submission-repository";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";
import { seedPublishedForm } from "./factories";

describe("PgSubmissionRepository", () => {
  const pool = testPool();
  const repo = new PgSubmissionRepository(pool);
  const uow = new PgUnitOfWorkFactory(pool);
  beforeEach(() => truncateAll(pool));

  async function sample(over: Partial<Submission> = {}): Promise<Submission> {
    const { formId, versionId } = await seedPublishedForm(pool);
    return {
      id: randomUUID(), formId, versionId, locale: "es", answers: { f_name: "Ana Prueba" },
      consent: { fieldKey: "f_consent", textVersion: "0123456789abcdef", acceptedAt: new Date("2026-10-10T12:00:00.000Z") },
      receivedAt: new Date("2026-10-10T12:00:00.000Z"), reference: "ST-0001", submitToken: randomUUID(), ...over,
    };
  }

  it("inserts, finds by id and by submit token", async () => {
    const s = await sample();
    expect(await uow.run((u) => repo.insert(u, s))).toBe("inserted");
    expect(await repo.findById(s.id)).toEqual(s);
    expect(await repo.findBySubmitToken(s.submitToken)).toEqual(s);
    expect(await repo.findBySubmitToken("nope")).toBeNull();
  });

  it("reports a repeated submit token without aborting the transaction", async () => {
    const s = await sample();
    await uow.run(async (u) => {
      await repo.insert(u, s);
      expect(await repo.insert(u, { ...s, id: randomUUID(), reference: "ST-0002" })).toBe("duplicate_token");
      expect(await repo.findById(s.id)).toBeNull(); // not yet committed: the pool reads outside the transaction
    });
    expect(await repo.findById(s.id)).not.toBeNull();
  });

  it("refuses any change to answers, but not to the status", async () => {
    const s = await sample();
    await uow.run((u) => repo.insert(u, s));
    await expect(pool.query("update submission set answers = '{}' where id = $1", [s.id])).rejects.toThrow(/immutable/);
    await pool.query("update submission set status = 'viewed' where id = $1", [s.id]);
  });
});
```

`pg-submission-stats.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { PgSubmissionRepository } from "@/modules/submissions/infrastructure/pg-submission-repository";
import { PgSubmissionStats } from "@/modules/submissions/infrastructure/pg-submission-stats";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { testPool, truncateAll } from "../db";
import { seedPublishedForm } from "./factories";

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
    expect(await stats.answerCounts(formId, ["f_name", "f_email", "f_missing"])).toEqual(new Map([["f_name", 3], ["f_email", 1], ["f_missing", 0]]));
    expect(await stats.hasAny(formId)).toBe(true);
    expect(await stats.hasAny(other)).toBe(false);
  });
});
```

- [ ] **Step 3: Run** `pnpm test:integration tests/integration/submissions`: fails.

- [ ] **Step 4: Implement** the two ports exactly as in Interfaces, the migration above, then `pg-in-progress-repository.ts`:

```ts
import type { Pool } from "pg";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { txOf } from "@/shared/infrastructure/postgres/tx";
import { isUuid } from "@/shared/infrastructure/uuid";
import type { InProgressRepository } from "../application/ports/in-progress-repository";
import type { InProgress, PendingPage, StagedUpload } from "../domain/in-progress";
import type { Locale } from "@/shared/domain/localized-text";

const COLUMNS = `id, form_id, form_version_id, locale, page_key, answers, files, pending, submit_token,
  started_at, expires_at, created_at, updated_at`;

interface Row {
  id: string;
  form_id: string;
  form_version_id: string;
  locale: Locale;
  page_key: string;
  answers: Record<string, unknown>;
  files: Record<string, StagedUpload[]>;
  pending: PendingPage | null;
  submit_token: string;
  started_at: Date;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

function toRecord(r: Row): InProgress {
  return {
    id: r.id, formId: r.form_id, versionId: r.form_version_id, locale: r.locale, pageKey: r.page_key,
    answers: r.answers, files: r.files, pending: r.pending, submitToken: r.submit_token,
    startedAt: r.started_at, expiresAt: r.expires_at, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** `submission_in_progress`. The row holds personal data: never logged, gone at submit or expiry. */
export class PgInProgressRepository implements InProgressRepository {
  constructor(private readonly pool: Pool) {}

  async insert(uow: UnitOfWork, r: InProgress): Promise<void> {
    await txOf(uow).client.query(
      `insert into submission_in_progress (${COLUMNS}) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [r.id, r.formId, r.versionId, r.locale, r.pageKey, JSON.stringify(r.answers), JSON.stringify(r.files),
        r.pending === null ? null : JSON.stringify(r.pending), r.submitToken, r.startedAt, r.expiresAt, r.createdAt, r.updatedAt],
    );
  }

  async find(id: string): Promise<InProgress | null> {
    if (!isUuid(id)) return null;
    const { rows } = await this.pool.query<Row>(`select ${COLUMNS} from submission_in_progress where id = $1`, [id]);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findForUpdate(uow: UnitOfWork, id: string): Promise<InProgress | null> {
    if (!isUuid(id)) return null;
    const { rows } = await txOf(uow).client.query<Row>(
      `select ${COLUMNS} from submission_in_progress where id = $1 for update`,
      [id],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async update(uow: UnitOfWork, r: InProgress): Promise<void> {
    await txOf(uow).client.query(
      `update submission_in_progress
          set locale = $2, page_key = $3, answers = $4, files = $5, pending = $6, updated_at = $7
        where id = $1`,
      [r.id, r.locale, r.pageKey, JSON.stringify(r.answers), JSON.stringify(r.files),
        r.pending === null ? null : JSON.stringify(r.pending), r.updatedAt],
    );
  }

  async delete(uow: UnitOfWork, id: string): Promise<void> {
    await txOf(uow).client.query("delete from submission_in_progress where id = $1", [id]);
  }

  async listExpired(now: Date, limit: number): Promise<string[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      "select id from submission_in_progress where expires_at <= $1 order by expires_at limit $2",
      [now, limit],
    );
    return rows.map((r) => r.id);
  }
}
```

`pg-submission-repository.ts`:

```ts
import type { Pool } from "pg";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import type { Locale } from "@/shared/domain/localized-text";
import { txOf } from "@/shared/infrastructure/postgres/tx";
import { isUuid } from "@/shared/infrastructure/uuid";
import type { SubmissionRepository } from "../application/ports/submission-repository";
import type { Submission } from "../domain/submission";

const COLUMNS = "id, form_id, form_version_id, locale, answers, consent, received_at, reference, submit_token";

interface Row {
  id: string;
  form_id: string;
  form_version_id: string;
  locale: Locale;
  answers: Record<string, unknown>;
  consent: { fieldKey: string; textVersion: string; acceptedAt: string } | null;
  received_at: Date;
  reference: string;
  submit_token: string;
}

function toSubmission(r: Row): Submission {
  return {
    id: r.id, formId: r.form_id, versionId: r.form_version_id, locale: r.locale, answers: r.answers,
    consent: r.consent === null ? null : { ...r.consent, acceptedAt: new Date(r.consent.acceptedAt) },
    receivedAt: r.received_at, reference: r.reference, submitToken: r.submit_token,
  };
}

/** `submission`. Answers are written once; the trigger refuses any later change. */
export class PgSubmissionRepository implements SubmissionRepository {
  constructor(private readonly pool: Pool) {}

  async insert(uow: UnitOfWork, s: Submission): Promise<"inserted" | "duplicate_token"> {
    const res = await txOf(uow).client.query(
      `insert into submission (${COLUMNS}) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (submit_token) do nothing returning id`,
      [s.id, s.formId, s.versionId, s.locale, JSON.stringify(s.answers),
        s.consent === null ? null : JSON.stringify(s.consent), s.receivedAt, s.reference, s.submitToken],
    );
    return res.rowCount === 1 ? "inserted" : "duplicate_token";
  }

  async findBySubmitToken(token: string): Promise<Submission | null> {
    if (!isUuid(token)) return null;
    const { rows } = await this.pool.query<Row>(`select ${COLUMNS} from submission where submit_token = $1`, [token]);
    return rows[0] ? toSubmission(rows[0]) : null;
  }

  async findById(id: string): Promise<Submission | null> {
    if (!isUuid(id)) return null;
    const { rows } = await this.pool.query<Row>(`select ${COLUMNS} from submission where id = $1`, [id]);
    return rows[0] ? toSubmission(rows[0]) : null;
  }
}
```

`pg-submission-stats.ts`:

```ts
import type { Pool } from "pg";
import type { SubmissionStats, SubmissionSummary } from "@/modules/definitions/application";
import type { Key } from "@/shared/domain/form-model";
import { isUuid } from "@/shared/infrastructure/uuid";

/** The submission figures definitions needs (its SubmissionStats port), from the `submission` table. */
export class PgSubmissionStats implements SubmissionStats {
  constructor(private readonly pool: Pool) {}

  async summary(formIds: readonly string[]): Promise<Map<string, SubmissionSummary>> {
    const ids = formIds.filter(isUuid);
    const result = new Map<string, SubmissionSummary>(formIds.map((id) => [id, { total: 0, lastReceivedAt: null }]));
    if (ids.length === 0) return result;
    const { rows } = await this.pool.query<{ form_id: string; total: number; last: Date }>(
      `select form_id, count(*)::int as total, max(received_at) as last
         from submission where form_id = any($1::uuid[]) group by form_id`,
      [ids],
    );
    for (const r of rows) result.set(r.form_id, { total: r.total, lastReceivedAt: r.last });
    return result;
  }

  async countReceivedAfter(formId: string, after: Date): Promise<number> {
    if (!isUuid(formId)) return 0;
    const { rows } = await this.pool.query<{ n: number }>(
      "select count(*)::int as n from submission where form_id = $1 and received_at > $2",
      [formId, after],
    );
    return rows[0]?.n ?? 0;
  }

  async countOlderThan(formId: string, months: number, now: Date): Promise<number> {
    if (!isUuid(formId)) return 0;
    const { rows } = await this.pool.query<{ n: number }>(
      `select count(*)::int as n from submission
        where form_id = $1 and received_at < $3::timestamptz - make_interval(months => $2)`,
      [formId, months, now],
    );
    return rows[0]?.n ?? 0;
  }

  async answerCounts(formId: string, keys: readonly Key[]): Promise<Map<Key, number>> {
    const result = new Map<Key, number>(keys.map((k) => [k, 0]));
    if (!isUuid(formId) || keys.length === 0) return result;
    const { rows } = await this.pool.query<{ key: Key; n: number }>(
      `select k as key, count(*)::int as n
         from submission, jsonb_object_keys(answers) as k
        where form_id = $1 and k = any($2::text[]) group by k`,
      [formId, keys],
    );
    for (const r of rows) result.set(r.key, r.n);
    return result;
  }

  async hasAny(formId: string): Promise<boolean> {
    if (!isUuid(formId)) return false;
    const { rows } = await this.pool.query<{ any: boolean }>(
      "select exists (select 1 from submission where form_id = $1) as any",
      [formId],
    );
    return rows[0]?.any ?? false;
  }
}
```

- [ ] **Step 5: Run** `pnpm test:integration tests/integration/submissions && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 6: Commit** `feat(submissions): in-progress and submission tables with immutable answers, repositories and Postgres submission stats`

---

### Task 18: Submissions application: dependencies, fakes, post context and the form view

**Files:**
- Create: `src/modules/submissions/application/deps.ts`, `fill-state.ts`, `version-cache.ts`, `post-context.ts`, `view-form.ts`, `index.ts`, `testing/fakes.ts`
- Test: `version-cache.test.ts`, `view-form.test.ts`, `post-context.test.ts` beside them; `tests/boundaries/boundaries.test.ts` (one probe)

**Interfaces:**
- Consumes: Tasks 14, 16, 17; `MediaDeps`, `makeMediaDeps` (Task 6); `makeDefinitionsDeps`, `seedPublished`, `publishAgain` (Task 14).
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
  | { kind: "show"; recordId: string } | { kind: "submitted"; submitToken: string } | { kind: "decoy"; reference: string }
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

The version cache is per process and keyed by version id, which is safe because versions never change (architecture.md, "Publishing data flow" step 4).

- [ ] **Step 1: Fakes** `testing/fakes.ts`:

```ts
/** Fakes for the submissions use cases: one clock, id generator and queue shared by every module. */
import {
  makeDefinitionsDeps,
  seedPublished,
  type FakeDefinitionsDeps,
} from "@/modules/definitions/application/testing/fakes";
import type { FormSettings } from "@/modules/definitions/application";
import { makeMediaDeps, type FakeMediaDeps } from "@/modules/media/application/testing/fakes";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import {
  FakeUnitOfWorkFactory,
  FixedClock,
  InMemoryJobQueue,
  RecordingLogger,
  SequentialIdGenerator,
} from "@/shared/application/testing/fakes";
import type { InProgress } from "../../domain/in-progress";
import type { Submission } from "../../domain/submission";
import { registry, storyVersion } from "../../domain/testing/versions";
import type { SubmissionsDeps } from "../deps";
import type { PagePost } from "../fill-state";
import type { InProgressRepository } from "../ports/in-progress-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { VersionCache } from "../version-cache";

export class InMemoryInProgressRepository implements InProgressRepository {
  readonly rows = new Map<string, InProgress>();
  insert(_uow: UnitOfWork, record: InProgress): Promise<void> {
    if (this.rows.has(record.id)) return Promise.reject(new Error("record exists"));
    this.rows.set(record.id, structuredClone(record));
    return Promise.resolve();
  }
  find(id: string): Promise<InProgress | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row ? structuredClone(row) : null);
  }
  findForUpdate(_uow: UnitOfWork, id: string): Promise<InProgress | null> {
    return this.find(id);
  }
  update(_uow: UnitOfWork, record: InProgress): Promise<void> {
    if (!this.rows.has(record.id)) return Promise.reject(new Error("no such record"));
    this.rows.set(record.id, structuredClone(record));
    return Promise.resolve();
  }
  delete(_uow: UnitOfWork, id: string): Promise<void> {
    this.rows.delete(id);
    return Promise.resolve();
  }
  listExpired(now: Date, limit: number): Promise<string[]> {
    return Promise.resolve(
      [...this.rows.values()].filter((r) => r.expiresAt.getTime() <= now.getTime()).slice(0, limit).map((r) => r.id),
    );
  }
}

export class InMemorySubmissionRepository implements SubmissionRepository {
  readonly rows = new Map<string, Submission>();
  insert(_uow: UnitOfWork, s: Submission): Promise<"inserted" | "duplicate_token"> {
    if ([...this.rows.values()].some((r) => r.submitToken === s.submitToken)) return Promise.resolve("duplicate_token");
    this.rows.set(s.id, structuredClone(s));
    return Promise.resolve("inserted");
  }
  findBySubmitToken(token: string): Promise<Submission | null> {
    const found = [...this.rows.values()].find((r) => r.submitToken === token);
    return Promise.resolve(found ? structuredClone(found) : null);
  }
  findById(id: string): Promise<Submission | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row ? structuredClone(row) : null);
  }
}

export interface FakeSubmissionsDeps extends SubmissionsDeps {
  definitions: FakeDefinitionsDeps;
  media: FakeMediaDeps;
  inProgress: InMemoryInProgressRepository;
  submissions: InMemorySubmissionRepository;
  queue: InMemoryJobQueue;
  clock: FixedClock;
  logger: RecordingLogger;
}

export function makeSubmissionsDeps(): FakeSubmissionsDeps {
  const clock = new FixedClock();
  const ids = new SequentialIdGenerator();
  const queue = new InMemoryJobQueue();
  const uow = new FakeUnitOfWorkFactory();
  return {
    definitions: makeDefinitionsDeps({ clock, ids, uow, registry }),
    media: makeMediaDeps({ clock, ids, queue, uow }),
    inProgress: new InMemoryInProgressRepository(),
    submissions: new InMemorySubmissionRepository(),
    queue,
    uow,
    clock,
    ids,
    registry,
    logger: new RecordingLogger(),
    versions: new VersionCache(),
    random: () => 0.5,
  };
}

export async function publishStory(
  deps: FakeSubmissionsDeps,
  settings: Partial<FormSettings> = {},
): Promise<{ formId: string; versionId: string; slug: "story-form" }> {
  const seeded = await seedPublished(deps.definitions, {
    slug: "story-form",
    document: storyVersion(),
    settings: { referencePrefix: "ST", notificationRecipients: ["stories@example.com"], ...settings },
  });
  return { ...seeded, slug: "story-form" };
}

export function post(over: Partial<PagePost> = {}): PagePost {
  return {
    pageKey: "page_contact",
    action: { kind: "next" },
    answers: {},
    decodeIssues: [],
    raw: {},
    incoming: [],
    renderedAt: null,
    honeypot: "",
    submitToken: null,
    acceptLanguage: "es",
    state: { kind: "none" },
    ...over,
  };
}
```

- [ ] **Step 2: Failing tests.** `version-cache.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeSubmissionsDeps, publishStory } from "./testing/fakes";
import { VersionCache } from "./version-cache";

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
import { describe, expect, it } from "vitest";
import { newInProgress } from "../domain/in-progress";
import { viewForm } from "./view-form";
import { makeSubmissionsDeps, publishStory } from "./testing/fakes";

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

  it("shows the gate screens and the expired screen", async () => {
    const deps = makeSubmissionsDeps();
    const { formId } = await publishStory(deps);
    expect((await viewForm(deps, { slug: "nope", state: { kind: "none" }, acceptLanguage: null, expired: false })).screen).toBe("not_found");
    expect((await viewForm(deps, { slug: "story-form", state: { kind: "record", id: "00000000-0000-4000-8000-00000000abcd" }, acceptLanguage: null, expired: false })).screen).toBe("expired");
    expect((await viewForm(deps, { slug: "story-form", state: { kind: "none" }, acceptLanguage: null, expired: true })).screen).toBe("expired");
    const stored = deps.definitions.store.forms.get(formId);
    if (stored) deps.definitions.store.forms.set(formId, { ...stored, status: "closed" });
    expect((await viewForm(deps, { slug: "story-form", state: { kind: "none" }, acceptLanguage: null, expired: false })).screen).toBe("closed");
  });

  it("shows a record's page on its pinned version, with the pending post once", async () => {
    const deps = makeSubmissionsDeps();
    const { formId, versionId } = await publishStory(deps);
    const now = deps.clock.now();
    const record = {
      ...newInProgress({ id: "00000000-0000-4000-8000-0000000000aa", formId, versionId, locale: "es", pageKey: "page_contact", submitToken: "00000000-0000-4000-8000-0000000000bb", startedAt: now, now }),
      pending: { pageKey: "page_contact", raw: { f_name: "" }, issues: [{ code: "required" as const, field: "f_name" }], fileIssues: [] },
    };
    await deps.inProgress.insert(await deps.uow.begin(), record);
    const view = await viewForm(deps, { slug: "story-form", state: { kind: "record", id: record.id }, acceptLanguage: "en", expired: false });
    expect(view.screen === "page" && view.page.pending?.issues).toEqual([{ code: "required", field: "f_name" }]);
    expect(view.screen === "page" && view.page.locale).toBe("es");
  });

  it("shows the confirmation for a done cookie and for a decoy", async () => {
    const deps = makeSubmissionsDeps();
    const { formId, versionId } = await publishStory(deps);
    await deps.submissions.insert(await deps.uow.begin(), {
      id: "00000000-0000-4000-8000-0000000000cc", formId, versionId, locale: "en", answers: {}, consent: null,
      receivedAt: deps.clock.now(), reference: "ST-0007", submitToken: "00000000-0000-4000-8000-0000000000dd",
    });
    const done = await viewForm(deps, { slug: "story-form", state: { kind: "done", submitToken: "00000000-0000-4000-8000-0000000000dd" }, acceptLanguage: "es", expired: false });
    expect(done).toMatchObject({ screen: "confirmation", reference: "ST-0007", locale: "en" });
    const decoy = await viewForm(deps, { slug: "story-form", state: { kind: "decoy", reference: "ST-4321" }, acceptLanguage: "es", expired: false });
    expect(decoy).toMatchObject({ screen: "confirmation", reference: "ST-4321", locale: "es" });
  });
});
```

`post-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { newInProgress } from "../domain/in-progress";
import { postContext } from "./post-context";
import { makeSubmissionsDeps, publishStory } from "./testing/fakes";

describe("postContext", () => {
  it("answers submitted for a repeated Submit whose record is gone", async () => {
    const deps = makeSubmissionsDeps();
    const { formId, versionId } = await publishStory(deps);
    const token = "00000000-0000-4000-8000-0000000000dd";
    await deps.submissions.insert(await deps.uow.begin(), {
      id: "00000000-0000-4000-8000-0000000000cc", formId, versionId, locale: "en", answers: {}, consent: null,
      receivedAt: deps.clock.now(), reference: "ST-0001", submitToken: token,
    });
    const gone = await postContext(deps, { slug: "story-form", state: { kind: "record", id: "00000000-0000-4000-8000-0000000000aa" }, submitToken: token });
    expect(gone).toEqual({ ok: false, outcome: { kind: "submitted", submitToken: token } });
    const again = await postContext(deps, { slug: "story-form", state: { kind: "done", submitToken: token }, submitToken: token });
    expect(again).toEqual({ ok: false, outcome: { kind: "submitted", submitToken: token } });
  });

  it("refuses a record of another form or past its 24 hours as expired", async () => {
    const deps = makeSubmissionsDeps();
    const { formId, versionId } = await publishStory(deps);
    const now = deps.clock.now();
    const record = newInProgress({ id: "00000000-0000-4000-8000-0000000000aa", formId, versionId, locale: "es", pageKey: "page_contact", submitToken: "00000000-0000-4000-8000-0000000000bb", startedAt: now, now });
    await deps.inProgress.insert(await deps.uow.begin(), record);
    deps.clock.advance(24 * 60 * 60 * 1000);
    expect(await postContext(deps, { slug: "story-form", state: { kind: "record", id: record.id }, submitToken: null })).toEqual({ ok: false, outcome: { kind: "expired" } });
  });
});
```

Boundary probe, inside `describe("layer boundaries")`:

```ts
  it("forbids definitions importing submissions, which would make a cycle", async () => {
    const rules = await lintVirtual(
      "src/modules/definitions/application/boundary-probe-subs.ts",
      `import { viewForm } from "@/modules/submissions/application";\nexport const v = viewForm;\n`,
    );
    expect(rules.map((m) => m.ruleId)).toContain("boundaries/dependencies");
  });
```

- [ ] **Step 3: Run** `pnpm test src/modules/submissions tests/boundaries`: fails.

- [ ] **Step 4: Implement** `deps.ts` and `fill-state.ts` exactly as in Interfaces (types only), then `version-cache.ts`:

```ts
import { loadVersion, type DefinitionsDeps, type FormVersion } from "@/modules/definitions/application";

/**
 * The per-process definition cache keyed by version id (specs/architecture.md,
 * "Publishing data flow" step 4). Versions are immutable, so nothing invalidates it.
 */
export class VersionCache {
  private readonly entries = new Map<string, FormVersion>();

  constructor(private readonly max = 100) {}

  async get(definitions: DefinitionsDeps, id: string): Promise<FormVersion | null> {
    const hit = this.entries.get(id);
    if (hit) {
      this.entries.delete(id);
      this.entries.set(id, hit);
      return hit;
    }
    const version = await loadVersion(definitions, id);
    if (version) {
      this.entries.set(id, version);
      if (this.entries.size > this.max) {
        const oldest = this.entries.keys().next();
        if (!oldest.done) this.entries.delete(oldest.value);
      }
    }
    return version;
  }
}
```

`post-context.ts`:

```ts
import { resolvePublicForm, type Form, type FormVersion } from "@/modules/definitions/application";
import { isExpired, type InProgress } from "../domain/in-progress";
import type { SubmissionsDeps } from "./deps";
import type { FillState, PostOutcome } from "./fill-state";

export interface OpenContext {
  form: Form;
  version: FormVersion;
  record: InProgress | null;
}
export type PostContext = ({ ok: true } & OpenContext) | { ok: false; outcome: PostOutcome };

/**
 * What a post works against: the open form, and the record with its pinned
 * version, or the current version when there is no record yet. A Submit that
 * already went through (its record gone, its token known) answers submitted.
 * Read without locks; the use cases lock the record before writing.
 */
export async function postContext(
  deps: SubmissionsDeps,
  input: { slug: string; state: FillState; submitToken: string | null },
): Promise<PostContext> {
  const resolved = await resolvePublicForm(deps.definitions, input.slug);
  if (resolved.state !== "open") return { ok: false, outcome: { kind: "gate", state: resolved.state } };
  const token = input.state.kind === "done" ? input.state.submitToken : input.submitToken;
  const alreadySubmitted = async (): Promise<PostContext | null> => {
    if (token === null) return null;
    const done = await deps.submissions.findBySubmitToken(token);
    return done !== null && done.formId === resolved.form.id
      ? { ok: false, outcome: { kind: "submitted", submitToken: done.submitToken } }
      : null;
  };
  if (input.state.kind === "done") {
    const answered = await alreadySubmitted();
    if (answered) return answered;
  }
  if (input.state.kind !== "record") {
    return { ok: true, form: resolved.form, version: resolved.version, record: null };
  }
  const record = await deps.inProgress.find(input.state.id);
  if (record === null) return (await alreadySubmitted()) ?? { ok: false, outcome: { kind: "expired" } };
  if (record.formId !== resolved.form.id || isExpired(record, deps.clock.now())) {
    return { ok: false, outcome: { kind: "expired" } };
  }
  const version = await deps.versions.get(deps.definitions, record.versionId);
  if (version === null) return { ok: false, outcome: { kind: "expired" } };
  return { ok: true, form: resolved.form, version, record };
}
```

`view-form.ts`:

```ts
import { loadForm, resolvePublicForm, type Form, type FormVersion } from "@/modules/definitions/application";
import type { Locale } from "@/shared/domain/localized-text";
import { isExpired, withFileAnswers, type InProgress, type PendingPage, type StagedUpload } from "../domain/in-progress";
import { pickLocale } from "../domain/locale";
import { firstPageKey, nextPageKey, pagePosition, previousPageKey } from "../domain/navigation";
import type { SubmissionsDeps } from "./deps";
import type { FillState } from "./fill-state";

export interface PageView {
  locale: Locale;
  pageKey: string;
  position: { n: number; total: number };
  isFirst: boolean;
  isLast: boolean;
  answers: Record<string, unknown>;
  files: Record<string, StagedUpload[]>;
  pending: PendingPage | null;
  submitToken: string | null;
  renderedAt: Date;
  hasRecord: boolean;
}

export type ViewResult =
  | { screen: "not_found" }
  | { screen: "closed"; form: Form }
  | { screen: "not_open"; form: Form; opensAt: string }
  | { screen: "expired"; form: Form }
  | { screen: "confirmation"; form: Form; version: FormVersion; locale: Locale; reference: string }
  | { screen: "page"; form: Form; version: FormVersion; page: PageView };

function pageOf(deps: SubmissionsDeps, version: FormVersion, record: InProgress, now: Date): PageView {
  const doc = version.document;
  const answers = withFileAnswers(record.answers, record.files);
  return {
    locale: record.locale,
    pageKey: record.pageKey,
    position: pagePosition(doc, answers, deps.registry, record.pageKey),
    isFirst: previousPageKey(doc, answers, deps.registry, record.pageKey) === null,
    isLast: nextPageKey(doc, answers, deps.registry, record.pageKey) === null,
    answers: record.answers,
    files: record.files,
    pending: record.pending?.pageKey === record.pageKey ? record.pending : null,
    submitToken: record.submitToken,
    renderedAt: now,
    hasRecord: true,
  };
}

/** The screen behind `GET /f/<slug>`; specs/ui-ux/renderer.md, "Screens". */
export async function viewForm(
  deps: SubmissionsDeps,
  input: { slug: string; state: FillState; acceptLanguage: string | null; expired: boolean },
): Promise<ViewResult> {
  const { state } = input;
  if (state.kind === "done") {
    const s = await deps.submissions.findBySubmitToken(state.submitToken);
    if (s !== null) {
      const [form, version] = await Promise.all([
        loadForm(deps.definitions, s.formId),
        deps.versions.get(deps.definitions, s.versionId),
      ]);
      if (form !== null && version !== null && form.slug === input.slug) {
        return { screen: "confirmation", form, version, locale: s.locale, reference: s.reference };
      }
    }
  }
  const resolved = await resolvePublicForm(deps.definitions, input.slug);
  if (resolved.state === "not_found") return { screen: "not_found" };
  if (resolved.state === "closed") return { screen: "closed", form: resolved.form };
  if (resolved.state === "not_open_yet") return { screen: "not_open", form: resolved.form, opensAt: resolved.opensAt };
  const { form, version } = resolved;
  const doc = version.document;
  if (state.kind === "decoy") {
    return { screen: "confirmation", form, version, locale: pickLocale(doc.languages, input.acceptLanguage), reference: state.reference };
  }
  const now = deps.clock.now();
  if (state.kind === "record") {
    const record = await deps.inProgress.find(state.id);
    if (record === null || record.formId !== form.id || isExpired(record, now)) return { screen: "expired", form };
    const pinned = await deps.versions.get(deps.definitions, record.versionId);
    if (pinned === null) return { screen: "expired", form };
    return { screen: "page", form, version: pinned, page: pageOf(deps, pinned, record, now) };
  }
  if (input.expired) return { screen: "expired", form };
  const pageKey = firstPageKey(doc, deps.registry);
  return {
    screen: "page",
    form,
    version,
    page: {
      locale: pickLocale(doc.languages, input.acceptLanguage),
      pageKey,
      position: pagePosition(doc, {}, deps.registry, pageKey),
      isFirst: true,
      isLast: nextPageKey(doc, {}, deps.registry, pageKey) === null,
      answers: {},
      files: {},
      pending: null,
      submitToken: null,
      renderedAt: now,
      hasRecord: false,
    },
  };
}
```

`index.ts` (grown by the next tasks):

```ts
/** Public API of the submissions module. Only src/app imports it; no module depends on submissions. */
export type { SubmissionsDeps } from "./deps";
export type { FillState, Gate, PageAction, PagePost, PostOutcome, IncomingFile } from "./fill-state";
export type { OpenContext, PostContext } from "./post-context";
export type { PageView, ViewResult } from "./view-form";
export type { InProgressRepository } from "./ports/in-progress-repository";
export type { SubmissionRepository } from "./ports/submission-repository";
export type { InProgress, PendingPage, StagedUpload, RawValues, FileIssue, FileIssueCode } from "../domain/in-progress";
export type { Submission } from "../domain/submission";
export { VersionCache } from "./version-cache";
export { postContext } from "./post-context";
export { viewForm } from "./view-form";
export { HONEYPOT_FIELD, MIN_FILL_MS } from "../domain/protection";
export { uploadFields } from "../domain/intake";
```

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
export interface StagedBatch { added: Record<string, StagedUpload[]>; fileIssues: FileIssue[]; countIssues: ValidationIssue[]; refs: string[] }
export async function stageIncoming(deps: SubmissionsDeps, input: {
  recordId: string; version: Version; pageKey: string;
  existing: Readonly<Record<string, readonly StagedUpload[]>>; incoming: readonly IncomingFile[];
}): Promise<StagedBatch>;
export function mergeBatch(record: InProgress, batch: StagedBatch, version: Version, registry: FieldTypeRegistry):
  { record: InProgress; overflow: string[]; issues: ValidationIssue[] };   // re-checks counts on the locked record
// answers.ts
export function pageInputKeys(version: Version, registry: FieldTypeRegistry, pageKey: string): { answers: string[]; uploads: string[] };
export function storePageAnswers(stored: Readonly<Record<string, unknown>>, version: Version, registry: FieldTypeRegistry, pageKey: string, valid: Readonly<Record<string, unknown>>): Record<string, unknown>;
// save-page.ts
export async function savePage(deps: SubmissionsDeps, context: OpenContext, post: PagePost): Promise<PostOutcome>;   // next, back, language, remove
// check-field.ts
export function checkField(deps: SubmissionsDeps, context: OpenContext, input: { fieldKey: string; answer: unknown; decodeIssue: ValidationCode | null }):
  { field: Field; issue: ValidationIssue | null } | null;     // null: no such input field in the version
```

Rules savePage keeps, each pinned by a test below: a post without a record is accepted only for the first page (otherwise `expired`), and creates the record with the post's version, the browser's language and `started_at` from `_rendered`; files are staged before the unit of work, and on any failure the files staged by this post are removed; Next enforces required, Back and the language switch do not, and an invalid answer is never stored; the stored answers of the page are replaced by the page's valid answers; decode issues (a number that is not a number, an impossible date) replace the form model's issue for that field; a refused Next keeps the raw values and issues as `pending` and stays; the language switch and a Remove keep the raw values without issues; Remove deletes the staging copy after commit.

- [ ] **Step 1: Failing tests.** `save-page.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fakeImage } from "@/modules/media/application/testing/fakes";
import { postContext } from "./post-context";
import { savePage } from "./save-page";
import { makeSubmissionsDeps, post, publishStory, type FakeSubmissionsDeps } from "./testing/fakes";

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
      decodeIssues: [{ code: "invalid_shape", field: "f_baby" }],
    }));
    if (out.kind !== "show") throw new Error(out.kind);
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
    await savePage(deps, ctx, post({ pageKey: "page_baby", incoming: four }));
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

  it("reports a refused file by name without storing the name anywhere but pending", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await startOnPhotos(deps);
    await savePage(deps, await context(deps, { kind: "record", id }), post({ pageKey: "page_baby", incoming: [{ fieldKey: "f_photos", name: "notes.txt", bytes: new TextEncoder().encode("hello") }] }));
    const record = deps.inProgress.rows.get(id);
    expect(record?.pending?.fileIssues).toEqual([{ fieldKey: "f_photos", code: "file_wrong_type", file: "notes.txt" }]);
    expect(JSON.stringify(record?.files)).not.toContain("notes.txt");
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
import { describe, expect, it } from "vitest";
import { checkField } from "./check-field";
import { postContext } from "./post-context";
import { makeSubmissionsDeps, publishStory } from "./testing/fakes";

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

- [ ] **Step 3: Implement.** `answers.ts`:

```ts
import type { FieldTypeRegistry, Version } from "@/shared/domain/form-model";

/** The page's input field keys, answers and upload fields apart (uploads live in `files`). */
export function pageInputKeys(
  version: Version,
  registry: FieldTypeRegistry,
  pageKey: string,
): { answers: string[]; uploads: string[] } {
  const page = version.pages.find((p) => p.key === pageKey);
  const answers: string[] = [];
  const uploads: string[] = [];
  for (const field of page?.fields ?? []) {
    const def = registry.get(field.type);
    if (!def.isInput) continue;
    (def.uploadLimits ? uploads : answers).push(field.key);
  }
  return { answers, uploads };
}

/** The stored answers with this page's replaced by its valid answers; invalid answers are never stored. */
export function storePageAnswers(
  stored: Readonly<Record<string, unknown>>,
  version: Version,
  registry: FieldTypeRegistry,
  pageKey: string,
  valid: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const { answers } = pageInputKeys(version, registry, pageKey);
  const out: Record<string, unknown> = { ...stored };
  for (const key of answers) {
    delete out[key];
    if (Object.hasOwn(valid, key)) out[key] = valid[key];
  }
  return out;
}
```

`staging.ts`:

```ts
import { discardStaged, stageFile } from "@/modules/media/application";
import type { FieldTypeRegistry, ValidationIssue, Version } from "@/shared/domain/form-model";
import type { FileIssue, InProgress, StagedUpload } from "../domain/in-progress";
import { uploadFields } from "../domain/intake";
import type { SubmissionsDeps } from "./deps";
import type { IncomingFile } from "./fill-state";

const MB = 1024 * 1024;

export interface StagedBatch {
  added: Record<string, StagedUpload[]>;
  fileIssues: FileIssue[];
  countIssues: ValidationIssue[];
  refs: string[];
}

/**
 * Stages the files a post carried for the page's upload fields, before any
 * transaction. A field asked for more files than it allows stages none of
 * them. Empty file parts (no file chosen) are ignored.
 */
export async function stageIncoming(
  deps: SubmissionsDeps,
  input: {
    recordId: string;
    version: Version;
    pageKey: string;
    existing: Readonly<Record<string, readonly StagedUpload[]>>;
    incoming: readonly IncomingFile[];
  },
): Promise<StagedBatch> {
  const batch: StagedBatch = { added: {}, fileIssues: [], countIssues: [], refs: [] };
  const page = input.version.pages.find((p) => p.key === input.pageKey);
  const onPage = new Set(page?.fields.map((f) => f.key) ?? []);
  for (const { field, limits } of uploadFields(input.version, deps.registry)) {
    if (!onPage.has(field.key)) continue;
    const files = input.incoming.filter((f) => f.fieldKey === field.key && f.bytes.byteLength > 0);
    if (files.length === 0) continue;
    const have = input.existing[field.key]?.length ?? 0;
    if (have + files.length > limits.maxFiles) {
      batch.countIssues.push({ code: "files_max", field: field.key, params: { n: limits.maxFiles } });
      continue;
    }
    for (const file of files) {
      const staged = await stageFile(deps.media, {
        recordId: input.recordId,
        bytes: file.bytes,
        accept: limits.kinds,
        maxBytes: limits.maxSizeMb * MB,
      });
      if (!staged.ok) {
        batch.fileIssues.push({ fieldKey: field.key, code: staged.code, file: file.name });
        continue;
      }
      (batch.added[field.key] ??= []).push(staged.file);
      batch.refs.push(staged.file.stagingRef);
    }
  }
  return batch;
}

/** Adds the batch to the locked record; files a concurrent upload pushed over the limit are returned as overflow. */
export function mergeBatch(
  record: InProgress,
  batch: StagedBatch,
  version: Version,
  registry: FieldTypeRegistry,
): { record: InProgress; overflow: string[]; issues: ValidationIssue[] } {
  const files: Record<string, StagedUpload[]> = { ...record.files };
  const overflow: string[] = [];
  const issues: ValidationIssue[] = [];
  const limits = new Map(uploadFields(version, registry).map((u) => [u.field.key, u.limits.maxFiles]));
  for (const [key, added] of Object.entries(batch.added)) {
    const current = files[key] ?? [];
    const max = limits.get(key) ?? 0;
    if (current.length + added.length > max) {
      overflow.push(...added.map((f) => f.stagingRef));
      issues.push({ code: "files_max", field: key, params: { n: max } });
      continue;
    }
    files[key] = [...current, ...added];
  }
  return { record: { ...record, files }, overflow, issues };
}

/** Best effort: a file that cannot be deleted now goes with its record's prefix at expiry. */
export async function discardQuietly(deps: SubmissionsDeps, refs: readonly string[]): Promise<void> {
  if (refs.length === 0) return;
  await discardStaged(deps.media, refs).catch((e: unknown) => {
    deps.logger.warn("staged files not removed", { count: refs.length, error: e instanceof Error ? e.name : "Error" });
  });
}
```

`save-page.ts`:

```ts
import { validatePage } from "@/shared/domain/form-model";
import { isExpired, newInProgress, removeUpload, withFileAnswers, clampStartedAt } from "../domain/in-progress";
import { localeFor, pickLocale } from "../domain/locale";
import { firstPageKey, nextPageKey, previousPageKey } from "../domain/navigation";
import { todayIn } from "../domain/dates";
import { storePageAnswers } from "./answers";
import type { SubmissionsDeps } from "./deps";
import type { PagePost, PostOutcome } from "./fill-state";
import type { OpenContext } from "./post-context";
import { discardQuietly, mergeBatch, stageIncoming } from "./staging";

/**
 * Next, Back, the language switch and Remove. Every post stores the page's
 * valid answers server-side, which is what lets Back, Next and a refresh keep
 * them. See specs/ui-ux/renderer.md, "Navigation and state".
 */
export async function savePage(deps: SubmissionsDeps, context: OpenContext, post: PagePost): Promise<PostOutcome> {
  const { form, version } = context;
  const doc = version.document;
  const now = deps.clock.now();
  const first = firstPageKey(doc, deps.registry);
  if (context.record === null && post.pageKey !== first) return { kind: "expired" };
  const page = doc.pages.find((p) => p.key === post.pageKey);
  if (!page) return context.record ? { kind: "show", recordId: context.record.id } : { kind: "expired" };

  const recordId = context.record?.id ?? deps.ids.newId();
  const batch = await stageIncoming(deps, {
    recordId, version: doc, pageKey: page.key, existing: context.record?.files ?? {}, incoming: post.incoming,
  });

  try {
    const result = await deps.uow.run(async (uow) => {
      const locked = context.record ? await deps.inProgress.findForUpdate(uow, context.record.id) : null;
      if (context.record && (locked === null || isExpired(locked, now))) {
        return { outcome: { kind: "expired" } as const, discard: batch.refs };
      }
      const base =
        locked ??
        newInProgress({
          id: recordId, formId: form.id, versionId: version.id,
          locale: post.action.kind === "language" ? localeFor(doc.languages, post.action.locale) : pickLocale(doc.languages, post.acceptLanguage),
          pageKey: first, submitToken: deps.ids.newId(), startedAt: clampStartedAt(post.renderedAt, now), now,
        });
      const merged = mergeBatch(base, batch, doc, deps.registry);
      let record = merged.record;
      const discard = [...merged.overflow];
      if (post.action.kind === "remove") {
        const { files, removed } = removeUpload(record.files, post.action.fileId);
        record = { ...record, files };
        if (removed) discard.push(removed.stagingRef);
      }

      const body = withFileAnswers({ ...record.answers, ...post.answers }, record.files);
      const checked = validatePage(doc, deps.registry, body, page.key, { today: todayIn(form.settings.timezone, now) }, {
        enforceRequired: post.action.kind === "next",
      });
      // A decode or count issue says more than the model's issue for the same field, so it replaces it.
      const own = [...post.decodeIssues, ...batch.countIssues, ...merged.issues];
      const replaced = new Set(own.map((i) => i.field));
      const issues = [...checked.issues.filter((i) => !replaced.has(i.field)), ...own];
      const answers = storePageAnswers(record.answers, doc, deps.registry, page.key, checked.answers);
      const navigable = withFileAnswers(answers, record.files);
      record = { ...record, answers, updatedAt: now };

      if (post.action.kind === "next") {
        const refused = issues.length > 0 || batch.fileIssues.length > 0;
        record = refused
          ? { ...record, pageKey: page.key, pending: { pageKey: page.key, raw: post.raw, issues, fileIssues: batch.fileIssues } }
          : { ...record, pageKey: nextPageKey(doc, navigable, deps.registry, page.key) ?? page.key, pending: null };
      } else if (post.action.kind === "back") {
        record = { ...record, pageKey: previousPageKey(doc, navigable, deps.registry, page.key) ?? page.key, pending: null };
      } else {
        const locale = post.action.kind === "language" ? localeFor(doc.languages, post.action.locale) : record.locale;
        record = { ...record, locale, pageKey: page.key, pending: { pageKey: page.key, raw: post.raw, issues: [], fileIssues: batch.fileIssues } };
      }

      if (locked) await deps.inProgress.update(uow, record);
      else await deps.inProgress.insert(uow, record);
      return { outcome: { kind: "show", recordId: record.id } as const, discard };
    });
    await discardQuietly(deps, result.discard);
    return result.outcome;
  } catch (e) {
    await discardQuietly(deps, batch.refs);
    throw e;
  }
}
```

(`submit` never reaches `savePage`; the route sends it to `submitForm`, Task 21. If it did, it would be treated like the language switch: stored and shown again.)

`check-field.ts`:

```ts
import { validatePage, type Field, type ValidationCode, type ValidationIssue } from "@/shared/domain/form-model";
import { withFileAnswers } from "../domain/in-progress";
import { todayIn } from "../domain/dates";
import type { SubmissionsDeps } from "./deps";
import type { OpenContext } from "./post-context";

/** The blur check: the server's own rules for one field, so the browser ships none of them. */
export function checkField(
  deps: SubmissionsDeps,
  context: OpenContext,
  input: { fieldKey: string; answer: unknown; decodeIssue: ValidationCode | null },
): { field: Field; issue: ValidationIssue | null } | null {
  const doc = context.version.document;
  const page = doc.pages.find((p) => p.fields.some((f) => f.key === input.fieldKey));
  const field = page?.fields.find((f) => f.key === input.fieldKey);
  if (!page || !field || !deps.registry.get(field.type).isInput) return null;
  if (input.decodeIssue !== null) return { field, issue: { code: input.decodeIssue, field: field.key } };
  const record = context.record;
  const body = withFileAnswers({ ...record?.answers, [field.key]: input.answer }, record?.files ?? {});
  const today = todayIn(context.form.settings.timezone, deps.clock.now());
  const { issues } = validatePage(doc, deps.registry, body, page.key, { today }, { enforceRequired: true });
  return { field, issue: issues.find((i) => i.field === field.key) ?? null };
}
```

Add to `index.ts`: `export { savePage } from "./save-page";`, `export { checkField } from "./check-field";`.

- [ ] **Step 4: Run** `pnpm test src/modules/submissions && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(submissions): save a page on Next, Back, language switch and Remove; check one field`

---

### Task 20: Submissions application: early uploads and removal

**Files:**
- Create: `src/modules/submissions/application/upload-file.ts`, `upload-file.test.ts`
- Modify: `src/modules/submissions/application/index.ts`

**Interfaces:**
- Consumes: `OpenContext` (Task 18); `stageFile` (Task 6) called directly for the single file; `discardQuietly`, `mergeBatch` (Task 19).
- Produces:

```ts
export type UploadRefusal = StageRefusal | "files_max" | "not_allowed" | "expired";
export type UploadOutcome =
  | { ok: true; recordId: string; file: { id: string; kind: "image" | "video"; size: number }; count: number }
  | { ok: false; code: UploadRefusal; params?: { n: number } };
export async function uploadFile(deps: SubmissionsDeps, context: OpenContext, input: {
  fieldKey: string; bytes: Uint8Array; renderedAt: Date | null; acceptLanguage: string | null;
}): Promise<UploadOutcome>;
export async function removeFile(deps: SubmissionsDeps, context: OpenContext, fileId: string): Promise<boolean>;
```

Decision (upload authentication): the cookie's record, and the posted field key must name a visible upload field of the record's current page (the first page when there is no record yet, which this call then creates). Anything else is `not_allowed` and nothing is staged.

- [ ] **Step 1: Failing tests** `upload-file.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fakeImage } from "@/modules/media/application/testing/fakes";
import { postContext } from "./post-context";
import { savePage } from "./save-page";
import { makeSubmissionsDeps, post, publishStory, type FakeSubmissionsDeps } from "./testing/fakes";
import { removeFile, uploadFile } from "./upload-file";

const MB = 1024 * 1024;

async function onPhotos(deps: FakeSubmissionsDeps) {
  const none = await postContext(deps, { slug: "story-form", state: { kind: "none" }, submitToken: null });
  if (!none.ok) throw new Error("closed");
  const out = await savePage(deps, none, post({ answers: { f_name: "Ana Prueba", f_baby: "yes_opt" } }));
  if (out.kind !== "show") throw new Error(out.kind);
  const ctx = await postContext(deps, { slug: "story-form", state: { kind: "record", id: out.recordId }, submitToken: null });
  if (!ctx.ok) throw new Error("expired");
  return ctx;
}

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

- [ ] **Step 2: Run** `pnpm test src/modules/submissions/application/upload-file.test.ts`: fails.

- [ ] **Step 3: Implement** `upload-file.ts`:

```ts
import { stageFile, type StageRefusal } from "@/modules/media/application";
import { evaluateVisibility } from "@/shared/domain/form-model";
import { clampStartedAt, isExpired, newInProgress, removeUpload, withFileAnswers } from "../domain/in-progress";
import { uploadFields } from "../domain/intake";
import { pickLocale } from "../domain/locale";
import { firstPageKey } from "../domain/navigation";
import type { SubmissionsDeps } from "./deps";
import type { OpenContext } from "./post-context";
import { discardQuietly, mergeBatch } from "./staging";

const MB = 1024 * 1024;

export type UploadRefusal = StageRefusal | "files_max" | "not_allowed" | "expired";
export type UploadOutcome =
  | { ok: true; recordId: string; file: { id: string; kind: "image" | "video"; size: number }; count: number }
  | { ok: false; code: UploadRefusal; params?: { n: number } };

/**
 * An early upload with script: one file, staged at once and linked to the
 * in-progress record, which this call creates on the first page. See
 * specs/ui-ux/renderer.md, "File upload".
 */
export async function uploadFile(
  deps: SubmissionsDeps,
  context: OpenContext,
  input: { fieldKey: string; bytes: Uint8Array; renderedAt: Date | null; acceptLanguage: string | null },
): Promise<UploadOutcome> {
  const doc = context.version.document;
  const now = deps.clock.now();
  const pageKey = context.record?.pageKey ?? firstPageKey(doc, deps.registry);
  const page = doc.pages.find((p) => p.key === pageKey);
  const target = uploadFields(doc, deps.registry).find((u) => u.field.key === input.fieldKey);
  const answers = withFileAnswers(context.record?.answers ?? {}, context.record?.files ?? {});
  const visible = evaluateVisibility(doc, answers, deps.registry).fields.get(input.fieldKey) === true;
  if (!target || !page?.fields.some((f) => f.key === input.fieldKey) || !visible) return { ok: false, code: "not_allowed" };
  const { maxFiles, kinds, maxSizeMb } = target.limits;
  if ((context.record?.files[input.fieldKey]?.length ?? 0) >= maxFiles) {
    return { ok: false, code: "files_max", params: { n: maxFiles } };
  }

  const recordId = context.record?.id ?? deps.ids.newId();
  const staged = await stageFile(deps.media, { recordId, bytes: input.bytes, accept: kinds, maxBytes: maxSizeMb * MB });
  if (!staged.ok) return { ok: false, code: staged.code };

  try {
    const result = await deps.uow.run(async (uow): Promise<UploadOutcome> => {
      const locked = context.record ? await deps.inProgress.findForUpdate(uow, context.record.id) : null;
      if (context.record && (locked === null || isExpired(locked, now))) return { ok: false, code: "expired" };
      const base =
        locked ??
        newInProgress({
          id: recordId, formId: context.form.id, versionId: context.version.id,
          locale: pickLocale(doc.languages, input.acceptLanguage), pageKey,
          submitToken: deps.ids.newId(), startedAt: clampStartedAt(input.renderedAt, now), now,
        });
      const merged = mergeBatch(base, { added: { [input.fieldKey]: [staged.file] }, fileIssues: [], countIssues: [], refs: [] }, doc, deps.registry);
      if (merged.overflow.length > 0) return { ok: false, code: "files_max", params: { n: maxFiles } };
      const record = { ...merged.record, updatedAt: now };
      if (locked) await deps.inProgress.update(uow, record);
      else await deps.inProgress.insert(uow, record);
      const count = record.files[input.fieldKey]?.length ?? 0;
      return { ok: true, recordId, file: { id: staged.file.id, kind: staged.file.kind, size: staged.file.size }, count };
    });
    if (!result.ok) await discardQuietly(deps, [staged.file.stagingRef]);
    return result;
  } catch (e) {
    await discardQuietly(deps, [staged.file.stagingRef]);
    throw e;
  }
}

/** Removes a staged file from the record and from staging at once. */
export async function removeFile(deps: SubmissionsDeps, context: OpenContext, fileId: string): Promise<boolean> {
  if (context.record === null) return false;
  const recordId = context.record.id;
  const now = deps.clock.now();
  const ref = await deps.uow.run(async (uow) => {
    const locked = await deps.inProgress.findForUpdate(uow, recordId);
    if (locked === null || isExpired(locked, now)) return null;
    const { files, removed } = removeUpload(locked.files, fileId);
    if (removed === null) return null;
    await deps.inProgress.update(uow, { ...locked, files, updatedAt: now });
    return removed.stagingRef;
  });
  if (ref === null) return false;
  await discardQuietly(deps, [ref]);
  return true;
}
```

Add to `index.ts`: `export { uploadFile, removeFile } from "./upload-file";` and `export type { UploadOutcome, UploadRefusal } from "./upload-file";`.

- [ ] **Step 4: Run** `pnpm test src/modules/submissions && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(submissions): early uploads linked to the in-progress record, and removal`

---

### Task 21: Submissions application: the intake transaction and expiry

**Files:**
- Create: `src/modules/submissions/application/submit-form.ts`, `submit-form.test.ts`, `expire.ts`, `expire.test.ts`
- Modify: `src/modules/submissions/application/index.ts`

**Interfaces:**
- Consumes: everything above; `allocateReference` (Task 14); `attachToSubmission`, `durableKey`, `uniqueFieldSlugs`, `extensionFor`, `discardRecordFiles` (Tasks 5, 6); `enqueueSubmissionEmails` (Task 11); `validateSubmission`.
- Produces:

```ts
export async function submitForm(deps: SubmissionsDeps, context: OpenContext, post: PagePost): Promise<PostOutcome>;
export async function expireInProgress(deps: SubmissionsDeps, input: { now: Date; logger: Logger; limit?: number }): Promise<number>;
```

The single transaction, in order: lock the in-progress row; a missing row with a known submit token answers `submitted` (a double click); an expired row answers `expired`; the honeypot or the minimum time answers with a decoy reference after deleting the record (its files go after commit), storing nothing; the last page is validated as on Next; the whole submission is validated with `validateSubmission`, which drops answers to hidden fields (a refusal returns to the first page with an issue); `allocateReference` locks the form row and re-checks that it is open; then the submission, one media row and one `media.upload` job per attached file, the email jobs, and the deletion of the in-progress row. After commit, staged files no answer names (hidden fields, never attached) are deleted. Logs carry the form and submission ids only.

Decision (media keys, applied here): field slugs come from `uniqueFieldSlugs` over the version's upload fields in field order, with labels in `firstLanguage(languages)`. Decision (staff notification, applied here): enqueued when the cadence is per submission and the form has at least one recipient; the submitter confirmation when the version defines a confirmation email and the submitter-address field was answered.

- [ ] **Step 1: Failing tests** `submit-form.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { publishAgain } from "@/modules/definitions/application/testing/fakes";
import { fakeImage } from "@/modules/media/application/testing/fakes";
import { consentTextVersion, type Version } from "@/shared/domain/form-model";
import { CONSENT_TEXT, storyVersion } from "../domain/testing/versions";
import { postContext } from "./post-context";
import { savePage } from "./save-page";
import { submitForm } from "./submit-form";
import { uploadFile } from "./upload-file";
import { makeSubmissionsDeps, post, publishStory, type FakeSubmissionsDeps } from "./testing/fakes";

const consent = { accepted: true, textVersion: consentTextVersion(CONSENT_TEXT) };

async function ctxOf(deps: FakeSubmissionsDeps, id: string | null, submitToken: string | null = null) {
  const ctx = await postContext(deps, { slug: "story-form", state: id ? { kind: "record", id } : { kind: "none" }, submitToken });
  if (!ctx.ok) throw new Error(ctx.outcome.kind);
  return ctx;
}

/** Fills page 1 with a baby, uploads two photos on page 2, reaches page 3. */
async function reachConsent(deps: FakeSubmissionsDeps): Promise<string> {
  const start = await savePage(deps, await ctxOf(deps, null), post({ answers: { f_name: "Ana Prueba", f_email: "family@example.com", f_baby: "yes_opt" }, renderedAt: deps.clock.now() }));
  if (start.kind !== "show") throw new Error(start.kind);
  const id = start.recordId;
  for (let i = 0; i < 2; i++) await uploadFile(deps, await ctxOf(deps, id), { fieldKey: "f_photos", bytes: fakeImage(), renderedAt: null, acceptLanguage: "es" });
  await savePage(deps, await ctxOf(deps, id), post({ pageKey: "page_baby", state: { kind: "record", id } }));
  deps.clock.advance(60_000);
  return id;
}

async function submit(deps: FakeSubmissionsDeps, id: string, over: Partial<Parameters<typeof post>[0]> = {}) {
  const token = deps.inProgress.rows.get(id)?.submitToken ?? null;
  return submitForm(deps, await ctxOf(deps, id, token), post({ pageKey: "page_consent", action: { kind: "submit" }, answers: { f_consent: consent }, submitToken: token, state: { kind: "record", id }, ...over }));
}

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

  it("answers a repeated submit with the same confirmation and no second submission", async () => {
    const deps = makeSubmissionsDeps();
    await publishStory(deps);
    const id = await reachConsent(deps);
    const token = deps.inProgress.rows.get(id)?.submitToken ?? null;
    await submit(deps, id);
    const again = await postContext(deps, { slug: "story-form", state: { kind: "record", id }, submitToken: token });
    expect(again).toEqual({ ok: false, outcome: { kind: "submitted", submitToken: token } });
    expect(deps.submissions.rows.size).toBe(1);
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
    expect(await submit(deps, id)).toEqual({ kind: "show", recordId: id });
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
```

(`random: () => 0.5` in the fakes gives the decoy `ST-5500`.)

`expire.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fakeImage } from "@/modules/media/application/testing/fakes";
import { expireInProgress } from "./expire";
import { postContext } from "./post-context";
import { savePage } from "./save-page";
import { makeSubmissionsDeps, post, publishStory } from "./testing/fakes";
import { uploadFile } from "./upload-file";

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

- [ ] **Step 3: Implement** `submit-form.ts`:

```ts
import { allocateReference } from "@/modules/definitions/application";
import { attachToSubmission, discardRecordFiles, durableKey, extensionFor, uniqueFieldSlugs } from "@/modules/media/application";
import { enqueueSubmissionEmails } from "@/modules/notifications/application";
import { validatePage, validateSubmission, type ValidationIssue } from "@/shared/domain/form-model";
import { resolveText } from "@/shared/domain/localized-text";
import { todayIn } from "../domain/dates";
import { clampStartedAt, isExpired, newInProgress, withFileAnswers } from "../domain/in-progress";
import { firstLanguage, firstPageWithIssue, planFiles, submitterAddress, uploadFields } from "../domain/intake";
import { pickLocale } from "../domain/locale";
import { firstPageKey } from "../domain/navigation";
import { decoyReference, isSilentAccept } from "../domain/protection";
import { storePageAnswers } from "./answers";
import type { SubmissionsDeps } from "./deps";
import type { PagePost, PostOutcome } from "./fill-state";
import type { OpenContext } from "./post-context";
import { discardQuietly, mergeBatch, stageIncoming } from "./staging";

interface IntakeResult {
  outcome: PostOutcome;
  discard: string[];
  discardRecord: string | null;
}

/**
 * Submit: the intake transaction of specs/architecture.md, "Submission data
 * flow" step 3. Nothing external is called; the jobs do that after commit.
 */
export async function submitForm(deps: SubmissionsDeps, context: OpenContext, post: PagePost): Promise<PostOutcome> {
  const { form, version } = context;
  const doc = version.document;
  const now = deps.clock.now();
  const first = firstPageKey(doc, deps.registry);
  if (context.record === null && post.pageKey !== first) return { kind: "expired" };
  const page = doc.pages.find((p) => p.key === post.pageKey);
  if (!page) return context.record ? { kind: "show", recordId: context.record.id } : { kind: "expired" };
  const recordId = context.record?.id ?? deps.ids.newId();
  const batch = await stageIncoming(deps, { recordId, version: doc, pageKey: page.key, existing: context.record?.files ?? {}, incoming: post.incoming });
  const ctx = { today: todayIn(form.settings.timezone, now) };

  let result: IntakeResult;
  try {
    result = await deps.uow.run(async (uow): Promise<IntakeResult> => {
      const nothing = (outcome: PostOutcome): IntakeResult => ({ outcome, discard: batch.refs, discardRecord: null });
      const locked = context.record ? await deps.inProgress.findForUpdate(uow, context.record.id) : null;
      if (context.record && locked === null) {
        const done = post.submitToken ? await deps.submissions.findBySubmitToken(post.submitToken) : null;
        return nothing(done && done.formId === form.id ? { kind: "submitted", submitToken: done.submitToken } : { kind: "expired" });
      }
      if (locked && isExpired(locked, now)) return nothing({ kind: "expired" });
      const base =
        locked ??
        newInProgress({
          id: recordId, formId: form.id, versionId: version.id, locale: pickLocale(doc.languages, post.acceptLanguage),
          pageKey: first, submitToken: deps.ids.newId(), startedAt: clampStartedAt(post.renderedAt, now), now,
        });
      const merged = mergeBatch(base, batch, doc, deps.registry);
      let record = merged.record;

      if (isSilentAccept({ honeypot: post.honeypot, startedAt: record.startedAt, now })) {
        if (locked) await deps.inProgress.delete(uow, record.id);
        const reference = decoyReference(form.settings.referencePrefix, deps.random);
        return { outcome: { kind: "decoy", reference }, discard: batch.refs, discardRecord: record.id };
      }

      /** Keeps the refusal on `pageKey` and shows that page again. */
      const save = async (pageKey: string, issues: ValidationIssue[]): Promise<IntakeResult> => {
        const samePage = pageKey === page.key;
        record = {
          ...record,
          pageKey,
          updatedAt: now,
          pending: { pageKey, raw: samePage ? post.raw : {}, issues, fileIssues: samePage ? batch.fileIssues : [] },
        };
        if (locked) await deps.inProgress.update(uow, record);
        else await deps.inProgress.insert(uow, record);
        return { outcome: { kind: "show", recordId: record.id }, discard: merged.overflow, discardRecord: null };
      };

      const body = withFileAnswers({ ...record.answers, ...post.answers }, record.files);
      const checked = validatePage(doc, deps.registry, body, page.key, ctx, { enforceRequired: true });
      const own = [...post.decodeIssues, ...batch.countIssues, ...merged.issues];
      const replaced = new Set(own.map((i) => i.field));
      const pageIssues = [...checked.issues.filter((i) => !replaced.has(i.field)), ...own];
      record = { ...record, answers: storePageAnswers(record.answers, doc, deps.registry, page.key, checked.answers) };
      if (pageIssues.length > 0 || batch.fileIssues.length > 0) return save(page.key, pageIssues);

      const full = validateSubmission(doc, deps.registry, withFileAnswers(record.answers, record.files), ctx);
      if (!full.ok) {
        const target = firstPageWithIssue(doc, full.issues) ?? page.key;
        const onTarget = new Set(doc.pages.find((p) => p.key === target)?.fields.map((f) => f.key) ?? []);
        return save(target, full.issues.filter((i) => onTarget.has(i.field)));
      }

      const allocated = await allocateReference(deps.definitions, uow, form.id);
      if (!allocated.ok) return nothing({ kind: "gate", state: allocated.state });

      const submissionId = deps.ids.newId();
      const inserted = await deps.submissions.insert(uow, {
        id: submissionId, formId: form.id, versionId: version.id, locale: record.locale, answers: full.answers,
        consent: full.consent ? { ...full.consent, acceptedAt: now } : null,
        receivedAt: now, reference: allocated.reference, submitToken: record.submitToken,
      });
      if (inserted === "duplicate_token") return nothing({ kind: "submitted", submitToken: record.submitToken });

      const plan = planFiles(full.answers, record.files);
      const language = firstLanguage(doc.languages);
      const slugs = uniqueFieldSlugs(
        uploadFields(doc, deps.registry).map(({ field }) => ({ fieldKey: field.key, label: resolveText(field.label, language, doc.languages) })),
      );
      await attachToSubmission(deps.media, uow, {
        submissionId,
        formId: form.id,
        files: plan.attached.map((p) => ({
          fieldKey: p.fieldKey,
          position: p.position,
          file: p.upload,
          durableKey: durableKey({
            formSlug: allocated.form.slug, reference: allocated.reference, position: p.position,
            fieldSlug: slugs.get(p.fieldKey) ?? "file", ext: extensionFor(p.upload.contentType),
          }),
        })),
      });
      const settings = allocated.form.settings;
      await enqueueSubmissionEmails(deps.queue, uow, {
        submissionId,
        submitterConfirmation: doc.confirmation.email !== undefined && submitterAddress(doc, deps.registry, full.answers) !== null,
        staffNotification: settings.notificationCadence === "per_submission" && settings.notificationRecipients.length > 0,
      });
      if (locked) await deps.inProgress.delete(uow, record.id);
      deps.logger.info("submission received", { formId: form.id, submissionId });
      return {
        outcome: { kind: "submitted", submitToken: record.submitToken },
        discard: [...merged.overflow, ...plan.discarded.map((u) => u.stagingRef)],
        discardRecord: null,
      };
    });
  } catch (e) {
    await discardQuietly(deps, batch.refs);
    throw e;
  }
  await discardQuietly(deps, result.discard);
  if (result.discardRecord !== null) {
    await discardRecordFiles(deps.media, result.discardRecord).catch(() => undefined);
  }
  return result.outcome;
}
```

`expire.ts`:

```ts
import { discardRecordFiles } from "@/modules/media/application";
import type { Logger } from "@/shared/application/ports/logger";
import { isExpired } from "../domain/in-progress";
import type { SubmissionsDeps } from "./deps";

/**
 * The `jobs.cleanup` step for submissions: removes in-progress records past
 * their 24 hours, their staged files first and under the row lock, so a
 * failure leaves the row for the next run rather than orphaned files.
 * See specs/system/jobs.md, "Recurring jobs".
 */
export async function expireInProgress(
  deps: SubmissionsDeps,
  input: { now: Date; logger: Logger; limit?: number },
): Promise<number> {
  const ids = await deps.inProgress.listExpired(input.now, input.limit ?? 500);
  let removed = 0;
  for (const id of ids) {
    const done = await deps.uow.run(async (uow) => {
      const record = await deps.inProgress.findForUpdate(uow, id);
      if (record === null || !isExpired(record, input.now)) return false;
      await discardRecordFiles(deps.media, id);
      await deps.inProgress.delete(uow, id);
      return true;
    });
    if (done) removed += 1;
  }
  input.logger.info("expired in-progress records removed", { removed });
  return removed;
}
```

Add to `index.ts`: `export { submitForm } from "./submit-form";` and `export { expireInProgress } from "./expire";`.

- [ ] **Step 4: Run** `pnpm test src/modules/submissions && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(submissions): the intake transaction with silent accepts, duplicate submits and expiry`

---

### Task 22: Submissions against Postgres: fault injection, the close race, cleanup, and the message source

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

The message source formats the received time per locale in the form's time zone (`Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone })` for the submitter; `YYYY-MM-DD HH:mm <zone>, HH:mm UTC` for staff) and builds the manager link `${publicBaseUrl}/admin/forms/<form id>`. It returns null when the submission is gone, when the version has no confirmation email or no submitter address was answered, or, for staff, when the cadence is not per submission or there are no recipients.

- [ ] **Step 1: Wiring helper** `tests/integration/submissions/wiring.ts`:

```ts
import type { Pool } from "pg";
import type { DefinitionsDeps } from "@/modules/definitions/application/deps";
import { PgDraftRepository } from "@/modules/definitions/infrastructure/pg-draft-repository";
import { PgFormRepository } from "@/modules/definitions/infrastructure/pg-form-repository";
import { PgVersionRepository } from "@/modules/definitions/infrastructure/pg-version-repository";
import { PgAuditLog } from "@/modules/identity/infrastructure/pg-audit-log";
import { PgAuditLogReader } from "@/modules/identity/infrastructure/pg-audit-log-reader";
import { FileTypeSniffer } from "@/modules/media/infrastructure/file-type-sniffer";
import { LocalDiskStorage } from "@/modules/media/infrastructure/local-disk-storage";
import { PgMediaRepository } from "@/modules/media/infrastructure/pg-media-repository";
import { SharpImageEncoder } from "@/modules/media/infrastructure/sharp-image-encoder";
import { VersionCache, type SubmissionsDeps } from "@/modules/submissions/application";
import { PgInProgressRepository } from "@/modules/submissions/infrastructure/pg-in-progress-repository";
import { PgSubmissionRepository } from "@/modules/submissions/infrastructure/pg-submission-repository";
import { PgSubmissionStats } from "@/modules/submissions/infrastructure/pg-submission-stats";
import type { JobQueue } from "@/shared/application/ports/job-queue";
import { RecordingLogger } from "@/shared/application/testing/fakes";
import { buildDefaultRegistry } from "@/shared/domain/form-model";
import { systemClock } from "@/shared/infrastructure/clock";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { PgJobQueue } from "@/shared/infrastructure/jobs/pg-job-queue";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";

/** The real adapters of the three modules, as the container wires them. */
export function pgSubmissionsDeps(pool: Pool, dirs: { staging: string; durable: string }, over: { queue?: JobQueue } = {}): SubmissionsDeps {
  const uow = new PgUnitOfWorkFactory(pool);
  const registry = buildDefaultRegistry();
  const queue = over.queue ?? new PgJobQueue(systemIdGenerator, systemClock);
  const definitions: DefinitionsDeps = {
    forms: new PgFormRepository(pool), drafts: new PgDraftRepository(pool), versions: new PgVersionRepository(pool),
    stats: new PgSubmissionStats(pool), audit: new PgAuditLog(), auditReader: new PgAuditLogReader(pool), uow,
    clock: systemClock, ids: systemIdGenerator, registry, allowedRecipientDomains: ["example.com"], publicBaseUrl: "http://localhost:3000",
  };
  return {
    definitions,
    media: {
      staging: new LocalDiskStorage(dirs.staging), durable: new LocalDiskStorage(dirs.durable), sniffer: new FileTypeSniffer(),
      encoder: new SharpImageEncoder(), media: new PgMediaRepository(pool), queue, uow, ids: systemIdGenerator, clock: systemClock,
    },
    inProgress: new PgInProgressRepository(pool), submissions: new PgSubmissionRepository(pool), queue, uow,
    clock: systemClock, ids: systemIdGenerator, registry, logger: new RecordingLogger(), versions: new VersionCache(), random: Math.random,
  };
}
```

- [ ] **Step 2: Failing integration tests** `tests/integration/submissions/intake.test.ts`:

```ts
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyLifecycle } from "@/modules/definitions/application";
import { expireInProgress, postContext, savePage, submitForm, uploadFile, type SubmissionsDeps } from "@/modules/submissions/application";
import { CONSENT_TEXT } from "@/modules/submissions/domain/testing/versions";
import type { EnqueueOptions, JobPayload, JobQueue } from "@/shared/application/ports/job-queue";
import type { UnitOfWork } from "@/shared/application/ports/unit-of-work";
import { RecordingLogger } from "@/shared/application/testing/fakes";
import { consentTextVersion } from "@/shared/domain/form-model";
import { systemClock } from "@/shared/infrastructure/clock";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { PgJobQueue } from "@/shared/infrastructure/jobs/pg-job-queue";
import { brokenMp4, htmlPretendingToBeJpeg, syntheticJpegWithGps, syntheticPng } from "../../fakes/media-files";
import { testPool, truncateAll, waitForLockWaiters } from "../db";
import { seedPublishedForm } from "./factories";
import { pgSubmissionsDeps } from "./wiring";

const consent = { accepted: true, textVersion: consentTextVersion(CONSENT_TEXT) };

/** A queue whose nth enqueue fails, to prove the intake is one transaction. */
class FailingQueue implements JobQueue {
  private calls = 0;
  constructor(private readonly inner: JobQueue, private readonly failAt: number) {}
  enqueue(uow: UnitOfWork, type: string, payload: JobPayload, opts?: EnqueueOptions): Promise<string | null> {
    if (this.calls++ === this.failAt) return Promise.reject(new Error("injected enqueue failure"));
    return this.inner.enqueue(uow, type, payload, opts);
  }
}

describe("the intake against Postgres", () => {
  const pool = testPool();
  let dir: string;
  let slug: string;
  let formId: string;
  beforeEach(async () => {
    await truncateAll(pool);
    dir = await mkdtemp(path.join(os.tmpdir(), "effluz-intake-"));
    ({ slug, formId } = await seedPublishedForm(pool));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const count = async (table: string) => (await pool.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]?.n ?? 0;
  const stagedFiles = async () => (await readdir(path.join(dir, "staging"), { recursive: true }).catch(() => [])).filter((f) => String(f).includes("."));

  async function contextOf(deps: SubmissionsDeps, id: string) {
    const ctx = await postContext(deps, { slug, state: { kind: "record", id }, submitToken: null });
    if (!ctx.ok) throw new Error(ctx.outcome.kind);
    return ctx;
  }

  /** Page 1 answered with a baby; the record now stands on the photos page. */
  async function reachPhotos(deps: SubmissionsDeps): Promise<string> {
    const none = await postContext(deps, { slug, state: { kind: "none" }, submitToken: null });
    if (!none.ok) throw new Error("closed");
    const start = await savePage(deps, none, {
      pageKey: "page_contact", action: { kind: "next" }, answers: { f_name: "Ana Prueba", f_email: "family@example.com", f_baby: "yes_opt" },
      decodeIssues: [], raw: {}, incoming: [], renderedAt: new Date(Date.now() - 60_000), honeypot: "", submitToken: null, acceptLanguage: "es", state: { kind: "none" },
    });
    if (start.kind !== "show") throw new Error(start.kind);
    return start.recordId;
  }

  /** Two real photos uploaded, then on to the consent page. */
  async function reachConsent(deps: SubmissionsDeps): Promise<string> {
    const id = await reachPhotos(deps);
    for (const bytes of [await syntheticJpegWithGps(), await syntheticPng()]) {
      const up = await uploadFile(deps, await contextOf(deps, id), { fieldKey: "f_photos", bytes, renderedAt: null, acceptLanguage: "es" });
      if (!up.ok) throw new Error(up.code);
    }
    await savePage(deps, await contextOf(deps, id), { ...emptyPost(id), pageKey: "page_baby" });
    return id;
  }

  function emptyPost(id: string) {
    return {
      pageKey: "page_consent", action: { kind: "next" as const }, answers: {}, decodeIssues: [], raw: {}, incoming: [],
      renderedAt: null, honeypot: "", submitToken: null, acceptLanguage: "es", state: { kind: "record" as const, id },
    };
  }

  async function submit(deps: SubmissionsDeps, id: string) {
    const token = (await pool.query<{ t: string }>("select submit_token as t from submission_in_progress where id = $1", [id])).rows[0]?.t ?? null;
    const ctx = await postContext(deps, { slug, state: { kind: "record", id }, submitToken: token });
    if (!ctx.ok) return ctx.outcome;
    return submitForm(deps, ctx, { ...emptyPost(id), action: { kind: "submit" }, answers: { f_consent: consent }, submitToken: token });
  }

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
      const { rows } = await pool.query<{ n: number }>("select next_reference as n from form where id = $1", [formId]);
      expect(rows[0]?.n).toBe(1);
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

  it("answers two simultaneous Submits with one submission", async () => {
    const deps = pgSubmissionsDeps(pool, { staging: path.join(dir, "staging"), durable: path.join(dir, "durable") });
    const id = await reachConsent(deps);
    const [a, b] = await Promise.all([submit(deps, id), submit(deps, id)]);
    expect(a).toEqual(b);
    expect(a.kind).toBe("submitted");
    expect(await count("submission")).toBe(1);
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

  it("jobs.cleanup removes expired records and their staged files", async () => {
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
});
```

`tests/integration/submissions/message-source.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { updateSettings } from "@/modules/definitions/application";
import { VersionCache } from "@/modules/submissions/application";
import { registry } from "@/modules/submissions/domain/testing/versions";
import { SubmissionMessageSource } from "@/modules/submissions/infrastructure/message-source";
import { PgSubmissionRepository } from "@/modules/submissions/infrastructure/pg-submission-repository";
import { testPool, truncateAll } from "../db";
import { seedPublishedForm } from "./factories";
import { pgSubmissionsDeps } from "./wiring";

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

- [ ] **Step 4: Implement** `message-source.ts`:

```ts
import { loadForm, type DefinitionsDeps } from "@/modules/definitions/application";
import type { MessageSource, StaffNotificationData, SubmitterConfirmationData } from "@/modules/notifications/application";
import type { FieldTypeRegistry } from "@/shared/domain/form-model";
import { resolveText } from "@/shared/domain/localized-text";
import type { SubmissionRepository } from "../application/ports/submission-repository";
import type { VersionCache } from "../application/version-cache";
import { submitterAddress } from "../domain/intake";

function parts(at: Date, timeZone: string): { date: string; time: string } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const get = (type: string) => f.formatToParts(at).find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** The data the two email jobs need, read at run time from a submission id (specs/system/jobs.md). */
export class SubmissionMessageSource implements MessageSource {
  constructor(
    private readonly deps: {
      submissions: SubmissionRepository;
      definitions: DefinitionsDeps;
      versions: VersionCache;
      registry: FieldTypeRegistry;
      publicBaseUrl: string;
      privacyContact: string;
    },
  ) {}

  async submitterConfirmation(id: string): Promise<{ to: string; data: SubmitterConfirmationData } | null> {
    const s = await this.deps.submissions.findById(id);
    if (s === null) return null;
    const [form, version] = await Promise.all([loadForm(this.deps.definitions, s.formId), this.deps.versions.get(this.deps.definitions, s.versionId)]);
    const email = version?.document.confirmation.email;
    if (form === null || version === null || email === undefined) return null;
    const to = submitterAddress(version.document, this.deps.registry, s.answers);
    if (to === null) return null;
    const { languages } = version.document;
    return {
      to,
      data: {
        locale: s.locale,
        formTitle: resolveText(version.document.title, s.locale, languages),
        subject: resolveText(email.subject, s.locale, languages),
        body: resolveText(email.body, s.locale, languages),
        receivedOn: new Intl.DateTimeFormat(s.locale, { dateStyle: "long", timeZone: form.settings.timezone }).format(s.receivedAt),
        reference: s.reference,
        retentionMonths: form.settings.retentionMonths,
        contact: this.deps.privacyContact,
      },
    };
  }

  async staffNotification(id: string): Promise<{ to: string[]; data: StaffNotificationData } | null> {
    const s = await this.deps.submissions.findById(id);
    if (s === null) return null;
    const form = await loadForm(this.deps.definitions, s.formId);
    if (form === null) return null;
    const { notificationCadence, notificationRecipients, timezone } = form.settings;
    if (notificationCadence !== "per_submission" || notificationRecipients.length === 0) return null;
    const local = parts(s.receivedAt, timezone);
    const utc = parts(s.receivedAt, "UTC");
    return {
      to: [...notificationRecipients],
      data: {
        formTitle: resolveText(form.title, "en", form.languages),
        reference: s.reference,
        receivedAt: `${local.date} ${local.time} ${timezone}, ${utc.time} UTC`,
        link: `${this.deps.publicBaseUrl}/admin/forms/${form.id}`,
      },
    };
  }
}
```

- [ ] **Step 5: Run** `pnpm test:integration tests/integration/submissions && pnpm test && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 6: Commit** `test(submissions): intake atomicity, the close race, duplicate submits and cleanup against Postgres; email message source`

---

### Task 23: Renderer copy, formatting and validation messages

**Files:**
- Create: `src/modules/submissions/presentation/copy.ts`, `format.ts`, `messages.ts`, with `copy.test.ts`, `format.test.ts`, `messages.test.ts` beside them

**Interfaces:**
- Consumes: `fill`, `Text` from `@/shared/presentation/copy`; `specTableRows` (Task 3); `validationCodes`, `ValidationIssue`, `UploadLimits`; `FileIssue`, `UploadRefusal` (Tasks 16, 20).
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
export function formatBytes(bytes: number, locale: Locale): string;           // "512 kB", "1.5 MB"
export function formatIsoDate(iso: string, locale: Locale): string;           // "10 October 2026" / "10 de octubre de 2026"
export function formatInstant(iso: string, locale: Locale, timeZone: string): string;
export function kindsKey(kinds: readonly ("image" | "video")[]): "kinds_images" | "kinds_videos" | "kinds_mixed";
export function limitsKey(kinds: readonly ("image" | "video")[]): "files_limits_images" | "files_limits_videos" | "files_limits_mixed";
export function acceptAttribute(kinds: readonly ("image" | "video")[]): string;
// messages.ts
export function issueMessage(issue: ValidationIssue, label: string, locale: Locale): string;
export function fileIssueMessage(issue: Pick<FileIssue, "code" | "file">, limits: UploadLimits, locale: Locale): string;
export function uploadRefusalMessage(code: UploadRefusal, ctx: { file: string; label: string; limits: UploadLimits }, locale: Locale): string;
export function errorSummaryHeading(count: number, locale: Locale): string;
export function filesCount(count: number, max: number, locale: Locale): string;
```

A catalog row is found from the code by replacing underscores with spaces (`files_min` is "files min"); when `{n}` is one in that language the `… one` row is used if it exists (renderer.md, "Message catalog").

- [ ] **Step 1: Failing tests.** `copy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validationCodes } from "@/shared/domain/form-model";
import { specTableRows } from "@/shared/presentation/testing/spec-copy";
import { catalog, chrome, t } from "./copy";

const asText = (rows: Map<string, string[]>) => Object.fromEntries([...rows].map(([k, [en, es]]) => [k, { en, es }]));

describe("renderer copy", () => {
  it("binds every row of the fixed chrome copy in renderer.md, which owns the text", () => {
    expect(chrome).toEqual(asText(specTableRows("specs/ui-ux/renderer.md", "Fixed chrome copy")));
  });

  it("binds every row of the message catalog", () => {
    expect(catalog).toEqual(asText(specTableRows("specs/ui-ux/renderer.md", "Message catalog")));
  });

  it("has a catalog row for every validation code and every file refusal", () => {
    for (const code of [...validationCodes, "file_too_large", "file_wrong_type", "file_unreadable", "upload_failed"]) {
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
import { describe, expect, it } from "vitest";
import { acceptAttribute, formatBytes, formatIsoDate, formatMegabytes, kindsKey, limitsKey } from "./format";

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
import { describe, expect, it } from "vitest";
import { errorSummaryHeading, fileIssueMessage, filesCount, issueMessage, uploadRefusalMessage } from "./messages";

const limits = { kinds: ["image", "video"] as const, maxFiles: 10, maxSizeMb: 10 };

describe("messages", () => {
  it("builds each message from the rule and the label, in the locale", () => {
    expect(issueMessage({ code: "required", field: "f" }, "Celular", "es")).toBe("Celular es obligatorio");
    expect(issueMessage({ code: "email_syntax", field: "f" }, "E-mail", "en")).toBe("Enter a valid email address, like name@example.com");
    expect(issueMessage({ code: "date_min", field: "f", params: { date: "2026-01-31" } }, "Birth", "en")).toBe("Birth must be on or after January 31, 2026");
  });

  it("uses the singular row when n is one", () => {
    expect(issueMessage({ code: "files_min", field: "f", params: { n: 1 } }, "Fotos", "es")).toBe("Sube al menos 1 archivo en Fotos");
    expect(issueMessage({ code: "files_min", field: "f", params: { n: 2 } }, "Fotos", "es")).toBe("Sube al menos 2 archivos en Fotos");
    expect(issueMessage({ code: "max_length", field: "f", params: { n: 1 } }, "Code", "en")).toBe("Code must have no more than 1 character");
    expect(errorSummaryHeading(1, "en")).toBe("Please fix 1 problem before continuing");
    expect(errorSummaryHeading(3, "es")).toBe("Corrige 3 problemas para continuar");
    expect(filesCount(0, 1, "en")).toBe("0 of 1 file");
    expect(filesCount(2, 10, "es")).toBe("2 de 10 archivos");
  });

  it("names the file, the size and the kinds in file messages", () => {
    expect(fileIssueMessage({ code: "file_too_large", file: "a.jpg" }, limits, "en")).toBe("a.jpg is larger than 10 MB");
    expect(fileIssueMessage({ code: "file_wrong_type", file: "a.txt" }, limits, "es")).toBe(
      "a.txt no es un tipo permitido. Usa fotos JPEG, PNG, WebP o HEIC, o videos MP4 o MOV",
    );
    expect(uploadRefusalMessage("files_max", { file: "a.jpg", label: "Fotos", limits }, "es")).toBe("Puedes subir hasta 10 archivos en Fotos");
    expect(uploadRefusalMessage("expired", { file: "a.jpg", label: "Fotos", limits }, "en")).toBe("a.jpg did not upload. Check your connection and retry");
  });
});
```

- [ ] **Step 2: Run** `pnpm test src/modules/submissions/presentation`: fails.

- [ ] **Step 3: Implement** `copy.ts` (every row exactly as in `specs/ui-ux/renderer.md` after Task 1):

```ts
import type { Locale } from "@/shared/domain/localized-text";
import { fill, type Text } from "@/shared/presentation/copy";

/**
 * The renderer's fixed chrome and message catalog. The text is owned by
 * specs/ui-ux/renderer.md ("Fixed chrome copy", "Message catalog");
 * copy.test.ts keeps these objects equal to those rows.
 */
export const chrome = {
  skip_link: { en: "Skip to form", es: "Ir al formulario" },
  language_switch_label: { en: "Language", es: "Idioma" },
  progress: { en: "Page {n} of {total}", es: "Página {n} de {total}" },
  required_legend: { en: "Fields marked with * are required", es: "Los campos marcados con * son obligatorios" },
  back: { en: "Back", es: "Atrás" },
  next: { en: "Next", es: "Siguiente" },
  submit: { en: "Submit", es: "Enviar" },
  submitting: { en: "Submitting…", es: "Enviando…" },
  choose_one: { en: "Choose one", es: "Elige una opción" },
  choose_files: { en: "Choose files", es: "Elegir archivos" },
  files_count: { en: "{count} of {max} files", es: "{count} de {max} archivos" },
  files_limits_images: { en: "Photos up to {size} each.", es: "Fotos de hasta {size} cada una." },
  files_limits_mixed: { en: "Photos and videos up to {size} each.", es: "Fotos y videos de hasta {size} cada uno." },
  video_notice: {
    en: "Videos are stored exactly as sent. Unlike photos, we cannot remove hidden details such as location from them.",
    es: "Los videos se guardan tal como se envían. A diferencia de las fotos, no podemos quitarles datos ocultos como la ubicación.",
  },
  uploading: { en: "Uploading {percent}%", es: "Subiendo {percent}%" },
  uploaded: { en: "Uploaded", es: "Subido" },
  remove: { en: "Remove", es: "Quitar" },
  retry: { en: "Retry", es: "Reintentar" },
  uploads_pending: { en: "Wait for uploads to finish before continuing", es: "Espera a que terminen las subidas para continuar" },
  error_summary_heading: { en: "Please fix {count} problems before continuing", es: "Corrige {count} problemas para continuar" },
  consent_checkbox: { en: "I have read and agree", es: "He leído y acepto" },
  char_count: { en: "{n} of {max} characters", es: "{n} de {max} caracteres" },
  confirmation_reference: { en: "Your reference: {ref}", es: "Tu referencia: {ref}" },
  confirmation_close: { en: "You can close this page.", es: "Puedes cerrar esta página." },
  fill_another: { en: "Fill in another form", es: "Llenar otro formulario" },
  closed_title: { en: "This form is closed", es: "Este formulario está cerrado" },
  closed_body: { en: "It no longer accepts responses. Thank you for your interest.", es: "Ya no acepta respuestas. Gracias por tu interés." },
  not_open_title: { en: "This form is not open yet", es: "Este formulario aún no está abierto" },
  not_open_body: { en: "It opens on {date}.", es: "Abre el {date}." },
  not_found_title: { en: "We could not find this form", es: "No encontramos este formulario" },
  not_found_body: { en: "Check the link, or ask the person who shared it with you.", es: "Revisa el enlace o pregunta a quien te lo compartió." },
  expired_title: { en: "Your session expired", es: "Tu sesión expiró" },
  expired_body: {
    en: "For your privacy, unfinished answers are kept for 24 hours only. Please start again.",
    es: "Por tu privacidad, las respuestas sin terminar se guardan solo 24 horas. Por favor, empieza de nuevo.",
  },
  start_again: { en: "Start again", es: "Empezar de nuevo" },
  error_title: { en: "Something went wrong", es: "Algo salió mal" },
  error_body: { en: "Your answers on this page were not saved. Please try again.", es: "Las respuestas de esta página no se guardaron. Inténtalo de nuevo." },
  try_again: { en: "Try again", es: "Intentar de nuevo" },
  submit_failed: {
    en: "Your answers were not sent. Check your connection and try again.",
    es: "Tus respuestas no se enviaron. Revisa tu conexión e inténtalo de nuevo.",
  },
  offline: {
    en: "You seem to be offline. We will continue when you reconnect.",
    es: "Parece que no tienes conexión. Continuaremos cuando vuelvas a conectarte.",
  },
  privacy_footer: {
    en: "This form is run by Effluz. Answers are stored in the United States and deleted after {retention} months. To request deletion, write to {contact}.",
    es: "Este formulario es de Effluz. Las respuestas se guardan en Estados Unidos y se eliminan después de {retention} meses. Para pedir que se eliminen, escribe a {contact}.",
  },
  switch_to_en: { en: "English", es: "English" },
  switch_to_es: { en: "Español", es: "Español" },
  wordmark: { en: "Effluz", es: "Effluz" },
  date_day: { en: "Day", es: "Día" },
  date_month: { en: "Month", es: "Mes" },
  date_year: { en: "Year", es: "Año" },
  files_limits_videos: { en: "Videos up to {size} each.", es: "Videos de hasta {size} cada uno." },
  kinds_images: { en: "JPEG, PNG, WebP or HEIC photos", es: "fotos JPEG, PNG, WebP o HEIC" },
  kinds_videos: { en: "MP4 or MOV videos", es: "videos MP4 o MOV" },
  kinds_mixed: { en: "JPEG, PNG, WebP or HEIC photos, or MP4 or MOV videos", es: "fotos JPEG, PNG, WebP o HEIC, o videos MP4 o MOV" },
  file_row: { en: "File {n}, {size}", es: "Archivo {n}, {size}" },
  removed: { en: "{file} removed", es: "Se quitó {file}" },
  honeypot_label: { en: "Leave this field empty", es: "Deja este campo vacío" },
  error_summary_heading_one: { en: "Please fix 1 problem before continuing", es: "Corrige 1 problema para continuar" },
  files_count_one: { en: "{count} of 1 file", es: "{count} de 1 archivo" },
} as const satisfies Record<string, Text>;

export const catalog = {
  required: { en: "{label} is required", es: "{label} es obligatorio" },
  "min length": { en: "{label} must have at least {n} characters", es: "{label} debe tener al menos {n} caracteres" },
  "max length": { en: "{label} must have no more than {n} characters", es: "{label} no debe tener más de {n} caracteres" },
  pattern: { en: "{label} is not in the expected format", es: "{label} no tiene el formato esperado" },
  "email syntax": { en: "Enter a valid email address, like name@example.com", es: "Escribe un correo válido, como nombre@ejemplo.com" },
  "number min": { en: "{label} must be at least {n}", es: "{label} debe ser al menos {n}" },
  "number max": { en: "{label} must be no more than {n}", es: "{label} no debe ser más de {n}" },
  integer: { en: "{label} must be a whole number", es: "{label} debe ser un número entero" },
  "not a number": { en: "{label} must be a number", es: "{label} debe ser un número" },
  "date invalid": { en: "Enter a real date for {label}", es: "Escribe una fecha real para {label}" },
  "date min": { en: "{label} must be on or after {date}", es: "{label} debe ser el {date} o después" },
  "date max": { en: "{label} must be on or before {date}", es: "{label} debe ser el {date} o antes" },
  "date not future": { en: "{label} cannot be in the future", es: "{label} no puede ser una fecha futura" },
  "choice min": { en: "Select at least {n} options for {label}", es: "Selecciona al menos {n} opciones en {label}" },
  "choice max": { en: "Select no more than {n} options for {label}", es: "Selecciona como máximo {n} opciones en {label}" },
  "must be true": { en: "You must check {label} to continue", es: "Debes marcar {label} para continuar" },
  consent: { en: "You must agree to continue", es: "Debes aceptar para continuar" },
  "files min": { en: "Upload at least {n} files for {label}", es: "Sube al menos {n} archivos en {label}" },
  "files max": { en: "You can upload up to {n} files for {label}", es: "Puedes subir hasta {n} archivos en {label}" },
  "invalid shape": { en: "{label} has an unexpected value. Please try again", es: "{label} tiene un valor inesperado. Inténtalo de nuevo" },
  "unknown option": { en: "Choose one of the listed options for {label}", es: "Elige una de las opciones de {label}" },
  "file too large": { en: "{file} is larger than {size}", es: "{file} pesa más de {size}" },
  "file wrong type": { en: "{file} is not a supported type. Use {kinds}", es: "{file} no es un tipo permitido. Usa {kinds}" },
  "file unreadable": { en: "{file} could not be read. Try another file", es: "No se pudo leer {file}. Prueba con otro archivo" },
  "upload failed": { en: "{file} did not upload. Check your connection and retry", es: "{file} no se subió. Revisa tu conexión y reintenta" },
  "min length one": { en: "{label} must have at least {n} character", es: "{label} debe tener al menos {n} carácter" },
  "max length one": { en: "{label} must have no more than {n} character", es: "{label} no debe tener más de {n} carácter" },
  "choice min one": { en: "Select at least {n} option for {label}", es: "Selecciona al menos {n} opción en {label}" },
  "choice max one": { en: "Select no more than {n} option for {label}", es: "Selecciona como máximo {n} opción en {label}" },
  "files min one": { en: "Upload at least {n} file for {label}", es: "Sube al menos {n} archivo en {label}" },
  "files max one": { en: "You can upload up to {n} file for {label}", es: "Puedes subir hasta {n} archivo en {label}" },
} as const satisfies Record<string, Text>;

export type ChromeKey = keyof typeof chrome;
export type CatalogKey = keyof typeof catalog;

export function t(locale: Locale, key: ChromeKey, vars: Readonly<Record<string, string>> = {}): string {
  return fill(chrome[key][locale], vars);
}

export function isOne(locale: Locale, n: number): boolean {
  return new Intl.PluralRules(locale).select(n) === "one";
}
```

`format.ts`:

```ts
import type { Locale } from "@/shared/domain/localized-text";

type Kind = "image" | "video";
const MB = 1024 * 1024;

export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(locale).format(n);
}

export function formatMegabytes(mb: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: "unit", unit: "megabyte", unitDisplay: "short", maximumFractionDigits: 1 }).format(mb);
}

export function formatBytes(bytes: number, locale: Locale): string {
  if (bytes >= MB) return formatMegabytes(bytes / MB, locale);
  return new Intl.NumberFormat(locale, { style: "unit", unit: "kilobyte", unitDisplay: "short", maximumFractionDigits: 0 }).format(Math.max(1, bytes / 1024));
}

export function formatIsoDate(iso: string, locale: Locale): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(date);
}

export function formatInstant(iso: string, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone, timeZoneName: "short" }).format(new Date(iso));
}

export function kindsKey(kinds: readonly Kind[]): "kinds_images" | "kinds_videos" | "kinds_mixed" {
  if (kinds.includes("image") && kinds.includes("video")) return "kinds_mixed";
  return kinds.includes("video") ? "kinds_videos" : "kinds_images";
}

export function limitsKey(kinds: readonly Kind[]): "files_limits_images" | "files_limits_videos" | "files_limits_mixed" {
  const k = kindsKey(kinds);
  return k === "kinds_mixed" ? "files_limits_mixed" : k === "kinds_videos" ? "files_limits_videos" : "files_limits_images";
}

/** A hint for the file picker only; the server decides by content. */
export function acceptAttribute(kinds: readonly Kind[]): string {
  const parts: string[] = [];
  if (kinds.includes("image")) parts.push("image/jpeg,image/png,image/webp,image/heic,image/heif,.heic");
  if (kinds.includes("video")) parts.push("video/mp4,video/quicktime");
  return parts.join(",");
}
```

`messages.ts`:

```ts
import type { UploadLimits, ValidationIssue } from "@/shared/domain/form-model";
import type { Locale } from "@/shared/domain/localized-text";
import { fill } from "@/shared/presentation/copy";
import type { FileIssue, UploadRefusal } from "../application";
import { catalog, isOne, t, type CatalogKey } from "./copy";
import { formatIsoDate, formatMegabytes, formatNumber, kindsKey } from "./format";

function row(name: string, n: number | undefined, locale: Locale): CatalogKey {
  const one = `${name} one`;
  if (n !== undefined && isOne(locale, n) && Object.hasOwn(catalog, one)) return one as CatalogKey;
  return name as CatalogKey;
}

/** The renderer builds every message from the rule and the label; staff never write them. */
export function issueMessage(issue: ValidationIssue, label: string, locale: Locale): string {
  const n = typeof issue.params?.["n"] === "number" ? issue.params["n"] : undefined;
  const date = typeof issue.params?.["date"] === "string" ? issue.params["date"] : undefined;
  return fill(catalog[row(issue.code.replaceAll("_", " "), n, locale)][locale], {
    label,
    n: n === undefined ? "" : formatNumber(n, locale),
    date: date === undefined ? "" : formatIsoDate(date, locale),
  });
}

function fileVars(file: string, limits: UploadLimits, locale: Locale) {
  return { file, size: formatMegabytes(limits.maxSizeMb, locale), kinds: t(locale, kindsKey(limits.kinds)) };
}

export function fileIssueMessage(issue: Pick<FileIssue, "code" | "file">, limits: UploadLimits, locale: Locale): string {
  return fill(catalog[issue.code.replaceAll("_", " ") as CatalogKey][locale], fileVars(issue.file, limits, locale));
}

/** The JSON answer of an early upload. An expired or refused session reads as a failed upload. */
export function uploadRefusalMessage(
  code: UploadRefusal,
  ctx: { file: string; label: string; limits: UploadLimits },
  locale: Locale,
): string {
  if (code === "files_max") return issueMessage({ code: "files_max", field: "", params: { n: ctx.limits.maxFiles } }, ctx.label, locale);
  const name = code === "expired" || code === "not_allowed" ? "upload failed" : code.replaceAll("_", " ");
  return fill(catalog[name as CatalogKey][locale], fileVars(ctx.file, ctx.limits, locale));
}

export function errorSummaryHeading(count: number, locale: Locale): string {
  return isOne(locale, count) ? t(locale, "error_summary_heading_one") : t(locale, "error_summary_heading", { count: formatNumber(count, locale) });
}

export function filesCount(count: number, max: number, locale: Locale): string {
  const vars = { count: formatNumber(count, locale), max: formatNumber(max, locale) };
  return isOne(locale, max) ? t(locale, "files_count_one", vars) : t(locale, "files_count", vars);
}
```

(`issueMessage` for `email_syntax` and `consent` ignores the label: those rows have no `{label}`.)

- [ ] **Step 4: Run** `pnpm test src/modules/submissions/presentation && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(submissions): renderer copy bound to the spec, locale formatting and validation messages`

---

### Task 24: Field renderers, form decoding and the renderer conformance test

**Files:**
- Create: `src/modules/submissions/presentation/fields/types.ts`, `FieldShell.tsx`, `text.tsx`, `number.tsx`, `date.tsx`, `choice.tsx`, `checkbox.tsx`, `consent.tsx`, `file-upload.tsx`, `section.tsx`, `index.ts`
- Create: `src/modules/submissions/presentation/styles.ts` and an empty `renderer.module.css` (Task 25 fills the stylesheet)
- Create: `src/modules/submissions/presentation/decode.ts`, `decode.test.ts`
- Test: `src/modules/submissions/presentation/fields/conformance.test.ts`, `fields/fields.test.ts`

**Interfaces:**
- Consumes: Task 23 copy and messages; `RichText` (Task 3); `effectiveDisplay`, `consentTextVersion`, `fieldTypeIds`, `FieldTypeId`, `Field`, `ValidationCode`, form model fixtures through `fieldTypes`; `PageAction`, `IncomingFile` (Task 18).
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
// fields/index.ts
export const fieldRenderers: Record<FieldTypeId, FieldRenderer>;
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

Control names: a field's inputs use its key (`<key>`, or `<key>.day`, `<key>.month`, `<key>.year` for dates). The page's own fields are `_page`, `_action`, `_rendered`, `_token` and the honeypot `website-url`; none can be a field key (keys match `^[a-z][a-z0-9_]{3,31}$`).

Markup rules every component keeps (renderer.md, "Field rendering", and design-system/accessibility.md, "Forms"): `<label for>` or `<fieldset>` with `<legend>`; help before the control, linked with `aria-describedby`; the error slot `<p id="<key>-error">` always present, linked and `aria-invalid="true"` when it holds a message; `required` and `aria-required` on required inputs and the star after the label with `aria-hidden`; no `type="number"`, no native date picker, no custom widgets.

- [ ] **Step 1: Failing conformance test** `fields/conformance.test.ts`:

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fieldTypeIds, fieldTypes, type Field } from "@/shared/domain/form-model";
import { fieldRenderers } from "./index";
import type { FieldInput } from "./types";

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
  return { key: "f_probe", type: id, label: { en: "Probe", es: "Sonda" }, required: true, personal: false, validation: [], settings };
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

`fields/fields.test.ts` (per-type behavior the conformance loop does not reach):

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { consentTextVersion, type Field } from "@/shared/domain/form-model";
import { fieldRenderers } from "./index";
import type { FieldProps } from "./types";

const base = (field: Partial<Field> & Pick<Field, "type" | "settings">): Field => ({
  key: "f_probe", label: { en: "Probe", es: "Sonda" }, required: false, personal: false, validation: [], ...field,
});
const render = (props: Partial<FieldProps> & Pick<FieldProps, "field">) =>
  renderToStaticMarkup(
    createElement(fieldRenderers[props.field.type].Component, {
      locale: "en", languages: "bilingual", slug: "probe-form", label: "Probe", help: null, required: false,
      values: {}, error: null, files: [], ...props,
    }),
  );
const input = (values: Record<string, string>) => ({ get: (n: string) => values[n] ?? null, getAll: (n: string) => (values[n] ? [values[n]] : []) });

describe("field renderers", () => {
  it("number: text input with a decimal keypad, unit after it, and not_a_number for words", () => {
    const field = base({ type: "number", settings: { integerOnly: false, unit: { en: "weeks", es: "semanas" } } });
    const html = render({ field });
    expect(html).toContain('inputmode="decimal"');
    expect(html).toContain("weeks");
    expect(fieldRenderers.number.decode(input({ f_probe: "2,5" }), field)).toEqual({ value: 2.5, issue: null });
    expect(fieldRenderers.number.decode(input({ f_probe: "thirty" }), field)).toEqual({ value: undefined, issue: "not_a_number" });
    expect(fieldRenderers.number.decode(input({ f_probe: " " }), field)).toEqual({ value: undefined, issue: null });
  });

  it("date: day, month and year in the locale's order inside a fieldset, impossible input is date_invalid", () => {
    const field = base({ type: "date", settings: {} });
    const en = render({ field, locale: "en" });
    expect(en.indexOf("f_probe.month")).toBeLessThan(en.indexOf("f_probe.day"));
    const es = render({ field, locale: "es" });
    expect(es.indexOf("f_probe.day")).toBeLessThan(es.indexOf("f_probe.month"));
    expect(es).toMatch(/<fieldset[^>]*>\s*<legend/);
    expect(fieldRenderers.date.decode(input({ "f_probe.day": "9", "f_probe.month": "11", "f_probe.year": "2026" }), field)).toEqual({ value: "2026-11-09", issue: null });
    expect(fieldRenderers.date.decode(input({ "f_probe.day": "9", "f_probe.year": "2026" }), field)).toEqual({ value: undefined, issue: "date_invalid" });
  });

  it("single choice: radio by default, dropdown only from seven options, with the Choose one placeholder", () => {
    const options = Array.from({ length: 7 }, (_, i) => ({ key: `opt_${String(i)}`, label: { en: `Option ${String(i)}`, es: `Opción ${String(i)}` } }));
    expect(render({ field: base({ type: "single_choice", settings: { options: options.slice(0, 6), display: "dropdown" } }) })).toContain('type="radio"');
    const dropdown = render({ field: base({ type: "single_choice", settings: { options, display: "dropdown" } }) });
    expect(dropdown).toContain("<select");
    expect(dropdown).toContain("Choose one");
  });

  it("consent: the text as legend, never pre-checked, decoded with the pinned text version", () => {
    const text = { en: "I agree to synthetic terms.", es: "Acepto términos sintéticos." };
    const field = base({ type: "consent", settings: { text, coveredItems: [] } });
    const html = render({ field, values: {} });
    expect(html).toContain("<legend");
    expect(html).toContain("I agree to synthetic terms.");
    expect(html).toContain("I have read and agree");
    expect(html).not.toContain("checked");
    expect(fieldRenderers.consent.decode(input({ f_probe: "accepted" }), field)).toEqual({
      value: { accepted: true, textVersion: consentTextVersion(text) }, issue: null,
    });
  });

  it("long text: counter only with a max length", () => {
    const plain = render({ field: base({ type: "long_text", settings: { rows: 4 } }) });
    expect(plain).not.toContain("characters");
    const capped = render({ field: base({ type: "long_text", settings: { rows: 4 }, validation: [{ rule: "max_length", value: 500 }] }), values: { f_probe: "abc" } });
    expect(capped).toContain("3 of 500 characters");
  });

  it("file upload: the video notice before the input, limits as help, rows with Remove, and the count", () => {
    const field = base({ type: "file_upload", settings: { kinds: ["image", "video"], maxFiles: 10, maxSizeMb: 10 } });
    const html = render({ field, files: [{ id: "00000000-0000-4000-8000-000000000001", kind: "image", label: "File 1, 12 kB", size: "12 kB" }] });
    expect(html.indexOf("Videos are stored exactly as sent")).toBeLessThan(html.indexOf('type="file"'));
    expect(html).toContain("Photos and videos up to 10 MB each.");
    expect(html).toContain('name="_action" value="remove:00000000-0000-4000-8000-000000000001"');
    expect(html).toContain("1 of 10 files");
    expect(html).toContain('accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,video/mp4,video/quicktime"');
  });

  it("short text infers autocomplete only where safe", () => {
    expect(render({ field: base({ type: "short_text", settings: {}, label: { en: "Full name" } }), label: "Full name" })).toContain('autocomplete="name"');
    expect(render({ field: base({ type: "short_text", settings: {} }), label: "Hospital" })).toContain('autocomplete="off"');
  });
});
```

`decode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { registry, storyVersion } from "../domain/testing/versions";
import { decodePagePost, parseAction } from "./decode";

describe("decodePagePost", () => {
  it("reads the page's answers, control fields and files, ignoring other pages' fields", async () => {
    const form = new FormData();
    form.set("_page", "page_contact");
    form.set("_action", "next");
    form.set("_rendered", "2026-10-10T11:59:00.000Z");
    form.set("website-url", "");
    form.set("f_name", "Ana Prueba");
    form.set("f_baby", "yes_opt");
    form.set("f_consent", "accepted");
    const decoded = await decodePagePost(form, storyVersion(), registry);
    expect(decoded).toMatchObject({
      pageKey: "page_contact", action: { kind: "next" }, answers: { f_name: "Ana Prueba", f_baby: "yes_opt" },
      raw: { f_name: "Ana Prueba", f_baby: "yes_opt" }, renderedAt: new Date("2026-10-10T11:59:00.000Z"), honeypot: "", submitToken: null,
    });
    expect(decoded?.answers).not.toHaveProperty("f_consent");
  });

  it("collects posted files of the page's upload fields with their names", async () => {
    const form = new FormData();
    form.set("_page", "page_baby");
    form.set("_action", "next");
    form.append("f_photos", new File([new Uint8Array([1, 2])], "a.jpg"));
    form.append("f_photos", new File([], ""));
    const decoded = await decodePagePost(form, storyVersion(), registry);
    expect(decoded?.incoming.map((f) => [f.fieldKey, f.name, f.bytes.length])).toEqual([["f_photos", "a.jpg", 2], ["f_photos", "", 0]]);
  });

  it("refuses an unknown page or action", async () => {
    const form = new FormData();
    form.set("_page", "page_nope");
    form.set("_action", "next");
    expect(await decodePagePost(form, storyVersion(), registry)).toBeNull();
    expect(parseAction("language:fr")).toBeNull();
    expect(parseAction("remove:00000000-0000-4000-8000-000000000001")).toEqual({ kind: "remove", fileId: "00000000-0000-4000-8000-000000000001" });
    expect(parseAction("language:es")).toEqual({ kind: "language", locale: "es" });
  });
});
```

- [ ] **Step 2: Run** `pnpm test src/modules/submissions/presentation`: fails.

- [ ] **Step 3: Implement.** `fields/types.ts`:

```ts
import type { ReactElement } from "react";
import type { Field, ValidationCode } from "@/shared/domain/form-model";
import type { Languages, Locale } from "@/shared/domain/localized-text";

export type FormValues = Readonly<Record<string, string | string[]>>;
export interface FieldInput {
  get(name: string): string | null;
  getAll(name: string): string[];
}
export interface Decoded {
  value: unknown;
  issue: ValidationCode | null;
}
export interface FileRowView {
  id: string;
  kind: "image" | "video";
  label: string;
  size: string;
}
export interface FieldProps {
  field: Field;
  locale: Locale;
  languages: Languages;
  slug: string;
  label: string;
  help: string | null;
  required: boolean;
  values: FormValues;
  error: string | null;
  files: readonly FileRowView[];
}
/** One field type's renderer capability; registered in fields/index.ts for every type. */
export interface FieldRenderer {
  decode(input: FieldInput, field: Field): Decoded;
  encode(value: unknown, field: Field): FormValues;
  Component(props: FieldProps): ReactElement | null;
}

export function ids(key: string): { control: string; help: string; error: string; legend: string } {
  return { control: `f-${key}`, help: `${key}-help`, error: `${key}-error`, legend: `${key}-legend` };
}

export const one = (values: FormValues, name: string): string => {
  const v = values[name];
  return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? "") : "";
};
export const many = (values: FormValues, name: string): string[] => {
  const v = values[name];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
};
```

`fields/FieldShell.tsx`:

```tsx
import type { ReactNode } from "react";
import { RichText } from "@/shared/presentation/RichText";
import { styles } from "../styles";
import { ids, type FieldProps } from "./types";

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

`src/modules/submissions/presentation/styles.ts` (with an empty `renderer.module.css` beside it until Task 25):

```ts
/// <reference types="next" />
import styles from "./renderer.module.css";

/** The renderer's class names. */
export { styles };
```

`fields/text.tsx`:

```tsx
import { FieldShell, describedBy } from "./FieldShell";
import { ids, one, type FieldProps, type FieldRenderer } from "./types";
import { styles } from "../styles";
import { t } from "../copy";
import { formatNumber } from "../format";
import { resolveText, type LocalizedText } from "@/shared/domain/localized-text";

const text = (input: { get(n: string): string | null }, key: string) => {
  const v = input.get(key);
  return { value: v === null ? undefined : v, issue: null };
};
const encodeText = (value: unknown, field: { key: string }) => (typeof value === "string" ? { [field.key]: value } : {});
const placeholder = (props: FieldProps) => {
  const p = (props.field.settings as { placeholder?: LocalizedText }).placeholder;
  return p ? resolveText(p, props.locale, props.languages) || undefined : undefined;
};

/** `autocomplete` only where the label makes the purpose clear; renderer.md, "Field rendering". */
function inferAutocomplete(label: string): string {
  const l = label.toLowerCase();
  if (/\b(full name|name and surname|nombre y apellido|nombre completo|your name|tu nombre)\b/.test(l)) return "name";
  if (/\b(organization|organisation|organización|empresa)\b/.test(l)) return "organization";
  return "off";
}

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

export const shortText: FieldRenderer = {
  decode: (input, field) => text(input, field.key),
  encode: encodeText,
  Component: (props) => <Input {...props} type="text" autoComplete={inferAutocomplete(props.label)} />,
};

export const email: FieldRenderer = {
  decode: (input, field) => text(input, field.key),
  encode: encodeText,
  Component: (props) => <Input {...props} type="email" inputMode="email" autoComplete="email" />,
};

export const phone: FieldRenderer = {
  decode: (input, field) => text(input, field.key),
  encode: encodeText,
  Component: (props) => <Input {...props} type="tel" inputMode="tel" autoComplete="tel" />,
};

export const longText: FieldRenderer = {
  decode: (input, field) => text(input, field.key),
  encode: encodeText,
  Component: (props) => {
    const id = ids(props.field.key);
    const rows = (props.field.settings as { rows?: number }).rows ?? 4;
    const max = props.field.validation.find((r) => r.rule === "max_length");
    const value = one(props.values, props.field.key);
    const counterId = `${props.field.key}-count`;
    return (
      <FieldShell props={props}>
        <textarea
          id={id.control}
          name={props.field.key}
          rows={rows}
          className={styles.textarea}
          defaultValue={value}
          placeholder={placeholder(props)}
          required={props.required}
          aria-required={props.required || undefined}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={describedBy(props, max ? [counterId] : []) || undefined}
          data-autogrow=""
        />
        {max && "value" in max ? (
          <p id={counterId} className={styles.counter} data-counter-for={props.field.key} data-max={String(max.value)} data-template={t(props.locale, "char_count")}>
            {t(props.locale, "char_count", { n: formatNumber([...value].length, props.locale), max: formatNumber(max.value, props.locale) })}
          </p>
        ) : null}
      </FieldShell>
    );
  },
};
```

(The counter counts code points here and graphemes on the server; the server's count is the one that validates. Keep the import order as Prettier and ESLint want it.)

`fields/number.tsx`:

```tsx
import { resolveText, type LocalizedText } from "@/shared/domain/localized-text";
import { styles } from "../styles";
import { FieldShell, describedBy } from "./FieldShell";
import { ids, one, type FieldRenderer } from "./types";

/** Postel: "2,5" and "2.5" both read as 2.5; empty is no answer. */
function parseNumber(raw: string): { value: number | undefined; ok: boolean } {
  const s = raw.trim().replace(/\s/g, "");
  if (s === "") return { value: undefined, ok: true };
  const normalized = s.includes(".") ? s.replace(/,/g, "") : s.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return { value: undefined, ok: false };
  return { value: Number(normalized), ok: true };
}

export const numberField: FieldRenderer = {
  decode: (input, field) => {
    const { value, ok } = parseNumber(input.get(field.key) ?? "");
    return ok ? { value, issue: null } : { value: undefined, issue: "not_a_number" };
  },
  encode: (value, field) => (typeof value === "number" ? { [field.key]: String(value) } : {}),
  Component: (props) => {
    const id = ids(props.field.key);
    const settings = props.field.settings as { integerOnly?: boolean; unit?: LocalizedText };
    const unit = settings.unit ? resolveText(settings.unit, props.locale, props.languages) : "";
    const unitId = `${props.field.key}-unit`;
    return (
      <FieldShell props={props}>
        <span className={styles.withUnit}>
          <input
            id={id.control}
            name={props.field.key}
            type="text"
            inputMode={settings.integerOnly ? "numeric" : "decimal"}
            autoComplete="off"
            className={styles.input}
            defaultValue={one(props.values, props.field.key)}
            required={props.required}
            aria-required={props.required || undefined}
            aria-invalid={props.error ? true : undefined}
            aria-describedby={describedBy(props, unit ? [unitId] : []) || undefined}
          />
          {unit ? <span id={unitId} className={styles.unit}>{unit}</span> : null}
        </span>
      </FieldShell>
    );
  },
};
```

`fields/date.tsx`:

```tsx
import type { Locale } from "@/shared/domain/localized-text";
import { t } from "../copy";
import { styles } from "../styles";
import { GroupShell } from "./FieldShell";
import { one, type FieldRenderer } from "./types";

const PARTS = { en: ["month", "day", "year"], es: ["day", "month", "year"] } as const satisfies Record<Locale, readonly string[]>;

export const dateField: FieldRenderer = {
  decode: (input, field) => {
    const [d, m, y] = ["day", "month", "year"].map((p) => (input.get(`${field.key}.${p}`) ?? "").trim());
    if (d === "" && m === "" && y === "") return { value: undefined, issue: null };
    if (!/^\d{1,2}$/.test(d ?? "") || !/^\d{1,2}$/.test(m ?? "") || !/^\d{4}$/.test(y ?? "")) {
      return { value: undefined, issue: "date_invalid" };
    }
    return { value: `${y ?? ""}-${(m ?? "").padStart(2, "0")}-${(d ?? "").padStart(2, "0")}`, issue: null };
  },
  encode: (value, field) => {
    const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
    if (!match) return {};
    return { [`${field.key}.year`]: match[1] ?? "", [`${field.key}.month`]: String(Number(match[2])), [`${field.key}.day`]: String(Number(match[3])) };
  },
  Component: (props) => (
    <GroupShell props={props}>
      <div className={styles.dateRow}>
        {PARTS[props.locale].map((part) => {
          const name = `${props.field.key}.${part}`;
          const key = part === "day" ? "date_day" : part === "month" ? "date_month" : "date_year";
          return (
            <label key={part} className={part === "year" ? styles.dateYear : styles.datePart}>
              <span className={styles.subLabel}>{t(props.locale, key)}</span>
              <input
                name={name}
                id={`f-${props.field.key}-${part}`}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={part === "year" ? 4 : 2}
                className={styles.input}
                defaultValue={one(props.values, name)}
                required={props.required}
                aria-required={props.required || undefined}
                aria-invalid={props.error ? true : undefined}
              />
            </label>
          );
        })}
      </div>
    </GroupShell>
  ),
};
```

(The conformance test's `<label for="f-f_probe"|<legend` alternative is met by the legend. The first sub-input gets focus from the error summary link `#f-<key>-<first part>`; `ErrorSummary` in Task 25 links group fields to their first control.)

`fields/choice.tsx`:

```tsx
import { effectiveDisplay, type Option } from "@/shared/domain/form-model";
import { resolveText } from "@/shared/domain/localized-text";
import { t } from "../copy";
import { styles } from "../styles";
import { FieldShell, GroupShell, describedBy } from "./FieldShell";
import { ids, many, one, type FieldProps, type FieldRenderer } from "./types";

const options = (props: FieldProps) => (props.field.settings as { options: Option[] }).options;

function Radios(props: FieldProps) {
  const current = one(props.values, props.field.key);
  return (
    <GroupShell props={props}>
      <div className={styles.options} role="radiogroup" aria-required={props.required || undefined}>
        {options(props).map((o, i) => (
          <label key={o.key} className={styles.option}>
            <input
              type="radio"
              name={props.field.key}
              value={o.key}
              id={i === 0 ? ids(props.field.key).control : undefined}
              defaultChecked={current === o.key}
              required={props.required}
            />
            <span>{resolveText(o.label, props.locale, props.languages)}</span>
          </label>
        ))}
      </div>
    </GroupShell>
  );
}

function Dropdown(props: FieldProps) {
  const current = one(props.values, props.field.key);
  return (
    <FieldShell props={props}>
      <select
        id={ids(props.field.key).control}
        name={props.field.key}
        className={styles.select}
        defaultValue={current}
        required={props.required}
        aria-required={props.required || undefined}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy(props) || undefined}
      >
        <option value="" disabled>
          {t(props.locale, "choose_one")}
        </option>
        {options(props).map((o) => (
          <option key={o.key} value={o.key}>
            {resolveText(o.label, props.locale, props.languages)}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export const singleChoice: FieldRenderer = {
  decode: (input, field) => ({ value: input.get(field.key) ?? undefined, issue: null }),
  encode: (value, field) => (typeof value === "string" ? { [field.key]: value } : {}),
  Component: (props) =>
    effectiveDisplay(props.field.settings as { options: Option[]; display: "radio" | "dropdown" }) === "dropdown" ? (
      <Dropdown {...props} />
    ) : (
      <Radios {...props} />
    ),
};

export const multipleChoice: FieldRenderer = {
  decode: (input, field) => {
    const values = input.getAll(field.key);
    return { value: values.length === 0 ? undefined : values, issue: null };
  },
  encode: (value, field) => (Array.isArray(value) ? { [field.key]: value.map(String) } : {}),
  Component: (props) => {
    const chosen = new Set(many(props.values, props.field.key));
    return (
      <GroupShell props={props}>
        <div className={styles.options}>
          {options(props).map((o, i) => (
            <label key={o.key} className={styles.option}>
              <input type="checkbox" name={props.field.key} value={o.key} id={i === 0 ? ids(props.field.key).control : undefined} defaultChecked={chosen.has(o.key)} />
              <span>{resolveText(o.label, props.locale, props.languages)}</span>
            </label>
          ))}
        </div>
      </GroupShell>
    );
  },
};
```

(Min and max selected show in help automatically, as renderer.md asks: `pageFieldViews` in Task 25 appends those sentences to the help it passes in.)

`fields/checkbox.tsx`:

```tsx
import { styles } from "../styles";
import { ErrorSlot, Help, describedBy } from "./FieldShell";
import { ids, one, type FieldRenderer } from "./types";

export const checkboxField: FieldRenderer = {
  decode: (input, field) => ({ value: input.get(field.key) === "on", issue: null }),
  encode: (value, field) => (value === true ? { [field.key]: "on" } : {}),
  Component: (props) => {
    const id = ids(props.field.key);
    return (
      <div className={styles.field} data-field={props.field.key}>
        {props.help ? <div id={id.help}><Help props={props} /></div> : null}
        <label className={styles.option} htmlFor={id.control}>
          <input
            id={id.control}
            type="checkbox"
            name={props.field.key}
            defaultChecked={one(props.values, props.field.key) === "on"}
            required={props.required}
            aria-required={props.required || undefined}
            aria-invalid={props.error ? true : undefined}
            aria-describedby={describedBy(props) || undefined}
          />
          <span>
            {props.label}
            {props.required ? <span aria-hidden="true" className={styles.star}> *</span> : null}
          </span>
        </label>
        <ErrorSlot props={props} />
      </div>
    );
  },
};
```

`fields/consent.tsx`:

```tsx
import { consentTextVersion } from "@/shared/domain/form-model";
import { resolveText, type LocalizedText } from "@/shared/domain/localized-text";
import { t } from "../copy";
import { styles } from "../styles";
import { GroupShell } from "./FieldShell";
import { ids, one, type FieldRenderer } from "./types";

const textOf = (settings: unknown) => (settings as { text: LocalizedText }).text;

/** Consent text is plain text (form-definition.md names four rich-text places, consent is not one). */
function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n{2,}/).map((p, i) => (
        <span key={i} className={styles.consentParagraph}>
          {p}
        </span>
      ))}
    </>
  );
}

export const consentField: FieldRenderer = {
  decode: (input, field) =>
    input.get(field.key) === "accepted"
      ? { value: { accepted: true, textVersion: consentTextVersion(textOf(field.settings)) }, issue: null }
      : { value: undefined, issue: null },
  encode: (value, field) =>
    typeof value === "object" && value !== null && (value as { accepted?: unknown }).accepted === true ? { [field.key]: "accepted" } : {},
  Component: (props) => {
    const id = ids(props.field.key);
    return (
      <div className={styles.consent}>
        <GroupShell props={props} legend={<Paragraphs text={resolveText(textOf(props.field.settings), props.locale, props.languages)} />}>
          <label className={styles.option} htmlFor={id.control}>
            <input
              id={id.control}
              type="checkbox"
              name={props.field.key}
              value="accepted"
              defaultChecked={one(props.values, props.field.key) === "accepted"}
              required
              aria-required
              aria-invalid={props.error ? true : undefined}
            />
            <span>{t(props.locale, "consent_checkbox")}</span>
          </label>
        </GroupShell>
      </div>
    );
  },
};
```

A refused post re-renders the box checked only if the submitter had checked it; it is never pre-checked on first render.

`fields/section.tsx`:

```tsx
import { resolveText, type LocalizedText } from "@/shared/domain/localized-text";
import { RichText } from "@/shared/presentation/RichText";
import { styles } from "../styles";
import type { FieldRenderer } from "./types";

export const sectionField: FieldRenderer = {
  decode: () => ({ value: undefined, issue: null }),
  encode: () => ({}),
  Component: (props) => {
    const s = props.field.settings as { title: LocalizedText; description?: LocalizedText };
    const description = s.description ? resolveText(s.description, props.locale, props.languages) : "";
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{resolveText(s.title, props.locale, props.languages)}</h2>
        {description ? <RichText source={description} className={styles.help} /> : null}
      </section>
    );
  },
};
```

`fields/file-upload.tsx`:

```tsx
import type { UploadLimits } from "@/shared/domain/form-model";
import { catalog, t } from "../copy";
import { acceptAttribute, formatMegabytes, limitsKey } from "../format";
import { filesCount } from "../messages";
import { UploadField } from "../client/UploadField";
import { styles } from "../styles";
import { Help } from "./FieldShell";
import { ids, type FieldRenderer } from "./types";

/**
 * The native file input, enhanced by the UploadField client component. Its
 * server-rendered markup works without script: files go with the page post
 * and each staged file has a Remove button. renderer.md, "File upload".
 */
export const fileUploadField: FieldRenderer = {
  decode: () => ({ value: undefined, issue: null }),
  encode: () => ({}),
  Component: (props) => {
    const id = ids(props.field.key);
    const limits = props.field.settings as UploadLimits;
    const noticeId = `${props.field.key}-notice`;
    const limitsId = `${props.field.key}-limits`;
    const countId = `${props.field.key}-count`;
    const describedBy = [limits.kinds.includes("video") ? noticeId : null, props.help ? id.help : null, limitsId, countId, props.error ? id.error : null]
      .filter(Boolean)
      .join(" ");
    return (
      <div className={styles.field} data-field={props.field.key}>
        {limits.kinds.includes("video") ? (
          <p id={noticeId} className={styles.notice}>
            {t(props.locale, "video_notice")}
          </p>
        ) : null}
        <label htmlFor={id.control} className={styles.label}>
          {props.label}
          {props.required ? <span aria-hidden="true" className={styles.star}> *</span> : null}
        </label>
        {props.help ? <div id={id.help}><Help props={props} /></div> : null}
        <p id={limitsId} className={styles.hint}>
          {t(props.locale, limitsKey(limits.kinds), { size: formatMegabytes(limits.maxSizeMb, props.locale) })}
        </p>
        <UploadField
          slug={props.slug}
          fieldKey={props.field.key}
          inputId={id.control}
          errorId={id.error}
          countId={countId}
          describedBy={describedBy}
          accept={acceptAttribute(limits.kinds)}
          required={props.required}
          maxFiles={limits.maxFiles}
          error={props.error}
          initial={[...props.files]}
          initialCount={filesCount(props.files.length, limits.maxFiles, props.locale)}
          text={{
            chooseFiles: t(props.locale, "choose_files"),
            uploading: t(props.locale, "uploading"),
            uploaded: t(props.locale, "uploaded"),
            remove: t(props.locale, "remove"),
            retry: t(props.locale, "retry"),
            removed: t(props.locale, "removed"),
            count: t(props.locale, "files_count"),
            countOne: t(props.locale, "files_count_one"),
            // Used when the network fails before any answer; "{file}" is filled by the client.
            failed: catalog["upload failed"][props.locale],
          }}
          locale={props.locale}
        />
      </div>
    );
  },
};
```

`fields/index.ts`:

```ts
import type { FieldTypeId } from "@/shared/domain/form-model";
import { checkboxField } from "./checkbox";
import { multipleChoice, singleChoice } from "./choice";
import { consentField } from "./consent";
import { dateField } from "./date";
import { fileUploadField } from "./file-upload";
import { numberField } from "./number";
import { sectionField } from "./section";
import { email, longText, phone, shortText } from "./text";
import type { FieldRenderer } from "./types";

/**
 * The renderer side of every field type. A type missing here fails both the
 * type check (`satisfies`) and the renderer conformance test.
 */
export const fieldRenderers = {
  short_text: shortText,
  long_text: longText,
  email,
  phone,
  number: numberField,
  date: dateField,
  single_choice: singleChoice,
  multiple_choice: multipleChoice,
  checkbox: checkboxField,
  consent: consentField,
  file_upload: fileUploadField,
  section: sectionField,
} as const satisfies Record<FieldTypeId, FieldRenderer>;

export type { FieldProps, FieldRenderer, FileRowView, FormValues } from "./types";
export { ids } from "./types";
```

`decode.ts`:

```ts
import type { Field, FieldTypeRegistry, ValidationIssue, Version } from "@/shared/domain/form-model";
import type { IncomingFile, PageAction, RawValues } from "../application";
import { HONEYPOT_FIELD } from "../application";
import { fieldRenderers } from "./fields";
import type { Decoded, FieldInput } from "./fields/types";

export interface DecodedPost {
  pageKey: string;
  action: PageAction;
  answers: Record<string, unknown>;
  decodeIssues: ValidationIssue[];
  raw: RawValues;
  incoming: IncomingFile[];
  renderedAt: Date | null;
  honeypot: string;
  submitToken: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseAction(value: string | null): PageAction | null {
  if (value === "next" || value === "back" || value === "submit") return { kind: value };
  if (value === "language:en" || value === "language:es") return { kind: "language", locale: value.slice(9) as "en" | "es" };
  if (value?.startsWith("remove:") && UUID.test(value.slice(7))) return { kind: "remove", fileId: value.slice(7) };
  return null;
}

const str = (v: FormDataEntryValue | null): string | null => (typeof v === "string" ? v : null);

export function formInput(form: FormData): FieldInput {
  return {
    get: (name) => str(form.get(name)),
    getAll: (name) => form.getAll(name).filter((v): v is string => typeof v === "string"),
  };
}

export function decodeField(form: FormData, field: Field): Decoded {
  return fieldRenderers[field.type].decode(formInput(form), field);
}

/** Parses a page post: the page's fields only, through each type's decoder. */
export async function decodePagePost(form: FormData, version: Version, registry: FieldTypeRegistry): Promise<DecodedPost | null> {
  const pageKey = str(form.get("_page"));
  const action = parseAction(str(form.get("_action")));
  const page = version.pages.find((p) => p.key === pageKey);
  if (!page || !action) return null;
  const answers: Record<string, unknown> = {};
  const decodeIssues: ValidationIssue[] = [];
  const raw: RawValues = {};
  const incoming: IncomingFile[] = [];
  const keys = new Set(page.fields.map((f) => f.key));
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
        if (typeof entry === "string") continue;
        incoming.push({ fieldKey: field.key, name: entry.name, bytes: new Uint8Array(await entry.arrayBuffer()) });
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
    pageKey: page.key,
    action,
    answers,
    decodeIssues,
    raw,
    incoming,
    renderedAt: renderedAt && !Number.isNaN(renderedAt.getTime()) ? renderedAt : null,
    honeypot: str(form.get(HONEYPOT_FIELD)) ?? "",
    submitToken: token && UUID.test(token) ? token : null,
  };
}
```

(A checkbox's decoder reads absent as `false`; a page post that never rendered that checkbox cannot reach this code, since only the page's own fields are decoded.)

- [ ] **Step 4: Run** `pnpm test src/modules/submissions/presentation && pnpm lint && pnpm typecheck && pnpm format:check`. The conformance test must fail if any entry is removed from `fieldRenderers`: delete `section` locally, see both `typecheck` and the test fail, restore it.
- [ ] **Step 5: Commit** `feat(submissions): a renderer for every field type, form decoding and the renderer conformance suite`

---

### Task 25: Renderer screens, layout styles and the page weight check

**Files:**
- Create: `src/modules/submissions/presentation/PublicShell.tsx`, `FormPage.tsx`, `ErrorSummary.tsx`, `Progress.tsx`, `Screens.tsx`, `error-page.ts`, `field-views.ts`, `screens.test.ts`, `page-weight.test.ts`
- Modify: `src/modules/submissions/presentation/renderer.module.css` (the whole stylesheet), `src/modules/submissions/application/index.ts` (export `withFileAnswers`)

**Interfaces:**
- Consumes: `ViewResult`, `PageView` (Task 18); `fieldRenderers` (Task 24); Task 23 copy and messages; `HONEYPOT_FIELD`.
- Produces:

```ts
// field-views.ts (framework-free)
export function pageFieldViews(view: { version: FormVersion; page: PageView; slug: string }, registry: FieldTypeRegistry):
  { field: Field; props: FieldProps }[];          // visible fields of the current page, with labels, help, values, errors, files
export function summaryItems(view: { version: FormVersion; page: PageView }, registry: FieldTypeRegistry): { href: string; message: string }[];
export function pageTitle(view: Extract<ViewResult, { screen: "page" }>): { h1: string; documentTitle: string; subtitle: string | null };
// Screens.tsx
export function RendererScreen(props: { view: Exclude<ViewResult, { screen: "not_found" }>; slug: string; contact: string; registry: FieldTypeRegistry }): ReactElement;
export function NotFoundScreen(): ReactElement;
export function viewLocale(view: ViewResult): Locale;   // page and confirmation locale; "es" otherwise
// error-page.ts
export function errorPageHtml(input: { slug: string | null; retentionMonths: number | null; contact: string }): string;
```

Layout per renderer.md "Layout" and design.md: one column, 640 px maximum, 16 px gutters to 480 px and 24 px above, 44 px targets, inputs full width, navigation buttons full width on phones and side by side from 480 px, body 17 px, inputs at least 16 px, focus ring 2 px rose with 2 px offset, no motion under `prefers-reduced-motion`. Every value comes from `design-system/tokens.json` and names its token.

Page structure, top to bottom: the default submit button (hidden, first in tree order, so Enter in a single-line field means Next, or Submit on the last page); the skip link "Skip to form"; the header with the wordmark text (`wordmark`), the language switch on bilingual forms (one button naming the other language in that language, posting the page form with `_action=language:<lang>`), and the progress text and bar on multi-page forms; `<main>` with the `<h1>`; the error summary above the first field when the page holds a refused post; the required legend once when any visible field is required; the fields; the honeypot; the navigation row (Back unless first, then Next or Submit); and the privacy footer on every screen with a form.

- [ ] **Step 1: Failing tests.** `screens.test.ts`:

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { seedPublished } from "@/modules/definitions/application/testing/fakes";
import { parseDraft } from "@/shared/domain/form-model";
import { makeSubmissionsDeps, publishStory } from "../application/testing/fakes";
import { viewForm } from "../application/view-form";
import { registry, storyVersion } from "../domain/testing/versions";
import { NotFoundScreen, RendererScreen } from "./Screens";
import { errorPageHtml } from "./error-page";

async function pageHtml(acceptLanguage = "en") {
  const deps = makeSubmissionsDeps();
  await publishStory(deps);
  const view = await viewForm(deps, { slug: "story-form", state: { kind: "none" }, acceptLanguage, expired: false });
  if (view.screen === "not_found") throw new Error("not found");
  return { html: renderToStaticMarkup(createElement(RendererScreen, { view, slug: "story-form", contact: "privacy@example.com", registry })), deps, view };
}

describe("RendererScreen", () => {
  it("renders page 1 as a real form with skip link, one h1, progress, legend, fields, honeypot and Next", async () => {
    const { html } = await pageHtml();
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('href="#content"');
    expect(html).toContain("Skip to form");
    expect(html).toMatch(/<form[^>]*id="page-form"[^>]*method="post"[^>]*action="\/f\/story-form\/answers"/);
    expect(html).toContain('enctype="multipart/form-data"');
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

  it("puts the hidden default action first, so Enter means Next", async () => {
    const { html } = await pageHtml();
    expect(html.indexOf('value="next"')).toBeLessThan(html.indexOf('value="language:es"'));
  });

  it("offers the other language, named in that language", async () => {
    const { html } = await pageHtml();
    expect(html).toMatch(/<button[^>]*form="page-form"[^>]*name="_action"[^>]*value="language:es"[^>]*lang="es"[^>]*>Español</);
  });

  it("shows the error summary with links and a count, and the messages under the fields", async () => {
    const { deps } = await pageHtml();
    const now = deps.clock.now();
    const formId = [...deps.definitions.store.forms.keys()][0] ?? "";
    const versionId = [...deps.definitions.store.versions.keys()][0] ?? "";
    await deps.inProgress.insert(await deps.uow.begin(), {
      id: "00000000-0000-4000-8000-0000000000aa", formId, versionId, locale: "en", pageKey: "page_contact",
      answers: {}, files: {}, submitToken: "00000000-0000-4000-8000-0000000000bb", startedAt: now, expiresAt: new Date(now.getTime() + 1e7), createdAt: now, updatedAt: now,
      pending: { pageKey: "page_contact", raw: { f_email: "nope" }, issues: [{ code: "required", field: "f_name" }, { code: "email_syntax", field: "f_email" }], fileIssues: [] },
    });
    const view = await viewForm(deps, { slug: "story-form", state: { kind: "record", id: "00000000-0000-4000-8000-0000000000aa" }, acceptLanguage: "en", expired: false });
    if (view.screen === "not_found") throw new Error("nf");
    const html = renderToStaticMarkup(createElement(RendererScreen, { view, slug: "story-form", contact: "privacy@example.com", registry }));
    expect(html).toContain("Please fix 2 problems before continuing");
    expect(html).toMatch(/<div[^>]*role="alert"[^>]*data-error-summary/);
    expect(html).toContain('href="#f-f_name"');
    expect(html).toContain("Name is required");
    expect(html).toContain('value="nope"');
    expect(html.indexOf("Please fix 2 problems")).toBeLessThan(html.indexOf('id="f-f_name"'));
  });

  it("renders the confirmation, the closed screen in both languages, and not found", async () => {
    const { deps } = await pageHtml();
    const done = await viewForm(deps, { slug: "story-form", state: { kind: "decoy", reference: "ST-1234" }, acceptLanguage: "es", expired: false });
    if (done.screen === "not_found") throw new Error("nf");
    const confirmation = renderToStaticMarkup(createElement(RendererScreen, { view: done, slug: "story-form", contact: "privacy@example.com", registry }));
    expect(confirmation).toContain("Gracias.");
    expect(confirmation).toContain("Tu referencia: ");
    expect(confirmation).toContain("ST-1234");
    expect(confirmation).toContain("Puedes cerrar esta página.");
    expect(confirmation).not.toContain("Llenar otro formulario");
    const formId = [...deps.definitions.store.forms.keys()][0] ?? "";
    const stored = deps.definitions.store.forms.get(formId);
    if (stored) deps.definitions.store.forms.set(formId, { ...stored, status: "closed" });
    const closed = await viewForm(deps, { slug: "story-form", state: { kind: "none" }, acceptLanguage: "es", expired: false });
    if (closed.screen === "not_found") throw new Error("nf");
    const closedHtml = renderToStaticMarkup(createElement(RendererScreen, { view: closed, slug: "story-form", contact: "privacy@example.com", registry }));
    expect(closedHtml).toContain("Este formulario está cerrado");
    expect(closedHtml).toMatch(/<span lang="en"[^>]*>This form is closed/);
    expect(closedHtml).not.toContain("<form");
    const notFound = renderToStaticMarkup(createElement(NotFoundScreen));
    expect(notFound).toContain("No encontramos este formulario");
    expect(notFound).not.toContain("Effluz. Answers are stored");
  });

  it("writes a static error page with a Try again link", () => {
    const html = errorPageHtml({ slug: "story-form", retentionMonths: 12, contact: "privacy@example.com" });
    expect(html).toContain("Algo salió mal");
    expect(html).toContain('href="/f/story-form"');
    expect(html).toContain("deleted after 12 months");
  });

  it("shows a multiple choice field's selection limits in its help", async () => {
    const deps = makeSubmissionsDeps();
    const parsed = parseDraft(
      {
        languages: "en", title: { en: "Probe" }, confirmation: { screen: { en: "Thanks" } },
        pages: [{ key: "page_one", fields: [{
          key: "f_pick", type: "multiple_choice", label: { en: "Probe" }, validation: [{ rule: "min_selected", value: 2 }],
          settings: { options: [{ key: "opt_a", label: { en: "A" } }, { key: "opt_b", label: { en: "B" } }, { key: "opt_c", label: { en: "C" } }] },
        }] }],
      },
      registry,
    );
    if (!parsed.ok) throw new Error("fixture");
    await seedPublished(deps.definitions, { slug: "probe-form", document: parsed.version });
    const view = await viewForm(deps, { slug: "probe-form", state: { kind: "none" }, acceptLanguage: "en", expired: false });
    if (view.screen === "not_found") throw new Error("nf");
    const html = renderToStaticMarkup(createElement(RendererScreen, { view, slug: "probe-form", contact: "privacy@example.com", registry }));
    expect(html).toContain("Select at least 2 options for Probe");
  });

  it("gives the opening date in each language's own format", async () => {
    const deps = makeSubmissionsDeps();
    await seedPublished(deps.definitions, { slug: "later-form", document: storyVersion(), settings: { opensAt: "2026-12-01T17:00:00.000Z", timezone: "America/Panama" } });
    const view = await viewForm(deps, { slug: "later-form", state: { kind: "none" }, acceptLanguage: "en", expired: false });
    if (view.screen === "not_found") throw new Error("nf");
    const html = renderToStaticMarkup(createElement(RendererScreen, { view, slug: "later-form", contact: "privacy@example.com", registry }));
    expect(html).toContain("Abre el 1 de diciembre de 2026");
    expect(html).toContain("It opens on December 1, 2026");
  });
});
```

`page-weight.test.ts`:

```ts
import { gzipSync } from "node:zlib";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { seedPublished } from "@/modules/definitions/application/testing/fakes";
import { buildDefaultRegistry, parseDraft } from "@/shared/domain/form-model";
import { referenceFormDraft } from "../../../../tests/fixtures/reference-form";
import { makeSubmissionsDeps } from "../application/testing/fakes";
import { viewForm } from "../application/view-form";
import { newInProgress } from "../domain/in-progress";
import { RendererScreen } from "./Screens";

describe("page weight", () => {
  it("keeps every page of the reference form well under 30 KB compressed", async () => {
    const deps = makeSubmissionsDeps();
    const parsed = parseDraft(referenceFormDraft, buildDefaultRegistry());
    if (!parsed.ok) throw new Error("fixture");
    const { formId, versionId } = await seedPublished(deps.definitions, { slug: "historia-prematuro-2026", document: parsed.version });
    for (const page of parsed.version.pages) {
      const now = deps.clock.now();
      const id = `00000000-0000-4000-8000-${String(parsed.version.pages.indexOf(page)).padStart(12, "0")}`;
      await deps.inProgress.insert(await deps.uow.begin(), { ...newInProgress({ id, formId, versionId, locale: "es", pageKey: page.key, submitToken: id, startedAt: now, now }) });
      const view = await viewForm(deps, { slug: "historia-prematuro-2026", state: { kind: "record", id }, acceptLanguage: "es", expired: false });
      if (view.screen === "not_found") throw new Error("nf");
      const html = renderToStaticMarkup(createElement(RendererScreen, { view, slug: "historia-prematuro-2026", contact: "privacy@example.com", registry: deps.registry }));
      // Our markup alone; the e2e budget test measures the full response, framework payload included.
      expect(gzipSync(html).length, page.key).toBeLessThan(15 * 1024);
    }
  });
});
```

- [ ] **Step 2: Run** `pnpm test src/modules/submissions/presentation`: fails.

- [ ] **Step 3: Implement.** `field-views.ts`:

```ts
import { evaluateVisibility, type Field, type FieldTypeRegistry } from "@/shared/domain/form-model";
import { resolveText } from "@/shared/domain/localized-text";
import type { FormVersion } from "@/modules/definitions/application";
import { withFileAnswers, type PageView, type ViewResult } from "../application";
import { t } from "./copy";
import { formatBytes } from "./format";
import { fieldRenderers, type FieldProps, type FormValues } from "./fields";
import { fileIssueMessage, issueMessage } from "./messages";

type PageScreen = { version: FormVersion; page: PageView; slug: string };

/** The visible fields of the current page with everything their component shows. */
export function pageFieldViews(view: PageScreen, registry: FieldTypeRegistry): { field: Field; props: FieldProps }[] {
  const doc = view.version.document;
  const { locale } = view.page;
  const page = doc.pages.find((p) => p.key === view.page.pageKey);
  if (!page) return [];
  const answers = withFileAnswers(view.page.answers, view.page.files);
  const visible = evaluateVisibility(doc, answers, registry).fields;
  const pending = view.page.pending;
  return page.fields
    .filter((field) => visible.get(field.key) === true)
    .map((field) => {
      const def = registry.get(field.type);
      const label = resolveText(field.label, locale, doc.languages);
      const issue = pending?.issues.find((i) => i.field === field.key);
      const fileIssue = pending?.fileIssues.find((i) => i.fieldKey === field.key);
      const limits = def.uploadLimits?.(field.settings);
      // A refused file names the file, which says more than "required" on the same field.
      const error =
        fileIssue && limits
          ? fileIssueMessage(fileIssue, limits, locale)
          : issue
            ? issueMessage(issue, label, locale)
            : null;
      const values: FormValues = pending ? pick(pending.raw, field.key) : fieldRenderers[field.type].encode(view.page.answers[field.key], field);
      const files = (view.page.files[field.key] ?? []).map((f, i) => {
        const size = formatBytes(f.size, locale);
        return { id: f.id, kind: f.kind, size, label: t(locale, "file_row", { n: String(i + 1), size }) };
      });
      // Selection limits show in help automatically; renderer.md, "Field rendering".
      const limitsHelp = field.validation.flatMap((rule) =>
        rule.rule === "min_selected" || rule.rule === "max_selected"
          ? [issueMessage({ code: rule.rule === "min_selected" ? "choice_min" : "choice_max", field: field.key, params: { n: rule.value } }, label, locale)]
          : [],
      );
      const staffHelp = field.help ? resolveText(field.help, locale, doc.languages) : "";
      const help = [staffHelp, ...limitsHelp].filter((h) => h !== "").join("\n\n");
      return {
        field,
        props: {
          field, locale, languages: doc.languages, slug: view.slug, label,
          help: help === "" ? null : help,
          required: def.isInput && (field.required || def.alwaysRequired === true),
          values, error, files,
        },
      };
    });
}

function pick(raw: Readonly<Record<string, string | string[]>>, key: string): FormValues {
  return Object.fromEntries(Object.entries(raw).filter(([name]) => name === key || name.startsWith(`${key}.`)));
}

/** Error summary entries, in field order, each linking to its field's first control. */
export function summaryItems(view: PageScreen, registry: FieldTypeRegistry): { href: string; message: string }[] {
  return pageFieldViews(view, registry)
    .filter(({ props }) => props.error !== null)
    .map(({ field, props }) => ({
      href: field.type === "date" ? `#f-${field.key}-${props.locale === "en" ? "month" : "day"}` : `#f-${field.key}`,
      message: props.error ?? "",
    }));
}

export function pageTitle(view: Extract<ViewResult, { screen: "page" }>): { h1: string; documentTitle: string; subtitle: string | null } {
  const doc = view.version.document;
  const { locale } = view.page;
  const formTitle = resolveText(doc.title, locale, doc.languages);
  const page = doc.pages.find((p) => p.key === view.page.pageKey);
  const pageTitleText = page ? resolveText(page.title, locale, doc.languages) : "";
  if (view.page.isFirst) {
    return { h1: formTitle, documentTitle: formTitle, subtitle: pageTitleText && pageTitleText !== formTitle ? pageTitleText : null };
  }
  const h1 = pageTitleText || formTitle;
  return { h1, documentTitle: pageTitleText ? `${formTitle}: ${pageTitleText}` : formTitle, subtitle: null };
}
```

`withFileAnswers` must be exported from the submissions application entry: add `export { withFileAnswers } from "../domain/in-progress";` to `index.ts` (presentation may import only its own module's application and domain, which it can reach directly; using the entry keeps one path).

`Progress.tsx`:

```tsx
import type { Locale } from "@/shared/domain/localized-text";
import { t } from "./copy";
import { styles } from "./styles";

export function Progress({ n, total, locale }: { n: number; total: number; locale: Locale }) {
  if (total < 2) return null;
  const text = t(locale, "progress", { n: String(n), total: String(total) });
  return (
    <div className={styles.progress}>
      <p id="progress-text" className={styles.progressText} aria-live="polite">
        {text}
      </p>
      <div role="progressbar" aria-labelledby="progress-text" aria-valuemin={1} aria-valuemax={total} aria-valuenow={n} className={styles.progressTrack}>
        <span className={styles.progressFill} style={{ width: `${String(Math.round((n / total) * 100))}%` }} />
      </div>
    </div>
  );
}
```

`ErrorSummary.tsx`:

```tsx
import type { Locale } from "@/shared/domain/localized-text";
import { errorSummaryHeading } from "./messages";
import { styles } from "./styles";

/** Above the first field after a refused post; focus moves here with script (PageEnhancer). */
export function ErrorSummary({ items, locale }: { items: { href: string; message: string }[]; locale: Locale }) {
  if (items.length === 0) return null;
  return (
    <div role="alert" className={styles.summary} data-error-summary="">
      <h2 id="error-summary-heading" tabIndex={-1} className={styles.summaryHeading}>
        {errorSummaryHeading(items.length, locale)}
      </h2>
      <ul className={styles.summaryList}>
        {items.map((item) => (
          <li key={item.href}>
            <a href={item.href}>{item.message}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

`PublicShell.tsx`:

```tsx
import type { ReactNode } from "react";
import type { Languages, Locale } from "@/shared/domain/localized-text";
import { fill } from "@/shared/presentation/copy";
import { chrome, t, type ChromeKey } from "./copy";
import { styles } from "./styles";

/**
 * Both languages, the page language first, for screens where nobody chose one.
 * `vars` fills both lines; `varsFor` gives each language its own values (dates).
 */
export function Both({ k, lang, vars = {}, varsFor }: {
  k: ChromeKey; lang: Locale; vars?: Record<string, string>; varsFor?: Record<Locale, Record<string, string>>;
}) {
  const other: Locale = lang === "es" ? "en" : "es";
  return (
    <>
      {fill(chrome[k][lang], varsFor?.[lang] ?? vars)}
      <span lang={other} className={styles.secondLanguage}>
        {fill(chrome[k][other], varsFor?.[other] ?? vars)}
      </span>
    </>
  );
}

export function PrivacyFooter({ locale, both, retention, contact }: { locale: Locale; both: boolean; retention: number; contact: string }) {
  const parts = (lang: Locale) => {
    const [before = "", after = ""] = fill(chrome.privacy_footer[lang], { retention: String(retention) }).split("{contact}");
    return (
      <>
        {before}
        <a href={`mailto:${contact}`}>{contact}</a>
        {after}
      </>
    );
  };
  const other: Locale = locale === "es" ? "en" : "es";
  return (
    <footer className={styles.footer}>
      <p>{parts(locale)}</p>
      {both ? <p lang={other}>{parts(other)}</p> : null}
    </footer>
  );
}

export function PublicShell(props: {
  locale: Locale;
  languages: Languages | null;
  defaultAction?: ReactNode;
  progress?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const other: Locale = props.locale === "es" ? "en" : "es";
  return (
    <div className={styles.page}>
      {props.defaultAction}
      <a href="#content" className={styles.skip}>
        {t(props.locale, "skip_link")}
      </a>
      <header className={styles.header}>
        <span className={styles.wordmark}>{t(props.locale, "wordmark")}</span>
        {props.languages === "bilingual" ? (
          <div role="group" aria-label={t(props.locale, "language_switch_label")} className={styles.languages}>
            <button type="submit" form="page-form" name="_action" value={`language:${other}`} lang={other} className={styles.tertiary}>
              {t(other, other === "en" ? "switch_to_en" : "switch_to_es")}
            </button>
          </div>
        ) : null}
      </header>
      {props.progress}
      <main id="content" tabIndex={-1} className={styles.main}>{props.children}</main>
      {props.footer}
    </div>
  );
}
```

(The language switch appears only on form pages; `Screens.tsx` passes `languages: null` elsewhere.)

`FormPage.tsx`:

```tsx
import type { FieldTypeRegistry } from "@/shared/domain/form-model";
import { resolveText } from "@/shared/domain/localized-text";
import { RichText } from "@/shared/presentation/RichText";
import type { ViewResult } from "../application";
import { HONEYPOT_FIELD } from "../application";
import { PageEnhancer } from "./client/PageEnhancer";
import { t } from "./copy";
import { ErrorSummary } from "./ErrorSummary";
import { fieldRenderers } from "./fields";
import { pageFieldViews, pageTitle, summaryItems } from "./field-views";
import { Progress } from "./Progress";
import { PrivacyFooter, PublicShell } from "./PublicShell";
import { styles } from "./styles";

type PageScreen = Extract<ViewResult, { screen: "page" }>;

export function FormPage({ view, slug, contact, registry }: { view: PageScreen; slug: string; contact: string; registry: FieldTypeRegistry }) {
  const { page, version, form } = view;
  const doc = version.document;
  const { locale } = page;
  const current = doc.pages.find((p) => p.key === page.pageKey);
  const fields = pageFieldViews({ version, page, slug }, registry);
  const items = summaryItems({ version, page, slug }, registry);
  const title = pageTitle(view);
  const description = current?.description ? resolveText(current.description, locale, doc.languages) : "";
  const primary = page.isLast ? "submit" : "next";
  return (
    <PublicShell
      locale={locale}
      languages={doc.languages}
      progress={<Progress n={page.position.n} total={page.position.total} locale={locale} />}
      footer={<PrivacyFooter locale={locale} both={false} retention={form.settings.retentionMonths} contact={contact} />}
      defaultAction={
        <button type="submit" form="page-form" name="_action" value={primary} tabIndex={-1} aria-hidden="true" className={styles.defaultAction}>
          {t(locale, primary)}
        </button>
      }
    >
      <h1 className={styles.title} tabIndex={-1} data-page-heading="">
        {title.h1}
      </h1>
      {title.subtitle ? <p className={styles.subtitle}>{title.subtitle}</p> : null}
      {description ? <RichText source={description} className={styles.description} /> : null}
      <form
        id="page-form"
        method="post"
        action={`/f/${encodeURIComponent(slug)}/answers`}
        encType="multipart/form-data"
        noValidate
        className={styles.form}
        data-slug={slug}
        data-page={page.pageKey}
        data-navigated={page.hasRecord && page.pending === null ? "" : undefined}
      >
        <ErrorSummary items={items} locale={locale} />
        {fields.some((f) => f.props.required) ? <p className={styles.legend}>{t(locale, "required_legend")}</p> : null}
        {fields.map(({ field, props }) => {
          const Component = fieldRenderers[field.type].Component;
          return <Component key={field.key} {...props} />;
        })}
        <input type="hidden" name="_page" value={page.pageKey} />
        {page.hasRecord ? null : <input type="hidden" name="_rendered" value={page.renderedAt.toISOString()} />}
        {page.isLast && page.submitToken ? <input type="hidden" name="_token" value={page.submitToken} /> : null}
        <div className={styles.honeypot} aria-hidden="true">
          <label htmlFor="website-url">{t(locale, "honeypot_label")}</label>
          <input id="website-url" name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>
        <div className={styles.navigation}>
          {page.isFirst ? null : (
            <button type="submit" name="_action" value="back" className={styles.secondary}>
              {t(locale, "back")}
            </button>
          )}
          <button type="submit" name="_action" value={primary} className={styles.primary} data-primary="">
            {t(locale, primary)}
          </button>
        </div>
        <p className={styles.status} role="status" data-status="" />
      </form>
      <PageEnhancer
        slug={slug}
        locale={locale}
        text={{
          submitting: t(locale, "submitting"),
          uploadsPending: t(locale, "uploads_pending"),
          offline: t(locale, "offline"),
          submitFailed: t(locale, "submit_failed"),
        }}
      />
    </PublicShell>
  );
}
```

`Screens.tsx`:

```tsx
import type { FieldTypeRegistry } from "@/shared/domain/form-model";
import { resolveText, type Locale } from "@/shared/domain/localized-text";
import { parseRichText, richTextToPlain } from "@/shared/domain/rich-text";
import { RichBlocks } from "@/shared/presentation/RichText";
import type { ViewResult } from "../application";
import { t } from "./copy";
import { formatInstant } from "./format";
import { FormPage } from "./FormPage";
import { Both, PrivacyFooter, PublicShell } from "./PublicShell";
import { styles } from "./styles";

export function viewLocale(view: ViewResult): Locale {
  if (view.screen === "page") return view.page.locale;
  if (view.screen === "confirmation") return view.locale;
  return "es";
}

/** One heading, one sentence, the privacy footer: closed, not open yet and expired. */
function Message({ title, body, retention, contact, action, varsFor }: {
  title: "closed_title" | "not_open_title" | "expired_title";
  body: "closed_body" | "not_open_body" | "expired_body";
  retention: number; contact: string; action?: { href: string }; varsFor?: Record<Locale, Record<string, string>>;
}) {
  return (
    <PublicShell locale="es" languages={null} footer={<PrivacyFooter locale="es" both retention={retention} contact={contact} />}>
      <h1 className={styles.title}><Both k={title} lang="es" /></h1>
      <p><Both k={body} lang="es" {...(varsFor ? { varsFor } : {})} /></p>
      {action ? <a href={action.href} className={styles.primaryLink}><Both k="start_again" lang="es" /></a> : null}
    </PublicShell>
  );
}

export function NotFoundScreen() {
  return (
    <PublicShell locale="es" languages={null} footer={null}>
      <h1 className={styles.title}><Both k="not_found_title" lang="es" /></h1>
      <p><Both k="not_found_body" lang="es" /></p>
    </PublicShell>
  );
}

export function RendererScreen({ view, slug, contact, registry }: {
  view: Exclude<ViewResult, { screen: "not_found" }>; slug: string; contact: string; registry: FieldTypeRegistry;
}) {
  const retention = view.form.settings.retentionMonths;
  switch (view.screen) {
    case "page":
      return <FormPage view={view} slug={slug} contact={contact} registry={registry} />;
    case "closed":
      return <Message title="closed_title" body="closed_body" retention={retention} contact={contact} />;
    case "not_open": {
      const zone = view.form.settings.timezone;
      const varsFor = { en: { date: formatInstant(view.opensAt, "en", zone) }, es: { date: formatInstant(view.opensAt, "es", zone) } };
      return <Message title="not_open_title" body="not_open_body" retention={retention} contact={contact} varsFor={varsFor} />;
    }
    case "expired":
      return <Message title="expired_title" body="expired_body" retention={retention} contact={contact} action={{ href: `/f/${encodeURIComponent(slug)}/restart` }} />;
    case "confirmation": {
      const { locale, version } = view;
      const doc = version.document;
      // The first block of the confirmation text is the heading; any further blocks follow it.
      const [head, ...rest] = parseRichText(resolveText(doc.confirmation.screen, locale, doc.languages));
      return (
        <PublicShell locale={locale} languages={null} footer={<PrivacyFooter locale={locale} both={false} retention={retention} contact={contact} />}>
          <h1 className={styles.title}>{head ? richTextToPlain([head]) : ""}</h1>
          {rest.length > 0 ? <RichBlocks blocks={rest} className={styles.description} /> : null}
          <p className={styles.reference}>
            {t(locale, "confirmation_reference", { ref: "" })}
            <code className={styles.referenceCode}>{view.reference}</code>
          </p>
          <p>{t(locale, "confirmation_close")}</p>
          {view.form.settings.allowAnotherResponse ? (
            <a href={`/f/${encodeURIComponent(slug)}/restart`} className={styles.secondaryLink}>{t(locale, "fill_another")}</a>
          ) : null}
        </PublicShell>
      );
    }
  }
}
```

`error-page.ts`:

```ts
import { escapeHtml } from "@/shared/presentation/rich-text-html";
import { chrome } from "./copy";

// Values from design-system/tokens.json: surface.page.public, color.text.default, surface.card,
// border.default, action.primary.bg/fg, focus.ring, font.family.sans, size.contentWidthPublic.
const STYLE = [
  "body{margin:0;background:#FFF3EF;color:#372549;font:17px/1.6 Poppins,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}",
  "main{box-sizing:border-box;max-width:640px;margin:48px auto;padding:24px 16px}",
  "h1{font-size:28px;line-height:1.2;margin:0 0 16px}",
  "span{display:block;color:#774C60}",
  "a.button{display:inline-flex;align-items:center;min-height:48px;padding:0 16px;border-radius:12px;background:#372549;color:#FFF3EF;text-decoration:none;font-weight:500}",
  "a:focus-visible{outline:2px solid #B75D69;outline-offset:2px}",
  "footer{font-size:15px;color:#774C60;max-width:640px;margin:0 auto;padding:0 16px 48px}",
].join("");

const both = (k: keyof typeof chrome) => `${escapeHtml(chrome[k].es)}<span lang="en">${escapeHtml(chrome[k].en)}</span>`;

/** The static failure page a route handler answers with (HTTP 500 or 413); no React tree behind it. */
export function errorPageHtml(input: { slug: string | null; retentionMonths: number | null; contact: string }): string {
  const retry = input.slug === null ? "" : `<p><a class="button" href="/f/${encodeURIComponent(input.slug)}">${both("try_again")}</a></p>`;
  const footer =
    input.retentionMonths === null
      ? ""
      : `<footer>${escapeHtml(chrome.privacy_footer.es.replace("{retention}", String(input.retentionMonths)).replace("{contact}", input.contact))}<span lang="en">${escapeHtml(chrome.privacy_footer.en.replace("{retention}", String(input.retentionMonths)).replace("{contact}", input.contact))}</span></footer>`;
  return [
    '<!doctype html><html lang="es"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeHtml(chrome.error_title.es)} / ${escapeHtml(chrome.error_title.en)}</title>`,
    `<style>${STYLE}</style></head><body><main>`,
    `<h1>${both("error_title")}</h1><p>${both("error_body")}</p>${retry}</main>${footer}</body></html>`,
  ].join("");
}
```

`renderer.module.css` (complete; every value names its token):

```css
/* Public renderer. Values from design-system/tokens.json; see specs/design.md. */
.page { min-height: 100vh; background: #fff3ef /* surface.page.public */; color: #372549 /* color.text.default */;
  font-family: Poppins, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif /* font.family.sans */;
  font-size: 17px /* font.size.public.body */; line-height: 1.6 /* font.lineHeight.body */; }
.skip { position: absolute; left: 16px /* space.4 */; top: -100px; padding: 12px 16px /* space.3 space.4 */;
  background: #ffffff /* surface.card */; border-radius: 12px /* radius.md */; }
.skip:focus { top: 8px /* space.2 */; }
.header, .progress, .main, .footer { box-sizing: border-box; max-width: 640px /* size.contentWidthPublic */; margin: 0 auto;
  padding-left: 16px /* space.4 */; padding-right: 16px /* space.4 */; }
.header { display: flex; justify-content: space-between; align-items: center; min-height: 64px /* space.8 */; }
.wordmark { font-weight: 600 /* font.weight.semibold */; font-size: 24px /* size.iconDefault: wordmark height */; line-height: 1; }
.languages { display: flex; }
.progress { padding-top: 8px /* space.2 */; }
.progressText { margin: 0 0 8px /* space.2 */; color: #774c60 /* color.text.muted */; font-size: 15px /* font.size.public.small */; }
.progressTrack { height: 4px; background: #eff0f5 /* surface.subtle */; border-radius: 999px /* radius.full */; overflow: hidden; }
.progressFill { display: block; height: 100%; background: #372549 /* action.primary.bg */; border-radius: 999px /* radius.full */;
  transition: width 160ms cubic-bezier(0.2, 0, 0, 1) /* motion: progress */; }
.main { padding-top: 24px /* space.5 */; padding-bottom: 48px /* space.7 */; }
.title { font-size: 28px /* font.size.public.display */; line-height: 1.2 /* font.lineHeight.tight */; font-weight: 600; margin: 0 0 16px /* space.4 */; }
.title:focus { outline: none; }
.subtitle, .sectionTitle { font-size: 22px /* font.size.public.heading */; line-height: 1.3 /* font.lineHeight.heading */; font-weight: 600; margin: 0 0 16px; }
.description, .help { margin: 0 0 16px; }
.help { font-size: 15px /* font.size.public.small */; line-height: 1.5 /* font.lineHeight.small */; color: #774c60 /* color.text.muted */; }
.form { display: flex; flex-direction: column; gap: 24px /* space.5: between fields */; }
.legend, .hint, .counter { margin: 0; font-size: 15px /* font.size.public.small */; color: #774c60 /* color.text.muted */; }
.field, .group { display: flex; flex-direction: column; gap: 8px /* space.2 */; border: 0; padding: 0; margin: 0; min-width: 0; }
.label { font-size: 16px /* font.size.public.label */; font-weight: 500 /* font.weight.medium */; line-height: 1.4 /* font.lineHeight.label */; padding: 0; }
.star { color: #9b1c1c /* color.text.error: reinforcement only; the legend says it in words */; }
.input, .textarea, .select { box-sizing: border-box; width: 100%; min-height: 48px /* input height, public */; padding: 12px /* space.3 */;
  font: inherit; font-size: 17px /* at least font.size.public.inputMin */; color: inherit; background: #ffffff /* surface.card */;
  border: 1px solid #774c60 /* border.input */; border-radius: 12px /* radius.md */; }
.textarea { resize: vertical; }
.input:focus, .textarea:focus, .select:focus { border: 2px solid #372549 /* border.inputFocus */; padding: 11px; }
.input:focus-visible, .textarea:focus-visible, .select:focus-visible, .primary:focus-visible, .secondary:focus-visible,
.tertiary:focus-visible, .primaryLink:focus-visible, .secondaryLink:focus-visible, .option input:focus-visible, a:focus-visible {
  outline: 2px solid #b75d69 /* color.focus.ring */; outline-offset: 2px; }
.input[aria-invalid="true"], .textarea[aria-invalid="true"], .select[aria-invalid="true"] { border-color: #9b1c1c /* border.error */; }
.error { margin: 0; min-height: 0; color: #9b1c1c /* color.text.error */; font-size: 15px; display: flex; gap: 8px; align-items: flex-start; }
.error:empty { display: none; }
.errorIcon { flex: none; margin-top: 4px; }
.withUnit { display: flex; gap: 8px /* space.2 */; align-items: center; }
.unit { color: #774c60 /* color.text.muted */; }
.dateRow { display: flex; gap: 12px /* space.3 */; }
.datePart { width: 5.5rem; display: flex; flex-direction: column; gap: 4px /* space.1 */; }
.dateYear { width: 7rem; display: flex; flex-direction: column; gap: 4px; }
.subLabel { font-size: 15px /* font.size.public.small */; }
.options { display: flex; flex-direction: column; gap: 8px /* space.2 */; }
.option { display: flex; align-items: center; gap: 12px /* space.3 */; min-height: 44px /* size.touchTarget */; padding: 8px 12px;
  background: #ffffff /* surface.card */; border: 1px solid #eff0f5 /* border.default */; border-radius: 12px /* radius.md */; cursor: pointer; }
.option input { width: 24px; height: 24px; flex: none; accent-color: #372549 /* action.primary.bg */; }
.consent .group { padding: 16px /* space.4 */; background: #ffffff /* surface.card */; border: 1px solid #774c60 /* border.input */; border-radius: 12px; }
.consentParagraph { display: block; font-weight: 400; margin-bottom: 8px; }
.section { padding: 16px /* space.4 */; background: #ffffff; border: 1px solid #eff0f5 /* border.default */; border-radius: 12px; }
.notice { margin: 0; padding: 16px; background: #fff4d6 /* surface.warning */; color: #7a4b00 /* color.text.warning */; border-radius: 12px; }
.dropzone { display: flex; flex-direction: column; gap: 12px; padding: 24px /* space.5 */; border: 2px dashed #774c60 /* border.input */; border-radius: 12px; }
.dropzone[data-drag] { border-color: #372549 /* border.inputFocus */; }
.fileRows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.fileRow { display: grid; grid-template-columns: 56px 1fr auto; gap: 12px; align-items: center; }
.thumb { width: 56px; height: 56px; border-radius: 8px /* radius.sm */; object-fit: cover; background: #eff0f5 /* surface.subtle */; }
.fileName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fileBar { height: 4px; background: #eff0f5; border-radius: 999px; overflow: hidden; }
.fileBar > span { display: block; height: 100%; background: #372549; }
.summary { padding: 16px; background: #fbecec /* surface.error */; color: #9b1c1c /* color.text.error */; border-radius: 12px; }
.summaryHeading { font-size: 22px; margin: 0 0 8px; }
.summaryHeading:focus { outline: 2px solid #b75d69 /* color.focus.ring */; outline-offset: 2px; }
.summaryList { margin: 0; padding-left: 24px; }
.summaryList a { color: #9b1c1c; }
.navigation { display: flex; flex-direction: column; gap: 12px /* space.3 */; }
@media (min-width: 480px) /* breakpoint.sm */ { .navigation { flex-direction: row; justify-content: space-between; }
  .header, .progress, .main, .footer { padding-left: 24px /* space.5 */; padding-right: 24px; } }
.primary, .secondary, .primaryLink, .secondaryLink { display: inline-flex; justify-content: center; align-items: center; gap: 8px;
  min-height: 48px /* button height, public */; padding: 0 16px /* space.4 */; border-radius: 12px; font: inherit; font-size: 16px /* font.size.public.button */;
  font-weight: 500; line-height: 1; cursor: pointer; text-decoration: none; }
.primary, .primaryLink { background: #372549 /* action.primary.bg */; color: #fff3ef /* action.primary.fg */; border: 0; }
.primary:hover, .primaryLink:hover { background: #6c344e /* action.primary.hoverBg */; }
.secondary, .secondaryLink { background: #ffffff /* action.secondary.bg */; color: #372549; border: 1px solid #372549 /* action.secondary.border */; }
.secondary:hover, .secondaryLink:hover { background: #eff0f5 /* action.secondary.hoverBg */; }
.primary:disabled, .secondary:disabled { background: #eff0f5 /* action.disabledBg */; color: #774c60 /* action.disabledFg */; cursor: not-allowed; }
.tertiary { min-height: 44px /* size.touchTarget */; padding: 0 12px; background: none; border: 0; color: #372549; font: inherit; text-decoration: underline; cursor: pointer; }
.tertiary:hover { color: #b75d69 /* action.tertiary.hoverFg */; }
.status:empty { display: none; }
.status { margin: 0; color: #9b1c1c; }
.banner { padding: 16px; background: #eff0f5 /* surface.subtle (info) */; border-radius: 12px; margin-bottom: 16px; }
.reference { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.referenceCode { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace /* font.family.mono */; padding: 4px 8px; background: #ffffff; border: 1px solid #eff0f5; border-radius: 8px; user-select: all; }
.inlineRich p { margin: 0; }
.secondLanguage { display: block; font-weight: 400; color: #774c60 /* color.text.muted */; }
.footer { padding-top: 24px; padding-bottom: 48px; font-size: 15px; color: #774c60; }
.footer a { color: inherit; }
.honeypot { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
.defaultAction { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
.spinner { width: 16px; height: 16px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 999px; animation: spin 800ms linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .progressFill { transition: none; } .spinner { animation: none; } }
```

Run `pnpm format` once after pasting so Prettier lays the CSS out one declaration per line.

- [ ] **Step 4: Run** `pnpm test src/modules/submissions && pnpm lint && pnpm typecheck && pnpm format:check`.
- [ ] **Step 5: Commit** `feat(submissions): renderer screens, error summary, progress, privacy footer and layout styles`

---

### Task 26: The enhancement layer: early uploads, blur checks, focus, offline and submit states

**Files:**
- Create: `src/modules/submissions/presentation/client/bus.ts`, `upload-queue.ts`, `UploadField.tsx`, `PageEnhancer.tsx`, `form-dom.ts`
- Test: `client/upload-queue.test.ts`, `client/bus.test.ts`, `client/UploadField.test.ts`

**Interfaces:**
- Consumes: the upload, remove and check routes' JSON (Task 28): `POST /f/<slug>/files` answers `{ ok: true, file: { id, kind, size }, label, count }` or `{ ok: false, message }`; `DELETE /f/<slug>/files/<id>` answers 204; `POST /f/<slug>/check` answers `{ message: string | null }`.
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
// UploadField.tsx ('use client')
export interface UploadFieldProps {
  slug: string; fieldKey: string; inputId: string; errorId: string; countId: string; describedBy: string; accept: string;
  required: boolean; maxFiles: number; error: string | null; initial: FileRowView[]; initialCount: string;
  text: { chooseFiles: string; uploading: string; uploaded: string; remove: string; retry: string; removed: string; count: string; countOne: string; failed: string };
  locale: Locale;
}
export function UploadField(props: UploadFieldProps): ReactElement;
// PageEnhancer.tsx ('use client')
export function PageEnhancer(props: { slug: string; locale: Locale; text: { submitting: string; uploadsPending: string; offline: string; submitFailed: string } }): ReactElement | null;
// form-dom.ts (browser helpers, no React)
export function fieldFormData(form: HTMLFormElement, key: string): FormData;   // the inputs named key or key.* plus _field
```

The client never ships the validation rules or the copy tables: messages come back from the server already localized, and chrome strings arrive as props. Without script the server markup of `UploadField` (the same component, rendered on the server) works on its own: the native multiple file input posts with the page and each staged file has a Remove submit button.

- [ ] **Step 1: Failing tests.** `upload-queue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { middleEllipsis, queueReducer, type Row } from "./upload-queue";

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

  it("truncates long names in the middle", () => {
    expect(middleEllipsis("IMG_20261010_123456789_HDR_final.jpeg", 20)).toBe("IMG_20261…final.jpeg");
    expect(middleEllipsis("short.jpg", 20)).toBe("short.jpg");
  });
});
```

`bus.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { inFlight, onUploadsChange, uploadFinished, uploadStarted } from "./bus";

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

`UploadField.test.ts` (the server rendering, which is the no-script page):

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UploadField } from "./UploadField";

describe("UploadField without script", () => {
  it("renders the native input, the count and a Remove submit button per staged file", () => {
    const html = renderToStaticMarkup(
      createElement(UploadField, {
        slug: "story-form", fieldKey: "f_photos", inputId: "f-f_photos", errorId: "f_photos-error", countId: "f_photos-count",
        describedBy: "f_photos-limits f_photos-count", accept: "image/jpeg", required: true, maxFiles: 3, error: null,
        initial: [{ id: "00000000-0000-4000-8000-000000000001", kind: "image", label: "File 1, 12 kB", size: "12 kB" }],
        initialCount: "1 of 3 files",
        text: { chooseFiles: "Choose files", uploading: "Uploading {percent}%", uploaded: "Uploaded", remove: "Remove", retry: "Retry", removed: "{file} removed", count: "{count} of {max} files", countOne: "{count} of 1 file", failed: "" },
        locale: "en",
      }),
    );
    expect(html).toMatch(/<input[^>]*type="file"[^>]*multiple[^>]*name="f_photos"|<input[^>]*name="f_photos"[^>]*type="file"/);
    expect(html).toContain('aria-describedby="f_photos-limits f_photos-count"');
    expect(html).toContain("1 of 3 files");
    expect(html).toContain("File 1, 12 kB");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*name="_action"[^>]*value="remove:00000000-0000-4000-8000-000000000001"/);
    expect(html).toContain('id="f_photos-error"');
  });
});
```

- [ ] **Step 2: Run** `pnpm test src/modules/submissions/presentation/client`: fails.

- [ ] **Step 3: Implement.** `bus.ts`:

```ts
/** Uploads in flight on this page, so Next and Submit can wait for them (renderer.md, "File upload"). */
let count = 0;
const listeners = new Set<(n: number) => void>();
const emit = () => {
  for (const l of listeners) l(count);
};
export function uploadStarted(): void {
  count += 1;
  emit();
}
export function uploadFinished(): void {
  count = Math.max(0, count - 1);
  emit();
}
export function inFlight(): number {
  return count;
}
export function onUploadsChange(listener: (n: number) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
```

`upload-queue.ts`:

```ts
export type RowState = { status: "uploading"; percent: number } | { status: "uploaded" } | { status: "failed"; message: string };
export interface Row {
  localId: string;
  id: string | null;
  name: string;
  size: string;
  kind: "image" | "video";
  thumb: string | null;
  state: RowState;
}
export type QueueAction =
  | { type: "add"; rows: Row[] }
  | { type: "progress"; localId: string; percent: number }
  | { type: "done"; localId: string; id: string; label: string }
  | { type: "fail"; localId: string; message: string }
  | { type: "retry"; localId: string }
  | { type: "remove"; localId: string };

export function queueReducer(rows: readonly Row[], action: QueueAction): Row[] {
  const patch = (localId: string, change: (r: Row) => Row) => rows.map((r) => (r.localId === localId ? change(r) : r));
  switch (action.type) {
    case "add":
      return [...rows, ...action.rows];
    case "progress":
      return patch(action.localId, (r) => ({ ...r, state: { status: "uploading", percent: action.percent } }));
    case "done":
      return patch(action.localId, (r) => ({ ...r, id: action.id, state: { status: "uploaded" } }));
    case "fail":
      return patch(action.localId, (r) => ({ ...r, state: { status: "failed", message: action.message } }));
    case "retry":
      return patch(action.localId, (r) => ({ ...r, state: { status: "uploading", percent: 0 } }));
    case "remove":
      return rows.filter((r) => r.localId !== action.localId);
  }
}

export function middleEllipsis(name: string, max = 32): string {
  if (name.length <= max) return name;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return `${name.slice(0, head)}…${name.slice(name.length - (keep - head))}`;
}
```

`form-dom.ts`:

```ts
/** The FormData of one field's inputs, plus `_field`, for the blur check. */
export function fieldFormData(form: HTMLFormElement, key: string): FormData {
  const all = new FormData(form);
  const out = new FormData();
  out.set("_field", key);
  for (const [name, value] of all.entries()) {
    if (typeof value === "string" && (name === key || name.startsWith(`${key}.`))) out.append(name, value);
  }
  return out;
}

export const fill = (text: string, vars: Record<string, string>): string =>
  text.replace(/\{(\w+)\}/g, (whole, k: string) => vars[k] ?? whole);
```

`UploadField.tsx`:

```tsx
"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { Locale } from "@/shared/domain/localized-text";
import type { FileRowView } from "../fields/types";
import { styles } from "../styles";
import { uploadFinished, uploadStarted } from "./bus";
import { fill } from "./form-dom";
import { middleEllipsis, queueReducer, type Row } from "./upload-queue";

export interface UploadFieldProps {
  slug: string;
  fieldKey: string;
  inputId: string;
  errorId: string;
  countId: string;
  describedBy: string;
  accept: string;
  required: boolean;
  maxFiles: number;
  error: string | null;
  initial: FileRowView[];
  initialCount: string;
  text: { chooseFiles: string; uploading: string; uploaded: string; remove: string; retry: string; removed: string; count: string; countOne: string; failed: string };
  locale: Locale;
}

interface UploadAnswer {
  ok: boolean;
  file?: { id: string };
  label?: string;
  message?: string;
}

/**
 * The file field. Rendered on the server it is the no-script control: the
 * native input posts with the page and staged files have Remove submit
 * buttons. With script, each chosen file uploads at once with its own
 * progress row, and the input is cleared so the page post does not resend it.
 */
export function UploadField(props: UploadFieldProps) {
  const initialRows: Row[] = props.initial.map((f) => ({ localId: f.id, id: f.id, name: f.label, size: f.size, kind: f.kind, thumb: null, state: { status: "uploaded" } }));
  const [rows, dispatch] = useReducer(queueReducer, initialRows);
  const [enhanced, setEnhanced] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const pending = useRef(new Map<string, File>());
  useEffect(() => {
    setEnhanced(true);
  }, []);

  const uploaded = rows.filter((r) => r.state.status === "uploaded").length;
  const countText = fill(props.maxFiles === 1 ? props.text.countOne : props.text.count, { count: String(uploaded), max: String(props.maxFiles) });

  function send(row: Row, file: File) {
    uploadStarted();
    const body = new FormData();
    body.set("field", props.fieldKey);
    body.set("_locale", props.locale);
    body.set("file", file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/f/${encodeURIComponent(props.slug)}/files`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) dispatch({ type: "progress", localId: row.localId, percent: Math.round((e.loaded / e.total) * 100) });
    };
    xhr.onload = () => {
      uploadFinished();
      let answer: UploadAnswer = { ok: false };
      try {
        answer = JSON.parse(xhr.responseText) as UploadAnswer;
      } catch {
        // Not JSON: a proxy error page. Treated as a failed upload.
      }
      if (answer.ok && answer.file) {
        pending.current.delete(row.localId);
        dispatch({ type: "done", localId: row.localId, id: answer.file.id, label: answer.label ?? row.name });
        setAnnouncement(props.text.uploaded);
      } else {
        dispatch({ type: "fail", localId: row.localId, message: fill(answer.message ?? props.text.failed, { file: middleEllipsis(row.name) }) });
      }
    };
    xhr.onerror = () => {
      uploadFinished();
      dispatch({ type: "fail", localId: row.localId, message: fill(props.text.failed, { file: middleEllipsis(row.name) }) });
    };
    xhr.send(body);
  }

  function choose(files: FileList | null) {
    if (!files) return;
    const added: Row[] = [...files].map((file, i) => ({
      localId: `${String(Date.now())}-${String(i)}`,
      id: null,
      name: file.name,
      size: `${(file.size / 1024 / 1024).toFixed(1)} MB`,
      kind: file.type.startsWith("video/") ? "video" : "image",
      thumb: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      state: { status: "uploading", percent: 0 },
    }));
    dispatch({ type: "add", rows: added });
    added.forEach((row, i) => {
      const file = files[i];
      if (file) {
        pending.current.set(row.localId, file);
        send(row, file);
      }
    });
  }

  async function remove(row: Row) {
    if (row.id !== null) {
      const res = await fetch(`/f/${encodeURIComponent(props.slug)}/files/${row.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) return;
    }
    pending.current.delete(row.localId);
    if (row.thumb) URL.revokeObjectURL(row.thumb);
    dispatch({ type: "remove", localId: row.localId });
    setAnnouncement(fill(props.text.removed, { file: middleEllipsis(row.name) }));
  }

  return (
    <div className={styles.dropzone}
      onDragOver={(e) => { e.preventDefault(); e.currentTarget.setAttribute("data-drag", ""); }}
      onDragLeave={(e) => { e.currentTarget.removeAttribute("data-drag"); }}
      onDrop={(e) => { e.preventDefault(); e.currentTarget.removeAttribute("data-drag"); choose(e.dataTransfer.files); }}
    >
      <input
        id={props.inputId}
        name={props.fieldKey}
        type="file"
        multiple={props.maxFiles > 1}
        accept={props.accept}
        aria-required={props.required || undefined}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={props.describedBy}
        onChange={(e) => {
          choose(e.currentTarget.files);
          e.currentTarget.value = "";
        }}
      />
      <p id={props.countId} className={styles.hint} aria-live="polite">
        {enhanced ? countText : props.initialCount}
      </p>
      <ul className={styles.fileRows}>
        {rows.map((row) => (
          <li key={row.localId} className={styles.fileRow}>
            {row.thumb ? <img src={row.thumb} alt="" className={styles.thumb} /> : <span className={styles.thumb} aria-hidden="true" />}
            <span>
              <span className={styles.fileName} id={`${row.localId}-name`}>{middleEllipsis(row.name)}</span>
              <span className={styles.hint}> {row.size} </span>
              {row.state.status === "uploading" ? (
                <>
                  <span className={styles.fileBar}><span style={{ width: `${String(row.state.percent)}%` }} /></span>
                  <span aria-live="polite">{fill(props.text.uploading, { percent: String(row.state.percent) })}</span>
                </>
              ) : row.state.status === "uploaded" ? (
                <span>{props.text.uploaded}</span>
              ) : (
                <span className={styles.error}>{row.state.message}</span>
              )}
            </span>
            <span>
              {row.state.status === "failed" ? (
                <button type="button" className={styles.tertiary} onClick={() => {
                  const file = pending.current.get(row.localId);
                  if (file) { dispatch({ type: "retry", localId: row.localId }); send(row, file); }
                }}>
                  {props.text.retry}
                </button>
              ) : null}
              {enhanced ? (
                <button type="button" className={styles.tertiary} aria-describedby={`${row.localId}-name`} onClick={() => void remove(row)}>
                  {props.text.remove}
                </button>
              ) : (
                <button type="submit" name="_action" value={`remove:${row.id ?? ""}`} className={styles.tertiary} aria-describedby={`${row.localId}-name`}>
                  {props.text.remove}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.visuallyHidden} aria-live="polite">{announcement}</p>
      <p id={props.errorId} className={styles.error} aria-live="assertive">{props.error}</p>
    </div>
  );
}
```

Add `.visuallyHidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }` to `renderer.module.css`. The upload route's JSON carries `label` (the server's `file_row` text) and, on refusal, `message`; `text.failed` is the catalog's "upload failed" row in the page language, filled with the file name here when the network fails before any answer.

`PageEnhancer.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/shared/domain/localized-text";
import { styles } from "../styles";
import { inFlight, onUploadsChange } from "./bus";
import { fieldFormData, fill } from "./form-dom";

interface Props {
  slug: string;
  locale: Locale;
  text: { submitting: string; uploadsPending: string; offline: string; submitFailed: string };
}

/**
 * Progressive enhancement of the server-rendered page form: focus after a
 * refused post or a page change, blur checks answered by the server, the
 * character counter, session-storage drafts, waiting for uploads, the
 * offline banner, and the Submitting state. Removing it never blocks
 * completion. renderer.md, "Validation and errors" and "Navigation and state".
 */
export function PageEnhancer({ slug, locale, text }: Props) {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const form = document.getElementById("page-form");
    if (!(form instanceof HTMLFormElement)) return;
    const page = form.dataset["page"] ?? "";
    const storageKey = `effluz:${slug}:${page}`;
    const status = form.querySelector<HTMLElement>("[data-status]");
    const touched = new Set<string>();

    // Focus: the error summary after a refused post, else the heading after a page change.
    const summary = document.getElementById("error-summary-heading");
    if (summary) summary.focus();
    else if (form.dataset["navigated"] !== undefined) document.querySelector<HTMLElement>("[data-page-heading]")?.focus();

    // Restore a draft of this page's unsent edits, but never over a refused post's values.
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved && !summary) {
        for (const [name, value] of Object.entries(JSON.parse(saved) as Record<string, string>)) {
          const el = form.elements.namedItem(name);
          if (el instanceof HTMLInputElement && el.type !== "file" && el.type !== "radio" && el.type !== "checkbox" && el.value === "") el.value = value;
          if (el instanceof HTMLTextAreaElement && el.value === "") el.value = value;
        }
      }
    } catch {
      // Storage blocked: drafts are a convenience only.
    }

    const keyOf = (target: EventTarget | null) =>
      target instanceof Element ? (target.closest<HTMLElement>("[data-field]")?.dataset["field"] ?? null) : null;

    async function check(key: string) {
      if (!(form instanceof HTMLFormElement)) return;
      const body = fieldFormData(form, key);
      body.set("_locale", locale);
      try {
        const res = await fetch(`/f/${encodeURIComponent(slug)}/check`, { method: "POST", body });
        if (!res.ok) return;
        const { message } = (await res.json()) as { message: string | null };
        const slot = document.getElementById(`${key}-error`);
        if (slot) slot.textContent = message ?? "";
        for (const control of form.querySelectorAll<HTMLElement>(`[name="${key}"], [name^="${key}."]`)) {
          if (message) control.setAttribute("aria-invalid", "true");
          else control.removeAttribute("aria-invalid");
        }
      } catch {
        // Offline: the server checks again on Next.
      }
    }

    const onFocusOut = (e: FocusEvent) => {
      const key = keyOf(e.target);
      if (key && touched.has(key)) void check(key);
    };
    const onInput = (e: Event) => {
      const key = keyOf(e.target);
      if (!key) return;
      touched.add(key);
      if (document.getElementById(`${key}-error`)?.textContent) void check(key);
      const t = e.target;
      if (t instanceof HTMLTextAreaElement) {
        if (t.dataset["autogrow"] !== undefined) {
          t.style.height = "auto";
          t.style.height = `${String(t.scrollHeight)}px`;
        }
        const counter = form.querySelector<HTMLElement>(`[data-counter-for="${key}"]`);
        if (counter) {
          const max = Number(counter.dataset["max"]);
          const n = [...t.value].length;
          counter.textContent = fill(counter.dataset["template"] ?? "", { n: String(n), max: String(max) });
          counter.setAttribute("aria-live", n >= 0.9 * max ? "polite" : "off");
        }
      }
      try {
        const draft: Record<string, string> = {};
        for (const [name, value] of new FormData(form).entries()) if (typeof value === "string" && !name.startsWith("_")) draft[name] = value;
        sessionStorage.setItem(storageKey, JSON.stringify(draft));
      } catch {
        // Storage full or blocked.
      }
    };

    const buttons = () => form.querySelectorAll<HTMLButtonElement>('button[name="_action"]');
    const primary = form.querySelector<HTMLButtonElement>("[data-primary]");
    const setUploadsState = (n: number) => {
      if (primary) primary.disabled = n > 0;
      if (status) status.textContent = n > 0 ? text.uploadsPending : "";
    };
    const offUploads = onUploadsChange(setUploadsState);

    const onSubmit = (e: SubmitEvent) => {
      const submitter = e.submitter instanceof HTMLButtonElement ? e.submitter : null;
      const action = submitter?.value ?? "next";
      if ((action === "next" || action === "submit") && inFlight() > 0) {
        e.preventDefault();
        if (status) status.textContent = text.uploadsPending;
        return;
      }
      if (!navigator.onLine) {
        e.preventDefault();
        setOffline(true);
        window.addEventListener("online", () => { setOffline(false); form.requestSubmit(submitter ?? undefined); }, { once: true });
        return;
      }
      if (action !== "submit") {
        try { sessionStorage.removeItem(storageKey); } catch { /* blocked */ }
        return;
      }
      // Submit: one click only, "Submitting…", and a clear message if the network fails.
      e.preventDefault();
      if (form.dataset["submitting"] !== undefined) return;
      form.dataset["submitting"] = "";
      for (const b of buttons()) b.disabled = true;
      if (submitter) {
        const spinner = document.createElement("span");
        spinner.className = styles.spinner ?? "";
        spinner.setAttribute("aria-hidden", "true");
        submitter.replaceChildren(spinner, document.createTextNode(` ${text.submitting}`));
      }
      const body = new FormData(form);
      body.set("_action", "submit");
      fetch(form.action, { method: "POST", body, redirect: "follow" })
        .then((res) => {
          try { sessionStorage.removeItem(storageKey); } catch { /* blocked */ }
          window.location.assign(res.url);
        })
        .catch(() => {
          delete form.dataset["submitting"];
          for (const b of buttons()) b.disabled = false;
          if (submitter) submitter.textContent = submitter.dataset["label"] ?? submitter.textContent;
          if (status) status.textContent = text.submitFailed;
        });
    };

    for (const b of buttons()) b.dataset["label"] = b.textContent ?? "";
    const onOffline = () => setOffline(true);
    const onOnline = () => setOffline(false);
    form.addEventListener("focusout", onFocusOut);
    form.addEventListener("input", onInput);
    form.addEventListener("change", onInput);
    form.addEventListener("submit", onSubmit);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      offUploads();
      form.removeEventListener("focusout", onFocusOut);
      form.removeEventListener("input", onInput);
      form.removeEventListener("change", onInput);
      form.removeEventListener("submit", onSubmit);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [slug, locale, text]);

  return offline ? (
    <div className={styles.banner} role="status">
      {text.offline}
    </div>
  ) : null;
}
```

No string is ever parsed as HTML on the client: the Submitting state is built with DOM calls.

- [ ] **Step 4: Run** `pnpm test src/modules/submissions/presentation && pnpm lint && pnpm typecheck && pnpm format:check && pnpm build`.
- [ ] **Step 5: Commit** `feat(submissions): client enhancements for early uploads, blur checks, focus, offline and submit states`

---

### Task 27: Configuration, the composition roots and worker registration

**Files:**
- Create: `src/app/modules.ts`, `src/app/modules.test.ts`, `src/app/worker-handlers.ts`, `src/app/worker-handlers.test.ts`
- Modify: `src/app/config.ts`, `src/app/config.test.ts`, `src/app/container.ts`, `src/app/container.test.ts`, `src/app/worker.ts`, `.env.example`, `specs/system/deployment.md` ("Local development": the new variables and their local defaults, one sentence)

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
export function workerHandlers(input: { store: PgJobStore; pool: Pool; media: MediaDeps; notifications: NotificationsDeps; submissions: SubmissionsDeps }): Record<string, JobHandler>;
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

`src/app/worker-handlers.test.ts`:

```ts
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { makeMediaDeps } from "@/modules/media/application/testing/fakes";
import { makeNotificationsDeps } from "@/modules/notifications/application/testing/fakes";
import { makeSubmissionsDeps } from "@/modules/submissions/application/testing/fakes";
import type { PgJobStore } from "@/shared/infrastructure/jobs/pg-job-store";
import { RECURRING, workerHandlers } from "./worker-handlers";

describe("workerHandlers", () => {
  it("registers every job type of this release that has a handler", () => {
    const handlers = workerHandlers({
      store: {} as PgJobStore, pool: {} as Pool, media: makeMediaDeps(), notifications: makeNotificationsDeps(), submissions: makeSubmissionsDeps(),
    });
    expect(Object.keys(handlers).sort()).toEqual([
      "email.staff_notification", "email.submitter_confirmation", "identity.cleanup", "jobs.cleanup", "media.delete", "media.upload",
    ]);
    expect(RECURRING).toEqual([{ type: "jobs.cleanup", period: "daily" }, { type: "identity.cleanup", period: "daily" }]);
  });
});
```

`src/app/modules.test.ts`:

```ts
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { PgAuditLog } from "@/modules/identity/infrastructure/pg-audit-log";
import { PgAuditLogReader } from "@/modules/identity/infrastructure/pg-audit-log-reader";
import { DropboxStorage } from "@/modules/media/infrastructure/dropbox-storage";
import { LocalDiskStorage } from "@/modules/media/infrastructure/local-disk-storage";
import { MailpitEmailSender } from "@/modules/notifications/infrastructure/mailpit-email-sender";
import { Smtp2goEmailSender } from "@/modules/notifications/infrastructure/smtp2go-email-sender";
import { PgSubmissionStats } from "@/modules/submissions/infrastructure/pg-submission-stats";
import { emailTemplates } from "@/shared/presentation/email";
import { InMemoryJobQueue, FakeUnitOfWorkFactory, RecordingLogger } from "@/shared/application/testing/fakes";
import { loadConfig } from "./config";
import { buildDefinitions, buildMedia, buildNotifications, buildSubmissions } from "./modules";

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

- [ ] **Step 3: Implement.** `config.ts`: add to `envSchema`:

```ts
  MEDIA_PROVIDER: z.enum(["local", "dropbox"]).default("local"),
  MEDIA_DURABLE_DIR: z.string().min(1).default("./data/durable"),
  DROPBOX_APP_KEY: z.string().min(1).optional(),
  DROPBOX_APP_SECRET: z.string().min(1).optional(),
  DROPBOX_REFRESH_TOKEN: z.string().min(1).optional(),
  DROPBOX_API_URL: z.url().default("https://api.dropboxapi.com"),
  DROPBOX_CONTENT_URL: z.url().default("https://content.dropboxapi.com"),
  EMAIL_PROVIDER: z.enum(["mailpit", "smtp2go"]).default("mailpit"),
  SMTP2GO_API_KEY: z.string().min(1).optional(),
  SMTP2GO_API_URL: z.url().default("https://api.smtp2go.com/v3"),
  MAILPIT_URL: z.url().default("http://127.0.0.1:8025"),
  EMAIL_FROM: z.string().min(3).default("Effluz Forms <forms@forms.effluz.com>"),
  EMAIL_REPLY_TO: z.email().optional(),
```

and after the existing production checks in `loadConfig`:

```ts
  if (e.NODE_ENV === "production" && e.MEDIA_PROVIDER === "local")
    throw new Error("Invalid configuration: MEDIA_PROVIDER must be dropbox in production");
  if (e.NODE_ENV === "production" && e.EMAIL_PROVIDER === "mailpit")
    throw new Error("Invalid configuration: EMAIL_PROVIDER must be smtp2go in production");
  const missing = (names: string[]) => names.filter((n) => !(e as Record<string, unknown>)[n]);
  if (e.MEDIA_PROVIDER === "dropbox") {
    const absent = missing(["DROPBOX_APP_KEY", "DROPBOX_APP_SECRET", "DROPBOX_REFRESH_TOKEN"]);
    if (absent.length > 0) throw new Error(`Invalid configuration: ${absent.join(", ")}`);
  }
  if (e.EMAIL_PROVIDER === "smtp2go" && !e.SMTP2GO_API_KEY) throw new Error("Invalid configuration: SMTP2GO_API_KEY");
  const replyTo = e.EMAIL_REPLY_TO ?? e.PRIVACY_CONTACT_EMAIL;
```

with the returned object gaining:

```ts
    media:
      e.MEDIA_PROVIDER === "dropbox"
        ? {
            provider: "dropbox",
            appKey: e.DROPBOX_APP_KEY ?? "",
            appSecret: e.DROPBOX_APP_SECRET ?? "",
            refreshToken: e.DROPBOX_REFRESH_TOKEN ?? "",
            apiUrl: e.DROPBOX_API_URL,
            contentUrl: e.DROPBOX_CONTENT_URL,
          }
        : { provider: "local", durableDir: e.MEDIA_DURABLE_DIR },
    email:
      e.EMAIL_PROVIDER === "smtp2go"
        ? { provider: "smtp2go", apiKey: e.SMTP2GO_API_KEY ?? "", apiUrl: e.SMTP2GO_API_URL, from: e.EMAIL_FROM, replyTo }
        : { provider: "mailpit", url: e.MAILPIT_URL, from: e.EMAIL_FROM, replyTo },
```

and the matching `AppConfig` fields from Interfaces. `.env.example`: one commented entry per new variable, in the style of the file (what it is, allowed values, default; that production refuses `local` and `mailpit`; that keys stay out of the repository).

`modules.ts`:

```ts
import type { Pool } from "pg";
import type { DefinitionsDeps } from "@/modules/definitions/application";
import { PgDraftRepository } from "@/modules/definitions/infrastructure/pg-draft-repository";
import { PgFormRepository } from "@/modules/definitions/infrastructure/pg-form-repository";
import { PgVersionRepository } from "@/modules/definitions/infrastructure/pg-version-repository";
import type { AuditLog, AuditLogReader } from "@/modules/identity/application";
import type { MediaDeps } from "@/modules/media/application";
import { DropboxStorage } from "@/modules/media/infrastructure/dropbox-storage";
import { FileTypeSniffer } from "@/modules/media/infrastructure/file-type-sniffer";
import { LocalDiskStorage } from "@/modules/media/infrastructure/local-disk-storage";
import { PgMediaRepository } from "@/modules/media/infrastructure/pg-media-repository";
import { SharpImageEncoder } from "@/modules/media/infrastructure/sharp-image-encoder";
import type { NotificationsDeps } from "@/modules/notifications/application";
import { MailpitEmailSender } from "@/modules/notifications/infrastructure/mailpit-email-sender";
import { PgDeliveryLog } from "@/modules/notifications/infrastructure/pg-delivery-log";
import { Smtp2goEmailSender } from "@/modules/notifications/infrastructure/smtp2go-email-sender";
import { VersionCache, type SubmissionsDeps } from "@/modules/submissions/application";
import { SubmissionMessageSource } from "@/modules/submissions/infrastructure/message-source";
import { PgInProgressRepository } from "@/modules/submissions/infrastructure/pg-in-progress-repository";
import { PgSubmissionRepository } from "@/modules/submissions/infrastructure/pg-submission-repository";
import { PgSubmissionStats } from "@/modules/submissions/infrastructure/pg-submission-stats";
import type { JobQueue } from "@/shared/application/ports/job-queue";
import type { Logger } from "@/shared/application/ports/logger";
import type { UnitOfWorkFactory } from "@/shared/application/ports/unit-of-work";
import { buildDefaultRegistry } from "@/shared/domain/form-model";
import { systemClock } from "@/shared/infrastructure/clock";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { emailTemplates } from "@/shared/presentation/email";
import type { AppConfig } from "./config";

/** Module wiring shared by the web container and the worker. See specs/architecture.md, "Ports". */
const registry = buildDefaultRegistry();

export function buildDefinitions(config: AppConfig, pool: Pool, uow: UnitOfWorkFactory, audit: AuditLog, auditReader: AuditLogReader): DefinitionsDeps {
  return {
    forms: new PgFormRepository(pool),
    drafts: new PgDraftRepository(pool),
    versions: new PgVersionRepository(pool),
    stats: new PgSubmissionStats(pool),
    audit,
    auditReader,
    uow,
    clock: systemClock,
    ids: systemIdGenerator,
    registry,
    allowedRecipientDomains: config.notificationAllowedDomains,
    publicBaseUrl: config.publicBaseUrl,
  };
}

export function buildMedia(config: AppConfig, pool: Pool, uow: UnitOfWorkFactory, queue: JobQueue): MediaDeps {
  const media = config.media;
  return {
    staging: new LocalDiskStorage(config.stagingDir),
    durable:
      media.provider === "dropbox"
        ? new DropboxStorage({
            appKey: media.appKey,
            appSecret: media.appSecret,
            refreshToken: media.refreshToken,
            apiUrl: media.apiUrl,
            contentUrl: media.contentUrl,
          })
        : new LocalDiskStorage(media.durableDir),
    sniffer: new FileTypeSniffer(),
    encoder: new SharpImageEncoder(),
    media: new PgMediaRepository(pool),
    queue,
    uow,
    ids: systemIdGenerator,
    clock: systemClock,
  };
}

export function buildSubmissions(input: {
  pool: Pool; uow: UnitOfWorkFactory; queue: JobQueue; definitions: DefinitionsDeps; media: MediaDeps; logger: Logger;
}): SubmissionsDeps {
  return {
    definitions: input.definitions,
    media: input.media,
    inProgress: new PgInProgressRepository(input.pool),
    submissions: new PgSubmissionRepository(input.pool),
    queue: input.queue,
    uow: input.uow,
    clock: systemClock,
    ids: systemIdGenerator,
    registry,
    logger: input.logger,
    versions: new VersionCache(),
    random: Math.random,
  };
}

export function buildNotifications(config: AppConfig, pool: Pool, submissions: SubmissionsDeps): NotificationsDeps {
  const email = config.email;
  return {
    sender: email.provider === "smtp2go"
      ? new Smtp2goEmailSender({ apiKey: email.apiKey, apiUrl: email.apiUrl, from: email.from, replyTo: email.replyTo })
      : new MailpitEmailSender({ url: email.url, from: email.from, replyTo: email.replyTo }),
    renderer: emailTemplates,
    source: new SubmissionMessageSource({
      submissions: submissions.submissions, definitions: submissions.definitions, versions: submissions.versions,
      registry, publicBaseUrl: config.publicBaseUrl, privacyContact: config.privacyContactEmail,
    }),
    deliveries: new PgDeliveryLog(pool),
  };
}
```

`container.ts`: replace `buildDefinitions` with the import from `./modules`; add `media` and `submissions`:

```ts
  const queue = overrides.queue ?? new PgJobQueue(systemIdGenerator, systemClock);
  const definitions = overrides.definitions ?? buildDefinitions(config, pool, uow, identity.audit, auditReader);
  const media = overrides.media ?? buildMedia(config, pool, uow, queue);
  const submissions = overrides.submissions ?? buildSubmissions({ pool, uow, queue, definitions, media, logger });
```

and return them; `Container` gains `media: MediaDeps; submissions: SubmissionsDeps`. Remove the `NullSubmissionStats` import (the class stays for definitions' tests).

`worker-handlers.ts`:

```ts
import type { Pool } from "pg";
import { createIdentityCleanupHandler } from "@/modules/identity/infrastructure/jobs/cleanup";
import { createMediaDeleteHandler, createMediaUploadHandler, MEDIA_JOB_TYPES, type MediaDeps } from "@/modules/media/application";
import {
  createStaffNotificationHandler,
  createSubmitterConfirmationHandler,
  EMAIL_JOB_TYPES,
  type NotificationsDeps,
} from "@/modules/notifications/application";
import { expireInProgress, type SubmissionsDeps } from "@/modules/submissions/application";
import type { JobHandler } from "@/shared/application/ports/job-queue";
import { createCleanupHandler } from "@/shared/infrastructure/jobs/handlers/cleanup";
import type { PgJobStore } from "@/shared/infrastructure/jobs/pg-job-store";
import type { RecurringJob } from "@/shared/infrastructure/jobs/worker";

/** The recurring jobs scheduled today; specs/system/jobs.md, "Recurring jobs". */
export const RECURRING: RecurringJob[] = [
  { type: "jobs.cleanup", period: "daily" },
  { type: "identity.cleanup", period: "daily" },
];

/** Every handler the worker runs, by job type. */
export function workerHandlers(input: {
  store: PgJobStore; pool: Pool; media: MediaDeps; notifications: NotificationsDeps; submissions: SubmissionsDeps;
}): Record<string, JobHandler> {
  return {
    "jobs.cleanup": createCleanupHandler(input.store, [
      async (ctx) => {
        await expireInProgress(input.submissions, { now: ctx.clock.now(), logger: ctx.logger });
      },
    ]),
    "identity.cleanup": createIdentityCleanupHandler(input.pool),
    [MEDIA_JOB_TYPES.upload]: createMediaUploadHandler(input.media),
    [MEDIA_JOB_TYPES.delete]: createMediaDeleteHandler(input.media),
    [EMAIL_JOB_TYPES.submitterConfirmation]: createSubmitterConfirmationHandler(input.notifications),
    [EMAIL_JOB_TYPES.staffNotification]: createStaffNotificationHandler(input.notifications),
  };
}
```

`worker.ts`: after building `store` and the `uow`/`queue`, build `audit = new PgAuditLog()`, `auditReader = new PgAuditLogReader(pool)`, `definitions = buildDefinitions(...)`, `media = buildMedia(config, pool, uow, queue)`, `submissions = buildSubmissions({ pool, uow, queue, definitions, media, logger })`, `notifications = buildNotifications(config, pool, submissions)`; pass `handlers: workerHandlers({ store, pool, media, notifications, submissions })` and `recurring: RECURRING`. The worker still never imports Next.js: `src/shared/presentation/email/` is plain TypeScript.

- [ ] **Step 4: Run** `pnpm test && pnpm lint && pnpm typecheck && pnpm format:check && pnpm build`; then `pnpm db:up && pnpm exec tsx --env-file=.env src/app/worker.ts` for ten seconds and see `worker started` and no error.
- [ ] **Step 5: Commit** `feat(app): media and email configuration, module wiring, and the six job handlers in the worker`

---

### Task 28: Public routes, root layouts, cookies and the renderer's Content-Security-Policy

**Files:**
- Create: `src/modules/submissions/presentation/cookies.ts`, `cookies.test.ts`, `http.ts`, `http.test.ts`, `csp.ts`, `csp.test.ts`, `error-copy.ts`
- Modify: `src/modules/submissions/presentation/copy.test.ts`, `src/modules/submissions/application/index.ts`
- Create: `src/app/f/[slug]/layout.tsx`, `page.tsx`, `view.ts`, `not-found.tsx`, `error.tsx`, `answers/route.ts`, `files/route.ts`, `files/[fileId]/route.ts`, `check/route.ts`, `restart/route.ts`, `_lib/respond.ts`, `routes.test.ts`
- Create: `src/app/(home)/layout.tsx`; move `src/app/page.tsx` to `src/app/(home)/page.tsx`
- Modify: `src/app/admin/layout.tsx` (becomes the staff root layout with `<html lang="en">` and `<body>`), delete `src/app/layout.tsx`, `src/proxy.ts`, `src/proxy.test.ts`

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
export function fillCookie(slug: string, state: FillState, secure: boolean): string;
export function clearedFillCookie(slug: string, secure: boolean): string;
export function readCookie(header: string | null, name: string): string | null;
// http.ts
export const PAGE_BODY_LIMIT: number;                                           // LIMITS.submissionSizeMb MB + 1 MB
export const FILE_BODY_LIMIT: number;                                           // LIMITS.fileSizeMb MB + 64 KB
export async function readFormData(request: Request, maxBytes: number): Promise<FormData | "too_large" | "malformed">;
export function seeOther(location: string, cookies?: readonly string[]): Response;
export function json(body: unknown, status?: number, cookies?: readonly string[]): Response;
export function html(body: string, status: number): Response;
export function plain(status: number): Response;
// csp.ts
export function rendererCsp(nonce: string, development: boolean): string;
// src/app/f/[slug]/_lib/respond.ts
export function outcomeResponse(slug: string, outcome: PostOutcome, secure: boolean): Response;
// src/app/f/[slug]/view.ts
export const loadView: (slug: string, expired: boolean) => Promise<{ view: ViewResult; container: Container }>;   // React cache(), shared by layout and page
```

Decision (in-progress cookie): `effluz_fill`, `Path=/f/<slug>`, `HttpOnly`, `SameSite=Lax`, `Max-Age=86400`, `Secure` in production; values `<record id>`, `done.<submit token>`, `decoy.<reference>`; `SameSite=Lax` is the CSRF defence for the public posts. Decision (root layouts): `src/app/layout.tsx` gives way to three root layouts (`admin/`, `(home)/`, `f/[slug]/`) so the renderer's `<html lang>` follows the submitter's language; the renderer layout and page share one `viewForm` call through React's `cache`. Unmatched paths outside the three trees get Next's built-in 404, which nothing links to.

Every post answers 303 to `GET /f/<slug>` (Post/Redirect/Get). An unexpected error answers the static error page with 500; an oversized body the same page with 413; a malformed body a bare 400. Logs name the slug and the error class, never a value.

- [ ] **Step 1: Failing tests.** `cookies.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clearedFillCookie, encodeFillState, fillCookie, parseFillState } from "./cookies";

const ID = "00000000-0000-4000-8000-0000000000aa";

describe("the in-progress cookie", () => {
  it("is scoped to the form, httpOnly, lax, a day long, secure in production", () => {
    expect(fillCookie("story-form", { kind: "record", id: ID }, true)).toBe(
      `effluz_fill=${ID}; Path=/f/story-form; HttpOnly; SameSite=Lax; Max-Age=86400; Secure`,
    );
    expect(clearedFillCookie("story-form", false)).toBe("effluz_fill=; Path=/f/story-form; HttpOnly; SameSite=Lax; Max-Age=0");
  });

  it("round-trips each state and reads anything else as none", () => {
    for (const state of [{ kind: "record", id: ID }, { kind: "done", submitToken: ID }, { kind: "decoy", reference: "HP-1234" }] as const) {
      expect(parseFillState(encodeFillState(state))).toEqual(state);
    }
    for (const junk of [null, "", "nope", "done.not-a-uuid", "decoy.<script>", "decoy.hp-1", `${ID};x`]) {
      expect(parseFillState(junk)).toEqual({ kind: "none" });
    }
  });
});
```

`http.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFormData, seeOther } from "./http";

const request = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("http://localhost/f/x/answers", { method: "POST", body, headers, duplex: "half" } as RequestInit);

describe("readFormData", () => {
  it("parses a body within the limit", async () => {
    const form = new FormData();
    form.set("a", "1");
    const parsed = await readFormData(request(form), 1024);
    expect(parsed instanceof FormData && parsed.get("a")).toBe("1");
  });

  it("refuses by Content-Length before reading, and by counting a body without one", async () => {
    expect(await readFormData(request("x", { "content-length": "5000", "content-type": "text/plain" }), 1024)).toBe("too_large");
    const big = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(2048)); c.close(); } });
    expect(await readFormData(request(big, { "content-type": "multipart/form-data; boundary=x" }), 1024)).toBe("too_large");
  });

  it("calls an unparsable body malformed", async () => {
    expect(await readFormData(request("garbage", { "content-type": "multipart/form-data; boundary=x" }), 1024)).toBe("malformed");
  });
});

describe("seeOther", () => {
  it("is an uncached 303 with each cookie as its own header", () => {
    const res = seeOther("/f/x", ["a=1", "b=2"]);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/f/x");
    expect(res.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
```

`csp.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rendererCsp } from "./csp";

describe("rendererCsp", () => {
  it("allows only this origin's scripts carrying the nonce, and no framing", () => {
    const csp = rendererCsp("abc123", false);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("img-src 'self' blob: data:");
    expect(csp).not.toContain("unsafe-eval");
    expect(rendererCsp("abc123", true)).toContain("'unsafe-eval'");
  });
});
```

`src/app/f/[slug]/routes.test.ts`:

```ts
import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/container", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/container")>()),
  getContainer: vi.fn(),
}));

import { loadConfig } from "@/app/config";
import { buildContainer, getContainer } from "@/app/container";
import { fakeImage } from "@/modules/media/application/testing/fakes";
import { makeSubmissionsDeps, publishStory, type FakeSubmissionsDeps } from "@/modules/submissions/application/testing/fakes";
import { CONSENT_TEXT } from "@/modules/submissions/domain/testing/versions";
import { consentTextVersion } from "@/shared/domain/form-model";
import { POST as answers } from "./answers/route";
import { POST as check } from "./check/route";
import { DELETE as removeFile } from "./files/[fileId]/route";
import { POST as upload } from "./files/route";
import { GET as restart } from "./restart/route";

const config = loadConfig({
  NODE_ENV: "test", PUBLIC_BASE_URL: "https://forms.example.com", DATABASE_URL: "postgres://u:p@localhost:5432/none",
  STAGING_DIR: "./data/staging", PRIVACY_CONTACT_EMAIL: "privacy@example.com", GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret", GOOGLE_ALLOWED_HOSTED_DOMAIN: "effluz.com",
});
const params = { params: Promise.resolve({ slug: "story-form" }) };
let deps: FakeSubmissionsDeps;

beforeEach(async () => {
  deps = makeSubmissionsDeps();
  await publishStory(deps);
  vi.mocked(getContainer).mockReturnValue(
    buildContainer(config, { pool: {} as unknown as Pool, submissions: deps, definitions: deps.definitions, media: deps.media }),
  );
});

function form(fields: Record<string, string | File | File[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const item of Array.isArray(v) ? v : [v]) f.append(k, item);
  return f;
}
const req = (path: string, body: FormData, cookie?: string) =>
  new Request(`https://forms.example.com/f/story-form${path}`, { method: "POST", body, headers: cookie ? { cookie } : {} });
const cookieOf = (res: Response) => res.headers.getSetCookie()[0]?.split(";")[0] ?? "";

describe("POST /f/<slug>/answers", () => {
  it("creates the record on page 1 and redirects with the cookie", async () => {
    const res = await answers(req("/answers", form({ _page: "page_contact", _action: "next", _rendered: deps.clock.now().toISOString(), "website-url": "", f_name: "Ana Prueba", f_baby: "no_opt" })), params);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/f/story-form");
    expect(res.headers.getSetCookie()[0]).toMatch(/^effluz_fill=[0-9a-f-]{36}; Path=\/f\/story-form; HttpOnly; SameSite=Lax; Max-Age=86400$/);
    expect(deps.inProgress.rows.size).toBe(1);
  });

  it("answers a malformed post with 400 and an oversized one with 413", async () => {
    expect((await answers(req("/answers", form({ _page: "page_contact", _action: "jump" })), params)).status).toBe(400);
    const big = new Request("https://forms.example.com/f/story-form/answers", { method: "POST", body: "x", headers: { "content-length": String(200 * 1024 * 1024), "content-type": "multipart/form-data; boundary=x" } });
    const res = await answers(big, params);
    expect(res.status).toBe(413);
    expect(await res.text()).toContain("Algo salió mal");
  });

  it("sends an expired cookie to the expired screen and clears it", async () => {
    const res = await answers(req("/answers", form({ _page: "page_contact", _action: "next" }), "effluz_fill=00000000-0000-4000-8000-0000000000aa"), params);
    expect(res.headers.get("location")).toBe("/f/story-form?expired=1");
    expect(res.headers.getSetCookie()[0]).toContain("Max-Age=0");
  });

  it("submits a one-page path end to end and sets the done cookie", async () => {
    const first = await answers(req("/answers", form({ _page: "page_contact", _action: "next", _rendered: new Date(deps.clock.now().getTime() - 60_000).toISOString(), f_name: "Ana Prueba", f_baby: "no_opt" })), params);
    const cookie = cookieOf(first);
    const token = [...deps.inProgress.rows.values()][0]?.submitToken ?? "";
    const done = await answers(req("/answers", form({ _page: "page_consent", _action: "submit", _token: token, f_consent: "accepted" }), cookie), params);
    expect(done.headers.getSetCookie()[0]).toMatch(new RegExp(`^effluz_fill=done\\.${token}; `));
    expect(deps.submissions.rows.size).toBe(1);
    expect([...deps.submissions.rows.values()][0]?.consent?.textVersion).toBe(consentTextVersion(CONSENT_TEXT));
  });
});

describe("early uploads, removal, blur checks and restart", () => {
  async function onPhotos(): Promise<string> {
    const first = await answers(req("/answers", form({ _page: "page_contact", _action: "next", f_name: "Ana Prueba", f_baby: "yes_opt" })), params);
    return cookieOf(first);
  }

  it("uploads one file as JSON, refuses with a localized message, and removes", async () => {
    const cookie = await onPhotos();
    const ok = await upload(req("/files", form({ field: "f_photos", _locale: "es", file: new File([fakeImage()], "a.jpg") }), cookie), params);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { ok: boolean; file: { id: string }; label: string };
    expect(body).toMatchObject({ ok: true, label: "Archivo 1, 1 kB" });
    const refused = await upload(req("/files", form({ field: "f_photos", _locale: "es", file: new File(["<html>"], "notes.jpg") }), cookie), params);
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ ok: false, message: "notes.jpg no es un tipo permitido. Usa fotos JPEG, PNG, WebP o HEIC, o videos MP4 o MOV" });
    const del = await removeFile(new Request(`https://forms.example.com/f/story-form/files/${body.file.id}`, { method: "DELETE", headers: { cookie } }), { params: Promise.resolve({ slug: "story-form", fileId: body.file.id }) });
    expect(del.status).toBe(204);
  });

  it("checks one field with the server's rules", async () => {
    const res = await check(req("/check", form({ _field: "f_email", _locale: "en", f_email: "nope" })), params);
    expect(await res.json()).toEqual({ message: "Enter a valid email address, like name@example.com" });
    const fine = await check(req("/check", form({ _field: "f_email", _locale: "en", f_email: "a@example.com" })), params);
    expect(await fine.json()).toEqual({ message: null });
  });

  it("restarts by clearing the cookie", async () => {
    const res = await restart(new Request("https://forms.example.com/f/story-form/restart"), params);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/f/story-form");
    expect(res.headers.getSetCookie()[0]).toContain("Max-Age=0");
  });
});
```

In `src/proxy.test.ts` add:

```ts
describe("the renderer's Content-Security-Policy", () => {
  it("adds a per-request nonce policy to /f/ requests and leaves the session gate alone", async () => {
    const res = await proxy(new NextRequest("https://forms.example.com/f/story-form"));
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    const again = await proxy(new NextRequest("https://forms.example.com/f/story-form"));
    expect(again.headers.get("content-security-policy")).not.toBe(csp);
    expect(vi.mocked(getContainer)).not.toHaveBeenCalled();
  });

  it("matches /f paths as well as /admin", () => {
    expect(proxyConfig.matcher).toEqual(["/admin/:path*", "/f/:slug"]);
  });
});
```

(`getContainer` is mocked in that file; reset the mock's call history in this describe's `beforeEach` with `vi.mocked(getContainer).mockClear()`.)

- [ ] **Step 2: Run** `pnpm test src/modules/submissions/presentation src/app/f src/proxy.test.ts`: fails.

- [ ] **Step 3: Implement.** `cookies.ts`:

```ts
import type { FillState } from "../application";

/** The renderer's one cookie; specs/system/security.md, "In-progress cookie". */
export const FILL_COOKIE = "effluz_fill";
export const FILL_COOKIE_MAX_AGE_SECONDS = 86_400;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REFERENCE = /^[A-Z0-9]{2,6}-\d{4,}$/;

export function fillCookiePath(slug: string): string {
  return `/f/${encodeURIComponent(slug)}`;
}

export function encodeFillState(state: FillState): string | null {
  switch (state.kind) {
    case "none":
      return null;
    case "record":
      return state.id;
    case "done":
      return `done.${state.submitToken}`;
    case "decoy":
      return `decoy.${state.reference}`;
  }
}

export function parseFillState(value: string | null): FillState {
  if (value === null) return { kind: "none" };
  if (UUID.test(value)) return { kind: "record", id: value };
  if (value.startsWith("done.") && UUID.test(value.slice(5))) return { kind: "done", submitToken: value.slice(5) };
  if (value.startsWith("decoy.") && REFERENCE.test(value.slice(6))) return { kind: "decoy", reference: value.slice(6) };
  return { kind: "none" };
}

function build(slug: string, value: string, maxAge: number, secure: boolean): string {
  const parts = [`${FILL_COOKIE}=${value}`, `Path=${fillCookiePath(slug)}`, "HttpOnly", "SameSite=Lax", `Max-Age=${String(maxAge)}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function fillCookie(slug: string, state: FillState, secure: boolean): string {
  const value = encodeFillState(state);
  return value === null ? clearedFillCookie(slug, secure) : build(slug, value, FILL_COOKIE_MAX_AGE_SECONDS, secure);
}

export function clearedFillCookie(slug: string, secure: boolean): string {
  return build(slug, "", 0, secure);
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      return value === "" ? null : value;
    }
  }
  return null;
}
```

`http.ts`:

```ts
import { LIMITS } from "@/shared/domain/form-model";

const MB = 1024 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };

/** A page post may carry every file of its upload fields: the per-submission cap plus room for the text. */
export const PAGE_BODY_LIMIT = LIMITS.submissionSizeMb * MB + MB;
/** An early upload carries one file. */
export const FILE_BODY_LIMIT = LIMITS.fileSizeMb * MB + 64 * 1024;

/**
 * The body as FormData, refusing more than `maxBytes` by the declared length
 * first and by counting as it streams otherwise, so an oversized upload is
 * never buffered whole. See specs/system/security.md, "Public form abuse protection".
 */
export async function readFormData(request: Request, maxBytes: number): Promise<FormData | "too_large" | "malformed"> {
  const declared = Number(request.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) return "too_large";
  if (request.body === null) return "malformed";
  let seen = 0;
  let over = false;
  const limited = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > maxBytes) {
          over = true;
          controller.error(new Error("body too large"));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  try {
    return await new Response(limited, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return over ? "too_large" : "malformed";
  }
}

export function seeOther(location: string, cookies: readonly string[] = []): Response {
  const headers = new Headers({ Location: location, ...NO_STORE });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 303, headers });
}

export function json(body: unknown, status = 200, cookies: readonly string[] = []): Response {
  const headers = new Headers({ "Content-Type": "application/json", ...NO_STORE });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(JSON.stringify(body), { status, headers });
}

export function html(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE } });
}

export function plain(status: number): Response {
  return new Response(null, { status, headers: NO_STORE });
}
```

`csp.ts`:

```ts
/** The renderer's policy; specs/system/security.md, "Transport and headers". */
export function rendererCsp(nonce: string, development: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
```

`src/proxy.ts`: at the top of `proxy()`, before the admin logic:

```ts
  if (pathname.startsWith("/f/")) return withRendererCsp(request);
```

and

```ts
/** A fresh nonce per request; Next reads it from the request's policy and puts it on its scripts. */
function withRendererCsp(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = rendererCsp(nonce, process.env.NODE_ENV === "development");
  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}
```

importing `rendererCsp` from `@/modules/submissions/presentation/csp`; set `matcher: ["/admin/:path*", "/f/:slug"]`: the policy matters only on the HTML page, and keeping the posts out of the proxy means upload bodies are never buffered by it (Next buffers a proxied request body only up to its own size limit). Update the doc comment of `proxy` to say it also sets the renderer's policy.

`src/app/f/[slug]/_lib/respond.ts`:

```ts
import type { PostOutcome } from "@/modules/submissions/application";
import { clearedFillCookie, fillCookie } from "@/modules/submissions/presentation/cookies";
import { seeOther } from "@/modules/submissions/presentation/http";

/** Every post ends here: Post/Redirect/Get to the form's one page, with the cookie the outcome needs. */
export function outcomeResponse(slug: string, outcome: PostOutcome, secure: boolean): Response {
  const page = `/f/${encodeURIComponent(slug)}`;
  switch (outcome.kind) {
    case "show":
      return seeOther(page, [fillCookie(slug, { kind: "record", id: outcome.recordId }, secure)]);
    case "submitted":
      return seeOther(page, [fillCookie(slug, { kind: "done", submitToken: outcome.submitToken }, secure)]);
    case "decoy":
      return seeOther(page, [fillCookie(slug, { kind: "decoy", reference: outcome.reference }, secure)]);
    case "expired":
      return seeOther(`${page}?expired=1`, [clearedFillCookie(slug, secure)]);
    case "gate":
      return seeOther(page);
  }
}
```

`src/app/f/[slug]/answers/route.ts`:

```ts
import { getContainer } from "@/app/container";
import { postContext, savePage, submitForm } from "@/modules/submissions/application";
import { FILL_COOKIE, parseFillState, readCookie } from "@/modules/submissions/presentation/cookies";
import { decodePagePost } from "@/modules/submissions/presentation/decode";
import { errorPageHtml } from "@/modules/submissions/presentation/error-page";
import { html, PAGE_BODY_LIMIT, plain, readFormData } from "@/modules/submissions/presentation/http";
import { outcomeResponse } from "../_lib/respond";

/** The page form's target: Next, Back, Submit, the language switch, Remove. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const container = getContainer();
  const deps = container.submissions;
  const secure = container.config.session.secure;
  const failure = (status: number) =>
    html(errorPageHtml({ slug, retentionMonths: null, contact: container.config.privacyContactEmail }), status);
  try {
    const form = await readFormData(request, PAGE_BODY_LIMIT);
    if (form === "too_large") return failure(413);
    if (form === "malformed") return plain(400);
    const state = parseFillState(readCookie(request.headers.get("cookie"), FILL_COOKIE));
    const token = form.get("_token");
    const ctx = await postContext(deps, { slug, state, submitToken: typeof token === "string" && token !== "" ? token : null });
    if (!ctx.ok) return outcomeResponse(slug, ctx.outcome, secure);
    const decoded = await decodePagePost(form, ctx.version.document, deps.registry);
    if (decoded === null) return plain(400);
    const post = { ...decoded, state, acceptLanguage: request.headers.get("accept-language") };
    const outcome = decoded.action.kind === "submit" ? await submitForm(deps, ctx, post) : await savePage(deps, ctx, post);
    return outcomeResponse(slug, outcome, secure);
  } catch (e) {
    container.logger.error("form post failed", { slug, error: e instanceof Error ? e.name : "Error" });
    return failure(500);
  }
}
```

`src/app/f/[slug]/files/route.ts`:

```ts
import { getContainer } from "@/app/container";
import { localeFor, pickLocale, postContext, uploadFields, uploadFile } from "@/modules/submissions/application";
import { t } from "@/modules/submissions/presentation/copy";
import { FILL_COOKIE, fillCookie, parseFillState, readCookie } from "@/modules/submissions/presentation/cookies";
import { formatBytes } from "@/modules/submissions/presentation/format";
import { FILE_BODY_LIMIT, json, plain, readFormData } from "@/modules/submissions/presentation/http";
import { uploadRefusalMessage } from "@/modules/submissions/presentation/messages";
import { resolveText } from "@/shared/domain/localized-text";

/**
 * An early upload with script: one file, JSON back; renderer.md, "File upload".
 * Messages may hold "{file}", which the client fills with the name it shows.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const container = getContainer();
  const deps = container.submissions;
  try {
    const state = parseFillState(readCookie(request.headers.get("cookie"), FILL_COOKIE));
    const ctx = await postContext(deps, { slug, state, submitToken: null });
    if (!ctx.ok) return json({ ok: false, message: null }, 410);
    const doc = ctx.version.document;
    const fallback = ctx.record?.locale ?? pickLocale(doc.languages, request.headers.get("accept-language"));
    const form = await readFormData(request, FILE_BODY_LIMIT);
    if (form === "malformed") return plain(400);
    if (form === "too_large") {
      // The body was not read: the limits of the current page's upload field speak for it.
      const pageKey = ctx.record?.pageKey ?? doc.pages[0]?.key;
      const onPage = uploadFields(doc, deps.registry).find((u) =>
        doc.pages.find((p) => p.key === pageKey)?.fields.some((f) => f.key === u.field.key),
      );
      if (!onPage) return plain(413);
      const label = resolveText(onPage.field.label, fallback, doc.languages);
      return json({ ok: false, message: uploadRefusalMessage("file_too_large", { file: "{file}", label, limits: onPage.limits }, fallback) }, 413);
    }
    const wanted = form.get("_locale");
    const locale = wanted === "en" || wanted === "es" ? localeFor(doc.languages, wanted) : fallback;
    const target = uploadFields(doc, deps.registry).find((u) => u.field.key === form.get("field"));
    const file = form.get("file");
    if (!target || file === null || typeof file === "string") return plain(400);
    const label = resolveText(target.field.label, locale, doc.languages);
    const out = await uploadFile(deps, ctx, {
      fieldKey: target.field.key,
      bytes: new Uint8Array(await file.arrayBuffer()),
      renderedAt: null,
      acceptLanguage: request.headers.get("accept-language"),
    });
    if (!out.ok) {
      const message = uploadRefusalMessage(out.code, { file: file.name, label, limits: target.limits }, locale);
      return json({ ok: false, message }, out.code === "expired" ? 410 : 422);
    }
    const size = formatBytes(out.file.size, locale);
    return json(
      { ok: true, file: out.file, count: out.count, label: t(locale, "file_row", { n: String(out.count), size }) },
      200,
      [fillCookie(slug, { kind: "record", id: out.recordId }, container.config.session.secure)],
    );
  } catch (e) {
    container.logger.error("upload failed", { slug, error: e instanceof Error ? e.name : "Error" });
    return json({ ok: false, message: null }, 500);
  }
}
```

Add `export { localeFor, pickLocale } from "../domain/locale";` to the submissions application `index.ts`.

`src/app/f/[slug]/files/[fileId]/route.ts`:

```ts
import { getContainer } from "@/app/container";
import { postContext, removeFile } from "@/modules/submissions/application";
import { FILL_COOKIE, parseFillState, readCookie } from "@/modules/submissions/presentation/cookies";
import { plain } from "@/modules/submissions/presentation/http";

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string; fileId: string }> }): Promise<Response> {
  const { slug, fileId } = await params;
  const container = getContainer();
  const state = parseFillState(readCookie(request.headers.get("cookie"), FILL_COOKIE));
  const ctx = await postContext(container.submissions, { slug, state, submitToken: null });
  if (!ctx.ok) return plain(410);
  return plain((await removeFile(container.submissions, ctx, fileId)) ? 204 : 404);
}
```

`src/app/f/[slug]/check/route.ts`:

```ts
import { getContainer } from "@/app/container";
import { checkField, localeFor, postContext } from "@/modules/submissions/application";
import { FILL_COOKIE, parseFillState, readCookie } from "@/modules/submissions/presentation/cookies";
import { decodeField } from "@/modules/submissions/presentation/decode";
import { json, plain, readFormData } from "@/modules/submissions/presentation/http";
import { issueMessage } from "@/modules/submissions/presentation/messages";
import { resolveText } from "@/shared/domain/localized-text";

/** The blur check: one field through the server's own rules; renderer.md, "Validation and errors". */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const deps = getContainer().submissions;
  const form = await readFormData(request, 64 * 1024);
  if (!(form instanceof FormData)) return plain(400);
  const state = parseFillState(readCookie(request.headers.get("cookie"), FILL_COOKIE));
  const ctx = await postContext(deps, { slug, state, submitToken: null });
  if (!ctx.ok) return json({ message: null });
  const doc = ctx.version.document;
  const key = form.get("_field");
  const field = doc.pages.flatMap((p) => p.fields).find((f) => f.key === key);
  if (!field) return plain(400);
  const decoded = decodeField(form, field);
  const result = checkField(deps, ctx, { fieldKey: field.key, answer: decoded.value, decodeIssue: decoded.issue });
  if (result === null) return plain(400);
  const locale = localeFor(doc.languages, form.get("_locale") === "en" ? "en" : "es");
  const message = result.issue ? issueMessage(result.issue, resolveText(field.label, locale, doc.languages), locale) : null;
  return json({ message });
}
```

`src/app/f/[slug]/restart/route.ts`:

```ts
import { getContainer } from "@/app/container";
import { clearedFillCookie } from "@/modules/submissions/presentation/cookies";
import { seeOther } from "@/modules/submissions/presentation/http";

/** "Start again" and "Fill in another form": forget the cookie, back to page 1. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  return seeOther(`/f/${encodeURIComponent(slug)}`, [clearedFillCookie(slug, getContainer().config.session.secure)]);
}
```

`src/app/f/[slug]/view.ts`:

```ts
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { getContainer } from "@/app/container";
import { viewForm } from "@/modules/submissions/application";
import { FILL_COOKIE, parseFillState } from "@/modules/submissions/presentation/cookies";

/** One viewForm per request, shared by the layout (for `lang`) and the page. */
export const loadView = cache(async (slug: string, expired: boolean) => {
  const [jar, head] = await Promise.all([cookies(), headers()]);
  const container = getContainer();
  const state = parseFillState(jar.get(FILL_COOKIE)?.value ?? null);
  const view = await viewForm(container.submissions, { slug, state, acceptLanguage: head.get("accept-language"), expired });
  return { view, container };
});
```

`src/app/f/[slug]/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { viewLocale } from "@/modules/submissions/presentation/Screens";
import { loadView } from "./view";

export const instant = false;

/** The renderer's root layout: `<html lang>` is the submitter's language. */
export default async function RendererLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { view } = await loadView(slug, false);
  return (
    <html lang={viewLocale(view)}>
      <body>{children}</body>
    </html>
  );
}
```

`src/app/f/[slug]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveText } from "@/shared/domain/localized-text";
import { pageTitle } from "@/modules/submissions/presentation/field-views";
import { RendererScreen } from "@/modules/submissions/presentation/Screens";
import { chrome } from "@/modules/submissions/presentation/copy";
import { loadView } from "./view";

export const instant = false;

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const { view } = await loadView(slug, sp["expired"] === "1");
  switch (view.screen) {
    case "page":
      return { title: pageTitle(view).documentTitle };
    case "confirmation": {
      const doc = view.version.document;
      return { title: resolveText(doc.title, view.locale, doc.languages), robots: { index: false } };
    }
    case "closed":
      return { title: `${chrome.closed_title.es} / ${chrome.closed_title.en}`, robots: { index: false } };
    case "not_open":
      return { title: `${chrome.not_open_title.es} / ${chrome.not_open_title.en}`, robots: { index: false } };
    case "expired":
      return { title: `${chrome.expired_title.es} / ${chrome.expired_title.en}`, robots: { index: false } };
    case "not_found":
      return { title: `${chrome.not_found_title.es} / ${chrome.not_found_title.en}`, robots: { index: false } };
  }
}

/** `GET /f/<slug>`; specs/ui-ux/renderer.md, "Routes". */
export default async function FormRoute({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const { view, container } = await loadView(slug, sp["expired"] === "1");
  if (view.screen === "not_found") notFound();
  return <RendererScreen view={view} slug={slug} contact={container.config.privacyContactEmail} registry={container.submissions.registry} />;
}
```

`src/app/f/[slug]/not-found.tsx`:

```tsx
import { NotFoundScreen } from "@/modules/submissions/presentation/Screens";

export default function FormNotFound() {
  return <NotFoundScreen />;
}
```

`src/modules/submissions/presentation/error-copy.ts` holds the three rows the client error boundary needs, alone, so the boundary does not load the copy tables:

```ts
export const errorCopy = {
  title: { en: "Something went wrong", es: "Algo salió mal" },
  body: {
    en: "Your answers on this page were not saved. Please try again.",
    es: "Las respuestas de esta página no se guardaron. Inténtalo de nuevo.",
  },
  tryAgain: { en: "Try again", es: "Intentar de nuevo" },
} as const;
```

and `copy.test.ts` gains:

```ts
  it("keeps the client error boundary's copy equal to the chrome rows", () => {
    expect(errorCopy).toEqual({ title: chrome.error_title, body: chrome.error_body, tryAgain: chrome.try_again });
  });
```

`src/app/f/[slug]/error.tsx`:

```tsx
"use client";

import { errorCopy } from "@/modules/submissions/presentation/error-copy";

/** Unexpected errors while rendering, in both languages; Try again reloads the current page. */
export default function FormError() {
  return (
    <main>
      <h1>
        {errorCopy.title.es}
        <span lang="en">{errorCopy.title.en}</span>
      </h1>
      <p>
        {errorCopy.body.es}
        <span lang="en">{errorCopy.body.en}</span>
      </p>
      <a href="">
        {errorCopy.tryAgain.es}
        <span lang="en">{errorCopy.tryAgain.en}</span>
      </a>
    </main>
  );
}
```

Root layouts: `src/app/admin/layout.tsx` becomes

```tsx
import type { ReactNode } from "react";
import { adminMetadata } from "@/shared/presentation/metadata";

export const metadata = adminMetadata;

/** The staff root layout; the renderer has its own (src/app/f/[slug]/layout.tsx). */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
```

`src/app/(home)/layout.tsx` is the same `<html lang="en"><body>` wrapper with `metadata = { title: "Effluz Forms" }` (the old root layout's content), `git mv src/app/page.tsx "src/app/(home)/page.tsx"`, and `git rm src/app/layout.tsx`. Search for imports of `@/app/layout` (there are none today) and for tests that render the old root layout.

- [ ] **Step 4: Run** `pnpm test && pnpm lint && pnpm typecheck && pnpm format:check && pnpm build`. The first manual run in a browser needs a published form, which the e2e helper of Task 29 creates; it is part of Task 30, Step 3.
- [ ] **Step 5: Commit** `feat(app): public form routes, root layouts per surface, the in-progress cookie and the renderer CSP`

---

### Task 29: End to end without script: the reference form, failure paths, and the budgets

**Files:**
- Create: `tests/support/test-database.ts`, `vitest.e2e.config.ts`, `tests/e2e/setup.ts`, `tests/e2e/vitest.d.ts`, `tests/e2e/http.ts`, `tests/e2e/publish.ts`, `tests/e2e/reference-form.test.ts`, `tests/e2e/budgets.test.ts`
- Modify: `tests/integration/setup.ts` (uses `createTestDatabase`), `package.json` (`test:e2e`), `.github/workflows/ci.yml` (job `e2e`), `specs/system/ci-cd.md` ("As built")

**Interfaces:**
- Consumes: the built app (`pnpm build`), every route of Task 28, the definitions use cases, `referenceFormDraft` (`tests/fixtures/reference-form.ts`), `syntheticJpegWithGps`, `syntheticMp4` (Task 5).
- Produces:

```ts
// tests/support/test-database.ts
export async function createTestDatabase(): Promise<{ url: string; drop(): Promise<void> }>;
// tests/e2e/http.ts
export class Visitor {
  constructor(base: string, headers?: Record<string, string>);
  get(path: string): Promise<{ status: number; html: string; location: string | null }>;
  post(path: string, body: FormData): Promise<{ status: number; location: string | null }>;
  cookie(): string | null;                          // the effluz_fill value
}
export function hidden(html: string, name: string): string | null;
export function textOf(html: string): string;
// tests/e2e/publish.ts
export async function publishReferenceForm(pool: Pool, over?: Partial<FormSettings>): Promise<{ formId: string; slug: string; deps: DefinitionsDeps }>;
export function pageAnswers(pageKey: string): Record<string, string>;   // the reference submission's values for one page, as form fields
```

This suite talks HTTP to `next start` exactly as a browser with script disabled does: multipart posts of the page forms, cookies, 303s. A browser run with script on a phone viewport (renderer.md, "Test fixtures") needs a browser runner, a new dependency this plan does not add; it is listed as a follow-up in the PR.

Decision (e2e files): the reference form allows ten files; the test first posts ten images and one video together, which is refused with `files_max` and stages nothing, then nine images and the video, which go through.

- [ ] **Step 1: Shared database helper.** Move the database creation and drop from `tests/integration/setup.ts` into `tests/support/test-database.ts`:

```ts
import { randomBytes } from "node:crypto";
import pg from "pg";
import { loadMigrations, MIGRATION_DIRS, migrate } from "@/shared/infrastructure/postgres/migrate";
import { createPool } from "@/shared/infrastructure/postgres/pool";

const DEFAULT_ADMIN_URL = "postgres://effluz:effluz@127.0.0.1:5432/postgres";

/** A throwaway, fully migrated database; see specs/system/database.md, "Local development". */
export async function createTestDatabase(): Promise<{ url: string; drop(): Promise<void> }> {
  const adminUrl = process.env["TEST_DATABASE_ADMIN_URL"] ?? DEFAULT_ADMIN_URL;
  const name = `effluz_test_${randomBytes(4).toString("hex")}`;
  const admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
  await admin.query(`create database ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const drop = async () => {
    try {
      await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()", [name]);
      await admin.query(`drop database if exists ${name}`);
    } finally {
      await admin.end();
    }
  };
  try {
    const pool = createPool(url.toString(), { max: 1, statementTimeoutMs: 0 });
    try {
      await migrate(pool, loadMigrations(MIGRATION_DIRS));
    } finally {
      await pool.end();
    }
  } catch (e) {
    await drop();
    throw e;
  }
  return { url: url.toString(), drop };
}
```

and reduce `tests/integration/setup.ts` to:

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

Run `pnpm test:integration` once to confirm nothing changed.

- [ ] **Step 2: The harness.** `vitest.e2e.config.ts`:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

// End-to-end tests against the built app (`pnpm build` first). See specs/system/ci-cd.md.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/e2e/setup.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
```

`tests/e2e/vitest.d.ts`:

```ts
import "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    baseUrl: string;
    stagingDir: string;
  }
}
```

`tests/e2e/setup.ts`:

```ts
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";
import { createTestDatabase } from "../support/test-database";

const PORT = 3199;

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      await res.body?.cancel();
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`server did not answer at ${url}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

/** A throwaway database, temporary media directories, and `next start` against them. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const db = await createTestDatabase();
  const root = await mkdtemp(path.join(os.tmpdir(), "effluz-e2e-"));
  const baseUrl = `http://127.0.0.1:${String(PORT)}`;
  const stagingDir = path.join(root, "staging");
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      SERVICE: "app",
      PUBLIC_BASE_URL: baseUrl,
      DATABASE_URL: db.url,
      STAGING_DIR: stagingDir,
      MEDIA_PROVIDER: "local",
      MEDIA_DURABLE_DIR: path.join(root, "durable"),
      EMAIL_PROVIDER: "mailpit",
      PRIVACY_CONTACT_EMAIL: "privacy@example.com",
      GOOGLE_CLIENT_ID: "e2e-client",
      GOOGLE_CLIENT_SECRET: "e2e-secret",
      GOOGLE_ALLOWED_HOSTED_DOMAIN: "effluz.com",
      NOTIFICATION_ALLOWED_DOMAINS: "example.com",
      LOG_LEVEL: "warn",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  await waitFor(`${baseUrl}/f/e2e-probe`, 60_000);
  project.provide("databaseUrl", db.url);
  project.provide("baseUrl", baseUrl);
  project.provide("stagingDir", stagingDir);
  return async () => {
    server.kill("SIGTERM");
    await once(server, "exit");
    await db.drop();
    await rm(root, { recursive: true, force: true });
  };
}
```

`tests/e2e/http.ts`:

```ts
/** A browser without script: forms, cookies and redirects, by hand. Synthetic data only. */
export class Visitor {
  private fill: string | null = null;

  constructor(
    private readonly base: string,
    private readonly headers: Record<string, string> = { "accept-language": "es-PA,es;q=0.9" },
  ) {}

  cookie(): string | null {
    return this.fill;
  }

  private remember(res: Response): void {
    for (const c of res.headers.getSetCookie()) {
      const [pair = ""] = c.split(";");
      const [name, value = ""] = pair.split("=");
      if (name === "effluz_fill") this.fill = value === "" ? null : value;
    }
  }

  private cookieHeader(): Record<string, string> {
    return this.fill === null ? {} : { cookie: `effluz_fill=${this.fill}` };
  }

  async get(path: string): Promise<{ status: number; html: string; location: string | null }> {
    const res = await fetch(`${this.base}${path}`, { headers: { ...this.headers, ...this.cookieHeader() }, redirect: "manual" });
    this.remember(res);
    return { status: res.status, html: await res.text(), location: res.headers.get("location") };
  }

  async post(path: string, body: FormData): Promise<{ status: number; location: string | null }> {
    const res = await fetch(`${this.base}${path}`, { method: "POST", body, headers: { ...this.headers, ...this.cookieHeader() }, redirect: "manual" });
    this.remember(res);
    await res.body?.cancel();
    return { status: res.status, location: res.headers.get("location") };
  }
}

export function hidden(html: string, name: string): string | null {
  return new RegExp(`<input type="hidden" name="${name}" value="([^"]*)"`).exec(html)?.[1] ?? null;
}

export function textOf(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
}
```

`tests/e2e/publish.ts`:

```ts
import type { Pool } from "pg";
import { createForm, publishForm, updateSettings, type FormSettings } from "@/modules/definitions/application";
import type { DefinitionsDeps } from "@/modules/definitions/application/deps";
import { PgDraftRepository } from "@/modules/definitions/infrastructure/pg-draft-repository";
import { PgFormRepository } from "@/modules/definitions/infrastructure/pg-form-repository";
import { PgVersionRepository } from "@/modules/definitions/infrastructure/pg-version-repository";
import { PgAuditLog } from "@/modules/identity/infrastructure/pg-audit-log";
import { PgAuditLogReader } from "@/modules/identity/infrastructure/pg-audit-log-reader";
import { PgSubmissionStats } from "@/modules/submissions/infrastructure/pg-submission-stats";
import { buildDefaultRegistry, parseDraft } from "@/shared/domain/form-model";
import { systemClock } from "@/shared/infrastructure/clock";
import { systemIdGenerator } from "@/shared/infrastructure/id-generator";
import { PgUnitOfWorkFactory } from "@/shared/infrastructure/postgres/unit-of-work";
import { referenceFormDraft, referenceSubmission } from "../fixtures/reference-form";

const editor = { email: "editor@example.com", ip: "203.0.113.7" };

/** Builds the reference form from its fixture document and publishes it through the use cases. */
export async function publishReferenceForm(
  pool: Pool,
  over: Partial<FormSettings> = {},
): Promise<{ formId: string; slug: string; deps: DefinitionsDeps }> {
  const registry = buildDefaultRegistry();
  const deps: DefinitionsDeps = {
    forms: new PgFormRepository(pool), drafts: new PgDraftRepository(pool), versions: new PgVersionRepository(pool),
    stats: new PgSubmissionStats(pool), audit: new PgAuditLog(), auditReader: new PgAuditLogReader(pool),
    uow: new PgUnitOfWorkFactory(pool), clock: systemClock, ids: systemIdGenerator, registry,
    allowedRecipientDomains: ["effluz.com", "example.com"], publicBaseUrl: "http://127.0.0.1:3199",
  };
  const slug = `historia-prematuro-${Math.random().toString(36).slice(2, 8)}`;
  const created = await createForm(deps, editor, { title: { es: "Historias" }, languages: "es", slug });
  if (!created.ok) throw new Error(created.code);
  const draft = await deps.drafts.find(created.formId);
  const parsed = parseDraft(referenceFormDraft, registry);
  if (!draft || !parsed.ok) throw new Error("fixture");
  await deps.uow.run((uow) => deps.drafts.save(uow, { ...draft, document: parsed.version }, draft.revision));
  const form = await deps.forms.findById(created.formId);
  if (!form) throw new Error("form");
  const settings = await updateSettings(deps, editor, {
    formId: form.id,
    settings: {
      ...form.settings,
      referencePrefix: "HP",
      retentionMonths: 12,
      notificationRecipients: ["staff-group@example.com"],
      notificationCadence: "per_submission",
      closesAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      ...over,
    },
  });
  if (!settings.ok) throw new Error(settings.code);
  const published = await publishForm(deps, editor, { formId: form.id, expectedNumber: 1 });
  if (!published.ok) throw new Error(published.code);
  return { formId: form.id, slug, deps };
}

/** The reference submission's values for one page, as the page form posts them. */
export function pageAnswers(pageKey: string): Record<string, string> {
  const page = referenceFormDraft.pages.find((p) => p.key === pageKey);
  const out: Record<string, string> = {};
  for (const field of page?.fields ?? []) {
    const value = referenceSubmission[field.key];
    if (typeof value === "string") out[field.key] = value;
    if (field.type === "consent") out[field.key] = "accepted";
  }
  return out;
}
```

- [ ] **Step 3: Failing e2e tests.** `tests/e2e/reference-form.test.ts`:

```ts
import { readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import sharp from "sharp";
import { afterAll, describe, expect, inject, it } from "vitest";
import { applyLifecycle } from "@/modules/definitions/application";
import { syntheticJpegWithGps, syntheticMp4 } from "../fakes/media-files";
import { hidden, textOf, Visitor } from "./http";
import { pageAnswers, publishReferenceForm } from "./publish";

const pool = new pg.Pool({ connectionString: inject("databaseUrl"), max: 2 });
afterAll(() => pool.end());
const base = inject("baseUrl");
const staging = inject("stagingDir");

const count = async (sql: string, args: unknown[] = []) => (await pool.query<{ n: number }>(sql, args)).rows[0]?.n ?? 0;
const form = (fields: Record<string, string>, files: File[] = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  for (const file of files) f.append("photos", file);
  return f;
};

/** GETs page 1, then posts pages 1 to 4; returns the visitor on page 5 and the time page 1 rendered. */
async function fillToPhotos(slug: string): Promise<{ v: Visitor; renderedAt: number }> {
  const v = new Visitor(base);
  const first = await v.get(`/f/${slug}`);
  expect(first.status).toBe(200);
  expect(textOf(first.html)).toContain("Historias");
  const renderedAt = Date.now();
  const rendered = hidden(first.html, "_rendered") ?? "";
  for (const [i, page] of ["page1", "page2", "page3", "page4"].entries()) {
    const fields = { _page: page, _action: "next", "website-url": "", ...pageAnswers(page), ...(i === 0 ? { _rendered: rendered } : {}) };
    const res = await v.post(`/f/${slug}/answers`, form(fields));
    expect(res.status, page).toBe(303);
    expect(res.location, page).toBe(`/f/${slug}`);
  }
  const fifth = await v.get(`/f/${slug}`);
  expect(textOf(fifth.html)).toContain("Página 5 de 5");
  return { v, renderedAt };
}

async function photos(n: number): Promise<File[]> {
  return Promise.all(Array.from({ length: n }, async (_, i) => new File([await syntheticJpegWithGps(64 + i, 48)], `IMG_${String(i)}.jpg`, { type: "image/jpeg" })));
}
const video = () => new File([syntheticMp4()], "mensaje.mp4", { type: "video/mp4" });

async function waitForMinimumTime(renderedAt: number): Promise<void> {
  const left = 3_200 - (Date.now() - renderedAt);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
}

describe("the reference form without script", () => {
  it("is completed with nine photos and a video, and stored with its media rows and jobs", async () => {
    const { slug, formId } = await publishReferenceForm(pool);
    const { v, renderedAt } = await fillToPhotos(slug);
    const page5 = await v.get(`/f/${slug}`);
    const token = hidden(page5.html, "_token") ?? "";

    const tooMany = await v.post(`/f/${slug}/answers`, form({ _page: "page5", _action: "submit", _token: token, ...pageAnswers("page5") }, [...(await photos(10)), video()]));
    expect(tooMany.status).toBe(303);
    const refused = await v.get(`/f/${slug}`);
    expect(textOf(refused.html)).toContain("Puedes subir hasta 10 archivos en Sube hasta 10 fotos sin editar del bebé");
    expect(textOf(refused.html)).toContain("Corrige 1 problema para continuar");
    expect(await count("select count(*)::int as n from submission where form_id = $1", [formId])).toBe(0);
    expect((await readdir(staging, { recursive: true }).catch(() => [])).filter((f) => String(f).includes("."))).toHaveLength(0);

    await waitForMinimumTime(renderedAt);
    const sent = await v.post(`/f/${slug}/answers`, form({ _page: "page5", _action: "submit", _token: token, "website-url": "", ...pageAnswers("page5") }, [...(await photos(9)), video()]));
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
      const meta = await sharp(path.join(staging, row.staging_ref)).metadata();
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

  it("shows the error summary and keeps what was typed when a page is invalid", async () => {
    const { slug } = await publishReferenceForm(pool);
    const v = new Visitor(base);
    const first = await v.get(`/f/${slug}`);
    await v.post(`/f/${slug}/answers`, form({ _page: "page1", _action: "next", _rendered: hidden(first.html, "_rendered") ?? "", ...pageAnswers("page1"), adult_name: "", email: "no-es-un-correo" }));
    const again = await v.get(`/f/${slug}`);
    const text = textOf(again.html);
    expect(text).toContain("Corrige 2 problemas para continuar");
    expect(text).toContain("Nombre y apellido completo del adulto responsable es obligatorio");
    expect(text).toContain("Escribe un correo válido, como nombre@ejemplo.com");
    expect(again.html).toContain('value="no-es-un-correo"');
  });

  it("refuses a submission once the form is closed, even from a tab opened before", async () => {
    const { slug, formId, deps } = await publishReferenceForm(pool);
    const { v, renderedAt } = await fillToPhotos(slug);
    const token = hidden((await v.get(`/f/${slug}`)).html, "_token") ?? "";
    expect((await applyLifecycle(deps, { email: "editor@example.com", ip: "203.0.113.7" }, { formId, action: "close" })).ok).toBe(true);
    await waitForMinimumTime(renderedAt);
    await v.post(`/f/${slug}/answers`, form({ _page: "page5", _action: "submit", _token: token, ...pageAnswers("page5") }, await photos(1)));
    expect(textOf((await v.get(`/f/${slug}`)).html)).toContain("Este formulario está cerrado");
    expect(await count("select count(*)::int as n from submission where form_id = $1", [formId])).toBe(0);
  });

  it("answers a repeated Submit with the same confirmation and one submission", async () => {
    const { slug, formId } = await publishReferenceForm(pool);
    const { v, renderedAt } = await fillToPhotos(slug);
    const token = hidden((await v.get(`/f/${slug}`)).html, "_token") ?? "";
    await waitForMinimumTime(renderedAt);
    const fields = { _page: "page5", _action: "submit", _token: token, ...pageAnswers("page5") };
    const [a, b] = await Promise.all([v.post(`/f/${slug}/answers`, form(fields, await photos(1))), v.post(`/f/${slug}/answers`, form(fields, await photos(1)))]);
    expect([a.status, b.status]).toEqual([303, 303]);
    expect(await count("select count(*)::int as n from submission where form_id = $1", [formId])).toBe(1);
    expect(textOf((await v.get(`/f/${slug}`)).html)).toContain("HP-0001");
  });

  it("silently accepts a filled honeypot: the confirmation, and nothing stored", async () => {
    const { slug, formId } = await publishReferenceForm(pool);
    const { v, renderedAt } = await fillToPhotos(slug);
    const token = hidden((await v.get(`/f/${slug}`)).html, "_token") ?? "";
    await waitForMinimumTime(renderedAt);
    await v.post(`/f/${slug}/answers`, form({ _page: "page5", _action: "submit", _token: token, "website-url": "https://spam.example", ...pageAnswers("page5") }, await photos(2)));
    const shown = textOf((await v.get(`/f/${slug}`)).html);
    expect(shown).toMatch(/Tu referencia: HP-\d{4}/);
    expect(await count("select count(*)::int as n from submission where form_id = $1", [formId])).toBe(0);
    expect(await count("select count(*)::int as n from media where form_id = $1", [formId])).toBe(0);
    expect(await count("select count(*)::int as n from submission_in_progress where form_id = $1", [formId])).toBe(0);
  });

  it("answers an unknown form with 404 and the not found screen", async () => {
    const v = new Visitor(base);
    const missing = await v.get("/f/no-such-form");
    expect(missing.status).toBe(404);
    expect(textOf(missing.html)).toContain("No encontramos este formulario");
  });
});
```

(Each test publishes its own form under a random slug, so tests never share references or records. The staging directory check in the first test counts files of every record; it runs first in the file, so the directory is empty before it.)

`tests/e2e/budgets.test.ts`:

```ts
import { gzipSync } from "node:zlib";
import pg from "pg";
import { afterAll, describe, expect, inject, it } from "vitest";
import { hidden, Visitor } from "./http";
import { pageAnswers, publishReferenceForm } from "./publish";

const pool = new pg.Pool({ connectionString: inject("databaseUrl"), max: 2 });
afterAll(() => pool.end());
const base = inject("baseUrl");
const KB = 1024;

function scriptUrls(html: string): string[] {
  const urls = new Set<string>();
  for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) if (m[1]) urls.add(m[1]);
  for (const m of html.matchAll(/<link[^>]*rel="(?:preload|modulepreload)"[^>]*as="script"[^>]*href="([^"]+)"|<link[^>]*href="([^"]+)"[^>]*as="script"/g)) {
    const u = m[1] ?? m[2];
    if (u) urls.add(u);
  }
  return [...urls];
}

describe("renderer budgets (renderer.md, Performance targets)", () => {
  it("keeps every page's HTML under 30 KB and its scripts under 150 KB, compressed", async () => {
    const { slug } = await publishReferenceForm(pool);
    const v = new Visitor(base);
    const first = await v.get(`/f/${slug}`);
    const pages = [first.html];
    await v.post(`/f/${slug}/answers`, (() => {
      const f = new FormData();
      for (const [k, val] of Object.entries({ _page: "page1", _action: "next", _rendered: hidden(first.html, "_rendered") ?? "", ...pageAnswers("page1") })) f.append(k, val);
      return f;
    })());
    for (const page of ["page2", "page3", "page4"]) {
      pages.push((await v.get(`/f/${slug}`)).html);
      const f = new FormData();
      for (const [k, val] of Object.entries({ _page: page, _action: "next", ...pageAnswers(page) })) f.append(k, val);
      await v.post(`/f/${slug}/answers`, f);
    }
    pages.push((await v.get(`/f/${slug}`)).html);
    for (const [i, html] of pages.entries()) expect(gzipSync(html).length, `page ${String(i + 1)}`).toBeLessThan(30 * KB);

    const urls = scriptUrls(first.html);
    expect(urls.length).toBeGreaterThan(0);
    let total = 0;
    for (const url of urls) {
      const res = await fetch(new URL(url, base));
      total += gzipSync(Buffer.from(await res.arrayBuffer())).length;
    }
    expect(total).toBeLessThan(150 * KB);
  });

  it("renders page 1 in under 200 ms at the 95th percentile", async () => {
    const { slug } = await publishReferenceForm(pool);
    const time = async () => {
      const start = performance.now();
      const res = await fetch(`${base}/f/${slug}`);
      await res.text();
      return performance.now() - start;
    };
    for (let i = 0; i < 5; i++) await time();
    const samples: number[] = [];
    for (let i = 0; i < 40; i++) samples.push(await time());
    samples.sort((a, b) => a - b);
    expect(samples[Math.floor(samples.length * 0.95) - 1]).toBeLessThan(200);
  });
});
```

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

and add `e2e` to the `ci` job's `needs` and its result loop. In `specs/system/ci-cd.md`, "As built", replace "and `e2e` with the renderer plan" with: "`e2e` builds the app, starts it with `next start` against a throwaway database and temporary media directories, and drives the reference form over HTTP exactly as a browser without script does, plus the budgets of `ui-ux/renderer.md`. The browser run with script waits for the browser-runner decision."

- [ ] **Step 6: Run** `pnpm test:e2e` until green, then `pnpm test && pnpm test:integration && pnpm lint && pnpm typecheck && pnpm format:check` (at most three of these at once).
- [ ] **Step 7: Commit** `test(app): end-to-end reference form without script, failure paths and renderer budgets in CI`

---

### Task 30: Full verification, spec sync and the pull request

**Files:**
- Modify: `README.md` (one line: the public forms live at `/f/<slug>`), any spec section whose wording no longer matches the code as built

- [ ] **Step 1: Verify everything**, no more than three heavy commands at once: `pnpm db:up`, then `pnpm test && pnpm lint && pnpm typecheck`, then `pnpm test:integration && pnpm format:check`, then `pnpm build && pnpm test:e2e`. All must pass.
- [ ] **Step 2: Spec sync.** Read, against the code: `specs/architecture.md` (Ports rows, data flow step 2, technology row), `specs/system/database.md` (the four new or changed tables, column names as migrated), `specs/system/jobs.md` (registered handlers, `PermanentJobError`, `maxAttempts`, cleanup steps), `specs/system/media-storage.md`, `specs/system/email.md`, `specs/system/security.md` (honeypot name, 3 seconds, cookie, CSP), `specs/ui-ux/renderer.md` (routes, budget, copy rows), `specs/ui-ux/manager.md` (Settings note), ADRs 0002, 0016, 0023. Fix any drift in the same branch with a `docs:` commit.
- [ ] **Step 3: Manual checks recorded for the PR.** Publish the reference form into the dev database and print its slug:

  ```bash
  pnpm db:up && pnpm exec tsx --env-file=.env src/app/cli/migrate.ts
  pnpm exec tsx --env-file=.env -e 'import pg from "pg"; import { publishReferenceForm } from "./tests/e2e/publish"; const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL }); publishReferenceForm(pool).then((r) => { console.log(r.slug); return pool.end(); });'
  ```

  With `pnpm dev` and `pnpm exec tsx --env-file=.env src/app/worker.ts` running against Mailpit and local media, open `http://localhost:3000/f/<slug>` and fill the reference form on a phone-sized window with script on (early uploads, Remove, a refused file, the offline banner by toggling the network, Submit) and with script off; keyboard only; VoiceOver or NVDA on one page with an error; 400% zoom; reduced motion; DevTools with the "Slow 3G" profile, page 1 interactive under 3 seconds. Watch the worker move the files to `MEDIA_DURABLE_DIR` and the staff notification arrive in Mailpit (http://127.0.0.1:8025) with no answers in it. Note results, not screenshots of real data.
- [ ] **Step 4: Push and open the PR** against `main`, titled `feat: public renderer, submission intake, media and email jobs`, with a body that links the spec sections implemented (architecture.md "Submission data flow" 1 to 5, use-cases/fill-and-submit-form.md, ui-ux/renderer.md, system/media-storage.md, jobs.md, email.md, security.md "Public form abuse protection"), ADR 0023 and the ADR 0002 and 0016 amendments, the decisions list at the top of this plan, the spec additions that need review (the fifteen chrome rows, six singular catalog rows, the staff notification table, `set.challenge_unavailable`), the open questions (consent text plain in form-definition.md and markdown in builder.md; the privacy footer left off the not-found screen), and what is deliberately absent: review, Operations and Audit pages, `email.staff_digest`, `retention.purge`, `backup.database`, the builder and header images, DeepL, the bot challenge, the proxy rate limit on form routes (deployment plan), and the browser e2e run with script. End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] **Step 5: Confirm** the seven CI jobs pass. The controller merges.

---

## Self-review notes

- **Spec coverage.** architecture.md "Submission data flow": step 1 (Tasks 14, 18, 28), step 2 (Tasks 4, 7, 16, 19, 20), step 3 (Tasks 6, 11, 14, 21), step 4 (Tasks 21, 28), step 5 (Tasks 10, 11, 13, 27). use-cases/fill-and-submit-form.md: main flow 1 to 8 (Tasks 18 to 21, 24 to 28); every alternate flow: not found, archived, outside the window or closed (Tasks 14, 18, 25), session expired with cleanup (Tasks 16, 21, 22), a changed earlier answer (Task 21), republished mid-fill (Tasks 18, 21), upload failures (Tasks 7, 19, 20, 26), honeypot and minimum time (Tasks 16, 21, 29), duplicate submit (Tasks 18, 21, 22, 29); success criteria: ten files over a slow connection without losing progress (Tasks 19, 20, 29), every rule's message localized and announced (Tasks 23, 24), a closed form refusing an open tab (Tasks 22, 29), no orphans on intake failure (Task 22). ui-ux/renderer.md: layout, screens, field rendering table, file upload, validation and the message catalog, navigation and state, accessibility notes, performance targets, fixed chrome copy, confirmation email fixed parts (Tasks 12, 23 to 26, 29). media-storage.md: the port, both adapters, keys, file handling rules, lifecycle (Tasks 5 to 10). jobs.md: the four handlers, idempotency, permanent failure, cleanup (Tasks 2, 10, 11, 21, 27). email.md: ports, templates, provider, local development (Tasks 11 to 13). security.md: abuse protection layers 2 to 5, staff-authored content, CSP (Tasks 3, 16, 28). database.md: four tables and the counter (Tasks 8, 13, 14, 17). manager.md Settings note (Task 15). Not covered, by decision: review, staff digest, purge, backup, builder, header images, bot challenge, browser e2e with script.
- **Placeholder scan.** No "TBD" or "similar to"; every code step carries its code. Two choices are left to the implementer on purpose, each with the rule that decides it: a Prettier layout pass on the CSS (Task 25) and fixing e2e gaps in the owning task (Task 29).
- **Type consistency.** `StagedFile` (media) and `StagedUpload` (submissions domain) are structural twins by design; `attachToSubmission` takes `StagedUpload` values as `StagedFile`. `FillState`, `PostOutcome`, `PagePost`, `OpenContext` are defined in Task 18 and used unchanged in Tasks 19 to 21 and 28. `UploadRefusal` (Task 20) feeds `uploadRefusalMessage` (Task 23). `EmailRenderer` (Task 11) is satisfied by `emailTemplates` (Task 12), checked in Task 27. `MEDIA_JOB_TYPES` and `EMAIL_JOB_TYPES` name the job types in Tasks 6, 10, 11, 21, 27.
- **Review Focus tests pinned:** 1 in Task 21 ("completes against the pinned version after a republish"); 2 in Task 21 ("discards answers and files of a page hidden by a changed answer"); 3 in Task 22 ("refuses a submission when the form closes during the intake"); 4 in Task 7 (sniffer and encoder refusals) and Task 22 ("refuses a lying, truncated or oversized file and stages nothing"); 5 in Task 21 ("treats an expired record as expired at submit") and Task 22 ("jobs.cleanup removes expired records and their staged files").
- **Known coupling to revisit.** The renderer's root layout and page share one `viewForm` through React's `cache`; if Next changes how layouts and pages share a request, the layout's `lang` read is the one to re-check. The blur check is a server round trip per field; at Effluz's scale that is cheap, and it keeps the client bundle free of the rules.
