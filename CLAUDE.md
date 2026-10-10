# CLAUDE.md

Guidance for working in `effluz-forms`. This file covers **how** to work here:
standards, workflow, and where things live. It deliberately says nothing about
specific technologies or libraries. Those decisions live in `specs/`.

## What this repository is

A form builder and manager for Effluz events and processes. Effluz staff
create, publish and manage forms in an admin area without developer help.
The public fills them in. Staff review the submissions.

A form is **data, not code**. Developers build capabilities: field types,
validation rules, rendering, submission handling, media, notifications,
review tools. If a form needs something the builder cannot do, the answer is a
new reusable capability, never form-specific code.

## Sources of truth

Read these before changing anything. If a spec and the code disagree, the spec
wins until the spec is deliberately changed.

| Location | Owns |
|---|---|
| `specs/architecture.md` | System structure, module map, layer boundaries, integrations, chosen technologies |
| `specs/form-definition.md` | The form model: structure, field types, validation, logic, translations, versioning, lifecycle |
| `specs/design.md` | Cross-surface design principles and visual direction |
| `specs/use-cases/<capability>.md` | One capability each: actors, flow, rules, errors, success criteria |
| `specs/ui-ux/<surface>.md` | UI and UX of one surface: `builder`, `renderer`, `manager` |
| `specs/system/<concern>.md` | One system concern each: database, media storage, jobs, email, security, deployment, CI/CD, observability |
| `specs/decisions/NNNN-<slug>.md` | Architecture Decision Records (ADRs) |
| `design-system/` | Brand assets, tokens, component standards, accessibility standards |

Other spec files may appear under `specs/`. Treat any `.md` there as
authoritative for its topic.

## Where code lives

```
src/
  app/                      composition root and framework entry points only
  modules/<module>/         one folder per capability, self-contained
    domain/                 entities, value objects, business rules, errors
    application/            use cases, ports (interfaces), DTOs, public API
    infrastructure/         adapters: storage, email, uploads, external services
    presentation/           screens, components, view models, copy bindings
  shared/                   kernel: value objects, ports and helpers used by two or more modules
tests/                      integration and end-to-end tests, fixtures, test helpers
ops/                        server provisioning script, Compose files, runbooks
```

The module list and the allowed dependencies between modules are defined in
`specs/architecture.md`. Rules that hold regardless of that list:

- A module exposes one public entry point from its `application/` layer.
  Other modules import only that. Never reach into another module's
  `domain/`, `infrastructure/` or `presentation/`.
- Module dependencies form a directed acyclic graph. If two modules need each
  other, extract the shared concept into `shared/` or merge them, and record
  the decision in an ADR.
- Nothing in `shared/` may import from `src/modules/`.
- Promote code to `shared/` only when at least two modules need it.
- Unit tests sit next to the code they test.
- Static brand assets referenced by code live in `design-system/`.
- Framework imports are allowed only in `presentation/` folders and `src/app/`.

## Workflow for every task

1. **Locate the spec.** Find the use-case for the capability, the UI/UX spec
   for the surface, `specs/form-definition.md` if the form model is involved,
   and `specs/architecture.md`. Read them fully.
2. **Resolve gaps before coding.** If the task needs behavior the spec does not
   define, or contradicts it, update the spec first (or flag it and stop if the
   decision is not yours to make). Spec changes go in the same PR as the code.
3. **Branch.** Create a feature branch from `main`. Never commit to `main`.
4. **Test first.** Write a failing test that captures the required behavior,
   make it pass, then refactor. No production code without a test driving it.
5. **Implement inside the architecture.** Respect the dependency rules.
6. **Verify.** Lint, type checks, and the full test suite must pass locally.
   Do not claim completion without running them and seeing them pass.
7. **Document.** Update affected specs. Write an ADR if a significant decision
   was made.
8. **Open a PR.** Describe what changed and why, and link the spec sections it
   implements.

## Architecture rules

We follow Clean Architecture. The core rule is **dependencies point inward**:

```
presentation -> application -> domain
infrastructure -> application -> domain
```

- `domain` depends on nothing outside itself. No framework, no I/O, no UI.
- `application` depends only on `domain`. It defines ports (interfaces) that
  `infrastructure` implements.
- `infrastructure` and `presentation` depend on `application` and `domain`,
  never on each other.
- Cross the boundary with plain data (DTOs), never with framework objects.
- Dependency injection wires adapters to ports at the composition root. Inner
  layers never instantiate outer-layer classes.

Apply SOLID deliberately:

- **S**: one reason to change per module. A use case does one thing.
- **O**: a new field type, validation rule or logic operator is added by
  registering a new implementation, never by editing a switch in stable code.
- **L**: any adapter or field type must be substitutable through its
  interface without callers knowing.
- **I**: keep ports small and specific to the use case that needs them.
- **D**: depend on abstractions owned by the inner layer, never on concretions.

If a change requires violating one of these, stop and record the trade-off in
an ADR before proceeding.

## The form model is the contract

Everything agrees on one definition of what a form is, in
`specs/form-definition.md`. Builder, renderer, validation, storage, export and
review all consume that model. Consequences:

- Published form versions are **immutable**. A submission records the version
  it answered and must render and export correctly forever.
- Validation runs from the same definition on the server. Client-side
  validation is a convenience, never the authority.
- Adding a field type means adding it everywhere the model is consumed:
  builder editor, renderer, validator, storage shape, export, review display.
  A field type that is missing from one consumer is a bug, and the test suite
  must catch it.
- Staff-authored text is untrusted input. It is escaped on every render and
  never interpreted as markup unless the form model explicitly allows a
  restricted subset.

