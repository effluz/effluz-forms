# CLAUDE.md

Guidance for working in `effluz-forms`. This file covers **how** to work here:
standards, workflow, and where things live. It deliberately says nothing about
specific technologies or libraries. Those decisions live in `specs/`.

## What this repository is

A single application that hosts forms for Effluz events and processes. Each
form serves one purpose and is built as a self-contained feature module.

## Sources of truth

Read these before changing anything. If a spec and the code disagree, the spec
wins until the spec is deliberately changed.

| Location | Owns |
|---|---|
| `specs/architecture.md` | System structure, layer boundaries, integration points, chosen technologies |
| `specs/design.md` | Cross-form design principles and visual direction |
| `specs/ui-ux/<form-name>.md` | UI and UX behavior of one form: screens, flow, copy, states, validation |
| `specs/use-cases/<form-name>.md` | Purpose, actors, fields, business rules, consent, retention for one form |
| `specs/system/<concern>.md` | One system concern each: database, media storage, jobs, email, security, deployment, CI/CD, observability |
| `specs/decisions/NNNN-<slug>.md` | Architecture Decision Records (ADRs) |
| `design-system/` | Brand assets, tokens, component standards, accessibility standards |

Other spec files may appear under `specs/`. Treat any `.md` there as
authoritative for its topic.

## Where code lives

```
src/
  app/                      composition root and framework entry points only
  forms/<form-name>/        one folder per form, self-contained
    domain/                 entities, value objects, business rules, errors
    application/            use cases, ports (interfaces), DTOs
    infrastructure/         adapters: storage, email, uploads, external services
    presentation/           screens, components, view models, copy bindings
  shared/                   cross-form code, same four layers, no form-specific logic
tests/                      integration and end-to-end tests, fixtures, test helpers
ops/                        server provisioning script, Compose files, runbooks
```

- Unit tests sit next to the code they test.
- Nothing in `shared/` may import from `src/forms/`.
- A form never imports from another form. Promote common code to `shared/`
  instead, and only when at least two forms need it.
- Static brand assets referenced by code live in `design-system/`, not in a form.
- Framework imports are allowed only in `presentation/` folders and `src/app/`.

## Workflow for every task

1. **Locate the spec.** Find the use-case and UI/UX docs for the form involved,
   plus `specs/architecture.md`. Read them fully.
2. **Resolve gaps before coding.** If the task needs behavior the spec does not
   define, or contradicts it, update the spec first (or flag it and stop if the
   decision is not yours to make). Spec changes go in the same PR as the code.
3. **Branch.** Create a feature branch from `main`. Never commit to `main`.
4. **Test first.** Write a failing test that captures the required behavior,
   make it pass, then refactor. No production code without a test driving it.
5. **Implement inside the architecture.** Respect the dependency rule below.
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
- **O**: extend behavior by adding adapters or strategies, not by editing
  stable domain code.
- **L**: any adapter must be substitutable for its port without callers knowing.
- **I**: keep ports small and specific to the use case that needs them.
- **D**: depend on abstractions owned by the inner layer, never on concretions.

If a change requires violating one of these, stop and record the trade-off in
an ADR before proceeding.

## UX and accessibility rules

Every form must follow the Laws of UX. Apply them explicitly when designing
flows and screens, and name the law you are applying in the UI/UX spec:

- Minimize choices and steps per screen (Hick's Law, Miller's Law).
- Make targets large and reachable (Fitts's Law).
- Match familiar form conventions (Jakob's Law).
- Group related fields visually (Law of Proximity, Common Region).
- Give immediate, specific feedback on errors and progress (Doherty Threshold).
- Design the ending carefully: confirmation and next steps matter
  (Peak-End Rule).

Accessibility baseline is **WCAG 2.2 AA**, non-negotiable:

- Fully keyboard-operable with a visible focus indicator.
- Every input has a programmatic label. Errors are associated with their field
  and announced to assistive technology.
- Color contrast meets AA. Information is never conveyed by color alone.
- Respect reduced-motion preferences.
- File upload has an accessible alternative path and clear status.

Language:

- Code, comments, commits, specs, and ADRs are written in English.
- Every form ships in **English and Spanish** unless its use-case spec states
  otherwise. No hardcoded user-facing strings. Copy for both languages lives in
  the form's UI/UX spec and is the single source for translations.

Visual decisions follow `design-system/`. Do not invent colors, spacing, or
components ad hoc. If the design system lacks something, add it there first.

## Privacy and data handling

Forms collect personal data, and the first one collects stories and photos of
children. Treat all submission data as sensitive.

- **Collect only what the use-case spec lists.** No extra fields, no hidden
  tracking, no analytics on submission content.
- **Consent and retention must be defined** in the use-case spec before any
  storage code is written. If they are missing, stop and request them.
- **Never use real submissions or real PII** in tests, fixtures, seeds, logs,
  screenshots, examples, docs, or commit messages. Generate synthetic data.
- **Never commit uploaded media** or submission exports. Keep them out of the
  repository and out of version-controlled config.
- **Logs and error messages must not contain** email addresses, story text,
  file contents, or anything that identifies a submitter.
- **Photos are sensitive.** Validate type and size at the boundary, strip
  metadata where the spec requires, and store them only through the port the
  use case defines.
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
- Each form has at least one end-to-end test of its happy path and one of its
  main failure path.
- Tests describe behavior, not implementation. Renaming a private function
  should not break a test.
- A bug fix starts with a test that reproduces the bug.

## Git and pull requests

- Branch names: `<type>/<form-or-area>-<short-description>`, for example
  `feat/preemie-stories-photo-upload`.
- Commits follow Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`,
  `test:`, `chore:`. Scope with the form name when relevant:
  `feat(preemie-stories): add consent step`.
- Keep commits atomic. One logical change per commit, tests included.
- A PR is ready when: checks are green, specs are updated, ADRs are written if
  needed, and the description links the spec sections it implements.
- Do not merge your own PR without review unless explicitly told to.

## Documentation discipline

- A behavior change and its spec update ship in the same PR. Specs are never
  allowed to drift from the code.
- Write an ADR in `specs/decisions/` for any decision that is hard to reverse
  or that future contributors would question: layer boundaries, storage model,
  third-party services, data retention, authentication approach. Keep ADRs
  short: context, decision, consequences.
- Do not duplicate spec content into code comments. Link to the spec instead.
- Keep `README.md` as a short orientation page. Detail belongs in `specs/`.

## Adding a new form

1. Write `specs/use-cases/<form-name>.md`: purpose, actors, fields, rules,
   consent, retention, success criteria.
2. Write `specs/ui-ux/<form-name>.md`: flow, screens, states, copy in both
   languages, Laws of UX applied, accessibility notes.
3. Get both specs reviewed before writing code.
4. Create `src/forms/<form-name>/` with the four layers. Start from the domain.
5. Reuse `shared/` and `design-system/` before writing anything new.
6. Add end-to-end tests for the happy path and the main failure path.
7. Update `specs/architecture.md` if the form introduces a new integration.

## When to stop and ask

Stop and ask rather than guess when:

- A spec is missing, ambiguous, or contradicts another spec.
- A change would weaken privacy, consent, or data retention guarantees.
- A change requires breaking the dependency rule or a SOLID principle.
- A new third-party service or external dependency is needed.
- The design system lacks what the UI/UX spec asks for.

In all other cases, make the routine call, state the assumption in the PR, and
keep moving.
