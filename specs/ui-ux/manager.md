# UI/UX: Manager

The staff surface for running forms and working with submissions. Status:
first pass, 2026-10-09. Use cases: `sign-in.md`, `publish-form.md`,
`manage-form-settings.md`, `review-submissions.md`, `curate-submission.md`,
`operate-jobs.md`. The builder is its own surface, `ui-ux/builder.md`,
reached from here.

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

A top bar with the Effluz wordmark, primary navigation (Forms, Operations,
Audit), the signed-in user's name with a menu (language EN/ES, keyboard
shortcuts, sign out). Below 768 px the navigation collapses into a menu
button. Every page has an `<h1>` and a breadcrumb from Forms downward.

Responsive tiers match the builder: three-column layouts from 1280 px,
two from 768, single column with full-screen panels below.

## Forms list (home)

- Tabs: **Active** (draft and published), **Closed**, **Archived**. Counts
  in each tab.
- Table columns: title, status badge with version, new submissions since
  this user last opened the form (bold when above zero), total submissions,
  last submission time, close date if set, actions menu.
- Sorted by last submission time, then title. Search by title or slug.
- Row click opens the form overview. Actions menu: Open, Edit in builder,
  Share, Settings, and the lifecycle actions allowed for its status. Each
  lifecycle action opens its confirmation on the form overview; Delete is
  offered there only. Without JavaScript the menu is a disclosure of links,
  named after its form, reached with Tab.
- Search is a plain GET form that keeps the current tab. Tab counts do not
  depend on the search. A tab or search with no forms says
  `home.none_here`; `home.empty` is only for an installation with no forms
  at all.
- Dates show in the default time zone (`America/Panama`) as
  `YYYY-MM-DD HH:mm`, with the UTC time as the element's title.
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
- Submissions is the only tab without a page of its own: the overview shows
  `form.submissions_soon` until review exists, and the tab is shown, not
  linked, from the other tabs.
- Edit in builder leads to a placeholder page with the form's title,
  `builder.placeholder`, and links to Settings and Share.

## Submissions tab

### List

- Filter bar: status chips (New, Viewed, Edited, Published, with counts),
  date range, version, has media, search box. Filters persist in the URL so
  a filtered view is shareable among staff.
- Table columns: reference, status, received, label (first short text
  answer), media count with a camera or film icon, version, locale, dead
  job flag. Row click opens the drawer.
- Keyboard: Up and Down move the focused row, Enter opens, `J` and `K` move
  between submissions while the drawer is open.
- Pagination of 50 with a total count. Export button opens the export
  dialog scoped to the current filters.
- Empty states: no submissions yet (with the public URL and Share link), or
  no submissions match the filters (with a clear-filters action).

### Submission drawer

Opens from the right at 720 px wide on desktop, full screen below 1024 px.
Focus moves to its heading; Esc closes and returns focus to the row.

Header: reference, status badge, received time, version, locale, a
Previous and Next pair that follows the filtered list, and an actions menu:
Mark as published or Unmark, Download all, Export this one, Delete.

Body, in the version's page and field order, grouped under page titles:

- Each answer with its label, through the field type's review display.
- Text answers that have a curated version show the curated text, an
  "Edited" tag, and Compare and Revert actions. Unedited text answers show
  an Edit action. Other types have no actions.
- Media as a grid of thumbnails; click opens a lightbox with full-size
  photo or inline video player, previous and next inside the submission,
  a Download action and the file's path in Dropbox. Each open and download
  is audited and the lightbox footer says "Views are recorded".
- Consent: the accepted text, its version and time, collapsed by default.
- Jobs: a compact list of this submission's jobs with status and a retry
  action for dead ones.
- Activity: the audit entries for this submission, newest first.

### Edit a text answer

Replaces the answer block in the drawer with a two-column editor,
Original left and Curated right, as `curate-submission.md` specifies.
Buttons: Suggest correction, Save, Cancel. After a suggestion, differences
from the original are highlighted inline in the Curated column, insertions
and deletions distinguishable by shape and color, and a count "{n} changes"
is announced. Save returns to the answer block with the Edited tag.

Compare opens the same two columns read-only with highlights, and offers
Edit and Revert. Revert confirms in one sentence.

### Mark as published

A small dialog with an optional "Link to the post" field accepting only
`https` URLs, and Confirm. The badge updates in the drawer and list. Unmark
asks for confirmation and explains which status it returns to.

### Export dialog

Scope line: "{count} submissions matching the current filters". Options:
version (current filter or all), text answers (Original, Curated, Both
columns), include media paths. A notice: "This file contains personal data.
It is recorded that you exported it." Button: Download CSV. Exports above
10,000 rows are refused with a request to narrow the filters.

### Delete

Confirmation dialog states the reference, that files in Dropbox will also
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
| Link | slug, editable only before first publish |

Each field has a help line. Save confirms in a toast and writes the audit
entry.

## Share tab

