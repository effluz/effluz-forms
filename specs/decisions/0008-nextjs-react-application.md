# 0008. Next.js and React for the application

Status: accepted
Date: 2026-10-08

## Context

The forms need server-rendered, accessible, bilingual pages with file upload,
plus an authenticated admin page, served from one container. The team knows
React. Clean Architecture requires that the framework not leak into domain
and application code.

## Decision

Build the application with Next.js and React. The `app` container runs the
Next.js server. The `worker` container runs a plain Node entrypoint from the
same codebase and image that imports the application layer directly.

Framework code is confined to `presentation/` folders and the composition
root in `src/app/`. Route handlers and server actions parse input, call a use
case, and map the result. Domain, application and infrastructure code has no
React or Next.js import, enforced by a lint rule.

## Consequences

- One language and one build for pages, API boundary and worker.
- Use cases are testable and runnable from the worker without a web server.
- Next.js upgrades touch only presentation and the composition root.
- Server-side image re-encoding and multipart handling run inside the Next.js
  process. Upload limits in `system/media-storage.md` keep that bounded.
- The worker must not depend on Next.js build output. Its entrypoint is
  compiled separately within the same image.
