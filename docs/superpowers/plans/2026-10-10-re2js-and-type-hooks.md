# re2js and Field Type Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the interim regex safe subset with a linear-time engine (re2js), and move the remaining type-id branches in publish and submission validation into hooks on `FieldTypeDefinition`, so a new field type is added by registration alone.

**Architecture:** Both changes stay inside `src/modules/form-model/domain/`. re2js is a pure JavaScript port of RE2 with no I/O, admitted into the domain layer by ADR 0015 (amending ADR 0012). The hooks are optional members of `FieldTypeDefinition`; `publish.ts` and `submission.ts` consume them generically and the conformance suite exercises them with each type's settings fixtures.

**Tech Stack:** as ADR 0012, plus `re2js` 2.x.

**Spec:** `specs/form-definition.md` (Validation, Lifecycle), `specs/decisions/0012-toolchain.md`, `0013-pattern-rule-safe-subset.md`, `0014-form-model-type-branches-interim.md`, `CLAUDE.md` ("O" principle, conformance suite).

## Global Constraints

- Domain layers import only `zod`, `re2js` (after this plan), `src/shared/domain` and siblings. ESLint boundaries enforce frameworks and Node core modules out.
- Validation and publish codes are unchanged. No new codes.
- Every behavior change is test-first. `pnpm test && pnpm lint && pnpm typecheck && pnpm format:check` green before each commit. Conventional Commits, scope `form-model`.
- Specs change in the same PR as the code. Prettier ignores specs; wrap by hand at 80 columns.
- Keys obey `^[a-z][a-z0-9_]{3,31}$`.

---

### Task 1: Adopt re2js for pattern rules

**Files:**
- Modify: `package.json` (add `re2js`), `pnpm-lock.yaml`
- Modify: `src/modules/form-model/domain/rules.ts`, `rules.test.ts`
- Modify: `src/modules/form-model/domain/publish.ts`, `publish.test.ts` (remove the pattern length precondition)
- Modify: `src/modules/form-model/application/index.ts` (drop `PATTERN_MAX_INPUT`)
- Modify: `specs/form-definition.md` (Validation bullet, Lifecycle clause)
- Modify: `specs/decisions/0012-toolchain.md` (allow re2js in domain), `0013-pattern-rule-safe-subset.md` (status: superseded by 0015)
- Create: `specs/decisions/0015-re2js-pattern-engine.md`

