# Accessibility checklists

WCAG 2.2 AA is the floor. These checklists are run per PR that touches the
item and recorded in the PR description. Status: first pass, 2026-10-10.

## Every component

- Keyboard reachable and operable; visible focus with `color.focus.ring`.
- Accessible name that matches the visible label.
- States conveyed in text or ARIA, not color alone.
- Contrast: text 4.5:1, UI boundaries and icons 3:1, verified against the
  surface it sits on.
- Works at 200% text zoom and 400% page zoom without clipping.
- No motion under `prefers-reduced-motion: reduce` except progress steps.
- Readable in forced-colors mode: borders present, not only background.

## Forms (public renderer)

- One `<h1>` per page; headings in order.
- Every input labeled with `<label for>`; groups in `<fieldset>` and
  `<legend>`.
- Required stated in the legend text and `aria-required`.
- Errors: `aria-invalid`, message linked by `aria-describedby`, error
  summary with links, focus moved to summary heading, `role="alert"`.
- Help text before the control in reading order and linked.
- No time limits during filling; the 24-hour record limit is disclosed.
- File upload operable without drag and drop; status announced.
- Language of the page set with `lang`; the switch is a button with the
  target language name in that language.
- Target size 44 px on all controls.
- Autocomplete attributes on name, email, phone where the field is clearly
  that.

## Staff surfaces

- Skip link to main content.
- Drag and drop has a keyboard and menu equivalent; moves are announced.
- Tree, tabs, menus and dialogs follow the ARIA Authoring Practices
  patterns for keyboard behavior.
- Tables have header cells, captions or labelled regions, and `aria-sort`.
- Drawers and dialogs trap focus and return it on close.
- Live regions: polite for autosave and progress, assertive for conflicts
  and errors.
- Compare view marks insertions and deletions with semantics (`ins`,
  `del`) and shape, not only color.
- Dense rows keep 32 px minimum targets for pointer and 44 px on touch.

## Content

- Fixed copy in plain language, sentence case, no all-caps.
- Links describe their destination.
- Icons have text or `aria-label`; decorative icons `aria-hidden`.
- Images have alt text; header images require it in both languages.

## Testing before the first production deploy

- Automated: axe or equivalent on every e2e page; contrast checks on
  `tokens.json`.
- Manual: keyboard-only pass of the reference form and of building it;
  VoiceOver on iOS and one desktop screen reader; 400% zoom; reduced
  motion; forced colors. Results recorded in `specs/decisions/` as a note.
