# UI/UX: Renderer

The public surface. It turns any valid published version into an accessible,
bilingual, mobile-first form. Status: first pass, 2026-10-09.
Use case: `use-cases/fill-and-submit-form.md`. Model: `form-definition.md`.

## Principles

1. **Works for anyone staff can reach.** The audience is families on phones,
   often on slow connections, sometimes using assistive technology, often
   stressed. Nothing here assumes a desktop, a fast network or a mouse.
2. **Progressive enhancement.** Every page is a real HTML form that submits
   without JavaScript. Scripting adds inline validation, early uploads,
   progress and offline resilience; removing it never blocks completion.
3. **One definition, one look.** Staff cannot change layout, colors or
   components. They choose content. The renderer guarantees the result.
4. **Calm.** No countdowns, no animations beyond focus and progress, no
   marketing. The form is the whole page.

## Layout

- Single column, maximum content width 640 px, 16 px side gutters on
  phones, centered on wider screens. No sidebars.
- Top: a small Effluz wordmark from `design-system/` linking nowhere, the
  language switch on bilingual forms, and the progress indicator on
  multi-page forms.
- Page 1 only: the version's header image, when set, above the title,
  following the header image rules in `specs/design.md`. It loads lazily
  and the title never waits for it.
- Body: page title, page description, fields in order, then the navigation
  row.
- Bottom: the privacy footer, present on every page including confirmation.
- Touch targets at least 44 by 44 px. Inputs are full width. Buttons in the
  navigation row are full width on phones, side by side from 480 px.
- Typography, color, spacing and focus styles come from `design-system/`.
  Minimum body text 16 px to prevent mobile zoom on focus.

## Screens

### Form page (page 1 to N)

- Progress indicator: text "Page {n} of {total}" plus a visually matching
  bar with `role="progressbar"`. Total counts currently visible pages, so it
  can change when conditions change; the text makes that explicit.
- Page title as the document `<h1>` for page 1 with the form title, and
  "{form title}: {page title}" as the browser title on later pages.
- Required legend once per page, above the first field: "Fields marked with
  * are required". The star sits after the label with `aria-hidden`, and the
  input carries `required` and `aria-required`.
- Navigation row: "Back" (not on page 1), then "Next", or "Submit" on the
  last visible page. Submit is visually primary; Next is primary; Back is
  secondary. Enter in a single-line field triggers Next, never Submit, unless
  the page is the last one.
- Bot challenge widget, when enabled, sits above Submit on the last page
  with a text explanation and a visible fallback link to the accessibility
  challenge the provider offers.

### Confirmation

- `<h1>` from the version's confirmation screen text, rendered through the
  rich-text sanitizer.
- Reference line: "Your reference: {ref}" in a copyable monospace block.
- Fixed line: "You can close this page." When the form's "allow another
  response" setting is on, as the reference form needs for families with
  more than one baby, a "Fill in another form" link returns to page 1.
- Back button in the browser returns to the confirmation, not to the form.

### Closed, not yet open, not found

Each is one heading, one sentence, the privacy footer, no form content. Copy
below. Not found returns HTTP 404; closed and not yet open return 200 with
`noindex`.

### Session expired

Heading, explanation, one button "Start again" leading to page 1 of the same
form. Answers already stored server-side for the expired record are
unrecoverable by design.

### Error

A generic failure page for unexpected server errors, HTTP 500, with the
copy below and a "Try again" link that returns to the current page. Answers
on previous pages are preserved because they were already stored.

## Field rendering

Every field renders as: label (`<label for>`), optional help text linked by
`aria-describedby`, the control, and an error slot linked by
`aria-describedby` and `aria-invalid` when populated. Help renders before
the control so screen readers hear it before entering.

