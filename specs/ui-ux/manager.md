# UI/UX: Manager

The staff surface for running forms and working with submissions. Status:
first pass, 2026-10-09; review added 2026-10-18. Use cases: `sign-in.md`,
`publish-form.md`, `manage-form-settings.md`, `review-submissions.md`,
`curate-submission.md`, `operate-jobs.md`. The builder is its own surface, `ui-ux/builder.md`,
reached from here.

## Build status

Built: the shell, the Forms list, the New form page, the form overview with
its lifecycle actions, the Settings, Share and Activity tabs, the Submissions
tab (list and export), the story page (answers, photos and staff photos,
corrections, readiness, the planned date, publishing and delete), the Post
plan page and a first-pass Operations page (the heartbeat card and the dead
jobs table). Pending, each with its own plan: the Audit page, the banner above
the Forms list, the language menu and keyboard shortcuts of the shell, the
builder (its route is a placeholder), the Operations cards beyond the
heartbeat, and DeepL correction suggestions (the `st.suggest*` rows are
reserved for them). The sections below specify the target; the "First pass"
notes say what the built pages do today.

## Principles

1. **Forms first.** The home screen is the list of forms with what is new.
   Everything else is one click from a form.
2. **Context stays.** Opening a submission never loses the filtered list.
3. **The original is sacred.** Edited text is always shown as edited, always
   comparable, always revertible.
4. **Every look is accounted for.** Viewing, downloading and exporting
   personal data is audited, and the interface says so where it matters.
5. **Same rules as the renderer.** WCAG 2.2 AA, both languages, works on a
   phone.

## Shell

A top bar with the Effluz wordmark, primary navigation (Forms, Post plan,
Operations, Audit), the signed-in user's name with a menu (language EN/ES, keyboard
shortcuts, sign out). Below 768 px the navigation collapses into a menu
button. Every page has an `<h1>` and a breadcrumb from Forms downward.

Responsive tiers match the builder: three-column layouts from 1280 px,
two from 768, single column with full-screen panels below.

First pass: Audit appears in the navigation as a disabled link
(`aria-disabled`, no `href`) until its page exists. The current section is
marked `aria-current="page"` from the request path, which the proxy passes to
the gated layout in the `x-effluz-section` request header (`forms`, `plan`,
`operations` or `audit`, set for every `/admin` request it lets through and
overwriting any value the client sent); a missing or unknown value reads as
Forms. There is no language
preference yet, so every string shows English with the Spanish line beneath
it, marked `lang="es"`; identical text shows once. The language menu and the
keyboard shortcuts entry wait for the manager's first client component.

## Routes

All routes sit under `/admin`, which the proxy gates (`src/proxy.ts`).

| Route | What it is |
|---|---|
| `GET /admin` | Redirects to `/admin/forms` |
| `GET /admin/forms` | Forms list (`?tab=`, `?q=`) |
| `GET /admin/forms/new` | New form page (`?error=` and the carried-back values) |
| `POST /admin/forms/create` | Creates a form, 303 to its overview or back to the New form page. A route cannot sit beside the page at `/admin/forms`, hence the name |
| `GET /admin/forms/[id]` | The Submissions tab: the list (`?status`, `plan`, `from`, `to`, `version`, `media`, `q`, `page`; `?export=1` opens the export dialog; `?deleted=<ref>` reports a deletion), under the form header (`?action=` opens a lifecycle confirmation, `?error=` shows a refusal) |
| `GET /admin/forms/[id]/settings`, `share`, `activity` | The other tabs |
| `GET /admin/forms/[id]/edit` | Builder placeholder |
| `POST /admin/forms/[id]/lifecycle` | Close, reopen, archive or unarchive, 303 to the overview |
| `POST /admin/forms/[id]/delete` | Delete a never-published form, 303 to the list |
| `POST /admin/forms/[id]/export` | Answers the CSV (200, attachment) or 303 back to the dialog with `?export=1&error=too_large` |
| `GET /admin/forms/[id]/submissions/[reference]` | The story page; the list's query keys travel with it, plus `edit`, `compare`, `photo`, `action`, `field`, `media`, `conflict_date`, `conflict_ref`, `conflict_swap`, `done`, `error`, `n`, `other` |
| `POST .../[reference]/correction`, `revert`, `status`, `photos`, `photos/remove`, `choice`, `check`, `plan`, `retry`, `delete` | The story page's changes, 303 back to it (`delete` to the list) |
| `GET .../[reference]/media/[mediaId]?view=thumb\|full\|download` | A thumbnail, the full file (or a redirect for a stored video), or the file as an attachment |
| `GET .../[reference]/photos.zip?set=all\|chosen` | The story's photos as a ZIP |
| `GET /admin/plan` | The Post plan (`?week=<date>`, `?pick=<date>`) |
| `GET /admin/operations` | Operations; `POST /admin/operations/retry`, `discard`, `retry-type` change it, 303 back |
| `GET /admin/media/local/[key]` | A local durable file, the target of a video redirect when `MEDIA_PROVIDER=local` |
| `GET /admin/forms/[id]/qr.png?size=1024\|2048`, `qr.svg` | QR downloads (`?download=1` makes the SVG an attachment; without it the SVG is the preview) |
| Settings server action | `saveSettings` in `(gated)/forms/[id]/settings/actions.ts`, posted by the Settings tab |