**Behavior:**
- `safeRegex(source)` returns true when `source.length <= 200` and `RE2JS.compile(source)` succeeds. The whitelist scanner, `MAX_REPEAT`, `MAX_GROUP_DEPTH`, `MAX_QUANTIFIERS`, `MAX_ALTERNATIVES` and `PATTERN_MAX_INPUT` are deleted. RE2 rejects backreferences and lookarounds at compile time, which is the intended rejection.
- `evaluateRule` for `pattern` compiles with `RE2JS.compile(rule.value, rule.flags === "i" ? RE2JS.CASE_INSENSITIVE : 0)` and requires a full match of the trimmed answer (use the API's full-match method; confirm the exact name in the re2js README under `node_modules/re2js`). No input length bound: matching is linear in input and pattern size, and the type caps already bound the input.
- Patterns that are now accepted: `(a+)+`, `(a|aa)+`, `a*a*a*b`, `a{0,1000}a{0,1000}a{0,1000}a{0,1000}b`, `[^@\s]+@[^@\s]+\.[a-z]{2,}`, `(Mon|Tue|Wed|Thu|Fri)`. Still rejected: `(a)\1`, `(?=a)b`, `(`, `\k<n>`, a 201-character pattern. `a{1001}`: whatever RE2 does (it caps repeats at 1000 and rejects above); pin the observed behavior with a comment.
- A timing guard test: `(a|aa)+` against `"a".repeat(10_000) + "b"` returns `"pattern"` in under 500 ms (measure with `performance.now()`).
- `publish.ts`: remove the `typeCapsPatternInput` block entirely and the `PATTERN_MAX_INPUT` import; remove the three publish tests about the pattern bound.
- Spec: replace the Validation bullet about the safe subset with: "`pattern` rules are matched by a linear-time engine using RE2 syntax, so no pattern can stall the server. Backreferences and lookarounds are not supported and are rejected when the rule is saved. Patterns are at most 200 characters." Remove ", a pattern rule only on a field whose length is capped at 1,000 or below" from the Lifecycle paragraph.
- ADR 0015 (accepted, 2026-10-10, under 40 lines): context (ADR 0013's subset was interim; the user approved a linear-time engine), decision (re2js in domain; RE2 syntax; 200-character pattern cap; full-match semantics; flags limited to case-insensitive), consequences (expressiveness restored except backreferences and lookarounds; ADR 0013 superseded; ADR 0012's domain dependency list is now zod and re2js). Edit ADR 0012's sentence "No other third-party dependency is allowed in `domain/`" to name re2js as the second allowed one per ADR 0015. Set ADR 0013 status to `superseded by 0015`.

**Verification:** `pnpm test src/modules/form-model/domain/rules src/modules/form-model/domain/publish`, then the full line.

**Commit:** `feat(form-model): match pattern rules with the linear-time re2js engine`

---

### Task 2: Field type hooks replace type-id branches

**Files:**
- Modify: `src/modules/form-model/domain/field-type.ts`
- Modify: `field-types/section.ts`, `single-choice.ts`, `multiple-choice.ts`, `consent.ts`, `email.ts`, `file-upload.ts`, `choice-shared.ts` (shared option checks)
- Modify: `publish.ts`, `submission.ts`, `visibility.ts`, `version.ts` (`inputFields` fallback)
- Modify: `field-types/conformance-checks.ts`, `conformance-checks.test.ts`, tests beside each changed type, `publish.test.ts`, `submission.test.ts`, `visibility.test.ts`
- Modify: `specs/decisions/0014-form-model-type-branches-interim.md` (status: superseded by 0016)
- Create: `specs/decisions/0016-field-type-hooks.md`
- Modify: `src/modules/form-model/application/index.ts` (export the new hook types)

**New optional members on `FieldTypeDefinition<S, A>`:**

```ts
/** Staff-authored texts inside settings that publish validation must check. */
localizedSettingsTexts?(settings: S): SettingsText[];
// SettingsText = { path: string; text: LocalizedText | undefined; blankCode: PublishCode | null }
//   path is relative to the field's settings, e.g. "title", "options/2/label".
//   text undefined means optional and absent: skipped. blankCode null means optional text:
//   only missing_translation applies when partially filled.

/** Type-specific publish checks beyond texts; paths are relative to the field. */
publishChecks?(field: { required: boolean; validation: readonly Rule[] }, settings: S): PublishIssueDraft[];
// PublishIssueDraft = { code: PublishCode; path: string; params?: IssueParams }

/** Form-wide exclusivity: a role may appear at most once per form. */
exclusiveRoles?(settings: S): ExclusiveRole[];
// ExclusiveRole = { role: string; code: PublishCode; params?: IssueParams }

/** The answer is demanded even when the field is not marked required. */
alwaysRequired?: true;
/** Code reported when a required answer is absent or malformed; default "required"/"invalid_shape". */
requiredCode?: ValidationCode;
/** Visibility conditions never hide this field; publish rejects any condition on it. */
neverHidden?: true;
/** Extracts the consent record from a normalized answer. */
consentRecord?(answer: A): { textVersion: string };
```

**Type implementations:**
- `section`: `localizedSettingsTexts` returns `[{ path: "title", text: s.title, blankCode: "unlabeled" }, { path: "description", text: s.description, blankCode: null }]`.
- `single_choice`, `multiple_choice`: `localizedSettingsTexts` returns one entry per option label (`options/<i>/label`, `option_unlabeled`); `publishChecks` emits `over_maximum` at `validation` with the existing detail string when a `min_selected`/`max_selected` value exceeds the option count. Share the two helpers in `choice-shared.ts`.
- `consent`: `localizedSettingsTexts` returns `[{ path: "text", text: s.text, blankCode: "unlabeled" }]`; `publishChecks` emits `consent_checklist` at `settings/coveredItems` when the checklist is incomplete; `exclusiveRoles` returns `[{ role: "consent", code: "over_maximum", params: { detail: "more than one consent field" } }]`; `alwaysRequired: true`; `requiredCode: "consent"`; `neverHidden: true`; `consentRecord: (a) => ({ textVersion: a.textVersion })`.
- `email`: `exclusiveRoles` returns `[{ role: "submitter_address", code: "submitter_email_dup" }]` when `isSubmitterAddress` is true, else `[]`.
- `file_upload`: `publishChecks` emits `over_maximum` at `validation` when a `min_files`/`max_files` value exceeds `settings.maxFiles`, with the existing detail string.
- Text caps are generic: `publish.ts` emits `over_maximum` at `validation` when a `min_length`/`max_length` value exceeds `def.maxLength` for any type that declares `maxLength`. This replaces the `short_text`/`long_text` branch (same detail string).

**Consumers:**
- `publish.ts`: no `def.id` comparisons remain. Texts from `localizedSettingsTexts` go through `requireText`/`optionalText` with path `${fPath}/settings/${entry.path}`. `publishChecks` results get `${fPath}/${draft.path}`. `exclusiveRoles` are counted per role across the form; a role seen more than once pushes its code at `pages` once (with its params). `neverHidden` fields with a field or page condition push `consent_missing`? No: push the type's `requiredCode`-independent rule as before, keep the code `consent_missing` only if the role is consent... Simplest and generic: a `neverHidden` field with a condition pushes `dangling_condition`? No. Rule: push `consent_missing` at `fPath` when the field is `neverHidden` and conditional. Keep that code, since the only `neverHidden` type is consent and the builder copy fits; document the coupling in the ADR. The "consent present when personal data is collected" check becomes: `collectsPersonalData(...) && !inputFields.some(f => registry.get(f.type).alwaysRequired)` → `consent_missing` at `pages`.
- `submission.ts`: absent answer: if `def.alwaysRequired` → `issue(def.requiredCode ?? "required")`; else if `field.required` → `required`; else the `must_be_true` rule as today. Shape failure: `def.alwaysRequired ? def.requiredCode ?? "invalid_shape" : "invalid_shape"`. Empty-and-required: `def.requiredCode ?? "required"` when `alwaysRequired` or required. Visibility: `def.neverHidden || (pageVisible && fieldVisible)`. Consent record: `if (def.consentRecord) consent = { fieldKey, ...def.consentRecord(normalized) }`.
- `visibility.ts`: accept an optional third parameter `registry?: FieldTypeRegistry`; a field is skipped from `visibleAnswers` when `!(registry ? registry.get(field.type).isInput : field.type !== "section")`, and a `neverHidden` type is always visible when a registry is given. Update `validateSubmission`'s callers? `validateSubmission` has its own loop; leave it. Export unchanged signature compatibility: the new parameter is optional.
- `version.ts` `inputFields`: unchanged.

**Conformance suite additions (`conformance-checks.ts`):**
- "publish hooks return well-formed results": for each settings fixture, `localizedSettingsTexts` (if defined) returns entries whose `path` is a non-empty string and `blankCode` is null or in `publishCodes`; `publishChecks` (if defined) with `{ required: false, validation: [] }` returns an empty array (fixtures are valid) and with `{ required: false, validation: def.fixtures.overLimitRules ?? [] }`... keep simple: returns an array whose codes are in `publishCodes`; `exclusiveRoles` (if defined) returns entries with non-empty `role` and a code in `publishCodes`.
- "alwaysRequired types declare a requiredCode and never report empty": if `alwaysRequired`, `requiredCode` is defined and `isEmpty` is false for every valid answer.
- "consentRecord returns a text version": if `consentRecord` is defined, it returns a 16-hex string for every valid answer.

**Tests:** every hook gets a unit test in its type's test file; `publish.test.ts` and `submission.test.ts` keep every existing expectation (behavior is unchanged) and add: a stub type with `localizedSettingsTexts` registered in a custom registry produces `unlabeled` at the right path; a stub with `exclusiveRoles` twice produces its code once; `grep -n 'def.id ===' src/modules/form-model/domain/publish.ts src/modules/form-model/domain/submission.ts` prints nothing (assert this in a test by reading the files? No: keep it as a review check).

**ADR 0016** (accepted, 2026-10-10, under 45 lines): context (ADR 0014 interim), decision (the hook set above, consumers generic, conformance coverage), consequences (a new type never touches publish or submission; `consent_missing` on a conditional `neverHidden` field couples the code to the consent concept, acceptable while consent is the only such type; `visibility.ts` takes an optional registry). Set ADR 0014 status to `superseded by 0016`.

**Verification:** full line, then `grep -n "def.id ===" src/modules/form-model/domain/publish.ts src/modules/form-model/domain/submission.ts` must print nothing.

**Commit:** `refactor(form-model): move type-specific publish and submission rules into field type hooks`

---

## Finish

Push, open a PR against `main` titled `feat(form-model): re2js pattern engine and field type hooks` linking ADRs 0015 and 0016 and the spec sections, wait for `ci`, then the controller merges and cleans up the worktree and branch.
