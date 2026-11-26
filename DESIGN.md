---
name: Projammr
description: A dim, precise listening room for a producer and their collaborators, lit by the music's own artwork.
colors:
  paper: "oklch(0.995 0 0)"
  paper-sunk: "oklch(0.965 0 0)"
  ink: "oklch(0.09 0 0)"
  ink-soft: "oklch(0.44 0 0)"
  ink-faint: "oklch(0.63 0 0)"
  rule: "oklch(0.89 0 0)"
  rule-strong: "oklch(0.78 0 0)"
  glass: "oklch(1 0 0 / 62%)"
  glass-edge: "oklch(0.89 0 0)"
  paper-dark: "oklch(0.135 0 0)"
  paper-sunk-dark: "oklch(0.105 0 0)"
  ink-dark: "oklch(0.99 0 0)"
  ink-soft-dark: "oklch(0.68 0 0)"
  ink-faint-dark: "oklch(0.48 0 0)"
  rule-dark: "oklch(1 0 0 / 11%)"
  rule-strong-dark: "oklch(1 0 0 / 22%)"
  glass-dark: "oklch(0.2 0 0 / 55%)"
  art-fallback: "oklch(0.45 0 0)"
  art-glow-fallback: "oklch(0.65 0 0)"
  art-fallback-dark: "oklch(0.8 0 0)"
  art-glow-fallback-dark: "oklch(0.38 0 0)"
  warn: "oklch(0.58 0.16 65)"
  danger: "oklch(0.52 0.22 27)"
  warn-dark: "oklch(0.78 0.15 70)"
  danger-dark: "oklch(0.7 0.19 22)"
typography:
  display:
    fontFamily: "Redaction 35, Georgia, serif"
    fontSize: "clamp(2.5rem, 6.5vw, 5.5rem)"
    fontWeight: 400
    lineHeight: 1
  headline:
    fontFamily: "Redaction 35, Georgia, serif"
    fontSize: "2.5rem"
    fontWeight: 400
    lineHeight: 1
  title:
    fontFamily: "Redaction 35, Georgia, serif"
    fontSize: "1.75rem"
    fontWeight: 400
    lineHeight: 1.1
  stat:
    fontFamily: "Redaction, Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1
  lead:
    fontFamily: "Spline Sans Mono, ui-monospace, monospace"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "Spline Sans Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  prose:
    fontFamily: "Spline Sans Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.75
  small:
    fontFamily: "Spline Sans Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
  section-label:
    fontFamily: "Departure Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "0.12em"
  label:
    fontFamily: "Departure Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0.1em"
  claim:
    fontFamily: "Spline Sans Mono, ui-monospace, monospace"
    fontSize: "2.5rem"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.02em"
rounded:
  sm: "0.27rem"
  md: "0.36rem"
  lg: "0.45rem"
  xl: "0.63rem"
  full: "9999px"
spacing:
  gutter: "clamp(1rem, 3vw, 2.5rem)"
  section: "2.75rem"
  rail-block: "1.125rem"
  column: "52rem"
  column-wide: "74rem"
  rail: "20rem"
  rail-wide: "24rem"
  measure: "68ch"
  page: "76rem"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.small}"
    rounded: "{rounded.md}"
    height: "1.75rem"
    padding: "0 0.5rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.small}"
    rounded: "{rounded.md}"
    height: "1.75rem"
    padding: "0 0.5rem"
  button-destructive:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    typography: "{typography.small}"
    rounded: "{rounded.md}"
    height: "1.75rem"
    padding: "0 0.5rem"
  icon-button-play:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    size: "2rem"
  icon-button-hero:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    size: "4rem"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.small}"
    rounded: "{rounded.md}"
    height: "1.75rem"
    padding: "0.125rem 0.5rem"
  status-pill:
    textColor: "{colors.paper}"
    typography: "{typography.small}"
    rounded: "{rounded.full}"
    padding: "0.375rem 0.875rem 0.375rem 0.4375rem"
  status-block:
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    width: "100%"
    padding: "0.625rem 0.875rem"
  overlay:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  rail:
    backgroundColor: "{colors.glass}"
    width: "{spacing.rail}"
  sidebar:
    backgroundColor: "{colors.paper-sunk}"
    textColor: "{colors.ink-soft}"
  site-action-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "2.5rem"
    padding: "0 1rem"
  site-action-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "2.5rem"
    padding: "0 1rem"
---

# Design System: Projammr

The canonical reference for how Projammr looks and why, across all four surfaces: the web client
(`apps/client`), dit's menu bar panel (`apps/dit-app`), the public share page (`apps/client/src/app/share`) and
the public website's marketing pages (`apps/web`).
It describes the system **as implemented** in `packages/ui/src/styles/globals.css`,
`apps/client/src/app/layout.tsx`, `packages/ui/src/lib/shell.ts` and the components named below. When code and
this document disagree, fix one of them in the same change. Product truth (users, positioning, principles) lives
in `PRODUCT.md`; this file is strictly visual.

## Overview

**Creative North Star: "The Listening Room"**

Projammr is a dim room built around the record that is playing. The cover art is the only light source: blurred
into the masthead, thrown across the page as a faint wash, tinting the player and the share page, and moving with
the audio on the now-playing sheet. Everything else is the room's furniture: true-neutral paper and ink, fine
grain, glass, and hairlines. It sits back so the music carries the page.

The furniture is precise. Data is set in a monospace face, labels are tracked caps in a pixel mono, and readouts
behave like studio gear: a loudness meter with a caret and a dotted reference line, a status dot that fills like
a pie, a waveform of square bars. The gear is modern and professional, never literal hardware. It feels warm
rather than clinical because the display face is a halftone serif, the page carries grain, and the art drifts
slowly behind the title.

Boldness is spent in one place per page (the masthead on entity pages, the art field on the share page and the
now-playing sheet); every other surface is quieter than stock shadcn. Structure encodes information: a rule, a
heading, a chip or a badge appears because it says something.

**Mood:** dim and immersive, precise, warm.

**Rejected looks.** Projammr is not a generic SaaS dashboard (cards in grids, KPI tiles, brand-blue buttons,
rounded shadowed panels), not a skeuomorphic DAW (literal knobs, brushed metal, fake LEDs), not a streaming-app
clone (green accents, huge rounded art tiles, carousel shelves), and not a neon "producer" aesthetic (purple
gradients, glow, synthwave).

**Key Characteristics:**

- Artwork is the only source of hue; with no artwork the room is pure grayscale.
- True-neutral paper and ink with a wide range, in light and dark themes.
- Four self-hosted faces, each with exactly one job; monospace is the document default.
- Flat pages; depth comes from blurred art, the wash, grain and glass. Only overlays lift.
- Studio-gear readouts (meters, carets, ticks, pies, waveforms) instead of charts and cards.
- One orchestrated page-load reveal; ambient motion only where the art lives; everything respects
  `prefers-reduced-motion`.
- One language across the client, dit, the share page and the public website.

**Principles.**

1. **Spend boldness in one place.** The masthead is the loud element on every entity page. The rail, tables,
   lists, forms and settings are quieter than default shadcn, not louder.
2. **Artwork is the only source of colour.** See Colors.
3. **Structure encodes information.** No decorative cards, no `Separator` stacks, no equal-weight sections.
4. **One table treatment.** Tracks, collections and sessions share the same row shape, pinned identity column,
   artwork thumb, hover-revealed play and chip statuses. Only the columns differ.
5. **Motion answers something.** One authored page arrival, a scroll-driven masthead, plus motion that
   responds to playback or a user action. Nothing decorates.
6. **Server owns the data, the client owns the look.** The page accent is extracted on the server and stored on
   the image row; the client only maps it to CSS.

## Colors

A true-neutral room with one borrowed hue: whatever the artwork brings.

### Primary

- **Artwork Accent** (`--art`; grayscale fallbacks `{colors.art-fallback}` light, `{colors.art-fallback-dark}`
  dark): the hue of the cover in this page's hierarchy, normalised to a fixed lightness per theme. It marks links,
  active states, the played part of a waveform, the focus ring, meter fills and ticks, checklist ticks, the
  blockquote rule, and additions in a diff.
- **Artwork Glow** (`--art-glow`; fallbacks `{colors.art-glow-fallback}` and `{colors.art-glow-fallback-dark}`):
  the softer companion used for washes and gradients.
- `--art-ink` exists (`oklch(0.3 0 0)` light, `oklch(0.85 0 0)` dark) and is reserved, unused.
- `--art-image` is the cover's `url()` (default `none`) for the masthead and thumbs.

**How the accent is made.** `apps/server/src/lib/palette.ts` extracts it at upload time and stores it on the
`images` row as `accentHue`, `accentChroma` and `accentHex`. `accentHue = null` means the image has no usable
chroma and the page stays grayscale. `packages/ui/src/lib/art.ts` maps the hue and chroma to CSS, and the
client's `apps/client/src/lib/art.ts` `artVarsFromArtwork` hands it an artwork row:

- `accentFromHue(hue, chroma)` fixes lightness per theme so contrast is predictable whatever the cover looked like:
  light `oklch(0.55 min(C×1.3, 0.19) H)`, dark `oklch(0.78 min(C×1.25, 0.17) H)`, glow light
  `oklch(0.72 min(C, 0.14) H)`, glow dark `oklch(0.45 min(C, 0.14) H)`.
- `artVarsFromAccent(hue, chroma, image?)` returns inline vars `--art-light`, `--art-glow-light`, `--art-dark`,
  `--art-glow-dark` and `--art-image`, grayscale when the hue is null; the client's `artVarsFromArtwork(artwork)` is
  the same for an artwork row.
- The stylesheet resolves the pair for the active theme (`[style*="--art-light"] { --art: var(--art-light) }` and
  the `.dark` equivalent). Components read `text-art`, `bg-art`, `border-art` and `bg-art-glow`.

**Fallback chain** (`resolveArtworkChains` in `apps/server/src/db/queries/artwork.ts`): a page uses artwork if anything in its hierarchy has some.

- project → own image
- collection → own → project
- track → own → first collection → project
- session → parent track → that track's first collection → parent collection → project

**Who carries art.** `ArtProvider` sets the vars on an entity page's wrapper. `ArtSwatch` sets them on a 10px
swatch (sidebar rows, palette results). The music player sets its own from the **playing** track
(`useCurrentArt`), which is not necessarily the page's artwork. The share page sets them from the shared entity
with `artVarsFromAccent`.

### Secondary: semantic

- **Amber Warning** (`{colors.warn}`, `{colors.warn-dark}` dark): warnings, and a sample Live cannot find.
- **Signal Red** (`{colors.danger}`, `{colors.danger-dark}` dark): destructive actions, errors, cancel.

### Tertiary: user colour

Status and label colours come from the user's own pickers (`colourHex`). They appear at **full strength** where
there is one of them (masthead byline pill, rail status block) and as a **quiet tinted chip** (18% fill, 35%
border) in tables and menus, where a column of six at full strength would fight the artwork. Text on a user colour
always goes through `getContrastColour()` (`lib/css-utils.ts`). **Priority levels** are user colours too: each
level of a project's scale carries the colour its editor picked (a new project's five start in neutral greys),
and `PriorityBadge` wears it as the same tinted chip a status wears in a table, as a flag (no pie), its label in
the ambient ink. It is the chip everywhere, the track rail included, since a priority is a fact about the row
rather than the state it is in. Every level renders the same way: nothing is special-cased by name or rank, the
default level included, and the scale's order lives in the menus that list it.

**Track colours** are user colours too: the colour each track has in the DAW, read by dit and stored on
the session's structure as `#rrggbb` (`TrackRow.color`). They are the DAW's exact colours, so a producer finds a
track by the colour they gave it, and they only ever appear as small marks: the 6px `TrackSwatch` beside a row
(smaller than the 10px `ArtSwatch`), the save diff skyline's bars (at most 8px wide) and its 1–2px group spans.
Never as a fill behind text. Each carries a hairline ring (`color-mix(in oklab, var(--ink) 10–14%, transparent)`)
so a pale one holds its edge on paper. A track with no colour is an empty ring, or an `--ink-faint` bar.

### Neutral: the spine

True neutral with a wide range, blacker blacks and whiter whites than stock shadcn, so artwork is the only thing
with a cast. Light values are on `:root`, dark values on `.dark` (next-themes sets the class).

- **Paper** (`{colors.paper}`, `{colors.paper-dark}` dark): the page, overlays, pinned table cells.
- **Sunk Paper** (`{colors.paper-sunk}`, `{colors.paper-sunk-dark}` dark): the sidebar, the stacked rail grid,
  recessed wells.
