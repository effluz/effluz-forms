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
    cp .env.example .env
    pnpm db:up && pnpm db:migrate
    pnpm dev            # app on :3000
    pnpm worker         # in a second terminal
    pnpm test && pnpm test:integration

`pnpm dev` reads `.env`; the `tsx` scripts (`db:migrate`, `worker`,
`sessions:revoke`) do not. Before running them, export the variables in the
same shell (`set -a; . ./.env; set +a`), or run the script as
`pnpm exec tsx --env-file=.env <file>`.

Before a PR: `pnpm lint && pnpm typecheck && pnpm format:check`. See
`specs/system/deployment.md`, "Local development".
