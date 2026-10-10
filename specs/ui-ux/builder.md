# UI/UX: Builder

The staff surface for creating and editing form drafts. Status: first pass,
2026-10-09. Use cases: `use-cases/create-and-edit-form.md`,
`use-cases/publish-form.md`. Model: `form-definition.md`. Renderer contract:
`ui-ux/renderer.md`.

## Principles

1. **The preview is the truth.** What staff see in the preview pane is the
   public renderer rendering the draft. The builder never draws its own
   approximation of a form.
2. **Nothing is lost.** Autosave within seconds, local recovery when offline
   or signed out, presence of other editors visible.
3. **Both languages, always in view.** Every text is edited as a pair.
   Machine suggestions fill gaps but never publish themselves.
4. **Guide, do not police.** Blocking errors are only what the model
   requires. Everything about good form design is a suggestion with a reason.
5. **Every pointer action has a keyboard equivalent**, including reordering.

## Layout and responsiveness

Three regions: **Outline** (pages and fields), **Panel** (the selected
item's settings), **Preview** (live renderer). Plus a header bar.

| Width | Arrangement |
|---|---|
| 1280 px and up | Three columns: Outline 280 px, Panel flexible, Preview 420 px. Preview collapsible to a button. |
| 768 to 1279 px | Two columns: Outline and Panel. Preview opens as a slide-over sheet from the right, or as a split by toggling. |
| Below 768 px | One screen at a time with a bottom tab bar: Outline, Edit, Preview, Issues. Selecting an item in Outline switches to Edit. Panel inputs stack; EN and ES are stacked with a sticky language label. |

Reordering on touch uses a handle with long-press drag, and the same
"Move" menu available to keyboard users. Minimum target size 44 px on all
widths. The header collapses to title, autosave state and an overflow menu
below 768 px.

### Header bar

Form title (click to rename), status badge (`Draft`, `Published v{n}`,
`Closed`, `Archived`), language mode badge, autosave state, presence
avatars, Issues button with count, Preview toggle, Settings link, and the
Publish button. On a published form the Publish button reads "Publish
changes" and is disabled with a tooltip when the draft equals the current
version.

### Autosave state

| State | Text | Behavior |
|---|---|---|
| Saved | Saved | Default |
| Saving | Saving… | Appears only if a save takes longer than 500 ms |
| Offline | Offline, changes kept on this device | Changes queue in local storage and replay on reconnect; conflicts resolve last-save-wins per field |
| Signed out | Session expired, changes kept on this device | Button "Sign in again"; after sign-in the queue replays |
| Conflict | Updated by {name} | Shown on the field that changed under you; your panel refreshes to the saved value |

### Presence

Avatars with initials of other editors on this draft, with a tooltip naming
them. Selecting an item another editor has selected shows their initial on
it in the outline. No locks.

## Outline

A tree of pages and their fields. Each page row: drag handle, page number,
title in the current builder language, field count, issue badge, overflow
menu. Each field row: drag handle, type icon, label (or "Untitled {type}"
in muted text), required mark, visibility icon when a condition exists,
issue badge, overflow menu.

Actions, all in the overflow menu and as keyboard shortcuts:

| Action | Pages | Fields | Keyboard |
|---|---|---|---|
| Add | "Add page" button at the bottom | "Add field" button at the end of each page and on hover between fields | `A` adds after the selection |
| Move up / down | yes | yes, crossing page boundaries | `Alt+Up`, `Alt+Down` |
| Move to page… | no | menu listing pages | `M` |
| Duplicate | yes, with all fields and new keys | yes, new key | `D` |
| Delete | yes, if empty or after confirming field deletion | yes; refused with a list if referenced by a condition | `Delete`, then confirm |
| Rename / edit | opens the panel | opens the panel | `Enter` |

Drag and drop reorders with a visible drop indicator and live announcement
"Moved {label} to position {n} on page {p}". Keyboard moves announce the
same.

### Add field menu

Opens from "Add field". A searchable list grouped by category. Arrow keys
navigate, Enter adds and focuses the new field's label.

| Category | Types |
|---|---|
| Text | Short text, Long text, Email, Phone |
| Choice | Single choice, Multiple choice, Checkbox |
| Number and date | Number, Date |
| Files | File upload |
| Consent and layout | Consent, Section |

Names and one-line descriptions are in Fixed chrome copy.

## Panel

Shows the selected page, field, or the form-level items (Confirmation,
Consent template, Translations, Logic). Sections are stacked and
collapsible; the first is always open.

### Localized text inputs

Every text is a pair of inputs under one label: "EN" and "ES" tags, equal
width, side by side from 768 px, stacked below. On single-language forms
only that language shows. When one side has text and the other is empty
and loses focus, a "Suggest translation" button appears under the empty
side.

**Translation suggestions.** Clicking it calls the Translator port with the
other side's text and the form's audience hint ("public form for families
in Panama"). The result appears in the empty input in a distinct suggested
style with three actions: Accept, Edit, Dismiss. Accept fills the field and
marks it "machine translated, not reviewed" with a small tag that clears
when any editor edits or re-saves the field explicitly with "Mark as
reviewed". Publish validation treats unreviewed machine translations as a
suggestion, not an error. Suggestions are never requested automatically,
never applied automatically, and are cached by source text so repeated
clicks do not re-bill. Failures show "Suggestion unavailable, try later" and
never block typing.

Only staff-authored form text is sent to the service. Submission data never
is; the port is not reachable from `submissions` or `review`.

### Form panel

Selected by clicking the form title in the outline. Title pair, language
mode, and the **header image**: an upload control accepting one image,
showing a preview cropped as the renderer will crop it, alt text pair
(required when an image is set), and Remove. Upload limits and processing
are in `system/media-storage.md`; the builder shows the 300 KB result size
after processing.

### Page panel

Title pair, description pair (markdown), visibility condition (see Logic).

### Field panel, common sections

1. **Question**: label pair, help pair (markdown), required toggle, field
   key in a read-only monospace line with a copy button for support.
2. **Settings**: type-specific, below.
3. **Validation**: rules the type allows, each a toggle revealing its
   parameter inputs. Parameter limits reflect system maximums with the
   maximum shown as placeholder.
4. **Logic**: "Show this field when…" builder.
5. **Advanced**: change type (compatible types only), duplicate, delete.

### Type-specific settings

| Type | Settings |
|---|---|
| Short text | placeholder pair |
| Long text | placeholder pair, rows (2 to 12) |
| Email | "This is the submitter's address" toggle; only one per form, the toggle explains where the other is |
| Phone | none |
| Number | whole numbers only toggle, unit label pair |
| Date | none; validation holds min, max, not in future |
| Single choice | options list (label pair per option, drag or keyboard reorder, add, remove), display: radio or dropdown. Dropdown is offered only above 6 options with a note that the renderer falls back to radio otherwise |
| Multiple choice | options list |
| Checkbox | none |
| Consent | consent text pair (markdown), the checklist, "Insert template" button |
| File upload | kinds: Photos, Videos, Both; max files (1 to 10); max size per file up to the system maximum; a note on the video pass-through notice the renderer adds |
| Section | title pair, description pair (markdown) |

### Markdown inputs

A textarea with a toolbar: Bold, Italic, Bulleted list, Numbered list,
Link, and a Preview toggle that renders the text through the same sanitizer
the renderer uses. Buttons wrap or insert syntax around the selection:
`**bold**`, `_italic_`, lines starting with `- `, lines starting with `1. `,
`[text](https://…)`. Link insertion opens a small dialog for text and URL
and refuses non-`https` URLs. Paste inserts plain text. A one-line hint
under the textarea shows the five constructs. Anything else typed renders
literally; the preview makes that obvious.

### Consent field

Beside the text pair, the nine-item checklist from `form-definition.md`,
each a checkbox labeled with the requirement and a short example. "Insert
template" fills both languages with the bilingual template, pre-ticks the
items the template covers, and places the cursor at the purpose sentence.
The retention item shows the form's current retention setting and warns
when the text mentions a different number. All nine ticked is a publish
requirement.

### Confirmation

Screen text pair (markdown). "Send a confirmation email" toggle, disabled
with an explanation when no field is marked as the submitter's address.
When on: subject pair, body pair (markdown), and a read-only preview of the
fixed footer from `ui-ux/renderer.md`.

## Logic

### On a field or page

"Show this {field|page} when" followed by a chooser `all` / `any` of the
following clauses, each a row: field picker (only fields earlier in the
form, grouped by page, with type icons), operator picker (operators the
registry allows for that field's type), value input (matching the field's
type: text, number, date parts, option picker, or none for is empty / is
not empty). Add clause, remove clause. A one-line plain-language summary
renders under the builder: "Shown when Pregnancy was is Twins or Triplets".
The preview reflects the rule immediately; hidden items show in the preview
with a dashed outline and a "Hidden by logic" tag when the builder's "Show
hidden" toggle is on.

### Logic overview

A form-level panel listing every rule: target, summary, referenced fields,
each linking to its item. Fields referenced by rules show a "used in logic"
line in their panel listing the dependents. Deleting such a field is refused
here and in the outline with the same list.

## Translations view

A form-level table: one row per text (form title, page titles and
descriptions, labels, help, options, consent, confirmation), columns Where,
EN, ES, Status. Inline editing in the EN and ES cells. Status is one of
Complete, Missing, Machine translated. Filters by status. "Suggest all
missing" requests suggestions for every Missing row, shown in suggested
style per row for individual Accept or Dismiss, with a count and a cancel.
A "Mark all reviewed" action exists for a human translator's final pass.

## Preview

Renders the current draft through the public renderer in an isolated frame,
with a toolbar: locale toggle (EN / ES, hidden on single-language forms),
width toggle (Phone 375 / Desktop), "Show hidden" toggle, and page selector
synced to the outline selection. The preview is interactive: staff can fill
fields, trigger validation and navigate pages to feel the flow. Submit shows
"Preview: nothing is sent" instead of submitting. Uploads in preview are
validated client-side and discarded. Selecting a field in the preview
selects it in the outline and panel.

## Issues

The Issues button opens a panel with two groups.

**Errors** block publishing. One row per violation with the message and a
link that selects the offending item. Catalog below.

**Suggestions** never block. Each row has the message, a link, and a "Why"
disclosure with two sentences naming the Law of UX. Initial set:

| Suggestion | Trigger |
|---|---|
| Long page | more than 7 input fields on a page |
| Upload shares a busy page | a file upload field on a page with 4 or more other inputs |
| No help on upload | file upload without help text |
| Many options | a single choice with more than 7 options shown as radio |
| Only one page for many questions | more than 10 inputs on a single-page form |
| Missing description | page 1 without a description |
| Unreviewed machine translations | any text still tagged machine translated |
| Required everything | more than 90% of inputs required on a form with 10 or more |

Counts show as "{errors} errors, {suggestions} suggestions". Inline badges
on outline rows use an error icon or a suggestion icon, with text on hover
and in the accessible name.

## Publish flow

1. Publish opens a dialog. If errors exist, the dialog is the Errors list
   with a close button and nothing else.
2. Otherwise the dialog shows: version number to be created, pages and
   fields count, languages, open suggestions count with a link, and for a
   republish the change summary: added fields, removed fields (each with
   the count of existing answers under that key), changed labels, changed
   logic.
3. A single "Publish version {n}" button, secondary "Cancel". Keyboard focus
   starts on Cancel.
4. On success, the dialog becomes a confirmation with the public URL, copy
   button, "Open form" and "Share and QR" links to the manager's Share
   panel. The header badge updates.
5. On a concurrency failure the dialog explains that someone else published
   and offers "Reload draft".

## New form

From the manager's "New form": a dialog with two choices. **Blank** asks for
title pair (or single title), language mode and slug (prefilled from the
title, editable). **Duplicate** lists the editor's forms with search; the
copy takes the latest draft, all settings except slug, dates and
recipients, and gets a new title "Copy of {title}" and a new slug to
confirm. Both land in the builder with the first page selected.

## Keyboard reference

| Keys | Action |
|---|---|
| `Tab` / `Shift+Tab` | Move through outline, panel, preview toolbar |
| `Up` / `Down` in outline | Select previous / next item |
| `Enter` | Open selected item in the panel |
| `A` | Add field after selection (or page, when a page is selected and `Shift` is held) |
| `Alt+Up` / `Alt+Down` | Move selected item |
| `M` | Move to page… |
| `D` | Duplicate |
| `Delete` | Delete, with confirmation |
| `Ctrl/Cmd+P` | Toggle preview |
| `Ctrl/Cmd+I` | Open Issues |
| `Ctrl/Cmd+Shift+L` | Toggle builder language for outline labels |
| `Esc` | Close dialog or menu, return focus to the opener |

Shortcuts are listed in a "Keyboard shortcuts" dialog reachable from the
header overflow menu and with `?`.

## Laws of UX applied

| Law | Where |
|---|---|
| Hick's Law | Categorized add menu with search; collapsible panel sections; one panel at a time |
| Miller's Law | Suggestions on page length; outline chunked by page |
| Fitts's Law | Add buttons where the pointer already is, between fields; 44 px targets everywhere; primary action at the header's end |
| Jakob's Law | Outline, panel and preview follow the layout of familiar editors; drag handles on the left; Publish top right |
| Law of Proximity, Common Region | Settings grouped in bordered sections; EN and ES paired under one label |
| Doherty Threshold | Autosave with a status only when slow; preview updates under 300 ms; suggestions on demand |
| Peak-End Rule | Publish ends with the URL and share actions, not a bare success toast |
| Zeigarnik Effect | Issues count and translation status keep unfinished work visible |
| Tesler's Law | Keys, sanitizing and version mechanics are handled by the system; staff see only content |
| Postel's Law | Markdown that is not recognized renders literally; pasted formatting is reduced, not rejected |

## Accessibility notes beyond the baseline

- The outline is a tree with `aria-level`, `aria-setsize` and `aria-posinset`,
  and announces moves.
- Drag handles are buttons with the accessible name "Reorder {label}" that
  open the Move menu on activation.
- The preview frame has a title, and focus can be moved into and out of it
  with a visible "Enter preview" and "Leave preview" control.
- Suggested translation text is announced as a suggestion, not read as the
  field's value.
- Markdown toolbar buttons announce the inserted syntax.
- Autosave and presence changes use a polite live region; conflicts use
  assertive.
- All dialogs trap focus and return it to the opener.

## Performance targets

| Measure | Target |
|---|---|
| Draft load, 20 pages, 200 fields | under 1 second to interactive on desktop broadband |
| Autosave round trip | under 300 ms at the 95th percentile |
| Preview refresh after a change | under 300 ms |
| Translation suggestion | under 3 seconds, with a spinner and cancel |

## Fixed chrome copy

The builder is used by staff; its chrome ships in English and Spanish and
follows the signed-in user's choice. Keys below are the complete set the
builder owns; strings staff type are not here.

### Field types

| Key | English | Spanish |
|---|---|---|
| type.short_text | Short text — A single line, like a name | Texto corto — Una sola línea, como un nombre |
| type.long_text | Long text — Several paragraphs, like a story | Texto largo — Varios párrafos, como una historia |
| type.email | Email — Checked for a valid address | Correo — Se verifica que sea una dirección válida |
| type.phone | Phone — Opens the number keypad on phones | Teléfono — Abre el teclado numérico en celulares |
| type.number | Number — Whole or decimal, with an optional unit | Número — Entero o decimal, con unidad opcional |
| type.date | Date — Day, month and year | Fecha — Día, mes y año |
| type.single_choice | Single choice — Pick one option | Opción única — Elegir una opción |
| type.multiple_choice | Multiple choice — Pick one or more | Opción múltiple — Elegir una o más |
| type.checkbox | Checkbox — A single yes or no | Casilla — Un solo sí o no |
| type.consent | Consent — Required agreement with your privacy text | Consentimiento — Aceptación obligatoria de tu texto de privacidad |
| type.file_upload | File upload — Photos, videos or both | Subida de archivos — Fotos, videos o ambos |
| type.section | Section — A heading and text with no question | Sección — Un título y texto sin pregunta |

### Categories, header and outline

| Key | English | Spanish |
|---|---|---|
| cat.text | Text | Texto |
| cat.choice | Choice | Opciones |
| cat.number_date | Number and date | Número y fecha |
| cat.files | Files | Archivos |
| cat.consent_layout | Consent and layout | Consentimiento y diseño |
| header.publish | Publish | Publicar |
| header.publish_changes | Publish changes | Publicar cambios |
| header.no_changes | No changes since version {n} | Sin cambios desde la versión {n} |
| header.issues | Issues | Problemas |
| header.preview | Preview | Vista previa |
| header.settings | Settings | Configuración |
| status.draft | Draft | Borrador |
| status.published | Published v{n} | Publicado v{n} |
| status.closed | Closed | Cerrado |
| status.archived | Archived | Archivado |
| save.saved | Saved | Guardado |
| save.saving | Saving… | Guardando… |
| save.offline | Offline, changes kept on this device | Sin conexión, los cambios se guardan en este dispositivo |
| save.signed_out | Session expired, changes kept on this device | Sesión expirada, los cambios se guardan en este dispositivo |
| save.sign_in_again | Sign in again | Volver a iniciar sesión |
| save.conflict | Updated by {name} | Actualizado por {name} |
| outline.add_page | Add page | Agregar página |
| outline.add_field | Add field | Agregar campo |
| outline.untitled | Untitled {type} | {type} sin título |
| outline.page_n | Page {n} | Página {n} |
| outline.moved | Moved {label} to position {n} on page {p} | {label} movido a la posición {n} en la página {p} |
| menu.move_up | Move up | Subir |
| menu.move_down | Move down | Bajar |
| menu.move_to_page | Move to page… | Mover a la página… |
| menu.duplicate | Duplicate | Duplicar |
| menu.delete | Delete | Eliminar |
| delete.confirm_field | Delete "{label}"? Answers already received are kept. | ¿Eliminar "{label}"? Las respuestas ya recibidas se conservan. |
| delete.confirm_page | Delete page {n} and its {count} fields? | ¿Eliminar la página {n} y sus {count} campos? |
| delete.referenced | Cannot delete: used in logic by {list} | No se puede eliminar: lo usa la lógica de {list} |

### Panel

| Key | English | Spanish |
|---|---|---|
| panel.question | Question | Pregunta |
| panel.settings | Settings | Ajustes |
| panel.validation | Validation | Validación |
| panel.logic | Logic | Lógica |
| panel.advanced | Advanced | Avanzado |
| panel.label | Label | Etiqueta |
| panel.help | Help text | Texto de ayuda |
| panel.required | Required | Obligatorio |
| panel.key | Field key | Clave del campo |
| panel.copy | Copy | Copiar |
| panel.placeholder | Placeholder | Texto de ejemplo |
| panel.rows | Rows | Filas |
| panel.submitter_email | This is the submitter's address | Es el correo de quien responde |
| panel.submitter_email_taken | "{label}" is already the submitter's address | "{label}" ya es el correo de quien responde |
| panel.integer_only | Whole numbers only | Solo números enteros |
| panel.unit | Unit label | Unidad |
| panel.options | Options | Opciones |
| panel.add_option | Add option | Agregar opción |
| panel.display | Display as | Mostrar como |
| panel.display_radio | List | Lista |
| panel.display_dropdown | Dropdown | Desplegable |
| panel.dropdown_note | Dropdown is used only with more than 6 options | El desplegable se usa solo con más de 6 opciones |
| panel.kinds | Accepted files | Archivos permitidos |
| panel.kinds_image | Photos | Fotos |
| panel.kinds_video | Videos | Videos |
| panel.kinds_both | Photos and videos | Fotos y videos |
| panel.max_files | Maximum files | Máximo de archivos |
| panel.max_size | Maximum size per file | Tamaño máximo por archivo |
| panel.video_note | Videos are kept exactly as sent. The form will tell people that hidden details such as location are not removed from videos. | Los videos se guardan tal como se envían. El formulario avisará que no se quitan datos ocultos como la ubicación. |
| panel.header_image | Header image | Imagen de cabecera |
| panel.header_image_hint | Optional. Shown at the top of the first page. Landscape works best. | Opcional. Se muestra arriba de la primera página. Funciona mejor en horizontal. |
| panel.header_alt | Describe the image | Describe la imagen |
| panel.header_alt_hint | Read aloud to people who cannot see it | Se lee en voz alta a quienes no pueden verla |
| panel.header_remove | Remove image | Quitar imagen |
| panel.header_too_large | The image is still over 300 KB after processing. Try a simpler or smaller image. | La imagen sigue pesando más de 300 KB después de procesarla. Prueba una más simple o más pequeña. |
| panel.change_type | Change type | Cambiar tipo |
| panel.change_type_note | Only compatible types are listed. Other changes need a new field. | Solo se muestran tipos compatibles. Otros cambios requieren un campo nuevo. |
| panel.suggest | Suggest translation | Sugerir traducción |
| panel.suggest_accept | Accept | Aceptar |
| panel.suggest_edit | Edit | Editar |
| panel.suggest_dismiss | Dismiss | Descartar |
| panel.suggest_failed | Suggestion unavailable, try later | Sugerencia no disponible, intenta más tarde |
| panel.machine_tag | Machine translated, not reviewed | Traducción automática, sin revisar |
| panel.mark_reviewed | Mark as reviewed | Marcar como revisado |
| md.bold | Bold | Negrita |
| md.italic | Italic | Cursiva |
| md.list | Bulleted list | Lista con viñetas |
| md.numbered | Numbered list | Lista numerada |
| md.link | Link | Enlace |
| md.preview | Preview | Vista previa |
| md.hint | **bold**, _italic_, - bullets, 1. numbers, [link text](https://…) | **negrita**, _cursiva_, - viñetas, 1. números, [texto del enlace](https://…) |
| md.link_text | Link text | Texto del enlace |
| md.link_url | Address (https only) | Dirección (solo https) |
| consent.checklist | Your consent text must cover | Tu texto de consentimiento debe incluir |
| consent.insert_template | Insert template | Insertar plantilla |
| consent.retention_mismatch | This form keeps data for {n} months; the text says something else | Este formulario guarda los datos {n} meses; el texto dice otra cosa |
| consent.item.1 | Who collects the data (Effluz) | Quién recopila los datos (Effluz) |
| consent.item.2 | What is collected | Qué se recopila |
| consent.item.3 | What it is used for | Para qué se usa |
| consent.item.4 | Where it is stored (United States and Dropbox) | Dónde se guarda (Estados Unidos y Dropbox) |
| consent.item.5 | How long it is kept | Cuánto tiempo se guarda |
| consent.item.6 | That Effluz team members with access can see files | Que el equipo de Effluz con acceso puede ver los archivos |
| consent.item.7 | How to request deletion | Cómo pedir que se eliminen |
| consent.item.8 | That the person is an adult with authority over a minor's data | Que la persona es mayor de edad y tiene autoridad sobre los datos del menor |
| consent.item.9 | That texts may be checked by an automated correction service (DeepL), keeping the original | Que los textos pueden revisarse con un servicio automático de corrección (DeepL), conservando el original |
| confirm.screen | Confirmation screen | Pantalla de confirmación |
| confirm.send_email | Send a confirmation email | Enviar correo de confirmación |
| confirm.needs_email_field | Mark an email field as the submitter's address first | Primero marca un campo de correo como el de quien responde |
| confirm.subject | Subject | Asunto |
| confirm.body | Message | Mensaje |
| confirm.footer_preview | Fixed footer added to every confirmation email | Pie fijo que se agrega a todo correo de confirmación |

### Logic

| Key | English | Spanish |
|---|---|---|
| logic.show_when | Show this {item} when | Mostrar este {item} cuando |
| logic.all | all of the following | se cumplan todas |
| logic.any | any of the following | se cumpla alguna |
| logic.add_clause | Add condition | Agregar condición |
| logic.field | Field | Campo |
| logic.operator | Condition | Condición |
| logic.value | Value | Valor |
| logic.summary | Shown when {summary} | Se muestra cuando {summary} |
| logic.always | Always shown | Siempre se muestra |
| logic.used_in | Used in logic by | Lo usa la lógica de |
| logic.overview | Logic overview | Resumen de lógica |
| logic.show_hidden | Show hidden | Mostrar ocultos |
| logic.hidden_tag | Hidden by logic | Oculto por lógica |
| op.equals | is | es |
| op.not_equals | is not | no es |
| op.contains | contains | contiene |
| op.not_contains | does not contain | no contiene |
| op.is_empty | is empty | está vacío |
| op.is_not_empty | is not empty | no está vacío |
| op.greater_than | is greater than | es mayor que |
| op.less_than | is less than | es menor que |
| op.is_one_of | is one of | es una de |

### Translations view

| Key | English | Spanish |
|---|---|---|
| tr.title | Translations | Traducciones |
| tr.where | Where | Dónde |
| tr.status | Status | Estado |
| tr.complete | Complete | Completo |
| tr.missing | Missing | Falta |
| tr.machine | Machine translated | Traducción automática |
| tr.suggest_all | Suggest all missing | Sugerir todas las faltantes |
| tr.suggesting | Suggesting {done} of {total}… | Sugiriendo {done} de {total}… |
| tr.mark_all_reviewed | Mark all as reviewed | Marcar todas como revisadas |

### Preview

| Key | English | Spanish |
|---|---|---|
| pv.title | Preview | Vista previa |
| pv.phone | Phone | Celular |
| pv.desktop | Desktop | Escritorio |
| pv.enter | Enter preview | Entrar a la vista previa |
| pv.leave | Leave preview | Salir de la vista previa |
| pv.nothing_sent | Preview: nothing is sent | Vista previa: no se envía nada |

### Issues and publish validation

| Key | English | Spanish |
|---|---|---|
| issues.title | Issues | Problemas |
| issues.errors | Errors (block publishing) | Errores (impiden publicar) |
| issues.suggestions | Suggestions | Sugerencias |
| issues.count | {errors} errors, {suggestions} suggestions | {errors} errores, {suggestions} sugerencias |
| issues.why | Why | Por qué |
| err.no_input | The form has no questions | El formulario no tiene preguntas |
| err.unlabeled | A field on page {n} has no label | Un campo de la página {n} no tiene etiqueta |
| err.missing_translation | "{label}" is missing its {lang} text | A "{label}" le falta el texto en {lang} |
| err.option_unlabeled | An option in "{label}" has no text | Una opción de "{label}" no tiene texto |
| err.consent_missing | This form collects personal data and needs a Consent field | Este formulario recopila datos personales y necesita un campo de Consentimiento |
| err.consent_checklist | The consent text checklist is not complete | La lista del texto de consentimiento no está completa |
| err.retention_missing | Set how long data is kept, in Settings | Define cuánto tiempo se guardan los datos, en Configuración |
| err.confirmation_missing | Write the confirmation screen text | Escribe el texto de la pantalla de confirmación |
| err.dangling_condition | A condition on "{label}" refers to a field that no longer exists or comes later | Una condición de "{label}" apunta a un campo que ya no existe o viene después |
| err.over_maximum | "{label}" exceeds the limit: {detail} | "{label}" supera el límite: {detail} |
| err.submitter_email_dup | Only one email field can be the submitter's address | Solo un campo de correo puede ser el de quien responde |
| err.header_alt_missing | The header image needs a description in {lang} | La imagen de cabecera necesita una descripción en {lang} |
| sug.long_page | Page {n} has {count} questions. Consider splitting it. | La página {n} tiene {count} preguntas. Considera dividirla. |
| sug.upload_busy | The upload on page {n} shares the page with {count} questions. Give it its own page. | La subida de la página {n} comparte página con {count} preguntas. Dale su propia página. |
| sug.upload_no_help | "{label}" has no help text. Say what photos you expect. | "{label}" no tiene texto de ayuda. Indica qué fotos esperas. |
| sug.many_options | "{label}" has {count} options as a list. A dropdown may be easier. | "{label}" tiene {count} opciones en lista. Un desplegable puede ser más fácil. |
| sug.single_long_page | {count} questions on one page. Consider pages. | {count} preguntas en una sola página. Considera usar páginas. |
| sug.no_description | Page 1 has no description. Tell people what the form is for. | La página 1 no tiene descripción. Explica para qué es el formulario. |
| sug.machine_unreviewed | {count} texts are machine translated and not reviewed | {count} textos tienen traducción automática sin revisar |
| sug.all_required | Almost every question is required. Is that necessary? | Casi todas las preguntas son obligatorias. ¿Es necesario? |
| pub.title | Publish version {n} | Publicar versión {n} |
| pub.summary | {pages} pages, {fields} fields, {languages} | {pages} páginas, {fields} campos, {languages} |
| pub.added | Added: {list} | Agregados: {list} |
| pub.removed | Removed: {list} ({answers} existing answers kept) | Eliminados: {list} ({answers} respuestas existentes se conservan) |
| pub.changed | Changed: {list} | Modificados: {list} |
| pub.confirm | Publish version {n} | Publicar versión {n} |
| pub.cancel | Cancel | Cancelar |
| pub.success | Version {n} is live | La versión {n} está publicada |
| pub.open_form | Open form | Abrir formulario |
| pub.share | Share and QR | Compartir y QR |
| pub.conflict | Someone else published while you were editing. Reload the draft to continue. | Alguien más publicó mientras editabas. Recarga el borrador para continuar. |
| pub.reload | Reload draft | Recargar borrador |

### New form

| Key | English | Spanish |
|---|---|---|
| new.title | New form | Nuevo formulario |
| new.blank | Blank | En blanco |
| new.duplicate | Duplicate an existing form | Duplicar un formulario existente |
| new.form_title | Title | Título |
| new.languages | Languages | Idiomas |
| new.bilingual | English and Spanish | Inglés y español |
| new.only_en | English only | Solo inglés |
| new.only_es | Spanish only | Solo español |
| new.slug | Link name | Nombre del enlace |
| new.slug_hint | Letters, numbers and hyphens. Cannot change after publishing. | Letras, números y guiones. No se puede cambiar después de publicar. |
| new.slug_taken | That link name is taken | Ese nombre de enlace ya existe |
| new.copy_of | Copy of {title} | Copia de {title} |
| new.create | Create | Crear |

## Test fixtures

Presentation tests cover each panel section per field type, the logic
builder per operator, translation suggestion states, autosave states,
every Issues row, and the publish dialog in both languages, at the three
width tiers. The e2e suite builds the reference form from a blank form
using only the keyboard once and only a pointer once.