Every handler that changes data answers a handled form post with a 303 (Post/
Redirect/Get). A request without a session gets the sign-in redirect (302), a
stale or missing token the `auth.stale_*` page (403), and a tampered body a bare
400. `src/app/admin/_lib/request.ts` holds the guards: `requireSession` returns
the active session or a redirect to sign-in, and `requireCsrf` adds the check of
the form's `csrf` field against the session token. Both take the page to return
to after sign-in, since sign-in returns with a GET. The proxy does the same for
a POST that arrives without a session: it returns to the page that posted
(`create` to the New form page, `lifecycle` and `delete` to the overview), never
to the route and never with a query. The sign-in return paths of the review
routes: a story POST returns to its story page, `export` to the overview, an
Operations POST to Operations. Bare 400 and 404 answers carry
`Cache-Control: no-store` (`plain` in `request.ts`). Pages read the session
through `pageSession` (`_lib/page.ts`), and every page or layout that does so
exports `instant = false`, which lets it block on the session and the database
under Cache Components. The QR routes need a session but no CSRF token, as they
change nothing; their answers are `private, no-cache`, so a draft's new slug
shows at once. The media routes also need a session and no CSRF token; their
answers are `private`.

## Forms list (home)

- Tabs: **Active** (draft and published), **Closed**, **Archived**. Counts
  in each tab.
- Table columns: title, status badge with version, new submissions since
  this user last opened the form (bold when above zero), total submissions,
  last submission time, close date if set, actions menu.
- Sorted by last submission time (forms with none last), then title. Search by
  title or slug. Submission figures come from the `SubmissionStats` port;
  until the submissions module supplies one every form shows zero.
- Row click opens the form overview. Actions menu: Open, Edit in builder,
  Share, Settings, and the lifecycle actions allowed for its status. Each
  lifecycle action opens its confirmation on the form overview; Delete is
  offered there only. Without JavaScript the menu is a disclosure of links,
  named after its form, reached with Tab.
- Search is a plain GET form that keeps the current tab. Tab counts do not
  depend on the search. A tab or search with no forms says
  `home.none_here`; `home.empty` is only for an installation with no forms
  at all.
- Dates show in both the form's time zone and UTC, both visible:
  `YYYY-MM-DD HH:mm` followed by the zone name, with the UTC time on a
  second line. An empty date cell reads `home.none` to assistive technology.
- "New form" button opens the dialog specified in `ui-ux/builder.md`.
- A banner appears above the list only when something is wrong: worker
  heartbeat stale, dead jobs present, last backup older than two days. It
  links to Operations.
- Empty state for a new installation: one sentence and the New form button.

## Form overview

Header: title, status badge, version, slug as a copyable public URL,
language mode, open and close dates with a "closing in {n} days" note when
within seven days. Buttons: Edit in builder, Share, and a lifecycle menu
(Close, Reopen, Archive, Unarchive, Delete when allowed).

Tabs: **Submissions**, **Settings**, **Share**, **Activity**.

Lifecycle actions confirm in a dialog that states the effect in one
sentence, for example "People with the link will see that the form is
closed. Submissions already received are kept." Delete is offered only when
the use case allows it and requires typing the slug.

First pass, without JavaScript:

- The public URL is a read-only input labelled `sh.url`, with
  `form.url_hint` beneath it. There is no Copy button until the page has a
  script; Content Security Policy rules out an inline one.
- The language mode uses the `new.*` names. Open and close dates use
  `set.opens` and `set.closes`, shown in the form's time zone and in UTC.
- The lifecycle menu is a disclosure of links named `home.actions`. Each
  link opens its confirmation on the overview (`?action=close`, `reopen`,
  `archive`, `unarchive` or `delete`). The confirmation is a page section
  that posts to `/admin/forms/<id>/lifecycle` or `/admin/forms/<id>/delete`.
  An action the form no longer allows shows `form.error_transition`.
- A closed or archived form shows its banner with the Reopen or Unarchive
  action.
- A refused deletion returns with `form.error_slug_mismatch`, with the
  confirmation open again, or `form.error_not_allowed`.
- Submissions is the overview itself: its body is the Submissions list
  described below.
- Edit in builder leads to a placeholder page with the form's title,
  `builder.placeholder`, and links to Settings and Share.

## Submissions tab

### List

- Filter bar: status chips (New, Viewed, Edited, Published, with counts), a
  second chip group "Post plan" with Planned, Waiting for a date and Not ready
  (shown only on post-plan forms), date range (`from`, `to`), version, has
  media, search box (reference, short text answers and email answers).
  Filters persist in the URL (`?status`, `plan`, `from`, `to`, `version`,
  `media`, `q`, `page`) so a filtered view is shareable among staff. Chips are
  links; the active one carries `aria-current="true"` and a check mark, since
  `aria-pressed` needs a button.
- Table columns: reference, status (the badge, or "Planned · <date>" for a
  planned, unpublished story), received, label (first short text answer),
  media count with a camera or film icon, version, locale, dead job flag. A
  row is a link to the story page, which keeps the list's query.
