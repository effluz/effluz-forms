# effluz-forms

Form builder and manager for Effluz events and processes. Staff build and
publish forms; the public fills them in; staff review the results.

- How to work here: `CLAUDE.md`
- What the system is: `specs/architecture.md`, `specs/form-definition.md`
- Design: `specs/design.md`, `design-system/`
- Decisions: `specs/decisions/`

## Develop

    corepack enable
    pnpm install
    pnpm test
    pnpm lint && pnpm typecheck