Public URL in a read-only, selectable field. Its Copy button needs script
and waits for the manager's first client component (`sh.copy` and
`sh.copied` are bound for it). QR code preview with download as PNG
(1024 px and 2048 px) and SVG; the preview and the downloads encode exactly
the public URL, and the files are named `<slug>-qr-<size>.png` and
`<slug>-qr.svg`. A print-ready PDF with the form title and URL under the
code is planned and has no link until it exists. A warning when the form is
not currently reachable: closed, archived, or outside its date window, with
the reason in words (`sh.reason_*`). The link and QR stay available
meanwhile. Short guidance: "The QR code and link stay the same when you
publish changes."

## Activity tab

The audit log filtered to this form, newest first: time (shown in UTC, as
`YYYY-MM-DD HH:mm UTC`), actor, action (plain words, `au.action_*`), and
target. Every entry of this tab concerns the form itself, so the target is a
link to the overview, followed by the entry's details when it has any. An
action written by another module is shown as stored. Filter by actor and
action with a plain GET form, so a filtered view is a shareable link. A page
holds 50 entries; when it is full, "Older entries" continues from the oldest
one shown. Export as CSV comes with the audit page and has no control here
until then.

## Operations page

Cards at the top: worker heartbeat age, pending jobs, dead jobs, oldest
pending job age, last successful backup, staging directory size. Each card
is green, amber or red with a text status, never color alone.

Below, the jobs table from `operate-jobs.md`: dead first, then failed
awaiting retry, with type, form, reference, attempts, last error, times.
Row actions: Retry, Discard with reason. Bulk "Retry all of type" when more
than one dead job shares a type. A link to the runbooks in the repository.

## Audit page

The global audit log with filters by actor, action, form and date, and CSV
export. Rows link to the form or submission where it still exists. A note
explains that entries are kept for one year.

## States

- **Loading**: skeleton rows, never a spinner on a blank page.
- **Errors**: inline, with Retry; the shell stays usable.
- **Closed or archived form**: a banner in the overview explaining what
  the public sees and how to reopen.
- **Submission deleted while open**: the drawer shows "This submission was
  deleted by {name}" and a close action.
- **Offline**: a banner; read-only actions still show cached data where the
  browser has it; mutations are disabled.

## Laws of UX applied

| Law | Where |
|---|---|
| Hick's Law | Three tabs on home; one actions menu per row; status chips instead of a dropdown |
| Jakob's Law | Table, filter bar, drawer and lightbox patterns from common admin tools |
| Fitts's Law | Row-wide click targets; Previous and Next at a fixed position in the drawer; primary action top right |
| Law of Proximity, Common Region | Answers grouped under page headings; settings in bordered sections; cards on Operations |
| Doherty Threshold | Drawer opens from cached list data instantly, then fills; thumbnails lazy-load; filters apply without a page reload |
| Peak-End Rule | Publishing a submission ends with the post link saved and visible in the list |
| Zeigarnik Effect | New counts on home and status chips keep unfinished review visible |
| Von Restorff Effect | Edited tags and dead-job flags are the only highlighted elements in a row |
| Tesler's Law | Export, ZIP naming and Dropbox paths follow fixed schemes; staff never name files |

## Accessibility notes beyond the baseline

- Tables use proper headers; sortable columns announce sort state.
- The drawer is a dialog with a labelled heading, focus trap and Esc.
- The lightbox announces "Photo {n} of {total}" and video controls are the
  native ones.
- Compare highlights use underline and strike styles in addition to color,
  and each change is reachable with Tab.
- Status badges carry text, never icon-only.
- Charts do not exist; Operations uses numbers and words.

## Performance targets

| Measure | Target |
|---|---|
| Forms list | under 500 ms server render with 100 forms |
| Submissions list page | under 500 ms with 10,000 submissions in the form |
| Drawer open | under 300 ms to text content; thumbnails stream after |
| Export of 10,000 rows | starts streaming within 2 seconds |

## Fixed chrome copy

The complete set the manager owns, in addition to strings shared with the
builder (status names, New form dialog).

### Shell and home

| Key | English | Spanish |
|---|---|---|
| nav.forms | Forms | Formularios |
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
| shell.wordmark | Effluz | Effluz |
| shell.signed_in_as | Signed in as {name} | Sesión iniciada como {name} |
| shell.skip_to_main | Skip to main content | Saltar al contenido principal |
| shell.main_nav | Main navigation | Navegación principal |
| shell.breadcrumb | Breadcrumb | Ruta de navegación |
| shell.cancel | Cancel | Cancelar |

`shell.main_nav` and `shell.breadcrumb` name the two navigation landmarks
for assistive technology. `shell.cancel` is the cancel link of every
confirmation dialog.

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
| form.submissions_soon | Submission review is coming soon. Received so far: {count}. | La revisión de respuestas llegará pronto. Recibidas hasta ahora: {count}. |

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
| sub.count | {count} submissions | {count} respuestas |

