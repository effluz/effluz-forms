# 0014. Interim: publish and submission validation branch on a few type ids

Status: accepted
Date: 2026-10-10

## Context

`CLAUDE.md` asks that a new field type be added by registering an
implementation, never by editing a switch in stable code. In the first
release, `publish.ts` and `submission.ts` still branch on a few type ids:
section titles, choice option labels and selection counts, the consent
checklist, the submitter email, and consent being always required and
always visible. Moving these into the field type registry now would widen
`FieldTypeDefinition` before any second consumer exists to shape the hooks.

## Decision

The id branches are accepted as an interim for the first release. Before the
`definitions` module starts, they move to optional hooks on
`FieldTypeDefinition`, such as `localizedSettingsTexts`, `publishChecks` and
`alwaysRequired`, exercised by the conformance suite. Rules that can already
be derived from the definition are derived: the `max_length` precondition for
a `pattern` rule follows the type's `allowedRules` and `maxLength`, not its id.

## Consequences

- A new type added before that refactor must be checked against
  `publish.ts` and `submission.ts` by hand; the conformance suite does not
  cover these branches.
- The refactor is a prerequisite of the `definitions` module, not optional
  clean-up.
