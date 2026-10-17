# Design

Cross-surface design principles and visual direction. Status: first pass,
2026-10-10. Concrete values live in `design-system/`; this file explains
the choices and the rules for using them. Surface-specific behavior stays
in `ui-ux/`.

## Who we design for

Two audiences, one system.

- **Families** filling a form on a phone, often about a hard experience.
  They need calm, clarity, and the feeling that someone careful is on the
  other side.
- **Effluz staff** building forms and reviewing hundreds of submissions on
  a laptop. They need speed, density and certainty about what they are
  looking at.

Both get the same palette, type and components. The public surface is warm
and spacious; the staff surfaces are cooler and denser. Nothing else differs.

## Principles

1. **Quiet confidence.** Color is used to orient, not to decorate. One
   primary action per screen. No exclamation marks in fixed copy.
2. **Native first.** Real inputs, real buttons, real links. We style what
   the platform provides before building anything custom.
3. **Readable before beautiful.** Contrast, size and spacing win every
   trade-off against brand expression.
4. **Consistent by construction.** Staff cannot change colors, type or
   layout. Developers use tokens, never raw values.
5. **Light only, for now.** One theme, structured so a dark theme is a
   token swap later.

## Voice in the interface

- Plain words, short sentences, second person. Spanish uses `tú`.
- Say what happens next. "Your answers were sent" beats "Success".
- Never blame. "We could not read this file" instead of "Invalid file".
- No jargon in public copy: "link name" not "slug", "files" not "media".
- Staff copy may use the model's terms (version, field, status) because
  staff learn them once.

## Color

Brand values come from effluz.com. Semantic tokens map them to roles; code
uses only the semantic layer.

### Brand palette

| Name | Hex | On white | Role |
|---|---|---|---|
| ink | `#1A1423` | 18.0:1 | Body text and headings on light surfaces |
| plum | `#372549` | 13.8:1 | Primary actions, focus borders, links, inverse surfaces |
| berry | `#6C344E` | 9.4:1 | Secondary text, hover states of plum |
| mauve | `#774C60` | 7.0:1 | Muted text, borders on light surfaces |
| rose | `#B75D69` | 4.4:1 | Accent only: focus ring, links on light surfaces at 18 px or bold, selected states, highlights. **Never body text, never a white-label button** |
| peach | `#EACDC2` | | Selected and hover fills on light surfaces |
| blush | `#FFF3EF` | | Public page background; button text on plum |
| lilac | `#F4F3FA` | | Staff page background |
| lavender | `#EFF0F5` | | Table stripes, disabled fills, dividers at 100% |
| white | `#FFFFFF` | | Cards, inputs, panels |

### Functional colors

The brand has no green or amber, so functional colors are added and kept
distinct from rose so an error never looks like an accent.

| Role | Foreground | Background | Use |
|---|---|---|---|
| error | `#9B1C1C` (7.4:1 on white) | `#FBECEC` | Validation messages, destructive buttons, dead jobs |
| warning | `#7A4B00` (7.5:1 on white) | `#FFF4D6` | Suggestions, retention warnings, stale states |
| success | `#1F6B4A` (6.9:1 on white) | `#E6F2EC` | Uploaded, saved, published |
| info | plum | lavender | Neutral notices |

### Rules

- Text is ink on light surfaces, blush on plum surfaces. Secondary text is
  berry, muted text is mauve, never a transparent ink.
- Rose appears at most once per view as an accent, plus focus rings.
- Status is conveyed by text and icon together; color is reinforcement.
- Gradients, transparency overlays and shadows carry no meaning.
- Charts do not exist in the first release; if they come, they use the
  `dataviz` guidance with this palette's lightness order.

## Typography

Poppins, self-hosted Latin subset, weights 400, 500 and 600, `font-display:
swap`, with a system sans fallback that matches x-height closely to limit
layout shift.

| Role | Public | Staff | Weight | Line height |
|---|---|---|---|---|
| Display (form title) | 28 / 32 px | 24 px | 600 | 1.2 |
| Heading (page, section) | 22 px | 18 px | 600 | 1.3 |
| Label | 16 px | 14 px | 500 | 1.4 |
| Body | 17 px | 15 px | 400 | 1.6 |
| Small (help, meta) | 15 px | 13 px | 400 | 1.5 |
| Button | 16 px | 14 px | 500 | 1 |

Rules: minimum 16 px for any input on the public surface so phones do not
zoom. Measure for running text between 45 and 75 characters. Headings in
sentence case. No all-caps except two-letter language tags. Letter spacing
default; Poppins needs none. Numbers in tables use tabular figures.

## Spacing and layout

Base unit 4 px. Scale: 4, 8, 12, 16, 24, 32, 48, 64.