- **Ink** (`{colors.ink}`, `{colors.ink-dark}` dark): titles, values, primary buttons, emphasis.
- **Soft Ink** (`{colors.ink-soft}`, `{colors.ink-soft-dark}` dark): body copy in cells and notes, secondary
  labels, utility icons.
- **Faint Ink** (`{colors.ink-faint}`, `{colors.ink-faint-dark}` dark): placeholders, "Not set", removals in a
  diff, menu group labels.
- **Hairline** (`{colors.rule}`, `{colors.rule-dark}` dark): table rows, rail seams, input borders.
- **Strong Hairline** (`{colors.rule-strong}`, `{colors.rule-strong-dark}` dark): overlay edges, emphasis outlines.
- **Glass** (`{colors.glass}`, `{colors.glass-dark}` dark) with **Glass Edge** (`{colors.glass-edge}`, the dark
  edge matches `{colors.rule-dark}`): the rail, the player card and popovers over art.

Every shadcn token (`--background`, `--foreground`, `--muted-foreground`, `--border`, `--ring`, `--sidebar-*`) is
an alias onto this spine, so untouched shadcn components pick up the palette. Tinted surfaces are
`color-mix(in oklab, var(--ink) N%, transparent)` over paper: hover plates 4%, sidebar accent 8% light and 12%
dark, dark secondary 14%.

### Named Rules

**The Borrowed Light Rule.** There is no brand hue. A page with no artwork anywhere in its fallback chain is pure
grayscale.[^accent-fallback] The only non-artwork colours are user status, label and priority-level colours, the
DAW's own track colours, `--warn` and `--danger`.

[^accent-fallback]:
    Unless the viewer has picked an accent for such pages. `--art-fallback` on `<html>` (any
    colour) stands in for the grayscale fallback, set at the lightness and chroma cap a cover's accent takes
    (`ACCENT_TONES` in `lib/art.ts`), so it reads at the same contrast. It is a fallback only: it tints what no
    artwork reaches, and a cover's inline pair always wins wherever there is one. It is the viewer's own colour
    for their own room, never a product hue. See Appearance.

**The No Success Colour Rule.** There is deliberately no green. Confirm actions are ink or art; a diff is not a
warning, so it never uses `--warn` or `--danger`.

**The Spine Names Rule.** New code uses the spine names directly (`text-ink-soft`, not `text-muted-foreground`).
The shadcn aliases exist for the library, not for us.

**The Server Extracts Rule.** Never compute the page accent from pixels in the browser. The one exception is the
now-playing lava field, where `lib/cover-palette.ts` samples several distinct colours from the cover on a small
canvas, because the server stores one accent and the field needs a handful.

## Typography

**Display Font:** Redaction 35 (with Georgia, serif)
**Small Display Font:** Redaction 0, the clean cut (with Georgia, serif)
**Label Font:** Departure Mono (with ui-monospace)
**Body Font:** Spline Sans Mono 400, 500 and 600 (with ui-monospace)

**Character:** a halftone serif stamped over monospace data. The display face's printed bite gives the room its
warmth; the two mono faces give it the precision of a readout. All four are self-hosted, with no external font
requests: `next/font/local` in `apps/client/src/app/layout.tsx` loads `apps/client/public/fonts/`, and
`packages/ui/src/styles/fonts.css` serves a second copy from `packages/ui/src/styles/fonts/` to the Electron
renderer.

### Hierarchy

Each role maps to a utility and a CSS variable. Sizes follow a 1.25 ratio from a 0.875rem body.

- **Display** (`{typography.display}`; `font-heading`, `text-display`): the masthead `<h1>` only. The halftone bite
  is the point; never use it small.
- **Headline** (`{typography.headline}`; `text-title`): a compact page title (`PageHead`, `Masthead compact`, and
  the masthead on phones).
- **Title** (`{typography.title}`; `text-subtitle`): headings on pages with no entity behind them (sign-in, invite).
- **Stat** (`{typography.stat}`; `font-display-clean`, `text-section`): the one stat figure in the rail
  (`LoudnessReading`) and the sidebar brand, where halftone would read as noise.
- **Lead** (`{typography.lead}`; `text-lead`): emphasised body.
- **Body** (`{typography.body}`; `font-mono`, `text-body`): the document default (`font-mono` on `<html>`), table
  cells, bylines. Most elements need no font class.
- **Prose** (`{typography.prose}`): notes and lyrics inside `.doc`, capped at the `{spacing.measure}` measure.
- **Small** (`{typography.small}`; `text-small`): subheads, secondary body, comment bodies.
- **Section label** (`{typography.section-label}`; `SECTION_TITLE`): uppercase section heads rendered by
  `SectionHead` and `CollapsibleSection`.
- **Label** (`{typography.label}`; `LABEL`, `text-micro`): uppercase eyebrows, rail labels, table headers, chips,
  captions, timestamps. Tracking runs 0.08em to 0.12em by context.

Shared class strings for the recurring label shapes live in `packages/ui/src/lib/shell.ts`: `LABEL` is the base;
`EYEBROW` (masthead eyebrow), `SIDEBAR_EYEBROW` and `RailLabel` add their own spacing; `SECTION_TITLE` is the same
shape at section scale. Overlays use `OVERLAY_TITLE` (the section-label shape in ink) and `MENU_LABEL` (the label
shape in faint ink) from `packages/ui/src/lib/overlay.ts`.

### Named Rules

**The One Job Rule.** Each face has exactly one job. Redaction 35 is only the page `<h1>`; Departure Mono is only
labels, always tracked caps and never prose; Spline Sans Mono is everything else.

**The Scale Only Rule.** Use `text-micro`, `text-small`, `text-body`, `text-lead`, `text-section`, `text-subtitle`,
`text-title` and `text-display`. Never `text-xs`, `text-sm`, `text-lg` or arbitrary `text-[…]` sizes;
`text-micro` is the floor.

## Layout

A centred reading column with a glass rail beside it on desktop, collapsing to one column with the rail between the
title and the content on narrower screens.

### Tokens

| Token                                     | Value                                                | Notes                                                                       |
| ----------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| `--column`                                | `{spacing.column}` (`{spacing.column-wide}` ≥1800px) | content measure; must be narrower than its container or centring is a no-op |
| `--rail`                                  | `{spacing.rail}` (`{spacing.rail-wide}` ≥1800px)     | right rail width                                                            |
| `--gutter`                                | `{spacing.gutter}`                                   | page padding                                                                |
| `--measure`                               | `{spacing.measure}`                                  | prose line length (`.doc`)                                                  |
| `--menubar`                               | 0rem                                                 | app chrome above the canvas; there is none                                  |
| `--player-card`                           | 8.5rem                                               | height reserved for the music player card                                   |
| `--radius`                                | `{rounded.lg}`                                       | base; `--radius-sm…4xl` derive from it                                      |
| `--density`                               | 1                                                    | factor on the vertical padding of table cells and `Row`                     |
| `--masthead-band` / `--masthead-head`     | 82vh / 50vh (52vh / 42vh on phones)                  | an entity masthead's art band and its header's floor                        |
| `--tabbar-height` / `--miniplayer-height` | 3.5rem / 4rem                                        | phone dock rows                                                             |

Sections on a page are separated by `{spacing.section}` (`gap-11`) from the page's flex gap, never by margins on
sections. Rail blocks are separated by `{spacing.rail-block}` and a hairline.

### Class constants

Split across `packages/ui/src/lib/shell.ts` (`COLUMN`, `PAGE`, `PAGE_WIDE`, the label shapes) and
`apps/client/src/components/layout/shell.ts` (`CANVAS`, `BODY`, `SPLIT`, which need an entity page's rail and
`--column`, so they stay in the client):

| Constant             | Purpose                                                                                                                                                                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CANVAS`             | entity-page grid `[minmax(0,1fr) var(--rail)]` with named areas `'head rail' 'body rail'`, `isolate`, `overflow-x-clip` (so masthead blur never bleeds into the sidebar); ≤1180px one column with areas `'head' 'rail' 'body'`. The `ArtProvider` wrapper is also the scroll container. |
| `BODY`               | the content column below the masthead (area `body`): `flex-col gap-11 px-(--gutter) pb-11`, children capped at `--column` and centred                                                                                                                                                   |
| `MASTHEAD_AREA`      | the masthead's cell (area `head`), passed to `Masthead` as `className`                                                                                                                                                                                                                  |
| `COLUMN`             | `mx-auto w-full max-w-(--column)`                                                                                                                                                                                                                                                       |
| `SPLIT`              | notes beside artwork `[minmax(0,1fr) 14rem]`; one column ≤1180px                                                                                                                                                                                                                        |
| `PAGE` / `PAGE_WIDE` | non-entity pages (lists, forms, settings, profile); `PAGE_WIDE` opts out of the reading measure for tables                                                                                                                                                                              |

### Entity page anatomy

Every entity page (`modules/{project,collection,track,session}/page.tsx`) is composed the same way. Masthead, body
and rail are direct grid children of the canvas and take named areas, so the rail sits beside the content on a
desktop and between the title and the content on a phone with no change to the markup order:

```
ArtProvider image={resolveArtwork(…)}        ← arrival root + art vars + scroll container
├─ MastheadArt · MastheadScrim                ← absolute, behind everything
├─ Masthead        (area head)  crumbs · eyebrow · title (InlineTitleEditor) · byline · [player row]
├─ BODY            (area body)  sections in this order:
│    notes (SPLIT with artwork) → primary table → relations/links → attachments
│    → comments → activity
└─ RightSideBlur   (area rail)  ← RailColumn > Rail (sticky glass)
     RailIdentity → RailBlock… (status, progress, property editors, grid pairs)
```

**Masthead.** `min-h-(--masthead-head)` (50vh, 42vh on phones), content bottom-aligned inside `COLUMN`. The art
and scrim are siblings of the columns, not children of the header, so the blur can run under the rail (see
Elevation & Depth).

**Rail.** Two elements, kept separate for z-index scoping. `RailColumn` (`#rightside`, `relative z-3`) is the grid
track and runs the full page height because `CANVAS` rows size to content. `Rail` (`.rail`) is `sticky top-0`,
`h-[calc(100vh-var(--menubar))]`, `overflow-y-auto`, and carries the glass.

**Share page.** Outside the app shell: no sidebar, no rail. The room's `ArtProvider` fills the page behind
everything with the cover as an art field and is the scroll container; the page is the entity masthead's grammar
without its chrome. First the masthead (an eyebrow of facts, the title, a byline, the owner's description, then the
play band: the control, the waveform that plays and scrubs, the timecode); then, in one `COLUMN`, the tracklist
(hairline rows, drawn only for two or more tracks; the current row wears a band that travels to the next), the
thread of timestamped comments the share exists to collect, and the footer. Type over the cover takes `on-art` /
`on-art-soft`; without artwork the field is grayscale and the type keeps its plain colours.

**Public website.** Outside the app shell, with no sidebar, rail or player: a masthead, then a run of bands, each
capped at `{spacing.page}` and centred. Its anatomy and breakpoints are in Components → Public website.