- Pagination of 50 with a total count and Newer and Older links ("Page n of
  total"). Export button opens the export dialog scoped to the current
  filters.
- Empty states: no submissions yet (with the public URL and Share link), or
  no submissions match the filters (with a clear-filters action).
- First pass: rows are links (Tab and Enter). Up, Down, J and K arrive with
  the first client component.

### Story page

A full page that replaces the drawer for every form (Fitts's Law: Newer, Older
and Back sit at a fixed place at the top). Reason: the page holds the photos,
the correction editor and the readiness panel, which do not fit a drawer. Route
`GET /admin/forms/[id]/submissions/[reference]`. In order:

1. Breadcrumb: Forms, the form's title, the reference.
2. `<h1>`: the reference. Beside it the status badge, or "Planned · <date>" for
   a planned, unpublished story; the received time (form zone and UTC), the
   version, and "Sent in English" or "Sent in Spanish".
3. Newer, Older and Back to the list. Newer and Older follow the list's
   filters and stay correct when the story no longer matches them (opening a
   new story under the "New" chip makes it viewed).
4. Banners: the flash of the last change, a refusal, and the dead-jobs warning
   with Try again.
5. **Answers** card: per page title, each answer through its field type's
   review display; a file upload answer shows `st.files_below_one` or `st.files_below_other` and its files
   sit in the Photos and videos card. Text answers show the corrected text when
   a correction exists, with an "Edited" tag, "Compare with original" and
   "Edit"; unedited text answers show "Edit". Other types have no actions.
6. **Photos and videos** card: the sender's files ("Sent with the form"), then
   "Added by the team". Per file: the thumbnail (a tile with the words "Video n
   of total" for a video), "View full size", "Download"; on post-plan forms
   "Choose for the post" or "Remove from the post". Above the grid "Download
   all ({count})" and, on post-plan forms only, "Download chosen ({count})". An "Add photos" form (post-
   plan forms only).
7. **Ready to post?** panel (post-plan forms only): the three checks, each with
   "Done" or "Missing" and a tick or a cross, the two tick buttons ("Mark photos
   as edited", "Mark text as checked") and the planned date form.
8. **Publishing**: "Mark as published" with the optional post link, or, once
   published, the published day, the link and "Unmark as published".
9. **Consent** (collapsed): the accepted text version and time.
10. **Activity**: the audit entries for this submission, newest first.
11. **Delete submission**.

Without script every confirmation (revert, unpublish, remove photo, delete,
plan conflict) is an in-page `<section role="dialog">` opened by `?action=`,
labelled by its heading and described by its body, as the lifecycle
confirmations are.

Post-plan parts (adding staff photos, choosing photos, the readiness panel,
the planned date) appear only on forms with the post-plan setting on. Turning
the setting off later keeps planned dates and ticks but hides them until it is
turned back on; photos the team already added stay shown and removable, while
adding and choosing photos are hidden. "Add photos" also needs the form's
current version to cover consent item 10 (`later_photos`); otherwise the form
shows `st.laterphotos_off` in its place.

The contact answers are ordinary answers: a form is data, so the page cannot
know which answers are contact details.

### Edit a text answer

`?edit=<field>` replaces the answer block with a two-column editor from 768 px
(Original, read only, and Corrected, a textarea with `required` and
`maxlength` set to the field's limit), one column below. Both columns are
labelled (`st.original`, `st.corrected`) with `st.correction_hint` under the
heading. Buttons: Save correction, Cancel. There is no "Suggest correction"
until a correction service is built; `st.suggest*` rows are reserved. Save
returns to the answer with the Edited tag, ticks "Text checked" and shows
`st.saved`.

"Compare with original" (`?compare=<field>`) opens the same two columns
read-only. Each change is marked with `<ins>` or `<del>`, a visually hidden
"Added" or "Removed", underline or strike-through, and `tabindex="0"`; the
change count is a polite status (`st.changes_one`, `st.changes_other` or `st.no_changes`). Compare
offers Edit and "Revert to original", which opens its in-page confirmation
(`st.revert_confirm`).

### Photo viewer

`?photo=<mediaId>` shows an in-page section above the cards: the image or the
native video player, "Photo n of total" (or "Video n of total"), Previous,
Next, Download, "In Dropbox: <path>" (or `st.not_stored`), "Views and downloads
are recorded", and "Back to the story". Opening the full-size view and
downloading are audited.

### Mark as published

An in-page confirmation with an optional "Link to the post" field accepting
only `https` URLs, and Confirm. The badge updates on the story page and in the
list. Unmark asks for confirmation and says which status it returns to
(`pub.unmark_viewed` or `pub.unmark_edited`); it clears the post link and
keeps the planned date when that day is still free, otherwise the story returns
to Waiting for a date (`pub.unmark_waiting`). A story
published keeps its planned date as the day it went out; a story published
with no planned date takes the publish date as its day without taking that
day's slot.

### Plan a story

The planned date is one date per story, in the form `YYYY-MM-DD`, with Plan and
"Remove the date". One unpublished story per day: planning a day that already
holds one opens an in-page confirmation naming it, with "Swap the two dates"
and "Move <ref> to Waiting for a date". A published story stays on the day it
went out and shows no plan form; the Publishing card states its day. Planning
is a date on the story, never a new status.

### Export dialog

An in-page section opened by `?export=1`. Scope line: "{count} submissions
matching the current filters". Options: versions (as filtered or all), text
answers (Original, Corrected, Both columns), include file paths. A notice:
"This file contains personal data. It is recorded that you exported it."
Button: Download CSV. Exports above 10,000 rows are refused with a request to
narrow the filters (`ex.too_large`).

### Delete

An in-page confirmation states the reference, that files in Dropbox will also
be deleted, and that this cannot be undone. Requires typing the reference.

## Settings tab

A single form grouped in sections, saved with one Save button and a
discard warning on navigation:

| Section | Fields |
|---|---|
| Notifications | recipients (chips, domain-validated), cadence (per submission or daily digest with hour and timezone) |
| Data | retention months with the warning flow from the use case, reference prefix (read-only after first submission) |
| Availability | open date and time, close date and time, timezone |
| Protection | bot challenge toggle with the accessibility note |
| Responses | allow another response toggle |
| Post plan | use submissions in the post plan toggle, the notice when the current version's consent text lacks item 10 |
| Link | slug, editable only before first publish |

Each field has a help line. Save confirms in a toast and writes the audit
entry.

First pass, without JavaScript:

- The tab is one form posted to a server action, which always redirects
  back to the tab (Post/Redirect/Get); it is not a route handler. A refused
  save keeps the values as submitted and the reasons in the cookie
  `effluz_settings_state`, scoped to the tab's path, httpOnly, `SameSite=Lax`,
  living 600 seconds, and returns with `refused` set to the save's time (in
  milliseconds); the tab shows that state only for that value. A save that
  goes through clears the cookie and returns with `saved`. The cookie may
  carry the submitted notification addresses, staff data already held in the
  database; when the state would not fit a cookie the values are dropped and
  the tab shows the stored ones.
- After a refusal each issue sits under its field, linked with
  `aria-describedby`, the field marked `aria-invalid`. An issue with no
  field of its own (`set.err_malformed` on the whole payload,
  `set.err_stale`) is a banner above the sections.
- Recipients are a text area, one address per line; blank lines are
  ignored. The empty list shows `set.no_recipients`.
- The time zone sits in Availability with `set.timezone_hint`, since the
  open and close times are entered in it; the daily summary hour uses it
  too. Each set time also shows in UTC.
- Shortening retention below existing submissions shows `set.retention_warn`
  in a warning banner. The footer then shows a second, destructive button,
  `set.retention_confirm`, after Save and described by the warning, that
  confirms the purge. Save stays the form's first submit button, so Enter in
  a field never confirms a purge.
- A save that succeeds returns to the tab with a success banner,
  `set.saved`, in place of the toast. `set.discard_warn` shows beside Save
  after a refused save. The warning on navigating away with unsaved edits
  needs JavaScript and is not built yet.
- The reference prefix and the slug are disabled, not hidden, once locked;
  their hints say why.
- The bot challenge is not built yet. The toggle still saves, and
  `set.challenge_unavailable` sits under its help line.

## Share tab

Public URL in a read-only, selectable field. Its Copy button needs script
and waits for the manager's first client component (`sh.copy` and
`sh.copied` are bound for it; the first pass has no Copy button). QR code
preview, rendered locally by the `qrcode` library (`decisions/0021`), with
download as PNG (1024 px and 2048 px) and SVG; the preview and the downloads
encode exactly the public URL, and the files are named
`<slug>-qr-<size>.png` and `<slug>-qr.svg`. A print-ready PDF with the form
title and URL under the code is planned and has no link until it exists. A
warning when the form is not currently reachable: never published, closed,
archived, or outside its date window, with the reason in words
(`sh.reason_*`). The link and QR stay available meanwhile. Short guidance:
"The QR code and link stay the same when you publish changes."

## Activity tab

The audit log filtered to this form, newest first: time (shown in UTC, as
`YYYY-MM-DD HH:mm UTC`), actor, action (plain words, `au.action_*`), and
target. Every entry of this tab concerns the form itself, so the target is a
link to the overview, followed by the entry's details when it has any. An
action written by another module is shown as stored. Filter by actor and
action with a plain GET form, so a filtered view is a shareable link. A page
holds 50 entries; "Older entries" appears only when older ones exist and
continues from the oldest one shown. The cursor is the pair (time, id) of that
entry, so entries written at the same instant are never skipped. A filter value
the menus do not list (an actor no longer in the list, an action of another
module) is added as an option, so the menus always show the filter in force.
Export as CSV comes with the audit page and has no control here
until then.

## Post plan page

`GET /admin/plan`. A top-level page that answers three questions: what goes out
this week, which days are empty, and what is not ready yet. It covers the
forms with the post-plan setting on, which share the one plan; with none,
`plan.no_forms` is shown.

- `<h1>` Post plan. Previous week, This week and Next week are links
  (`?week=<date>` takes any date and shows its week). A line "Week of
  <Monday>". Weeks run Monday to Sunday in the Panama time zone for every form.
- Seven day rows, Monday to Sunday, each with the weekday and date in both
  languages; today's row is marked with the word "Today".
- A day with an unpublished planned story shows its reference (a link to the
  story page), its label, its form and its three checks with words ("Photos
  chosen", "Photos edited in Canva", "Text checked", each "Done" or "Missing").
  Published stories of that day show "Published" and, when a link exists,
  "Open the post". An empty day shows "Pick a story" (today and later) or
  "Nothing planned" (past days).
- Days are `<li>` items of one list; today's carries `aria-current="date"`
  besides the word. Stories link to their page; a published story's post link
  opens in a new tab with the outward icon. A day with only published stories
  is not empty: it shows them and no "Pick a story".
- "Pick a story" opens `?pick=<date>`, which shows "Choose a story for <date>"
  above Waiting for a date, each row with "Plan for <date>", a plain form posting `date`, `week` (the
  Monday shown) and `return=plan` to the story's `plan` route, which then
  answers 303 back to this page. Any valid date can
  be planned, past ones included, so staff can backfill.
- **Waiting for a date**: unpublished, unplanned stories of post-plan forms,
  newest first, at most 50, with the total count.
- Opening the page is audited, as it shows each story's label.

## Operations page

First pass. The page shows:

- the **heartbeat card**: the age of the worker's last heartbeat in words and
  a status, "OK" up to 60 seconds, "Warning" up to the stale limit (300
  seconds), "Critical" above that or when no worker ever wrote one; never
  colour alone;
- the **worker-down banner** (`ops.worker_down`) when the heartbeat is critical;
- the **dead jobs table** (`ops.dead_title`): type, story (a link, or
  `ops.no_story`), attempts, last error, first and last attempt, with Retry
  and Discard with reason for each row; "Retry all of type" when more than one
  dead job shares a type. The reason is 1 to 200 characters. An empty table
  says `ops.none_dead`.

A done change shows a status banner (`ops.retried`, `ops.retried_all_one` or
`_other` by the count, `ops.discarded`). A refused discard shows `ops.err_reason`
under that row's reason input (`aria-invalid`, linked with `aria-describedby`),
or as a banner when the job is no longer listed. Times show in the Panama zone
with UTC beneath.

The other cards (pending jobs, oldest pending, last backup, staging size) and
the link to the runbooks are later. Retry sets a dead job back to pending; it
runs again shortly.

## Audit page

The global audit log with filters by actor, action, form and date, and CSV
export. Rows link to the form or submission where it still exists. A note
explains that entries are kept for one year.

## States

- **Loading**: skeleton rows, never a spinner on a blank page.
- **Errors**: inline, with Retry; the shell stays usable.
- **Not found**: a form route for an unknown form shows, inside the shell,
  a breadcrumb back to Forms, the `<h1>` `shell.not_found_title`, one
  sentence (`shell.not_found_body`) and one link (`shell.not_found_back`) to
  the Forms list, with status 404. The lifecycle and delete routes send an
  unknown form to its overview, which shows this page.
- **Closed or archived form**: a banner in the overview explaining what
  the public sees and how to reopen.
- **Submission deleted while open**: the story page shows its not-found body
  (`st.not_found_title`, `st.not_found_body`, and `st.not_found_back` to the
  list) inside the shell, with status 404. Pages render it themselves rather
  than throwing, as ADR 0027 requires.
- **Offline**: a banner; read-only actions still show cached data where the
  browser has it; mutations are disabled.

## Laws of UX applied

| Law | Where |
|---|---|
| Hick's Law | Three tabs on home; one actions menu per row; status chips instead of a dropdown |
| Jakob's Law | Table, filter bar, breadcrumb and photo grid patterns from common admin tools |
| Fitts's Law | Row-wide click targets; Newer, Older and Back at a fixed place at the top of the story page; primary action top right |
| Law of Proximity, Common Region | Answers grouped under page headings; settings in bordered sections; cards on Operations |
| Doherty Threshold | The story page renders its text first and thumbnails stream after; filters are plain links and answer in one request |
| Peak-End Rule | Publishing a submission ends with the post link saved and visible in the list and on the Post plan |
| Zeigarnik Effect | New counts on home and status chips keep unfinished review visible |
| Von Restorff Effect | Edited tags and dead-job flags are the only highlighted elements in a row |
| Tesler's Law | Export, ZIP naming and Dropbox paths follow fixed schemes; staff never name files |

## Accessibility notes beyond the baseline

- Tables use proper headers; sortable columns announce sort state.
- Confirmations are in-page dialogs labelled by their heading.
- The photo viewer announces "Photo {n} of {total}" and video controls are the
  native ones.
- Choosing a photo, the readiness checks and the plan are plain buttons and
  forms, fully keyboard-operable; a chosen photo says "Chosen for the post" in
  words with a check icon, and each check says "Done" or "Missing" with a tick
  or a cross.
- Compare highlights use underline and strike styles in addition to color,
  and each change is reachable with Tab.
- Status badges carry text, never icon-only.
- Charts do not exist; Operations uses numbers and words.

## Performance targets

| Measure | Target |
|---|---|
| Forms list | under 500 ms server render with 100 forms |
| Submissions list page | under 500 ms with 10,000 submissions in the form |
| Story page | under 300 ms to text content; thumbnails stream after |
| Export of 10,000 rows | starts streaming within 2 seconds |

## Fixed chrome copy

The complete set the manager owns, in addition to strings shared with the
builder (status names, New form dialog).

### Shell and home

| Key | English | Spanish |
|---|---|---|
| nav.forms | Forms | Formularios |
| nav.plan | Post plan | Plan de publicaciones |
| nav.operations | Operations | Operaciones |
| nav.audit | Audit | Auditoría |
| nav.language | Language | Idioma |
| nav.shortcuts | Keyboard shortcuts | Atajos de teclado |
| nav.sign_out | Sign out | Cerrar sesión |
| home.active | Active | Activos |
| home.closed | Closed | Cerrados |
| home.archived | Archived | Archivados |
| home.new_form | New form | Nuevo formulario |
| home.search | Search forms | Buscar formularios |
| home.col_title | Title | Título |
| home.col_status | Status | Estado |
| home.col_new | New | Nuevos |
| home.col_total | Total | Total |
| home.col_last | Last submission | Última respuesta |
| home.col_closes | Closes | Cierra |
| home.empty | No forms yet. Create the first one. | Aún no hay formularios. Crea el primero. |
| home.banner_worker | Background jobs are not running. | Los trabajos en segundo plano no se están ejecutando. |
| home.banner_dead | {count} jobs need attention. | {count} trabajos necesitan atención. |
| home.banner_backup | The last backup is older than two days. | La última copia de seguridad tiene más de dos días. |
| home.see_operations | See Operations | Ver Operaciones |
| home.search_submit | Search | Buscar |
| home.none_here | No forms to show here. | No hay formularios para mostrar aquí. |
| home.version | v{n} | v{n} |
| home.actions | Actions | Acciones |
| home.open | Open | Abrir |
| home.none | None | Ninguna |
| shell.wordmark | Effluz | Effluz |
| shell.signed_in_as | Signed in as {name} | Sesión iniciada como {name} |
| shell.skip_to_main | Skip to main content | Saltar al contenido principal |
| shell.main_nav | Main navigation | Navegación principal |
| shell.breadcrumb | Breadcrumb | Ruta de navegación |
| shell.cancel | Cancel | Cancelar |
| shell.not_found_title | Form not found | Formulario no encontrado |
| shell.not_found_body | It may have been deleted, or the link is out of date. The forms list shows what exists today. | Puede haber sido eliminado o el enlace está desactualizado. La lista de formularios muestra lo que existe hoy. |
| shell.not_found_back | Back to forms | Volver a los formularios |

`shell.main_nav` and `shell.breadcrumb` name the two navigation landmarks
for assistive technology. `shell.cancel` is the cancel link of every
confirmation dialog. `shell.not_found_*` is the page a form route shows for
an unknown form (see "States").

### Sign-in and access

Pages outside the session gate, from `use-cases/sign-in.md`.

| Key | English | Spanish |
|---|---|---|
| auth.denied_title | This account cannot access the admin area | Esta cuenta no puede acceder al área de administración |
| auth.denied_body | Only accounts on the Effluz Workspace domain can sign in. Sign in with your Effluz work account. | Solo pueden iniciar sesión las cuentas del dominio de Effluz en Workspace. Inicia sesión con tu cuenta de trabajo de Effluz. |
| auth.denied_retry | Try another account | Probar con otra cuenta |
| auth.signed_out_title | You have signed out | Has cerrado sesión |
| auth.signed_out_body | Your admin session has ended. You are still signed in to Google. | Tu sesión de administración ha terminado. Tu sesión en Google sigue abierta. |
| auth.signed_out_again | Sign in again | Volver a iniciar sesión |
| auth.error_title | Sign-in did not complete | No se pudo completar el inicio de sesión |
| auth.error_body | Google may be unavailable, or the sign-in link expired. No session was created. | Es posible que Google no esté disponible o que el enlace de inicio de sesión haya caducado. No se creó ninguna sesión. |
| auth.error_retry | Try again | Intentar de nuevo |
| auth.csrf_title | Sign-out did not go through | No se pudo cerrar la sesión |
| auth.csrf_body | This page was out of date. Open the admin area again and sign out from there. | Esta página estaba desactualizada. Vuelve a abrir el área de administración y cierra la sesión desde allí. |
| auth.stale_title | This page was out of date | Esta página estaba desactualizada |
| auth.stale_body | Nothing was saved. Open the admin area again and try once more. | No se guardó nada. Vuelve a abrir el área de administración e inténtalo otra vez. |

The out-of-date pages reuse `auth.error_retry` for their link back to the
admin area. `auth.csrf_*` is the page behind a refused sign-out;
`auth.stale_*` is the page behind any other manager form refused for a
wrong CSRF token.

### Form overview and lifecycle

| Key | English | Spanish |
|---|---|---|
| form.edit | Edit in builder | Editar en el constructor |
| form.share | Share | Compartir |
| form.closing_in | Closing in {n} days | Cierra en {n} días |
| form.tab_submissions | Submissions | Respuestas |
| form.tab_settings | Settings | Configuración |
| form.tab_share | Share | Compartir |
| form.tab_activity | Activity | Actividad |
| life.close | Close form | Cerrar formulario |
| life.close_body | People with the link will see that the form is closed. Submissions already received are kept. | Quienes tengan el enlace verán que el formulario está cerrado. Las respuestas recibidas se conservan. |
| life.reopen | Reopen form | Reabrir formulario |
| life.reopen_body | The form will accept submissions again at the same link. | El formulario volverá a aceptar respuestas en el mismo enlace. |
| life.archive | Archive form | Archivar formulario |
| life.archive_body | The form closes and moves to Archived. Nothing is deleted. | El formulario se cierra y pasa a Archivados. No se elimina nada. |
| life.unarchive | Unarchive | Desarchivar |
| life.delete | Delete form | Eliminar formulario |
| life.delete_body | This form has never been published and has no submissions. Deleting it cannot be undone. Type the link name to confirm. | Este formulario nunca se publicó y no tiene respuestas. Eliminarlo no se puede deshacer. Escribe el nombre del enlace para confirmar. |
| life.banner_closed | This form is closed. People with the link see a closed message. | Este formulario está cerrado. Quienes tengan el enlace ven un mensaje de cierre. |
| life.banner_archived | This form is archived. | Este formulario está archivado. |
| form.error_transition | That action is no longer available for this form. Reload to see its current status. | Esa acción ya no está disponible para este formulario. Recarga para ver su estado actual. |
| builder.placeholder | The builder is coming soon. Settings and sharing already work. | El constructor llegará pronto. La configuración y el enlace ya funcionan. |
| life.unarchive_body | The form moves back to Closed, or to Draft if it was never published. | El formulario vuelve a Cerrado, o a Borrador si nunca se publicó. |
| form.url_hint | Select the link and copy it. | Selecciona el enlace y cópialo. |
| form.error_slug_mismatch | The link name did not match. Nothing was deleted. | El nombre del enlace no coincide. No se eliminó nada. |
| form.error_not_allowed | This form can no longer be deleted because it was published or has submissions. Archive it instead. | Este formulario ya no se puede eliminar porque se publicó o tiene respuestas. Archívalo en su lugar. |

### Submissions list

| Key | English | Spanish |
|---|---|---|
| sub.status_new | New | Nueva |
| sub.status_viewed | Viewed | Vista |
| sub.status_edited | Edited | Editada |
| sub.status_published | Published | Publicada |
| sub.filter_dates | Dates | Fechas |
| sub.filter_version | Version | Versión |
| sub.filter_media | With files | Con archivos |
| sub.search | Search answers | Buscar en respuestas |
| sub.clear_filters | Clear filters | Quitar filtros |
| sub.col_reference | Reference | Referencia |
| sub.col_received | Received | Recibida |
| sub.col_label | Name | Nombre |
| sub.col_files | Files | Archivos |
| sub.col_version | Version | Versión |
| sub.col_locale | Language | Idioma |
| sub.needs_attention | Needs attention | Necesita atención |
| sub.export | Export | Exportar |
| sub.empty | No submissions yet. Share the form to start receiving them. | Aún no hay respuestas. Comparte el formulario para empezar a recibirlas. |
| sub.empty_filtered | No submissions match these filters. | Ninguna respuesta coincide con estos filtros. |
| sub.count_one | {count} submission | {count} respuesta |
| sub.count_other | {count} submissions | {count} respuestas |
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
| list.version | v{n} | v{n} |
| list.files_one | {n} file | {n} archivo |
| list.files_other | {n} files | {n} archivos |

### Story page

Fixed chrome of the story page, its dialogs, the publishing panel and the
delete confirmation. A placeholder whose value differs by language is never
used, so such rows are split (`pub.unmark_viewed` and `pub.unmark_edited`).

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
| st.files_below_one | {n} file, shown under Photos and videos | {n} archivo, en Fotos y videos |
| st.files_below_other | {n} files, shown under Photos and videos | {n} archivos, en Fotos y videos |
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
| st.changes_one | {n} change | {n} cambio |
| st.changes_other | {n} changes | {n} cambios |
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
| st.photos_added_one | {count} file added | Se agregó {count} archivo |
| st.photos_added_other | {count} files added | Se agregaron {count} archivos |
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
| st.edited_stale | The chosen photos changed after they were edited. Tick again once the new set is edited. | Las fotos elegidas cambiaron después de editarlas. Vuelve a marcar cuando el nuevo conjunto esté editado. |
| st.err_no_photos_chosen | Choose at least one photo first. | Primero elige al menos una foto. |
| st.check_saved | Check saved | Verificación guardada |
| st.choice_saved | Photo choice saved | Elección de fotos guardada |
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
| pub.mark_confirm | Confirm | Confirmar |
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

### Export

| Key | English | Spanish |
|---|---|---|
| ex.title | Export submissions | Exportar respuestas |
| ex.scope_one | {count} submission matching the current filters | {count} respuesta que coincide con los filtros actuales |
| ex.scope_other | {count} submissions matching the current filters | {count} respuestas que coinciden con los filtros actuales |
| ex.versions | Versions | Versiones |
| ex.text | Text answers | Respuestas de texto |
| ex.text_original | Original | Original |
| ex.text_curated | Corrected | Corregida |
| ex.text_both | Both columns | Ambas columnas |
| ex.media_paths | Include file paths | Incluir rutas de archivos |
| ex.notice | This file contains personal data. It is recorded that you exported it. | Este archivo contiene datos personales. Queda registrado que lo exportaste. |
| ex.download | Download CSV | Descargar CSV |
| ex.too_large | More than 10,000 rows. Narrow the filters. | Más de 10,000 filas. Reduce los filtros. |
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

### Settings and share

| Key | English | Spanish |
|---|---|---|
| set.notifications | Notifications | Notificaciones |
| set.recipients | Recipients | Destinatarios |
| set.recipients_hint | Only Effluz addresses | Solo correos de Effluz |
| set.cadence | Send | Enviar |
| set.cadence_each | One email per submission | Un correo por respuesta |
| set.cadence_daily | A daily summary at | Un resumen diario a las |
| set.data | Data | Datos |
| set.retention | Keep submissions for | Conservar respuestas durante |
| set.months | months | meses |
| set.retention_hint | Counted from each submission. Deletion is permanent. | Se cuenta desde cada respuesta. La eliminación es permanente. |
| set.retention_warn | Shortening to {n} months will delete {count} submissions on the next run. | Reducir a {n} meses eliminará {count} respuestas en la próxima ejecución. |
| set.retention_confirm | Delete them and save | Eliminarlas y guardar |
| set.prefix | Reference prefix | Prefijo de referencia |
| set.prefix_hint | Used in reference numbers and folder names. Fixed after the first submission. | Se usa en los números de referencia y nombres de carpeta. Fijo después de la primera respuesta. |
| set.availability | Availability | Disponibilidad |
| set.opens | Opens | Abre |
| set.closes | Closes | Cierra |
| set.timezone | Time zone | Zona horaria |
| set.protection | Protection | Protección |
| set.challenge | Ask people to complete a bot check before submitting | Pedir una verificación anti-bots antes de enviar |
| set.challenge_hint | Harder for some people with disabilities. Turn on only if spam appears. | Más difícil para algunas personas con discapacidad. Actívalo solo si aparece spam. |
| set.challenge_unavailable | Not available yet: forms show no bot check even when this is on. | Aún no está disponible: los formularios no muestran la verificación aunque esté activada. |
| set.responses | Responses | Respuestas |
| set.allow_another | Offer "Fill in another form" after submitting | Ofrecer "Llenar otro formulario" al terminar |
| set.link | Link | Enlace |
| set.save | Save settings | Guardar configuración |
| set.saved | Settings saved | Configuración guardada |
| set.discard_warn | You have unsaved changes. | Tienes cambios sin guardar. |
| set.recipients_lines | One address per line. | Una dirección por línea. |
| set.no_recipients | No one will get an email about new submissions. They still appear here. | Nadie recibirá un correo sobre las nuevas respuestas. Seguirán apareciendo aquí. |
| set.timezone_hint | Used for the open and close times and the daily summary. | Se usa para las horas de apertura y cierre y para el resumen diario. |
| set.err_recipient_domain | {address} is not on an allowed domain. | {address} no es de un dominio permitido. |
| set.err_recipient_syntax | {address} is not an email address. | {address} no es una dirección de correo. |
| set.err_too_many_recipients | Enter at most {max} addresses. | Escribe como máximo {max} direcciones. |
| set.err_prefix_format | Use 2 to 6 capital letters or digits. | Usa de 2 a 6 letras mayúsculas o dígitos. |
| set.err_retention_range | Enter a whole number from {min} to {max}. | Escribe un número entero de {min} a {max}. |
| set.err_date_order | The close time must be after the open time. | La hora de cierre debe ser posterior a la de apertura. |
| set.err_timezone_unknown | Choose a time zone from the list. | Elige una zona horaria de la lista. |
| set.err_hour_range | Choose an hour from the list. | Elige una hora de la lista. |
| set.err_malformed | This value could not be read. Check it and save again. | No se pudo leer este valor. Revísalo y vuelve a guardar. |
| set.err_slug_locked | The link name cannot change after publishing. | El nombre del enlace no se puede cambiar después de publicar. |
| set.err_prefix_locked | The prefix cannot change after the first submission. | El prefijo no se puede cambiar después de la primera respuesta. |
| set.err_slug_taken | That link name is taken. | Ese nombre de enlace ya existe. |
| set.err_slug_format | Use 3 to 64 lowercase letters, numbers and hyphens. | Usa de 3 a 64 minúsculas, números y guiones. |
| set.err_slug_reserved | That link name is reserved. Choose another. | Ese nombre de enlace está reservado. Elige otro. |
| set.err_stale | This page was out of date, so nothing was saved. Reload it and try again. | Esta página estaba desactualizada, así que no se guardó nada. Recárgala e inténtalo otra vez. |
| set.post_plan_section | Post plan | Plan de publicaciones |
| set.post_plan | Use submissions in the post plan | Usar las respuestas en el plan de publicaciones |
| set.post_plan_hint | Adds photo choice, readiness checks and a planned date to each submission, and shows them on the Post plan page. | Agrega elección de fotos, verificaciones y una fecha planificada a cada respuesta, y las muestra en la página Plan de publicaciones. |
| set.post_plan_notice | Adding photos to a story stays off until you publish a version whose consent text covers photos sent later. | Agregar fotos a una historia sigue desactivado hasta que publiques una versión cuyo texto de consentimiento cubra las fotos enviadas después. |
| sh.url | Public link | Enlace público |
| sh.copy | Copy | Copiar |
| sh.copied | Copied | Copiado |
| sh.qr | QR code | Código QR |
| sh.png_small | PNG 1024 px | PNG 1024 px |
| sh.png_large | PNG 2048 px | PNG 2048 px |
| sh.svg | SVG | SVG |
| sh.pdf | Print sheet (PDF) | Hoja para imprimir (PDF) |
| sh.unreachable | The form is not reachable right now: {reason}. The link and QR will work once it is. | El formulario no está disponible ahora: {reason}. El enlace y el QR funcionarán cuando lo esté. |
| sh.stable | The QR code and link stay the same when you publish changes. | El código QR y el enlace no cambian cuando publicas cambios. |
| sh.reason_draft | it has not been published | todavía no se ha publicado |
| sh.reason_closed | it is closed | está cerrado |
| sh.reason_archived | it is archived | está archivado |
| sh.reason_not_open | it is not open yet | todavía no abre |
| sh.reason_past_close | its close date has passed | su fecha de cierre ya pasó |

### Post plan

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
| plan.waiting_count_one | {count} story | {count} historia |
| plan.waiting_count_other | {count} stories | {count} historias |
| plan.picking | Choose a story for {date}. | Elige una historia para el {date}. |
| plan.plan_for | Plan for {date} | Planificar para el {date} |
| plan.no_forms | No form uses the post plan yet. Turn it on in a form's Settings. | Ningún formulario usa el plan de publicaciones todavía. Actívalo en la Configuración de un formulario. |

### Operations and audit

| Key | English | Spanish |
|---|---|---|
| ops.title | Operations | Operaciones |
| ops.heartbeat | Worker last seen | Último latido del worker |
| ops.pending | Pending jobs | Trabajos pendientes |
| ops.dead | Jobs needing attention | Trabajos que necesitan atención |
| ops.oldest | Oldest pending | Pendiente más antiguo |
| ops.backup | Last backup | Última copia de seguridad |
| ops.staging | Staging size | Tamaño del área temporal |
| ops.ok | OK | Bien |
| ops.warning | Warning | Atención |
| ops.critical | Critical | Crítico |
| ops.retry | Retry | Reintentar |
| ops.discard | Discard | Descartar |
| ops.discard_reason | Reason | Motivo |
| ops.retry_all | Retry all {type} jobs ({count}) | Reintentar todos los trabajos {type} ({count}) |
| ops.worker_down | The worker is not running. Jobs will resume when it returns. See the runbook. | El worker no se está ejecutando. Los trabajos continuarán cuando vuelva. Consulta el manual. |
| ops.runbooks | Runbooks | Manuales de operación |
| ops.dead_title | Jobs that stopped retrying | Trabajos que dejaron de reintentarse |
| ops.none_dead | No jobs need attention. | Ningún trabajo necesita atención. |
| ops.col_type | Type | Tipo |
| ops.col_story | Story | Historia |
| ops.col_attempts | Attempts | Intentos |
| ops.col_error | Last error | Último error |
| ops.col_first | First attempt | Primer intento |
| ops.col_last | Last attempt | Último intento |
| ops.seconds_ago_one | {n} second ago | hace {n} segundo |
| ops.seconds_ago_other | {n} seconds ago | hace {n} segundos |
| ops.never | Never | Nunca |
| ops.no_story | No story | Sin historia |
| ops.err_reason | Write why you are discarding it, in at most 200 characters. | Escribe por qué lo descartas, en 200 caracteres como máximo. |
| ops.retried | The job will run again shortly. | El trabajo se ejecutará de nuevo en breve. |
| ops.retried_all_one | {count} job will run again shortly. | {count} trabajo se ejecutará de nuevo en breve. |
| ops.retried_all_other | {count} jobs will run again shortly. | {count} trabajos se ejecutarán de nuevo en breve. |
| ops.discarded | The job was discarded. | El trabajo se descartó. |
| au.title | Audit log | Registro de auditoría |
| au.actor | Who | Quién |
| au.action | Action | Acción |
| au.target | What | Qué |
| au.when | When | Cuándo |
| au.export | Export CSV | Exportar CSV |
| au.retention | Entries are kept for one year. | Las entradas se conservan un año. |
| au.any_actor | Everyone | Todas las personas |
| au.any_action | All actions | Todas las acciones |
| au.apply | Filter | Filtrar |
| au.empty | No activity matches. | Ninguna actividad coincide. |
| au.system | System | Sistema |
| au.target_form | This form | Este formulario |
| au.older | Older entries | Entradas anteriores |
| au.action_form_created | Form created | Formulario creado |
| au.action_draft_saved | Draft saved | Borrador guardado |
| au.action_draft_language_mode_changed | Languages changed | Idiomas cambiados |
| au.action_form_published | Form published | Formulario publicado |
| au.action_form_closed | Form closed | Formulario cerrado |
| au.action_form_reopened | Form reopened | Formulario reabierto |
| au.action_form_archived | Form archived | Formulario archivado |
| au.action_form_unarchived | Form restored from archive | Formulario restaurado del archivo |
| au.action_form_deleted | Form deleted | Formulario eliminado |
| au.action_form_settings_changed | Settings changed | Configuración cambiada |
| au.action_retention_shortened | Retention shortened | Retención acortada |
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

## Test fixtures

Presentation tests cover the forms list in each tab and empty state, the
submissions list in each filter state, the story page in each state (plain,
editing, comparing, viewer, each dialog, each flash and refusal, post-plan on
and off), the Post plan week, each dialog, settings validation, and Operations
in each heartbeat state, in both languages and at the three width tiers. The
e2e suites review, correct, choose, plan, publish, export and delete a
synthetic submission.