## UX and accessibility rules

The Laws of UX apply to every surface, and the **renderer must produce
compliant forms from any definition staff can build**. Where a law cannot be
enforced by code, the builder must guide staff toward it.

- Minimize choices and steps per screen (Hick's Law, Miller's Law). The
  builder warns when a page exceeds the field count in the renderer spec.
- Make targets large and reachable (Fitts's Law).
- Match familiar form conventions (Jakob's Law).
- Group related fields visually (Law of Proximity, Common Region).
- Give immediate, specific feedback on errors and progress (Doherty Threshold).
- Design the ending carefully: confirmation and next steps matter
  (Peak-End Rule).

Accessibility baseline is **WCAG 2.2 AA**, non-negotiable, for the public
renderer and the admin surfaces alike:

- Fully keyboard-operable with a visible focus indicator. This includes the
  builder's drag-and-drop, which must have a keyboard equivalent.
- Every input has a programmatic label. Errors are associated with their field
  and announced to assistive technology.
- Color contrast meets AA. Information is never conveyed by color alone.
- Respect reduced-motion preferences.
- File upload has an accessible alternative path and clear status.
- A form cannot be published with an unlabeled field.

Language:

- Code, comments, commits, specs, and ADRs are written in English.
- Every staff-authored text has an **English and a Spanish** value, edited
  side by side. A form cannot publish with a missing translation unless it is
  marked single-language.
- Fixed chrome of the builder, renderer and manager has no hardcoded
  user-facing strings. Its copy lives in the surface's UI/UX spec and is the
  single source for translations.

Visual decisions follow `design-system/`. Do not invent colors, spacing, or
components ad hoc. If the design system lacks something, add it there first.

## Privacy and data handling

Any form may collect personal data, and some will collect stories and photos
of children. Treat every submission as sensitive by default.

- **Collect only what the form defines.** No extra fields, no hidden tracking,
  no analytics on submission content.
- **Every form has a retention period and consent text** set in the builder,
  within the bounds `specs/form-definition.md` defines. A form cannot publish
  without them.
- **Never use real submissions or real PII** in tests, fixtures, seeds, logs,
  screenshots, examples, docs, or commit messages. Generate synthetic data.
- **Never commit uploaded media** or submission exports.
- **Logs and error messages must not contain** answers, email addresses, file
  contents, or anything that identifies a submitter. Form and submission ids
  are fine.
- **Photos are sensitive.** Validate type and size at the boundary, strip
  metadata, and store them only through the media port.
- Secrets never enter the repository. Use the environment mechanism described
  in `specs/architecture.md`.

## Testing standards

- Test-driven: red, green, refactor, in that order.
- `domain` and `application`: unit tests, no I/O, no framework. Fast and
  exhaustive on business rules and validation.
- `infrastructure`: integration tests against the real adapter boundary, using
  disposable test resources, never shared or production ones.
- `presentation`: tests cover rendering of each state (empty, filling,
  validating, submitting, success, failure) and keyboard operability.
- **Every field type has a conformance test** that exercises it through
  builder, renderer, validator, storage, export and review. New field types
  are added to that suite, not tested ad hoc.
- End-to-end: build and publish a form, submit it, review the submission.
  Plus the main failure paths: invalid submission, closed form.
- Tests describe behavior, not implementation. Renaming a private function
  should not break a test.
- A bug fix starts with a test that reproduces the bug.

## Git and pull requests

- Branch names: `<type>/<module-or-area>-<short-description>`, for example
  `feat/renderer-file-upload-field`.
- Commits follow Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`,
  `test:`, `chore:`. Scope with the module name when relevant:
  `feat(definitions): add conditional logic operators`.
- Keep commits atomic. One logical change per commit, tests included.
- A PR is ready when: checks are green, specs are updated, ADRs are written if
  needed, and the description links the spec sections it implements.
- Do not merge your own PR without review unless explicitly told to.

## Documentation discipline

- A behavior change and its spec update ship in the same PR. Specs are never
  allowed to drift from the code.
- Write an ADR in `specs/decisions/` for any decision that is hard to reverse
  or that future contributors would question: module boundaries, the form
  model, storage shape, third-party services, retention, authentication.
  Keep ADRs short: context, decision, consequences.
- Do not duplicate spec content into code comments. Link to the spec instead.
- Keep `README.md` as a short orientation page. Detail belongs in `specs/`.

## Adding a capability

**A new field type, validation rule, or logic operator:**

1. Add it to `specs/form-definition.md` with its settings, storage shape,
   validation behavior, and how it renders, exports and displays in review.
2. Register the implementation in each consumer. Do not special-case it.
3. Add it to the conformance suite. Add both-language copy for its builder
   labels to the builder UI/UX spec.

**A new module or surface:**

1. Write `specs/use-cases/<capability>.md` and, if it has a UI,
   `specs/ui-ux/<surface>.md`.
2. Add the module and its allowed dependencies to `specs/architecture.md`
   with an ADR.
3. Get the specs reviewed before writing code.
4. Create `src/modules/<module>/` with the four layers. Start from the domain.

## When to stop and ask

Stop and ask rather than guess when:

- A spec is missing, ambiguous, or contradicts another spec.
- A change would weaken privacy, consent, or data retention guarantees.
- A change would alter a published form version or how it renders.
- A change requires breaking the dependency rules or a SOLID principle.
- A new third-party service or external dependency is needed.
- The design system lacks what the UI/UX spec asks for.

In all other cases, make the routine call, state the assumption in the PR, and
keep moving.