| | Public | Staff |
|---|---|---|
| Density | Comfortable: 24 px between fields, 16 px inside groups | Compact: 16 px between controls, 8 px inside groups, 12 px table cell padding |
| Content width | 640 px single column | Fluid, three-column shell from 1280 px |
| Page gutters | 16 px to 480 px, 24 px above | 16 px, 24 px from 768 px |
| Touch targets | 44 px minimum | 44 px minimum on touch, 32 px minimum for pointer-only dense rows |

Vertical rhythm comes from the scale, not from component-specific margins.
Components have no outer margin; layouts place them.

## Shape and elevation

| Element | Radius |
|---|---|
| Inputs, buttons, cards, panels | 12 px |
| Chips, badges, small controls | 8 px |
| Thumbnails | 8 px |
| Dialogs, drawers | 16 px on exposed corners |
| Avatars, radio, progress bar ends | full |

Elevation uses borders first. Cards on a tinted page have a 1 px border in
lavender and no shadow. Only floating layers (dialog, drawer, menu, toast)
have a shadow: `0 8px 24px rgba(55, 37, 73, 0.16)`. Nothing else casts one.

## Components

Standards for every component are in `design-system/components.md`. The
cross-cutting rules:

- **States** every interactive component defines: default, hover, focus
  visible, active, disabled, loading, and for inputs invalid and read-only.
  Hover never changes layout. Disabled keeps 3:1 contrast against its
  surface and is explained nearby when the reason is not obvious.
- **Focus ring**: 2 px rose outline with 2 px offset on light surfaces, 2 px
  blush outline on plum surfaces. Never removed, never replaced by a color
  change alone.
- **Buttons**: primary is plum with blush text; secondary is white with a
  plum border and plum text; tertiary is plum text only with underline on
  hover; destructive is error red with white text and appears only inside a
  confirmation. One primary per view. Buttons have verbs.
- **Inputs**: white, 1 px mauve border, 2 px plum border on focus in
  addition to the ring, error border in error red with the message below.
  Placeholder is mauve and is never the only label.
- **Links**: underlined in body text, plum, berry on hover. Links in staff
  tables may drop the underline until hover because the context is a table.
- **Icons**: one outline set at 24 px, 1.5 px stroke, currentColor. Always
  paired with text or an accessible name. No icon-only primary actions.

## Imagery

- **Wordmark.** The Effluz wordmark in plum on light surfaces, blush on
  plum, as SVG, minimum height 24 px, clear space equal to its height. It
  never links on public forms and links to home on staff surfaces.
- **Header image.** A form may carry one optional header image, set by
  staff in the builder with required alt text in each language. It renders
  on page 1 only, full card width, 3:1 to 2:1 aspect, cropped centered,
  12 px radius. The system re-encodes it to WebP at 1600 px wide, strips
  metadata, and caps it at 300 KB. No text in images; the title is text.
- No stock photography, no illustration sets, no decorative shapes.

## Motion

Functional only. Durations: 120 ms for hover and focus, 160 ms for toasts
and progress, 200 ms for drawer, dialog and page transitions. Easing
`cubic-bezier(0.2, 0, 0, 1)`. Under `prefers-reduced-motion: reduce`, all
transitions are instant except progress bar fill, which becomes a step.
Nothing moves without a cause the user produced.

## Accessibility commitments

WCAG 2.2 AA is the floor. Design-level commitments beyond it:

- Every text and surface pair in `design-system/tokens.json` is listed with
  its contrast ratio and must stay at 4.5:1 for text, 3:1 for UI.
- Target size 44 px on anything a finger might touch.
- Pages work at 400% zoom and 320 px width without horizontal scroll.
- Color is never the only carrier of meaning; every status has text.
- Reduced motion, forced colors and high contrast modes are tested before
  the first production deploy.

## Token structure

Three layers, named so the dark theme later changes only the second:

1. **Brand**: `brand.ink`, `brand.plum`, `brand.blush`, raw values. Never
   used in code.
2. **Semantic**: `color.text.default`, `color.surface.page.public`,
   `color.action.primary.bg`, `space.4`, `radius.md`, `font.size.body`.
   This is what components and layouts use.
3. **Component**: only where a component needs a value no semantic token
   covers, for example `button.primary.bg` aliases `color.action.primary.bg`.

Tokens live in `design-system/tokens.json` as the single source and are
generated into platform formats by the build. A token that is not in that
file does not exist.

## What `design-system/` contains

| Path | Content |
|---|---|
| `README.md` | How to use and change the system |
| `tokens.json` | All tokens, with contrast annotations |
| `components.md` | Per-component anatomy, states, sizes, do and do not |
| `accessibility.md` | Checklists per component class and per surface |
| `assets/` | Wordmark SVGs, Poppins font files with license, favicon set |
