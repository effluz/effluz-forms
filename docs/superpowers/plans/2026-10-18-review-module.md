# Review Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner opens one story page per submission (answers, photos, manual corrections, staff-added photos, photo choice, readiness checks, planned date, publishing), one Post plan page that shows what goes out this week and what is missing, and one minimal Operations page; dead jobs email her, flag the story and offer "Try again"; submissions export to CSV and delete with typed confirmation.

**Architecture:** A new `review` module (four layers) owns the story state (`story`, `staff_photo`, `submission_edit` tables, migration `0010_review.sql`), the rules for curation, readiness and the one-story-per-day plan, and a read model that lists, plans and exports in one query each. It reaches the submission row only through new `submissions` use cases (`findSubmissionByReference`, `lockSubmission`, `writeCuration`, `deleteSubmission`), files only through `media` use cases (staging, `attachToSubmission`, `openMedia`, `enqueueMediaDelete`), forms and versions through `definitions`, and audit through `identity`. Staff photos are ordinary `media` rows under the reserved field key `staff-photos`, so upload, delete and retention treat them like the sender's files. Dead jobs raise a grouped `email.job_alert` job inside the job store's dead transition (shared, module-agnostic: the type is injected); `notifications` sends it through an `AlertSource` port that `review` implements (new edge `review -> notifications`, ADR 0029). Pages are server components under `src/app/admin/(gated)/`; every change is a route handler that answers 303 (Post/Redirect/Get), so all of it works without JavaScript.

**Tech Stack:** Next.js 16.4 (App Router, route handlers, server components, Cache Components on), React 19, TypeScript strict, Zod 4, `pg` with hand-written SQL, Vitest, Playwright (Chromium), `sharp` (thumbnails), Node 24 `zlib.crc32` for the ZIP writer. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-18-review-module-design.md` (binding; where it departs from the specs below it wins and Tasks 1 and 2 change the specs), `specs/use-cases/review-submissions.md`, `curate-submission.md`, `operate-jobs.md`, `manage-form-settings.md`, `specs/ui-ux/manager.md` ("Routes", "Submissions tab", "Operations page", "Fixed chrome copy"), `specs/form-definition.md` ("Operational settings", "Submissions", "Consent text"), `specs/system/media-storage.md`, `jobs.md`, `email.md`, `observability.md`, `database.md`, `security.md` ("Audit log"), `deployment.md` ("Reverse proxy"), `specs/architecture.md` ("Modules", "Ports"), `design-system/components.md`, ADRs 0011, 0016, 0022 to 0027.

Decided with the owner (design document, 2026-10-18): one-person use; staff can attach photos received later, after ticking "The sender sent these for this story"; "ready" means photos chosen, photos edited in Canva (a tick), text checked; correction is manual (no `TextCorrector` adapter, no "Suggest correction" button); failures email one address, warn on the story page, flag the list; bulk data leaves as CSV; the story page is a full page that replaces the drawer for every form; the post plan covers forms with "Use submissions in the post plan" on; the tenth consent item; a minimal Operations page; no Audit page.

Decided in this plan where the design leaves the choice to the builder (each is applied, with its test, in the task named):

- **Routes.** Story page `GET /admin/forms/[id]/submissions/[reference]`; changes are POST route handlers beside it (`correction`, `revert`, `status`, `photos`, `photos/remove`, `choice`, `check`, `plan`, `retry`, `delete`); media `GET .../media/[mediaId]?view=thumb|full|download`; one ZIP route `GET .../photos.zip?set=all|chosen`; export `POST /admin/forms/[id]/export`; `GET /admin/plan`; `GET /admin/operations` with `POST /admin/operations/retry|discard|retry-type`; `GET /admin/media/local/[key]` for local durable video. (Tasks 2, 25)
- **Tables and columns.** `story` (keyed by `submission_id`), `staff_photo` (keyed by the media id), `submission_edit` (append-only), all owned by `review`, all `on delete cascade` from `submission`. No new column on any other table. (Task 12)
- **Audit names.** `reviewAuditActions` in Task 11, details in Task 1's `security.md` table. Every target is the submission id, except jobs (the job id) and `post_plan_viewed` (no target).
- **List filters.** Status chips as today; a second chip group "Post plan" with Planned, Waiting for a date and Not ready, shown only on post-plan forms; `from` and `to` dates; version; with files; search over `short_text` and `email` answers and the reference. Query keys `status`, `plan`, `from`, `to`, `version`, `media`, `q`, `page`. (Tasks 11, 13, 21)
- **Week view.** Weeks run Monday to Sunday in `America/Panama` for every form (`PLAN_TIME_ZONE`); `?week=` takes any date and shows its week; today is marked with the word "Today"; past empty days say "Nothing planned", today and later empty days offer "Pick a story"; any valid date can be planned, past ones included, so the owner can backfill. (Tasks 11, 17, 24)
- **Thumbnails and viewer.** 320 px WebP on the longer side, generated per request from the stored file, `Cache-Control: private, max-age=3600`, not audited; tiles are 160 px (new token `size.photoTile`); the full-size viewer is an in-page section (`?photo=<mediaId>`) with Previous, Next, Download, the Dropbox path and "Views and downloads are recorded". Videos have no thumbnail: a tile with the words "Video n of total". (Tasks 2, 8, 23)
- **Media delivery.** Photos (full and download) and thumbnails stream through the app from the staging copy or the durable file (`MediaStorage.openRead`); a full view of a stored video redirects (302) to `viewUrl` (the Dropbox temporary link, four hours), as `media-storage.md` asks the app not to proxy video. (Tasks 8, 18)
- **ZIP.** Stored entries (no compression; photos are compressed already), written by the module's own `StoredZipWriter` with `zlib.crc32`. Names `<form slug>-<reference>.zip` and `<form slug>-<reference>-chosen.zip`; entries `<reference>/<file name of the durable key>`. (Task 18)
- **Retry.** Retry sets a dead job to `pending`, `attempts` 0, `run_at` now, clears the lock, `finished_at` and `unique_key` (so a retried recurring or alert job never collides with a pending twin); `last_error` stays for history. "Try again" on the story page retries every dead job of that story. Discard takes a reason of 1 to 200 characters, stored on the job row only. (Tasks 5, 19)
- **Heartbeat words.** OK at 60 seconds or less, Warning up to `HEARTBEAT_STALE_SECONDS` (300), Critical above that or when no worker ever wrote one. (Task 19)
- **Staff photo limits.** At most 10 files per upload and 30 staff photos per story, 10 MB per file, images and videos, the public content checks. The new upload route gets a 102 MB body limit at the reverse proxy. (Tasks 1, 16)
- **Story page scope.** No "Export this one" (searching the list by reference and exporting does it) and no full jobs list (only dead jobs matter, in the warning). Filter chips are links; the active one carries `aria-current="true"` and a check mark, since `aria-pressed` needs a button. (Tasks 2, 21, 22)
- **Corrections.** Saving text identical to the original stores no correction and still ticks "Text checked". Refusals rely on the textarea's `required` and `maxlength` (the field's limit), so a refused save, which only a tampered or script-free edge case reaches, returns without the typed text. Last save wins without a message. (Tasks 15, 22)
- **Unmark clears the post link**; re-marking as published replaces it. (Task 15)
- **Planning conflicts.** A per-day advisory lock and a partial unique index (`story_plan_slot_key`) hold the one-story-per-day rule; a swap moves this story off its day first so the index never sees two holders. When this story has no date, the only offer is "Move <ref> to Waiting for a date". (Tasks 11, 12, 17)

Planner's calls (the design or the code made something impossible as written; each closest workable answer, with its reason):

- **Curation is written through `submissions`.** `status`, `curated_answers`, `published_post_url` and the `status_changed_*` columns already sit on `submission`, owned by `submissions`, and repositories belong to the aggregate's owner (`architecture.md`). `review` decides the rules and calls the new exported use cases `lockSubmission` and `writeCuration`, the way `submissions` calls `allocateReference`. (Task 9)
- **The review read model reads other owners' tables.** "Planned" and "Not ready" filter on `story`, the dead-job flag on `job`, the media count on `media`, all paged over `submission` under the 500 ms budget; no single owner can answer that. `PgReviewQueries` reads (never writes) `submission`, `media` and `job` in SQL; ADR 0028 records the trade-off. Single-story reads still go through the owners' use cases. (Task 13)
- **`retention.purge` does not exist yet.** The design says staff photos go "by its retention purge"; no purge job is built (it is not in the design's goals). Staff photos are `media` rows with the story's `submission_id`, review's tables cascade from `submission`, and `deleteSubmission` (Task 9) enqueues `media.delete` for every media row; the future purge calls that use case. A test pins that `listSubmissionMedia` returns staff photos. (Tasks 8, 9)
- **"Unmarking keeps the date" against "one story per day".** While a story is published its day stops binding, so another unpublished story may take it. Unmarking then keeps the date only when the day is still free; otherwise the story moves to "Waiting for a date" and the page names the story that holds the day. A story published without a planned date returns to Waiting. (Tasks 11, 15)
- **Staff photos are gated on the form's current version.** The design ties the notice to the current version lacking the consent line, so staff photos are enabled when the form's current version covers `later_photos`, not the story's own (older) version. Flagged for the owner in the PR: a story received under an earlier version relies on her tick alone.
- **The two export rules disagree.** `form-definition.md` exports a `file_upload` answer as the count and the media ids; `review-submissions.md` says the Dropbox path. Field cells keep the form model's shape (one exporter per type, ADR 0016); "Include file paths" adds two columns, "File paths" (the sender's durable keys) and "Added photos" (staff photo keys). (Task 18)
- **CSV headers in "the reviewer's language".** There is no language preference yet; headers and choice labels use Spanish when the form has Spanish, else English. (Task 18)
- **`pub.unmark_body` cannot be bilingual.** `{status}` takes one value for both lines; it becomes `pub.unmark_viewed` and `pub.unmark_edited`, and every other row with a language-dependent placeholder is split the same way. (Task 2)
- **Admin pages cannot use `notFound()` either.** ADR 0027's measurement applies (a thrown not-found renders an empty document without script). New pages render their own not-found body (`st.not_found_*`) inside the shell; route handlers keep answering 303. (Tasks 22, 25)
- **`media-storage.md` promised the local view route "with the review plan".** It is built, but only as the target of a video redirect from local durable storage (`/admin/media/local/<key>`); photos and staging copies stream through the audited media route instead. (Tasks 8, 25)
- **`listBySubmission` reads outside the unit of work.** Delete and staff upload both run under the submission row lock and must see the same media rows, so the method takes an optional unit of work, as `findBySubmitToken` already does. (Task 8)
- **The post plan shows personal data.** Its rows carry each story's label (the first short answer, often a name), so opening it is audited as `post_plan_viewed`, like the list's `submissions_listed`. (Task 17)
- **Alert payloads are not `{ submissionId }`.** `jobs.md` says every `email.*` job carries the submission id; `email.job_alert` carries `{ jobType }` and `jobs.md` is amended. (Tasks 1, 6)

## Global Constraints

- WCAG 2.2 AA: "Accessibility baseline is **WCAG 2.2 AA**, non-negotiable, for the public renderer and the admin surfaces alike." "Fully keyboard-operable with a visible focus indicator." "Every input has a programmatic label. Errors are associated with their field and announced to assistive technology." "Color contrast meets AA. Information is never conveyed by color alone." "Respect reduced-motion preferences." (CLAUDE.md) The design adds: "the photo choice, the checks and the plan are fully keyboard-operable, and state is never shown by colour alone (the mockups pair every colour with a tick or words)."
- Both languages: "Fixed chrome of the builder, renderer and manager has no hardcoded user-facing strings. Its copy lives in the surface's UI/UX spec and is the single source for translations." (CLAUDE.md) "every string shows English with the Spanish line beneath it, marked `lang="es"`; identical text shows once." (manager.md, "Shell") Review chrome is bound in `src/modules/review/presentation/copy.ts`, shell, settings and audit labels in `src/shared/presentation/copy.ts`, each with a test against the spec rows. A placeholder whose value differs by language is never used; such rows are split per value.
- Immutable original: "`submission.answers` is immutable (database trigger). Curation, readiness, the planned date, chosen photos and staff photos live in separate columns or tables." "the sender's `answers` stay byte-identical." (design) "After any number of edits and reverts, the original is byte-identical to what was received" (curate-submission.md).
- Privacy: "Never use real submissions or real PII in tests, fixtures, seeds, logs, screenshots, examples, docs, or commit messages. Generate synthetic data." Addresses use `example.com`, IPs `203.0.113.x`, images are generated in code. "Logs and error messages must not contain answers, email addresses, file contents, or anything that identifies a submitter. Form and submission ids are fine." Anti-goal: "Story text, names or photos appear in an alert email, a log or an error." "Photos are sensitive. Validate type and size at the boundary, strip metadata, and store them only through the media port." (CLAUDE.md, design)
- Audit: "Every view of personal data is audited." "The list view counts as one entry per page load, not per row." Audit details are strings, numbers or booleans and "the write throws if any string contains `@`"; an entry joins the unit of work of the change it records. (review-submissions.md, security.md)
- Changes are route handlers that "answer a handled form post with a 303 (Post/Redirect/Get). A request without a session gets the sign-in redirect (302), a stale or missing token the `auth.stale_*` page (403), and a tampered body a bare 400." Each guards with `requireCsrf(request, <page to return to>)` from `src/app/admin/_lib/request.ts` (GET routes with `requireSession`), parses, calls one use case and maps the result with `seeOther` or `plain`. (manager.md, "Routes")
- Pages: "every page or layout that does so [reads the session] exports `instant = false`". Pages read the session through `pageSession` (`src/app/admin/_lib/page.ts`). New pages never call `notFound()` or throw for a missing story (ADR 0027 applies to admin pages): they render the not-found body themselves.
- Links in the manager are plain `<a href>`, never `next/link`: a prefetched story page would record a view and turn `new` into `viewed`.
- Framework boundary: "No React or Next.js import may appear in `domain/`, `application/`, or `infrastructure/`." Module edges are `MODULE_DEPS` in `eslint.config.mjs`; after Task 12: `review: ["definitions", "submissions", "media", "identity", "notifications"]`. Test files get ADR 0026's exception and nothing more.
- Migrations: "One global sequence." The next free id is `0010`; this plan adds `src/modules/review/infrastructure/migrations/0010_review.sql`, and `src/shared/infrastructure/postgres/migrations/0011_job_dead_idx.sql` only if Task 13's budget test needs it.
- Lock order: submission row (`lockSubmission`), then the story row, then day locks in ascending date order. "A use case opens at most one unit of work and never nests them." Staging writes happen before the unit of work; staged files are discarded if it fails.
- Visual values come from `design-system/tokens.json` only, each CSS value naming its token in a comment; components follow `design-system/components.md` (Task 2 adds what is missing).
- TypeScript strict with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`; `pnpm lint`, `pnpm typecheck`, `pnpm format:check` pass at every commit.
- Run at most three heavy processes (type checks, test suites, builds, the browser run) at once on the developer machine.
- Commits: Conventional Commits scoped `docs`, `form-model`, `definitions`, `shared`, `notifications`, `media`, `submissions`, `review`, `app`, `e2e`; every message ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (the commit steps below show the subject line only). Work on a feature branch cut from `main` (`feat/review-story-page-and-post-plan`); never commit to `main`.
- How tests are written here: listings omit import lines. A case list gives each test as its quoted name, inputs and expected results; write one `it` per case with exactly those names, inputs and expectations, through the helper the list names.

## Review Focus

1. Unmarking a published story whose day another unpublished story took meanwhile must not fail on the one-per-day index or leave two stories on one day: the story moves to "Waiting for a date" and the page names the other one (Task 15 unit test "unmark moves the story to waiting when its day was taken meanwhile", Task 12 integration test "refuses a second unpublished story on one day").
2. Removing a chosen staff photo after "Photos edited in Canva" was ticked must clear that check, since the chosen set changed, and must clear "Photos chosen" when it was the only chosen photo, in the list's "Not ready" filter as well as on the page (Task 16 unit test "removing a chosen staff photo unsets photos edited", Task 13 integration test "not_ready agrees with the domain readiness for every combination").
3. A story opened from a filtered list that no longer matches the filter (opening a `new` story under the "New" chip makes it `viewed`) must keep working Newer and Older links relative to its own position (Task 13 integration test "neighbours are found for a story outside the filter").
4. A text answer that begins with `=`, `+`, `-` or `@` must not run as a formula when the CSV opens in Google Sheets: the cell is prefixed with an apostrophe (Task 11 unit test "guards cells that a spreadsheet would read as a formula", Task 18 unit test "exports a formula-looking answer as text").
5. An `email.job_alert` job that itself goes dead (the email provider is down) must not raise another alert, and twenty uploads dying in one hour must produce one alert email, not twenty (Task 6 integration tests "an alert job going dead raises no alert" and "coalesces deaths of one type within the hour and schedules the next hour once").

---

## File structure

```
specs/...                                         Tasks 1 and 2: use cases, system specs, manager.md, builder.md, ADRs 0028, 0029, 0011 amendment
design-system/components.md, tokens.json          Task 2: photo tile, readiness checks, week day row, in-page viewer; size.photoTile
src/shared/domain/form-model/                     Task 3: consent item 10, publish context, consentCoverage and reviewTraits hooks
src/modules/definitions/                          Task 4: usePostPlan, listVersions, listPostPlanForms, laterPhotosCovered
src/shared/application/ports/job-admin.ts         Task 5 (+ InMemoryJobAdmin in shared testing fakes)
src/shared/infrastructure/jobs/pg-job-admin.ts    Task 5
src/shared/infrastructure/jobs/dead-alert.ts      Task 6 (+ pg-job-store.ts dead transition)
src/modules/notifications/application/            Task 7: AlertSource, email.job_alert handler
src/shared/presentation/email/job-alert.ts        Task 7
src/app/config.ts                                 Task 7: ALERT_EMAIL
src/modules/media/                                Task 8: openRead, thumbnail, addedFileKey, read and delete use cases
src/modules/submissions/                          Task 9: stored submissions, curation writes, delete; story link in the staff email
src/modules/review/
  domain/status.ts, post-url.ts, correction.ts, word-diff.ts                       Task 10
  domain/readiness.ts, days.ts, plan.ts, list-query.ts, staff-photos.ts, csv.ts, audit.ts, heartbeat.ts   Task 11
  application/ports/{story-repository,staff-photo-repository,edit-repository}.ts   Task 12
  application/ports/review-queries.ts                                             Task 13
  application/deps.ts, context.ts, list.ts, open-story.ts, ports/zip-writer.ts, index.ts, testing/{fakes,fixtures}.ts   Task 14
  application/curation.ts, publishing.ts                                          Task 15
  application/photos.ts, checks.ts                                                Task 16
  application/plan.ts                                                             Task 17
  application/media-access.ts, export.ts, delete.ts                               Task 18
  application/operations.ts, alert-source.ts                                      Task 19
  infrastructure/migrations/0010_review.sql, pg-story-repository.ts, pg-staff-photo-repository.ts, pg-edit-repository.ts   Task 12
  infrastructure/pg-review-queries.ts                                             Task 13
  infrastructure/stored-zip-writer.ts                                             Task 18
  presentation/copy.ts, format.ts, answers/*                                       Task 20
  presentation/SubmissionsList.tsx, ExportDialog.tsx, list-view.ts, export-labels.ts   Task 21
  presentation/story-params.ts, StoryPage.tsx, StoryNotFound.tsx, story/{StoryHeader,AnswersCard,CorrectionEditor,CompareView,ConsentCard,ActivityCard,DeleteDialog,JobWarning,Flash}.tsx   Task 22
  presentation/story/{PhotosCard,PhotoViewer,StaffPhotoForm,ReadinessPanel,PlanForm,PublishPanel}.tsx   Task 23
  presentation/review.module.css, styles.ts                                        Task 20 (extended by 21 to 24)
  presentation/PostPlanPage.tsx, OperationsPage.tsx                                Task 24
src/shared/presentation/copy.ts                   Tasks 2, 4
src/shared/presentation/format-date.ts            Task 20
src/shared/presentation/ManagerShell.tsx, sections.ts, src/app/admin/(gated)/layout.tsx   Task 24
src/app/modules.ts, container.ts, worker.ts, worker-handlers.ts                   Task 19
src/app/admin/(gated)/forms/[id]/page.tsx, forms/[id]/submissions/[reference]/page.tsx, plan/page.tsx, operations/page.tsx   Task 25
src/app/admin/forms/[id]/export/route.ts, forms/[id]/submissions/[reference]/**/route.ts, operations/**/route.ts, media/local/[key]/route.ts   Task 25
src/proxy.ts                                      Task 24 (section header), Task 25 (return paths for the new POST routes)
tests/integration/{jobs,notifications,media,submissions,review}/*.test.ts         Tasks 5 to 13, 18
tests/support/admin-session.ts, tests/e2e/staff.ts, fill.ts, review.test.ts, operations.test.ts   Task 26
tests/browser/review.spec.ts                      Task 27
```

## Task order and parallelism

| Task | After | Shares files with |
|---|---|---|
| 1 Specs: use cases, system, architecture, ADRs | none | none |
| 2 Specs: manager.md, builder.md, design system | none | 4 (`src/shared/presentation/copy.ts`) |
| 3 Form model: consent item 10, review traits | 1 | none |
| 4 Definitions: post plan setting, versions | 2, 3 | 2 (`src/shared/presentation/copy.ts`), 25 (the overview page) |
| 5 Shared: job administration port | 1 | 6 (shared testing fakes) |
| 6 Shared: dead-job alerts in the job store | 5 | 19 (`worker.ts`) |
| 7 Notifications: alert email | 1 | 19 (`modules.ts`) |
| 8 Media: reads, thumbnails, deletes, staff keys | 1 | none |
| 9 Submissions: stored submissions for review | 8 | none |
| 10 Review domain: curation rules and word diff | 1 | 11 (`domain/` only, separate files) |
| 11 Review domain: readiness, plan, days, query, CSV | 10 | none |
| 12 Review persistence and the module edge | 9, 11 | none |
| 13 Review read model | 12 | none |
| 14 Review application: deps, list, story | 4, 5, 13 | 15 to 19 (`index.ts`, `testing/fakes.ts`) |
| 15 Review application: corrections and publishing | 14 | 14, 16 to 19 |
| 16 Review application: staff photos, choice, checks | 15 | 14, 15, 17 to 19 |
| 17 Review application: planning and the week | 16 | 14 to 16, 18, 19 |
| 18 Review application: media, ZIP, export, delete | 17 | 14 to 17, 19 |
| 19 Review application: operations, alert source, composition roots | 6, 7, 18 | 6, 7 |
| 20 Review presentation: copy and answer displays | 2, 14 | none |
| 21 Presentation: Submissions list and export dialog | 20, 18 | none |
| 22 Presentation: story page, answers and corrections | 21 | 23 (`StoryPage.tsx`) |
| 23 Presentation: story page, photos, readiness, plan, publishing | 22 | 22 |
| 24 Presentation: Post plan, Operations, shell sections | 21, 19 | 25 (`src/proxy.ts`) |
| 25 App: pages, route handlers, proxy | 18, 19, 21 to 24 | none |
| 26 End to end over HTTP | 25 | none |
| 27 End to end in a browser | 26 | none |
| 28 Verification, spec sync, pull request | all | none |

Tasks 15 to 18 run in sequence: each adds exports to `src/modules/review/application/index.ts` and fakes to `testing/fakes.ts`, and 16 to 19 use Task 15's integration wiring. After Tasks 1 and 2 (in parallel), five lanes can run side by side, at most three heavy processes at a time: 3 then 4; 5 then 6; 7; 8 then 9; 10 then 11. Task 14 waits for 4, 5 and 13; Task 20 runs beside 15 to 19; Tasks 23 and 24 can run in parallel.

---
### Task 1: Specs first: use cases, system specs, architecture and ADRs

**Files:**
- Modify: `specs/use-cases/review-submissions.md`, `curate-submission.md`, `operate-jobs.md`, `manage-form-settings.md`, `reference-form-preemie-stories.md`
- Modify: `specs/form-definition.md`, `specs/architecture.md`
- Modify: `specs/system/media-storage.md`, `jobs.md`, `email.md`, `observability.md`, `database.md`, `security.md`, `deployment.md`
- Create: `specs/decisions/0028-review-storage-and-read-model.md`, `specs/decisions/0029-dead-job-alerts.md`
- Modify: `specs/decisions/0011-submission-curation-deepl-write.md` (amendment line)

**Interfaces:** none (documents). Later tasks quote these sections; keep the names below exactly.

This task writes the target behavior so every later task argues from a spec. Each bullet is one edit; keep the files' existing voice (short declarative sentences, no marketing).

- [ ] **Step 1: `review-submissions.md`.**
  - Trigger: the staff notification links straight to the story page.
  - "Main flow: list": columns as today plus "Planned · <date>" in place of the status badge for a planned, unpublished story of a post-plan form; filters gain a "Post plan" group (Planned, Waiting for a date, Not ready) on post-plan forms only; search also matches the reference; query keys `status`, `plan`, `from`, `to`, `version`, `media`, `q`, `page`.
  - "Main flow: view one" becomes the **story page** at `/admin/forms/<id>/submissions/<reference>`: a full page, not a drawer, for every form, with Newer and Older links that follow the list's filters even when the story itself no longer matches them. Photos: thumbnails (320 px, not audited), a full-size view in the page (`photo_viewed`), a download per file and "Download all" (`media_downloaded`). Post-plan forms add "Download chosen". Videos play from the Dropbox temporary link after the audited route redirects. Job status: a warning when any job of the story is dead, with "Try again", which retries all of them (`job_retried` per job). Consent and Activity (this submission's audit entries, newest 50) close the page.
  - New "Main flow: staff photos" (post-plan forms whose current version covers checklist item 10): the owner uploads up to 10 photos or videos per upload, at most 30 per story, chooses "from where" (WhatsApp, Instagram, Email, Other) and must tick "The sender sent these for this story". They pass the public file rules, are stored as media of the story under a key that never collides with the sender's files, are shown apart ("Added by the team") with who, when and from where, count toward no field limit and are never answers. A staff photo can be removed; the sender's cannot be removed one by one. Audit `staff_photos_added` (count, source, `senderConfirmed`), `staff_photo_removed`.
  - "Main flow: export": the dialog offers versions (as filtered, or all), text answers (original, corrected, both), "Include file paths"; columns: reference, status, received (UTC), version, language, planned date (post-plan forms), post link, the field columns, then with paths "File paths" and "Added photos". A cell that begins with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with `'` so a spreadsheet reads it as text. Headers and labels use Spanish when the form has Spanish, else English. Above 10,000 rows the export is refused. The request is a POST with the CSRF token. File name `<slug>-<YYYYMMDD-HHmm>.csv` (UTC).
  - "Main flow: delete": typed reference confirmation; one transaction deletes the submission (its story state, staff photo records and edit history cascade) and enqueues `media.delete` for every media row, staff photos included.
  - Audit entries list: add `staff_photos_added`, `staff_photo_removed`, `photo_choice_changed`, `story_check_changed`, `story_planned`, `post_plan_viewed`.