**Commit ruler (the meter's second shape: lanes).** `CommitRuler` (`packages/ui/src/components/session-structure/commit-ruler.tsx`)
is the same ruler over a `timeRuler` preset (epoch milliseconds, five evenly spaced numbered stops, `positionOf` for
every mark) instead of a measurement domain, and it stacks: one hairline lane per machine, busiest first, each save a
faint 1px ink tick, each commit a 10px `--art` dot, a checkpoint a lighter 8px `art/35` dot, the axis numerals under
the last lane. Hover names a mark (title); a brush is an `art/15` band. A mark that is an end of the open compare, or
the anchor of a pending one, takes a 2px ink ring. It is one tab stop (a toolbar): arrows, Home and End move between
marks, Enter sets From then To, Esc clears. Under `coarse:` every mark's hit area is 44px and the lanes grow to match;
under `phone:` the lanes collapse into one track with no machine names. Scrolling to a row is instant under reduced
motion.

### Breakpoints

| Width              | Behaviour                                                                                                                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ≥1800px            | `--column` 74rem, `--rail` 24rem                                                                                                                                                                                                                           |
| 1181–1799px        | default: sticky glass rail, centred column                                                                                                                                                                                                                 |
| ≤1180px (`stack:`) | `CANVAS` and `SPLIT` collapse to one column; areas reorder to `'head' 'rail' 'body'`; `Rail` unsticks into an `auto-fit minmax(10rem,1fr)` metadata grid on `bg-paper-sunk`; `RailIdentity` hidden; rail-block hairlines dropped                           |
| <768px (`phone:`)  | masthead 42vh, title drops to `text-title`; `BODY` gap and bottom pad 8; rail blocks past `collapseAfter` fold behind a "More details" toggle (`RailMore`); art 52vh with 48px bleed, blur 32px; the sidebar is absent; the player collapses into the dock |

Tables keep all their real columns at every width and scroll horizontally inside `TableScroll` with the identity
column pinned.

`stack:` and `phone:` are custom variants in `packages/ui` globals, so a component says which layout change it is
making rather than restating a pixel width. `phone:` sits on Tailwind's `md` floor, which is also where
`useIsMobile` switches (`MOBILE_BREAKPOINT` in `hooks/use-mobile.ts`), so there is exactly one phone tier. The two
token overrides that cannot be a utility (the ultrawide `--column`/`--rail` step and the phone `--art-blur` step)
stay as raw `@media` in the stylesheet.

A piece of gear that is set at several widths lays itself out by **container query** instead, against its own
width rather than the viewport's: the save diff card is `@container/save-diff` (its readouts go to two columns at
`@lg`) and its skyline is `@container/skyline` (a narrow group's name shows from `xl`), because the same card sits
in the 34rem hero column of the site, a 52–74rem entity column and a phone. A container query never stands in for
`stack:` or `phone:` on a page's own layout.

Two further variants describe the **input device**, which no width can stand in for: `fine:`
(`(hover: hover) and (pointer: fine)`) and `coarse:` (`(pointer: coarse)`). An affordance that only exists on hover
belongs behind `fine:`, so it is never the only route to something on a touchscreen, and touch hit areas grow
under `coarse:`.

### Phone chrome

Below 768px the sidebar is gone and three pieces replace it. `TopStrip` (project switcher or back affordance, plus
the account menu, `min-h-11`) sits in normal flow above the page so it never covers a masthead. `TabBar` (five
sections across the bottom of a project) and `MiniPlayer` (the playing track) share one fixed container, `Dock`,
so the two never race for the bottom edge, and `Dock` renders nothing when neither has anything to show.

Three tokens carry the reservation: `--tabbar` and `--miniplayer` are zero until `Dock` flags their row present on
`body` (`data-tabbar`, `data-miniplayer`); the rows themselves use the constant `--tabbar-height` and
`--miniplayer-height`, so they never depend on that flag. `--dock` sums both plus the bottom safe-area inset, the
one number every phone-width scroll container pads by (`PAGE`, `PAGE_WIDE`, `CANVAS`).

### The panel (dit)

The fourth surface is dit's menu bar panel (`apps/dit-app`): a 400px-wide popover under the bar item, one screen
at a time, never a window with a rail. It borrows the room's tokens and nothing of the page grid: `--column`,
`--rail` and `--gutter` are not in use, the panel pads 16px, and its height follows its content up to the
display's working area. The set screen reads top to bottom as the commit motion runs: the masthead (the panel's
one bold element, lit by the set's track artwork), the skyline right under it as the instrument, the commit box
under that, then saves, then renders. Every other screen (sign-in, repos, adopt, restore, settings) is a plain stack
under the same head, with no art band. The panel closes on Esc and on losing focus; its buttons are the default,
`lg` and icon sizes only.

### The backfill window (dit)

dit's one window (`apps/dit-app/backfill.html`, opened from the panel menu's "Bring in projects…" and the repos
screen's first-run button) is the panel's exception to "one 400px screen": hundreds of sets in tens of folders do not
fit a popover, so the window is resizable (it reads down to 640 × 480) and keeps the folder as the unit you move
between. It is the panel's tokens and type at a larger size, still with no rail, no page grid, no art band and no
card: hairlines and the ink ramp only.

One frame serves Find, Check and Bring in, so the person never loses their place between steps. Top to bottom: the
step names in the label shape (`FIND · CHECK · BRING IN`, the current one in full ink, `aria-current="step"`), then
two panes, then a footer. The left pane is the folders, `minmax(12rem, 18rem)` wide, each a hairline row (a tick on
Find, a drawn state icon on Check and Bring in) with the folder's name, without the word "Project" they all end in,
and one soft-ink line under it for its facts, its state or its reason; the chosen folder's row is tinted 7% ink and
takes a ring while the list has focus. The right pane is the chosen folder: its name in the display face (the
window's one bold element, as the masthead is the panel's), its path under it in micro mono, and what the step puts
beside it ("Goes into" on Check). The footer is one hairline-topped row: the step's line in soft ink at the left, its
actions at the right as `lg` buttons (the primary filled with its `⌘↩` hint, "Back" outline with `⌘[`).

```
┌ FIND · CHECK · BRING IN ────────────────────────────────┐
│ ▢ science    8   │ science Project           GOES INTO   │
│ ▢ halogen    3   │ /Users/me/Music/…         [Alex ▾]  │
│ ▢ canopy    12   │ SET     BACKUPS TRACK      SESSION    │
│ …                │ science123  4  [Science▾] [Matches…▾] │
├──────────────────┴───────────────────────────────────────┤
│ Needs 8.4 GB of your 31 GB left.        [Back]   [Start]  │
└──────────────────────────────────────────────────────────┘
```

Check's sets are a table of ARIA rows (a native table loses its semantics under the grid the rows need). Wide enough
for it (the pane is a container query at `@xl`, 576px), the columns are SET, BACKUPS, TRACK and SESSION under a
label-shape heading row; narrower, each set stacks its two pickers under its name with the column's name over each
picker. A set Check could not take whole carries one micro soft-ink line under its pickers saying what happens to
it. A matched set's track picker is disabled and only shows the matched session's track.

The done readout replaces the frame: the sentence in the display face at `text-subtitle`, in a `max-w-xl` column
16vh from the top, with the folders that failed listed under it as hairline rows (the reason in `--danger`, "Try
again" at the right) and "See sessions not in dit" and "Done" in the footer. It is the one thing in the window that
moves into place: a fade on the arrival curve. Under reduced motion it is simply there, and the folders' progress
lines (`Progress`, `motion-settle`) step instead of sliding. No spinner turns anywhere: work is words and a bar.

Keys and sound: the folder list is one tab stop (a listbox whose active option is the chosen folder; `↑/↓`,
`Home` and `End` move it, `Space` ticks on Find, `↩` is the step's primary action) and `Tab` moves on into the chosen
folder's pickers. `⌘O` chooses folders, `⌘↩` is Next, Start or Done from anywhere (inside a picker too), `⌘[` is Back
and `Esc` closes on Find and Check; an open picker's `Esc` stays the picker's. Focus lands on the step's first
control: "Choose folders…", the folder list, or "Done". A visually hidden polite status line announces a folder
finishing or failing, never a count.

### Named Rules

**The Centred Measure Rule.** Content sits in a centred, capped column; wide screens frame the page with margin
rather than anchoring everything to the left edge. Only the entity lists opt out with `PAGE_WIDE`; settings,
admin and profile keep `PAGE`.

**The One Phone Tier Rule.** Say `stack:` or `phone:`, never a raw `max-[…px]:` width, and never build a band that
is half phone, half desktop.

## Elevation & Depth

Pages are flat. Depth is atmospheric, not structural: it comes from the blurred cover, the wash of light it throws,
grain, and glass. Nothing on the page casts a shadow. The only elements that lift are overlays (dialogs, dropdowns,
popovers, sheets), and they share one treatment.

### Atmosphere layers

- **Masthead art** (`MastheadArt` in the client and on the site): the cover as `background-image`, `blur(64px)`
  (32px on phones), saturation 1.3 to 1.9 cycling with a slow `art-drift`, `scale(1.15)`, bleeding 12% past the
  sides and 64px above (48px on phones), as tall as its band (`--masthead-h`) plus that bleed, faded out by a mask.
  The frame (bleed and mask) is `.masthead__art` in `packages/ui/src/styles/atmosphere.css` and the blur, saturation
  and drift are in `motion.css`, shared by the client and the site; each surface sets only `--masthead-h` (on an
  entity page the token `--masthead-band`: 82vh, 52vh on phones). Three layers: `.masthead__art` holds the mask, opacity and bloom; `.masthead__tone`
  clips to it and carries the blur and the saturation/hue drift; `.masthead__field`, 150% each way, holds the image
  and drifts by `translate`, so the ambient motion never repaints the blurred field. Opacity `--art-opacity` 0.85 (0.7 dark). While the page's own record is playing
  (`data-playing` on the `ArtProvider` container, set by `PlayingLight`), `--art-opacity` steps up to 1 (0.85
  dark) and eases there — the artwork is the room's only light source, so the light answering playback is that
  opacity rising.
- **Masthead scrim** (`MastheadScrim` in the client; `.masthead__scrim` in `atmosphere.css`, both themes' gradients,
  ending at `--masthead-h`): a legibility floor that is **not flat**: a paper mix of 20% → 34% → 52% → 58% → 34%,
  then transparent at 72%. It lifts for breadcrumb contrast at the top, dips so the art stays vivid, and
  fades fully out rather than ending on a line.
- **Page wash** (`PageWash`, styled as `.wash`): the light the artwork throws on the page. One key light off the
  top edge, wide and low over the title, with a cooler lobe at the top right under the rail, and two faint tilted
  ellipses lower down that drift on slow, coprime loops (67s and 103s). Its three tones are one hue at three
  lightnesses derived from `--art` with relative colour syntax: the core at a wash lightness (`--wash-l`, 0.8 light
  and 0.42 dark, chroma capped by `--wash-c-max`), a deep tone 0.12 below and a lift 0.08 above. A grayscale
  accent stays grey. Every falloff is a bell-shaped run of stops, and the field is masked by a tile of fine
  `feTurbulence` noise (alpha 0.84 to 1) that scatters 8-bit contours into grain.
- **Grain** (`body::after`): an SVG `feTurbulence` at `--grain-opacity × 0.055` (`--grain-opacity` 0.5 light,
  0.75 dark).
- **Art fields** (`ArtField`): on the player card, mini-player and share page, the cover blurred hard until only
  its colour survives, over a legibility floor that holds across the whole surface. Type over art uses `.on-art`
  (a small paper-tinted text shadow) and `.on-art-soft` (82% ink) instead of `--ink-soft`.
- **Lava field** (`LavaField`): the now-playing sheet's background. The cover's colours as large soft blobs, each
  following a frequency band of the playing audio. Pausing eases the blobs back to rest and holds the frame;
  reduced motion shows only the resting frame; with no cover it draws nothing.

### Glass

`bg-glass border-l border-glass-edge backdrop-blur-[20px] backdrop-saturate-[1.2]` on the rail, the player card
and popovers that float over art. Glass sits on top of the atmosphere, so the art reads through it.

### Shadow Vocabulary

- **Overlay lift** (`shadow-overlay`: `0 24px 60px -20px oklch(0 0 0 / 28%)`; 65% dark): the one shadow for
  dialogs, popovers, sheets and floating panels, applied through `OVERLAY_SURFACE` with a `--rule-strong` hairline
  and full-strength paper (never glass, which would let the wash confuse its edge).
- **Menu lift** (`shadow-menu`: `0 18px 44px -16px oklch(0 0 0 / 30%)`): dropdown, context and select menus, the
  combobox list and the chart tooltip, with the same hairline over 80% popover and a backdrop blur.
- **Float lift** (`shadow-float`: `0 1px 2px oklch(0 0 0 / 8%), 0 12px 32px oklch(0 0 0 / 18%)`): a glass card
  detached over page content, the player card and the bulk actions bar. It rests on the page rather than lifting
  off it, so it is a close contact shadow under a short soft one, over a `--glass-edge` hairline.
- **On-art text** (`text-shadow: 0 1px 3px color-mix(in oklab, var(--paper) 70%, transparent)`): type over an
  art field.

Stock Tailwind shadow sizes (`shadow-sm` … `shadow-xl`) and arbitrary `shadow-[…]` lifts are drift; use the three
tokens above.

### Stacking

The audio popover is anchored inside the masthead but paints above the body. `CANVAS` is `isolate`; inside it
`#leftside` is z-0, `BODY` z-1 and `RailColumn` z-3. Do not add `isolation: isolate` to the masthead.

### Named Rules

**The Flat Room Rule.** Surfaces are flat at rest. No shadow on cards, rows, buttons, sections or the rail; only
overlays lift, and only with the overlay values. A glass card detached over the page (the player card, the bulk
actions bar) is the one exception, and it takes `shadow-float`.

**The Light, Not Bitmap Rule.** The page wash is built from the extracted accent as gradients. Never blur the cover
bitmap across the page: it leaves a dark block.

**The Single Seam Rule.** Art and scrim end at the same edge, and the art's mask reaches zero before that edge, or
the artwork reappears below the fold as a hard band.

## Shapes

Gently rounded and mostly unframed. The base radius is `{rounded.lg}` (0.45rem), with `{rounded.sm}` for icon
buttons and extra-small controls, `{rounded.md}` for buttons and inputs, `{rounded.lg}` for overlays and menus, and
`{rounded.full}` for status pills, avatars and the pie dot. The rail status block drops to `{rounded.md}` because
it reads as a state, not a tag.

Form comes from lines, not containers: hairline rows in tables, a hairline between rail blocks, a hairline down the
left of the activity feed, an `--art` left rule on blockquotes. There are no bordered cards and no rounded panels
as section containers. Readouts have their own geometry: square 2px waveform bars, 2px meter ticks, a caret under
the loudness baseline, a dotted reference hairline, and a conic-gradient pie for status progress.

**The Line Not Box Rule.** If a group needs separating, use a heading or a hairline. A border that fully encloses
content is reserved for overlays and inputs.

## Appearance

A viewer can move the room within bounds, never out of it. Each appearance preference is one attribute on
`<html>` (`APPEARANCE` in `packages/ui/src/lib/appearance.ts`), which the settings layer renders on the first
byte; every rule hangs off `:root` and moves tokens, never a component, so the whole app follows at once. The
default of each is the room described everywhere else in this document: it has no rule of its own, and a
page with no attribute renders exactly as one carrying every default.

| Attribute       | Values (**default**)                 | What moves                                                                                                                                                                                                                      |
| --------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-density`  | compact · **comfortable** · spacious | `--density` 0.5 / 1 / 1.5, the factor on a table cell's (8px) and a `Row`'s (10px) vertical padding; halves and one and a half keep every padding on a whole pixel. The grid's first-paint row estimate follows it.             |
| `data-text`     | sm · **md** · lg · xl                | the `--t-*` scale, bodies 13 / 14 / 16 / 18px; headings grow less than the body, `--t-micro` never drops below 11px, and Tailwind's `text-xs`/`-sm`/`-base` point at the matching steps.                                        |
| `data-radius`   | none · sm · **md** · lg              | `--radius` 0 / 0.25 / 0.45 / 0.65rem, and every `--radius-*` step with it; `rounded-full` pills and dots keep their shape. Past 0.65rem the furniture reads as SaaS panels.                                                     |
| `data-width`    | **narrow** · wide                    | `--column` 52 → 72rem (74 → 100rem ≥1800px), `--measure` 68 → 80ch, `--gutter` up to 2rem.                                                                                                                                      |
| `data-masthead` | **tall** · short                     | `--masthead-band` 82 → 56vh and `--masthead-head` 50 → 32vh (phones 52 → 40vh, 42 → 30vh).                                                                                                                                      |
| `data-font`     | **mono** · sans · serif              | `--font-body`, the document's face and the notes' prose: the mono, or the platform's own sans or serif (no font request). Anything that names `font-mono`, the labels' Departure Mono and the Redaction title keep their faces. |
| `data-editor`   | **compact** · reading                | `.doc`'s type: reading sets notes and lyrics at `--t-lead` (never under 16px) on 1.85 leading.                                                                                                                                  |
| `data-grain`    | off · subtle · **full**              | `--grain-opacity` at half each theme's strength, or none (`off` removes the layer).                                                                                                                                             |
| `data-glow`     | off · soft · **full**                | soft: the masthead field's saturation cycles 1–1.2 and it rests at 0.6 (0.5 dark), the wash's key and haze at six tenths; off: no field and no wash, the accent alone.                                                          |
| `data-ambient`  | **on** · off                         | off stops the field's drift and the wash's lobes, as reduced motion does, and nothing else; on never brings the drift back to a phone.                                                                                          |
| `data-motion`   | **system** · reduce · full           | the reduced-motion switch (see Motion): the OS preference, every reduced-motion rule everywhere, or none of them even on a reducing OS. Haptics are not motion and do not follow it.                                            |

**The accent fallback.** `--art-fallback`, inline on `<html>`, is the viewer's accent for pages with no
artwork: any colour, derived per theme at `ACCENT_TONES` into `--art-fallback-light`, `-glow-light`, `-dark`
and `-glow-dark`, and standing in for the grayscale `--art`/`--art-glow` there and in every grayscale artwork
pair below it. A cover's own pair always wins. See the Borrowed Light Rule.

## Components

**Character:** tactile studio gear, modern and professional. Controls behave like well-made hardware (meters that
fill, carets that point, pies that sweep, a waveform you scrub), with the chrome around them kept quiet and exact:
hairlines over fills, bare icons, weight and ink for emphasis.

### Buttons

- **Shape:** gently rounded (`{rounded.md}`), 1.75rem tall by default (1.5rem `sm`, 2rem `lg`), with a
  `coarse:min-h-11` floor so forms and dialogs are thumb-sized on touch.
- **Primary** (`{components.button-primary}`): ink fill, paper text; hover drops to 80% ink.
- **Outline / Ghost** (`{components.button-ghost}`): hairline or no border; hover takes a muted plate.
- **Destructive** (`{components.button-destructive}`): danger text on a 10% danger tint (20% dark), and it goes
  through `ConfirmDeleteDialog`.
- **Focus:** the border shifts to `--ring` (the art accent) with a 2px ring at 30%. **Active:** a 1px press
  (`translate-y-px`), the one tactile nudge.
- The shadcn base still sets button text with `text-xs/relaxed`; the scale equivalent is `text-small`.

### Icon buttons

Bare marks: no fill, no border, no hover background, answering on colour alone, so a row of them reads as a set of
marks rather than a toolbar.

- **Play** (`{components.icon-button-play}`): a filled icon, ink at rest, `--art` on hover. 32px, or 44px at
  `size="touch"`.
- **Icon:** a step quieter, `--ink-soft` to ink on hover. 28px, or 44px at `size="touch"`.
- **Hero** (`{components.icon-button-hero}`): the single 64px transport of a now-playing view, still a bare
  filled icon.
- Everywhere else the target grows without the mark growing: `coarse:after:absolute coarse:after:-inset-2` adds 8px
  of reach on touch and nothing under a cursor.
- Row-level play appears on hover or focus only (`group-focus-within:opacity-100`).

### Inputs / Fields

- **Style:** hairline border (`--input`, `--rule-strong` in dark), a 20% input tint (30% dark), `{rounded.md}`,
  1.75rem tall.
- **Focus:** border shifts to `--ring` with a 2px ring at 30%.
- **Error:** danger border with a 2px danger ring at 20%. **Disabled:** 50% opacity, no pointer.
- `InlinePropertyEditor` edits a value in place in the rail; it takes a `displayValue` for a stored form that is
  not the readable one, and a `hint` line that stays inside the field so it never reads as the next label.
- `InlineTitleEditor` renders the masthead title as an editable `<h1>` with a hover pencil.

### Status

- **Pill** (`{components.status-pill}`): the user's colour at full strength with contrast-guarded text, masthead
  byline and rail via `StatusDisplay` and `StatusDropdown`. The rail variant (`{components.status-block}`) runs
  full width, so the colour reads as a state the entity is in.
- **Chip** (`StatusChip`): 18% tint, 35% border, for tables, menus and peek.
- **Flag** (`flag` variant, no pie): a fact about the row rather than a pipeline position — `Explicit`, a session's
  `Main`, and `DuplicateFlag`'s "same audio as v3" on a version row or the tracks table's title, when a version's
  fingerprint matches an earlier one.
- **Pie:** every variant draws its dot as a conic-gradient pie from `--pct` (`status.percentage`), registered with
  `@property` so it sweeps between positions. A flag variant carries no pie. Changing status transitions the fill
  colour and the pie together over `--status-shift` (420ms).
- **Menus** share `statusMenu`, `statusMenuItem`, `statusVars`, `StatusMenuRow` and `StatusNote` from
  `status/components/StatusMenu.tsx`: rows carry a colour rail on the left that widens on hover, and `StatusNote`
  wraps `FloatingNote` to show the description and a meter.

### Tables

`Table variant="entity"` (`packages/ui` `table.tsx`): sticky `th` in the label shape, `td` in `--ink-soft`, hairline
rows, a flat 4% ink hover (not artwork-tinted; that read as noise), `TableScroll` for horizontal overflow,
`PinnedCell`/`PinnedHead` (opaque paper, needed only because it slides under cells), `TrackCell` (thumb and title),
`RowPlay` and `MeterCell`. The `DataTable` root and its parts supply the behaviour (URL state, saved views, grouping,
peek, draft rows, bulk bar, cell grid); entity tables supply columns. A table of things nothing deletes from it (a track's
repositories) mounts `DataTable` directly with no `deleteKind`, and its section renders nothing until it has a row.

### Attachment tile

An attached file (`AppAttachment`) sits on the spine like a table row, not in a card: a hairline under it, rows of
tiles meeting on those hairlines, columns set apart by the grid's gap. A 40px kind slot leads (the image's own
thumbnail, or a bare music or file glyph in `--ink-soft`), then the name in `text-small` ink, wrapped and never
truncated, then where the file came from (`ProvenanceGlyph` beside the provenance line in `LABEL` caps), then the
fingerprint mark in `--ink-faint` beside the size in `text-micro` tabular numerals. Play and the menu are bare icon
buttons revealed like row-level play, and stay shown while the menu or Details is open. Hover or focus shows the
glance note beside the tile; Details in the menu opens the same facts in a popover, with Copy path and Reveal for a
local file. While the file is being processed the name shimmers.

### Navigation

- **Sidebar** (`{components.sidebar}`): sunk paper, `SIDEBAR_EYEBROW` group labels, an `ArtSwatch` beside each
  collection and track, collapsible groups, and `SidebarSearchTrigger` for the command palette. Active rows take
  the sidebar accent plate (8% ink, 12% dark).
- **Breadcrumbs:** `crumbs` on `Masthead` and `PageHead`, lifted for contrast by the masthead scrim.
- **TabBar** (phones): `h-(--tabbar-height)`, five `min-h-11` tabs; a lit tab is a hairline-height bar at the
  bar's own top edge, not a badge on the icon.
- **TopStrip** (phones): project switcher or back link on the left, account trigger on the right, both opening a
  `BottomSheet`.
- **Command bar:** the client's desktop command bar is a 40px sunk bar of key hints (Departure Mono keys in ink,
  labels in soft ink) that becomes the `:`/move prompt, with its suggestions in an overlay surface above it. It is
  the ui `CommandBar`, a row in the content column rather than a fixed layer.

### Panel (dit)

Gear for the menu bar panel, built from the same parts as the save diff card:

- **Set masthead:** the set's name in the display face, then the branch and "2h 14m in this set since the last
  commit" in soft ink, then "Open on the web ↗" as a text link. The art is the set's track artwork through
  `--art-image` and the usual `--art` pair; with no artwork it is grayscale like every page. The `⋯` menu sits at
  the right edge as an icon button.
- **Skyline readout:** `SetSkyline` in `data-mode="changes"`, one column per track, lit where the set differs
  from the last commit. It is one tab stop (`←/→/Home/End` move across tracks) with an `aria-live` line naming the
  lit track ("Bass · +EQ Eight"); under reduced motion the fade goes and the lit state stays.
- **Commit box:** a textarea holding the suggested message; under it the clauses as toggle chips (`+2 tracks`,
  `+EQ Eight on Bass`, `tempo 120 → 124`), a helper line in soft ink, a refusal line in `--danger` when the commit is
  refused, and the primary "Commit" with its `⌘↩` hint. A clause toggled off leaves the text; typed text wins over
  the suggestion. With nothing to commit the box reads "Nothing to commit" and the last commit takes its place.
- **Save rows:** the shared save row body (time, chips) with a push dot in front: the status pie, ink when
  pushed, `--art` while pushing, hollow while pending. Under the heading "3 saves since 'added strings'".
- **Render card:** one card per waiting bounce, under the label-shape heading "NEW BOUNCE": a play control, the
  file name wrapped and never cut, a line of evidence ("bounced 4 min after your last save"), and the decisions as
  text buttons (Add as version, Not this set, Not a bounce, Never here). The cards form a listbox owning `↑/↓`,
  `Y`, `N` and Space; uploading shows a `Progress` line in place of the buttons.
- **Menu items with a second line:** Quit's note, and the failure line of "Update to 0.10.0" when that update could not
  be taken, are `flex-col items-start gap-0.5` with the line in `text-micro` (soft ink, `--danger` for the failure). While
  an update installs the item reads "Updating…" and is disabled.

### Backfill window (dit) components

Gear for the backfill window, built from `Rows`, `Progress`, `Checkbox`, `Combobox`, `Button` and `Kbd`:

- **Folder list** (`src/backfill/folder-list.tsx`): a hairline `Rows` listbox, one component for every step. The row is
  a `Row` with a leading tick (`Checkbox`, `aria-hidden`, a mouse affordance only; the ticked folders are the listbox's
  selected options) or a leading icon, a `RowTitle`, a wrapping `RowMeta` and, in the run, a `Progress` line under
  the meta while the folder commits or uploads. A folder already in dit is `aria-disabled` and reachable.
- **State icons** (Bring in): Tabler, one stroke, none animated. Waiting `IconCircle`, committing and uploading
  `IconCircleDot`, waiting for the hub `IconWifiOff`, done `IconCircleCheck`, paused `IconPlayerPause`, failed
  `IconAlertTriangle`. Check uses the check for a folder read, the triangle for one in doubt.
- **Picker** (`src/backfill/picker.tsx`): `@workspace/ui`'s `Combobox` as a single-select field with type-to-filter,
  named by an `aria-label` or by the visible label's id. Every set in Check has two.
- **Folder progress** (Bring in, right pane): the state line, a full-width `Progress`, and a definition list of Sets
  committed, Saves stored and Data uploaded in `tabular-nums`; a failed folder shows its reason in `--danger` with an
  outline "Try again" instead.
- **Notice**: the panel's hairline-left `text-small` soft-ink line, `role="status"`, for what Find found (or did not)
  and the sync warning on Check.

### Page heads and sections

- `Masthead` (entity pages) and `PageHead` (lists, new-entity forms, settings, profile) both take `crumbs` and
  render the `<h1>` in the display face; `PageHead` adds an optional `lede` and `action`.
- `SectionHead` is a section-label `<h2>` with an optional count and action slot. No rules, no cards; the heading
  is the structure. `CollapsibleSection` is the same head behind a chevron. `prominence="primary"` sets the title a
  step up in full ink, for the sections a page exists for (a track's lyrics and comments).
- **Section rhythm:** the space above every head is the page's flex gap and the space below is the head's
  `mb-3.5` (`SECTION_HEAD`), so a head binds to its content. A folded head keeps no bottom margin.
- **Empty sections** (`EmptySection`) fold into one **add line**, placed after the page's last section and before
  Activity: a section-title label naming the entity ("Add to this track"), then each empty section's action in
  page order as a text action in `--art` (`+ Notes · + Lyrics · Link a note · + Session`), separated by
  `ink-soft` middots. An empty section renders nothing in its own place. Pressing an action opens that section's
  normal editing UI where the section belongs, with focus inside, and the action leaves the line. A section with
  content is unchanged. A section with nothing to add stays off the line: one with an `emptyLabel` (a session's
  Structure and History) keeps its label and that line in place; otherwise it renders nothing, so a viewer sees no add
  line at all. In the notes and artwork row, a folded column gives up its cell.
- **Activity** is a `CollapsibleSection`, collapsed by default: the page's history, not its content.

### Settings hub

- **Rows** are `Rows` hairlines: the label and a `54ch` description on the left, the control on the right, and
  under the description one facts line in `LABEL` caps and `ink-faint`: where the value comes from (full ink with
  a dot when the row holds its own), Reset, the lock, whether a restart-required value is **Applied** or waits
  (**Restart to apply**, in full ink), and the save's progress. State is words in the ink ramp, never a coloured
  badge. A row may carry one more `text-small` `ink-soft` line under its facts for what the server did with
  it (the retention row's "Last pruned 3h ago · 412 MB freed").
- **Notices** under a page head (a note the hub was sent to, a restart the server waits on) are one `text-small`
  paragraph in soft ink behind a 1px `rule-strong` hairline on the left, `role="status"`: information, never an
  alert colour or a box. One notice speaks for every setting it names, and it is not rendered while it has
  nothing to say, so it takes no gap in the page's rhythm.
- **Advanced groups** (the rate limits) fold behind a `CollapsibleSection` head with their row count, closed
  unless the URL names the group. Opened, the reset for the whole group sits above the rows as a count of changed
  rows and a ghost "Reset all to defaults", confirmed through `ConfirmDeleteDialog`.

### Rail

`RailIdentity` (thumb, title and subtitle; hidden ≤1180px), then `RailBlock`s separated by a hairline, each with a
`RailLabel` and a value, an `InlinePropertyEditor`, a `StatusDropdown`, a `Meter`, or a two-column grid of pairs
(KEY·BPM, CREATED·UPDATED). `MetadataItem` shows an empty value as italic "Not set" in faint ink. `MainToggle` is a
filled or outline star in the `RailLabel` action slot, it fills on press
and stays filled, no toast. Also `CollectionProgress` and `ProjectRailCounts`. The seam between blocks is the `rail-seam:` variant, which also
reaches across the `display: contents` wrapper `RailMore` folds the tail into; the "More details" toggle sits after
that wrapper so the selector can find it.

`DetectedMeta` replaces the KEY·BPM pair when the track's own field (derived from its main session) is empty: the
primary version's detection reads in `text-ink-faint` with a `detected` hint and, where the track has a main
session to write it to, an `Adopt` text action in `--art` that patches that session's field and leaves the rail
showing the stored value from then on. A confidence under 0.1 wears a `?` — the fine-pointer tooltip / coarse-pointer
popover pattern `LoudnessUnit` already uses — reading "Low confidence".

### Loudness meter (signature)

Drawn as a meter scale, not a bar chart. `RulerScale` (`packages/ui/src/components/loudness/ruler-scale.tsx`) is the general shape —
a domain's `min`/`max`, numbered stops, an optional reference hairline, one 2px `--art` tick per measurement, an
optional band across the spread, and an ink caret under the baseline pointing at the value the block names, all
over a value-to-position formula any domain can share. `LoudnessScale` is the loudness preset: −28 to 0 LUFS with
the viewer's loudness reference (`visuals.loudnessReference`, −14 unless they change it) marked by a dotted
hairline. `LoudnessReading` above it is
the one stat figure in the rail, with unit and qualifier in `text-micro text-ink-soft` beside it, faint while still
being measured. `CollectionLoudness` puts every track on the scale with the median under the caret; `TrackLoudness`
puts every version on it with the caret on the version the masthead is showing. No `--warn`: a loud master is a
fact, not a fault. `CollectionTempo` is the same drawing over a second preset, 60–200 BPM, one tick per track and
the median under the caret.

While the page's own audio plays and the player is measuring it, `LiveLoudnessScale` runs the live level along the same ruler: a 3px `--art`/70
momentary bar over the baseline (under the ticks, so measurements stay readable), a 7px ink tick holding the highest
recent momentary level, and a full-height ink needle with a 5px head for the short-term level. Above the ruler,
`M`, `S` and `Peak` figures in `text-micro` update about six times a second, so they read with the scale and never
with whatever sits below it; the now-playing sheet captions that row `LOUDNESS` and gathers the figures at the
right, the rails leave it uncaptioned with `Peak` pushed right. During an A/B comparison an `A`/`B` label leads
the figures and the inaudible side draws as an `ink/30` needle. The levels come from an AudioWorklet that
measures each source before its gain (BS.1770 K-weighting, R 128's 400ms and 3s windows), so a loudness-matched
comparison still shows the masters' real difference. Measuring means routing playback through Web Audio, and a
phone will not play with the screen off once it is routed, so the player only starts measuring for a surface the
listener has opened: the now-playing sheet and an A/B comparison. A scale on an entity page, and the room's
breath, show the live level when the sheet has already asked and rest at the stored figure when it has not. The block opens in height rather than appearing, and under
reduced motion only the figures move. The now-playing sheet shows the same scale under the identity, in the
`art` tone.

### Spectrum

The `SPECTRUM` block sits directly under `LOUDNESS`, a second instrument on the same shelf: same rail block, same
label row, same live behaviour. `SpectrumScale` draws a log frequency ruler from 20 Hz to 20 kHz with a
`--rule-strong` tick at each of ten stops and a numeral under four of them — 20, 100, 1k, 10k — under a 56px
drawing that stretches to whatever width it is given. Levels are tilted 4.5 dB per octave about 1 kHz, so a
balanced modern master reads roughly flat and a curve that slopes is telling you something. The version under the
caret is a 1.5px `--art` line over an `art/20` fill; its siblings are 1px `ink/25` lines behind it, so switching
versions in the masthead brings one forward without redrawing the rest. A collection draws its mean curve the same
way inside an `art/15` envelope between its quietest and loudest track per band. Every curve in a block shares one
48 dB window anchored on the loudest point of the loudest curve, so two versions are comparable by eye; there is no
headline figure, because a spectrum is a shape rather than a number.

While the page's own audio plays and the player is measuring it, `LiveSpectrumScale` runs the live spectrum over
the stored curves as a 1.5px ink line, with the inaudible side of an A/B comparison at `ink/30`, both on the same
window. Each band rises in a couple of frames and falls over a third of a second, the needle's ballistics, and the
line settles onto the floor and stops when playback does. The rail's loop also rests while the block is scrolled
out of view. Under reduced motion the line is hidden and the stored curves stand alone. On a tall window (62.5rem
and up) the now-playing sheet shows the same block under its loudness meter, captioned `SPECTRUM`, in the `art`
tone. Below that the sheet keeps its art at full size and shows loudness alone rather than squeezing a second
instrument in; the rails carry the spectrum at every size.

### Strips

`MeasureStack` (`components/track-audio/`) sits under the track waveform: a legend row of `TogglePill`s choosing
which measurements to show — a chart legend rather than a row of switches, so a pressed pill stays outlined and
says it is on with a filled `--art` swatch instead of a full art fill — each pill wrapped in a `Tooltip` naming
what it draws in plain language, starting from the viewer's strips setting (the visuals policy's `strips`,
all three by default since that is everything there is), then one 24px captioned
row per choice, hairline-separated, sharing the waveform's own bar grid (`bucketOf`, exported from
`packages/ui/src/lib/waveform-bars.ts`) so a moment lines up the same way in every strip as it does in the wave above them. Each strip
seeks on click and by keyboard (`StripRow`, the one seek gesture every strip shares) through the same action the
waveform uses. Captions are the `LABEL` shape. While the version under the strips is the one playing, one 1px ink
playhead runs through every strip: `MeasureStack` writes the position to `--playhead` once a frame and each strip
translates its line by it. Every strip fetches its own measure only while its pill is on, and toggling a pill
re-renders the stack alone, never the waveform beside it.

- **`LoudnessStrip`**: the short-term curve as an `art/20` area under a 1px ink line on the same −28..0 LUFS ruler
  `LoudnessScale` draws, turned sideways, with the viewer's loudness reference as a dotted hairline.
- **`SpectrogramStrip`**: the stored PNG, stretched to the strip's own width and flipped vertically (bass at the
  bottom, the PNG stores it top row first) and tinted by `--art` through `mix-blend-mode` so the grayscale tile
  reads in the artwork's hue. In both themes a loud band shows the artwork tone and a quiet one fades into the
  paper: `multiply` over the plain image in dark, `screen` over the `invert`ed image in light; 48px tall, the one strip that is an
  image rather than a drawing.
- **`ChangeStrip`**: per-second cells filled `--art` at the change value's own alpha, with a summary line ("38%
  changed · most in 1:32–2:10") that seeks to the loudest stretch. Props-only — the change map, the summary and the
  geometry come in, nothing fetches inside it — so the Lab's any-pair comparison draws through the same component
  under its two waveforms.

### Key ring

`CollectionKeys` is the one drawing in the rail that is not a ruler, because a collection's tonal spread is a
shape: two `--rule-strong` hairline rings, the twelve major keys around them in `text-micro text-ink-soft`, a
10px `--art` dot per track at its detected key (8px on the inner ring), minor keys sharing their relative major's
spoke on the inner ring, captioned "Major outside, minor inside". The block is `KEYS` with the track count in the
label's action slot. Each dot is a button: hovering or focusing it shows a `FloatingNote` with the title, key and
tempo. While one of the collection's tracks plays, its dot swells and sends an `--art` ring out once a beat at the
track's detected BPM (`.key-beat`, `--beat` inline from `beatSeconds`); under reduced motion the dot swells and no
ring leaves.

### Constellation (inventory web)

The plugins and samples pages draw the sets and what they use as one node-link web (`Constellation`,
`packages/ui/src/components/constellation/`), full width of the column between the head and the rows, a hairline
above and below and nothing else around it: no card, no border, no legend, the grain showing through. It is
`min(70vh, 720px)` tall on desktop and 60vh on a phone, so the rows below always show. The web is furniture: ink dots
on paper. A set is a small filled circle in faint ink; a device or sample is a filled square in soft ink, larger
with the square root of how many sets use it within a narrow band, so a hub reads as larger and never as a slab. A
sample Live cannot find is a `--warn` square, the one place the amber belongs here (dit calls it "Can't
find"). Edges are hairlines, one to three pixels by how many tracks of the set carry the device, mixing faint to soft
ink and rising in alpha with the item's rarity, so gear few sets share draws brighter than gear many do. The stock
chain (anything in more than 40 % of the page's sets, and at least five) is not drawn: it sits under the web as a
wrapping row of `TOGGLE_PILL` chips ("Echo · 476 sets") after a `LABEL` "Stock chain", with "Show stock chain" /
"Hide stock chain" at the end. Labels are the body mono at label size in soft ink with a paper halo; the hubs name
themselves at the fitted zoom and more names come in as the camera closes. The focal moment is the hover: one node,
its edges and its neighbours light in `--art` while the rest of the room drops to 22 %; a neighbourhood of up to 40
names every neighbour. The held node's name, meta and count sit in a `FloatingNote` beside it, and a click pins it
into a popover that adds the link out ("Open set", "Show row"); the node itself never navigates. Hue appears only
where `--art` lights a neighbourhood; a page without artwork lights in the grayscale fallback. Drag pans, the wheel
and a pinch zoom, and three icon buttons at the top right zoom in, zoom out and fit; edges hide while the camera
moves. Under reduced motion the camera moves at once. Without WebGL the web is one line in soft ink in its place.

### Audio (signature)

- **Waveform** (`Waveform` and its parts in `packages/ui/src/components/waveform.tsx`; the player's container is
  the client's `TrackWaveform`): 160 square 2px bars with `justify-content: space-between` so gaps absorb slack;
  played bars take `--art`; comment marks sit above with a drop-line. Hovering or keyboard-focusing a pin shows a
  `FloatingNote` above it with the author, timecode and comment excerpt; touch leaves the pin's tap-to-open
  behaviour unchanged.
- **Audio comments** (`AudioCommentPanel`): a `Popover` anchored to the audio meta row, headed by the
  `VersionBadge`, because threads belong to one version. `CommentCompose` adds a `Stamp` timecode chip.
- **Player card** (`MusicPlayer`): a fixed bottom-left glass card under the sidebar, tinted by the playing track's
  art with a 1.1s cross-fade.
- **Now playing** (`NowPlaying`): a sheet over the lava field with the hero transport. On phones, `MiniPlayer` in
  the dock opens it.
- **Lab** (`components/lab/`): the sheet's third pane, an `IconButton` toggle beside the queue toggle in
  `SecondaryRow` that carries a small `--art` dot while anything in the Lab changes the sound
  (`settingsNeedLab`), so the player pane says the record is not playing as mixed. Four sections in the rail's
  caption shape over a hairline — TIME & PITCH, RACK, HEAR IT AS, BOUNCE — quieter than the transport above them,
  never a bordered card, scrolling under a soft mask at both edges so no row is cut mid-line. Every parameter row
  is a `RackSliderRow`: a `LABEL` in one shared label column, a `Slider`, and the figure in one shared value
  column, so Speed, Threshold and Wet line up down the whole pane. While the Lab prepares or cannot open the file,
  a `Meter` or a line of ink copy takes the sliders' place (not `--danger`: it is a limit, not an error), and the
  rest stays editable. Each RACK module is a `RackModule`: its pill, an optional control that only means something
  while it runs (the reverb's room), and a body that opens in height through `HeightReveal` when the module is
  engaged. RACK's EQ is the one bold element: a 1.5px `--art` response line with the region between it and 0 dB
  washed `art/15`, so boosts and cuts read as shapes, over `LiveSpectrumScale` at its `tall` size; numbered
  handles fill with `--art` while dragged or focused and carry a readout (`120 Hz · −3.0 dB · Q 0.9`) beside
  them. The same values as fields fold away under "Bands", listing only the slots in use, with "Add band".
  `GrMeter` draws on `RulerScale`: −24..0 dB with an `art/70` bar hanging from 0, an ink hold tick and the
  figure above, the loudness meters' ballistics reused. HEAR IT AS is four labelled rows (Stereo, Monitor,
  Bands, Device) in the same label column. BOUNCE prints the version's own waveform: it waits in faint ink, the
  render draws it in `--art` left to right as far as it has really got, and a finished bounce keeps the print and
  links the attachment by name. HEAR IT AS and the compare pills build on `TogglePill` and `SegmentedPill`.

### Notes, comments, activity and diffs

- **Notes** (`Description` wrapping BlockNote in `.doc`): prose typography at the measure in `--ink-soft`,
  label-shape headings, blockquotes with an `--art` left rule, checklists ticked in `--art`, a hover surface and a
  placeholder so it reads as editable. `.doc` is the only place the editor's tree is styled; its `!important`
  declarations are what it takes to beat BlockNote's stylesheet.
- **Comments** (`CommentList`): avatar (initials on 22% art), name, relative time, threaded replies indented,
  bare-text actions in `text-micro`.
- **Activity** (`ActivityFeed`): a hairline down the left, one row per event, **with detail** (status `from → to`,
  field before and after, entity names). No avatars, no bullets.
- **Diffs** (`packages/ui/src/components/session-structure/`): additions take `--art`; removals are faint ink with a line-through;
  a scalar reads as `from → to` with `from` soft and `to` in ink. `DiffChipList` renders each `DiffChip` as a
  12px Tabler glyph plus text, never a filled or bordered chip: the glyph names the kind of change, the colour
  names its direction. `StructureOutline`, `SampleDelta` and `SaveTimeline` carry the same treatment.
- **Save diff card** (`SaveDiffCard`, signature): one save against the one before it, on glass with a left
  hairline (the rail's recipe), the same card on the session page's STRUCTURE, the history page's compare and the
  site's proof. In order: the header (when the two saves were made in the label shape in ink, or on the history
  page the From / To pickers in their place, since they name the same two saves; the DAW and machine under it in
  soft ink; controls at the right; the file's name is never repeated there, as the page around the card names the
  set and the site names it in a `ProofCaption`); the **skyline** (`SetSkyline`): a bar per track in the set's own
  order and the track's own colour, as tall as its device chain against the set's longest (4px floor, 40px), the
  return and master tracks after a column of air, each group a 2px span in its colour under the bars it holds (1px
  for a nested one, three levels) with a top-level group named under its span when there is room; under the
  baseline an `--art` caret marks an added track, a dashed ghost bar and a faint stroke a removed one, an `--art`
  dot a changed or renamed one; then the **readouts** (`DiffReadouts`), each moved value on its gauge: tempo on the
  60–200 BPM `RulerScale` with a faint tick where it was, an `art/30` band across the move and the caret travelling
  from the old value (`was`), clip counts as 2px meters (kept in 32% ink, growth in `--art`, loss dotted faint, a
  change never under 2px) with a signed `+n` in art beside the figures, anything without a scale as `from → to`;
  then the outline, whose rows add a `+ ~ −` gutter in Departure Mono (the site's hunk grammar, with a hidden word
  for screen readers), the 6px track swatch, `›` chevrons down the chain and each plugin's format in the label
  shape; then samples. A first save is the set with nothing marked; two saves that read the same say so in one
  line. In the client `SaveDiffControls` wraps the server-rendered card and reads the DOM, never data: hovering a
  row lights its bar and dims the rest to 35% (`fine:` only), clicking a bar scrolls to its row and opens its
  group (switching to the whole set first when the Changes view hides that row), a `SegmentedPill` switches
  Changes / Whole set (unchanged rows hide, unchanged bars drop to 25%; a save that changed no track always shows
  the whole set, with no switch), and a stepper walks the changed tracks with `[` and `]`. A stepped row takes the
  4% plate and an `--art` position number, never a coloured left border.
- **Structure outline groups:** a native `<details>` whose `<summary>` is the group's own row, with no client JS. The
  marker is replaced by a 12px chevron in faint ink that rotates 90° on open; the row always carries its subtree
  count (`12 tracks`). Each level insets by one `pl-4` step. A group arrives open unless its subtree exceeds eight
  tracks, and **always** open when something inside it changed.
- **Rows** (`Rows`, `Row`, `RowMain`, `RowTitle`, `RowMeta`, `RowNum`): short non-table lists (samples, links,
  attachments).

### Overlays and sheets

- **Overlays** (`{components.overlay}`): `OVERLAY_SURFACE`, `OVERLAY_TITLE`, `OVERLAY_DESC` and `MENU_LABEL` give
  dialogs, popovers and menus one surface (see Elevation & Depth).
- **`FloatingNote`** (`packages/ui`): the glass note primitive — portalled to the body, placed in viewport
  coordinates either `"beside"` its anchor (a status row) or `"above"` it (a comment pin), hidden until measured,
  `coarse:hidden` since it only ever triggers off hover or keyboard focus. `StatusNote` is a thin wrapper around
  it.
- **Sheets:** `SheetContent` takes a `side`; `SIDE_CLASSES` in `packages/ui/src/components/sheet.tsx` holds each
  placement and entry. A bottom sheet clears the home indicator with an `::after` spacer
  (`after:block after:h-[env(safe-area-inset-bottom)] after:shrink-0`), never bottom padding, because every consumer
  passes a padding shorthand that tailwind-merge treats as overriding `pb`.

### Motion

Mechanical controls, optical surfaces. A control answers the hand on a firm, overdamped spring — short
travel, no bounce. A surface answers the light: it fades up out of the wash and comes into focus, and it
leaves faster and smaller than it arrived. Motion exists to confirm an action, explain a state change, keep
continuity through a layout or navigation change, or carry the room's ambient light. Nothing decorates.

Motion (`motion/react`, through `@workspace/ui/lib/motion`'s `m`) drives everything React owns: entrances,
exits, presses, layout shifts, drags, scroll-linked values. CSS keeps what Motion cannot reach or would make
worse: the stateless primitives server components render (`motion-ink`, `motion-reveal`, `motion-move`,
`motion-press`, `motion-settle`), the ambient loops on the art and the wash, pseudo-element sweeps such as
the status pie, and the two route-level view transitions.

**Tokens.** Durations `--dur-instant` 80 ms (the hand's own feedback) · `--dur-quick` 140 ms (a reveal, a
menu) · `--dur-move` 240 ms (a toggle, a chip, a status) · `--dur-settle` 420 ms (a surface taking its
place) · `--dur-arrive` 700 ms (a page on navigation) · `--dur-bloom` 1100 ms (the art on first load).
Curves `--ease-arrive` `cubic-bezier(0.2, 0, 0, 1)` and `--ease-leave` `cubic-bezier(0.3, 0, 0.8, 0.15)`.
Springs `SPRING.press` / `.control` / `.surface` / `.drawer` (visual 120 / 220 / 380 / 420 ms, bounce 0).
Variants `SURFACE`, `POP`, `OPTICAL`. Reduced motion is one switch: the OS preference, unless `data-motion`
on `<html>` overrides it (see Appearance). `MotionProvider` hands it to Motion's `reducedMotion`, the
`motion-reduce`/`motion-safe` variants carry it in CSS, and `useReducedMotion` in script. Reduced, transform
and layout animation stop, opacity and colour continue, so every state change stays legible. Resting states
live in base CSS, never only in a keyframe.

| Authored moment                                                                                                                                                                                                                                                                                      | Mechanism                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| First-load arrival: art blooms (1.1 s), then crumbs, eyebrow, title, byline, audio rise in a 0.1–0.42 s stagger; the rail fades                                                                                                                                                                      | `ArrivalRoot` and `useArrival` (`components/motion/arrival.tsx`)                                                     |
| Navigation arrival: the new page crossfades in over 240 ms with no stagger                                                                                                                                                                                                                           | same, `arrivalKind() === "nav"`                                                                                      |
| Scroll: the masthead art recedes and dims, the title lifts and fades over the first ~560px of the canvas's own scroll                                                                                                                                                                                | `useCanvasScroll` + `useMastheadScroll` (`components/motion/canvas-scroll.tsx`, `masthead-scroll.ts`) on `useScroll` |
| Sections below the fold arrive as they enter the canvas; streamed content crossfades over its skeleton                                                                                                                                                                                               | `SectionArrival`, `Arrive` (`components/layout/`)                                                                    |
| Overlays: dialogs come to focus (`SURFACE`), menus pop from their anchor (`POP`), drawers travel the edge on `SPRING.drawer` and follow a swipe                                                                                                                                                      | Base UI + `AnimatePresence` (`lib/overlay.ts`, `lib/overlay-presence.ts`)                                            |
| Running-order step: the art cross-fades in place (700 ms), the header leaves 3 rem the way it came                                                                                                                                                                                                   | `<ViewTransition>` named `masthead-art`/`art-step`, `masthead`/`masthead-next`/`-prev` (`ArtMorph.tsx`)              |
| Dock thumb ↔ now-playing cover                                                                                                                                                                                                                                                                       | `<ViewTransition>` named `now-playing-cover`/`cover-morph` (`CoverMorph.tsx`), 420 ms                                |
| The room breathes with the record: the art's inner tone layer follows live loudness                                                                                                                                                                                                                  | `PlayingLight`, direct DOM writes                                                                                    |
| Ambient: the field drifts (28 s), the wash lobes circle (67/103 s); off under reduced motion and on phones                                                                                                                                                                                           | CSS keyframes                                                                                                        |
| A link whose page is slow to arrive: its content settles to the soft ink after 100 ms and breathes until the page lands                                                                                                                                                                              | `AppLink` (new), `link-pending` (`useLinkStatus` (external))                                                         |
| Public website: a hunk's lines tick in one after another as the list scrolls through the viewport                                                                                                                                                                                                    | CSS scroll-driven animation, no script (`.hunk-line` in `apps/web/src/styles/site.css`; see Public website)          |
| Save diff card: the skyline rises as one sweep from the left (the waveform's `bar-in`, each bar's delay a share of `--dur-settle` across the set) and a moved ruler caret travels from its old value; on the site both run on a view timeline instead, so a card in view on arrival is already whole | `.skyline__bar`, `.ruler-caret` in `motion.css`; the view-timeline pair in `site.css`                                |

A record's view-transition name may be mounted once only — two boundaries with one name make the browser
skip the transition — so only the masthead's own frame, header and rail carry one; a table row or the home
list carries none. Under reduced motion the ambient loops stop, the two route-level morphs run at zero
duration, and the breath and every crossfade Motion owns keep running: what the preference removes is
movement, not light.

### Public website

The marketing pages (`apps/web`, Astro) are the Listening Room unchanged, turned to persuading: every claim about
the product is set as a hunk of a save-to-save diff, in the save diff's own grammar, with the real thing beside
it. The pages take the token layer's foundation, atmosphere and motion parts, not the whole of
`globals.css` (`apps/web/src/styles/site.css`), so every spine token, type utility, variant and motion utility
means what it means in the app. The docs under `/docs` are Read mode in the same world: Starlight with its palette
mapped onto the spine and the grain from `atmosphere.css` (`apps/web/src/styles/docs.css`), no artwork, and none
of what follows.

**Anatomy.** `SiteLayout` puts the art variables of the page's cover on `<body>`, paints the masthead into an
`atmosphere` slot behind everything, and sets the header, `main` and footer over it:

```
<body style={coverArt(cover)}>                 ← the page's accent; grain on body::after
├─ MastheadArt (slot atmosphere)               ← absolute, z-0: .masthead__art + .masthead__scrim
├─ SiteHeader                                  ← normal flow, z-10: brand · primary links · source · theme
├─ main (z-1)
│    hero (landing) or PageHead                ← the page's one <h1>
│    Hunk · Hunk · …                           ← each a Band, lit by its own cover or by none
│    Close                                     ← one line and the page's actions
└─ SiteFooter                                  ← hairline, link groups, licence, AI disclosure
```

- **Measure.** Every band runs `px-(--gutter)` with its content capped at `{spacing.page}` and centred, wider than
  the app's `--column`, which is set for one entity rather than a page of them.
- **Masthead.** The app's frame (Elevation & Depth → Atmosphere layers) in `.site-masthead`, which sets only
  `--masthead-h`: 82vh behind the landing's first viewport, 64vh behind a page head (56vh and 48vh on phones). The
  field is drawn from a 480px copy of the cover, since none of its detail survives the blur. There is no page-load
  reveal: nothing hydrates, so the page arrives whole.
- **Hero** (landing): two columns, `minmax(0,1fr)` and `minmax(0,34rem)`, gap 3.5rem: the Display headline (11ch
  cap), a `text-lead` lede in `.on-art-soft` (46ch), the actions, and the save diff beside them. One column at
  `stack:`, headline and actions first. No eyebrow.
- **`PageHead`** (every other page): bottom-aligned in `min(52vh, 34rem)` (no floor on phones), an optional crumb
  in the label shape and `.on-art-soft`, the Display `<h1>` (14ch cap), the lede (52ch) and the actions. Every
  marketing page opens on a masthead, so its `<h1>` is always Display.
- **Header.** Brand (the mark and the name in `font-display-clean`, as the sidebar brand), the primary links in
  the label shape at soft ink (ink on hover and on `aria-current`), then the source link and the theme toggle as
  bare 28px icon marks with the `coarse:` reach. On phones the links take a row of their own under the brand.
- **Footer.** Form from a hairline, not a box: `border-t` then link groups under label heads in `text-small` soft
  ink, the licence, and the AI disclosure, whose link is ink on a `--rule-strong` underline.

**Hunk** (`Hunk`, `HunkLine`, `hunk-signs.ts`; the signature). One claim, set in the product's diff grammar:

- **Header:** `@@ +4 ~1 @@` in the label shape, soft ink, tabular, over a hairline 0.75rem below it, each count
  coloured as its gutter mark. It carries only the counts, `aria-hidden`: the claim names the hunk, and the
  lines are what a screen reader hears.
- **Claim:** an `<h2>` in the body face, never the display face (the One Job Rule), tracked −0.02em and balanced
  (`{typography.claim}`, 20ch cap) in a stacked hunk; a step down in a split hunk and on the `Close` line
  (`text-subtitle` at 1.2, 24ch and 26ch caps); a step further down on phones.
- **Lines:** a list at `--measure`, 0.625rem apart, `text-lead` at a 1.55 line height, each in a `1.5rem` gutter
  column with its mark in Departure Mono. `+` is an addition: `--art` mark, ink text. `~` is a change: soft ink
  mark and text. `−` is what the product deliberately leaves out: a faint mark, the words at **soft** ink under a
  faint-ink line-through (faint ink falls under AA at this size), and a visually hidden "Left out:" before them.
- **Layout:** a two-column grid, `5fr` and `7fr`, 3.5rem column gap and 1.5rem row gap, whose named areas say
  where each part sits. `split` runs header, claim, lines and link down the narrow column with the proof beside
  them; `stack` runs the header across, sets the claim beside its lines, and gives the proof the full width
  beneath (the shape for proof that needs room, and for a hunk with none). At `stack:` both fall to one column in
  reading order. A hunk's band pads 6rem above and below (4rem on phones); the `Close` band 7rem (5rem).
- **Link:** a quiet action into the docs.
- **Tick-in:** each line draws in from its gutter mark rightwards (`hunk-line-in`: from opacity 0,
  `clip-path: inset(0 100% 0 0)` and a −0.5rem `translate`, on `--ease-arrive`) on a view timeline the list itself
  names, so the stagger is the lines' own spacing down the page (range `cover 2%`–`14%`, plus 3% per line from the
  line's `--n`). Only under `@supports (animation-timeline: view())` and `prefers-reduced-motion: no-preference`;
  the resting state is the full line, and a line is only ever held back while it is still below the fold.

**Band and its light** (`Band`, `BandLight`, `.band__light`, `.band__key`). A band is one stretch of a page lit by
one cover: `Band` sets that cover's accent variables (`coverArt`, over `artVarsFromAccent`) on the section, so
everything inside takes its `--art`, and `BandLight` throws its light behind it. The light is the page wash held to
the band (`absolute`, `overflow: hidden`, `z-index: -1`) and masked transparent → opaque from 22% to 64% →
transparent, so neighbouring bands in other hues never meet on a line. The wash's own key light is taken off,
because it sits above a viewport's top edge where the band's fade would cut it into a stripe; the band draws its
own **key** instead, an ellipse (60% × 68%) in the wash's core tone behind what the band is showing: at (42%, 56%),
at (70%, 44%) behind a split hunk's proof, and at (50%, 60%) on phones, with the same bell-shaped falloff. It runs brighter
than the app's wash, which sits behind a whole entity page (key 0.66 and lobes 0.36; 0.56 and 0.3 dark). The lobes
drift as they do in the app. A band with no cover takes the page's accent and throws no light.

**Relight** (`.band-relight`, `BandLight relight`). An element inside a band can carry a second light in its own
accent. It rests at opacity 0; under `fine:`, while the pointer rests on its carrier it fades in and the band's own
light fades out (`--dur-settle`, `--ease-arrive`; instant under reduced motion). The Artwork band's covers carry
one each, so pointing at a cover lights the band with it. It only changes what is already there, so a touchscreen
misses nothing.

**Actions** (`Action`; `{components.site-action-primary}`, `{components.site-action-ghost}`). The one shape every
call to action takes, a size up from the app's buttons because a page, not a form, is around it: 2.5rem tall
(44px under `coarse:`), 1rem side padding, `text-body`, `{rounded.md}`.

- **Primary:** ink fill, paper text; hover 80% ink; a 1px press.
- **Ghost:** a `--rule-strong` hairline, ink text; hover a 4% ink plate; the same press.
- **Quiet:** a soft-ink text link with a 16px arrow; hover takes it to ink and nudges the arrow 2px right
  (`motion-move`).
- **Unavailable** (`href={null}`): a destination that does not exist yet (a hosted plan, an unpublished
  installer) renders as the button shape on a dashed `--rule-strong` border in soft ink, `aria-disabled`, with its
  reason beside the label in the faint label shape (`ComingSoon`). Never a link to nowhere.
- **Focus:** a 2px `--ring` ring at 30%, on every action, link and mark in the chrome.

**Proof.** Real gear or a real screenshot, never a mock.

- **Gear** from `@workspace/ui` (the save diff, the version waves, the loudness reading and scale, the save
  history) renders as HTML only, with no `client:` directive, over the seeded demo catalogue's data. The save diff
  is the app's own `SaveDiffCard` as a `<figure>`, on its glass as the rail sits over a masthead; its outline's
  groups and unchanged runs are native disclosures, and its skyline is lit by the demo set's own track colours.
  Each piece is a `<figure>` whose `ProofCaption` is a hairline: the name in ink `text-body`, and a label-shape
  "Demo · …" in soft ink, so no gear reads as someone's real work.
- **Screenshots** (`Screenshot`): captured from the seeded demo catalogue in both themes, the page's theme showing
  one; `adaptive` swaps in the phone capture below 768px. A screenshot is an image, not a container: a hairline
  edge at `{rounded.lg}` gives a paper-on-paper capture its edge. No browser frame.
- **Covers** (`CoverAccents`): four square covers at `{rounded.sm}`, four across (two on phones), each over a 4px
  `--art` bar and its stored hue and chroma in the label shape; a cover with no hue says it stays grey.
- **Plans** (`PlanList`): hairline rows, not cards, in five columns under label heads; the price at
  `text-section` in tabular figures; on phones each row stacks and its figures carry their own labels.

**Script.** A marketing page runs the inline theme script (one stored choice driving `.dark` for the token layer
and `data-theme` for Starlight, the system's until the visitor picks) and Astro's prefetch, and nothing else. The
build fails any page over `MARKETING_JS_BUDGET_BYTES` (6 KiB). Every motion on the site is CSS.

**The One Cover Per Band Rule.** A band is lit by one cover, and its light fades out before both edges, so two hues
never share a band or meet on a line between bands. A relight swaps the band's light for another; it never adds a
second.

**The Real Gear Rule.** A marketing page proves a claim with the app's own gear rendered to HTML over the demo
catalogue, or a screenshot of it. Every raster the site ships is one of the four covers or one of those
screenshots, its source recorded in `apps/web/CLAUDE.md`: no mockups, illustrations or browser frames.

## Do's and Don'ts

### Do:

- **Do** use the spine tokens (`text-ink-soft`, `bg-paper-sunk`, `border-rule`) and the type scale (`text-micro`
  through `text-display`).
- **Do** put anything label-shaped in `font-sub` tracked caps via `LABEL`, `EYEBROW`, `RailLabel` or `SectionHead`.
- **Do** read artwork through `--art`, `--art-glow` and `--art-image`, and carry it with `ArtProvider`, `ArtSwatch`
  or `artVarsFromArtwork` (`artVarsFromAccent` for a bare hue and chroma).
- **Do** reuse the primitives in `packages/ui` and `apps/client/src/components/` before writing a new surface.
- **Do** keep server components server: `SectionHead`, `RailBlock`, `Rows`, `MetadataItem`, `Masthead` and
  `PageHead` have no `"use client"`.
- **Do** guard user colour with `getContrastColour()`.
- **Do** make hover-revealed affordances also focus-revealed (`group-focus-within:opacity-100`) and put hover-only
  affordances behind `fine:`.
- **Do** draw quantities as studio readouts (meters, ticks, carets, pies, waveforms) rather than charts in cards.
- **Do** lift overlays only with `OVERLAY_SURFACE`.
- **Do** use `motion-ink`/`motion-reveal`/`motion-move`/`motion-settle` on stateless primitives and `m` with
  `SPRING`/`FADE`/`LEAVE` everywhere React owns the state.
- **Do** meet WCAG 2.2 AA: contrast on every theme and over art (`.on-art`), visible focus, and 44px touch
  targets.
- **Do** render gear on a marketing page from `@workspace/ui` with no `client:` directive, add its file to
  `site.css`'s `@source` lines, and keep the page's motion in CSS.

### Don't:

- **Don't** use `text-xs`, `text-sm`, `text-lg` or arbitrary `text-[…]` sizes; shadcn colour names in new code;
  Tailwind palette hues (`green-600`, `sky-500`, `bg-black/50`); `#hex`, `rgb()` or `oklch()` literals in
  components; or raw `max-[…px]:` widths where `stack:` or `phone:` says it.
- **Don't** use `Separator` stacks, bordered cards, `shadow-lg`, or `rounded-lg` panels as section containers.
- **Don't** build a generic SaaS dashboard: cards in grids, KPI tiles, brand-blue buttons, rounded shadowed panels.
- **Don't** go skeuomorphic: literal knobs, brushed metal, fake LEDs or screws. The gear is modern, not a DAW skin.
- **Don't** imitate a streaming app: green accents, huge rounded art tiles, carousel shelves.
- **Don't** use the neon "producer" look: purple gradients, glow, synthwave.
- **Don't** use filled or circular play buttons, or hover backgrounds on icon buttons.
- **Don't** add hover lifts, bounce, or a literal duration or stiffness at a call site; don't animate blur,
  `width`, `height` or `left` on anything larger than a control or a collapsible panel; don't put Motion on
  a named view-transition boundary.
- **Don't** blur the cover bitmap for the page wash.
- **Don't** set `--art` inline; set the `--art-light` and `--art-dark` pairs.
- **Don't** truncate a render's filename in dit's render card; it is how a producer tells two bounces apart. Wrap it.
- **Don't** nest a `<button>` inside an anchor or a `role="button"`.

## Pitfalls

Each of these cost real time.

- **Stacking contexts.** See Elevation & Depth → Stacking.
- **Masthead seam.** Art and scrim must end at the same edge, and the art's mask must fade it to zero before that
  edge. This is why art and scrim live in `ArtProvider`, not in the header, and why the scrim fades out.
- **Page wash banding.** Faint tints over a viewport-sized ramp band in 8-bit no matter how the stops are shaped;
  the noise mask on `.wash` hides that, and an `opacity` on the container would quantise the field a second time.
- **Centring is a no-op if the cap is too wide.** `--column` must be narrower than its container.
- **Waveform width.** Fixed 2px bars with `justify-content: space-between`; `flex: 1` bars with `max-width` cannot
  fill a wide container.
- **Spans need `display: block`** inside anchors or the layout silently collapses inline.
- **Scrollbar ≠ overflow.** `scrollWidth` 15px under `innerWidth` is the scrollbar. Measure elements.
- **Tailwind v4 utilities only exist for registered theme keys.** A colour used via `bg-foo` needs `--color-foo` in
  `@theme inline`; a size via `text-foo` needs `--text-foo`. An unregistered name compiles to nothing with no
  warning.
- **A keyframe must not own a resting state**: define it in base CSS and animate from it.

## Departures from the original plan

The overhaul plan and HTML/CSS prototype this language was built from are no longer in the repo (see git history
before 2026-09-13). Recorded so nobody "fixes" these back.

| Original plan                                                         | Implementation                                                                                       | Why                                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Art and scrim inside the 50vh masthead, scrim solid `--paper` at 100% | Art (82vh + bleed) and scrim (82vh, transparent by 72%) are siblings of the columns in `ArtProvider` | Fixes the seam between blurred art and page edge; user-confirmed |
| Static blurred art, `saturate(1.75)`                                  | Ambient `art-drift` (28s) cycling saturation and ±4° hue; disabled under reduced motion              | Deliberate later addition                                        |
| `.railcol` carries glass and `margin-top: -50vh`                      | `Rail` carries glass and sticky; overlap comes from the grid and z-order                             | Simpler; the column is a grid track                              |
| `--menubar` = `MenuBar` height                                        | `--menubar: 0rem`; there is no `MenuBar`                                                             | Chrome was removed                                               |
| `--art` set per page                                                  | `--art-light`/`--art-dark` pairs set inline, resolved per theme in CSS                               | Theme switching without re-render                                |
| Light `--art` fallback 0.42                                           | 0.45                                                                                                 | Contrast on paper                                                |
| Rail `rise`                                                           | Rail `fade-in`                                                                                       | Translating a sticky element jitters                             |
| Status pies fill on every `.status`/`.chip`                           | Only in masthead and rail                                                                            | Tables would fill 25 pies at once                                |
| Waveform sweep timed from page load                                   | Timed from bar mount                                                                                 | Peaks arrive by fetch                                            |
| Fixed bottom bar player spanning the content                          | Bottom-left glass card under the sidebar                                                             | Later product decision                                           |
| `--font-body` / `--font-display` names                                | `--font-mono` / `--font-heading`                                                                     | Kept so existing utilities worked during migration               |
| Activity feed with comment excerpts                                   | No excerpts; comments are not recorded as activity                                                   | Server does not log them                                         |

## Files

| Concern                                                                                                                      | File                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token layer entry (imports the four parts below)                                                                             | `packages/ui/src/styles/globals.css`                                                                                                                |
| Breakpoint and input variants, the spine in both themes, the artwork accent, font and theme mapping, motion utilities, base  | `packages/ui/src/styles/foundation.css`                                                                                                             |
| Masthead frame (art bleed and fade mask, scrim in both themes; shared by the client and the site), wash and grain, `.on-art` | `packages/ui/src/styles/atmosphere.css` (`.masthead__art`, `.masthead__scrim`)                                                                      |
| `.doc` (incl. BlockNote overrides)                                                                                           | `packages/ui/src/styles/doc.css`                                                                                                                    |
| Keyframes, masthead blur, saturation and drift, `.wave`, view transitions, reduced motion                                    | `packages/ui/src/styles/motion.css`                                                                                                                 |
| Font loading                                                                                                                 | `apps/client/src/app/layout.tsx` (`next/font/local`), `packages/ui/src/styles/fonts.css` (`@font-face`, for the Electron renderer)                  |
| Layout class constants                                                                                                       | `packages/ui/src/lib/shell.ts` (measure and label shapes), `apps/client/src/components/layout/shell.ts` (`CANVAS`, `BODY`, `SPLIT`)                 |
| Page primitives (`PageHead`, `SectionHead`, `CollapsibleSection`, `Rows`, `MetadataItem`, `Loading`)                         | `packages/ui/src/components/layout/`                                                                                                                |
| Theme                                                                                                                        | `packages/ui/src/components/theme-provider.tsx`                                                                                                     |
| Appearance attributes (names, values, defaults; the hooks that read them) and their contract test                            | `packages/ui/src/lib/appearance.ts`, `packages/ui/src/styles/appearance.test.ts`                                                                    |
| Artwork mapping and fallback chain                                                                                           | `packages/ui/src/lib/art.ts` (+ `art.test.ts`), `apps/client/src/lib/art.ts` (the artwork row), `apps/server/src/db/queries/artwork.ts` (the chain) |
| Signature gear: waveform, loudness meter, save-to-save diff                                                                  | `packages/ui/src/components/waveform.tsx`, `packages/ui/src/components/loudness/`, `packages/ui/src/components/session-structure/`                  |
| The inventory web: its renderer and palette, and its data                                                                    | `packages/ui/src/components/constellation/`, `packages/ui/src/lib/constellation.ts`, `apps/client/src/lib/inventory-web.ts` (layout)                |
| The save diff's model: one facet per thing a save can change, the skyline's geometry, the set as a tree                      | `packages/session-diff/src/index.ts` (the registry, `diffSaves`, `diffSave`), `packages/session-diff/src/`                                          |
| Accent extraction                                                                                                            | `apps/server/src/lib/palette.ts` (+ `palette.test.ts`, which loads the four `*.jpg` covers in `fixtures/covers/` as fixtures)                        |
| Multi-colour cover sampling for the lava field                                                                               | `apps/client/src/lib/cover-palette.ts`, `apps/client/src/components/music-player/lava-field.ts`                                                     |
| Contrast guard                                                                                                               | `apps/client/src/lib/css-utils.ts`                                                                                                                  |
| Inline editing state machine                                                                                                 | `apps/client/src/hooks/use-inline-edit.ts`                                                                                                          |
| Art carriers, the masthead art and scrim components (each sets `--masthead-h`), page wash (`PageWash`)                       | `apps/client/src/components/art/`                                                                                                                   |
| Masthead                                                                                                                     | `apps/client/src/components/masthead/Masthead.tsx`                                                                                                  |
| Rail                                                                                                                         | `packages/ui/src/components/layout/rail.tsx`, `apps/client/src/components/layout/RightSideBlur.tsx`                                                 |
| Table primitives                                                                                                             | `packages/ui/src/components/table.tsx`                                                                                                              |
| Status primitives                                                                                                            | `packages/ui/src/components/status-chip.tsx`, `apps/client/src/components/status/`                                                                  |
| Buttons                                                                                                                      | `packages/ui/src/components/button.tsx`, `packages/ui/src/components/icon-button.tsx`                                                               |
| Overlay surfaces                                                                                                             | `packages/ui/src/lib/overlay.ts`, `packages/ui/src/lib/overlay-presence.ts`                                                                         |
| Motion primitives, springs, durations and variants; the provider                                                             | `packages/ui/src/lib/motion.ts`, `packages/ui/src/components/motion-provider.tsx`                                                                   |
| Page arrival, section and streamed-content arrival                                                                           | `packages/ui/src/components/motion/arrival.tsx`, `packages/ui/src/components/layout/section-arrival.tsx`, `arrive.tsx`                              |
| Scroll-driven masthead                                                                                                       | `apps/client/src/components/motion/canvas-scroll.tsx`, `masthead-scroll.ts`, `packages/ui/src/components/layout/scroll-root.tsx`                    |
| Player, now playing, art and lava fields                                                                                     | `apps/client/src/components/music-player/`                                                                                                          |
| Share page                                                                                                                   | `apps/client/src/components/share/ShareRoom.tsx`                                                                                                    |
| Public website stylesheet: `--page`, masthead height, bands, band key and relight, hunk grid, hunk tick-in, browser surfaces | `apps/web/src/styles/site.css`                                                                                                                      |
| Public website shell, theme script, script budget                                                                            | `apps/web/src/layouts/SiteLayout.astro`, `apps/web/src/components/theme/ThemeScript.astro`, `apps/web/src/integrations/js-budget.ts`                |
| Public website components: hunk, band, masthead, page head, actions, proof, plans; header and footer                         | `apps/web/src/components/marketing/`, `apps/web/src/components/chrome/`                                                                             |
| Public website covers and their accents; screenshots                                                                         | `apps/web/src/data/covers.ts` (images in `src/assets/covers/`), `apps/web/src/components/Screenshot.astro`, `apps/web/scripts/screenshots/`         |
| Docs theme (Starlight on the spine)                                                                                          | `apps/web/src/styles/docs.css`, `apps/web/src/components/starlight/`                                                                                |
| Token guardrail (opt-in ESLint fragment; the client, dit app and website apply it to `src/**`)                               | `packages/eslint-config/design-tokens.js`                                                                                                           |