| Type | Control | Notes |
|---|---|---|
| `short_text` | `<input type="text">` | `autocomplete` inferred from the label where safe: name, organization. Otherwise off. |
| `long_text` | `<textarea>` with `rows` from settings, auto-growing with script | Character counter appears only when a max length is set, as "{n} of {max}", announced politely at 90%. |
| `email` | `<input type="email" inputmode="email" autocomplete="email">` | Trimmed and lowercased on the server. |
| `phone` | `<input type="tel" inputmode="tel" autocomplete="tel">` | No formatting enforced beyond length rules. |
| `number` | `<input type="text" inputmode="decimal">` or `numeric` for integers | Not `type="number"`, which has poor accessibility and scroll bugs. Unit label shown after the input. |
| `date` | Three inputs: day, month, year, in the locale's order, grouped in a `<fieldset>` with the label as `<legend>` | Native date pickers are inconsistent on phones and inaccessible in places. |
| `single_choice` radio | `<fieldset>` with `<legend>`, one `<input type="radio">` per option, each with a full-width tappable label | Vertical list always. |
| `single_choice` dropdown | `<select>` with a placeholder option "Choose one" | Used only when staff chose dropdown and there are more than 6 options; otherwise the renderer falls back to radio. |
| `multiple_choice` | `<fieldset>`, `<input type="checkbox">` per option | Min and max selected shown in help automatically. |
| `checkbox` | Single checkbox with its label | |
| `consent` | A bordered block containing the consent text, then a checkbox labeled "I have read and agree" | The text is the `<legend>`. Cannot be pre-checked. |
| `file_upload` | See File upload | |
| `section` | `<h2>` title and sanitized description, no control | Not counted in progress or field counts. |

## File upload

Without script: a native `<input type="file" multiple accept="...">`. Files
are sent with the page's form post and validated server-side; the page
re-renders with results.

With script, the same input is enhanced:

- Choosing files starts an upload per file immediately. Each file shows a
  row: thumbnail for images or a film icon for video, file name truncated in
  the middle, size, a progress bar with "Uploading {percent}%", then
  "Uploaded" or an error with "Retry" and "Remove".
- A count line "{count} of {max} files" updates and is announced.
- The accepted kinds and limits render as fixed help under the staff help:
  "Photos up to {size} each." or "Photos and videos up to {size} each."
- When video is accepted, a fixed notice precedes the input: "Videos are
  stored exactly as sent. Unlike photos, we cannot remove hidden details
  such as location from them."
- Drag and drop onto the field is accepted but never required or advertised.
- Uploads continue while the submitter fills other fields on the page. Next
  is disabled with an explanation while an upload on this page is in flight.
- Removing a file deletes it from staging immediately.
- Files uploaded early belong to the in-progress record and expire with it.

## Validation and errors

- **When.** On blur after the field was first interacted with, then on every
  change once the field has an error, and for the whole page on Next or
  Submit. Never on first focus or while typing in a clean field.
- **Where.** Below the control, in the error slot, in red with an icon and
  the message. The field's border changes too; color is never the only cue.
- **Page errors.** If Next or Submit finds errors, an error summary renders
  above the first field: heading "Please fix {count} problems before
  continuing", followed by a list of messages linking to each field. Focus
  moves to the summary heading. Live region `role="alert"`.
- **Message construction.** Messages are built by the renderer from the rule
  and the field label; staff never write them. Catalog below. `{label}` is
  the field label in the current locale; sentence case is preserved from the
  label.
- **Server round trip.** Without script, the server renders the same summary
  and messages. The markup is identical so tests cover both paths at once.

### Message catalog

| Rule | English | Spanish |
|---|---|---|
| required | {label} is required | {label} es obligatorio |
| min length | {label} must have at least {n} characters | {label} debe tener al menos {n} caracteres |
| max length | {label} must have no more than {n} characters | {label} no debe tener más de {n} caracteres |
| pattern | {label} is not in the expected format | {label} no tiene el formato esperado |
| email syntax | Enter a valid email address, like name@example.com | Escribe un correo válido, como nombre@ejemplo.com |
| number min | {label} must be at least {n} | {label} debe ser al menos {n} |
| number max | {label} must be no more than {n} | {label} no debe ser más de {n} |
| integer | {label} must be a whole number | {label} debe ser un número entero |
| not a number | {label} must be a number | {label} debe ser un número |
| date invalid | Enter a real date for {label} | Escribe una fecha real para {label} |
| date min | {label} must be on or after {date} | {label} debe ser el {date} o después |
| date max | {label} must be on or before {date} | {label} debe ser el {date} o antes |
| date not future | {label} cannot be in the future | {label} no puede ser una fecha futura |
| choice min | Select at least {n} options for {label} | Selecciona al menos {n} opciones en {label} |
| choice max | Select no more than {n} options for {label} | Selecciona como máximo {n} opciones en {label} |
| must be true | You must check {label} to continue | Debes marcar {label} para continuar |
| consent | You must agree to continue | Debes aceptar para continuar |
| files min | Upload at least {n} files for {label} | Sube al menos {n} archivos en {label} |
| files max | You can upload up to {n} files for {label} | Puedes subir hasta {n} archivos en {label} |
| invalid shape | {label} has an unexpected value. Please try again | {label} tiene un valor inesperado. Inténtalo de nuevo |
| unknown option | Choose one of the listed options for {label} | Elige una de las opciones de {label} |
| file too large | {file} is larger than {size} | {file} pesa más de {size} |
| file wrong type | {file} is not a supported type. Use {kinds} | {file} no es un tipo permitido. Usa {kinds} |
| file unreadable | {file} could not be read. Try another file | No se pudo leer {file}. Prueba con otro archivo |
| upload failed | {file} did not upload. Check your connection and retry | {file} no se subió. Revisa tu conexión y reintenta |

