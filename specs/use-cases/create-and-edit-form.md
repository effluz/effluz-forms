# Use case: Create and edit a form

Module: `definitions`. Surface: builder. Model: `form-definition.md`.

## Actors

- **Editor**: a signed-in staff member.

## Trigger

The editor clicks "New form" in the manager, or opens an existing form's
draft.

## Main flow: create

0. The editor chooses Blank or Duplicate an existing form. Duplicate copies
   the source's latest draft and its settings except slug, dates and
   recipients, with new field keys.
1. The editor enters a working title (both languages, or one if the form is
   marked single-language) and picks the language mode.
2. The system generates a slug from the title, which the editor may change
   within the slug rules, and checks uniqueness.
3. A `form` row in status `draft` and a `form_draft` row with one empty page
   are created. Audit entry `form_created`.
4. The builder opens on the draft.

## Main flow: edit the draft

1. The editor adds pages, and within pages adds fields by choosing a field
   type. Each new field gets a system key and an empty bilingual label.
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
6. Every change is saved automatically within a short delay. The draft is
   validated structurally on each save and rejected only if it is not a
   well-formed definition, which the builder UI should make impossible.
7. A live preview renders the current draft in either language at any time.

## Alternate flows and errors

- **Deleting a field referenced by a condition.** Refused. The panel lists
  the fields and pages whose conditions reference it.
- **Deleting a field after the form has been published.** Allowed in the
  draft. The field's key disappears from the next version; older
  submissions keep their answers and still render through their version.
- **Changing a field's type.** Allowed only between compatible types
  (`short_text` and `long_text`, radio and dropdown display of
  `single_choice`). Anything else is delete and add, with a new key.
- **Two editors on the same draft.** Last save wins per field. The builder
  shows who else has the draft open and refreshes on conflict. No locking in
  the first release.
- **Slug taken, or reserved** (`admin`, `api`, `health`, `f`). Inline error.
- **Session expired during editing.** Unsaved changes are kept in the browser
  and offered for restore after sign-in.
- **Translation service unavailable.** The suggestion button reports it;
  editing continues. Nothing else depends on the service.

## Rules

- A form has exactly one draft at all times once created.
- Keys are generated once and never typed or edited.
- A single-language form may be switched to bilingual later; the reverse
  requires confirming which language's texts are kept.
- The builder enforces the system maximums in `system/security.md` at input
  time, never only at publish.
- Conditions may reference only earlier fields. The picker shows only those.
- Autosave never publishes. Nothing the editor does here is visible to the
  public.

## Audit entries

`form_created`, `draft_saved` (coalesced to at most one entry per editor per
five minutes), `draft_language_mode_changed`.

## Success criteria

- An editor can build the reference form in `reference-form-preemie-stories.md`
  without developer help, in both languages or Spanish only, using only the
  keyboard if they choose.
- Closing the browser mid-edit loses at most the last few seconds of work.
- The preview is pixel-for-pixel the public renderer for the same definition.
