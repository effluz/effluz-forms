# Effluz forms design system

The concrete values and standards behind `specs/design.md`. Code consumes
`tokens.json`; people read `components.md` and `accessibility.md`.

## Using it

- Use semantic tokens in code. Brand tokens are inputs to the semantic
  layer, never used directly.
- If a design needs a value that is not a token, add the token here in a
  PR first, with its contrast annotation where it is a color.
- Components documented in `components.md` are the only components. A new
  component starts as a section there.

## Changing it

- Color changes update every contrast annotation in `tokens.json`; the
  design-system tests recompute them and fail under 4.5:1 for text pairs
  and 3:1 for UI pairs.
- Typography and spacing changes update `specs/design.md` tables in the
  same PR.
- Assets are replaced, never edited in place; keep the previous file until
  the replacement ships.

## Status

First pass. The wordmark SVG and the Poppins font files are not yet in
`assets/`; see `assets/README.md`.
