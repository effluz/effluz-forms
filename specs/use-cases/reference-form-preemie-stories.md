# Reference form: Premature baby story intake

The first form the builder must be able to reproduce. Derived on 2026-10-09
from the Google Form "Historia de bebé prematuro - Effluz 2026". It is the
acceptance fixture for the builder, renderer, review and export: an
end-to-end test builds this form through the UI, publishes it, submits it
with synthetic data, and reviews the result.

The form text below is staff content, quoted as structure, not as final
copy. It is Spanish single-language, like the original.

## Operational settings

| Setting | Value |
|---|---|
| Slug | `historia-prematuro-2026` |
| Languages | `es` only |
| Retention | 12 months |
| Close date | 2026-11-09, end of day, Panama time |
| Notification recipients | one Effluz staff group address |
| Bot challenge | off |

## Page 1: Introduction and contact

- Page title: form title. Page description: the welcome text, with two
  `https` links to Effluz's Instagram and Facebook. Requires the restricted
  rich-text subset (paragraphs and links).
- `short_text` Nombre y apellido completo del adulto responsable, required
- `phone` Celular, required
- `email` E-mail, required, marked as submitter address
- `short_text` Tu instagram, required

## Page 2: Permissions

- `single_choice` (radio) authorization to use photos and videos in Effluz
  campaigns, options Sí / No, required. Long label text; the label field
  must accept several sentences.
- `single_choice` (radio) authorization to be contacted, options: Sí por
  celular / Sí por email / Sí por celular o email / No, required

## Page 3: About the baby

- `single_choice` (radio) Tu embarazo fue: Un solo bebé / Gemelar /
  Trillizos / Más de 3 bebés, required
- `short_text` Nombre de la niña o niño, required
- `short_text` ¿Quién fue su pediatra?, required
- `short_text` ¿En qué hospital nació?, required
- `short_text` ¿De cuántas semanas nació tu bebé?, required
- `short_text` ¿Cuánto pesó tu bebé al nacer?, required
- `short_text` Edad y fecha de nacimiento de tu bebé, required

## Page 4: The story

- `long_text` ¿Quiénes te ayudaron durante el proceso?, required
- `long_text` Escribe tu historia (lo más breve posible), required. Help
  text is a bulleted list of what to include plus a link to an example post.
  Requires the restricted rich-text subset in `help`.
- `single_choice` (radio) ¿Cómo llegaste a este formulario?: Instagram /
  Facebook / Por una amiga o amigo / Google o similar, required

## Page 5: Photos and consent

- `file_upload` Sube hasta 10 fotos sin editar del bebé, required, min 1,
  max 10, 10 MB each. Help text explains hospital and current photos and
  what not to send. The original also accepts a short video; see Gaps.
- `section` Información: the campaign explanation and the deadline.
- `consent` Soy mayor de edad y acepto que usen la información y fotos
  enviadas en las redes sociales y página web de Effluz, required. Consent
  text must also state where data is stored (United States) and the
  retention period, which the Google original lacks.

## Confirmation

- Screen: "Gracias por la información." plus a line that no further
  confirmation is needed.
- Email: none. The original says no confirmation is sent. The builder must
  allow a form with an email field and no confirmation email.

## What this form exercises

| Capability | Where |
|---|---|
| Single-language form | settings |
| Multi-page with progress | 5 pages |
| Rich text in page description, help and section | pages 1, 4, 5 |
| Long labels | page 2 |
| `short_text`, `long_text`, `email`, `phone`, `single_choice`, `file_upload`, `section`, `consent` | throughout |
| Submitter address marked, no confirmation email | page 1, confirmation |
| Required file upload with min and max count | page 5 |
| Close date | settings |
| Builder warning at more than 7 fields on a page | page 3 has 7, at the limit |

Field types in the model that this form does not use: `number`, `date`,
`multiple_choice`, `checkbox`, `dropdown` display. Conditional logic is not
used either. They still ship in the first release so the next form does not
need a developer, but this fixture does not test them; the conformance suite
does.

## Gaps against the original

1. **Video upload.** The original accepts a short video in the same upload
   field. `file_upload` is images only in the first release. Decision
   needed: add video kinds with pass-through storage and no metadata
   stripping guarantee, or tell families to send videos another way.
2. **Google account capture.** The original records the submitter's Google
   identity. We do not, by design. The explicit email field replaces it.
3. **Multiple babies.** The original asks for one submission per baby. We
   keep that; no repeating groups in the model.
