# Form Definition Model

The single contract every surface consumes: builder, renderer, validator,
storage, export, review. Status: first pass, 2026-10-09.
Decision record: `decisions/0009-form-builder-versioned-definitions.md`.

## Concepts

| Concept | Meaning |
|---|---|
| **Form** | A named thing staff manage. Has a slug, a lifecycle status, operational settings, and versions. |
| **Version** | An immutable snapshot of everything a submitter sees: pages, fields, logic, consent text, confirmation copy, languages. Created on publish. |
| **Draft** | The one mutable working copy of a form. Publishing turns it into the next version and starts a fresh draft from it. |
| **Submission** | One completed response. Pins the version it answered. |
| **Field type** | A registered capability: how a kind of question is edited, rendered, validated, stored, exported and reviewed. |

**Operational settings** live on the form and change without a new version:
notification recipients, retention period, open and close dates, bot
challenge on or off, allow another response on or off. **Anything the submitter sees** lives in the version.

## Text and languages

Every human-readable string in a version is a `LocalizedText`:
`{ en: string, es: string }`. A form is either bilingual (both required on
publish) or marked single-language, in which case the other value is absent
and the renderer offers only one language. Submissions record the locale the
submitter used.

Staff-authored text is plain text and is escaped on every render. Four
places may use a restricted rich-text subset (paragraphs, line breaks, bold,
italic, bulleted lists, numbered lists, links to `https` URLs) that the
renderer sanitizes: page
descriptions, field help, `section` descriptions, and confirmation copy.
The subset is stored as the markdown syntax defined in `ui-ux/builder.md`;
labels and options never contain it.
Labels and options are always plain text.

## Structure of a version

```
Version
  title                        LocalizedText, required; the renderer's <h1> and browser title
  languages: bilingual | en | es
  headerImage?                 { ref, alt: LocalizedText }  shown on page 1 only, see specs/design.md
  pages[]                      ordered, at least one
    key, title, description?
    fields[]                   ordered
      key                      stable identifier, see Keys
      type                     a registered field type
      label                    LocalizedText, required
      help?                    LocalizedText
      required: boolean
      validation[]             rules allowed for the type
      settings                 type-specific, validated by the type
      visibility?              a Condition
    visibility?                a Condition on the page
  consent                      a consent field is mandatory when the form collects personal data, see Privacy
  confirmation
    screen: LocalizedText      shown after submit
    email?: { subject, body }  LocalizedText each; sent only if the form has an email field marked as the submitter's address
```

### Keys

Field and page keys are stable identifiers generated once and preserved
across versions when staff edit a field. Editing a label keeps the key.
Deleting a field and adding a new one produces a new key. Keys are what
export, review and conditions reference, so answers from different versions
of the same question line up.

## Field types in the first release

| Type | Answer shape | Settings | Validation allowed |
|---|---|---|---|
| `short_text` | string | placeholder | min/max length, pattern |
| `long_text` | string | placeholder, rows | min/max length |
| `email` | string | mark as submitter address (at most one per form) | pattern (syntax enforced always) |
| `phone` | string | | min/max length |
| `number` | number | integer only, unit label | min/max value |
| `date` | ISO date string | | min/max date, not in future |
| `single_choice` | option key | options[] (key + LocalizedText), display as radio or dropdown | |
| `multiple_choice` | option key[] | options[] | min/max selected |
| `checkbox` | boolean | | must be true |
| `consent` | `{ accepted: true, textVersion }` | consent text LocalizedText, see Consent text below | always required |
| `file_upload` | media reference[] | accepted kinds: `image`, `video`, or both; max files; max size per file within system limits | min/max files |
| `section` | none | title, description | |

Each type is implemented once as a registered capability that provides: the
builder editor for its settings, the renderer component, the server validator,
the storage normalizer, the export formatter, and the review display. A type
missing any of these fails the conformance suite.

Adding a type: see `CLAUDE.md`, "Adding a capability". Removing a type is not
supported while any version uses it.

### Export formats

- `short_text`, `long_text`, `email`, `phone`, `date`: the answer, as one cell.
- `number`: one cell, as a plain decimal string.
- `single_choice`: one cell with the option label in the export locale.
- `multiple_choice`: one cell with the option labels joined by "; ", in
  option order.
- `checkbox`: one cell, "yes" or "no" (Spanish "sí" or "no").
- `consent`: two cells, "yes" (Spanish "sí") and the accepted text version.
- `file_upload`: two cells, the file count and the media ids joined by "; ".
- `section`: no columns.

`multiple_choice` answers are normalized to option order with unknown keys
kept so validation can report them.

## Validation

Rules are declarative, attached per field, and chosen from the list the
field type allows. The server evaluates them against the version on every
submission. The client evaluates the same rules for immediate feedback and
may not add or skip any.

- `required` is a field property, not a rule, and is skipped for hidden fields.
- `must_be_true` fails when the answer is false or absent, so omitting the
  answer cannot bypass it even on a field that is not required.
- Messages are built from the rule and the field label by the renderer, in
  the submitter's locale. Staff do not write error messages.
