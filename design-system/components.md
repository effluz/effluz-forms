# Component standards

Anatomy, states and rules for every component. Values reference
`tokens.json`. Surfaces: **public** (renderer) and **staff** (builder,
manager). Status: first pass, 2026-10-10.

Every interactive component implements these states: default, hover, focus
visible, active, disabled, loading. Inputs add invalid and read-only. Hover
never shifts layout. Focus uses `color.focus.ring` at `border.width.focus`
with a 2 px offset.

## Button

- Variants: primary, secondary, tertiary, destructive. One primary per view.
- Height 48 px public, 40 px staff; padding `space.4` horizontal; radius
  `radius.md`; label `font.size.*.button` at weight medium; optional leading
  icon 20 px.
- Full width below `breakpoint.sm` on public. Never full width on staff.
- Loading: label stays, spinner replaces the icon slot, button is disabled
  and announces "busy".
- Destructive appears only inside a confirmation dialog or drawer menu.
- Do: verbs ("Publish version 3"). Do not: "OK", "Yes", icon-only.

## Link

- Underlined in running text, `color.text.link`, hover `color.text.link.hover`
  keeping the underline. Visited is not distinguished.
- External links on staff surfaces show an outward icon and open in a new
  tab with `rel="noopener"`; public forms open staff-authored links the same
  way.

## Text input and textarea

- Height 48 px public, 40 px staff; padding `space.3`; radius `radius.md`;
  background `surface.card`; border 1 px `border.input`; focus adds 2 px
  `border.inputFocus` plus the ring.
- Label above, weight medium, `space.2` gap; help below the label in
  `text.muted`; error below the control in `text.error` with a 16 px icon.
- Invalid: border `border.error`, `aria-invalid`, message linked by
  `aria-describedby`.
- Read-only: `surface.subtle` background, no border change, cursor default.
- Textarea: minimum 3 rows, grows to 12, manual resize vertical only.
- Character counter: `text.muted`, right aligned, appears only with a max.

## Select

- Same box as text input, native `<select>`, chevron icon at the end in
  `text.muted`. Placeholder option disabled and selected by default.

## Radio and checkbox

- 24 px control, 2 px `border.input` border, radius full for radio and
  `radius.sm` for checkbox; checked fill `color.action.primary.bg` with a
  blush mark.
- Each option is a full-width row of minimum 44 px with the label; the whole
  row is the hit area; `space.2` between rows.
- Groups use `<fieldset>` and `<legend>`; the legend is styled as a label.

## Consent block

- `surface.card` with 1 px `border.input` border, radius `radius.md`,
  padding `space.4`; the consent text as legend in body size; a checkbox row
  below with the fixed label. Never pre-checked.

## File upload

- Dropzone is the native input's label styled as a dashed 2 px `border.input`
  box, radius `radius.md`, padding `space.5`, with the choose-files button
  as a secondary button inside. Dashed border becomes `border.inputFocus`
  on drag over.
- File rows: 56 px thumbnail at `radius.sm` or a film icon, name with
  middle truncation, size in `text.small`, progress bar 4 px full radius in
  `color.action.primary.bg` on `surface.subtle`, status text, Remove or
  Retry as tertiary buttons.

## Progress indicator

- Text "Page n of total" in `text.muted` and a 4 px bar, `surface.subtle`
  track, `color.action.primary.bg` fill, full radius, `role="progressbar"`.

## Card

- `surface.card`, 1 px `border.default`, radius `radius.md`, padding
  `space.5` public and `space.4` staff. No shadow. No nested cards.

## Badge

- Height 24 px, padding `space.2` horizontal, radius `radius.sm`, weight
  medium, small size. Variants map to functional colors plus neutral
  (`surface.subtle` with `text.default`). Always text; optional 16 px icon.
- Status badges: New neutral, Viewed neutral, Edited warning, Published
  success, Draft neutral, Published form success, Closed warning, Archived
  neutral.

## Tag (inline marker)

- Like a badge but 20 px tall and `text.small`; used for "Edited" on answers
  and "Machine translated" on texts. Never the only indicator of state.

## Alert and banner

- Full-width block, radius `radius.md`, padding `space.4`, functional
  background and foreground, a 20 px icon, a heading in weight medium, body
  text, optional action as a tertiary button. Banners at the top of a page
  are not dismissible when they report a system problem.

## Toast

- Bottom center on public, bottom right on staff; `surface.inverse` with
  `text.inverse`, radius `radius.md`, shadow `shadow.floating`; auto-dismiss
  after 6 seconds, pauses on hover and focus, `role="status"`. Never used
  for errors that need action.

## Dialog

- Centered, max width 560 px, radius `radius.lg`, `surface.card`, shadow
  `shadow.floating`, backdrop `rgba(55,37,73,0.4)`; heading, body, button
  row right aligned with secondary then primary; focus trapped, Esc closes
  unless destructive confirmation requires typing.

## Drawer

- Right side, width `size.drawerWidth`, full screen below `breakpoint.lg`,
  `surface.card`, shadow `shadow.floating`, header with heading, meta and
  close button, scrollable body, sticky footer for actions when present.

## Menu

- Anchored to its button, min width 200 px, radius `radius.md`, shadow,
  items 40 px tall, destructive items in `text.error` separated by a
  divider, keyboard navigable with arrows and type-ahead.

## Table (staff)

- Header row `surface.subtle`, label size weight medium; body rows 48 px
  minimum, zebra off, `border.default` row dividers; `space.3` cell
  padding; numeric columns right aligned with tabular numbers; row hover
  `surface.subtle`; selected row `surface.selected`.
- Sortable headers are buttons with sort icon and `aria-sort`.
- On narrow widths tables become stacked cards with the same data.

## Tabs

- Underline style: 2 px `color.action.primary.bg` under the active tab,
  labels in weight medium, counts in `text.muted`. `role="tablist"` with
  arrow key navigation.

## Chip (filter)

- 32 px tall, radius `radius.sm`, `surface.subtle` default, `surface.selected`
  with `text.default` when active, count in `text.muted`; toggles with
  `aria-pressed`.

## Lightbox

- Backdrop `rgba(55,37,73,0.92)`; image or video centered; controls in
  `text.inverse`; previous, next, download and close buttons 44 px; caption
  with "Photo n of total" and the Dropbox path.

## Skeleton

- `surface.subtle` blocks with a 1.2 s opacity pulse, disabled under
  reduced motion. Used for lists and the drawer only.

## Wordmark

- SVG, `color.text.default` on light surfaces, `text.inverse` on inverse;
  height 24 px public, 20 px staff; clear space equal to height.

## Header image (public)

- Full card width, aspect between 3:1 and 2:1, object-fit cover centered,
  radius `radius.md`, alt text from the version. Loads lazily; the title
  never waits for it.