### Drawer

| Key | English | Spanish |
|---|---|---|
| dr.previous | Previous | Anterior |
| dr.next | Next | Siguiente |
| dr.mark_published | Mark as published | Marcar como publicada |
| dr.unmark_published | Unmark as published | Quitar marca de publicada |
| dr.download_all | Download all files | Descargar todos los archivos |
| dr.export_one | Export this submission | Exportar esta respuesta |
| dr.delete | Delete submission | Eliminar respuesta |
| dr.edited_tag | Edited | Editada |
| dr.edit | Edit | Editar |
| dr.compare | Compare | Comparar |
| dr.revert | Revert to original | Volver al original |
| dr.revert_confirm | Remove the edited version of "{label}" and show the original again? | ¿Quitar la versión editada de "{label}" y volver a mostrar el original? |
| dr.original | Original | Original |
| dr.curated | Curated | Editada |
| dr.suggest | Suggest correction | Sugerir corrección |
| dr.suggest_none | No changes suggested | Sin cambios sugeridos |
| dr.suggest_failed | Suggestion unavailable, try later | Sugerencia no disponible, intenta más tarde |
| dr.changes | {n} changes | {n} cambios |
| dr.save | Save | Guardar |
| dr.cancel | Cancel | Cancelar |
| dr.saved_by_other | {name} saved a newer version of this answer. | {name} guardó una versión más reciente de esta respuesta. |
| dr.consent | Consent | Consentimiento |
| dr.consent_accepted | Accepted {date}, text version {n} | Aceptado el {date}, versión del texto {n} |
| dr.jobs | Background jobs | Trabajos en segundo plano |
| dr.activity | Activity | Actividad |
| dr.views_recorded | Views are recorded | Las vistas quedan registradas |
| dr.photo_n | Photo {n} of {total} | Foto {n} de {total} |
| dr.video_n | Video {n} of {total} | Video {n} de {total} |
| dr.download | Download | Descargar |
| dr.in_dropbox | In Dropbox: {path} | En Dropbox: {path} |
| dr.deleted_by | This submission was deleted by {name}. | {name} eliminó esta respuesta. |
| pub.post_url | Link to the post (optional) | Enlace a la publicación (opcional) |
| pub.unmark_body | The status will return to {status}. | El estado volverá a {status}. |
| del.body | Submission {ref} and its files in Dropbox will be deleted. This cannot be undone. Type the reference to confirm. | La respuesta {ref} y sus archivos en Dropbox se eliminarán. No se puede deshacer. Escribe la referencia para confirmar. |

### Export

| Key | English | Spanish |
|---|---|---|
| ex.title | Export submissions | Exportar respuestas |
| ex.scope | {count} submissions matching the current filters | {count} respuestas que coinciden con los filtros actuales |
| ex.versions | Versions | Versiones |
| ex.text | Text answers | Respuestas de texto |
| ex.text_original | Original | Original |
| ex.text_curated | Curated | Editada |
| ex.text_both | Both columns | Ambas columnas |
| ex.media_paths | Include file paths | Incluir rutas de archivos |
| ex.notice | This file contains personal data. It is recorded that you exported it. | Este archivo contiene datos personales. Queda registrado que lo exportaste. |
| ex.download | Download CSV | Descargar CSV |
| ex.too_large | More than 10,000 rows. Narrow the filters. | Más de 10,000 filas. Reduce los filtros. |

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
| set.prefix | Reference prefix | Prefijo de referencia |
| set.prefix_hint | Used in reference numbers and folder names. Fixed after the first submission. | Se usa en los números de referencia y nombres de carpeta. Fijo después de la primera respuesta. |
| set.availability | Availability | Disponibilidad |
| set.opens | Opens | Abre |
| set.closes | Closes | Cierra |
| set.timezone | Time zone | Zona horaria |
| set.protection | Protection | Protección |
| set.challenge | Ask people to complete a bot check before submitting | Pedir una verificación anti-bots antes de enviar |
| set.challenge_hint | Harder for some people with disabilities. Turn on only if spam appears. | Más difícil para algunas personas con discapacidad. Actívalo solo si aparece spam. |
| set.responses | Responses | Respuestas |
| set.allow_another | Offer "Fill in another form" after submitting | Ofrecer "Llenar otro formulario" al terminar |
| set.link | Link | Enlace |
| set.save | Save settings | Guardar configuración |
| set.saved | Settings saved | Configuración guardada |
| set.discard_warn | You have unsaved changes. | Tienes cambios sin guardar. |
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

## Test fixtures

Presentation tests cover the forms list in each tab and empty state, the
drawer for a submission of the reference form including edited, compared
and reverted text, the lightbox for photo and video, each dialog, settings
validation, and Operations in each card state, in both languages and at the
three width tiers. The e2e suite reviews, edits with a stubbed correction
service, publishes, exports and deletes a synthetic submission.
