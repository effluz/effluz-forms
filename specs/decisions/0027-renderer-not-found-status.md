# 0027. A missing public form answers 200 with real HTML

Status: accepted
Date: 2026-10-17

## Context

`specs/ui-ux/renderer.md` asked for a 404 when `/f/<slug>` names no published
form and a 500 when the page fails to render. The app runs Next 16.4.0 with
Cache Components on (`specs/architecture.md`). Two attempts to produce real
status codes were measured against the installed version, with a probe app
built and served with `next build` and `next start`:

- Under any layout tree, with or without a root parameter, `notFound()`, a
  thrown error and `redirect()` from the page all answer 200. The response is
  the empty `<html id="__next_error__">` shell with the screen, or the
  redirect, only in the RSC payload: the server render has no error boundary
  (`next/dist/client/components/http-access-fallback/error-boundary.js` is a
  client class component; the Fizz builds carry no `getDerivedStateFromError`),
  and the status comes from the prerendered shell
  (`next/dist/build/templates/app-page-runtime.js`, the `x-nextjs-postponed`
  resume path), so the 404, 500 or 307 set in `app-render.js` never reaches
  the wire. Without script the visitor sees a blank page.
- With Cache Components off the statuses are real, but the pages are still
  empty without script.
- A request whose path matches no route answers 404 through
  `src/app/global-not-found.tsx` as real HTML.

A static root layout without the slug parameter therefore changes nothing,
and a server-side redirect to a non-route also answers 200.

## Options considered

1. Proxy lookup: `src/proxy.ts` checks the slug against the database and
   redirects a missing one to a non-route. Real 404, but the proxy would
   query the database on every renderer request, which
   `specs/system/security.md` rules out, and would need a cache.
2. Keep today's behavior and record the cause. Chosen.
3. A `<meta http-equiv="refresh">` from the not-found screen to a non-route.
   The first hop stays 200; little gained.
4. Cache Components off. Real statuses, blank pages without script, an
   app-wide rendering change. Rejected.

## Decision

The page renders the not-found and error screens itself, as real HTML with
`noindex`, and the status stays 200. `notFound()`, `redirect()` and thrown
errors are not used for these two screens. The no-script page post that fails
keeps its own path (a 303 to `?error=1`, which renders the error screen).

## Consequences

- A visitor, with or without script, always sees a real page with the
  error or not-found copy in both languages.
- Crawlers see a 200 with `noindex` instead of a 404; the renderer is never
  meant to be indexed, so nothing depends on the code.
- `generateStaticParams` keeps its placeholder slug, which resolves to the
  not-found screen; the renderer root layout keeps the slug parameter.
- Revisit when Next renders not-found and error pages on the server under
  Cache Components, or if the proxy is ever allowed a cached slug lookup.
- Admin pages call `connection()` in `pageSession` because
  `partialPrefetching` otherwise renders a session page a second time at
  request time, repeating its audit writes; the renderer keeps runtime
  prefetching.
