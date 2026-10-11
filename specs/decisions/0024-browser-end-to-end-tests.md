# 0024. Browser end-to-end tests with Playwright

Status: accepted
Date: 2026-10-11

## Context

`ui-ux/renderer.md` asks the e2e suite to complete the reference form on a
phone viewport with script enabled. Early uploads with progress, blur checks
and the offline banner exist only in a browser; an HTTP client cannot run
them. Options were Playwright, Cypress, or WebdriverIO.

## Decision

- `@playwright/test` as a development dependency, Chromium only, run by
  `pnpm test:e2e:browser` against the built app (`next start`) on a
  throwaway database, the same way the HTTP e2e suite starts it.
- CI installs Chromium with `playwright install --with-deps chromium` in its
  own job. Locally the browser run counts as one heavy process.
- The HTTP suite stays: it is the script-disabled run and owns the budgets.

## Consequences

- One more development dependency and a browser download in CI.
- Firefox and WebKit are not covered; adding them is a config change.
- Specs live in `tests/browser/*.spec.ts`, outside Vitest's `*.test.ts`.