- [ ] **Step 2: `curate-submission.md`.**
  - Actors: drop the correction service for now; a note says DeepL Write suggestions are deferred (design, 2026-10-18) and the `TextCorrector` port stays specified in `architecture.md` for later. Mark step 3's "Suggest correction" and the "Correction service unavailable" and "Suggestion identical" alternates as deferred, and `correction_suggested` as not written yet.
  - New section "Readiness" (forms with the post-plan setting on): three checks, worked out when read. **Photos chosen**: at least one photo (the sender's or a staff photo) is chosen. **Photos edited in Canva**: a tick that records the chosen set at that moment; it reads as done only while the chosen set is the same, so choosing, unchoosing or removing a chosen photo clears it; it cannot be ticked with no photo chosen. **Text checked**: set by a saved correction or ticked by hand; reverting does not clear it. Ready means all three. Audit `photo_choice_changed` (media id, chosen) and `story_check_changed` (check, value, `by` = `hand` or `correction`).
  - New section "Planning": a planned date is a field of the story, not a status. One unpublished story per day across every post-plan form; planning on a taken day asks to swap the two dates (only when this story has a date) or to move the other story to "Waiting for a date". A published story cannot be re-planned. Audit `story_planned` (from, to, `resolution` when given), one entry per story whose date changed.
  - "Main flow: change status": Mark as published works from any status, stores the optional `https` link (re-marking replaces it) and records the day it went out: its planned date, or today in `America/Panama` when it had none; that day does not take or block a slot. Unmark returns to `edited` or `viewed` as before, keeps the planned date when the day is still free, and otherwise (or when it had no planned date) moves the story to "Waiting for a date". `submission_status_changed` carries `from`, `to` and `link` (boolean).
  - "Two curators edit the same field": last save wins, both edits stay in history (no conflict message; one person uses the tool).
  - Success criteria: the property-based test of byte-identical originals stays; the DeepL fixture criterion is marked deferred.
- [ ] **Step 3: `operate-jobs.md`.** The page is **Operations** (`/admin/operations`), first pass: worker heartbeat age with OK, Warning or Critical in words, the stale-worker banner, and one table of `dead` jobs (type, story reference linked to the story when the payload resolves to one, attempts, last error, first attempt, last attempt) with Retry and Discard (required reason, 1 to 200 characters); "Retry all {type} jobs ({count})" when more than one dead job shares a type. Failed jobs awaiting retry, the payload view, pending counts, backup time and staging size are later. Retry also clears the job's unique key. New section "Alerts": every job that goes dead, system jobs included, raises an alert email to `ALERT_EMAIL`, grouped at most one per job type per clock hour (UTC), listing how many jobs of that type are dead when it is sent and the story references among them (at most 20, then "and {n} more"), with a link to Operations, never content. An alert job that goes dead raises none. When email itself is failing the alert may fail too; Operations and `/health` still show it.
- [ ] **Step 4: `manage-form-settings.md`.** Main flow gains **Use submissions in the post plan**: on or off, default off. When on, the form's submissions get photo choice, readiness checks, staff photos and a planned date, and appear on the Post plan page. Turning it off hides those parts and the form's stories from the plan; dates and ticks are kept and come back when it is turned on again. When it is on and the current published version's consent field does not cover checklist item 10, the tab shows a notice that adding photos stays off until a version that covers it is published. Audit key `usePostPlan` in `form_settings_changed`.
- [ ] **Step 5: `form-definition.md`.** "Operational settings" lists `usePostPlan`. "Consent text": item 10, "That photos the submitter sends later for this submission (for example on WhatsApp, Instagram or email) are kept and used the same way.", required at publish only when the form's `usePostPlan` setting is on; publish reports it as `consent_checklist`. The starting template stays as it is. "Submissions": a sentence that review state (planned date, readiness ticks, chosen photos, staff photos, edit history) lives in the `review` module's tables, never in `answers`. Field types: `short_text` and `long_text` are curatable, `short_text` and `email` searchable in review, `short_text` names a story in lists (the `reviewTraits` hook, ADR 0016 amendment in Task 3).
- [ ] **Step 6: `reference-form-preemie-stories.md`.** The consent text gains the line for item 10 in Spanish, "Las fotos que nos envíes después para esta historia se guardan y usan de la misma forma.", and the reference form has the post-plan setting on.
- [ ] **Step 7: `architecture.md`.** Status line "revised 2026-10-18 for the review module (ADRs 0028, 0029)". Modules table: `review` responsibility "Story page, list, export, download and delete; curation status and text edits; staff photos, readiness and the post plan; Operations and dead-job alerts", may depend on `definitions`, `submissions`, `media`, `identity`, `notifications`. Ports table: `JobAdmin` (shared; dead jobs, retry, discard, heartbeat; Postgres `job`, `worker_heartbeat`; `system/jobs.md`), `AlertSource` (owned by `notifications`, implemented by `review`; `system/email.md`), `ReviewQueries` (owned by `review`; the read model of ADR 0028), `ZipWriter` (owned by `review`; stored ZIP stream). `MediaStorage` row adds "read as a stream". "Submission data flow" last paragraph: the staff notification links to the story page. The `Surfaces` row for Manager adds `/admin/plan` and `/admin/operations` under `review`.
- [ ] **Step 8: `media-storage.md`.** Port table: `openRead(ref)` (the bytes as a stream; Dropbox fetches the temporary link server-side; used for thumbnails, full photo views, downloads and ZIPs). Keys: `forms/<form slug>/<submission reference>/staff-<nn>-<8 hex>.<ext>` for photos staff add, `nn` the next position among the story's staff photos and the hex the first eight characters of the media id, so a removed photo's pending delete never reaches a newer file. Downloads: ZIPs `<form slug>-<reference>.zip` (all) and `<form slug>-<reference>-chosen.zip`, entries `<reference>/<file name>`, stored without compression; thumbnails 320 px WebP made on request. The local `viewUrl` route exists now (`/admin/media/local/<key>`, durable keys only, session required) and is reached only by a video redirect. Lifecycle: staff photos are deleted with the story and by the retention purge through their media rows.
- [ ] **Step 9: `jobs.md`.** Registered handlers add `email.job_alert`. Job types table: `email.job_alert` | A job went dead (raised by the job store in the same transaction) | One grouped alert to `ALERT_EMAIL`. Payloads: `email.job_alert` carries `{ jobType }`. New paragraph under "Failure and retry": the dead transition, in `fail` and `markDead`, also enqueues `email.job_alert` with unique key `email.job_alert:<type>:<YYYY-MM-DDTHH>` when no job with that key exists in any status; when that hour's alert exists but has already run, it enqueues the next hour's (`run_at` at its start) unless that key exists too; while the hour's alert is still waiting nothing more is needed, since it reports every dead job of the type when it runs. A dead `email.job_alert` raises nothing. The `discard_reason` row: "Set by Discard on Operations (`operate-jobs.md`)". Retry clears `unique_key`.
- [ ] **Step 10: `email.md`.** Role table adds "Job alert | `ALERT_EMAIL` | English | Job type, count, story references, link to Operations, no content". Ports: `EmailRenderer.jobAlert(data)`; `AlertSource.jobAlert(jobType)`, owned by `notifications`, implemented by `review`; delivery key `email.job_alert:<job id>`. Staff notification `{link}` is now the story page. New section "Job alert, fixed parts" (English only):

| Part | English |
|---|---|
| Subject | Jobs need attention: {job type} ({count}) |
| Preheader | {count} {job type} jobs stopped retrying |
| Intro | {count} background jobs of type {job type} stopped retrying and need attention. |
| References | Stories affected: {refs} |
| More | and {n} more |
| Link | Open Operations in the manager: {link} |
| Footer | This email carries no answers or files. Sign in to the manager to see them. |

  The References line is left out when no story is affected; More follows the references when there are more than 20.
- [ ] **Step 11: `observability.md`.** "Alert destinations": dead jobs alert `ALERT_EMAIL` (one configured address), grouped as in `operate-jobs.md`; the uptime monitor and error tracker keep "the team channel" until those tools are chosen. Error tracking's "any dead job" line points at the alert email for now.
- [ ] **Step 12: `database.md`.** Core tables: replace the `submission_edit` row and add `story` and `staff_photo` (owner `review`), with the columns of Task 12's migration, `on delete cascade` from `submission`; schema conventions note that `story` is keyed by `submission_id` (like `form_draft`) and `staff_photo.id` is the media row's id. Indexes: `story_plan_slot_key` (unique, `planned_on` where planned and not published). Lock order paragraph: review use cases lock the `submission` row (through `lockSubmission`), then the `story` row, then the day locks (`pg_advisory_xact_lock` on `story-plan:<date>`) in date order.
- [ ] **Step 13: `security.md`.** Audit log: a "Review's actions" table, each target the submission id unless noted:

| Action | Details |
|---|---|
| `submissions_listed` | `page`, `count`; target the form |
| `submission_viewed` | none |
| `photo_viewed` | `mediaId`, `kind` |
| `media_downloaded` | `mediaId`, or `set` (`all`, `chosen`) and `count` |
| `submissions_exported` | `versions` (`all` or a number), `text`, `paths`, `count`, `search` (boolean), `from`, `to` when set; target the form |
| `submission_deleted` | `reference` |
| `submission_edited` | `fieldKey`, `source` |
| `submission_reverted` | `fieldKey` |
| `submission_status_changed` | `from`, `to`, `link` |
| `staff_photos_added` | `count`, `source`, `senderConfirmed` |
| `staff_photo_removed` | `mediaId` |
| `photo_choice_changed` | `mediaId`, `chosen` |
| `story_check_changed` | `check`, `value`, `by` |
| `story_planned` | `from`, `to` (`YYYY-MM-DD` or `none`), `resolution` |
| `post_plan_viewed` | `week`; no target |
| `job_retried`, `job_discarded` | `type`; target the job |
| `jobs_retried_bulk` | `type`, `count`; no target |

  The constant list is `reviewAuditActions` in the module's public API. Data sent to third parties: the DeepL Write row says "deferred: not sent in the first review release".
- [ ] **Step 14: `deployment.md`.** Reverse proxy body limits: `/admin/forms/<id>/submissions/<reference>/photos` (staff photos, up to 10 files of 10 MB) | 102 MB. Environment: `ALERT_EMAIL` (required in production; the address dead-job alerts go to).
- [ ] **Step 15: ADR 0028, "Review storage and read model"** (Status accepted, Date 2026-10-18, under 60 lines). Context: review state must never touch `answers`; filters span tables of four owners; staff photos must follow the sender's files through upload, delete and retention. Decision: (1) `review` owns `story`, `staff_photo` and `submission_edit`, cascading from `submission`; curation columns stay on `submission` and are written only through `submissions` use cases; (2) staff photos are `media` rows under the reserved field key `staff-photos` (a hyphen, so never a valid field key) with the key scheme of `media-storage.md`; (3) readiness is computed when read from the chosen set, the set recorded at the "edited" tick and the text tick; (4) one unpublished story per day by a partial unique index plus a per-day advisory lock; (5) `PgReviewQueries` may read `submission`, `media` and `job` (never write) for the list, the plan and the export. Consequences: the read model breaks when those tables change shape, so its integration tests run against the real migrations; a field key with a hyphen is reserved forever; deleting a submission row removes all review state in one statement.
- [ ] **Step 16: ADR 0029, "Dead-job alerts".** Context: `shared` imports no module, yet the alert needs references and email. Decision: the job store enqueues `email.job_alert` inside the dead transition (type and attempts injected by the worker's composition root), grouped by an hourly unique key; `notifications` handles it through the `AlertSource` port, implemented by `review`; edge `review -> notifications`; one address, `ALERT_EMAIL`. Consequences: an alert can never be lost between the dead write and its enqueue; an email outage may delay alerts about itself (accepted by the owner); a second address means a list setting later.
- [ ] **Step 17: ADR 0011 amendment.** Under the Date line: "Amended 2026-10-18: the review module ships manual correction only; DeepL Write suggestions are deferred and nothing calls the `TextCorrector` port yet (design 2026-10-18-review-module-design.md)."
- [ ] **Step 18: Check and commit.** Run `pnpm format:check` (Prettier formats Markdown). Expected: clean.

```bash
git add specs
git commit -m "docs: review module specs, alerts, staff photos and the post plan (ADRs 0028, 0029)"
```

---

### Task 2: Specs first: the manager, the builder checklist and the design system

**Files:**
- Modify: `specs/ui-ux/manager.md`, `specs/ui-ux/builder.md`
- Modify: `design-system/components.md`, `design-system/tokens.json`
- Modify: `src/shared/presentation/copy.ts` (the shared groups only)
- Test: `src/shared/presentation/copy.test.ts` (unchanged; it must keep passing)

**Interfaces:** the copy keys below are what Tasks 4, 20 to 24 bind. Copy rows are exact; the copy tests of Tasks 4 and 20 compare against them.

- [ ] **Step 1: Build status, shell and routes in `manager.md`.**
  - Build status: built adds the Submissions tab (list and export), the story page, the Post plan page and a first-pass Operations page; pending keeps the Audit page, the banner above the Forms list, the language menu and keyboard shortcuts, the builder.
  - Shell: navigation is Forms, Post plan, Operations, Audit; Audit stays disabled. The current section is marked from the request path (the proxy passes it to the gated layout).
  - Routes table, new rows:

| Route | What it is |
|---|---|
| `GET /admin/forms/[id]` | The Submissions tab: the list (`?status`, `plan`, `from`, `to`, `version`, `media`, `q`, `page`; `?export=1` opens the export dialog; `?deleted=<ref>` reports a deletion) |
| `POST /admin/forms/[id]/export` | Answers the CSV (200, attachment) or 303 back to the dialog with `?export=1&error=too_large` |
| `GET /admin/forms/[id]/submissions/[reference]` | The story page; the list's query keys travel with it, plus `edit`, `compare`, `photo`, `action`, `field`, `media`, `conflict_date`, `conflict_ref`, `conflict_swap`, `done`, `error`, `n`, `other` |
| `POST .../[reference]/correction`, `revert`, `status`, `photos`, `photos/remove`, `choice`, `check`, `plan`, `retry`, `delete` | The story page's changes, 303 back to it (`delete` to the list) |
| `GET .../[reference]/media/[mediaId]?view=thumb\|full\|download` | A thumbnail, the full file (or a redirect for a stored video), or the file as an attachment |
| `GET .../[reference]/photos.zip?set=all\|chosen` | The story's photos as a ZIP |
| `GET /admin/plan` | The Post plan (`?week=<date>`, `?pick=<date>`) |
| `GET /admin/operations` | Operations; `POST /admin/operations/retry`, `discard`, `retry-type` change it, 303 back |
| `GET /admin/media/local/[key]` | A local durable file, the target of a video redirect when `MEDIA_PROVIDER=local` |

  The proxy's sign-in return paths: a story POST returns to its story page, `export` to the overview, an Operations POST to Operations. GET routes for media need a session and no CSRF token; their answers are `private`.
- [ ] **Step 2: Replace "Submission drawer" and its sub-sections with "Story page".** Keep "List" with the new filters, then write: **Story page**, a full page (Fitts's Law: Newer, Older and Back at a fixed place at the top), in this order: breadcrumb (Forms, form title, reference); `<h1>` the reference; status badge or "Planned · <date>"; received time (form zone and UTC), version, "Sent in English/Spanish"; Newer, Older, Back to the list; banners (flash, refusal, dead jobs with Try again); Answers card (per page title, each answer through its type's review display; text answers with "Edited", "Compare with original", "Edit", and in Compare "Revert to original"); Photos and videos card (sender's files, then "Added by the team"; per file "View full size", "Download", "Choose for the post" on post-plan forms; "Download chosen ({count})", "Download all ({count})"; "Add photos" form); Ready to post? panel (three checks, each with "Done" or "Missing" and a tick or a cross, two tick buttons, the planned date form); Publishing (Mark as published with the optional link, or the published day and link with Unmark); Consent (collapsed); Activity; Delete submission. Without script every confirmation (revert, unpublish, remove photo, delete, plan conflict) is an in-page `<section role="dialog">` opened by `?action=`, as the lifecycle confirmations are. The editor is two columns from 768 px (Original read only, Corrected a textarea with `required` and `maxlength` set to the field's limit), one column below. Compare marks each change with `<ins>` or `<del>`, a visually hidden "Added" or "Removed", underline or strike-through, and `tabindex="0"`; the change count is a polite status. The full-size viewer is a page section (`?photo=`): the image or the native video player, "Photo n of total", Previous, Next, Download, "In Dropbox: <path>", "Views and downloads are recorded", and Back to the story. Post-plan parts appear only on post-plan forms; "Add photos" also needs the current version to cover consent item 10, else `st.laterphotos_off`.
  - Rewrite "Mark as published" and "Delete" to the in-page versions; remove the drawer from "Laws of UX applied", "Accessibility notes" ("The drawer is a dialog..." becomes "Confirmations are in-page dialogs labelled by their heading") and "Performance targets" ("Story page | under 300 ms to text content; thumbnails stream after"). "States": "Submission deleted while open" becomes the story page's not-found body.
  - First pass notes: rows are links (Tab and Enter); Up, Down, J and K arrive with the first client component.
- [ ] **Step 3: New sections "Post plan page" and "Operations page" in `manager.md`.**
  - Post plan: `<h1>` Post plan; Previous week, This week, Next week; "Week of <Monday>"; seven day rows Monday to Sunday (weekday and date in both languages), today marked "Today"; a day with an unpublished planned story shows its reference (link to the story), label, form, and the three checks with words; published stories of that day show "Published" and "Open the post" when a link exists; an empty day shows "Pick a story" (today and later) or "Nothing planned" (past). "Pick a story" opens `?pick=<date>`, which shows "Choose a story for <date>" above Waiting for a date, each row with "Plan for <date>". Waiting for a date: unpublished, unplanned stories of post-plan forms, newest first, 50 at most with the total. No form with the setting: `plan.no_forms`.
  - Operations (replace the section): the heartbeat card, the worker-down banner, the dead jobs table, Retry, Discard with reason, Retry all of type; the other cards are later.
- [ ] **Step 4: Settings tab table in `manager.md`.** New row "Post plan | use submissions in the post plan toggle, the notice when the current version's consent text lacks item 10".
- [ ] **Step 5: Copy tables in `manager.md`.** In "Shell and home" add `nav.plan` (`form.submissions_soon` goes in Task 4, with the code that uses it). Replace the "Drawer" table with "Story page"; extend "Submissions list", "Export", "Operations and audit"; add "Post plan". Every row below is exact:

Shell and home:

| Key | English | Spanish |
|---|---|---|
| nav.plan | Post plan | Plan de publicaciones |

Submissions list (added to the existing rows):

| Key | English | Spanish |
|---|---|---|
| sub.filter_status | Status | Estado |
| sub.filter_plan | Post plan | Plan de publicaciones |
| sub.plan_planned | Planned | Planificadas |
| sub.plan_waiting | Waiting for a date | Esperando fecha |
| sub.plan_not_ready | Not ready | No listas |
| sub.filter_from | From | Desde |
| sub.filter_to | To | Hasta |
| sub.filter_any_version | All versions | Todas las versiones |
| sub.apply | Filter | Filtrar |
| sub.col_status | Status | Estado |
| sub.caption | Submissions, newest first | Respuestas, de la más reciente a la más antigua |
| sub.planned_on | Planned · {date} | Planificada · {date} |
| sub.page | Page {n} of {total} | Página {n} de {total} |
| sub.newer_page | Newer | Más recientes |
| sub.older_page | Older | Más antiguas |
| sub.deleted | Submission {ref} was deleted. | Se eliminó la respuesta {ref}. |

Story page (replaces "Drawer"):

| Key | English | Spanish |
|---|---|---|
| st.back | Back to the list | Volver a la lista |
| st.newer | Newer | Más reciente |
| st.older | Older | Más antigua |
| st.received | Received {date} | Recibida el {date} |
| st.version | Version {n} | Versión {n} |
| st.sent_en | Sent in English | Enviada en inglés |
| st.sent_es | Sent in Spanish | Enviada en español |
| st.answers | Answers | Respuestas |
| st.no_answer | No answer | Sin respuesta |
| st.yes | Yes | Sí |
| st.no | No | No |
| st.files_below | {n} files, shown under Photos and videos | {n} archivos, en Fotos y videos |
| st.edited_tag | Edited | Editada |
| st.edited_by | Corrected by {name} on {date} | Corregida por {name} el {date} |
| st.edit | Edit | Editar |
| st.compare | Compare with original | Comparar con el original |
| st.revert | Revert to original | Volver al original |
| st.revert_confirm | Remove the corrected version of "{label}" and show the original again? | ¿Quitar la versión corregida de "{label}" y volver a mostrar el original? |
| st.original | Original | Original |
| st.corrected | Corrected | Corregida |
| st.correction_hint | Fix spelling, grammar and punctuation. The sender's original is kept. | Corrige ortografía, gramática y puntuación. El original se conserva. |
| st.save | Save correction | Guardar corrección |
| st.changes | {n} changes | {n} cambios |
| st.no_changes | No differences from the original | Sin diferencias con el original |
| st.added | Added | Agregado |
| st.removed | Removed | Quitado |
| st.err_correction_blank | Write the corrected text, or cancel to keep the original. | Escribe el texto corregido, o cancela para conservar el original. |
| st.err_correction_too_long | Use at most {max} characters. | Usa como máximo {max} caracteres. |
| st.saved | Correction saved | Corrección guardada |
| st.reverted | The original is shown again | Se volvió a mostrar el original |
| st.suggest | Suggest correction | Sugerir corrección |
| st.suggest_none | No changes suggested | Sin cambios sugeridos |
| st.suggest_failed | Suggestion unavailable, try later | Sugerencia no disponible, intenta más tarde |
| st.photos | Photos and videos | Fotos y videos |
| st.sender_photos | Sent with the form | Enviadas con el formulario |
| st.staff_photos | Added by the team | Agregadas por el equipo |
| st.added_by | Added by {name} on {date} | Agregada por {name} el {date} |
| st.from_whatsapp | From WhatsApp | Desde WhatsApp |
| st.from_instagram | From Instagram | Desde Instagram |
| st.from_email | From email | Desde correo |
| st.from_other | From somewhere else | Desde otro medio |
| st.photo_n | Photo {n} of {total} | Foto {n} de {total} |
| st.video_n | Video {n} of {total} | Video {n} de {total} |
| st.open_full | View full size | Ver en tamaño completo |
| st.download | Download | Descargar |
| st.in_dropbox | In Dropbox: {path} | En Dropbox: {path} |
| st.views_recorded | Views and downloads are recorded | Las vistas y descargas quedan registradas |
| st.previous_photo | Previous | Anterior |
| st.next_photo | Next | Siguiente |
| st.close_viewer | Back to the story | Volver a la historia |
| st.not_stored | Not in Dropbox yet: kept on the server only. | Aún no está en Dropbox: se guarda solo en el servidor. |
| st.choose | Choose for the post | Elegir para la publicación |
| st.chosen | Chosen for the post | Elegida para la publicación |
| st.unchoose | Remove from the post | Quitar de la publicación |
| st.download_chosen | Download chosen ({count}) | Descargar elegidas ({count}) |
| st.download_all | Download all ({count}) | Descargar todas ({count}) |
| st.add_photos | Add photos | Agregar fotos |
| st.add_photos_hint | Photos or videos the sender sent later on WhatsApp, Instagram or email. Up to 10 files of 10 MB each. | Fotos o videos que la persona envió después por WhatsApp, Instagram o correo. Hasta 10 archivos de 10 MB cada uno. |
| st.files | Files | Archivos |
| st.from_where | Where they came from | De dónde llegaron |
| st.source_whatsapp | WhatsApp | WhatsApp |
| st.source_instagram | Instagram | Instagram |
| st.source_email | Email | Correo |
| st.source_other | Other | Otro |
| st.sender_confirmed | The sender sent these for this story | La persona las envió para esta historia |
| st.upload | Upload | Subir |
| st.remove_photo | Remove this photo | Quitar esta foto |
| st.remove_photo_confirm | Remove this photo from the story? Its file in Dropbox is deleted too. | ¿Quitar esta foto de la historia? Su archivo en Dropbox también se elimina. |
| st.photos_added | {count} files added | Se agregaron {count} archivos |
| st.photo_removed | Photo removed | Foto quitada |
| st.err_not_confirmed | Tick the box to confirm the sender sent these for this story. | Marca la casilla para confirmar que la persona las envió para esta historia. |
| st.err_source | Choose where the photos came from. | Elige de dónde llegaron las fotos. |
| st.err_no_files | Choose at least one file. | Elige al menos un archivo. |
| st.err_too_many_files | Upload at most {max} files at a time. | Sube como máximo {max} archivos a la vez. |
| st.err_staff_photos_max | This story already has the most added photos allowed ({max}). | Esta historia ya tiene el máximo de fotos agregadas ({max}). |
| st.err_file_too_large | File {n} is larger than 10 MB. Nothing was added. | El archivo {n} pesa más de 10 MB. No se agregó nada. |
| st.err_file_wrong_type | File {n} is not a JPEG, PNG, WebP or HEIC photo, or an MP4 or MOV video. Nothing was added. | El archivo {n} no es una foto JPEG, PNG, WebP o HEIC, ni un video MP4 o MOV. No se agregó nada. |
| st.err_file_unreadable | File {n} could not be read. Nothing was added. | No se pudo leer el archivo {n}. No se agregó nada. |
| st.laterphotos_off | Adding photos is off until the form publishes a consent text that covers photos sent later. | Agregar fotos está desactivado hasta que el formulario publique un texto de consentimiento que cubra las fotos enviadas después. |
| st.readiness | Ready to post? | ¿Lista para publicar? |
| st.check_chosen | Photos chosen | Fotos elegidas |
| st.check_edited | Photos edited in Canva | Fotos editadas en Canva |
| st.check_text | Text checked | Texto revisado |
| st.check_done | Done | Hecho |
| st.check_missing | Missing | Falta |
| st.ready | Ready | Lista |
| st.not_ready | Not ready: {n} of 3 done | No lista: {n} de 3 hechos |
| st.mark_edited | Mark photos as edited | Marcar fotos como editadas |
| st.unmark_edited | Photos not edited yet | Las fotos aún no están editadas |
| st.mark_text | Mark text as checked | Marcar texto como revisado |
| st.unmark_text | Text not checked yet | El texto aún no está revisado |
| st.checked_by | {name}, {date} | {name}, {date} |
| st.edited_stale | The chosen photos changed after they were edited. Tick again once the new set is edited. | Las fotos elegidas cambiaron después de editarlas. Vuelve a marcar cuando el nuevo grupo esté editado. |
| st.err_no_photos_chosen | Choose at least one photo first. | Primero elige al menos una foto. |
| st.plan | Planned date | Fecha planificada |
| st.plan_hint | One story per day. Format YYYY-MM-DD. | Una historia por día. Formato AAAA-MM-DD. |
| st.plan_save | Plan | Planificar |
| st.plan_clear | Remove the date | Quitar la fecha |
| st.plan_conflict | {ref} is already planned for {date}. | {ref} ya está planificada para el {date}. |
| st.plan_swap | Swap the two dates | Intercambiar las fechas |
| st.plan_move | Move {ref} to Waiting for a date | Pasar {ref} a Esperando fecha |
| st.err_date | Enter a date as YYYY-MM-DD. | Escribe una fecha como AAAA-MM-DD. |
| st.err_plan_published | A published story stays on the day it went out. | Una historia publicada se queda en el día en que salió. |
| st.planned_saved | Planned for {date} | Planificada para el {date} |
| st.plan_cleared | Moved to Waiting for a date | Pasó a Esperando fecha |
| st.publishing | Publishing | Publicación |
| st.published_on | Published on {date} | Publicada el {date} |
| st.open_post | Open the post | Abrir la publicación |
| st.mark_published | Mark as published | Marcar como publicada |
| st.unmark_published | Unmark as published | Quitar marca de publicada |
| st.consent | Consent | Consentimiento |
| st.consent_accepted | Accepted {date}, text version {n} | Aceptado el {date}, versión del texto {n} |
| st.jobs_warning | Something did not finish for this story | Algo no terminó para esta historia |
| st.job_media_upload | A photo or video has not reached Dropbox. | Una foto o video no llegó a Dropbox. |
| st.job_media_delete | A file could not be deleted from Dropbox. | No se pudo eliminar un archivo de Dropbox. |
| st.job_email | An email was not sent. | No se envió un correo. |
| st.job_other | A background job stopped retrying. | Un trabajo en segundo plano dejó de reintentarse. |
| st.retry | Try again | Intentar de nuevo |
| st.retried | Trying again. Reload in a minute to see the result. | Se está intentando de nuevo. Recarga en un minuto para ver el resultado. |
| st.activity | Activity | Actividad |
| st.activity_empty | No activity yet. | Aún no hay actividad. |
| st.delete | Delete submission | Eliminar respuesta |
| st.not_found_title | Submission not found | Respuesta no encontrada |
| st.not_found_body | It may have been deleted, or the link is out of date. | Puede haber sido eliminada o el enlace está desactualizado. |
| st.not_found_back | Back to the submissions | Volver a las respuestas |
| pub.post_url | Link to the post (optional) | Enlace a la publicación (opcional) |
| pub.post_url_hint | Starts with https:// | Empieza con https:// |
| pub.confirm | Confirm | Confirmar |
| pub.unmark_viewed | The status will return to Viewed. | El estado volverá a Vista. |
| pub.unmark_edited | The status will return to Edited. | El estado volverá a Editada. |
| pub.err_url | Use a link that starts with https://. | Usa un enlace que empiece con https://. |
| pub.saved | Marked as published | Marcada como publicada |
| pub.unmarked | No longer marked as published | Ya no está marcada como publicada |
| pub.unmark_waiting | Its day now belongs to {ref}, so it moved to Waiting for a date. | Su día ahora es de {ref}, así que pasó a Esperando fecha. |
| del.body | Submission {ref} and its files in Dropbox will be deleted. This cannot be undone. Type the reference to confirm. | La respuesta {ref} y sus archivos en Dropbox se eliminarán. No se puede deshacer. Escribe la referencia para confirmar. |
| del.reference | Reference | Referencia |
| del.confirm | Delete permanently | Eliminar definitivamente |
| del.mismatch | The reference did not match. Nothing was deleted. | La referencia no coincide. No se eliminó nada. |

Export (added to the existing rows; `ex.text_curated` becomes "Corrected" / "Corregida"):

| Key | English | Spanish |
|---|---|---|
| ex.versions_filter | As filtered | Según el filtro |
| ex.versions_all | All versions | Todas las versiones |
| ex.col_reference | Reference | Referencia |
| ex.col_status | Status | Estado |
| ex.col_received | Received (UTC) | Recibida (UTC) |
| ex.col_version | Version | Versión |
| ex.col_language | Language | Idioma |
| ex.col_planned | Planned date | Fecha planificada |
| ex.col_post_link | Post link | Enlace de la publicación |
| ex.col_files | File paths | Rutas de archivos |
| ex.col_staff_photos | Added photos | Fotos agregadas |
| ex.corrected_suffix | {label} (corrected) | {label} (corregida) |

Post plan:

| Key | English | Spanish |
|---|---|---|
| plan.title | Post plan | Plan de publicaciones |
| plan.week_of | Week of {date} | Semana del {date} |
| plan.previous | Previous week | Semana anterior |
| plan.next | Next week | Semana siguiente |
| plan.this_week | This week | Esta semana |
| plan.today | Today | Hoy |
| plan.pick | Pick a story | Elegir una historia |
| plan.nothing | Nothing planned | Nada planificado |
| plan.published | Published | Publicada |
| plan.waiting | Waiting for a date | Esperando fecha |
| plan.waiting_empty | No stories are waiting for a date. | No hay historias esperando fecha. |
| plan.waiting_count | {count} stories | {count} historias |
| plan.picking | Choose a story for {date}. | Elige una historia para el {date}. |
| plan.plan_for | Plan for {date} | Planificar para el {date} |
| plan.no_forms | No form uses the post plan yet. Turn it on in a form's Settings. | Ningún formulario usa el plan de publicaciones todavía. Actívalo en la Configuración de un formulario. |

Operations and audit (added to the existing rows):

| Key | English | Spanish |
|---|---|---|
| ops.dead_title | Jobs that stopped retrying | Trabajos que dejaron de reintentarse |
| ops.none_dead | No jobs need attention. | Ningún trabajo necesita atención. |
| ops.col_type | Type | Tipo |
| ops.col_story | Story | Historia |
| ops.col_attempts | Attempts | Intentos |
| ops.col_error | Last error | Último error |
| ops.col_first | First attempt | Primer intento |
| ops.col_last | Last attempt | Último intento |
| ops.seconds_ago | {n} seconds ago | hace {n} segundos |
| ops.never | Never | Nunca |
| ops.err_reason | Write why you are discarding it, in at most 200 characters. | Escribe por qué lo descartas, en 200 caracteres como máximo. |
| ops.retried | The job will run again shortly. | El trabajo se ejecutará de nuevo en breve. |
| ops.retried_all | {count} jobs will run again shortly. | {count} trabajos se ejecutarán de nuevo en breve. |
| ops.discarded | The job was discarded. | El trabajo se descartó. |
| au.action_submissions_listed | Submissions listed | Respuestas listadas |
| au.action_submission_viewed | Submission opened | Respuesta abierta |
| au.action_photo_viewed | Photo viewed | Foto vista |
| au.action_media_downloaded | Files downloaded | Archivos descargados |
| au.action_submissions_exported | Submissions exported | Respuestas exportadas |
| au.action_submission_deleted | Submission deleted | Respuesta eliminada |
| au.action_submission_edited | Text corrected | Texto corregido |
| au.action_submission_reverted | Correction reverted | Corrección revertida |
| au.action_submission_status_changed | Status changed | Estado cambiado |
| au.action_staff_photos_added | Photos added | Fotos agregadas |
| au.action_staff_photo_removed | Photo removed | Foto quitada |
| au.action_photo_choice_changed | Photo choice changed | Elección de fotos cambiada |
| au.action_story_check_changed | Check changed | Verificación cambiada |
| au.action_story_planned | Date planned | Fecha planificada |
| au.action_post_plan_viewed | Post plan viewed | Plan de publicaciones visto |
| au.action_job_retried | Job retried | Trabajo reintentado |
| au.action_job_discarded | Job discarded | Trabajo descartado |
| au.action_jobs_retried_bulk | Jobs retried | Trabajos reintentados |

Settings and share (added):

| Key | English | Spanish |
|---|---|---|
| set.post_plan_section | Post plan | Plan de publicaciones |
| set.post_plan | Use submissions in the post plan | Usar las respuestas en el plan de publicaciones |
| set.post_plan_hint | Adds photo choice, readiness checks and a planned date to each submission, and shows them on the Post plan page. | Agrega elección de fotos, verificaciones y una fecha planificada a cada respuesta, y las muestra en la página Plan de publicaciones. |
| set.post_plan_notice | Adding photos to a story stays off until you publish a version whose consent text covers photos sent later. | Agregar fotos a una historia sigue desactivado hasta que publiques una versión cuyo texto de consentimiento cubra las fotos enviadas después. |

  Remove the old `dr.*` rows and `pub.unmark_body`. Update "Test fixtures": presentation tests cover the list in each filter state, the story page in each state (plain, editing, comparing, viewer, each dialog, each flash and refusal, post-plan on and off), the Post plan week, and Operations in each heartbeat state; the e2e suites review, correct, choose, plan, publish, export and delete a synthetic submission.
- [ ] **Step 6: `builder.md`.** Consent checklist copy gains `| consent.item.10 | That photos sent later for a submission are kept and used the same way (forms in the post plan) | Que las fotos enviadas después para una respuesta se guardan y usan de la misma forma (formularios en el plan de publicaciones) |`; "Consent field" says the tenth item shows only when the form's post-plan setting is on.
- [ ] **Step 7: Design system.** `tokens.json` gains `size.photoTile` = 160 (px, with the description "Staff photo grid tile; thumbnails are generated at 2x"). `components.md` gains four sections:
  - **Photo tile (staff)**: `size.photoTile` square, `radius.md`, `border.default`; the image `object-fit: cover`; beneath it the caption ("Photo n of total" or "Video n of total") and the tile's actions as tertiary buttons stacked, each at least `size.touchTarget`; a chosen tile adds a 2 px `color.action.primary.bg` border and the text "Chosen for the post" with a check icon; never the border alone.
  - **Readiness checks**: a list of three rows, each an icon (check or cross, 20 px), the check's name, then "Done" or "Missing" in text; done in `color.text.success`, missing in `color.text.warning`; the summary line above ("Ready" or "Not ready: n of 3 done").
  - **Week day row**: a list item per day with the weekday and date in weight medium on the left (`space.4` gap), the content on the right; today's row has `surface.selected` and the word "Today"; rows separated by `border.default`; stacks below `breakpoint.md`.
  - **Viewer (staff, no JavaScript)**: replaces the Lightbox until a client component exists: an in-page section with the image at most 100% wide, the native video player, the caption, and Previous, Next, Download and Back as secondary buttons in one row (wrapping), each 44 px tall.
- [ ] **Step 8: Bind the shared groups.** The shared copy test binds every row of the `nav`, `au` and `set` groups, so add `nav.plan`, the eighteen review `au.action_*` rows and the four `set.post_plan*` rows to `src/shared/presentation/copy.ts`, exactly as above. Run `pnpm test src/shared/presentation src/modules/definitions/presentation`. Expected: PASS (the `sub`, `st`, `pub`, `del`, `ex`, `plan` and `ops` groups are bound in Task 20 and no test reads them before).
- [ ] **Step 9: Check and commit.** `pnpm lint && pnpm typecheck && pnpm format:check`, expected clean.

```bash
git add specs/ui-ux design-system/components.md design-system/tokens.json src/shared/presentation/copy.ts
git commit -m "docs: story page, post plan and operations in the manager spec; design system additions"
```

---
### Task 3: Form model: consent item 10, the publish context and review traits

**Files:**
- Modify: `src/shared/domain/form-model/field-types/consent.ts`, `field-type.ts`, `publish.ts`, `index.ts`, `field-types/short-text.ts`, `field-types/long-text.ts`, `field-types/email.ts`, `field-types/conformance-checks.ts`
- Modify: `tests/fixtures/reference-form.ts` (consent text line and coverage)
- Modify: `specs/decisions/0016-field-type-hooks.md` (amendment line)
- Test: `field-types/consent.test.ts`, `publish.test.ts`, `field-types/conformance-checks.test.ts`, `tests/fixtures/reference-form.test.ts`

**Interfaces:**
- Consumes: the existing `defineFieldType`, `validateForPublish`, `checkDefinition`, `inputFields`.
- Produces:

```ts
// field-types/consent.ts
export const consentItems = [/* the nine, unchanged */] as const;
/** Items required only in some contexts: `later_photos` when the form uses the post plan. */
export const conditionalConsentItems = ["later_photos"] as const;
export type ConsentItem = (typeof consentItems)[number] | (typeof conditionalConsentItems)[number];
// field-type.ts
export interface PublishChecksContext { postPlan: boolean }
//   publishChecks?(field, settings: S, ctx: PublishChecksContext): PublishIssueDraft[];
//   /** The consent checklist items the settings cover; only consent types declare it. */
//   consentCoverage?(settings: S): readonly string[];
//   /** How review treats the answer: `curatable` (staff keep a corrected copy), `searchable` (the list's
//   search reads it), `label` (the first such answer names the story in lists). Each implies a string answer. */
//   reviewTraits?: { curatable?: true; searchable?: true; label?: true };
// publish.ts
export interface PublishContext { retentionMonths?: number; postPlan?: boolean }
export function checkDefinition(version: Version, registry: FieldTypeRegistry, ctx?: PublishChecksContext): PublishIssue[]; // ctx defaults to { postPlan: false }
/** True when an input field of the version declares coverage of `item`. */
export function versionCoversConsentItem(version: Version, registry: FieldTypeRegistry, item: ConsentItem): boolean;
// index.ts adds: conditionalConsentItems, versionCoversConsentItem, type PublishChecksContext
```

Decision (ADR 0016 amendment): review's type-dependent rules ("only text answers are editable", "search over `short_text` and `email`", "the first `short_text` answer as a label") are one hook, so `review` never tests a type id: `short_text` declares all three traits, `long_text` `curatable`, `email` `searchable`. Item 10 reuses `consent_checklist`.

- [ ] **Step 1: Failing tests.** In `consent.test.ts` (keep "has exactly nine checklist items"):
  - "accepts later_photos as a covered item": `consent.settingsSchema.parse({ text: { en: "x" }, coveredItems: ["later_photos"] })` keeps it.
  - "requires later_photos only in the post-plan context": settings covering the nine → `publishChecks(field, s, { postPlan: false })` is `[]`, with `{ postPlan: true }` it is `[{ code: "consent_checklist", path: "settings/coveredItems" }]`; covering the nine and `later_photos` → `[]` in both.
  - "declares the items it covers": `consent.consentCoverage?.(s)` equals `s.coveredItems`.
  In `publish.test.ts`:
  - "reports consent_checklist for item 10 only when the form uses the post plan": the existing complete definition (nine covered) → `validateForPublish(v, registry, { retentionMonths: 12 })` has no `consent_checklist`; with `postPlan: true` it has one at `pages/<p>/fields/<f>/settings/coveredItems` (the consent field's path).
  - "versionCoversConsentItem reads the consent field's coverage": true for `later_photos` when covered, false when not, false for a version without a consent field.
  In `conformance-checks.test.ts`: "a type with review traits has string answers": a probe type with `reviewTraits: { curatable: true }` and a number answer fails the new check `review traits need string answers`; the registered traits are exactly `short_text` `{ curatable, searchable, label }`, `long_text` `{ curatable }`, `email` `{ searchable }`.
  In `tests/fixtures/reference-form.test.ts`: "covers consent item 10": `versionCoversConsentItem(referenceVersion, registry, "later_photos")` is true and the Spanish consent text contains "Las fotos que nos envíes después para esta historia se guardan y usan de la misma forma.".
- [ ] **Step 2: Run** `pnpm test src/shared/domain/form-model tests/fixtures`: the new cases fail.
- [ ] **Step 3: Implement.** Extend the settings enum to both lists; `isConsentChecklistComplete(s, ctx)` takes the context (the nine always, `later_photos` when `ctx.postPlan`); `publishChecks` and `consentCoverage` as above; `checkDefinition` passes `ctx` to every `publishChecks`; `validateForPublish` passes `{ postPlan: ctx.postPlan ?? false }`; `reviewTraits` on the three types; the conformance check named "review traits need string answers". The reference fixture's consent text gains the Spanish line (Task 1, Step 6) as its own paragraph and `coveredItems: [...consentItems, ...conditionalConsentItems]`. ADR 0016 gains "Amended 2026-10-18: `publishChecks` receives the publish context; optional `consentCoverage(settings)` and `reviewTraits` hooks".
- [ ] **Step 4: Run** `pnpm test src/shared tests/fixtures src/modules/submissions && pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS (the renderer and email snapshot tests recompute the consent text version from the fixture; update a snapshot only if it embeds the consent text, and say so in the commit body).
- [ ] **Step 5: Commit** `feat(form-model): consent item 10 for post-plan forms, publish context and review traits`

---

### Task 4: Definitions: the post-plan setting, versions of a form and the forms in the plan

**Files:**
- Modify: `src/modules/definitions/domain/settings.ts`, `application/publish-form.ts`, `application/open-form.ts`, `application/public-form.ts`, `application/ports/version-repository.ts`, `application/ports/form-repository.ts`, `application/index.ts`, `application/testing/fakes.ts`
- Modify: `src/modules/definitions/infrastructure/pg-version-repository.ts`, `pg-form-repository.ts`
- Modify: `src/modules/definitions/presentation/settings-form.ts`, `SettingsForm.tsx`, `FormOverview.tsx` (drop `SubmissionsPlaceholder`)
- Modify: `src/shared/presentation/copy.ts` and `specs/ui-ux/manager.md` (remove `form.submissions_soon` from both)
- Modify: `src/app/admin/(gated)/forms/[id]/page.tsx` (renders no tab body until Task 25), `src/app/admin/(gated)/forms/[id]/settings/page.tsx` (passes `laterPhotosCovered` to `SettingsForm`)
- Test: `domain/settings.test.ts`, `application/publish-form.test.ts`, `application/open-form.test.ts`, `application/public-form.test.ts`, `presentation/settings-form.test.ts`, `presentation/tab-pages.test.ts`, `presentation/overview.test.ts`, `src/shared/presentation/copy.test.ts`, `tests/integration/definitions/pg-version-repository.test.ts`, `pg-form-repository.test.ts`

**Interfaces:**
- Consumes: `versionCoversConsentItem` (Task 3).
- Produces:

```ts
// domain/settings.ts: settingsSchema gains
usePostPlan: z.boolean().default(false),
// ports/version-repository.ts
listByForm(formId: string): Promise<FormVersion[]>;      // oldest first; [] for a malformed id
// ports/form-repository.ts
listUsingPostPlan(): Promise<Form[]>;                    // any status, ordered by title then slug
// application/public-form.ts
export async function listVersions(deps: DefinitionsDeps, formId: string): Promise<FormVersion[]>;
export async function listPostPlanForms(deps: DefinitionsDeps): Promise<Form[]>;
/** The current version covers consent item 10; false without a version. */
export async function laterPhotosCovered(deps: DefinitionsDeps, form: Form): Promise<boolean>;
// application/open-form.ts: FormOverview gains
laterPhotosCovered: boolean;
```

- [ ] **Step 1: Failing tests.**
  - `settings.test.ts` "defaults usePostPlan to off and lists it as a changed key": `defaultSettings("historia").usePostPlan === false`; `changedKeys(a, { ...a, usePostPlan: true })` equals `["usePostPlan"]`.
  - `publish-form.test.ts` "requires consent item 10 only when the form uses the post plan": seed a draft covering the nine; `publishPreview` has no `consent_checklist`; after `updateSettings` with `usePostPlan: true` the preview reports `consent_checklist` and `publishForm` refuses with `invalid`.
  - `open-form.test.ts` "reports whether the current version covers photos sent later": false before the first publish, false for a version covering the nine, true after publishing a version that covers `later_photos`.
  - `public-form.test.ts` "lists a form's versions oldest first" (publish twice: numbers `[1, 2]`) and "lists the forms that use the post plan" (three forms: two with the setting on, one of them archived, and one off → the two that are on, ordered by title).
  - `settings-form.test.ts` "reads and writes the post-plan toggle": `readSettingsValues` of a form data with `usePostPlan=on` gives `true`, absent gives `false`; `parseSettingsForm` carries it into the settings.
  - `tab-pages.test.ts` "shows the post-plan toggle with its hint, and the notice when on without item 10": the Settings tab rendered for a form with `usePostPlan: true` and `laterPhotosCovered: false` contains `set.post_plan`, `set.post_plan_hint` and `set.post_plan_notice` in both languages, the checkbox labelled by `set.post_plan`; with `laterPhotosCovered: true` no notice; with the setting off no notice.
  - `copy.test.ts` keeps passing once `form.submissions_soon` leaves both the spec table and the copy object.
  - Integration `pg-version-repository.test.ts` "lists a form's versions oldest first, none for a malformed id"; `pg-form-repository.test.ts` "lists the forms whose settings use the post plan".
- [ ] **Step 2: Run** `pnpm test src/modules/definitions src/shared/presentation` and `pnpm test:integration tests/integration/definitions`: the new cases fail.
- [ ] **Step 3: Implement.** The setting in `settingsSchema` (no migration: settings are jsonb, the default fills old rows when parsed). `loadState` in `publish-form.ts` passes `postPlan: form.settings.usePostPlan`. `laterPhotosCovered` loads the current version and calls `versionCoversConsentItem(doc, registry, "later_photos")`; `openForm` sets it. `PgVersionRepository.listByForm` orders by `number`; `PgFormRepository.listUsingPostPlan` filters `(settings->>'usePostPlan')::boolean is true`. Settings tab: a new bordered section "Post plan" after Responses with the checkbox `usePostPlan`, its hint, and the notice as a warning `Banner` when on and not covered (the tab page passes `overview.laterPhotosCovered`). `FormOverview` drops `SubmissionsPlaceholder`; until Task 25 the overview page renders no tab body. Fakes: `InMemoryVersionRepository.listByForm`, `InMemoryFormRepository.listUsingPostPlan`.
- [ ] **Step 4: Run** `pnpm test src/modules/definitions src/shared src/app && pnpm test:integration tests/integration/definitions && pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(definitions): use submissions in the post plan setting, versions of a form and post-plan forms`

---
### Task 5: Shared: the job administration port

**Files:**
- Create: `src/shared/application/ports/job-admin.ts`, `src/shared/infrastructure/jobs/pg-job-admin.ts`
- Modify: `src/shared/application/testing/fakes.ts` (`InMemoryJobAdmin`)
- Test: `tests/integration/jobs/pg-job-admin.test.ts`, `src/shared/application/testing/fakes.test.ts`

**Interfaces:**
- Consumes: the `job` and `worker_heartbeat` tables (`0001_job.sql`, `0002_worker_heartbeat.sql`), `txOf` (`src/shared/infrastructure/postgres/tx.ts`).
- Produces:

```ts
// ports/job-admin.ts
export interface DeadJob {
  id: string;
  type: string;
  payload: JobPayload;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}
/** Operator actions on the outbox. See specs/use-cases/operate-jobs.md. */
export interface JobAdmin {
  /** Dead jobs, the most recently dead first, at most `limit`. */
  listDead(limit: number): Promise<DeadJob[]>;
  /** Dead jobs whose payload names the submission or one of the media ids. */
  deadFor(ref: { submissionId: string; mediaIds: readonly string[] }): Promise<DeadJob[]>;
  /** How many jobs of the type are dead, and the newest `limit` of them. */
  deadOfType(type: string, limit: number): Promise<{ count: number; jobs: DeadJob[] }>;
  /** Dead to pending: attempts 0, run_at now, lock, finished_at and unique_key cleared. The job's type, or null when it was not dead. */
  retry(uow: UnitOfWork, id: string, now: Date): Promise<string | null>;
  /** Dead to discarded with the reason and finished_at now. The job's type, or null when it was not dead. */
  discard(uow: UnitOfWork, id: string, reason: string, now: Date): Promise<string | null>;
  /** Retries every dead job of the type; returns their ids. */
  retryAllOfType(uow: UnitOfWork, type: string, now: Date): Promise<string[]>;
  heartbeatAgeSeconds(now: Date): Promise<number | null>;
}
export class PgJobAdmin implements JobAdmin { constructor(pool: Pool) }
// testing/fakes.ts
export class InMemoryJobAdmin implements JobAdmin {
  readonly jobs: (DeadJob & { status: "dead" | "pending" | "discarded"; discardReason: string | null })[];
  heartbeatAge: number | null;   // returned as is
  add(job: Partial<DeadJob> & { id: string; type: string }): void;   // a dead job, defaults filled
}
```

- [ ] **Step 1: Failing tests.** `tests/integration/jobs/pg-job-admin.test.ts`, each on a truncated database with jobs inserted by SQL (`insert into job (id, type, payload, status, attempts, max_attempts, last_error, unique_key, created_at, finished_at)`), `NOW = 2026-10-18T12:00:00Z`:
  - "lists dead jobs newest first and ignores other statuses": dead A finished 10:00, dead B 11:00, pending C, failed D → `[B, A]`; `listDead(1)` → `[B]`.
  - "finds a story's dead jobs by submission id or media id": dead `email.staff_notification {submissionId: S}`, dead `media.upload {mediaId: M1}`, dead `media.upload {mediaId: OTHER}` → `deadFor({ submissionId: S, mediaIds: [M1, M2] })` returns the first two; a non-UUID submission id returns `[]`.
  - "counts dead jobs of a type": three dead `media.upload`, one dead `email.staff_notification` → `deadOfType("media.upload", 2)` is `{ count: 3, jobs: <the two newest> }`.
  - "retry resets a dead job and clears its unique key": dead with `attempts 36`, `unique_key 'k'`, a lock and `finished_at` → `retry` gives `"media.upload"`; the row is `pending`, `attempts 0`, `run_at = NOW`, `locked_at`, `locked_by`, `finished_at`, `unique_key` null, `last_error` unchanged; a second `retry` null; `retry` of a pending job null; a malformed id null.
  - "retry commits with the unit of work": `uow.run` that retries then throws leaves the job dead.
  - "discard records the reason": `discard(uow, id, "provider gone", NOW)` → `discarded`, `discard_reason = 'provider gone'`, `finished_at = NOW`, the type returned; a pending job → null.
  - "retries all dead jobs of one type and returns their ids": two dead `media.upload`, one dead `email.staff_notification` → two ids, the email job still dead.
  - "reports the heartbeat age": no rows → null; a row at 11:59:30 → 30.
  In `fakes.test.ts`, "InMemoryJobAdmin behaves like the adapter": `add` then `retry`, `discard`, `deadFor`, `deadOfType` on the same cases as above (status changes, ordering by `finishedAt`).
- [ ] **Step 2: Run** `pnpm test:integration tests/integration/jobs/pg-job-admin.test.ts && pnpm test src/shared/application`: they fail.
- [ ] **Step 3: Implement** the port as in Interfaces, the adapter with one statement per method (`deadFor` matches `payload->>'submissionId' = $1 or payload->>'mediaId' = any($2::text[])`, UUID-checking the inputs with `isUuid` first; writes go through `txOf(uow).client`), and the fake.
- [ ] **Step 4: Run** the two commands of Step 2, then `pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): job administration port for dead jobs, retry, discard and heartbeat`

---

### Task 6: Shared: dead jobs raise a grouped alert job in the same transaction

**Files:**
- Create: `src/shared/infrastructure/jobs/dead-alert.ts`
- Modify: `src/shared/infrastructure/jobs/pg-job-store.ts`
- Test: `src/shared/infrastructure/jobs/dead-alert.test.ts`, `tests/integration/jobs/pg-job-store.test.ts`, `tests/integration/jobs/worker.test.ts`

**Interfaces:**
- Consumes: `PgJobStore.fail`, `markDead` (existing), the `job` table's partial unique index.
- Produces:

```ts
// dead-alert.ts
export interface AlertSlot { key: string; runAt: Date }
/** `<alertType>:<jobType>:<YYYY-MM-DDTHH>` for the hour of `now` (UTC) and the next hour, whose run_at is that hour's start. */
export function deadAlertSlots(alertType: string, jobType: string, now: Date): { current: AlertSlot; next: AlertSlot };
// pg-job-store.ts
export interface DeadAlertOptions { type: string; maxAttempts: number }
// constructor(pool, clock, opts: { leaseSeconds: number; deadAlert?: DeadAlertOptions })
```

Decision (ADR 0029): the dead write and the alert insert share one transaction on one connection, so an alert can never be lost between them. With `deadAlert` unset (the web container, existing tests) nothing changes.

- [ ] **Step 1: Failing tests.** `dead-alert.test.ts`, "names the current and next hour slots": `deadAlertSlots("email.job_alert", "media.upload", new Date("2026-10-18T10:59:59Z"))` is `{ current: { key: "email.job_alert:media.upload:2026-10-18T10", runAt: 2026-10-18T10:59:59Z }, next: { key: "email.job_alert:media.upload:2026-10-18T11", runAt: 2026-10-18T11:00:00Z } }`; at `2026-12-31T23:30:00Z` the next key is `...:2027-01-01T00`.
  In `pg-job-store.test.ts`, a new `describe("dead alerts")` with a store built with `deadAlert: { type: "email.job_alert", maxAttempts: 36 }`:
  - "enqueues one alert when a job goes dead": claim a `media.upload` at its last attempt, `fail` → `dead`; one pending `email.job_alert` with payload `{ jobType: "media.upload" }`, `max_attempts 36`, `run_at = NOW`, key `email.job_alert:media.upload:2026-10-10T12`.
  - "markDead raises the alert too": `markDead` on a claimed job → same alert row.
  - "coalesces deaths of one type within the hour and schedules the next hour once": three jobs of one type die at 12:00, 12:10 (after marking the first alert `succeeded`) and 12:20 → alert rows: the 12:00 one (succeeded) and one pending for `...T13` with `run_at 13:00:00`; no third row.
  - "a death while the hour's alert is still waiting adds nothing": two jobs of one type die at 12:00 and 12:05 with the first alert still `pending` → one alert row.
  - "keeps types apart": a dead `media.upload` and a dead `email.staff_notification` give two alert rows.
  - "an alert job going dead raises no alert": an `email.job_alert` at its last attempt fails → it is dead and no other `email.job_alert` row exists.
  - "a lost outcome raises nothing": a fenced-out `fail` (another worker reclaimed) answers `lost` and inserts no alert.
  - "without deadAlert no alert is written": the existing store, a dead job, zero alert rows.
  - "rolls back the dead write when the alert insert fails": a store with `deadAlert: { type: "email.job_alert", maxAttempts: Number.NaN }` (Postgres refuses `NaN` as an integer) → `fail` at the last attempt rejects, the job is still `running` and no alert row exists.
  In `tests/integration/jobs/worker.test.ts`, "a handler that dies at its last attempt leaves an alert for its type": a worker with the alert store and a throwing handler for `probe.fail`, a job at `attempts = max_attempts - 1`, one `tick()` → one pending `email.job_alert` `{ jobType: "probe.fail" }`.
- [ ] **Step 2: Run** `pnpm test src/shared/infrastructure/jobs/dead-alert.test.ts && pnpm test:integration tests/integration/jobs`: they fail.
- [ ] **Step 3: Implement.** `markDead` and the dead branch of `fail` run, with `deadAlert` set, on one client in `begin`/`commit`: the fenced update `returning type`; when a row came back and its type is not `deadAlert.type`, `raiseAlert(client, type, now)`: `select status from job where unique_key = $current` → absent: insert the current slot (`run_at` now); `pending` or `running`: nothing; finished (`succeeded`, `failed`, `dead`, `discarded`): insert the next slot when no job has its key; each insert uses the existing `on conflict (unique_key) where status in ('pending','running') and unique_key is not null do nothing`; the job id is `crypto.randomUUID()` as the heartbeat does. Any error rolls back and rethrows (the worker's outer catch already logs "could not record job outcome" and the lease releases the job).
- [ ] **Step 4: Run** Step 2's commands, then `pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): dead jobs enqueue a grouped alert job in the same transaction`

---

### Task 7: Notifications: the job alert email

**Files:**
- Create: `src/modules/notifications/application/ports/alert-source.ts`, `src/shared/presentation/email/job-alert.ts`
- Modify: `src/modules/notifications/application/jobs.ts`, `deps.ts`, `ports/email-renderer.ts`, `index.ts`, `testing/fakes.ts`
- Modify: `src/shared/presentation/email/copy.ts`, `index.ts`
- Modify: `src/app/config.ts` (`ALERT_EMAIL`), `.env.example`, `src/app/modules.ts` and `src/app/worker.ts` (the `alerts` parameter, a null source until Task 19)
- Test: `src/modules/notifications/application/jobs.test.ts`, `src/shared/presentation/email/email.test.ts`, `copy.test.ts`, `src/app/config.test.ts`

**Interfaces:**
- Consumes: `deliver` inside `jobs.ts` (generalized below).
- Produces:

```ts
// ports/email-renderer.ts
export interface JobAlertData {
  jobType: string;
  count: number;
  /** Story references, sorted, at most 20. */
  references: string[];
  /** Affected stories beyond the 20 shown. */
  moreCount: number;
  link: string;
}
// EmailRenderer gains: jobAlert(data: JobAlertData): RenderedEmail;
// ports/alert-source.ts
/** What an alert needs, read when its job runs; null when there is nothing to send. Implemented by review. */
export interface AlertSource {
  jobAlert(jobType: string): Promise<{ to: string[]; data: JobAlertData } | null>;
}
// deps.ts: NotificationsDeps gains  alerts: AlertSource;
// jobs.ts
export const EMAIL_JOB_TYPES = { submitterConfirmation: "...", staffNotification: "...", jobAlert: "email.job_alert" } as const;
/** Job `email.job_alert`, payload `{ jobType }`; delivery key `email.job_alert:<job id>`. */
export function createJobAlertHandler(deps: NotificationsDeps): JobHandler;
// shared/presentation/email/job-alert.ts
export interface JobAlertEmailData { jobType: string; count: number; references: string[]; moreCount: number; link: string }   // structural twin
export function renderJobAlert(data: JobAlertEmailData): EmailParts;
// copy.ts
export const alertParts = { Subject, Preheader, Intro, References, More, Link, Footer } as const;  // English, from email.md
// config.ts: AppConfig gains  alertEmail: string | null;   // ALERT_EMAIL, z.email().optional(); required when NODE_ENV=production
// testing/fakes.ts: StubAlertSource (returns what `next` holds), stubRenderer.jobAlert
```

- [ ] **Step 1: Failing tests.**
  - `jobs.test.ts`, "sends one alert per alert job and records it under the job id": `StubAlertSource` returning `{ to: ["alerts@example.com"], data: { jobType: "media.upload", count: 3, references: ["HP-0001"], moreCount: 0, link: "https://forms.example.com/admin/operations" } }`; running the handler with `handlerContext({ jobId: "job-9" })` twice sends once and the delivery log holds `email.job_alert:job-9`.
  - "sends nothing when the source has nothing": source returns null → no send, no delivery row.
  - "fails permanently without a job type": payload `{}` → `PermanentJobError`.
  - `email.test.ts`, snapshot "job alert, with references and more": the data above with `references` of 20 and `moreCount: 4`; and "job alert without references" leaves out the References and More lines. Both check that neither body contains `@` and that the HTML escapes `<` in a job type.
  - `copy.test.ts`, "matches the Job alert fixed parts": `alertParts` equals `specTableRows("specs/system/email.md", "Job alert, fixed parts")`.
  - `config.test.ts`, "reads ALERT_EMAIL and requires it in production": absent in test → `alertEmail: null`; set → the address; a production environment without it → throws `Invalid configuration: ALERT_EMAIL is required in production`.
- [ ] **Step 2: Run** `pnpm test src/modules/notifications src/shared/presentation/email src/app/config.test.ts`: they fail.
- [ ] **Step 3: Implement.** Generalize `deliver(deps, ctx, key, build)` to take the delivery key (the two existing handlers pass `<type>:<submissionId>`, unchanged). `createJobAlertHandler` reads `payload.jobType` (string, else `PermanentJobError("payload has no jobType")`), asks `deps.alerts.jobAlert`, renders with `deps.renderer.jobAlert` and delivers under `email.job_alert:${ctx.jobId}`. `renderJobAlert` follows `renderStaffNotification`'s structure: `fillTemplate` with `{ "job type", count, refs, n, link }`, `refs` joined with `, `, the More line appended to the References line, subject stripped of line breaks, English document, footer. `emailTemplates.jobAlert = renderJobAlert`. `.env.example` documents `ALERT_EMAIL` ("Where dead-job alerts go; required in production").
- [ ] **Step 4: Run** Step 2's command and `pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS. (`src/app/modules.ts` will not compile until it passes `alerts`; give `buildNotifications` a fourth parameter `alerts: AlertSource` now and pass `{ jobAlert: () => Promise.resolve(null) }` from `worker.ts` until Task 19 wires the real source.)
- [ ] **Step 5: Commit** `feat(notifications): grouped dead-job alert email to ALERT_EMAIL`

---
### Task 8: Media: reading files back, thumbnails, deletes and the staff key scheme

**Files:**
- Create: `src/modules/media/application/read-media.ts`, `delete-media.ts`
- Modify: `src/modules/media/application/ports/media-storage.ts`, `ports/image-encoder.ts`, `ports/media-repository.ts`, `index.ts`, `testing/fakes.ts`
- Modify: `src/modules/media/domain/keys.ts`
- Modify: `src/modules/media/infrastructure/local-disk-storage.ts`, `dropbox-storage.ts`, `sharp-image-encoder.ts`, `pg-media-repository.ts`
- Modify: `tests/fakes/dropbox-api.ts` (temporary links served by the fake itself)
- Test: `domain/keys.test.ts`, `application/read-media.test.ts`, `application/delete-media.test.ts`, `infrastructure/sharp-image-encoder.test.ts`, `tests/integration/media/local-disk-storage.test.ts`, `dropbox-storage.test.ts`, `pg-media-repository.test.ts`

**Interfaces:**
- Consumes: `MEDIA_JOB_TYPES`, `MEDIA_JOB_MAX_ATTEMPTS`, `MediaRecord`.
- Produces:

```ts
// ports/media-storage.ts — MediaStorage gains
/** The stored bytes as a stream; rejects when the file is missing. Dropbox reads its temporary link server-side. */
openRead(ref: string): Promise<ReadableStream<Uint8Array>>;
// ports/image-encoder.ts — ImageEncoder gains
/** WebP at most `maxSide` px on the longer side, metadata stripped; null when the bytes do not decode. */
thumbnail(bytes: Uint8Array, contentType: string, maxSide: number): Promise<Uint8Array | null>;
// ports/media-repository.ts
listBySubmission(submissionId: string, uow?: UnitOfWork): Promise<MediaRecord[]>;
// domain/keys.ts
/** forms/<slug>/<reference>/staff-<nn>-<first 8 hex of fileId>.<ext> */
export function addedFileKey(parts: { formSlug: string; reference: string; position: number; fileId: string; ext: string }): string;
// application/read-media.ts
export const THUMBNAIL_MAX_SIDE = 320;
export const VIEW_URL_TTL_SECONDS = 4 * 60 * 60;
export function findMedia(deps: Pick<MediaDeps, "media">, mediaId: string): Promise<MediaRecord | null>;
export function listSubmissionMedia(deps: Pick<MediaDeps, "media">, submissionId: string, uow?: UnitOfWork): Promise<MediaRecord[]>;
/** The staging copy when it is still there, else the durable file once stored; null when neither exists. */
export async function openMedia(deps: MediaDeps, record: MediaRecord): Promise<ReadableStream<Uint8Array> | null>;
/** A 320 px WebP of an image record; null for a video, a missing file or bytes that do not decode. */
export async function mediaThumbnail(deps: MediaDeps, record: MediaRecord): Promise<Uint8Array | null>;
/** The provider's view URL of a stored video with no staging copy left; null otherwise (stream it instead). */
export async function videoViewUrl(deps: MediaDeps, record: MediaRecord): Promise<string | null>;
/** A durable file by key, for the local view route; null for a key outside `forms/` or a missing file. */
export async function openStoredKey(deps: MediaDeps, key: string): Promise<ReadableStream<Uint8Array> | null>;
// application/delete-media.ts
/** Enqueues `media.delete` for every media row of the submission, staff photos included; returns how many. */
export async function enqueueSubmissionMediaDeletes(deps: Pick<MediaDeps, "media" | "queue">, uow: UnitOfWork, submissionId: string): Promise<number>;
export async function enqueueMediaDelete(deps: Pick<MediaDeps, "queue">, uow: UnitOfWork, mediaId: string): Promise<void>;
```

Decision (Planner's call): `listBySubmission` reads on the unit of work's connection when given one, so a delete and a staff upload holding the submission row lock see the same rows.

- [ ] **Step 1: Failing tests.**
  - `keys.test.ts`, "names a staff file apart from the sender's": `addedFileKey({ formSlug: "historia", reference: "HP-0042", position: 3, fileId: "3f2a9c1d-0000-4000-8000-000000000001", ext: "jpg" })` is `forms/historia/HP-0042/staff-03-3f2a9c1d.jpg`; for every `durableKey` of positions 1 to 99 the file name never starts with `staff-`.
  - `read-media.test.ts` on `makeMediaDeps()` (fake storage holds `staging` and `durable` maps):
    - "opens the staging copy first, else the durable file": a row with both → staging bytes; `stagingRef: null`, `status: "stored"` → durable bytes; `failed` with no staging → null.
    - "makes a thumbnail of images only": `FakeEncoder.thumbnail` returns `thumb:<n>` → `mediaThumbnail` of an image row gives it with `maxSide 320`; a video row → null; a missing file → null.
    - "gives a view URL only for a stored video without a staging copy": stored video, no staging → `memory://<providerRef>`; with staging → null; an image → null.
    - "opens a stored key only under forms/": `forms/s/HP-0001/01-x.jpg` present → bytes; `in-progress/a/b.jpg` → null; `forms/../x` → null.
  - `delete-media.test.ts`, "enqueues one media.delete per row, staff photos included": rows at field keys `photos` (2) and `staff-photos` (1) → returns 3, `queue.ofType("media.delete")` has the three ids with `maxAttempts: 36`.
  - `sharp-image-encoder.test.ts`, "makes a WebP thumbnail without metadata": `syntheticJpegWithGps(1200, 800)` → WebP, longest side 320, `sharp(...).metadata()` shows no `exif`; garbage bytes → null.
  - Integration: `local-disk-storage.test.ts` "streams a stored file and rejects a missing one"; `dropbox-storage.test.ts` "streams a file through its temporary link" (the fake now answers `files/get_temporary_link` with `<fake base>/dl/<path>` and serves the uploaded bytes there); `pg-media-repository.test.ts` "lists a submission's rows on the unit of work's connection, staff photos included" (a row inserted inside an open `uow.run` is listed when that `uow` is passed, and its `staff-photos` row is in the list).
- [ ] **Step 2: Run** `pnpm test src/modules/media && pnpm test:integration tests/integration/media`: they fail.
- [ ] **Step 3: Implement** as in Interfaces. Local `openRead`: `Readable.toWeb(createReadStream(this.resolve(ref)))` after a `stat` (missing file rejects). Dropbox `openRead`: `viewUrl(ref, VIEW_URL_TTL_SECONDS)`, then `fetch` with the 60 second timeout, non-2xx rejects naming only the status. Sharp `thumbnail`: `.rotate().resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true }).webp({ quality: 70 })`. `openStoredKey` refuses keys that do not start with `forms/` or contain `..`, then `durable.openRead(key)` with a rejection mapped to null. Fakes: `InMemoryStorage.openRead` streams the map entry, `FakeEncoder.thumbnail` returns `thumb:<maxSide>` bytes ("broken" input gives null).
- [ ] **Step 4: Run** Step 2's commands, `pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(media): read files back, thumbnails, per-submission deletes and the staff photo key`

---

### Task 9: Submissions: stored submissions for review, curation writes, deletion and the story link

**Files:**
- Create: `src/modules/submissions/application/review-access.ts`
- Modify: `src/modules/submissions/domain/submission.ts`, `application/ports/submission-repository.ts`, `application/index.ts`, `application/testing/fakes.ts`
- Modify: `src/modules/submissions/infrastructure/pg-submission-repository.ts`, `message-source.ts`
- Test: `application/review-access.test.ts`, `tests/integration/submissions/pg-submission-repository.test.ts`, `message-source.test.ts`

**Interfaces:**
- Consumes: `enqueueSubmissionMediaDeletes` (Task 8).
- Produces:

```ts
// domain/submission.ts
export const CURATION_STATUSES = ["new", "viewed", "edited", "published"] as const;
export type CurationStatus = (typeof CURATION_STATUSES)[number];
export interface Curation {
  status: CurationStatus;
  /** Corrected text per field key; text fields only. */
  curatedAnswers: Record<string, string>;
  publishedPostUrl: string | null;
  statusChangedBy: string | null;
  statusChangedAt: Date | null;
}
export interface StoredSubmission extends Submission { curation: Curation }
// ports/submission-repository.ts gains
findStored(id: string): Promise<StoredSubmission | null>;
findByReference(formId: string, reference: string): Promise<StoredSubmission | null>;   // null for a malformed form id
lockForUpdate(uow: UnitOfWork, id: string): Promise<StoredSubmission | null>;
/** Writes the curation columns only; `answers` is never part of the statement. */
writeCuration(uow: UnitOfWork, id: string, curation: Curation): Promise<void>;
delete(uow: UnitOfWork, id: string): Promise<boolean>;
// application/review-access.ts
export function findSubmission(deps: SubmissionsDeps, id: string): Promise<StoredSubmission | null>;
export function findSubmissionByReference(deps: SubmissionsDeps, formId: string, reference: string): Promise<StoredSubmission | null>;
export function lockSubmission(deps: SubmissionsDeps, uow: UnitOfWork, id: string): Promise<StoredSubmission | null>;
export function writeCuration(deps: SubmissionsDeps, uow: UnitOfWork, id: string, curation: Curation): Promise<void>;
/** Inside the caller's unit of work: enqueues media.delete for every media row, then deletes the row (review state cascades). */
export async function deleteSubmission(deps: SubmissionsDeps, uow: UnitOfWork, id: string): Promise<{ deleted: boolean; mediaDeletes: number }>;
```

Decision (Planner's call): curation columns stay on `submission`; `review` writes them only through these use cases. The index comment changes to "`src/app` and `review` import it".

- [ ] **Step 1: Failing tests.**
  - `review-access.test.ts` on `makeSubmissionsDeps()` with a stored story (submit through `submitForm` as the existing submit tests do, or insert a `Submission` into the fake repository):
    - "finds a stored submission by reference with its curation": `{ status: "new", curatedAnswers: {}, publishedPostUrl: null, statusChangedBy: null, statusChangedAt: null }`.
    - "writes curation without touching answers": `writeCuration` with `status: "edited"`, `curatedAnswers: { f_name: "Ana" }` → `findSubmission` shows it, `answers` deep-equal and `JSON.stringify` equal to before.
    - "deletes a submission and enqueues a media delete per row": two sender rows and one `staff-photos` row → `{ deleted: true, mediaDeletes: 3 }`, `findSubmission` null; again → `{ deleted: false, mediaDeletes: 0 }`.
  - Integration `pg-submission-repository.test.ts`:
    - "reads and writes curation columns, and the trigger still guards answers": after `writeCuration`, a raw `update submission set answers = '{}'` still raises `submission answers are immutable`, and `findByReference` returns the new curation.
    - "locks the row for the unit of work": two units of work, the second `lockForUpdate` waits until the first commits (`waitForLockWaiters` from `tests/integration/db.ts`).
    - "finds by reference within the form only": the same reference under another form is not found; a malformed form id gives null.
  - `message-source.test.ts`, "links the staff notification to the story page": `link` is `<publicBaseUrl>/admin/forms/<formId>/submissions/<reference>`.
- [ ] **Step 2: Run** `pnpm test src/modules/submissions && pnpm test:integration tests/integration/submissions`: they fail.
- [ ] **Step 3: Implement.** The Postgres adapter selects the curation columns alongside `COLUMNS` (`status`, `curated_answers`, `published_post_url`, `status_changed_by`, `status_changed_at`), parses `curated_answers` as `z.record(z.string(), z.string())` (corrupt rows throw naming the submission id only), `lockForUpdate` uses `for update`, `writeCuration` is `update submission set status = $2, curated_answers = $3::jsonb, published_post_url = $4, status_changed_by = $5, status_changed_at = $6, updated_at = now() where id = $1`. `deleteSubmission` calls `enqueueSubmissionMediaDeletes(deps.media, uow, id)` before `submissions.delete`. The fake repository stores curation beside each row.
- [ ] **Step 4: Run** Step 2's commands, `pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(submissions): stored submissions, curation writes and deletion for review; story link in the staff email`

---
### Task 10: Review domain: the status ladder, post links, corrections and the word diff

**Files:**
- Create: `src/modules/review/domain/status.ts`, `post-url.ts`, `correction.ts`, `word-diff.ts`
- Test: the four `*.test.ts` beside them

**Interfaces:**
- Consumes: `graphemeLength` from `@/shared/domain/form-model`.
- Produces:

```ts
// status.ts — the domain twin of submissions' CurationStatus (review's domain may not import another module)
export const REVIEW_STATUSES = ["new", "viewed", "edited", "published"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export function statusAfterOpen(s: ReviewStatus): ReviewStatus;                       // new -> viewed, else unchanged
export function statusAfterEdit(s: ReviewStatus): ReviewStatus;                       // published stays, else edited
export function statusAfterRevert(s: ReviewStatus, remainingCorrections: number): ReviewStatus;  // edited with 0 left -> viewed
export function statusAfterUnpublish(corrections: number): ReviewStatus;              // > 0 edited, else viewed
// post-url.ts
export const POST_URL_MAX = 2048;
export type PostUrlResult = { ok: true; url: string | null } | { ok: false };
export function parsePostUrl(input: string): PostUrlResult;
// correction.ts
export type CorrectionCheck = { ok: true; text: string } | { ok: false; code: "correction_blank" | "correction_too_long"; max: number };
/** CRLF and CR become LF; blank after trimming is refused; the limit counts graphemes. */
export function checkCorrection(text: string, maxLength: number): CorrectionCheck;
// word-diff.ts
export type DiffPart = { kind: "same" | "added" | "removed"; text: string };
/** Word-level differences: tokens are runs of non-space or of space; adjacent parts of one kind are merged. */
export function wordDiff(original: string, corrected: string): DiffPart[];
/** A removed part directly followed by an added part counts as one change. */
export function changeCount(parts: readonly DiffPart[]): number;
```

- [ ] **Step 1: Failing tests.**
  - `status.test.ts`, "walks the ladder from curate-submission.md": `statusAfterOpen("new") === "viewed"`, `statusAfterOpen("edited") === "edited"`; `statusAfterEdit("new")`, `("viewed")` → `edited`, `("published")` → `published`; `statusAfterRevert("edited", 0) === "viewed"`, `("edited", 1) === "edited"`, `("published", 0) === "published"`; `statusAfterUnpublish(0) === "viewed"`, `(2) === "edited"`.
  - `post-url.test.ts`, "accepts https links and blanks only": `""` and `"   "` → `{ ok: true, url: null }`; `" https://www.instagram.com/p/abc/ "` → the trimmed URL; `"http://x.example"`, `"javascript:alert(1)"`, `"https://"`, `"instagram.com/p/abc"`, and a 2,049-character https URL → `{ ok: false }`.
  - `correction.test.ts`, "normalizes line ends and enforces the field's limit": `"Hola\r\nmundo"` → `"Hola\nmundo"`; `"  \n "` → `correction_blank`; with `maxLength 5`, `"👨‍👩‍👧‍👦abcd"` (5 graphemes) is ok and `"abcdef"` is `{ ok: false, code: "correction_too_long", max: 5 }`.
  - `word-diff.test.ts`:
    - "finds no change in equal texts": `wordDiff("Una historia.", "Una historia.")` → `[{ kind: "same", text: "Una historia." }]`, `changeCount` 0.
    - "marks a replaced word as one change": `wordDiff("Nacio en el hospital", "Nació en el hospital")` → `[{ removed "Nacio" }, { added "Nació" }, { same " en el hospital" }]`, `changeCount` 1.
    - "keeps insertions and deletions apart": `wordDiff("a b c", "a c d")` → `same "a "`, `removed "b "`, `same "c"`, `added " d"`, two changes.
    - "reassembles both texts": for twenty seeded random pairs of Spanish sentences, joining `same`+`removed` gives the original and `same`+`added` the corrected text.
    - "handles a 20,000-character answer quickly": two `long_text`-sized texts differing in ten words diff in under 200 ms.
- [ ] **Step 2: Run** `pnpm test src/modules/review/domain`: they fail.
- [ ] **Step 3: Implement.** `parsePostUrl` trims, parses with `URL`, requires `protocol === "https:"`, a non-empty host and the length cap. `wordDiff` uses Myers' O(ND) diff over the tokens of `/\S+|\s+/g` (the corrections are small, so D stays small), then merges adjacent parts of one kind.
- [ ] **Step 4: Run** `pnpm test src/modules/review && pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): curation status ladder, post links, correction checks and word diff`

---

### Task 11: Review domain: readiness, days, the plan rules, list queries, CSV and the audit list

**Files:**
- Create: `src/modules/review/domain/readiness.ts`, `days.ts`, `plan.ts`, `list-query.ts`, `staff-photos.ts`, `csv.ts`, `audit.ts`, `heartbeat.ts`
- Test: the `*.test.ts` beside them

**Interfaces:**
- Consumes: `ReviewStatus` (Task 10).
- Produces:

```ts
// readiness.ts
export interface StoryChecks {
  chosen: readonly string[];               // media ids, sorted and unique
  photosEditedFor: readonly string[] | null;   // the chosen set when "edited" was ticked
  textCheckedAt: Date | null;
}
export interface Readiness { photosChosen: boolean; photosEdited: boolean; textChecked: boolean; ready: boolean; done: 0 | 1 | 2 | 3 }
export const NO_CHECKS: StoryChecks;       // { chosen: [], photosEditedFor: null, textCheckedAt: null }
export function readiness(c: StoryChecks): Readiness;
/** Ticked once but the chosen set has changed since. */
export function editedStale(c: StoryChecks): boolean;
export function normalizeIds(ids: readonly string[]): string[];
export function withChoice(chosen: readonly string[], mediaId: string, chosenNow: boolean): string[];
// days.ts
export type IsoDate = string;              // YYYY-MM-DD
export const PLAN_TIME_ZONE = "America/Panama";
export function parseIsoDate(value: string): IsoDate | null;   // a real calendar date, years 2000 to 2100
export function todayIn(timeZone: string, now: Date): IsoDate;
export function addDays(date: IsoDate, n: number): IsoDate;
export function mondayOf(date: IsoDate): IsoDate;
export function weekDays(monday: IsoDate): IsoDate[];         // seven dates
// plan.ts
export interface PlanSlot { submissionId: string; reference: string; plannedOn: IsoDate | null }
export type PlanResolution = "swap" | "move";
export type PlanDecision =
  | { kind: "write"; writes: { submissionId: string; plannedOn: IsoDate | null }[] }   // in this order
  | { kind: "conflict"; other: PlanSlot; canSwap: boolean };
export function decidePlan(input: { story: PlanSlot; date: IsoDate | null; holder: PlanSlot | null; resolution: PlanResolution | null }): PlanDecision;
/** The day a story counts as published on. */
export function publishDay(plannedOn: IsoDate | null, today: IsoDate): IsoDate;
/** The planned date after Unmark: kept when it had one and the day is free, else null. */
export function plannedAfterUnpublish(input: { plannedOn: IsoDate | null; dayHeldByOther: boolean }): IsoDate | null;
// list-query.ts
export const LIST_PAGE_SIZE = 50;
export const PLAN_FILTERS = ["planned", "waiting", "not_ready"] as const;
export type PlanFilter = (typeof PLAN_FILTERS)[number];
export interface ListQuery {
  status: ReviewStatus | null; plan: PlanFilter | null; from: IsoDate | null; to: IsoDate | null;
  version: number | null; media: boolean; q: string | null; page: number;
}
export const EMPTY_QUERY: ListQuery;
export function parseListQuery(params: Readonly<Record<string, string | string[] | undefined>>): ListQuery;
/** Canonical `?key=value&...` in the order status, plan, from, to, version, media, q, page; defaults left out; "" when empty. */
export function listQueryString(q: ListQuery, over?: Partial<ListQuery>): string;
// staff-photos.ts
export const STAFF_PHOTOS_FIELD_KEY = "staff-photos";
export const STAFF_PHOTO_SOURCES = ["whatsapp", "instagram", "email", "other"] as const;
export type StaffPhotoSource = (typeof STAFF_PHOTO_SOURCES)[number];
export const MAX_STAFF_UPLOAD_FILES = 10;
export const MAX_STAFF_PHOTOS = 30;
export const STAFF_FILE_MAX_BYTES = 10 * 1024 * 1024;
export function parseSource(value: string): StaffPhotoSource | null;
// csv.ts
export const CSV_BOM = "﻿";
export const EXPORT_ROW_CAP = 10_000;
export function csvCell(value: string): string;
export function csvLine(cells: readonly string[]): string;   // cells joined by "," and ended with "\r\n"
// audit.ts
export const reviewAuditActions = [
  "submissions_listed", "submission_viewed", "photo_viewed", "media_downloaded", "submissions_exported",
  "submission_deleted", "submission_edited", "submission_reverted", "submission_status_changed",
  "staff_photos_added", "staff_photo_removed", "photo_choice_changed", "story_check_changed", "story_planned",
  "post_plan_viewed", "job_retried", "job_discarded", "jobs_retried_bulk",
] as const;
export type ReviewAuditAction = (typeof reviewAuditActions)[number];
// heartbeat.ts
export type HeartbeatState = "ok" | "warning" | "critical";
export function heartbeatState(ageSeconds: number | null): HeartbeatState;   // <= 60 ok, <= 300 warning, else or null critical
```

- [ ] **Step 1: Failing tests.**
  - `readiness.test.ts`:
    - "is ready only with all three": `{ chosen: ["a"], photosEditedFor: ["a"], textCheckedAt: T }` → all true, `done 3`; each one missing → `ready false`, `done 2`.
    - "photos edited counts only for the same chosen set": edited for `["a"]`, chosen `["a", "b"]` → `photosEdited false`, `editedStale true`; chosen `[]`, edited for `[]` → `photosChosen false`, `photosEdited false`.
    - "withChoice adds and removes, keeping the set sorted and unique": `withChoice(["b"], "a", true)` → `["a", "b"]`; again → same; `withChoice(["a","b"], "a", false)` → `["b"]`.
  - `days.test.ts`: "parses only real dates" (`2026-02-29` null, `2028-02-29` ok, `2026-1-5` null, `1999-12-31` null); "finds today in Panama" (`2026-10-19T04:30:00Z` → `2026-10-18`, `05:30Z` → `2026-10-19`); "finds the Monday of a week" (`2026-10-18` Sunday → `2026-10-12`, `2026-10-19` → itself, `2027-01-01` → `2026-12-28`); "lists seven days" from `2026-12-28` to `2027-01-03`.
  - `plan.test.ts`:
    - "plans on a free day": story unplanned, holder null → `write [{ story, "2026-10-21" }]`.
    - "planning the day it already holds writes nothing new": holder is the story → `write [{ story, same date }]`.
    - "asks on a taken day": holder other, no resolution → `conflict`, `canSwap` true when the story has a date, false when not.
    - "swap moves this story off first": story on `10-20`, holder on `10-21` → writes `[{ story, null }, { holder, "2026-10-20" }, { story, "2026-10-21" }]`.
    - "move sends the other to waiting": writes `[{ holder, null }, { story, "2026-10-21" }]`; a swap asked for an unplanned story is treated as move.
    - "clearing writes null": `date: null` → `[{ story, null }]`.
    - "publish day": planned → that date; unplanned → today.
    - "unmark moves the story to waiting when its day was taken meanwhile": `plannedAfterUnpublish({ plannedOn: "2026-10-21", dayHeldByOther: true })` → null; `false` → `"2026-10-21"`; `plannedOn: null` → null.
  - `list-query.test.ts`: "parses known values and drops the rest" (`{ status: "viewed", plan: "not_ready", from: "2026-10-01", to: "nope", version: "2", media: "1", q: "  Ana  ", page: "3" }` → `{ status: "viewed", plan: "not_ready", from: "2026-10-01", to: null, version: 2, media: true, q: "Ana", page: 3 }`; `status: ["new","viewed"]` takes the first; `page: "0"` → 1; `q` cut to 100 characters, blank → null); "writes a canonical query string" (`listQueryString(EMPTY_QUERY)` → `""`; the parsed value above → `?status=viewed&plan=not_ready&from=2026-10-01&version=2&media=1&q=Ana&page=3`; `over: { page: 1 }` drops `page`; `q` is URL-encoded).
  - `csv.test.ts`: "quotes per RFC 4180" (`a,b` → `"a,b"`, `say "hi"` → `"say ""hi"""`, a line break → quoted, plain → as is); "guards cells that a spreadsheet would read as a formula" (`=SUM(A1)` → `'=SUM(A1)`, `+507 0000 0000` → `'+507 0000 0000`, `-3` → `'-3`, `@user` → `'@user`, a leading tab → `'\t...`; `a=b` unchanged); "ends lines with CRLF".
  - `heartbeat.test.ts`: `0`, `60` ok; `61`, `300` warning; `301`, `null` critical.
  - `staff-photos.test.ts`: "the reserved field key can never be a form field key": `keySchema.safeParse(STAFF_PHOTOS_FIELD_KEY).success === false`; `parseSource("instagram")` ok, `"Instagram"` and `"sms"` null.
- [ ] **Step 2: Run** `pnpm test src/modules/review/domain`: they fail.
- [ ] **Step 3: Implement** as in Interfaces. `todayIn` uses `Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })`; date arithmetic works on UTC midnight `Date`s of the ISO string. `csvCell` applies the guard first (prefix `'` when the first character is `=`, `+`, `-`, `@`, tab or CR), then quotes when the value contains `,`, `"`, CR or LF.
- [ ] **Step 4: Run** `pnpm test src/modules/review && pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): readiness, plan rules, calendar days, list queries, CSV cells and audit actions`

---
### Task 12: Review persistence: the migration, three repositories and the module edge

**Files:**
- Create: `src/modules/review/infrastructure/migrations/0010_review.sql`, `pg-story-repository.ts`, `pg-staff-photo-repository.ts`, `pg-edit-repository.ts`
- Create: `src/modules/review/application/ports/story-repository.ts`, `ports/staff-photo-repository.ts`, `ports/edit-repository.ts`
- Modify: `eslint.config.mjs` (`MODULE_DEPS.review` gains `"notifications"`), `tests/boundaries/boundaries.test.ts`
- Test: `tests/integration/review/pg-story-repository.test.ts`, `pg-staff-photo-repository.test.ts`, `pg-edit-repository.test.ts`, `tests/integration/review/factories.ts`

**Interfaces:**
- Consumes: `IsoDate`, `StaffPhotoSource` (Task 11); `seedPublishedForm` (`tests/integration/submissions/factories.ts`).
- Produces:

```ts
// ports/story-repository.ts
export interface StoryRow {
  submissionId: string; formId: string;
  plannedOn: IsoDate | null; publishedOn: IsoDate | null;
  chosen: string[]; photosEditedFor: string[] | null;
  photosEditedBy: string | null; photosEditedAt: Date | null;
  textCheckedBy: string | null; textCheckedAt: Date | null;
}
export const emptyStory: (submissionId: string, formId: string) => StoryRow;
export interface StoryRepository {
  find(submissionId: string): Promise<StoryRow | null>;
  /** Inserts the empty row when missing, then locks it until the unit of work ends. */
  lockOrCreate(uow: UnitOfWork, submissionId: string, formId: string): Promise<StoryRow>;
  /** Takes the day's advisory lock, then returns the unpublished story holding the day, locked, or null. */
  lockDay(uow: UnitOfWork, date: IsoDate): Promise<StoryRow | null>;
  save(uow: UnitOfWork, row: StoryRow, at: Date): Promise<void>;
}
// ports/staff-photo-repository.ts
export interface StaffPhotoRow { id: string; submissionId: string; source: StaffPhotoSource; addedBy: string; createdAt: Date }
export interface StaffPhotoRepository {
  insert(uow: UnitOfWork, row: StaffPhotoRow): Promise<void>;   // sender_confirmed is always true
  listBySubmission(submissionId: string, uow?: UnitOfWork): Promise<StaffPhotoRow[]>;   // oldest first
  delete(uow: UnitOfWork, id: string): Promise<boolean>;
}
// ports/edit-repository.ts
export interface EditRow { id: string; submissionId: string; fieldKey: string; text: string; source: "manual"; editor: string; createdAt: Date }
export interface EditRepository {
  append(uow: UnitOfWork, row: EditRow): Promise<void>;
  /** The newest edit per field key. */
  latestByField(submissionId: string): Promise<Map<string, EditRow>>;
}
export class PgStoryRepository implements StoryRepository { constructor(pool: Pool) }
export class PgStaffPhotoRepository implements StaffPhotoRepository { constructor(pool: Pool) }
export class PgEditRepository implements EditRepository { constructor(pool: Pool) }
// tests/integration/review/factories.ts
export async function seedStoredStory(pool: Pool, over?: { formId?: string; reference?: string; receivedAt?: Date; answers?: Record<string, unknown> }): Promise<{ formId: string; submissionId: string; reference: string }>;
```

Migration `0010_review.sql` (exact):

```sql
-- Owned by review. Every row goes with its submission (on delete cascade). See ADR 0028.
create table story (
  submission_id uuid primary key references submission (id) on delete cascade,
  form_id uuid not null,
  planned_on date,
  published_on date,
  chosen_media uuid[] not null default '{}',
  photos_edited_for uuid[],
  photos_edited_by text,
  photos_edited_at timestamptz,
  text_checked_by text,
  text_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One unpublished story per day across every form in the post plan.
create unique index story_plan_slot_key on story (planned_on)
  where planned_on is not null and published_on is null;
create index story_published_on_idx on story (published_on) where published_on is not null;

create table staff_photo (
  id uuid primary key,
  submission_id uuid not null references submission (id) on delete cascade,
  source text not null check (source in ('whatsapp', 'instagram', 'email', 'other')),
  sender_confirmed boolean not null check (sender_confirmed),
  added_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index staff_photo_submission_idx on staff_photo (submission_id, created_at);

create table submission_edit (
  id uuid primary key,
  submission_id uuid not null references submission (id) on delete cascade,
  field_key text not null,
  text text not null,
  source text not null check (source in ('manual', 'suggested')),
  editor text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index submission_edit_submission_idx on submission_edit (submission_id, field_key, created_at desc);

create function submission_edit_no_update() returns trigger language plpgsql as $$
begin
  raise exception 'submission edits are append-only';
end $$;
create trigger submission_edit_no_update before update on submission_edit
  for each row execute function submission_edit_no_update();
```

- [ ] **Step 1: Failing tests.** Integration, each on a truncated database, with `seedStoredStory`:
  - `pg-story-repository.test.ts`:
    - "creates an empty story on first lock and keeps it": `lockOrCreate` twice → one row, the empty values.
    - "saves sorted arrays and reads them back": `chosen` and `photosEditedFor` round-trip.
    - "refuses a second unpublished story on one day": two stories saved on `2026-10-21` → the second save rejects with a unique violation; a published story (`publishedOn` set) on that day and an unpublished one coexist.
    - "lockDay returns the holder and serializes planners": `lockDay(uow1, d)` inside an open unit of work; a second unit of work's `lockDay(uow2, d)` waits (`waitForLockWaiters`) until the first commits, then sees the first's saved row.
    - "goes with its submission": deleting the submission row deletes the story.
  - `pg-staff-photo-repository.test.ts`: "lists a story's staff photos oldest first and deletes one"; "refuses an unknown source" (raw insert with `'sms'` violates the check); "goes with its submission".
  - `pg-edit-repository.test.ts`: "returns the newest edit per field"; "is append-only" (a raw `update submission_edit set text = 'x'` raises `submission edits are append-only`); "goes with its submission".
  - `tests/boundaries/boundaries.test.ts`, two probes: "allows review to import notifications' public entry point" (`src/modules/review/application/boundary-probe-notifications.ts` importing `EMAIL_JOB_TYPES` from `@/modules/notifications/application`: clean) and "forbids notifications importing review" (`src/modules/notifications/application/boundary-probe-review.ts` importing from `@/modules/review/application`: refused by `boundaries/dependencies`).
- [ ] **Step 2: Run** `pnpm test:integration tests/integration/review && pnpm test tests/boundaries`: they fail.
- [ ] **Step 3: Implement** the migration exactly as above, the three ports and adapters (`lockOrCreate`: `insert ... on conflict (submission_id) do nothing`, then `select ... for update`; `lockDay`: `select pg_advisory_xact_lock(hashtext('story-plan:' || $1))`, then `select ... where planned_on = $1 and published_on is null for update`; arrays as `uuid[]`, sorted by the caller), and the `MODULE_DEPS` edge. `tests/integration/db.ts`'s `truncateAll` already empties every table.
- [ ] **Step 4: Run** Step 2's commands, `pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): story, staff photo and edit history tables with their repositories`

---

### Task 13: Review read model: list, counts, neighbours, the week, waiting stories and export batches

**Files:**
- Create: `src/modules/review/application/ports/review-queries.ts`, `src/modules/review/infrastructure/pg-review-queries.ts`
- Test: `tests/integration/review/pg-review-queries.test.ts`, `tests/integration/review/list-budget.test.ts`

**Interfaces:**
- Consumes: `ListQuery`, `PlanFilter`, `StoryChecks`, `readiness`, `IsoDate` (Task 11); the tables of `0006_media.sql`, `0009_submissions.sql`, `0001_job.sql`, `0010_review.sql`.
- Produces:

```ts
// ports/review-queries.ts
export interface ListFilter {
  formId: string;
  status: ReviewStatus | null;
  plan: PlanFilter | null;            // the application passes null on forms without the post plan
  from: IsoDate | null;               // received on or after, America/Panama days
  to: IsoDate | null;                 // received on or before
  versionId: string | null;
  media: boolean;
  /** Matched case-insensitively as a substring of these answer keys and of the reference. */
  search: { text: string; keys: readonly string[] } | null;
}
export interface ListRow {
  submissionId: string; reference: string; receivedAt: Date; versionId: string; locale: Locale;
  status: ReviewStatus; answers: Record<string, unknown>;
  mediaCount: number;                 // the sender's files only
  plannedOn: IsoDate | null; publishedOn: IsoDate | null;
  checks: StoryChecks; hasDeadJobs: boolean;
}
export interface PlanEntry {
  submissionId: string; formId: string; reference: string; versionId: string; receivedAt: Date;
  answers: Record<string, unknown>; status: ReviewStatus; postUrl: string | null;
  plannedOn: IsoDate | null; publishedOn: IsoDate | null; checks: StoryChecks;
}
export interface ExportSource {
  submissionId: string; reference: string; receivedAt: Date; versionId: string; locale: Locale;
  status: ReviewStatus; answers: Record<string, unknown>; curatedAnswers: Record<string, string>;
  postUrl: string | null; plannedOn: IsoDate | null;
  senderKeys: string[]; staffKeys: string[];   // durable keys, in field and position order, staff photos by creation
}
export interface ReviewQueries {
  /** Newest first by (received_at, id), `LIST_PAGE_SIZE` per page. */
  list(filter: ListFilter, page: number): Promise<{ rows: ListRow[]; total: number }>;
  statusCounts(formId: string): Promise<Record<ReviewStatus, number>>;
  /** References of the nearest newer and older rows under the filter, relative to `at`, whether or not `at` matches. */
  neighbours(filter: ListFilter, at: { receivedAt: Date; submissionId: string }): Promise<{ newer: string | null; older: string | null }>;
  /** Unpublished stories planned in [from, to] and stories published in [from, to], of these forms. */
  week(formIds: readonly string[], from: IsoDate, to: IsoDate): Promise<PlanEntry[]>;
  /** Unpublished, unplanned stories of these forms, newest first. */
  waiting(formIds: readonly string[], limit: number): Promise<{ rows: PlanEntry[]; total: number }>;
  count(filter: ListFilter): Promise<number>;
  /** Keyset batches in list order; `after` is the last row of the previous batch. */
  exportBatch(filter: ListFilter, after: { receivedAt: Date; submissionId: string } | null, size: number): Promise<ExportSource[]>;
}
export class PgReviewQueries implements ReviewQueries { constructor(pool: Pool) }
```

Decision (Planner's call, ADR 0028): this adapter reads `submission`, `media` and `job` directly, read-only. "Published" in the plan is `story.published_on is not null`; the application keeps it in step with `submission.status` (Task 15). Received-day filters compare `(received_at at time zone 'America/Panama')::date`.

- [ ] **Step 1: Failing tests.** `pg-review-queries.test.ts`, every case seeding through `seedStoredStory`, raw inserts into `media`, `job` and `story`, and `NOW = 2026-10-18T15:00:00Z`:
  - "lists newest first, 50 a page, with the total": 55 stories → page 1 has 50 newest, page 2 has 5, `total 55`.
  - "filters by status, received days, version and files": one case per filter, each returning exactly the seeded matches.
  - "searches the given keys and the reference only": answers `{ f_name: "Ana Prueba", f_story: "Ana" }` with keys `["f_name"]` → found by `"ana"`; keys `["f_other"]` → not found; `"HP-0003"` finds by reference; `%` and `_` in the text are literal.
  - "counts only the sender's files": two `photos` rows and one `staff-photos` row → `mediaCount 2`.
  - "flags dead jobs of the story and of its media": a dead `media.upload` for one of its media ids → `hasDeadJobs true`; a `failed` one → false; a dead `email.staff_notification` for the submission → true.
  - "planned, waiting and not_ready": planned unpublished, planned published, unplanned unpublished stories → `planned` gives the first, `waiting` the third; `not_ready` excludes published stories.
  - "not_ready agrees with the domain readiness for every combination": for all eight combinations of chosen (empty or `[m]`), edited-for (null or `[m]`, plus one with `[m2]` against `[m]`) and text checked, the SQL filter returns exactly the stories whose `readiness(checks).ready` is false.
  - "neighbours are found for a story outside the filter": five stories, the middle one `viewed`, filter `status: "new"` → its neighbours are the nearest `new` stories newer and older; the newest story has `newer: null`.
  - "the week holds planned and published stories of the plan's forms only": a form in `formIds` and one not; planned on Tuesday, published on Wednesday without a plan, planned next week → the first two only.
  - "waiting lists unpublished, unplanned stories newest first with the total".
  - "export batches follow list order without gaps": 7 rows in batches of 3 → 3, 3, 1, then `[]`; `senderKeys` in field and position order, `staffKeys` by creation.
  - "a malformed form id or version id lists nothing" (`list`, `count`, `statusCounts` all empty for a non-UUID form id, `list` empty for `versionId: "none"`, no SQL error).
  `list-budget.test.ts`, "lists page 1 of 10,000 submissions within 500 ms": seed 10,000 submissions of one form with `generate_series` (synthetic answers `{"f_name": "Prueba <n>"}`), 2,000 media rows and 50 stories; time `list(filter, 1)` with a search and `count` after one warm-up call; expect under 500 ms.
- [ ] **Step 2: Run** `pnpm test:integration tests/integration/review`: they fail.
- [ ] **Step 3: Implement.** One parameterized `where` builder shared by `list`, `count`, `neighbours` and `exportBatch` (left join `story st on st.submission_id = s.id`); `not_ready` is `st.published_on is null and not (cardinality(coalesce(st.chosen_media, '{}')) > 0 and st.photos_edited_for = st.chosen_media and st.text_checked_at is not null)`; the dead flag is an `exists` over `job` with `status = 'dead'` and `payload->>'submissionId' = s.id::text or payload->>'mediaId' in (select m.id::text from media m where m.submission_id = s.id)`; neighbours are two `limit 1` queries ordered by `(received_at, id)` greater and less than `at`. If the budget test fails, add `create index job_dead_payload_idx on job ((payload->>'mediaId')) where status = 'dead'` as migration `0011_job_dead_idx.sql` (shared) and record it in `database.md`.
- [ ] **Step 4: Run** `pnpm test:integration tests/integration/review && pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): read model for the list, neighbours, the post plan and export batches`

---
### Task 14: Review application: dependencies, fakes, the list and opening a story

**Files:**
- Create: `src/modules/review/application/deps.ts`, `context.ts`, `list.ts`, `open-story.ts`, `ports/zip-writer.ts`, `index.ts`, `testing/fakes.ts`, `testing/fixtures.ts`
- Test: `context.test.ts`, `list.test.ts`, `open-story.test.ts` beside them

**Interfaces:**
- Consumes: `loadForm`, `listVersions`, `laterPhotosCovered`, `Actor`, `Form`, `FormVersion` (definitions); `findSubmissionByReference`, `lockSubmission`, `writeCuration`, `StoredSubmission` (Task 9); `listSubmissionMedia`, `MediaRecord` (Task 8); `JobAdmin` (Task 5); `AuditLog`, `AuditLogReader`, `AuditRecord` (identity); Tasks 10 to 13.
- Produces:

```ts
// deps.ts
export interface ReviewDeps {
  definitions: DefinitionsDeps; submissions: SubmissionsDeps; media: MediaDeps;
  stories: StoryRepository; staffPhotos: StaffPhotoRepository; edits: EditRepository;
  queries: ReviewQueries; jobs: JobAdmin; audit: AuditLog; auditReader: AuditLogReader; zip: ZipWriter;
  uow: UnitOfWorkFactory; clock: Clock; ids: IdGenerator; registry: FieldTypeRegistry;
  /** The post plan's calendar, PLAN_TIME_ZONE in production. */
  planTimeZone: string;
}
// ports/zip-writer.ts
export interface ZipEntry { name: string; modifiedAt: Date; open(): Promise<ReadableStream<Uint8Array> | null> }   // null: skipped
export interface ZipWriter { write(entries: AsyncIterable<ZipEntry>): ReadableStream<Uint8Array> }
// context.ts
export interface FormContext { form: Form; versions: FormVersion[]; postPlan: boolean; laterPhotosAllowed: boolean }
export async function loadFormContext(deps: ReviewDeps, formId: string): Promise<FormContext | null>;
export interface StoryContext { ctx: FormContext; submission: StoredSubmission; version: FormVersion }
export async function loadStory(deps: ReviewDeps, formId: string, reference: string): Promise<StoryContext | null>;
/** The query as a filter for this form: version number to id, the plan filter only on post-plan forms, search keys from every version's `searchable` fields. */
export function listFilterFor(ctx: FormContext, query: ListQuery, registry: FieldTypeRegistry): ListFilter;
/** The first answer of a `label` field of the version, trimmed, or null. */
export function storyLabel(version: Version, registry: FieldTypeRegistry, answers: Record<string, unknown>): string | null;
// list.ts
export interface StoryListRow {
  reference: string; receivedAt: Date; status: ReviewStatus; plannedOn: IsoDate | null; published: boolean;
  label: string | null; mediaCount: number; versionNumber: number; locale: Locale; deadJobs: boolean;
  readiness: Readiness | null;            // null when the form is not in the post plan
}
export interface StoryList { ctx: FormContext; query: ListQuery; rows: StoryListRow[]; total: number; pageCount: number; counts: Record<ReviewStatus, number> }
export async function listStories(deps: ReviewDeps, actor: Actor, input: { formId: string; query: ListQuery }): Promise<StoryList | null>;
// open-story.ts
export interface AnswerView {
  field: Field; languages: Languages; answer: unknown;        // undefined when not answered
  corrected: { text: string; by: string | null; at: Date | null } | null;
  curatable: boolean; maxLength: number | null;               // the field's own max_length rule, else the type's cap
}
export interface AnswerPageView { key: string; title: LocalizedText; answers: AnswerView[] }
export interface PhotoView {
  mediaId: string; kind: MediaKind; status: MediaStatus; durableKey: string; chosen: boolean;
  origin: "sender" | "staff"; staff: { addedBy: string; addedAt: Date; source: StaffPhotoSource } | null;
}
export interface StoryView {
  ctx: FormContext; submissionId: string; reference: string; receivedAt: Date; versionNumber: number; locale: Locale;
  status: ReviewStatus; postUrl: string | null; plannedOn: IsoDate | null; publishedOn: IsoDate | null;
  pages: AnswerPageView[]; photos: PhotoView[];
  checks: StoryChecks; readiness: Readiness; editedStale: boolean;
  photosEditedBy: { by: string; at: Date } | null; textCheckedBy: { by: string; at: Date } | null;
  consent: { textVersion: string; acceptedAt: Date; text: LocalizedText | null } | null;
  deadJobs: { id: string; type: string }[];
  activity: AuditRecord[];                                   // this submission's entries, newest 50
  neighbours: { newer: string | null; older: string | null };
}
export async function openStory(deps: ReviewDeps, actor: Actor, input: { formId: string; reference: string; query: ListQuery }): Promise<StoryView | null>;
// testing/fakes.ts
export class InMemoryStoryRepository implements StoryRepository {}       // save rejects "slot taken" like the unique index
export class InMemoryStaffPhotoRepository implements StaffPhotoRepository {}
export class InMemoryEditRepository implements EditRepository {}
export class FakeReviewQueries implements ReviewQueries {}             // canned answers in listResult, countsResult, neighboursResult,
                                                                       // weekResult, waitingResult, countResult, exportBatches; records `calls`
export class ListingZipWriter implements ZipWriter {}                  // streams the entry names it opened, one per line
export interface FakeReviewDeps extends ReviewDeps { /* the fakes above, FakeSubmissionsDeps, InMemoryJobAdmin, InMemoryAuditLog, InMemoryAuditLogReader, FixedClock */ }
export function makeReviewDeps(): FakeReviewDeps;
// testing/fixtures.ts
export const OWNER: Actor;                                            // { email: "owner@example.com", ip: "203.0.113.9" }
/** storyVersion() with consent item 10 covered, published as `story-form` (prefix ST, post plan on), and one stored story ST-0001
 *  (answers f_name "Ana Prueba", f_email "ana@example.com", f_baby "yes_opt", f_photos [p1, p2], consent) with two image rows
 *  `forms/story-form/ST-0001/01-photos.jpg` (p1, staged) and `02-photos.jpg` (p2, stored). `seedAnotherStory` adds ST-0002. */
export async function seedStory(deps: FakeReviewDeps, over?: { postPlan?: boolean; laterPhotos?: boolean; status?: ReviewStatus }): Promise<{ formId: string; submissionId: string; reference: "ST-0001"; photoIds: [string, string] }>;
export async function seedAnotherStory(deps: FakeReviewDeps, formId: string): Promise<{ submissionId: string; reference: "ST-0002" }>;
```

- [ ] **Step 1: Failing tests.**
  - `context.test.ts`:
    - "loads a form's context": `postPlan` and `laterPhotosAllowed` true for the seeded form; with `laterPhotos: false` the second is false; with `postPlan: false` both false; an unknown form → null.
    - "builds the list filter": `{ version: 1, plan: "planned", q: "ana" }` on a post-plan form → `versionId` of version 1, `plan: "planned"`, `search: { text: "ana", keys: ["f_name", "f_email"] }`; on a form without the plan `plan: null`; an unknown version number → a `versionId` that matches nothing (`"none"`).
    - "names a story by its first label answer": `storyLabel` gives `"Ana Prueba"`; blank or missing → null.
  - `list.test.ts` with `FakeReviewQueries.listResult` holding two rows:
    - "maps rows and records one audit entry per page load": rows carry label, version number and readiness; the audit log holds one `submissions_listed` with target `formId` and details `{ page: 1, count: 2 }`.
    - "computes the page count": `total 101` → `pageCount 3`.
    - "leaves readiness out when the form is not in the plan".
    - "answers null for an unknown form and records nothing".
  - `open-story.test.ts`:
    - "opens a new story as viewed and records the view": status `viewed` in the view and in the repository; one `submission_viewed` targeting the submission; a second open records a second entry and stays `viewed`.
    - "shows answers in page and field order with corrections": `curatedAnswers: { f_name: "Ana P." }` and an edit row → that answer's `corrected` is `{ text: "Ana P.", by: "owner@example.com", at }`, `curatable` true and `maxLength` 5,000 for `f_name` (no `max_length` rule, so the type's cap), the single-choice answer `curatable` false; with a `max_length` rule of 80 added to `f_name` in the fixture variant, `maxLength` is 80.
    - "lists the sender's photos then the staff photos, hiding staff rows pending deletion": two sender rows, two `staff-photos` media rows of which one has a `staff_photo` row → three photos, the staff one with its source and adder.
    - "marks chosen photos and works out readiness": story `chosen: [p1]`, `photosEditedFor: [p1]`, `textCheckedAt` set → `readiness.ready` true; `photosEditedFor: [p2]` → `editedStale` true.
    - "lists the story's dead jobs": `InMemoryJobAdmin.add({ type: "media.upload", payload: { mediaId: p1 } })` → `deadJobs` holds it.
    - "passes the list filter to neighbours": `query: { status: "new" }` → `FakeReviewQueries.calls` has `neighbours` with that filter and the story's received time.
    - "answers null for an unknown reference, another form's reference, or an unknown form, and records nothing".
- [ ] **Step 2: Run** `pnpm test src/modules/review/application`: they fail.
- [ ] **Step 3: Implement.** `openStory` runs one unit of work: `lockSubmission`, `writeCuration` with `statusAfterOpen` when it changes, `audit.record(uow, { action: "submission_viewed", actorEmail, targetId, ip }, now)`; then reads outside it (media, staff photos, story, edits, dead jobs via `jobs.deadFor({ submissionId, mediaIds })`, `auditReader.listByTarget({ targetId, limit: 50 })`, `queries.neighbours`). `index.ts` exports the deps, ports and view types, `listStories`, `openStory`, `loadFormContext`, `reviewAuditActions`, the domain constants and types the presentation needs (`ListQuery`, `parseListQuery`, `listQueryString`, `EMPTY_QUERY`, `PLAN_FILTERS`, `REVIEW_STATUSES`, `STAFF_PHOTO_SOURCES`, `IsoDate`, `Readiness`, `PLAN_TIME_ZONE`, `MAX_STAFF_UPLOAD_FILES`, `MAX_STAFF_PHOTOS`, `wordDiff`, `changeCount`, `DiffPart`, `heartbeatState`).
- [ ] **Step 4: Run** `pnpm test src/modules/review && pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): review dependencies, the submissions list and the story view`

---
### Task 15: Review application: corrections and publishing

**Files:**
- Create: `src/modules/review/application/curation.ts`, `publishing.ts`
- Modify: `src/modules/review/application/index.ts`
- Create: `tests/integration/review/wiring.ts` (`pgReviewDeps(pool, dirs, over?)`: the real adapters of definitions, media, submissions and review over one pool, as `tests/integration/submissions/wiring.ts` does)
- Test: `curation.test.ts`, `publishing.test.ts`, `curation.property.test.ts` beside them; `tests/integration/review/curation.test.ts`

**Interfaces:**
- Consumes: Task 14's `loadStory`, `seedStory`, `makeReviewDeps`, `OWNER`; Task 10's ladder, `checkCorrection`, `parsePostUrl`; Task 11's `publishDay`, `plannedAfterUnpublish`, `todayIn`; Task 12's repositories.
- Produces:

```ts
// curation.ts
export type CorrectionResult =
  | { ok: true; changed: boolean }
  | { ok: false; code: "not_found" | "not_curatable" | "correction_blank" }
  | { ok: false; code: "correction_too_long"; max: number };
/** Text identical to the original stores no correction (changed: false) but still ticks "Text checked". */
export async function saveCorrection(deps: ReviewDeps, actor: Actor, input: { formId: string; reference: string; fieldKey: string; text: string }): Promise<CorrectionResult>;
export async function revertCorrection(deps: ReviewDeps, actor: Actor, input: { formId: string; reference: string; fieldKey: string }): Promise<{ ok: true } | { ok: false; code: "not_found" | "not_corrected" }>;
// publishing.ts
export async function markPublished(deps: ReviewDeps, actor: Actor, input: { formId: string; reference: string; postUrl: string }): Promise<{ ok: true; day: IsoDate } | { ok: false; code: "not_found" | "post_url_invalid" }>;
export type UnmarkResult =
  | { ok: true; status: ReviewStatus; movedToWaiting: boolean; dayHeldBy: string | null }   // the holder's reference
  | { ok: false; code: "not_found" | "not_published" };
export async function unmarkPublished(deps: ReviewDeps, actor: Actor, input: { formId: string; reference: string }): Promise<UnmarkResult>;
```

- [ ] **Step 1: Failing tests.**
  - `curation.test.ts` (each on `makeReviewDeps()` + `seedStory`, clock at `2026-10-18T15:00:00Z`):
    - "saves a correction, marks the story edited and ticks text checked": `saveCorrection(..., { fieldKey: "f_name", text: "Ana  Prueba" })` → `{ ok: true, changed: true }`; curation `status: "edited"`, `curatedAnswers.f_name === "Ana  Prueba"`, `statusChangedBy: "owner@example.com"`; one edit row `source: "manual"`; story `textCheckedAt` set; audit `submission_edited { fieldKey: "f_name", source: "manual" }` and `story_check_changed { check: "text_checked", value: true, by: "correction" }`.
    - "keeps a published story published": status `published` stays after a save.
    - "saving the original text stores no correction": text equal to the answer → `changed: false`, no edit row, status unchanged, text checked ticked.
    - "refuses fields that are not curatable or not answered": `f_baby` → `not_curatable`; a key not in the version → `not_curatable`.
    - "refuses blank and over-long text": `"   "` → `correction_blank`; `"x".repeat(5001)` → `{ code: "correction_too_long", max: 5000 }`; nothing written, no audit.
    - "a second correction on a story already checked does not tick again": one `story_check_changed` only.
    - "reverts to the original and walks back the status": after one correction, `revertCorrection` → `curatedAnswers` without `f_name`, status `viewed`, audit `submission_reverted { fieldKey: "f_name" }`, text checked still set; reverting again → `not_corrected`.
  - `curation.property.test.ts`, "the original stays byte-identical after any edits and reverts": a seeded PRNG (`mulberry32(20261018)`) drives 300 random steps of save (random Spanish words, sometimes the original, sometimes blank or over-long) and revert on `f_name`; after every step `JSON.stringify(stored.answers)` equals the value captured at seeding, and `status` is `edited` exactly when `curatedAnswers` is not empty (or `published`).
  - `publishing.test.ts`:
    - "marks a planned story published on its planned day": `plannedOn: "2026-10-20"` → `day: "2026-10-20"`, status `published`, `publishedPostUrl` the link, story `publishedOn` `2026-10-20`, `plannedOn` kept; audit `submission_status_changed { from: "viewed", to: "published", link: true }`.
    - "uses today in Panama when the story had no date": clock `2026-10-19T03:00:00Z` → `day: "2026-10-18"`.
    - "re-marking replaces the link and keeps the day".
    - "refuses a link that is not https": `post_url_invalid`, nothing written.
    - "unmark returns to edited or viewed": with a correction → `edited`, without → `viewed`; `publishedOn` cleared, the link cleared; audit `{ from: "published", to }`.
    - "unmark keeps the date when the day is free".
    - "unmark moves the story to waiting when its day was taken meanwhile": story A published on `2026-10-20`, story B (ST-0002) then planned on `2026-10-20` → `unmarkPublished(A)` gives `{ movedToWaiting: true, dayHeldBy: "ST-0002" }`, A's `plannedOn` null, B untouched; audit `story_planned { from: "2026-10-20", to: "none" }` for A.
    - "unmark of a story published without a date sends it to waiting".
    - "unmark of an unpublished story is refused": `not_published`.
  - Integration `tests/integration/review/curation.test.ts`, "corrections never change answers in Postgres": `pgReviewDeps`, save and revert twice, then compare `answers::text` before and after.
- [ ] **Step 2: Run** `pnpm test src/modules/review/application && pnpm test:integration tests/integration/review/curation.test.ts`: they fail.
- [ ] **Step 3: Implement.** Each use case loads with `loadStory` (null → `not_found`), validates, then one unit of work: `lockSubmission`, the story row through `lockOrCreate` when it changes, writes, audit entries, in that order. `statusChangedBy`/`statusChangedAt` change only when the status changes. Unmark locks the planned day with `lockDay` before deciding `plannedAfterUnpublish`, and looks up the holder's reference with `findSubmission`.
- [ ] **Step 4: Run** Step 2's commands, `pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): manual corrections, revert, mark and unmark as published`

---

### Task 16: Review application: staff photos, photo choice and the readiness ticks

**Files:**
- Create: `src/modules/review/application/photos.ts`, `checks.ts`
- Modify: `src/modules/review/application/index.ts`
- Test: `photos.test.ts`, `checks.test.ts` beside them; `tests/integration/review/staff-photos.test.ts`

**Interfaces:**
- Consumes: `stageFile`, `attachToSubmission`, `discardRecordFiles`, `extensionFor`, `addedFileKey`, `listSubmissionMedia`, `enqueueMediaDelete` (media); `lockSubmission` (Task 9); Task 11's staff photo constants and `withChoice`.
- Produces:

```ts
// photos.ts
export type AddPhotosRefusal =
  | "not_found" | "post_plan_off" | "consent_missing" | "not_confirmed" | "source_invalid"
  | "no_files" | "too_many_files" | "staff_photos_max";
export type AddPhotosResult =
  | { ok: true; added: number }
  | { ok: false; code: AddPhotosRefusal }
  | { ok: false; code: "file_refused"; file: number; reason: StageRefusal };   // 1-based position of the first refused file
export async function addStaffPhotos(deps: ReviewDeps, actor: Actor, input: { formId: string; reference: string; files: readonly Uint8Array[]; source: string; senderConfirmed: boolean }): Promise<AddPhotosResult>;
export async function removeStaffPhoto(deps: ReviewDeps, actor: Actor, input: { formId: string; reference: string; mediaId: string }): Promise<{ ok: true } | { ok: false; code: "not_found" }>;
export async function choosePhoto(deps: ReviewDeps, actor: Actor, input: { formId: string; reference: string; mediaId: string; chosen: boolean }): Promise<{ ok: true } | { ok: false; code: "not_found" | "post_plan_off" }>;
// checks.ts
export const STORY_CHECKS = ["photos_edited", "text_checked"] as const;
export type StoryCheck = (typeof STORY_CHECKS)[number];
export async function setCheck(deps: ReviewDeps, actor: Actor, input: { formId: string; reference: string; check: StoryCheck; value: boolean }): Promise<{ ok: true } | { ok: false; code: "not_found" | "post_plan_off" | "no_photos_chosen" }>;
```

- [ ] **Step 1: Failing tests.**
  - `photos.test.ts` (`fakeImage`, `syntheticMp4` from `tests/fakes/media-files.ts`):
    - "adds staff photos as media of the story with staff keys and upload jobs": two images, source `whatsapp`, confirmed → `{ ok: true, added: 2 }`; two media rows with `fieldKey: "staff-photos"`, positions 1 and 2, durable keys `forms/story-form/ST-0001/staff-01-<hex>.jpg` and `staff-02-...`; two `media.upload` jobs; two `staff_photo` rows by `owner@example.com`; audit `staff_photos_added { count: 2, source: "whatsapp", senderConfirmed: true }`; the sender's `answers` unchanged.
    - "continues positions after earlier staff photos": a second upload of one file gets position 3.
    - "accepts a video": `syntheticMp4()` → added, kind `video`.
    - "refuses in this order": unknown story `not_found`; post plan off `post_plan_off`; current version without item 10 `consent_missing`; unticked `not_confirmed`; source `sms` `source_invalid`; no files `no_files`; eleven files `too_many_files`; 29 existing plus two `staff_photos_max`; nothing staged for any of them.
    - "is all or nothing when one file is refused": files `[image, html bytes, image]` → `{ code: "file_refused", file: 2, reason: "file_wrong_type" }`, the staging area empty, no rows, no jobs, no audit.
    - "discards staged files when the unit of work fails": `queue.failAt = 0` → the use case rejects and staging is empty.
    - "removes a staff photo, its choice and its file": after adding and choosing it, `removeStaffPhoto` → the `staff_photo` row gone, `chosen` without it, one `media.delete` job, audit `staff_photo_removed { mediaId }`; a sender's photo id → `not_found`.
    - "removing a chosen staff photo unsets photos edited": chosen `[s1]`, `photos_edited` ticked → after removal `readiness.photosChosen` and `photosEdited` both false in `openStory`; with chosen `[p1, s1]` and edited for both, removal leaves `photosChosen` true and `photosEdited` false.
    - "chooses and unchooses a photo": `choosePhoto(p1, true)` → `chosen [p1]`, audit `photo_choice_changed { mediaId: p1, chosen: true }`; repeating writes no second entry; an id of another story → `not_found`; post plan off → `post_plan_off`.
  - `checks.test.ts`:
    - "ticks photos edited for the chosen set": chosen `[p1]` → `photosEditedFor [p1]`, by and at set, audit `story_check_changed { check: "photos_edited", value: true, by: "hand" }`.
    - "refuses photos edited with nothing chosen": `no_photos_chosen`.
    - "ticks and unticks text checked by hand".
    - "unticking clears who and when".
  - Integration `tests/integration/review/staff-photos.test.ts`, "a staff upload and a delete see the same rows": wire real adapters, add one staff photo with real `syntheticJpegWithGps` bytes (the stored file has no EXIF), then `deleteStory` (Task 18 is not there yet, so call `deleteSubmission` inside a unit of work) → `media.delete` jobs for the sender's files and the staff photo; the `staff_photo` row is gone by cascade.
- [ ] **Step 2: Run** `pnpm test src/modules/review/application && pnpm test:integration tests/integration/review/staff-photos.test.ts`: they fail.
- [ ] **Step 3: Implement.** `addStaffPhotos` checks in the order of the test, stages every file under one fresh record id (`deps.ids.newId()`) with `accept: ["image", "video"]` and `STAFF_FILE_MAX_BYTES`, and on any refusal or failure calls `discardRecordFiles`. In the unit of work: `lockSubmission`, re-count staff photos (`listBySubmission(id, uow)`), next position from `listSubmissionMedia(deps.media, id, uow)` rows with the staff key, then `attachToSubmission` with `addedFileKey`, the `staff_photo` rows and the audit entry. A photo belongs to the story when it is a media row of the submission whose field key is not the staff key, or a staff photo with its `staff_photo` row.
- [ ] **Step 4: Run** Step 2's commands, `pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): staff photos with sender confirmation, photo choice and readiness ticks`

---

### Task 17: Review application: planning a story, the week and the stories waiting for a date

**Files:**
- Create: `src/modules/review/application/plan.ts`
- Modify: `src/modules/review/application/index.ts`
- Test: `plan.test.ts` beside it; `tests/integration/review/plan.test.ts`

**Interfaces:**
- Consumes: `decidePlan`, `parseIsoDate`, `todayIn`, `mondayOf`, `weekDays`, `addDays`, `readiness` (Task 11); `listPostPlanForms` (Task 4); `ReviewQueries.week`, `waiting` (Task 13); `storyLabel` (Task 14).
- Produces:

```ts
export type PlanResult =
  | { ok: true; plannedOn: IsoDate | null }
  | { ok: false; code: "not_found" | "post_plan_off" | "date_invalid" | "published" }
  | { ok: false; code: "conflict"; date: IsoDate; other: string; canSwap: boolean };   // other: the holder's reference
export async function planStory(deps: ReviewDeps, actor: Actor, input: { formId: string; reference: string; date: string; resolution: string }): Promise<PlanResult>;   // date "" clears; resolution "", "swap" or "move"
export interface PlanItem {
  formId: string; formTitle: LocalizedText; reference: string; label: string | null;
  readiness: Readiness; postUrl: string | null; plannedOn: IsoDate | null; publishedOn: IsoDate | null;
}
export interface DayView { date: IsoDate; isToday: boolean; isPast: boolean; planned: PlanItem | null; published: PlanItem[] }
export interface WeekView { monday: IsoDate; today: IsoDate; previous: IsoDate; next: IsoDate; days: DayView[]; formsInPlan: number }
/** Records `post_plan_viewed` once per call. */
export async function postPlanWeek(deps: ReviewDeps, actor: Actor, input: { week: string | null }): Promise<WeekView>;
export async function waitingStories(deps: ReviewDeps, input: { limit: number }): Promise<{ rows: PlanItem[]; total: number }>;
```

- [ ] **Step 1: Failing tests.** `plan.test.ts` (clock `2026-10-18T15:00:00Z`, a Sunday in Panama; stories ST-0001 and ST-0002):
  - "plans a story on a free day": `date: "2026-10-21"` → `{ ok: true, plannedOn: "2026-10-21" }`; audit `story_planned { from: "none", to: "2026-10-21" }`.
  - "asks before taking a day": ST-0002 holds `2026-10-21` → planning ST-0001 there gives `{ code: "conflict", date: "2026-10-21", other: "ST-0002", canSwap: false }`; nothing written.
  - "swaps two planned stories": ST-0001 on `2026-10-20`, ST-0002 on `2026-10-21`, `resolution: "swap"` → ST-0001 on 21, ST-0002 on 20; two `story_planned` entries with `resolution: "swap"`.
  - "moves the other story to waiting": `resolution: "move"` → ST-0002 `plannedOn` null.
  - "clears a date": `date: ""` → null, audit `{ from: "2026-10-21", to: "none" }`.
  - "refuses bad dates, published stories and forms outside the plan": `"2026-13-01"` `date_invalid`; a published story `published`; setting off `post_plan_off`.
  - "a story of a form outside the plan still holds its day": a form with the setting off whose story holds `2026-10-22` → planning there gives `conflict` naming it.
  - "builds the week of a date": `week: "2026-10-22"` → `monday "2026-10-19"`, seven days, `today "2026-10-18"` (none of the days is today), `previous "2026-10-12"`, `next "2026-10-26"`; `week: null` → the week of today, Sunday `isToday` true and the earlier days `isPast` true; `week: "garbage"` → this week.
  - "places planned and published stories on their days": `FakeReviewQueries.weekResult` with a planned entry on Tuesday and a published one on Wednesday → Tuesday `planned` set, Wednesday `published` with its link; labels from the version.
  - "records each view of the plan": one `post_plan_viewed { week: "2026-10-12" }` with no target per call.
  - "lists waiting stories with the total".
  Integration `tests/integration/review/plan.test.ts`, "two planners racing for one day: one wins, one is asked": two `planStory` calls for different stories and the same day started together → one `ok`, one `conflict`, one row on the day.
- [ ] **Step 2: Run** `pnpm test src/modules/review/application && pnpm test:integration tests/integration/review/plan.test.ts`: they fail.
- [ ] **Step 3: Implement.** `planStory`: checks, then one unit of work: `lockSubmission`, story `lockOrCreate`, `lockDay(date)` for the target day (for a swap the story already holds its own day by its row lock), `decidePlan`, then `save` each write in order (the holder's row came locked from `lockDay`) and one audit entry per row whose date changed. `postPlanWeek` reads `listPostPlanForms`, calls `queries.week(formIds, monday, sunday)` and maps entries with labels through `deps.submissions.versions.get(deps.definitions, versionId)`; a day's planned item is the unpublished entry with `plannedOn` that day, its published items the entries with `publishedOn` that day.
- [ ] **Step 4: Run** Step 2's commands, `pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): plan a story on a day, the week view and stories waiting for a date`

---
### Task 18: Review application: media access, the photo ZIP, the CSV export and deletion

**Files:**
- Create: `src/modules/review/application/media-access.ts`, `export.ts`, `delete.ts`, `src/modules/review/infrastructure/stored-zip-writer.ts`, `tests/fakes/zip.ts`
- Modify: `src/modules/review/application/index.ts`
- Test: `media-access.test.ts`, `export.test.ts`, `delete.test.ts` beside them; `src/modules/review/infrastructure/stored-zip-writer.test.ts`; `tests/integration/review/export.test.ts`

**Interfaces:**
- Consumes: `openMedia`, `mediaThumbnail`, `videoViewUrl`, `findMedia` (Task 8); `deleteSubmission` (Task 9); `exportColumns`, `exportRow` (form model); `csvCell`, `csvLine`, `CSV_BOM`, `EXPORT_ROW_CAP` (Task 11); `ReviewQueries.count`, `exportBatch` (Task 13); `ZipWriter` (Task 14).
- Produces:

```ts
// media-access.ts
export type MediaView = "thumb" | "full" | "download";
export type MediaAccess =
  | { kind: "bytes"; contentType: "image/webp"; body: Uint8Array }
  | { kind: "stream"; contentType: string; size: number; filename: string; body: ReadableStream<Uint8Array> }
  | { kind: "redirect"; url: string };
/** Null when the story or the file is not there. `full` records photo_viewed, `download` media_downloaded; `thumb` records nothing. */
export async function accessMedia(deps: ReviewDeps, actor: Actor, input: { formId: string; reference: string; mediaId: string; view: MediaView }): Promise<MediaAccess | null>;
export async function photoArchive(deps: ReviewDeps, actor: Actor, input: { formId: string; reference: string; set: "all" | "chosen" }): Promise<{ ok: true; filename: string; body: ReadableStream<Uint8Array> } | { ok: false; code: "not_found" | "none" }>;
// export.ts
export interface ExportOptions { versions: "filter" | "all"; text: "original" | "corrected" | "both"; paths: boolean }
/** Fixed headers and values in the export language, supplied by the presentation (copy lives there). */
export interface ExportLabels {
  reference: string; status: string; received: string; version: string; language: string;
  planned: string; postLink: string; files: string; staffPhotos: string;
  corrected(label: string): string;
  statuses: Record<ReviewStatus, string>;     // the Language column holds the locale code, `en` or `es`
}
/** Spanish when the form has Spanish, else English. */
export function exportLocale(languages: Languages): Locale;
export async function exportStories(deps: ReviewDeps, actor: Actor, input: { formId: string; query: ListQuery; options: ExportOptions; labels: (locale: Locale) => ExportLabels }): Promise<{ ok: true; filename: string; count: number; body: ReadableStream<Uint8Array> } | { ok: false; code: "not_found" | "too_large" }>;
// delete.ts
export async function deleteStory(deps: ReviewDeps, actor: Actor, input: { formId: string; reference: string; typed: string }): Promise<{ ok: true } | { ok: false; code: "not_found" | "reference_mismatch" }>;
// infrastructure/stored-zip-writer.ts
export class StoredZipWriter implements ZipWriter {}
// tests/fakes/zip.ts (test only)
export function readStoredZip(bytes: Uint8Array): { name: string; data: Uint8Array }[];   // parses the central directory, checks each CRC with zlib.crc32
```

Decision: each entry is read whole (files are at most 10 MB), so its local header carries the real CRC and sizes and no data descriptor is needed; method 0 (stored), UTF-8 names (flag bit 11), DOS time from `modifiedAt`, no ZIP64 (a story holds at most 100 MB from the sender plus 300 MB of staff photos).

- [ ] **Step 1: Failing tests.**
  - `media-access.test.ts` on `seedStory` (photo `p1` an image in staging):
    - "serves a thumbnail without an audit entry": `view: "thumb"` → `{ kind: "bytes", contentType: "image/webp" }`; the audit log is empty.
    - "streams a full photo and records the view": `full` → `stream`, `contentType: "image/jpeg"`, `filename: "01-photos.jpg"` (the durable key's file name), one `photo_viewed { mediaId: p1, kind: "image" }`.
    - "redirects a stored video and records the view": a stored video row without staging → `{ kind: "redirect", url: "memory://..." }` and `photo_viewed { kind: "video" }`.
    - "downloads with an audit entry": `download` → `media_downloaded { mediaId: p1 }`.
    - "refuses a file of another story, a staff row pending deletion, and a missing file": each → null, no audit.
  - `photoArchive` cases in the same file:
    - "zips every photo of the story": `set: "all"` with two sender photos and one staff photo → filename `story-form-ST-0001.zip`; `ListingZipWriter` output lists `ST-0001/01-photos.jpg`, `ST-0001/02-photos.jpg`, `ST-0001/staff-01-<hex>.jpg`; audit `media_downloaded { set: "all", count: 3 }`.
    - "zips the chosen photos only": `set: "chosen"` with `chosen [p2]` → `story-form-ST-0001-chosen.zip` with one entry; with nothing chosen → `{ ok: false, code: "none" }`.
  - `stored-zip-writer.test.ts`, "writes a stored ZIP that a reader accepts": entries `a/1.jpg` (bytes 0..255) and `a/ñ.txt` (`"hola"`), one entry whose `open` returns null (skipped) → `readStoredZip` returns the two with identical bytes; the archive starts with `PK\x03\x04` and ends with the end-of-central-directory record.
  - `export.test.ts` with `FakeReviewQueries.exportBatches` holding rows and a `labels` function built in the test (the Spanish strings of Task 2's `ex.col_*` rows):
    - "writes a BOM, the fixed headers and one row per submission": first bytes `EF BB BF`; header row `Referencia,Estado,Recibida (UTC),Versión,Idioma,Fecha planificada,Enlace de la publicación,<field headers>` for the Spanish story form with the post plan on; a row with `received` as `2026-10-18T15:00:00Z`.
    - "adds corrected columns when asked": `text: "both"` → `Nombre` then `Nombre (corregida)`; `corrected` → one `Nombre` column holding the correction where there is one and the original elsewhere; `original` → the original only.
    - "adds file path columns when asked": `paths: true` → last two columns hold `forms/story-form/ST-0001/01-photos.jpg; forms/.../02-photos.jpg` and the staff keys.
    - "exports a formula-looking answer as text": an answer `=HYPERLINK("x")` → the cell `"'=HYPERLINK(""x"")"`.
    - "refuses more than 10,000 rows": `countResult 10001` → `too_large`, no audit.
    - "records the export with its filter, never the search text": `query { q: "ana", from: "2026-10-01" }` → `submissions_exported { versions: "all", text: "both", paths: true, count: 2, search: true, from: "2026-10-01" }` targeting the form; no detail contains `ana`.
    - "names the file by slug and time": `story-form-20261018-1500.csv`.
    - "exportLocale": `es` and `bilingual` → `es`; `en` → `en`.
  - `delete.test.ts`:
    - "deletes after the typed reference matches": `typed: " st-0001 "` → ok (trimmed, case-insensitive); the submission is gone, `media.delete` for each media row including a staff photo, audit `submission_deleted { reference: "ST-0001" }`.
    - "refuses a mismatch and keeps everything": `typed: "ST-0002"` → `reference_mismatch`, nothing changed, no audit.
  - Integration `tests/integration/review/export.test.ts`, "streams 1,200 rows in batches": real adapters, 1,200 seeded submissions → 1,201 CSV lines, ids in list order, memory not retained (the stream is read chunk by chunk).
- [ ] **Step 2: Run** `pnpm test src/modules/review && pnpm test:integration tests/integration/review/export.test.ts`: they fail.
- [ ] **Step 3: Implement.** `accessMedia` opens the file first, then records the audit entry in its own unit of work, then answers; if the record write throws, it cancels the stream and rethrows. `exportStories` counts, records the audit entry, then returns a `ReadableStream` that pulls `exportBatch` 500 rows at a time and encodes `CSV_BOM` plus `csvLine`s with `TextEncoder`. Columns come from `exportColumns(versions, registry, locale)` over the filtered version or every version (oldest first); a column's type is curatable when `registry.get(typeId).reviewTraits?.curatable`. `deleteStory`: one unit of work with `lockSubmission`, `deleteSubmission`, the audit entry.
- [ ] **Step 4: Run** Step 2's commands, `pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): audited media access, photo ZIPs, CSV export and deletion`

---

### Task 19: Review application: Operations, the alert source and the composition roots

**Files:**
- Create: `src/modules/review/application/operations.ts`, `alert-source.ts`
- Modify: `src/modules/review/application/index.ts`
- Modify: `src/app/modules.ts` (`buildReview`), `src/app/container.ts` (`review`), `src/app/worker.ts`, `src/app/worker-handlers.ts`
- Test: `operations.test.ts`, `alert-source.test.ts` beside them; `src/app/container.test.ts`, `src/app/worker-handlers.test.ts`; `tests/integration/review/alert-flow.test.ts`

**Interfaces:**
- Consumes: `JobAdmin` (Task 5), `DeadAlertOptions` (Task 6), `AlertSource`, `JobAlertData`, `EMAIL_JOB_TYPES.jobAlert`, `EMAIL_JOB_MAX_ATTEMPTS`, `createJobAlertHandler` (Task 7), `heartbeatState` (Task 11).
- Produces:

```ts
// operations.ts
export interface DeadJobRow {
  id: string; type: string; attempts: number; lastError: string | null; createdAt: Date; finishedAt: Date | null;
  story: { formId: string; reference: string } | null;
}
export interface OperationsView { heartbeatAgeSeconds: number | null; heartbeat: HeartbeatState; dead: DeadJobRow[]; typesWithMany: { type: string; count: number }[] }
export async function operationsView(deps: ReviewDeps): Promise<OperationsView>;   // at most 200 dead jobs
export async function retryJob(deps: ReviewDeps, actor: Actor, jobId: string): Promise<boolean>;
export async function discardJob(deps: ReviewDeps, actor: Actor, input: { jobId: string; reason: string }): Promise<{ ok: true } | { ok: false; code: "not_found" | "reason_invalid" }>;
export async function retryAllOfType(deps: ReviewDeps, actor: Actor, type: string): Promise<number>;
/** Retries every dead job of the story; null when the story is not there. */
export async function retryStoryJobs(deps: ReviewDeps, actor: Actor, input: { formId: string; reference: string }): Promise<number | null>;
/** The story a dead job's payload points at, through `submissionId` or `mediaId`; null when gone. */
export async function storyOfJob(deps: ReviewDeps, payload: JobPayload): Promise<{ formId: string; reference: string } | null>;
// alert-source.ts
export class ReviewAlertSource implements AlertSource {
  constructor(deps: ReviewDeps, opts: { to: string | null; publicBaseUrl: string });
}
// src/app/modules.ts
export function buildReview(input: { pool: Pool; uow: UnitOfWorkFactory; definitions: DefinitionsDeps; submissions: SubmissionsDeps; media: MediaDeps; audit: AuditLog; auditReader: AuditLogReader }): ReviewDeps;
```

- [ ] **Step 1: Failing tests.**
  - `operations.test.ts` (`InMemoryJobAdmin`):
    - "lists dead jobs with their stories and the heartbeat": a dead `media.upload { mediaId: p1 }` → `story { formId, reference: "ST-0001" }`; a dead `jobs.cleanup {}` → `story: null`; `heartbeatAge 45` → `heartbeat: "ok"`; `null` → `critical`.
    - "offers retry all only for types with more than one dead job": two `media.upload`, one `email.staff_notification` → `typesWithMany [{ type: "media.upload", count: 2 }]`.
    - "retries one job and records it": `retryJob` → true, status pending, audit `job_retried { type }` targeting the job id; a pending job → false, no audit.
    - "discards with a reason of 1 to 200 characters": `"   "` and 201 characters → `reason_invalid`; `"Dropbox file removed by hand"` → ok, audit `job_discarded { type }` (the reason is not in the details).
    - "retries all of a type with one audit entry": two retried → `jobs_retried_bulk { type: "media.upload", count: 2 }` with no target; none → 0 and no entry.
    - "retries a story's dead jobs": two dead jobs of ST-0001, one of another story → 2, two `job_retried` entries; an unknown story → null.
  - `alert-source.test.ts`:
    - "lists the affected stories of the dead jobs of a type": three dead `media.upload` for two media of ST-0001 and one of ST-0002 → `{ to: ["alerts@example.com"], data: { jobType: "media.upload", count: 3, references: ["ST-0001", "ST-0002"], moreCount: 0, link: "https://forms.example.com/admin/operations" } }`.
    - "caps references at 20": 25 stories → 20 references, `moreCount: 5`.
    - "sends nothing without an address or without dead jobs": `to: null` → null; no dead jobs of that type (all retried) → null.
    - "carries no content": `JSON.stringify(data)` contains no answer value of the seeded stories and no `@`.
  - `container.test.ts`, "builds review on the shared definitions, submissions and media"; `worker-handlers.test.ts`, "registers email.job_alert".
  - Integration `tests/integration/review/alert-flow.test.ts`, "a dead upload ends in one alert email to ALERT_EMAIL": real Postgres, a store with `deadAlert`, a `media.upload` job at its last attempt for a story's photo whose staging copy is missing (the handler fails permanently), a recording `EmailSender`; two worker ticks → the upload is dead, the alert job ran, one email to `alerts@example.com` whose subject is `Jobs need attention: media.upload (1)` and whose text contains the story reference and no answer.
- [ ] **Step 2: Run** `pnpm test src/modules/review src/app && pnpm test:integration tests/integration/review/alert-flow.test.ts`: they fail.
- [ ] **Step 3: Implement.** `storyOfJob` resolves `submissionId` with `findSubmission`, `mediaId` with `findMedia` then `findSubmission`. `buildReview` wires `PgStoryRepository`, `PgStaffPhotoRepository`, `PgEditRepository`, `PgReviewQueries`, `PgJobAdmin`, `StoredZipWriter`, `systemClock`, `systemIdGenerator`, the definitions registry and `planTimeZone: PLAN_TIME_ZONE`. The web container gains `review`. `worker.ts` builds review, then notifications with `new ReviewAlertSource(review, { to: config.alertEmail, publicBaseUrl: config.publicBaseUrl })`, and its `PgJobStore` with `deadAlert: { type: EMAIL_JOB_TYPES.jobAlert, maxAttempts: EMAIL_JOB_MAX_ATTEMPTS }`; `workerHandlers` registers `[EMAIL_JOB_TYPES.jobAlert]: createJobAlertHandler(input.notifications)`.
- [ ] **Step 4: Run** Step 2's commands, `pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): operations actions, the dead-job alert source and module wiring`

---
### Task 20: Review presentation: copy, dates and an answer display for every field type

**Files:**
- Create: `src/modules/review/presentation/copy.ts`, `format.ts`, `review.module.css`, `styles.ts`, `answers/types.ts`, `answers/text.tsx`, `answers/choice.tsx`, `answers/simple.tsx`, `answers/file-upload.tsx`, `answers/consent.tsx`, `answers/section.tsx`, `answers/index.ts`
- Create: `src/shared/presentation/format-date.ts` (promoted from definitions; `view-models.ts` re-exports it)
- Modify: `src/modules/definitions/presentation/view-models.ts`
- Test: `copy.test.ts`, `format.test.ts`, `answers/conformance.test.ts` beside them; `src/shared/presentation/format-date.test.ts`

**Interfaces:**
- Consumes: `BilingualText`, `Text`, `fill` (`src/shared/presentation/copy.ts`, `Bilingual.tsx`); `specCopyRows`; `AnswerView` (Task 14); `fieldTypes`, `fieldTypeIds`.
- Produces:

```ts
// copy.ts — every row of the groups review owns, from specs/ui-ux/manager.md
export const reviewCopy = { /* sub.*, st.*, pub.*, del.*, ex.*, plan.*, ops.* */ } as const satisfies Record<string, Text>;
export type ReviewCopyKey = keyof typeof reviewCopy;
export function T(props: { k: ReviewCopyKey; vars?: Record<string, string> }): ReactElement;   // BilingualText of reviewCopy[k]
export function both(k: ReviewCopyKey, vars?: Record<string, string>): string;                  // "English / Spanish" for attributes
// format.ts
export function dayText(date: IsoDate): Text;          // { en: "Monday 19 October 2026", es: "lunes, 19 de octubre de 2026" }
export function shortDay(date: IsoDate): string;       // "2026-10-19"
// src/shared/presentation/format-date.ts (moved unchanged)
export function formatDate(iso: string | Date, timezone: string): { local: string; utc: string };
// answers/types.ts
export interface ReviewDisplay { Component(props: { view: AnswerView }): ReactElement | null }
// answers/index.ts
export const reviewDisplays = { short_text, long_text, email, phone, number, date, single_choice, multiple_choice, checkbox, consent, file_upload, section } as const satisfies Record<FieldTypeId, ReviewDisplay>;
```

- [ ] **Step 1: Failing tests.**
  - `copy.test.ts`: "matches the rows of the manager spec" (each key of `reviewCopy` equals its row in `specCopyRows("specs/ui-ux/manager.md", "specs/ui-ux/builder.md")`); "binds every row of the groups review owns" (`/^(sub|st|pub|del|ex|plan|ops)\./`); "has no placeholder whose value would differ by language" (for every row, the set of `{names}` in English equals that in Spanish).
  - `format.test.ts`: `dayText("2026-10-19")` as above; `dayText("2027-01-01")` `{ en: "Friday 1 January 2027", es: "viernes, 1 de enero de 2027" }`.
  - `answers/conformance.test.ts`:
    - "has a review display for every registered field type": keys equal `fieldTypeIds`.
    - for every type and every `fixtures.validAnswers` entry: "<type> shows answer <i> with something to read" (renders non-empty text, except `section`, which renders its title as a heading).
    - "shows an unanswered field as No answer": `answer: undefined` on each input type → `No answer` and `Sin respuesta`.
    - "escapes answers": a `short_text` answer `<script>alert(1)</script>` renders as text, no `<script` in the markup.
    - "shows the corrected text of a text answer and keeps line breaks": `long_text` with `corrected.text "Línea 1\nLínea 2"` renders that text in an element with the `answerText` class (CSS `white-space: pre-wrap`).
    - "shows choices by their labels in both languages": `single_choice` with `yes_opt` → `Yes` and `Sí`; an unknown option key renders the key.
    - "shows files as a count with a link to the photos": `file_upload` with two ids → `2 files, shown under Photos and videos` and `href="#photos"`.
- [ ] **Step 2: Run** `pnpm test src/modules/review/presentation src/shared/presentation`: they fail.
- [ ] **Step 3: Implement.** Bind every row of the seven groups exactly as Task 2 wrote them. `T` and `both` wrap `BilingualText` and `bothLanguages`. Displays: text types show `corrected?.text ?? answer` with `white-space: pre-wrap`; `number` and `date` as stored; `checkbox` `st.yes`/`st.no`; choices resolve option labels with `resolveText` per language through `BilingualText`; `consent` shows `st.yes` and the text version; `file_upload` `st.files_below`; `section` its title as `<h3>`. CSS values name their token in a comment; `.answerText { white-space: pre-wrap; }`, photo tiles use `size.photoTile` (Task 2).
- [ ] **Step 4: Run** `pnpm test src/modules src/shared && pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): manager copy for review, dates and answer displays for every field type`

---

### Task 21: Review presentation: the Submissions list and the export dialog

**Files:**
- Create: `src/modules/review/presentation/SubmissionsList.tsx`, `ExportDialog.tsx`, `list-view.ts`, `export-labels.ts`
- Test: `SubmissionsList.test.ts`, `list-view.test.ts`, `export-labels.test.ts` beside them

**Interfaces:**
- Consumes: `StoryList`, `ListQuery`, `listQueryString`, `PLAN_FILTERS`, `REVIEW_STATUSES`, `EXPORT_ROW_CAP` (Tasks 11, 14); `ExportLabels` (Task 18); `Table`, `Badge`, `Banner`, `Breadcrumbs` (shared presentation); Task 20.
- Produces:

```ts
// list-view.ts
export function listHref(formId: string, query: ListQuery): string;                       // /admin/forms/<id><query>
export function chipHref(formId: string, query: ListQuery, over: Partial<ListQuery>): string;   // page back to 1; the active chip's link clears it
export function storyHref(formId: string, reference: string, query: ListQuery): string;  // /admin/forms/<id>/submissions/<ref><query>
// SubmissionsList.tsx
export function SubmissionsList(props: {
  list: StoryList; publicUrl: string; csrfToken: string;
  exportOpen: boolean; exportError: "too_large" | null; deleted: string | null;
}): ReactElement;
// ExportDialog.tsx
export function ExportDialog(props: { formId: string; query: ListQuery; total: number; csrfToken: string; error: "too_large" | null }): ReactElement;
// export-labels.ts
export function exportLabels(locale: Locale): ExportLabels;   // ex.col_*, ex.corrected_suffix, sub.status_* in that language
```

- [ ] **Step 1: Failing tests.** `export-labels.test.ts`: "builds Spanish and English export labels" (`exportLabels("es").reference === "Referencia"`, `exportLabels("es").corrected("Nombre") === "Nombre (corregida)"`, `exportLabels("es").statuses.published === "Publicada"`, `exportLabels("en").received === "Received (UTC)"`).
  `list-view.test.ts`: "builds list, chip and story links": `chipHref(id, { ...EMPTY_QUERY, page: 3 }, { status: "new" })` → `/admin/forms/<id>?status=new`; the active chip (`status: "new"` already) → `/admin/forms/<id>`; `storyHref(id, "HP-0042", { ...EMPTY_QUERY, status: "new", page: 2 })` → `/admin/forms/<id>/submissions/HP-0042?status=new&page=2`.
  `SubmissionsList.test.ts` (render with `renderToStaticMarkup`; synthetic rows):
  - "shows each row with its columns and a link to the story": reference link to `storyHref`, status badge text, received in the form zone and UTC, label, files count with words, version `v1`, locale, and `Needs attention` / `Necesita atención` only on the flagged row.
  - "shows Planned with the date in place of the status": a planned, unpublished row on a post-plan form → `Planned · 2026-10-21` and no status badge; the same row on a form outside the plan shows its status badge.
  - "marks the active chip by more than color": the active status chip has `aria-current="true"` and a check mark; each chip shows its count.
  - "offers the post-plan chips only on post-plan forms": `Planned`, `Waiting for a date`, `Not ready` present when `ctx.postPlan`, absent otherwise.
  - "keeps the filters in a GET form": `<form method="get">` with `from`, `to`, version select (`All versions` plus `v1`, `v2`), `media` checkbox, `q` search with its label, `Filter` button, and hidden `status` and `plan` when set.
  - "pages by 50 with the total": `total 101`, page 2 → `Page 2 of 3`, `Newer` and `Older` page links, `101 submissions`.
  - "says when there is nothing yet, and when nothing matches": no submissions and an empty query → `sub.empty` with the public URL; rows empty with a filter → `sub.empty_filtered` with `Clear filters` linking to the bare list.
  - "opens the export dialog with the scope, options and notice": `exportOpen` → `<section role="dialog">` labelled by `Export submissions`, `{count} submissions matching the current filters` filled, radios for versions and text answers, `Include file paths`, the notice, `Download CSV`, the CSRF field, hidden inputs carrying every set filter, `action="/admin/forms/<id>/export"`, `method="post"`.
  - "refuses above 10,000 rows in the dialog": `total 10001` → `ex.too_large` text and no Download button; `exportError: "too_large"` shows the same.
  - "reports a deletion": `deleted: "HP-0042"` → `Submission HP-0042 was deleted.` as a status banner.
  - "names the table": the caption is `Submissions, newest first` in both languages.
- [ ] **Step 2: Run** `pnpm test src/modules/review/presentation`: they fail.
- [ ] **Step 3: Implement** as server components with plain `<a>` links and plain forms; the table uses `Table` with headers `sub.col_*`; below `breakpoint.md` rows stack (components.md, "Table (staff)").
- [ ] **Step 4: Run** `pnpm test src/modules/review && pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): submissions list with filters, post-plan chips, pagination and the export dialog`

---

### Task 22: Review presentation: the story page, its answers, corrections and dialogs

**Files:**
- Create: `src/modules/review/presentation/story-params.ts`, `StoryPage.tsx`, `StoryNotFound.tsx`, `story/StoryHeader.tsx`, `story/Flash.tsx`, `story/JobWarning.tsx`, `story/AnswersCard.tsx`, `story/CorrectionEditor.tsx`, `story/CompareView.tsx`, `story/ConsentCard.tsx`, `story/ActivityCard.tsx`, `story/DeleteDialog.tsx`
- Test: `story-params.test.ts`, `StoryPage.test.ts` beside them

**Interfaces:**
- Consumes: `StoryView` (Task 14); `wordDiff`, `changeCount` (Task 10); `reviewDisplays`, `T`, `formatDate` (Task 20); `listHref` (Task 21); `ConfirmForm`, `literalPattern`, `Breadcrumbs`, `Banner`, `Badge` (shared presentation); `copy["au.action_*"]` (shared copy).
- Produces:

```ts
// story-params.ts
export const STORY_ACTIONS = ["revert", "publish", "unpublish", "remove_photo", "delete"] as const;
export const STORY_DONE = ["saved", "reverted", "published", "unpublished", "unpublished_waiting", "photos_added",
  "photo_removed", "planned", "plan_cleared", "retried", "check_saved", "choice_saved"] as const;
export const STORY_ERRORS = ["correction_blank", "correction_too_long", "post_url_invalid", "not_confirmed",
  "source_invalid", "no_files", "too_many_files", "staff_photos_max", "file_too_large", "file_wrong_type",
  "file_unreadable", "consent_missing", "no_photos_chosen", "date_invalid", "published", "reference_mismatch"] as const;
export interface StoryParams {
  query: ListQuery;
  edit: string | null; compare: string | null; photo: string | null;
  action: (typeof STORY_ACTIONS)[number] | null; field: string | null; media: string | null;
  conflict: { date: IsoDate; ref: string; canSwap: boolean } | null;     // conflict_date, conflict_ref, conflict_swap=1
  done: (typeof STORY_DONE)[number] | null; error: (typeof STORY_ERRORS)[number] | null;
  n: number | null;          // a count or a file position for the flash text
  other: string | null;      // a reference for the flash text
}
export function parseStoryParams(params: Readonly<Record<string, string | string[] | undefined>>): StoryParams;
/** The story page URL with the list query and the given story params. */
export function storyPath(formId: string, reference: string, query: ListQuery, story?: Partial<Omit<StoryParams, "query">>): string;
// StoryPage.tsx
export function StoryPage(props: { view: StoryView; params: StoryParams; csrfToken: string }): ReactElement;
export function StoryNotFound(props: { formId: string; query: ListQuery }): ReactElement;
```

- [ ] **Step 1: Failing tests.** `story-params.test.ts`: "parses known values only" (unknown `action`, `done`, `error` → null; `conflict_date` without `conflict_ref` → null conflict; `n` must be a positive integer); "round-trips through storyPath" (`storyPath(id, "ST-0001", { ...EMPTY_QUERY, status: "new" }, { edit: "f_name" })` → `/admin/forms/<id>/submissions/ST-0001?status=new&edit=f_name`, parsed back equal).
  `StoryPage.test.ts`, each rendering a `StoryView` built in the test from synthetic data:
  - "has one h1, the breadcrumb and the facts": `<h1>` `ST-0001`; breadcrumb Forms > form title > ST-0001; `Received ...`, `Version 1`, `Sent in Spanish` / `Enviada en español`; `Back to the list` linking to `listHref` with the query.
  - "links Newer and Older with the list's filters, and leaves out a missing one": `neighbours { newer: "ST-0003", older: null }` and `query.status = "new"` → a Newer link to `/admin/forms/<id>/submissions/ST-0003?status=new`, no Older link.
  - "groups answers under page titles through their displays": page titles as `<h2>`, every field shown.
  - "tags corrected answers and offers Compare, Edit and Revert": a corrected `f_name` shows `Edited` (a tag with text), `Corrected by owner@example.com on ...`, `Compare with original` and `Edit` links built with `storyPath`; an uncorrected curatable answer shows `Edit` only; a choice answer shows neither.
  - "opens the editor in two labelled columns": `params.edit = "f_name"` → `Original` read-only block and a `<textarea name="text" required maxlength="5000">` labelled `Corrected`, the hint, `Save correction`, a `Cancel` link (`shell.cancel`), posting to `.../correction` with `field` and `csrf`.
  - "shows the error under the editor": `error: "correction_too_long"` with `n: 5000` → `Use at most 5000 characters.` linked by `aria-describedby`, the textarea `aria-invalid="true"`.
  - "compares with marked, focusable changes": `params.compare = "f_name"`, original `Nacio en el hospital`, corrected `Nació en el hospital` → one `<del tabindex="0">` with a visually hidden `Removed`, one `<ins tabindex="0">` with `Added`, a `role="status"` with `1 changes`; equal texts show `No differences from the original`.
  - "confirms a revert in an in-page dialog": `action: "revert", field: "f_name"` → `<section role="dialog">` with `st.revert_confirm` filled with the label, a `Revert to original` button posting to `.../revert`.
  - "warns about dead jobs with Try again": `deadJobs [{ type: "media.upload" }, { type: "email.staff_notification" }]` → `Something did not finish for this story` heading, `A photo or video has not reached Dropbox.`, `An email was not sent.`, a `Try again` button posting to `.../retry`.
  - "shows each flash and refusal in words": every `STORY_DONE` and `STORY_ERRORS` value renders its copy (done as `role="status"`, errors as `role="alert"`), `unpublished_waiting` names `other`.
  - "keeps consent collapsed with its version and time": `<details>` with `Accepted ..., text version <v>`.
  - "lists activity with plain-word actions": `photo_viewed` → `Photo viewed` / `Foto vista`; an unknown action is shown as stored; none → `No activity yet.`.
  - "asks for the typed reference before deleting": `action: "delete"` → `del.body` filled with `ST-0001`, an input labelled `Reference` with `pattern` from `literalPattern("ST-0001")`, `Delete permanently` posting to `.../delete`; `error: "reference_mismatch"` → `del.mismatch`.
  - "renders the not-found body": `StoryNotFound` has one `<h1>` `Submission not found` and a link `Back to the submissions` to the list.
  - "escapes staff and sender text everywhere": a label `<b>x</b>` and an answer `<img src=x>` appear as text.
- [ ] **Step 2: Run** `pnpm test src/modules/review/presentation`: they fail.
- [ ] **Step 3: Implement.** `StoryPage` lays the sections out in the order of Task 2, Step 2, leaving three slots (photos, readiness, publishing) that Task 23 fills; until then they render nothing. Every form carries the `csrf` hidden field and posts to `storyPath`-based actions under `/admin/forms/<id>/submissions/<ref>/<route>` with the list query in a hidden `back` field (`listQueryString(query)`), so the route can return with it. Focus order follows the visual order; every control is a native element.
- [ ] **Step 4: Run** `pnpm test src/modules/review && pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): story page with answers, correction editor, compare view and confirmations`

---
### Task 23: Review presentation: photos, the viewer, staff photos, readiness, the planned date and publishing

**Files:**
- Create: `src/modules/review/presentation/story/PhotosCard.tsx`, `PhotoViewer.tsx`, `StaffPhotoForm.tsx`, `ReadinessPanel.tsx`, `PlanForm.tsx`, `PublishPanel.tsx`
- Modify: `src/modules/review/presentation/StoryPage.tsx`
- Test: `src/modules/review/presentation/StoryPhotos.test.ts`, `StoryPlan.test.ts`

**Interfaces:**
- Consumes: `StoryView`, `PhotoView`, `Readiness` (Task 14); `StoryParams`, `storyPath` (Task 22); `STAFF_PHOTO_SOURCES`, `MAX_STAFF_UPLOAD_FILES` (Task 11).
- Produces: the six components, each `(props: { view: StoryView; params: StoryParams; csrfToken: string }) => ReactElement | null`, mounted by `StoryPage` in its three slots; the media URL helper:

```ts
// story/PhotosCard.tsx
export function mediaUrl(formId: string, reference: string, mediaId: string, view: "thumb" | "full" | "download"): string;   // .../media/<id>?view=<view>
export function zipUrl(formId: string, reference: string, set: "all" | "chosen"): string;                                    // .../photos.zip?set=<set>
```

- [ ] **Step 1: Failing tests.** `StoryPhotos.test.ts`:
  - "shows the sender's photos, then the team's, each captioned in words": two sender photos and one staff photo → `id="photos"` card, `Sent with the form` and `Added by the team` headings, captions `Photo 1 of 3` to `Photo 3 of 3`, thumbnails `<img src=mediaUrl(..., "thumb") alt="Photo 1 of 3 / Foto 1 de 3" loading="lazy" width="160" height="160">`, the staff tile with `Added by owner@example.com on ...` and `From WhatsApp`.
  - "shows a video as a captioned tile without an image": `Video 2 of 3`, no `<img>`.
  - "offers View full size and Download per file, and the ZIPs": links to `mediaUrl(..., "full")` via `storyPath(..., { photo: id })` and `mediaUrl(..., "download")`; `Download all (3)` to `zipUrl("all")`; on post-plan forms `Download chosen (1)` to `zipUrl("chosen")`, left out when nothing is chosen.
  - "toggles the choice with a button that says its state": on a post-plan form an unchosen tile has a form posting `media` and `chosen=1` with `Choose for the post`; a chosen one shows `Chosen for the post` (text and check icon) and a button `Remove from the post` posting `chosen=0`; without the post plan no choice controls.
  - "warns about a file kept only on the server": a `failed` photo shows `Not in Dropbox yet: kept on the server only.`.
  - "offers removal for staff photos only, with a confirmation": staff tile → `Remove this photo` link to `?action=remove_photo&media=<id>`; that action renders the dialog with `st.remove_photo_confirm` posting to `.../photos/remove`; sender tiles have no removal.
  - "shows the viewer section for one photo": `params.photo = p2` → a section with `<img src=mediaUrl(p2, "full")>`, `Photo 2 of 3`, Previous to p1, Next to the staff photo, `Download`, `In Dropbox: forms/story-form/ST-0001/02-photos.jpg`, `Views and downloads are recorded`, `Back to the story`; a video uses `<video controls preload="none" src=mediaUrl(id, "full")>` and never autoplays.
  - "offers Add photos with a labelled, accessible form": on a post-plan form with `laterPhotosAllowed` → `<form method="post" enctype="multipart/form-data">` to `.../photos`, a file input `name="files" multiple` with `accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime"` labelled `Files`, the hint, a fieldset legend `Where they came from` with four radios, a required checkbox `The sender sent these for this story`, `Upload`; each refusal (`not_confirmed`, `source_invalid`, `no_files`, `too_many_files` with `n`, `staff_photos_max`, `file_*` with `n`) sits under its control with `aria-describedby` and `aria-invalid`.
  - "explains why Add photos is off": post plan on, `laterPhotosAllowed` false → `st.laterphotos_off`, no upload form.
  `StoryPlan.test.ts`:
  - "lists the three checks with words and icons": `readiness { photosChosen: true, photosEdited: false, textChecked: true, done: 2 }` → `Not ready: 2 of 3 done`, each row `Done` or `Missing` with a check or cross icon `aria-hidden`; all done → `Ready`.
  - "offers each tick as a button that names its effect": photos edited not ticked → `Mark photos as edited` posting `check=photos_edited&value=1`; ticked → `Photos not edited yet` posting `value=0` and `owner@example.com, <date>`; same for text checked.
  - "explains a stale edited tick": `editedStale` → `st.edited_stale`.
  - "plans with a labelled date field": `<input type="date" name="date" value="2026-10-21">` labelled `Planned date` with `st.plan_hint` described, `Plan`, and `Remove the date` (a second form posting `date=`) only when planned.
  - "asks on a conflict": `conflict { date: "2026-10-21", ref: "ST-0002", canSwap: true }` → a dialog with `ST-0002 is already planned for 2026-10-21.`, `Swap the two dates` (`resolution=swap`), `Move ST-0002 to Waiting for a date` (`resolution=move`), `Cancel`; `canSwap: false` leaves out the swap.
  - "shows Planned and published days in words": unpublished planned → badge `Planned · 2026-10-21`; published → `Published on 2026-10-20` and `Open the post` linking to the post URL with `rel="noopener noreferrer"`.
  - "marks as published in a dialog with an optional https link": `action: "publish"` → input `type="url" name="post_url"` labelled `Link to the post (optional)` with `pub.post_url_hint`, `Confirm` posting `intent=publish`; `error: "post_url_invalid"` → `pub.err_url` under it.
  - "unmarks after saying where the status goes": `action: "unpublish"` with corrections → `The status will return to Edited.`, without → `Viewed.`; `Confirm` posting `intent=unpublish`.
  - "hides the plan parts on forms outside the post plan": no readiness panel, no plan form, no choice buttons; publishing stays.
- [ ] **Step 2: Run** `pnpm test src/modules/review/presentation`: they fail.
- [ ] **Step 3: Implement** the components and mount them in `StoryPage`'s slots. Buttons and links are at least `size.touchTarget` tall; a chosen tile adds the 2 px border and the words (components.md, "Photo tile (staff)").
- [ ] **Step 4: Run** `pnpm test src/modules/review && pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): story photos, viewer, staff photo upload, readiness, planned date and publishing`

---

### Task 24: Presentation: the Post plan page, the Operations page and the shell's sections

**Files:**
- Create: `src/modules/review/presentation/PostPlanPage.tsx`, `OperationsPage.tsx`, `src/shared/presentation/sections.ts`
- Modify: `src/shared/presentation/ManagerShell.tsx`, `src/app/admin/(gated)/layout.tsx`, `src/proxy.ts` (the section header)
- Test: `PostPlanPage.test.ts`, `OperationsPage.test.ts` beside them; `src/shared/presentation/shell.test.ts`, `sections.test.ts`; `src/app/admin/(gated)/layout.test.ts`; `tests/integration/identity/proxy-gate.test.ts`

**Interfaces:**
- Consumes: `WeekView`, `PlanItem`, `waitingStories` result (Task 17); `OperationsView` (Task 19); `dayText` (Task 20); `storyHref` (Task 21).
- Produces:

```ts
// PostPlanPage.tsx
export function PostPlanPage(props: { week: WeekView; waiting: { rows: PlanItem[]; total: number }; pick: IsoDate | null; csrfToken: string }): ReactElement;
// OperationsPage.tsx
export function OperationsPage(props: { view: OperationsView; csrfToken: string; done: "retried" | "retried_all" | "discarded" | null; n: number | null; error: "reason_invalid" | null; errorJob: string | null }): ReactElement;
// sections.ts
export const SECTION_HEADER = "x-effluz-section";
export function sectionOf(pathname: string): ManagerSection;   // /admin/plan* -> plan, /admin/operations* -> operations, /admin/audit* -> audit, else forms
// ManagerShell.tsx: ManagerSection gains "plan"; SECTIONS Forms, Post plan (/admin/plan), Operations (/admin/operations), Audit (disabled)
```

Decision: the proxy, which already sees every `/admin` request, forwards `x-effluz-section` (overwriting any client value) and the gated layout reads it with `headers()`; a layout cannot see its path.

- [ ] **Step 1: Failing tests.**
  - `sections.test.ts`: `/admin/plan` and `/admin/plan?week=x` → `plan`; `/admin/operations` → `operations`; `/admin/forms/1/submissions/HP-0001` → `forms`; `/admin/planner` → `forms`.
  - `shell.test.ts`: "links Post plan and Operations, and keeps Audit disabled": Post plan and Operations are links; the current one `aria-current="page"`; Audit has `aria-disabled="true"` and no `href`.
  - `layout.test.ts`: "marks the section from the proxy's header": a request header `x-effluz-section: plan` → the shell's current section is Post plan; a missing or unknown value → Forms.
  - `proxy-gate.test.ts`: "forwards the section of the path and overwrites a client value": an active session requesting `/admin/plan` with `x-effluz-section: operations` reaches the app with `plan`.
  - `PostPlanPage.test.ts` (a `WeekView` built in the test, Monday `2026-10-19`, today Wednesday `2026-10-21`):
    - "has one h1, a breadcrumb naming the page, and week navigation": a one-item breadcrumb `Post plan`, `Post plan` h1, `Week of 2026-10-19` / `Semana del 2026-10-19` (placeholders take ISO dates, which read the same in both languages), links `Previous week` (`?week=2026-10-12`), `This week` (`/admin/plan`), `Next week` (`?week=2026-10-26`).
    - "lists seven days with today marked in words": seven list items with weekday names in both languages; Wednesday has `Today` / `Hoy` and the `today` class.
    - "shows a planned story with its readiness in words": Tuesday's item → reference link to the story, label, form title, `Photos chosen Done`, `Photos edited in Canva Missing`, `Text checked Done`, `Not ready: 2 of 3 done`.
    - "shows published stories on their day with the post link": Monday → `Published` and `Open the post`; a day may hold one planned and several published.
    - "offers Pick a story on empty days from today, and Nothing planned before": empty Monday (past) → `Nothing planned`; empty Thursday → `Pick a story` linking to `?week=2026-10-19&pick=2026-10-22`.
    - "lists stories waiting for a date, and plans one for the picked day": `pick: "2026-10-22"` → `Choose a story for 2026-10-22.` and per waiting row a form posting to that story's `.../plan` with `date=2026-10-22`, `back=plan`, `week=2026-10-19`, button `Plan for 2026-10-22`; without `pick` no buttons; no rows → `No stories are waiting for a date.`; the total as `{count} stories`.
    - "says when no form uses the plan": `formsInPlan: 0` → `plan.no_forms`.
  - `OperationsPage.test.ts`:
    - "has one h1 and a breadcrumb naming the page": `Operations`.
    - "shows the heartbeat in words and color together": `45` → `Worker last seen`, `45 seconds ago`, `OK`; `null` → `Never`, `Critical` and the `ops.worker_down` banner; `200` → `Warning`.
    - "lists dead jobs with their story": columns `Type`, `Story`, `Attempts`, `Last error`, `First attempt`, `Last attempt`; a story link to `storyHref`; a job without a story shows `None`.
    - "offers Retry, Discard with a reason, and Retry all of type": per row a `Retry` form posting `job` to `/admin/operations/retry`, a `Discard` form with a required `reason` input (`maxlength="200"`, labelled `Reason`) posting to `/admin/operations/discard`; `Retry all media.upload jobs (2)` posting `type` to `/admin/operations/retry-type` only for `typesWithMany`.
    - "reports results and a refused discard at its row": `done: "retried_all", n: 2` → `2 jobs will run again shortly.`; `error: "reason_invalid", errorJob: id` → `ops.err_reason` under that row's reason input.
    - "says when nothing needs attention": `No jobs need attention.`.
- [ ] **Step 2: Run** `pnpm test src/modules/review/presentation src/shared/presentation src/app/admin && pnpm test:integration tests/integration/identity/proxy-gate.test.ts`: they fail.
- [ ] **Step 3: Implement.** Day rows per components.md "Week day row"; weekday names come from `dayText`. In `src/proxy.ts`, when the session is active, answer `NextResponse.next({ request: { headers } })` with `headers.set(SECTION_HEADER, sectionOf(pathname))`.
- [ ] **Step 4: Run** Step 2's commands, `pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): post plan week, operations page and the shell's current section`

---
### Task 25: App: the pages, the route handlers and the proxy's return paths

**Files:**
- Modify: `src/app/admin/(gated)/forms/[id]/page.tsx` (the list in the Submissions tab)
- Create: `src/app/admin/(gated)/forms/[id]/submissions/[reference]/page.tsx`, `src/app/admin/(gated)/plan/page.tsx`, `src/app/admin/(gated)/operations/page.tsx`
- Create: `src/app/admin/forms/[id]/export/route.ts`
- Create under `src/app/admin/forms/[id]/submissions/[reference]/`: `correction/route.ts`, `revert/route.ts`, `status/route.ts`, `photos/route.ts`, `photos/remove/route.ts`, `choice/route.ts`, `check/route.ts`, `plan/route.ts`, `retry/route.ts`, `delete/route.ts`, `media/[mediaId]/route.ts`, `photos.zip/route.ts`, `_lib/story-request.ts`
- Create: `src/app/admin/operations/retry/route.ts`, `discard/route.ts`, `retry-type/route.ts`, `src/app/admin/media/local/[key]/route.ts`
- Modify: `src/proxy.ts` (`returnPath`)
- Test: `src/app/admin/forms/[id]/submissions/[reference]/routes.test.ts`, `src/app/admin/forms/[id]/export/route.test.ts`, `src/app/admin/operations/routes.test.ts`, `src/app/admin/media/local/[key]/route.test.ts`, `src/app/admin/(gated)/review-pages.test.ts`, `tests/integration/identity/proxy-gate.test.ts`

**Interfaces:**
- Consumes: every use case of Tasks 14 to 19, the presentation of Tasks 20 to 24, `requireSession`, `requireCsrf`, `actorOf`, `text`, `seeOther`, `plain` (`_lib/request.ts`), `pageSession`, `getContainer` (`container.review`).
- Produces:

```ts
// _lib/story-request.ts
/** The story page path from the route's params and the posted `back` query (parsed with parseListQuery, so nothing else survives). */
export function storyReturn(formId: string, reference: string, form: FormData, story?: Partial<Omit<StoryParams, "query">>, hash?: "photos" | "readiness" | "plan"): string;
```

Every POST handler: `requireCsrf(request, <story page path without query>)`, then reads its fields with `text`, calls one use case with `actorOf(session, request)`, and answers `seeOther`. A field outside its closed set (an unknown `intent`, `check`, `value`, `view`, `set`) is a tampered body: `plain(400)`. A missing story answers `seeOther` to the story page, which renders the not-found body.

| Route | Fields | Use case | Success | Refusal |
|---|---|---|---|---|
| `correction` | `field`, `text`, `back` | `saveCorrection` | `done=saved` | `edit=<field>&error=<code>` (`n=<max>` for too long); `not_curatable`: the story page |
| `revert` | `field`, `back` | `revertCorrection` | `done=reverted` | story page |
| `status` | `intent` (`publish`, `unpublish`), `post_url`, `back` | `markPublished` or `unmarkPublished` | `done=published`; `done=unpublished`, or `done=unpublished_waiting&other=<ref>` | `action=publish&error=post_url_invalid` |
| `photos` | `files` (repeated), `source`, `confirmed`, `back` | `addStaffPhotos` | `done=photos_added&n=<count>#photos` | `error=<code>` (`file_refused` becomes `error=<reason>&n=<file>`, the reason already being `file_too_large`, `file_wrong_type` or `file_unreadable`; `post_plan_off` becomes `consent_missing`) `#photos` |
| `photos/remove` | `media`, `back` | `removeStaffPhoto` | `done=photo_removed#photos` | story page |
| `choice` | `media`, `chosen` (`1`, `0`), `back` | `choosePhoto` | `done=choice_saved#photos` | story page |
| `check` | `check`, `value` (`1`, `0`), `back` | `setCheck` | `done=check_saved#readiness` | `error=no_photos_chosen#readiness` |
| `plan` | `date`, `resolution`, `back`, `return` (`story`, `plan`), `week` | `planStory` | `return=plan`: `/admin/plan?week=<week>`; else `done=planned` or `done=plan_cleared` `#plan` | conflict: the story page with `conflict_date`, `conflict_ref`, `conflict_swap=1` when it can swap, `#plan`; `error=date_invalid` or `error=published`; `post_plan_off`: the story page |
| `retry` | `back` | `retryStoryJobs` | `done=retried` | story page |
| `delete` | `typed`, `back` | `deleteStory` | the list `<back>` plus `deleted=<ref>` | `action=delete&error=reference_mismatch` |
| `export` (form) | `versions`, `text`, `paths`, the list query keys | `exportStories` with `labels: exportLabels` | 200 `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="<file>"`, `Cache-Control: no-store` | `?export=1&error=too_large` plus the query |
| `operations/retry` | `job` | `retryJob` | `/admin/operations?done=retried` | same, no flash |
| `operations/discard` | `job`, `reason` | `discardJob` | `?done=discarded` | `?error=reason_invalid&job=<id>` |
| `operations/retry-type` | `type` | `retryAllOfType` | `?done=retried_all&n=<count>` | none |

GET routes (`requireSession`, no CSRF token): `media/[mediaId]?view=thumb|full|download` maps `accessMedia`: `bytes` → 200 `image/webp`, `Cache-Control: private, max-age=3600`; `stream` → 200 with `Content-Type`, `Content-Length`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `Content-Disposition: inline` (`full`) or `attachment; filename="<file>"` (`download`); `redirect` → 302 with `Cache-Control: no-store`; null → `plain(404)`. `photos.zip?set=all|chosen` → 200 `application/zip`, attachment, `no-store`, or `plain(404)` for `not_found` and `none`. `media/local/[key]` answers `plain(404)` unless the durable provider is local, then streams `openStoredKey(decodeURIComponent(key))` with the content type of its extension (`mp4` `video/mp4`, `mov` `video/quicktime`, `jpg` `image/jpeg`, `png` `image/png`, `webp` `image/webp`), `Accept-Ranges: none`, `private, no-store`.

Pages (each exports `instant = false`, reads the session with `pageSession`, links with `<a>` only): the overview renders `FormOverview` with `SubmissionsList` from `listStories(container.review, actor, { formId, query: parseListQuery(searchParams) })`, `exportOpen` from `?export=1`, `exportError`, `deleted`; the story page renders `StoryPage` from `openStory`, or `StoryNotFound` when it is null (never `notFound()`), with `generateMetadata` titling it with the reference; the plan page renders `PostPlanPage` from `postPlanWeek` and `waitingStories({ limit: 50 })`, with `pick` from `parseIsoDate`; the operations page renders `OperationsPage` from `operationsView` and its query.

- [ ] **Step 1: Failing tests.** In the route tests, `getContainer` is mocked as in `src/app/admin/forms/[id]/routes.test.ts`, the container built with `review: makeReviewDeps()` and its definitions, submissions and media, a seeded session and `seedStory`. Per handler of the table:
  - "<route> sends a post without a session to sign-in from the story page" (302 to `signInPath(<story path>)`).
  - "<route> refuses a stale token" (403, `auth.stale_title`).
  - "<route> answers a tampered body with 400" (for the routes with closed sets).
  - "<route> applies and returns with <success>" (the Location exactly as the table, the list query from `back` preserved, the use case's effect visible in the fakes).
  - "<route> returns a refusal with <refusal>" for each refusal row.
  Plus: "photos reads every file of the multipart body"; "export streams the CSV with the BOM and headers"; "media serves a thumbnail, a full photo, a download and a video redirect with the headers above"; "media refuses an unknown view with 400 and a missing file with 404"; "photos.zip names the file and answers 404 when nothing is chosen"; "local media answers 404 when the durable provider is Dropbox".
  `review-pages.test.ts`: "every new page and the overview export instant = false" (import each page module and check `instant === false`).
  `proxy-gate.test.ts`: "a story post without a session returns to its story page" (`POST /admin/forms/<id>/submissions/HP-0001/correction` → `returnTo=/admin/forms/<id>/submissions/HP-0001`, also for `photos/remove`); "an export post returns to the overview"; "an Operations post returns to Operations".
- [ ] **Step 2: Run** `pnpm test src/app && pnpm test:integration tests/integration/identity/proxy-gate.test.ts`: they fail.
- [ ] **Step 3: Implement** the handlers, the pages and `storyReturn` as specified. `returnPath` in `src/proxy.ts` adds, before its last line: `/^(\/admin\/forms\/[^/]+\/submissions\/[^/]+)\/(correction|revert|status|photos|photos\/remove|choice|check|plan|retry|delete)$/` → the first group; `/^(\/admin\/forms\/[^/]+)\/export$/` → the first group; `/^\/admin\/operations\/(retry|discard|retry-type)$/` → `/admin/operations`.
- [ ] **Step 4: Run** Step 2's commands, then `pnpm build` (one heavy process) to confirm the routes compile under Cache Components, `pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS, and the build lists the new routes as dynamic.
- [ ] **Step 5: Commit** `feat(app): story page, post plan and operations pages with their route handlers`

---

### Task 26: End to end over HTTP: build, publish, submit and review a story, and the main failure paths

**Files:**
- Create: `tests/support/admin-session.ts`, `tests/e2e/staff.ts`, `tests/e2e/fill.ts`, `tests/e2e/review.test.ts`, `tests/e2e/operations.test.ts`
- Modify: `tests/e2e/reference-form.test.ts` (uses `tests/e2e/fill.ts`; behavior unchanged)
- Modify: `specs/system/ci-cd.md` ("As built": the e2e job also covers review)

**Interfaces:**
- Consumes: `publishReferenceForm(pool, { usePostPlan: true })` (`tests/e2e/publish.ts`), `Visitor`, `textOf`, `hidden` (`tests/e2e/http.ts`), `readStoredZip` (Task 18), `todayIn`, `addDays`, `PLAN_TIME_ZONE` from `@/modules/review/application`.
- Produces:

```ts
// tests/support/admin-session.ts
/** Inserts an active admin_session row (synthetic staff), as a completed sign-in would. */
export async function seedAdminSession(pool: Pool, who?: { email?: string; name?: string }): Promise<{ sessionId: string; csrf: string }>;
// tests/e2e/staff.ts
export class Staff {
  constructor(base: string, session: { sessionId: string; csrf: string }, cookieName?: string);
  get(path: string): Promise<Reply>;
  /** Posts the fields plus `csrf` (multipart when files are given); `opts.csrf` overrides the token, `opts.anonymous` sends no cookie. */
  post(path: string, fields: Record<string, string>, files?: readonly { field: string; file: File }[], opts?: { csrf?: string; anonymous?: boolean }): Promise<Reply>;
  /** The response body as bytes, for CSV and ZIP downloads. */
  download(path: string, fields?: Record<string, string>): Promise<{ status: number; headers: Headers; bytes: Uint8Array }>;
}
// tests/e2e/fill.ts (moved from reference-form.test.ts)
export async function fillToPhotos(slug: string): Promise<{ v: Visitor; renderedAt: number; html: string }>;
/** Fills and submits the reference form with `photos` synthetic JPEGs; returns the stored reference and id. */
export async function submitReference(pool: Pool, slug: string, photos: number): Promise<{ reference: string; submissionId: string }>;
```

- [ ] **Step 1: Move the fill helpers.** `fillToPhotos`, `photos`, `asFiles`, `waitForMinimumTime` move to `tests/e2e/fill.ts`; `reference-form.test.ts` imports them. Run `pnpm build && pnpm test:e2e`: the existing suite still passes.
- [ ] **Step 2: Failing tests.** `tests/e2e/review.test.ts` (Spanish form `historia-prematuro-*`, `usePostPlan: true`; owner `owner@example.com`; story field key `story`):
  - "reviews, corrects, chooses, plans, publishes and exports a story": `submitReference(pool, slug, 2)` → `HP-0001`; `GET /admin/forms/<id>` 200 with `HP-0001` and `1 respuestas`; `GET` the story page 200 with `Una historia inventada para pruebas automáticas.`, status `viewed` in the database, one `submission_viewed`; capture `answers::text`; `POST .../correction` `{ field: "story", text: "Una historia inventada, corregida para pruebas.", back: "" }` → 303 to `?done=saved`; the page shows `Editada` and `Corregida por owner@example.com`; `?compare=story` has `<ins` and `<del`; `POST .../choice` with the first photo id and `chosen=1` → 303 ending `#photos`; `POST .../check` `photos_edited`, `1`; `story.text_checked_at` is set by the correction; `GET .../media/<id>?view=thumb` 200 `image/webp`; `?view=full` 200 `image/jpeg` and one `photo_viewed`; `POST .../plan` with tomorrow in Panama → 303; `GET /admin/plan?week=<tomorrow>` shows `HP-0001` and `Lista`; `POST .../status` `{ intent: "publish", post_url: "https://www.instagram.com/p/prueba-0001/" }` → 303 `done=published`; the plan shows `Publicada` and the link; `GET .../photos.zip?set=chosen` 200 `application/zip` with `readStoredZip` giving one entry `HP-0001/01-<field slug>.jpg`; `download("/admin/forms/<id>/export", { versions: "all", text: "both", paths: "1" })` 200 `text/csv`, bytes start `EF BB BF`, the header row starts `Referencia,Estado,Recibida (UTC),Versión,Idioma,Fecha planificada,Enlace de la publicación`, the row holds both the original and the corrected story; one `submissions_exported`; after all of it `answers::text` is unchanged.
  - "adds staff photos only after the sender is confirmed": `POST .../photos` multipart with one synthetic JPEG and `source=whatsapp` but no `confirmed` → 303 `error=not_confirmed#photos`, no new media row; with `confirmed=on` → 303 `done=photos_added&n=1#photos`, a media row with `field_key = 'staff-photos'` and `durable_key` matching `^forms/historia-prematuro-[a-z0-9]+/HP-0001/staff-01-[0-9a-f]{8}\.jpg$`, a `staff_photo` row, and the page shows `Agregadas por el equipo` and `Desde WhatsApp`.
  - "refuses a tampered over-long correction and keeps the original": `text` of 20,001 characters → 303 `edit=story&error=correction_too_long&n=20000`; no edit row.
  - "asks before taking a planned day, then moves the other story": two stories planned on the same day → the second answers 303 with `conflict_date` and `conflict_ref=HP-0001`; the page says `HP-0001 ya está planificada para el <date>.`; the post again with `resolution=move` → HP-0001 is waiting (`planned_on` null).
  - "answers an unknown story with the not-found body": `GET .../submissions/HP-9999` 200 (ADR 0027) with `Respuesta no encontrada` and a link back to the list.
  - "sends a post without a session to sign-in and a stale token to the out-of-date page": anonymous `POST .../correction` → 302 to `/admin/auth/signin?returnTo=` the story path; wrong `csrf` → 403 with `Esta página estaba desactualizada`.
  - "deletes a story after its reference is typed, with every file": wrong `typed` → 303 `action=delete&error=reference_mismatch`; `typed: "hp-0001"` → 303 to the list with `deleted=HP-0001`; the `submission`, `story` and `staff_photo` rows are gone; `media.delete` jobs equal the media rows the story had, staff photo included; one `submission_deleted`.
  `tests/e2e/operations.test.ts`:
  - "flags a dead upload in the list and on the story, and Try again retries it": insert a dead `media.upload` job for the story's first media id; the list shows `Necesita atención`; the story page shows `Algo no terminó para esta historia` and `Una foto o video no llegó a Dropbox.`; `POST .../retry` → 303 `done=retried`; the job is `pending` with `attempts = 0`.
  - "Operations lists dead jobs, discards with a reason and retries all of a type": two dead `media.upload` and one dead `jobs.cleanup`; `GET /admin/operations` shows them with `HP-0001` linked and `Reintentar todos los trabajos media.upload (2)`; `POST /admin/operations/discard` with an empty reason → 303 `error=reason_invalid&job=<id>`; with `"Prueba"` → `discarded` with that reason; `POST /admin/operations/retry-type` `media.upload` → 303 `done=retried_all&n=1`.
- [ ] **Step 3: Run** `pnpm build && pnpm test:e2e`. Expected: PASS. These tests come after the code they cover; a failure is a bug in the task that owns that code, fixed there with a unit test that reproduces it first.
- [ ] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `test(e2e): review a story end to end without script, with the failure paths`

---

### Task 27: End to end in a browser: the story page, the post plan and Operations by keyboard

**Files:**
- Create: `tests/browser/review.spec.ts`

**Interfaces:**
- Consumes: `seedAdminSession`, `submitReference`, `publishReferenceForm` (Task 26), `BROWSER_E2E_BASE_URL`.

- [ ] **Step 1: Write the specs.** A browser context with the session cookie (`context.addCookies` on `127.0.0.1`, path `/admin`, `httpOnly`), the Pixel 7 project, a story submitted over HTTP first:
  - "the owner corrects, chooses, ticks, plans and publishes with the keyboard": open the story page; Tab from the skip link and record the accessible names reached in order; they include, in this order, `Editar`, `Elegir para la publicación`, `Marcar fotos como editadas`, `Planificar`, `Marcar como publicada`, `Eliminar respuesta`; every focused element has a visible focus indicator (computed `outline-style` not `none` or a `box-shadow`); press Enter on `Editar`, type a correction, Tab to `Guardar corrección`, Enter → the status `Corrección guardada` is visible; Enter on `Elegir para la publicación` → the tile reads `Elegida para la publicación`; Enter on `Marcar fotos como editadas` → the row reads `Hecho`; fill the date field with tomorrow and press Enter on `Planificar` → `Planificada · <date>`; Enter on `Marcar como publicada`, type the link, Enter on `Confirmar` → `Publicada el <date>`.
  - "the post plan picks a story for an empty day by keyboard": a second story waiting; on `/admin/plan`, Tab to the first `Elegir una historia` of a future day, Enter, Tab to `Planificar para el <date>`, Enter → that day shows the story's reference.
  - "compare changes are reachable with Tab": after a correction, `?compare=story`; Tab reaches each `ins` and `del` and its accessible text includes `Agregado` or `Quitado`.
  - "reduced motion is respected": with `reducedMotion: "reduce"`, no element on the story page has a running CSS animation.
  - "Operations retries a dead job by keyboard": a dead job inserted by SQL; Tab to `Reintentar`, Enter → `El trabajo se ejecutará de nuevo en breve.`.
- [ ] **Step 2: Run** `pnpm build && pnpm test:e2e:browser` (one heavy process). Expected: PASS.
- [ ] **Step 3: Run** `pnpm lint && pnpm typecheck && pnpm format:check`. Expected: PASS.
- [ ] **Step 4: Commit** `test(e2e): story page, post plan and operations by keyboard in Chromium`

---

### Task 28: Verification, spec sync and the pull request

**Files:**
- Modify: `specs/ui-ux/manager.md` ("Build status", "First pass" notes, if anything changed while building), any spec a task's decision touched, `README.md` only if it lists surfaces

- [ ] **Step 1: Re-read the design's Goals, "Decided with the owner" and "Decided by the designer"** against the built pages; for every item, name the task and test that covers it in the PR description. Anything uncovered becomes a new task before going on.
- [ ] **Step 2: Run the whole suite, at most three heavy processes at a time:** `pnpm lint`, `pnpm typecheck`, `pnpm format:check`; then `pnpm test` and `pnpm test:integration`; then `pnpm build`, then `pnpm test:e2e`, then `pnpm test:e2e:browser`. Expected: every command exits 0. Do not claim completion without seeing each pass.
- [ ] **Step 3: Privacy sweep.** `git grep -nE "@(gmail|hotmail|yahoo|outlook)\.|effluz\.com" -- tests src` finds only `effluz.com` as the allowed hosted domain in configuration and tests of it; logs added by this plan (`git diff main --stat`, then each `logger.` call) carry ids only.
- [ ] **Step 4: Spec sync.** `manager.md` "Build status" says what this branch built and what stays pending (the Audit page, the banner above the Forms list, the language menu and shortcuts, the builder, the Operations cards beyond the heartbeat, DeepL suggestions); `architecture.md`'s status line and `jobs.md`'s registered handler list match the code.
- [ ] **Step 5: Open the pull request** from the feature branch (`feat/review-story-page-and-post-plan`, branched from `main`) with a description that links the design document and the spec sections each task implements, lists the decisions and Planner's calls of this plan, asks the owner to confirm the one about staff photos and the current version, and ends with the attribution line from the session. Do not merge it.
- [ ] **Step 6: Commit** any last spec edits as `docs: sync specs with the review module as built`.