Pluralization follows each language's rules; `{n}` of 1 uses the singular
form, handled by the copy layer, not by concatenation.

## Navigation and state

- Back is always safe: it stores the current page's valid answers without
  validating required fields, so a submitter can go back to fix something.
- Answers persist across Back and Next and across a browser refresh, because
  every Next stores server-side. Only the current page's unsent edits can be
  lost; with script, they are also kept in session storage and restored.
- Changing an earlier answer that controls visibility re-evaluates on Next.
  If a later page the submitter already filled becomes hidden, nothing is
  shown about it; its answers are discarded at submit.
- The language switch keeps the submitter on the same page with answers
  intact. Locale is stored on the in-progress record.
- Submit disables the button, changes its text to "Submitting…", and shows a
  spinner respecting reduced motion. A second click does nothing. If the
  network fails, the button re-enables with the submit error message.
- Offline with script: a banner "You seem to be offline" appears; Next and
  Submit wait and retry when the connection returns.

## Laws of UX applied

| Law | Where |
|---|---|
| Hick's Law, Miller's Law | One page at a time; the builder warns at 7 inputs per page and blocks at 15; dropdown only above 6 options |
| Fitts's Law | Full-width inputs, 44 px targets, radio and checkbox labels tappable across their whole row, primary button where the thumb rests |
| Jakob's Law | Native controls, label above input, star for required, errors below fields, Back and Next where every form puts them |
| Law of Proximity, Common Region | Label, help, control and error form one visual group with consistent spacing; `section` and `consent` use bordered regions; pages group related questions |
| Doherty Threshold | Inline validation on blur, upload progress per file, Next never waits for uploads already complete, server responses targeted under 400 ms |
| Peak-End Rule | Uploads before consent so the last step is light; a confirmation that says what happens next and gives a reference; no dead end |
| Zeigarnik Effect | Progress indicator with explicit count; early uploads visibly complete |
| Postel's Law | Trim and normalize input, accept phone numbers in any format, accept dates with or without leading zeros |
| Aesthetic-Usability Effect | Design-system typography and spacing; nothing the staff can break |

## Accessibility notes beyond the baseline

- Skip link "Skip to form" as the first focusable element.
- Focus order follows reading order. After Next, focus lands on the new
  page's `<h1>`; after an error, on the error summary; after Back, on the
  `<h1>`.
- Every status change is announced: upload progress milestones, uploaded,
  removed, page changed, submitting, offline. Progress uses `aria-live=
  "polite"`, errors `assertive`.
- Radio and checkbox groups are navigable with arrow keys as native controls
  provide; no custom widgets replace them.
- Date inputs accept keyboard entry only; no picker widget to trap focus.
- Target contrast is AA for text and 3:1 for input borders and focus rings.
- Zoom to 400% keeps a single column with no horizontal scroll.
- Time limits: the 24-hour in-progress window is the only one and is
  disclosed on the session-expired screen. No inactivity timers.
- Tested with at least one screen reader on phone and one on desktop before
  the first production deploy, recorded in the PR.

## Performance targets

| Measure | Target |
|---|---|
| HTML for a page, compressed | under 30 KB |
| Script for enhancement, compressed | under 50 KB, loaded `defer` |
| First page interactive on a throttled 3G profile | under 3 seconds |
| Server render of a page | under 200 ms at the 95th percentile |
| Images in the page | the wordmark as SVG, and on page 1 the optional header image at most 300 KB |

Fonts come from `design-system/` and are self-hosted with `font-display:
swap`. No third-party scripts except the bot challenge when enabled.

## Fixed chrome copy

The only strings the renderer owns. Everything else is staff-authored.

