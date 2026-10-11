# 0022. The form model lives in the shared kernel

Status: accepted
Date: 2026-10-10

## Context

A module's `domain/` may import only its own domain and `src/shared/domain`.
The form model was a module, `form-model`, reachable only through its
application entry point, yet the domain of every consuming module
(`definitions`, `submissions`, `review`) is about form documents. Options
were: let module domains import `form-model`'s entry point as an exception;
move every rule that touches the form model up into application layers; or
promote the form model into the shared kernel.

## Decision

The form model moves to `src/shared/domain/form-model/`, with
`@/shared/domain/form-model` as its entry point. It is shared domain code:
every layer of every module may import it, and it may import only shared
domain code and third-party libraries that are not frameworks or Node core.

## Consequences

- Every layer imports `@/shared/domain/form-model`; no module lists
  `form-model` as a dependency and the module dependency graph loses a node.
- The form model has no application, infrastructure or presentation layer
  and no ports of its own. `FieldTypeRegistry` stays an in-code registry
  there.
- New field types, validation rules and logic operators are still added
  there and registered in each consumer, as `CLAUDE.md` describes.
- The layer rules are unchanged: the existing `shared-domain` boundary
  covers the new folder, and nothing in `shared/` imports a module.
