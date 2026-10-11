# Use case: Create and edit a form

Module: `definitions`. Surface: builder. Model: `form-definition.md`.

Status: the use cases (create, duplicate, edit the draft) are built; the
builder screens arrive with their own plan. Until then the manager's "Edit in
builder" opens a placeholder page at `/admin/forms/<id>/edit`, and the draft
is edited only through the commands described below.

## Actors

- **Editor**: a signed-in staff member.

## Trigger

The editor clicks "New form" in the manager, or opens an existing form's
draft.

## Main flow: create

0. The editor chooses Blank or Duplicate an existing form. Duplicate copies
   the source's latest draft and its settings except slug, dates and
   recipients, with new page, field and option keys (conditions follow the
   new keys). The header image is not copied, since its media belongs to the
   source form, and the reference prefix is derived from the new slug. The
   copy takes the language mode chosen in step 1. The source can be any form
   that has a draft, whatever its status.
1. The editor enters a working title (both languages, or one if the form is
   marked single-language) and picks the language mode.
2. The system generates a slug from the title, which the editor may change
   within the slug rules, and checks uniqueness.
3. A `form` row in status `draft` and a `form_draft` row (revision 1) with
   one empty page are created in one transaction. The form row mirrors the
   title and language mode of the draft document. Audit entry `form_created`.
4. The builder opens on the draft.

## Main flow: edit the draft

1. The editor adds pages, and within pages adds fields by choosing a field
   type. Each new field gets a system key, an empty bilingual label and the
   starting settings of its type (`form-definition.md`, "New field starting
   values"), so a field can be added before it is complete; publish
   validation reports what is still missing.
2. The editor edits labels, help, required, type-specific settings and
   validation rules in a field panel. Both languages are shown side by side.
   When one language is filled and the other empty, the editor may request
   a machine translation suggestion, which is applied only on accept and
   stays tagged as unreviewed until an editor confirms it.
3. The editor reorders fields and pages by drag and drop or keyboard
   commands, and moves a field between pages.
4. The editor sets visibility conditions on a field or page by choosing an
   earlier field, an operator the registry allows for that field's type, and
   a value.
5. The editor edits the confirmation screen text and, optionally, the
   confirmation email subject and body.
6. Every change is saved automatically within a short delay. The builder
   sends its edits as a batch of typed commands (`rename_form`,
   `set_languages`, `add_page`, `update_page`, `move_page`, `delete_page`,
   `add_field`, `update_field`, `change_field_type`, `move_field`,
   `delete_field`, `set_header_image`, `update_confirmation`) together with
   the draft revision it last saw. The server applies the commands in order to
   the stored document; the result must be a well-formed definition, which
   the builder UI should make impossible to violate. The batch is all or
   nothing and advances the revision by one. The result is one of:
   - **saved**: the new revision, the document, and the keys of any page or
     field the batch created;
   - **stale**: the base revision is not the stored one (another save landed
     first). Nothing is written; the stored revision and document come back;
   - **rejected**: a command was refused. Nothing is written; the result
     names the index of the command and the rejection (below);
   - **not found**: the form or its draft does not exist.
7. A live preview renders the current draft in either language at any time.

## Alternate flows and errors

- **Rejected commands.** The builder shows each rejection next to the item
  concerned and keeps the editor's other edits. The codes, with the
  parameters they carry:

  | Code | Raised when | Parameters |
  |---|---|---|
  | `unknown_page`, `unknown_field` | The command names a page or field key that is not in the draft | `key` |
  | `last_page` | Deleting the only page | none |
  | `limit_pages` | Adding a page beyond the pages-per-form maximum | `max` |
  | `limit_fields` | Adding or moving an input field onto a page that already holds the maximum | `max` |
  | `bad_index` | A move to a position outside the list | `max`, the highest valid position |
  | `referenced_by_conditions` | Deleting a page or field that a surviving condition references | `keys`, the owners of those conditions, comma-separated |
  | `condition_unknown_field` | A condition names a field that does not exist | `key` (the owner), `ref` |
  | `condition_forward_reference` | A condition would reference a field that is not earlier, whether by editing it or by moving a field or page | `key`, `ref` |
  | `incompatible_type` | A type change outside the compatible pairs | `from`, `to` |
  | `invalid_document` | The result does not parse (a field's settings, a rule, a text, a language switch without the surviving language in `keep`) | the parse issues, each with a path |

  Limits are the system maximums in `system/security.md`.
- **Deleting a field referenced by a condition.** Refused as
  `referenced_by_conditions`. The panel lists the fields and pages whose
  conditions reference it.
- **Deleting a field after the form has been published.** Allowed in the
  draft. The field's key disappears from the next version; older
  submissions keep their answers and still render through their version.
- **Changing a field's type.** Allowed only between compatible types:
  `short_text` and `long_text`, in either direction. Settings the new type
  accepts are kept; otherwise the new type starts from its defaults, and
  rules it does not allow are dropped. Showing a `single_choice` as radio
  buttons or a dropdown is a setting, not a type change. Anything else is
  delete and add, with a new key.
- **Two editors on the same draft.** Last save wins per field. A batch based
  on an older revision comes back `stale` with the stored revision and
  document; the builder re-applies its pending commands over that document and
  saves again, so edits to different fields never clash and, on the same
  field, the later save wins. A command the stored document no longer allows
  (for example, a field the other editor deleted) comes back `rejected` and is
  reported. The builder shows who else has the draft open and refreshes on
  conflict. There are no editor-visible locks in the first release: nobody is
  ever told they must wait. (The server does take transactional row locks
  while a save, publish or other change is written; they last milliseconds
  and are invisible to editors.)
- **Slug taken, or reserved** (`admin`, `api`, `health`, `f`). Inline error.
- **Session expired during editing.** Unsaved changes are kept in the browser
  and offered for restore after sign-in.
- **Translation service unavailable.** The suggestion button reports it;
  editing continues. Nothing else depends on the service.

## Rules

- A form has exactly one draft at all times once created.
- Keys are generated once and never typed or edited.
- A single-language form may be switched to bilingual later; the reverse
  requires confirming which language's texts are kept: `set_languages` to a
  single language carries `keep`, which must equal that language, and drops
  the other language's text everywhere in the draft, the title included.
  Switching from one single language to the other therefore empties every
  text until the new language is filled in.
- The form's title and language mode live in the draft document. The `form`
  row mirrors them (a batch containing `rename_form` or `set_languages`
  updates both in the same transaction), so lists never read documents.
- The builder enforces the system maximums in `system/security.md` at input
  time, never only at publish.
- Conditions may reference only earlier fields. The picker shows only those.
- Autosave never publishes. Nothing the editor does here is visible to the
  public.

## Audit entries

`form_created` (with the languages, and the source form's id when
duplicated), `draft_saved` (with the number of commands saved; coalesced to
at most one entry per editor per five minutes, and a new form's first save
always writes one), `draft_language_mode_changed` (with the new mode; one per
`set_languages` command, never coalesced). Details are listed in
`system/security.md`, "Audit log".

## Success criteria

- An editor can build the reference form in `reference-form-preemie-stories.md`
  without developer help, in both languages or Spanish only, using only the
  keyboard if they choose.
- Closing the browser mid-edit loses at most the last few seconds of work.
- The preview is pixel-for-pixel the public renderer for the same definition.