| Key | English | Spanish |
|---|---|---|
| skip_link | Skip to form | Ir al formulario |
| language_switch_label | Language | Idioma |
| progress | Page {n} of {total} | Página {n} de {total} |
| required_legend | Fields marked with * are required | Los campos marcados con * son obligatorios |
| back | Back | Atrás |
| next | Next | Siguiente |
| submit | Submit | Enviar |
| submitting | Submitting… | Enviando… |
| choose_one | Choose one | Elige una opción |
| choose_files | Choose files | Elegir archivos |
| files_count | {count} of {max} files | {count} de {max} archivos |
| files_limits_images | Photos up to {size} each. | Fotos de hasta {size} cada una. |
| files_limits_mixed | Photos and videos up to {size} each. | Fotos y videos de hasta {size} cada uno. |
| video_notice | Videos are stored exactly as sent. Unlike photos, we cannot remove hidden details such as location from them. | Los videos se guardan tal como se envían. A diferencia de las fotos, no podemos quitarles datos ocultos como la ubicación. |
| uploading | Uploading {percent}% | Subiendo {percent}% |
| uploaded | Uploaded | Subido |
| remove | Remove | Quitar |
| retry | Retry | Reintentar |
| uploads_pending | Wait for uploads to finish before continuing | Espera a que terminen las subidas para continuar |
| error_summary_heading | Please fix {count} problems before continuing | Corrige {count} problemas para continuar |
| consent_checkbox | I have read and agree | He leído y acepto |
| char_count | {n} of {max} characters | {n} de {max} caracteres |
| confirmation_reference | Your reference: {ref} | Tu referencia: {ref} |
| confirmation_close | You can close this page. | Puedes cerrar esta página. |
| fill_another | Fill in another form | Llenar otro formulario |
| closed_title | This form is closed | Este formulario está cerrado |
| closed_body | It no longer accepts responses. Thank you for your interest. | Ya no acepta respuestas. Gracias por tu interés. |
| not_open_title | This form is not open yet | Este formulario aún no está abierto |
| not_open_body | It opens on {date}. | Abre el {date}. |
| not_found_title | We could not find this form | No encontramos este formulario |
| not_found_body | Check the link, or ask the person who shared it with you. | Revisa el enlace o pregunta a quien te lo compartió. |
| expired_title | Your session expired | Tu sesión expiró |
| expired_body | For your privacy, unfinished answers are kept for 24 hours only. Please start again. | Por tu privacidad, las respuestas sin terminar se guardan solo 24 horas. Por favor, empieza de nuevo. |
| start_again | Start again | Empezar de nuevo |
| error_title | Something went wrong | Algo salió mal |
| error_body | Your answers on this page were not saved. Please try again. | Las respuestas de esta página no se guardaron. Inténtalo de nuevo. |
| try_again | Try again | Intentar de nuevo |
| submit_failed | Your answers were not sent. Check your connection and try again. | Tus respuestas no se enviaron. Revisa tu conexión e inténtalo de nuevo. |
| offline | You seem to be offline. We will continue when you reconnect. | Parece que no tienes conexión. Continuaremos cuando vuelvas a conectarte. |
| privacy_footer | This form is run by Effluz. Answers are stored in the United States and deleted after {retention} months. To request deletion, write to {contact}. | Este formulario es de Effluz. Las respuestas se guardan en Estados Unidos y se eliminan después de {retention} meses. Para pedir que se eliminen, escribe a {contact}. |

`{contact}` is the configured privacy contact address. `{size}` and `{date}`
are formatted per locale.

## Confirmation email, fixed parts

The staff-authored subject and body come from the version. The renderer's
template wraps the body with:

| Part | English | Spanish |
|---|---|---|
| Preheader | Your response to {form title} was received | Recibimos tu respuesta a {form title} |
| Footer line 1 | You received this email because you submitted "{form title}" on {date}. Reference {ref}. | Recibes este correo porque enviaste "{form title}" el {date}. Referencia {ref}. |
| Footer line 2 | Effluz stores your answers in the United States for {retention} months. To ask for earlier deletion, reply to this email or write to {contact}. | Effluz guarda tus respuestas en Estados Unidos durante {retention} meses. Para pedir que se eliminen antes, responde a este correo o escribe a {contact}. |

Plain-text and HTML versions carry the same words. No images, no tracking.

## Test fixtures

The renderer's presentation tests cover each field type in each state and
each screen above, in both locales. The e2e suite completes the reference
form on a phone viewport with script enabled and once with script disabled.