- System maximums bound anything staff can set: text length, file size, file
  count, options per choice field, fields per page, pages per form. Values are
  in `specs/system/security.md`.
- `pattern` rules are matched by a linear-time engine using RE2 syntax.
  Backreferences and lookarounds are not supported and are rejected when the
  rule is saved. Patterns are at most 200 characters and compile to a bounded
  program size, so no pattern can stall the server.

## Conditional logic

A `Condition` decides whether a field or page is shown:

```
Condition := { all: Clause[] } | { any: Clause[] } | Clause
Clause    := { field: key, op: Operator, value?: any }
Operator  := equals | not_equals | contains | not_contains | is_empty
           | is_not_empty | greater_than | less_than | is_one_of
```

Rules:

- A clause may reference only a field that appears **earlier** in the form:
  an earlier page, or earlier on the same page. The builder enforces this, so
  cycles are impossible and evaluation is a single forward pass.
- A hidden field is not validated and its answer is **discarded** on submit,
  even if the client sent one.
- A hidden page is skipped in navigation and progress.
- A field referenced by a condition cannot be deleted until the condition is
  removed. The builder shows where it is used.
- Operators are registered capabilities with a type compatibility list, so
  the builder only offers operators that make sense for the referenced field.

## Lifecycle

```
draft --publish--> published --close--> closed --archive--> archived
                      |  ^                |
                      |  +---reopen-------+
                      +--publish again--> new version, stays published
```

- `draft`: has never been published. Not reachable by the public.
- `published`: the current version is live at `/f/<slug>`. Open and close
  dates can narrow that window.
- `closed`: public URL shows a closed message. Submissions remain reviewable.
- `archived`: hidden from the default manager list. Reversible: unarchive
  returns the form to `closed`, or to `draft` when it was never published.
- A form with submissions cannot be deleted, only archived. Submissions are
  removed by retention or explicit, audited deletion.

Publishing validates the draft: a title in every required language, at least
one page with one input field, no unlabeled field, all translations present
for bilingual forms, consent present when required, retention set, no
dangling condition references, alt text present in each required language
when a header image is set, at most one consent field, and the consent field
is never conditional.

## Submissions

```
Submission
  id, formId, versionId, locale, receivedAt, reference
  answers: { [fieldKey]: answer }   only visible fields, normalized per type; immutable
  media[]: references for file_upload answers
  consent: { fieldKey, textVersion, acceptedAt }
  status: new | viewed | edited | published
  curatedAnswers: { [fieldKey]: string }   text fields only, see use-cases/curate-submission.md
  publishedPostUrl?: https URL
```

`reference` is a short human identifier, `<prefix>-<sequence>`, where the
prefix is a form setting (default: uppercase initials of the slug) and the
sequence is per form, zero-padded to four digits. It names the Dropbox
folder and appears on the confirmation screen.

Answers are stored as a document keyed by field key, never as one column per
field. The version tells review and export how to interpret each key. An
export across versions takes the union of keys and labels each column by the
latest label.

## Consent text

The `consent` field's text is staff-authored but must cover a fixed
checklist, which the builder shows beside the text and publish validation
enforces by requiring the editor to tick each item as covered:

1. Who collects the data: Effluz.
2. What is collected: the answers and any photos or videos.
3. The purpose, in the form's own words.
4. Where it is stored: servers in the United States and Effluz's Dropbox.
5. How long: the form's retention period in months, matching settings.
6. That Effluz team members with access to that storage can see the files.
7. How to request earlier deletion: the privacy contact address.
8. That the submitter is an adult and, when a minor's data is involved, has
   authority to share it.
9. That text answers may be checked for spelling and grammar by an
   automated correction service (DeepL), and that the original is kept.

The builder offers a starting template in both languages that already
covers 1, 2 and 4 to 9, leaving the purpose to the editor. The renderer adds
nothing to the consent text; it must stand on its own.

## Privacy rules enforced by the model

- A form **collects personal data** if it contains an `email`, `phone` or
  `file_upload` field, or any field the staff member flags as personal. Such
  a form cannot publish without a `consent` field and a retention period.
- Retention is set per form in whole months. Default 12, maximum 36. The
  purge job deletes submissions and their media past retention, counted from
  `receivedAt`.
- Consent text is versioned with the form. A submission stores which text it
  accepted.
- Builder settings for uploads cannot exceed the system maximums.
- Images are re-encoded with metadata stripped. **Videos are stored as
  received, with no metadata-stripping guarantee.** A `file_upload` field
  that accepts video shows a fixed notice to the submitter saying so; see
  `ui-ux/renderer.md`.

## Builder guidance derived from the Laws of UX

The renderer guarantees accessible, consistent output for any valid
definition. The builder guides what the renderer cannot fix:

- Warns above 7 input fields on one page and blocks above the system
  maximum (Miller's Law, Hick's Law).
- Suggests a page break before a `file_upload` field.
- Requires a confirmation screen text (Peak-End Rule).
- Shows a live preview in both languages.
