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
| Reference prefix | `HP` |
| Languages | `es` only |
| Retention | 12 months |
| Close date | 2026-11-09, end of day, Panama time |
| Notification recipients | one Effluz staff group address |
| Notification cadence | per submission |
| Bot challenge | off |

## Header image

None in the fixture. The original Google Form has none either. A test
variant adds one to exercise the alt text validation.

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
  max 10, 10 MB each, kinds image and video. Help text explains hospital
  and current photos, the optional short video with a message for other
  families, and what not to send.
- `section` Información: the campaign explanation and the deadline.
- `consent`, required. The original text ("Soy mayor de edad y acepto que
  usen la información y fotos enviadas en las redes sociales y página web
  de Effluz") does not meet the checklist in `form-definition.md`. The
  fixture uses this text, which does:

  > Soy mayor de edad y tengo autoridad para compartir la información y las
  > fotos o videos de mi hijo o hija. Autorizo a Effluz a usar lo que envío
  > en este formulario en sus redes sociales, página web y campañas sobre
  > bebés prematuros. Entiendo que Effluz guarda mis respuestas y archivos
  > en servidores en Estados Unidos y en su cuenta de Dropbox durante 12
  > meses, que las personas del equipo de Effluz con acceso a esa cuenta
  > pueden verlos, que Effluz puede revisar la ortografía y gramática de mis
  > textos con un servicio automático de corrección (DeepL) conservando el
  > original, y que puedo pedir que se eliminen antes escribiendo a
  > {privacy contact}.

  English reference translation, for the bilingual template:

  > I am an adult and have the authority to share my child's information,
  > photos and videos. I authorize Effluz to use what I send in this form on
  > its social media, website and premature-baby campaigns. I understand
  > that Effluz keeps my answers and files on servers in the United States
  > and in its Dropbox account for 12 months, that Effluz team members with
  > access to that account can see them, that Effluz may check the spelling
  > and grammar of my texts with an automated correction service (DeepL)
  > while keeping the original, and that I can ask for earlier deletion by
  > writing to {privacy contact}.

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
| Required file upload with min and max count, images and video | page 5 |
| Consent text meeting the checklist | page 5 |
| Close date | settings |
| Builder warning at more than 7 fields on a page | page 3 has 7, at the limit |

Field types in the model that this form does not use: `number`, `date`,
`multiple_choice`, `checkbox`, `dropdown` display. Conditional logic is not
used either. They still ship in the first release so the next form does not
need a developer, but this fixture does not test them; the conformance suite
does.

## Differences from the original

1. **Video upload.** Supported, stored as received with no metadata
   stripping. The renderer shows a fixed notice above the field. The 10 MB
   per-file limit matches the original and allows roughly 20 to 40 seconds
   of phone video.
2. **Google account capture.** The original records the submitter's Google
   identity. We do not, by design. The explicit email field replaces it.
3. **Multiple babies.** The original asks for one submission per baby. We
   keep that; no repeating groups in the model.
