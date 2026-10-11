# 0016. Type-specific publish and submission rules live in field type hooks

Status: accepted
Date: 2026-10-10
Amended 2026-10-10: the form model moved to the shared kernel, ADR 0022
Amended 2026-10-10: a required `defaultSettings(ids)` hook gives the smallest
settings a newly added field parses with; the conformance suite checks it

## Context

ADR 0014 accepted, as an interim, that `publish.ts` and `submission.ts`
branch on type ids for section titles, choice options, the consent rules,
the submitter email and text caps, until the `definitions` module starts.

## Decision

`FieldTypeDefinition` gains optional hooks, and the two consumers read them
without knowing any type id:

- `localizedSettingsTexts`: staff-authored texts inside settings, each with a
  path relative to the settings and a blank code, or null for optional text.
- `publishChecks`: type-specific publish issues, with paths relative to the
  field.
- `exclusiveRoles`: roles at most one field per form may hold; a second
  holder reports the role's code once, at `pages`.
- `alwaysRequired`, `requiredCode`: the answer is demanded even when the
  field is not required, and absent, empty or malformed answers report the
  type's code.
- `neverHidden`: conditions never hide the field.
- `consentRecord`: extracts the consent record from a valid answer.

Text caps are derived from the declared `maxLength` of any type. The
conformance suite checks that hook results are well formed, that an
always-required type declares a `requiredCode` and never reports a valid
answer empty, and that a consent record carries a 16-hex text version.

## Consequences

- A new field type never touches `publish.ts` or `submission.ts`; the
  conformance suite covers its hooks.
- A conditional `neverHidden` field reports `consent_missing`, and a form
  collecting personal data needs an `alwaysRequired` field. Both couple the
  hooks to the consent concept, acceptable while consent is the only such
  type. A second one would need its own codes.
- `evaluateVisibility` takes an optional registry to honor `isInput` and
  `neverHidden`; without one it keeps its earlier behavior.
- ADR 0014 is superseded.
