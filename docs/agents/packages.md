# Reference: Shared packages (`packages/*`)

_Updated 2026-10-20._

## packages/ui (`@workspace/ui`)

**No build script — consumed as source TSX.** `package.json` exports map:

```json
"./globals.css": "./src/styles/globals.css",
"./fonts.css": "./src/styles/fonts.css",
"./fonts/*": "./src/styles/fonts/*",
"./postcss.config": "./postcss.config.mjs",
"./lib/*": "./src/lib/*.ts",
"./components/block-editor": "./src/components/block-editor/index.tsx",
"./components/*": "./src/components/*.tsx",
"./hooks/*": "./src/hooks/*.ts"
```

`./components/*` is a pattern that cannot resolve a directory, so `block-editor` (a directory since the
variant seam landed) needs its own exact key — exact keys beat patterns. Any other component that becomes
a directory needs the same treatment. Imports: `@workspace/ui/components/button`,
`@workspace/ui/lib/utils`, `@workspace/ui/hooks/use-mobile`. Intra-package imports also use the
`@workspace/ui/*` public name (tsconfig paths in `tsconfig.json`, extending
`@workspace/typescript-config/react-library.json`).

### deps worth knowing

`radix-ui ^1.6.7` is the **unified single package** (`import { Switch as SwitchPrimitive } from "radix-ui"`)
— not `@radix-ui/*` splits. Every overlay now sits on Base UI; `radix-ui` remains behind `switch.tsx`,
`slider.tsx`, `avatar.tsx`, `separator.tsx`, `progress.tsx` and `label.tsx`, plus `Slot` (`asChild`
polymorphism in `button.tsx`, `badge.tsx`, `card.tsx`, `item.tsx`, `sidebar.tsx`, `breadcrumb.tsx`); `checkbox.tsx` is a from-scratch control with no primitive underneath. `dialog.tsx`,
`alert-dialog.tsx`, `sheet.tsx`, `popover.tsx`, `tooltip.tsx`,
`dropdown-menu.tsx`, `context-menu.tsx` and `select.tsx` are on Base UI through its per-component entries
(`import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"`, `/alert-dialog`, `/drawer`, `/popover`,
`/tooltip`, `/menu` for both menu files, `/select`), animated through `lib/overlay-presence.ts`;
`combobox.tsx` was already on Base UI and only needed the same `POP` render. `collapsible.tsx` and
`tabs.tsx` are on Base UI too (`@base-ui/react/collapsible`, `/tabs`) but are not overlays, so they skip
`lib/overlay-presence.ts`: `Collapsible` mirrors its own resolved open value into a small local context
(`CollapsibleContent` needs it to drive Motion's height animation and can't read Base UI's internal Root
context), keeps the Panel permanently `keepMounted` at the Base UI level and overrides its `hidden` output
— Base UI has no CSS transition to detect once Motion owns the animation, so its own unmount timing would
otherwise race the exit — and uses `inert` instead for keeping a closed, persisted panel out of the tab
order. `tabs.tsx`'s active-tab indicator is one shared `m.span layoutId="indicator"`, scoped per list by
a `LayoutGroup` in `TabsList`, replacing the old per-trigger `::after` cross-fade.
`dropdown-menu.tsx`/`context-menu.tsx`'s `Item`/`CheckboxItem`/`RadioItem` keep an `onSelect?: (event:
Event) => void` prop (Radix's old signature): the wrapper's `onClick` hands it the click's `nativeEvent`
(a real DOM `Event`, so a caller's `preventDefault()` still compiles) and calls Base UI's
`event.preventBaseUIHandler()` when that fired, which is what keeps the menu open the way
`PlayerControls.tsx`'s repeat item depends on. Their `DropdownMenuLabel`/`ContextMenuLabel` stay plain
styled `<div>`s rather than Base UI's `Menu.GroupLabel`, which throws outside a `Menu.Group` — two callers
head a menu with a label and no group (`PlayerControls.tsx`, `toolbar-menus.tsx`). `shadcn ^4.16.1` is a
**runtime dep** (globals.css does `@import "shadcn/tailwind.css"`). `@tabler/icons-react` is the icon lib
(`Icon*` names; `components.json` `"iconLibrary": "tabler"`). `@base-ui/react`,
`@blocknote/{core,react,shadcn} ^0.54.0` (block-editor), `prosemirror-{model,state,view}` (direct deps —
BlockNote does not re-export them and they do not resolve transitively under pnpm),
`@tanstack/react-table ^9` (table-config.ts), `@workspace/api` (forms, heatmap types), `cmdk`
(command.tsx), `react-hook-form` + `@hookform/resolvers` + `zod` (forms/), `use-haptic` (haptics.tsx —
the only way to reach the vibration motor from iOS Safari), `cva`, `clsx`, `tailwind-merge`,
`motion ^13.3` (`lib/motion.ts`, `motion-provider.tsx`; both bundlers that consume this
package as source — Turbopack and Vite — ship it), `next-themes` (sonner + theme-provider), `recharts`
(chart.tsx only), `sigma ^3.0.3` + `graphology ^0.26` + `@react-sigma/core ^5.0.6` (`constellation/` only;
`graphology-types` is a dev dependency for their types), `react 19.2.4`.

Motion that a server-rendered primitive can carry lives in `globals.css` as `@utility` rules on the
`--dur-*` scale and `--ease-arrive`: `motion-ink` (colour, fill, stroke, shadow; `--dur-instant`),
`motion-reveal` (opacity; `--dur-quick`), `motion-move` (transform, scale, rotate, opacity,
`grid-template-rows`; `--dur-move`; instant under reduced motion), `motion-press` (the ink list plus
`scale` at `--dur-quick`, for a control that changes colour and settles 2 % smaller on `active:`; scale is
dropped under reduced motion), `motion-settle` (the move and ink lists plus `width`, `stroke-dasharray`
and `--pct`; `--dur-settle`; movement dropped under reduced motion) and `shimmer-surface` (a paper band
sweeping a loading surface; the `skeleton.tsx` and `TableSkeleton` bars — shadcn's `shimmer` clips to
text and hides a bar). The `design-tokens` ESLint fragment flags `ease-[…]`, `duration-[…]`, numeric
durations, Tailwind's named curves, `transition-all` and `motion-reduce:` so a class string cannot carry
its own curve; the client, the dit app and this package all opt in.
devDeps pin
**typescript ^5** (rest of repo is ^7); `@types/node ^20` (rest of repo trends ^26). Test devDeps:
`@testing-library/{react,dom}`, `@types/bun`, `@workspace/test` — the preload itself (`dom.ts`) lives in
`@workspace/test`, which declares `@happy-dom/global-registrator` and `motion` as dependencies.

### `cn()` — not a plain tailwind-merge wrap

`src/lib/utils.ts` calls `extendTailwindMerge` with a custom `font-size` class group covering the type
scale (`text-micro…text-display`). Without that registration tailwind-merge treats any unrecognised
`text-*` as a *colour* utility, so `text-small text-ink` looks like two colours to it and drops the size —
an element silently falls back to its inherited font size. Any new type-scale step must be added to this
list or the same bug reappears.

### Components (`src/components/`)

shadcn set (mostly stock, `data-slot="..."`, CVA variants, `cn()`): alert-dialog, avatar,
badge, breadcrumb, button, card, chart, checkbox (native input tinted `--art`; the table select column and
checkbox cells use it), collapsible, combobox, command, context-menu, dialog,
dropdown-menu, empty, field, input-group, input, item, label, popover, progress (zero importers), select,
separator, sheet, sidebar, skeleton, slider, sonner, spinner, switch, table, tabs
(`tabsListVariants` default|line), textarea, tooltip.

Projammr-specific components (see `DESIGN.md` for the language they implement):

- **`status-chip.tsx`** — `StatusPill` (solid fill, `block`/`flag` variants), `StatusChip` (18% tint / 35%
  border, `bare`/`flag`/`solid` variants). Both share a conic-gradient pie dot drawn from `--pct`
  (`@property`-registered so the sweep interpolates); `flag` variants hide the pie because a flag marks a
  state rather than a pipeline position. `statusStyle()` sets `--status`/`--pct`/`--status-ink` inline.
  `STATUS_PIE` is that pie's class string, exported for a state dot drawn in the same shape outside a chip
  (a state dot elsewhere).
- **`table.tsx`** — `Table variant="entity"` (the `entityTable` class set: sticky Departure-caps `th`,
  hairline rows, flat 4% ink-over-paper hover, dead below the layout breakpoint via horizontal scroll
  rather than reflow), `TableScroll`, `PinnedCell`/`PinnedHead`/`PINNED_CELL` (`data-slot="pinned"`),
  `TrackCell` (thumb + title, `size="sm"|"lg"|"xl"` — `xl` is the 44px phone row-card thumb; `wrapThumb` wraps the
  thumb alone, which the client uses to name it for a view transition),
  `RowPlay`/`rowPlay` (hover/focus-revealed, `fine:`-gated so a coarse pointer keeps it visible),
  `Meter` (0–100 progress bar, `fill` overrides the artwork accent, `showValue` prints the rounded
  percentage beside it); `MeterCell` is a thin `Meter` wrapper (`showValue` defaults `true`, `min-w-28`)
  for a table cell.
- **`icon-button.tsx`** — `IconButton`, `variant="play"|"icon"|"hero"` (hero = 64px transport, ignores
  `size`), `size="default"|"touch"` (touch = 44px target via compound variants). Base carries a
  `coarse:after:absolute coarse:after:-inset-2` hit halo so a coarse pointer gets a bigger target without
  visually growing the mark.
- **`toggle-pill.tsx`** / **`segmented-pill.tsx`** — `TogglePill` (Base UI's `Toggle`, `data-pressed`
  styling) and `SegmentedPill` (Base UI's `ToggleGroup`, single-select, always controlled — clicking the
  pressed pill again is a no-op rather than clearing the group) are the one pill shape behind
  `AudioCompareControls`' A·B swap and "Match loudness" toggle, and the Lab's audition and device rows.
- **`height-reveal.tsx`** — `HeightReveal({ open, className, children })`: a panel that opens in height (a
  one-row grid easing `0fr`↔`1fr` on `motion-settle`) instead of appearing, `inert` while closed. Children mount
  on open and unmount once the close settles (straight away under reduced motion), so a closed panel holding a
  live meter costs nothing. The Lab's rack modules and its Bands list use it.
- **`floating-note.tsx`** — `FloatingNote({ anchor, placement, children, className })`: the portalled glass
  note primitive (`document.body`, hidden until measured, `coarse:hidden`), an `m.div` fading in and out at
  `FADE.quick`/`LEAVE.quick`. `placement="beside"` takes whichever side of `anchor` has room (a status menu
  row); `placement="above"` centres over `anchor`, clamped inside the viewport, falling below it when there
  is no room (a comment pin near the top of the page). The client's `status/components/StatusMenu.tsx`
  `StatusNote` and `waveform.tsx`'s `WaveMarks` are both thin callers, each keeping the note mounted through
  `AnimatePresence` while its own reveal condition is true so the exit fade can run before it unmounts. It is
  `pointer-events-none` and `role="presentation"`: a glance surface that cannot host a control (an action
  belongs in a popover opened from a menu, which coarse pointers can also reach). It lives exactly as long as
  its owner and its `anchor` prop and never watches the anchor's removal, so a note owned by the row it
  describes leaves with the row, while one held in list-level state (`CollectionKeys`, the waveform pin)
  outlives a deleted row with a stale snapshot.
- **`fingerprint-mark.tsx`** — `FINGERPRINT_BAR_COUNT`, `barsFromFingerprint(fingerprint)` and
  `FingerprintMark({ fingerprint, className?, title? })`: a file fingerprint (`<size>:<40 hex sha1>`) as a
  `currentColor` barcode of 20 square bars, bar _i_ `1 + (byte >> 6)` units wide with 1-unit gaps, one unit a
  pixel at the default `h-2.5`; a null or malformed fingerprint renders `null`, and `title` makes it
  `role="img"` (otherwise `aria-hidden`).
- **The signature gear** (`DESIGN.md` "Audio (signature)", "Loudness meter (signature)", "Notes, comments,
  activity and diffs") is the presentational half only: everything renders from props, with no fetch,
  audio or browser-only hook, so `renderToStaticMarkup` (a static page, `apps/web`) gets the same markup
  the client does. The client keeps the containers (playback, subscriptions, per-frame DOM writes, data
  loading) and renders these.
  - **`waveform.tsx`** — the parts a wave is composed of: `waveSurface(size)` (the `.wave` element's
    classes; `WaveSize = "md" | "lg"` → `h-12`/`h-20`), `WaveBars({ bars })` (memoised `<i>` per bar with
    `--h` and `--i`), `playedBars(fraction, count)` (the `--played` string motion.css lights bars by),
    `WaveStack({ compareBars, size, children })` (an A/B series behind at `opacity-60`), and
    `WaveMarks({ marks, duration, onMarkerClick? })` (`CommentMark = { id, positionMs, author?,
    excerpt?, resolved?, resolvedBy? }` pins with a drop-line and a `FloatingNote` on hover/focus; each pin is
    one `<button>` on the `MARK` class constant holding an `<i>` dot and a `<span>` drop-line, so a pin has no
    per-mark style. A `resolved` mark sets `data-resolved` on its button: the dot goes `--ink-faint`, the
    drop-line retracts to `scale-y-0` from its top edge on `--ease-leave` (`transform`, never `height`), the
    `aria-label` reads `Resolved comment …`, and the note ends `Resolved · <resolvedBy>` (or `Resolved`); it
    still seeks. Each child carries one transition list: the dot `motion-press` (colour survives reduced
    motion), the drop-line `motion-move` (snaps under it)). `Waveform({ peaks,
    comparePeaks?, scale?, progress?, marks?, duration?, count? = MAX_BARS, size?, label, className? })`
    composes them into a `role="img"` wave for a static page; the client's `TrackWaveform` composes the
    same parts around its seek slider/play button, and `lab/Bounce` draws its print with `WaveBars`.
  - **`loudness/`** — `ruler-scale.tsx` `RulerScale({ config, marks, band?, pointer?, label, live?, tone?,
    className? })` (the general meter: stops, dotted reference, one `--art` tick per mark, band, ink caret;
    `live` is a slot drawn under the ticks for the client's `LiveLoudnessScale`), `loudness-scale.tsx`
    `LoudnessScale` (the −28…0 LUFS preset; `loudnessRuler(reference)` and `LOUDNESS_FLOOR`/`LOUDNESS_CEILING`,
    `LoudnessMark = { lufs, label }`; the required `reference` is where the dotted line sits — the client passes
    the visuals policy's, `apps/web` the streaming level; `format?` writes a mark's figure), `loudness-reading.tsx` `LoudnessReading({ lufs, pending?, format?, children })`
    (the display-face figure with
    its unit/qualifier beside it), `loudness-unit.tsx` `LoudnessUnit({ unit, compact?, className? })` (the
    `<abbr>` with a tooltip, or a popover on a coarse pointer; copy in `loudness-unit-copy.ts`).
  - **`session-structure/`** — the save diff and its parts, all server-renderable except the controls:
    `save-diff-card.tsx` `SaveDiffCard({ as?, diff, saves, daw?, when?, actions?, collapseUnchanged?, asOf?,
    format?, timeZone?, className?, children? })` (glass; `children` heads it, the site's `ProofCaption` as a
    `figure`; `when` replaces the save times, the history page's pickers), `savePairLabel(saves, { asOf,
    format })`, `stampOf(save)` and the `SaveStamp` type;
    `set-skyline.tsx` `SetSkyline({ structure })` (`@container/skyline`, `data-diff-bar` per bar);
    `diff-readouts.tsx` `DiffReadouts({ readouts, format? })` (one gauge per `Readout.gauge`: `ruler`, `meters`,
    `transition`); `structure-outline.tsx` `StructureOutline({ diff, collapseUnchanged?, colors? })`
    (native `<details>` groups, `+ ~ −` gutter, `data-diff-row`/`data-change` per row);
    `track-swatch.tsx` `TrackSwatch({ color? })` (6px); `sample-delta.tsx` `SampleDelta({ samples })`;
    `diff-chip-list.tsx` `DiffChipList({ chips, compact? })`; and `save-diff-controls.tsx` (`"use client"`)
    `SaveDiffControls({ changes, defaultMode, children })` with `SaveDiffModeSwitch` and `SaveDiffStepper`,
    which read the card's DOM through those data attributes and receive no data (key it by the compared
    pair; `changes === 0` always shows the whole set; a clicked bar whose row sits under a `data-unchanged`
    element switches to the whole set, through `flushSync`, before scrolling to it). Then
    `save-timeline.tsx` `SaveTimeline({ entries, hrefFor, link?, marked?, asOf?, format?, timeZone? })`
    and the `SaveTimelineEntry` type (the project feeds' timeline; a session's own saves draw as `SaveLog` rows).
    `save-row-body.tsx` `SaveRowBody({ at, stamp, title?, machineName, source?, chips, empty?, trailing? })` is the
    one body a save row reads, whoever lists the save (time, machine, source chip, chips or `empty`, "Saved,
    nothing tracked changed" by default): `SaveTimeline`'s entries and the log's save rows both draw it,
    passing `source`; the dit app's panel leaves `source` out (every row is its own) and words `empty` itself.
    `commit-log.tsx` `CommitLog({ entries, uncommitted?, format?, asOf?, marked?, renderCommitActions,
    renderSaveActions })` and `SaveLog({ saves, format?, marked?, renderSaveActions })`: a dit set's commit log as
    rows (message, author, machine, time since, time in the set, chips, a native `<details>` fold of the saves a commit covers, the
    checkpoints folded under it, the actions the caller hands over), `commitRowId`/`saveRowId` the ids a row
    carries; its model is `lib/commit-log.ts` (`buildCommits`, `knownSaves`, `foldLog`, `foldLabel`, `foldedTimeInSet` (a named row's own time plus its checkpoints', null when none is known),
    `uncommittedSaves`, `compareHref`/`clearCompareHref` (the address as shown, so `commits` and `checkpoints`
    stay), `ditCheckoutCommand`). `commit-ruler.tsx` `CommitRuler({ commits, saves, marked?, format?,
    asOf, onReveal, onCompare, onClear })` (client, router-free) draws the session's history on a time axis, one lane
    per machine (one on a phone); its model is `lib/commit-ruler.ts` (`rulerStates`, `lanesOf`, `rulerSpan`,
    `brushed`, `compareOf`, `compareOfBrush`, `step`) over `lib/ruler-scale.ts`'s `timeRuler`.
    `link` is the component each entry links through (`TimelineLink`, an alias of `LinkComponent` from
    `anchor.tsx`: `{ href, className, children }`), a plain `<a>` (`Anchor`) by default; the client hands it
    `AppLink`. `format` is the viewer's formatter set the card and the timeline write and zone their days and
    times by; a static page passes `timeZone` instead (the defaults in that zone, the runtime's own when
    absent), so it renders the same HTML on any build machine. The data they draw comes from
    `@workspace/session-diff`.
- **`block-editor/`** — see the dedicated section below.
- **`forms/`** — `form-controller.tsx` (`FormController<T>`, `FormControllerType = "title" | "input" |
  "select" | "blocknote"`, a `trailing` prop that switches the default case to an
  `InputGroup` for an inline remove/action button), `auth-card.tsx` (`AuthCard` — tabs
  composed from children: `AuthCard.Guest`, `AuthCard.SignIn` (`recovery?`, `defaultEmail?`, `lockEmail?`) and
  `AuthCard.Register` (`defaultEmail?`, `lockEmail?`) are the only legal children, recognised by component
  identity; anything else, or no child at all, throws. Children order is tab order and the first is selected;
  one child renders no tab bar, two use `grid-cols-2`, three `grid-cols-3`. `title` absent derives the heading
  from the tabs: "Sign in" without a register child, "Create an account" for the register child alone,
  "Sign in or create an account" otherwise. `description` absent is derived the same way, one phrase per tab
  ("Sign in, or continue as a guest.", "Sign in, or create an account to get started."; "to get started" only
  without a guest tab). `onSuccess` is the card's own and reaches every form. A kind may appear once; a repeat throws. `lockEmail` only locks when `defaultEmail` is set. The three markers live in
  `auth-card-tabs.tsx` as `AuthCardGuest`/`AuthCardSignIn`/`AuthCardRegister` (no forms, zod or auth client
  behind them) and `AuthCard.Guest` etc. are those same components; a lazily loaded (`next/dynamic`) card,
  which carries no statics, takes its children from `auth-card-tabs`. `recovery` is `SignIn`'s, for a caller whose
  sign-in states need their own copy), `login-card.tsx`
  (`loginSchema`, `LoginForm` — takes `recovery?: {kind:"link",href} | {kind:"message",text}`, an explicit
  variant rather than two optional props, rendered under the password field), `register-card.tsx` (`registerSchemaFor(rule)`, `RegisterForm` — takes `passwordRule?`, the instance's
  `{passwordMin, passwordMax}` from `GET /api/instance`, which `AuthCard.Register` passes through; `lib/password-rule.ts`
  holds `PasswordRule`, `newPasswordSchema(rule, label)` and `WIDEST_PASSWORD_RULE`, the 8–128 fallback built from
  `@workspace/settings/bounds` (the one package-level dependency on the settings package), which the client's reset
  and change-password forms use too),
  `guest-card.tsx` (`guestSchema`, `GuestForm` — anonymous sign-in via
  `authClient.signIn.anonymous`, then sets the display name). All three non-guest forms accept an
  `authClient` override and a `submit` override (`LoginSubmit`/`RegisterSubmit` from `lib/auth-forms.ts`)
  for a caller that routes credentials somewhere other than a Better Auth client in the page. Imported as `@workspace/ui/components/forms/<file>`.
- **`confirm-delete-dialog.tsx`** — `ConfirmDeleteDialog`, an `AlertDialog` wrapper replacing
  `window.confirm` (blocks the event loop, unstylable); confirm button is always the destructive
  `AlertDialogAction` variant (`alert-dialog.tsx`'s `AlertDialogAction` takes the same `variant`
  prop as `Button`, default `"default"`) and disables while `onConfirm` is in flight. `finalFocus` (Base UI's
  popup prop) says where focus goes on close, for a confirm whose action takes its own trigger off the page.
  `AlertDialogAction`/`AlertDialogCancel` are Base UI `AlertDialog.Close` buttons; an `onClick` that calls
  `preventDefault()` maps onto `event.preventBaseUIHandler()` and keeps the dialog open, which is how the
  confirm holds it open during `onConfirm` and closes it through `onOpenChange(false)` afterwards. An optional
  `confirmText` prop adds a labelled "Type {confirmText} to confirm" input and keeps Delete disabled
  until it matches exactly — `DeleteProjectButton` passes the project's name so deleting a whole
  project needs it typed back.
- **`command-bar/`** (`@workspace/ui/components/command-bar`) — `CommandBar({ state, commands, position:
  "bottom" | "top", mode: "always" | "pending", prompt?, children?, className? })`: the 40px sunk key strip
  (`DESIGN.md` › Catalogue › Key strip). At rest it shows `commands` (`CommandBarCommand` `{ id, keys, label }`,
  each command's keys side by side in one bare `Kbd`, commands with no keys left out); while `state.pending`
  or `state.count` is set it shows what has been typed (`3g`) and, with a chord pending, `state.candidates`;
  `children` trail at the bar's end in both. `prompt` (`CommandBarPrompt` `{ open, value, onChange,
  onSubmit?, suggestions, onClose, lead?, placeholder? }`, controlled) replaces the bar's content with the
  typed line while `open`: suggestions (`CommandBarSuggestion` `{ id, label, hint?, run }`) in an overlay
  surface away from the bar's edge, ↑↓ or Ctrl-N/P move, Tab completes, Enter runs the active suggestion or
  `onSubmit(value)` (and waits when there is neither), Escape or blur calls `onClose`; the field is an ARIA
  combobox. `mode="pending"` renders nothing while nothing is pending or prompting. `position` picks the
  edge (`footer` + top hairline, or `header` + bottom hairline). `CommandHint({ keys, label, className? })`
  is one hint (nothing when `keys` is empty), for trailing content. Keys print through `formatCombo`.
- **`kbd.tsx`** — `Kbd`, a key in Departure Mono and ink: `variant="cap"` (default, hairline-edged key cap)
  or `"bare"` (the glyph alone, the command bar's hints).
- **`drop-zone.tsx`** — `DropZone` (`onFiles`, `accept`, `multiple`, `disabled`), `dropZoneSurface`,
  `dropZoneLabel` class strings. Behaviour lives in `hooks/use-file-drop.ts`.
- **`haptics.tsx`** — `HapticsProvider({ enabled })` (one delegated capture-phase `pointerdown` listener buzzing
  any pressable element that doesn't ring for itself — menu items, tabs, options, slider thumbs are excluded;
  with `enabled` false there is no listener and nothing buzzes), `useHaptics()` (safe to call unconditionally; a
  no-op outside the provider or while it is disabled). Touch-only — a mouse press never buzzes.
- **`switch.tsx`** — `Switch`, Radix-backed on/off control drawn on the spine (ink when on).
- **`theme-provider.tsx`** — `ThemeProvider` (wraps `next-themes`; `bindThemeHotkey` prop —
  `true` binds its own `d`-key listener; an app with a hotkey registry passes `false` and binds `d` there
  instead so there is one dispatcher), and `useTheme`, re-exported so an app sets the theme without
  importing `next-themes` itself. `useThemeHotkey(toggle)` is the `d` listener (a bare
  `d` outside a text field, no modifier, no repeat), which the client's `AppThemeProvider` binds signed out.
- **`motion-provider.tsx`** — `MotionProvider`: `LazyMotion features={domMax} strict` around `MotionConfig
  transition={SPRING.control}`, whose `reducedMotion` follows `data-motion` on `<html>` live (`system` →
  `"user"`, `reduce` → `"always"`, `full` → `"never"`), mounted once inside `ThemeProvider` in both the
  client's root layout and the dit app's `main.tsx`. `strict` means every animated element goes through the
  `m` component from `lib/motion.ts`, never a bare `motion` import. `lib/motion.ts` re-exports `m` (from
  `motion/react-m`) and the rest of the Motion hooks/types (from `motion/react`), plus the shared
  `SPRING`/`FADE`/`LEAVE` transitions and `SURFACE`/`POP`/`OPTICAL` variants every animation is built from —
  no literal duration or spring at a call site. Its `useReducedMotion()` (same signature and SSR default as
  Motion's) is the OS preference as `data-motion` overrides it, so every reader follows the one switch.
- **`motion/arrival.tsx`** — the page arrival system (`"use client"`). `ArrivalRoot({ kind, as?: "div" |
  "header", ref?, className?, style? })` is an `m.*` element holding `initial="hidden" animate="shown"` for
  its whole subtree, so each part picks its state up through Motion's variant context instead of a prop
  threaded through the server components between them; it carries `data-arrival="load"|"nav"` until its own
  and every propagated child animation has completed, which is what scopes the status pie sweep in
  `globals.css` to a first load. `useArrivalKind()` returns `"load"` when the mount's first client render
  was the hydration pass and `"nav"` when it mounted after (pure `arrivalKind(hydratedAtMount)` beside it).
  `ARRIVAL` is the spec — one `{ delay, dur, motion: "bloom" | "rise" | "fade" }` per part (art, wash,
  crumbs, eyebrow, title, byline, audio, rail) — and `useArrival(part)` returns the `{ initial, variants }`
  a part spreads onto its `m.*` element: the load plays the stagger, a navigation crossfades over
  `FADE.move`, and `initial` is `false` once the page has settled so a remounting title or audio block
  appears in place (pure `arrivalVariants(kind, part)` beside it). `useArrivalSettled()` exposes the same
  `settled` flag on its own, for a part that binds motion values of its own once the entrance is done
  (the client's scroll-driven masthead).
- **`logo.tsx`** — `Logo`, an `IconSvg` rendered from `lib/logo-paths.ts`'s shape data (shared with Satori
  PWA icon routes, which cannot consume Tailwind classes or `IconSvg`).
- **Interaction precedents for a new drawing:** the one pan, zoom, wheel and pinch surface is the
  `Constellation` (below), and it is sigma's own camera, not a hand-rolled handler; the only pointer-capture
  drag is the client Lab's `EqCurveOverlay` (a 1-D handle on a fixed `viewBox`), and dnd-kit is used only for
  board cards. `chart.tsx` (Recharts) has no call site. A server-rendered drawing that a client leaf lights
  and steps through follows `SetSkyline` + `SaveDiffControls` (per-item `data-*` indexes, the leaf reads the
  DOM and never the data).
- **`constellation/constellation.tsx`** — `Constellation({ data, label, highlight?, link?, className? })`, a
  client leaf (`"use client"`; sigma touches `WebGL2RenderingContext` as it loads, so a Next caller imports it
  with `next/dynamic` and `ssr: false`, as the client's `InventoryConstellation` does). A pannable, zoomable
  node-link web in WebGL through sigma v3 and `@react-sigma/core`'s `SigmaContainer` (its stylesheet is not
  loaded: it paints the container white; the container is transparent over the paper). `data` is a
  `ConstellationData` from `lib/constellation.ts` with every position already settled; the component never
  lays anything out, and a new `data` with the same `key` keeps its graph and so its camera. Sets are
  circles (sigma's `NodeCircleProgram`), items squares (`node-square-program.ts`: sigma's point program with
  a fragment shader that fills the sprite), edges `EdgeRectangleProgram`. Colours come from
  `palette.ts`'s `readPalette(element)`: `--ink`, `--ink-soft`, `--ink-faint`, `--rule`, `--paper`, `--art` and
  `--warn` off the computed style, each painted onto a one-pixel canvas and read back as sRGB, read again
  whenever the root's `class` or `style` changes (a `MutationObserver`, since the app's theme provider writes
  the class after `resolvedTheme` has already changed). WebGL colours go through `gl()`, which premultiplies (sigma
  blends `ONE, ONE_MINUS_SRC_ALPHA` but its shaders emit straight colour); label colours through `css()`. At
  rest sets are faint ink, items soft ink, a `warn` item `--warn`, edges mix faint to soft ink with alpha
  0.1–0.55 by their weight. Hover (a mouse only, and never mid-drag) or a pin (click or tap) holds a node:
  it, its neighbours and its edges go `--art` (a `warn` node stays `--warn`) through the node and edge
  reducers, everything else drops to 22 % with its label blanked, and only the changed items refresh (a whole
  refresh only when the room goes from unlit to lit or back). A neighbourhood of up to 40 nodes names every
  neighbour; a larger one leaves the names to sigma's label grid. The held node's name is in its note
  instead of on the canvas: a `FloatingNote` (`placement="beside"`) on hover, a `Popover` on a pin, both
  anchored to a span the component keeps over the node (moved on every `afterRender`). The note shows the
  label, the meta, the `count` line and, pinned only, the node's `link` through `link` (a hover's note is a
  glance; the node itself never navigates). A pin outranks the hover; a second click on the node, a click on
  empty paper (`clickStage`) or Escape lets go, and a press on the canvas is left to sigma rather than
  closing the popover. A camera move drops the hover. `highlight` lights the nodes whose label or meta holds
  it (`matchesOf`) while nothing is held, and animates the camera to frame them (`fitOf`); no match lights
  nothing. The canvas is a focusable `role="img"` named `label`: arrows pan, `+`/`=` and `-`/`_` zoom, `0`
  fits, Escape lets go. Three `IconButton`s (`size="touch"`) at its top right zoom in, out and fit. Camera:
  `minCameraRatio` 0.05, `maxCameraRatio` 1.25, `cameraPanBoundaries`, `hideEdgesOnMove`, and every duration
  0 under `useReducedMotion`. With no WebGL, or once a canvas fires `webglcontextlost`, it renders one line in
  soft ink instead: "Your browser can't draw the web." `constellation-frame.tsx` (server-safe) holds
  `CONSTELLATION_FRAME` (`min(70vh, 720px)`, `phone:` 60vh, a hairline above and below) and
  `ConstellationPlaceholder`, the same box with a faint `Spinner`, for a Suspense fallback or a dynamic
  import's `loading`.
- **`patchbay/patchbay.tsx`** — `Patchbay({ layout, leftHead, rightHead, summary, link? })`, server-safe: the
  project home's compact two-rail readout (left nodes, right nodes, one hairline cable per use in one `<svg>`
  between them), laid out by `layoutPatchbay` with its caps. Three columns, each rail an
  `ol[data-pb-rail="left"|"right"]` under a head; every row is `PATCHBAY_ROW_PX` (24) tall (`--pb-row` on the
  root), so a cable runs row centre to row centre with no measuring. The root carries `data-pb-root`; each
  node `li` carries `data-pb-node={id}`, `data-pb-side` and `data-missing`, and its row
  is its index in its rail's `ol`; each `path` carries `data-pb-cable="{leftId}|{rightId}"` and
  `data-missing`. A row is a dot (hollow when missing, with a screen-reader "missing"), the label in ink
  (inside `link` when `href`: a `LinkComponent`, a plain `<a>` by default, and every client caller passes
  `AppLink` so a click is a router navigation that keeps playback), `meta` in soft ink and "+{n} own" on a left node; missing cables are dashed; a
  capped rail ends in "+{n} more". The `<svg>` is the `role="img"` named by `summary`
  (`preserveAspectRatio="none"`, `vector-effect="non-scaling-stroke"`, `viewBox` 100 wide × rows × row
  height); the rails stay outside it so their labels and links stay readable. `--art` appears only in the lit
  state: the root is `group/patchbay`, and a node `li`, a cable `path` and the node's dot restyle on
  `data-hot` (opacity 100, `--art` stroke or fill) while `data-dim` on the root fades every unlit node and
  cable to 35 %, the transition opacity and stroke only and `motion-safe:`. A node with no `href` is
  `tabIndex=0`; one with an `href` is focused through its `<a>`. The label and meta carry `data-pb-label` and
  `data-pb-meta` for the note to read.
- **`patchbay/patchbay-controls.tsx`** — `PatchbayControls({ className?, children })`, the client leaf that
  wraps the drawing: `<PatchbayControls><Patchbay … /></PatchbayControls>`. It finds `[data-pb-root]` inside
  its one `relative` wrapper and writes attributes only: `data-hot` on the node, its cables and its
  neighbours, `data-dim` on the root (a cable's ends are matched by cutting the value at the node's own id,
  never by `split("|")`, since a right id is a path). What lights, strongest first: a pin (a click; a second
  click or Escape lets go), the mouse pointer (hover; touch and a coarse primary pointer light nothing), focus
  (not the focus a mouse press causes). `[`/`]` walk the left rail then the right in layout order, wrap, skip
  typing targets, and carry a pin along. The lit node's label and meta show in a `FloatingNote` on a fine
  pointer and in a `Popover` (`aria-label` the label, no focus taken) on a coarse one; Escape dismisses the
  note and unpins, focus or hover keep the node lit. A new render of the drawing (the server's, after a
  refresh) repaints the lit state, since the nodes and cables it reuses keep the attributes the last
  lighting wrote.
- **`heatmap.tsx`** + **`lib/heatmap.ts`** — `levelFor`, `heatmapCells`, `heatmapDays`, `streaks`, `HeatmapCell`. Every
  date is a UTC calendar day (the API already buckets `day` strings into the viewer's local day); mixing
  local `Date` construction with `getUTC*` readers slides a day. `streaks(days, asOf)` takes its reference
  day as a parameter so server render and hydration agree across midnight. Cell colour grounds on
  `--paper-sunk` (not `transparent`) so a zero-save day still renders as a visible cell.
  `heatmapCells(days, from, to, weekStart = 0)` pads back to the first day of `from`'s week (0 Sunday, 1
  Monday, 6 Saturday; `Heatmap`'s `weekStart` prop, the viewer's `format.weekStart`, which also rotates the
  weekday initials) and `Heatmap` lays cells 7 rows per week column, so a window of one
  week draws as a column (two partial ones on most days), not a row; `Heatmap` is a server component unless
  `onSelectDay` is passed, when every dated cell becomes a button. Two props: `layout="strip"` draws
  `heatmapDays(days, from, to)` (the plain `[from, to)` days, no Sunday padding) in one row with no month row
  or weekday column (`compact` implied), for a window too short for the grid; `sweep` rises the dated cells
  on mount — each gets `--i` (its index among dated cells), the grid gets `--n`, and `.heatmap__cell--sweep`
  in `motion.css` runs `bar-in` staggered over `--dur-settle` like `.skyline__bar`, `animation: none` under
  reduced motion. Neither the variables nor the class render without `sweep`, so the default markup is
  unchanged.
- **`layout/`** — `rail.tsx` (`RailIdentity`, `RailBlock` with a `grid` prop (a two-up pair, key/BPM) and a
  `rows` prop (a vertical pair of full-width fields, for values too long for a column at rail width —
  created/updated timestamps), `RailLabel`), `rail-more.tsx`
  (`RailMore({children, more})` — folds `more`, the rail's tail, behind a "More details" toggle below `md:`, dissolves into
  `md:contents` above it; uses the `hidden` *class*, not the `hidden` *attribute*, because Tailwind
  preflight's `[hidden]{display:none!important}` beats any utility), `rows.tsx` (`Rows`/`Row`/`RowMain`/
  `RowTitle`/`RowMeta`/`RowNum` — polymorphic `as` prop, hairline-divided list rows), `collapsible-section.tsx`
  (`CollapsibleSection`, `keepMounted` prop for content holding state a remount would lose, `prominence`; the
  head drops its bottom margin while folded), `empty-section.tsx` (`"use client"`; the fold mechanism.
  `SectionFold` is a page-scoped provider rendering no element; it holds a small external store read with
  `useSyncExternalStore`, so a section joining or leaving re-renders only `AddLine`, not the page.
  `EmptySection({ label, empty, add?, addControl?, emptyLabel? })` (throws outside `SectionFold`) renders
  `children` inside a `SectionArrival` when not empty; empty with `add`/`addControl`, it renders only a hidden
  `<span data-slot="folded-section">` anchor and registers `{ id, anchor, add, addControl, reveal }` from an
  effect keyed on the anchor, unregistering when the anchor unmounts (reveal, or data fills it); empty with
  neither, it renders its `emptyLabel` line or nothing. The store sorts entries by the anchors'
  `compareDocumentPosition`, so a section resolving late inside Suspense lands in page order.
  `AddLine({ label })` renders a `role="group"` labelled by an `<h2>` section title, then each entry's
  `SectionAdd` (calls `reveal`) and `addControl` node, middot-separated, each inside `AnimatePresence
  initial={false}` so a dropped entry leaves with `OPTICAL.leaving`; nothing when the store is empty
  (always on the server render). `reveal` renders the children in place inside `SectionRevealedContext`, in
  an `m.div data-slot="revealed-section"` animating `height: 0 → "auto"` and opacity on `SPRING.surface`/
  `FADE.move` with `overflow: hidden` released once the animation completes, and moves focus in: to the
  first focusable in the region marked `REVEAL_FOCUS` (waiting on a `MutationObserver` for an editor that
  mounts late), else the first focusable, else the wrapper, leaving focus alone if a child autofocused or
  the user moved it; the line's button that triggered the reveal (`origin`) does not count as
  "moved", since it is still mounted when the effect runs. `useSectionRevealed()` lets content open its
  editing UI on reveal. `SectionAction` is the quiet `--art` text button; `SectionAdd` wraps it as
  `+ {children}` with a visually hidden "Add " so its name is "Add Relation"), `scroll-root.tsx`
  (`"use client"`; `CanvasRootProvider({ containerRef })` publishes the element a page scrolls in and
  `useCanvasRoot()` reads it — `undefined` where the page scrolls the document, which is the viewport.
  `ScrollRoot({ className })` is the plain version of that element for a page with no entity behind it:
  the `SCROLL` classes, the ref and the provider in one. An entity page's canvas is its own
  `ArtProvider`), `section-arrival.tsx` (`"use client"`; `SectionArrival` wraps every section
  `EmptySection` renders. One effect at mount compares the section's top with the canvas's bottom; a
  section already inside it is never touched, and one below the fold takes `opacity: 0` / `y: 12` on two
  motion values, carries `data-arrival="waiting"`, and is handed to Motion's `inView` against the canvas
  (`amount: 0.15`, `margin: "0px 0px -10% 0px"`), which reports once and then stops watching. The rise is
  dropped under reduced motion), `arrive.tsx` (`"use client"`; `Arrive` crossfades content that mounts
  after hydration — streamed behind a skeleton, refetched, or a lazy chunk such as the block editor —
  over the place its skeleton held, and renders content that was part of the first paint with no inline
  state at all; the two cases are `useArrivalKind()`. The fade is a motion value, not `initial`/`animate`:
  an `AnimatePresence initial={false}` ancestor — every `Collapsible` and `EmptySection` reveal — makes
  Motion render a descendant's `animate` state in place of its `initial`, so a prop-driven entrance
  never plays there), `loading.tsx`
  (`Loading` — Suspense + `Spinner` fallback), `metadata-item.tsx` (`MetadataItem`, renders "Not set" in
  quiet italic when empty, same treatment while `pending`), `page-head.tsx` (`"use client"`; `PageHead`,
  `size="title"|"subtitle"`; the arrival root of a page with no entity behind it — its title and lede are
  the `title`/`byline` arrival parts), `section-head.tsx` (`SectionHead` with `count`, `action`, `prominence` `"default"|"primary"`, `as` `"h2"|"h3"|"h4"` for a group head inside a section, or inside an `h3` item of one;
  `sectionTitle(prominence)`, `SectionCount`).
- `lib/overlay.ts` (no `"use client"`: client components import its plain constants, and the directive
  would turn them into client references for a server importer) — `OVERLAY_SURFACE`, `OVERLAY_TITLE`,
  `OVERLAY_DESC`, `MENU_LABEL` class strings for one dialog/popover/menu treatment; `BACKDROP` (modal scrim,
  static blur, unselectable) and `POPUP` (centred modal panel; centring is Tailwind's `translate`
  property, which composes with the `transform` Motion writes, so a consumer's `translate-y-0` /
  `top-*` override still works); `ENTRANCE` (`pop` = `SURFACE`, `sheet` = rise from 24px below);
  `composeRender(props)` turns `asChild` + a single child into Base UI's `render` prop, so wrappers keep
  accepting `asChild`.
- `lib/overlay-presence.ts` (`"use client"`) — the presence plumbing every Base UI overlay wrapper uses for
  Motion enter/exit. `useOverlayOpen<Details, Actions>({open, defaultOpen, onOpenChange,
  onOpenChangeComplete})` returns `rootProps` (spread on the Base UI `Root`: mirrored open, wrapped
  callbacks, `actionsRef`) and `presence` (provide through `OverlayPresenceContext`; content reads it
  with `useOverlayPresence(name)`: `open`, `reason()` — last change's Base UI reason, `actionsRef`,
  `onExitComplete`). Content renders `AnimatePresence onExitComplete={presence.onExitComplete}` →
  `{open && <Portal key keepMounted>}` → parts with `render={<m.div {...PRESENT} variants… />}`. A close
  Base UI reports calls `eventDetails.preventUnmountOnClose()`, and `onExitComplete` calls
  `actionsRef.unmount()`, so focus return, scroll lock and `onOpenChangeComplete(false)` land when the exit
  ends (once). A controlled `open={false}` has no event to prevent: Base UI finishes its bookkeeping at
  once and would mark the parts `hidden`; `PRESENT` (`{ hidden: false }`, merged last by Base UI's
  `render`) keeps them visible through the exit. Motion's `m` components need `MotionProvider` above
  them (no features → `AnimatePresence` never completes an exit), so tests that close an overlay render
  with `{ wrapper: MotionProvider }` and Testing Library's `waitFor` (it flushes the exit's React
  updates inside `act`; `@workspace/test/wait-for` does not). `lib/table-config.ts` — TanStack v9 `dataTableFeatures`,
  `dataTableFeatureSlots`, `createDataTableHelper`, `DataTableColumns<T>`, `dataTableDefaultColumn`
  (`sortUndefined: "last"` so nullable music-metadata columns sink rather than scatter),
  `dataTableColumnResizeMode`, `DataTableColumnMeta`. `lib/shell.ts` — `COLUMN`, `LABEL`, `EYEBROW`,
  `SIDEBAR_EYEBROW`, `SECTION_TITLE`, `SECTION_TITLE_PRIMARY` (body size, full ink), `SECTION_HEAD` (the head row
  and the one section rhythm: `mb-3.5` below, the page gap above), `CAPPED_CHILDREN`, `PAGE`, `PAGE_WIDE`, `SCROLL`, `REVEAL_ON_HOVER`
  — the page-frame class strings (centred/capped content column, tracked-caps label shapes, bottom padding
  that clears `--dock`).

### Custom shadcn-derived component APIs

- **Empty**: `Empty > EmptyHeader > EmptyMedia (variant default|icon) > Icon`, then
  `EmptyContent > EmptyTitle + EmptyDescription`, then action buttons. Dashed border, centered.
- **Spinner**: `IconLoader` size-4 animate-spin, `role="status"`, props = svg props.
- **Field** (`"use client"`): `Field orientation?: vertical|horizontal|responsive` (responsive via
  `@md/field-group` container query), `data-invalid` styling; `FieldSet > FieldGroup > Field`;
  `FieldLegend variant="legend"|"label"`. `FieldError errors?: Array<{message?}|undefined>` dedupes +
  renders a list. Form convention (`forms/form-controller.tsx`): react-hook-form `<Controller>` renders
  `<Field data-invalid={fieldState.invalid}> <FieldLabel htmlFor/> [FieldDescription] <Control/>
  <FieldError errors={[fieldState.error]}/> </Field>`.
- **InputGroup** (`"use client"`): h-7 bordered composite; focus ring delegated to
  `[data-slot=input-group-control]` child. `InputGroupAddon align=inline-start|inline-end|block-start|
  block-end` (click focuses input). `InputGroupButton` ghost `Button` sizes xs|sm|icon-xs|icon-sm.
  `InputGroupInput`/`InputGroupTextarea`. Composer convention: `InputGroup > InputGroupTextarea +
  InputGroupAddon align="block-end" > InputGroupButton`; `FormController`'s `trailing` prop uses
  `InputGroup > InputGroupInput + trailing`.
- **Sidebar** (`"use client"`, shadcn v2): cookie `sidebar_state` (7d, written but nothing reads it),
  widths 16rem/18rem mobile/3rem icon, shortcut **Ctrl/Cmd+B**. `useSidebar()` context.
  `Sidebar side=left|right, variant=sidebar|floating|inset, collapsible=offcanvas|icon|none,
  mobile="sheet"|"hidden"` (default `"sheet"` swaps to a `Sheet` below the mobile breakpoint; `"hidden"`
  drops the phone sidebar entirely — the client's `ResponsiveSidebar` passes `"hidden"`).
  `SidebarMenuButton asChild isActive tooltip=...` (auto-tooltip when collapsed), sizes default h-8/sm
  h-7/lg h-12 (lg is the only ≥44px control in the sidebar). `SidebarInset`/`SidebarRail` are unused.
- **Sheet** (`"use client"`, Base UI `Drawer`: `Root` → `Portal keepMounted` → `Backdrop` → `Viewport` →
  `Popup` → `Content`): `SIDE_CLASSES: Record<SheetSide, string>` (placement only) and `EDGE_SPACER` (a
  flex-item `::after` safe-area spacer, not padding) are exported so geometry is applied as
  `cn(PANEL, SIDE_CLASSES[side], className)` on the Popup (`data-slot="sheet-content"`) — a consumer's
  width/height classes win because they are ordinary utilities, not `data-[side=…]:` variants that would
  out-rank them on specificity. The Drawer `Content` (`data-slot="sheet-body"`) is `display: contents`, so
  children stay flex items of the panel. The Root's `swipeDirection` follows `SheetContent`'s `side` and
  `disablePointerDismissal` its `dismissOnOutside`; the content hands both up through `SheetContext`.
  Two properties move the panel, one owner each: `transform` is the swipe's (Base UI writes it inline while
  dragging and sets `--drawer-swipe-movement-x/y` on the Popup; those variables are registered
  `inherits: false`, so only the Popup can read them), `translate` is Motion's (`sheetVariants(side,
  entrance, reducedMotion)`: slide on `SPRING.drawer`, leave on `LEAVE.settle`, a swipe-dismissed sheet only
  fades). `SheetContent` props beyond Base UI's Popup: `side`, `showCloseButton`, `overlayClassName`,
  `onClosed` (once, after the exit, the popup's removal and focus return — a sentinel inside the popup
  schedules it a frame after the commit that removes it; works for event-driven and controlled closes),
  `dismissOnOutside` (default `true`), `swipe` (default `true`; `false` sets `data-base-ui-swipe-ignore` on
  the Popup), `entrance: "slide" | "fade"`, `modalScope` (default `true`: the sheet pushes the client's modal
  command scope while open through `lib/modal-scope.tsx`, silencing the page's keys as a dialog does; `false`
  for a sheet beside content still in use, the peek panel), `ref` (the Popup). `SheetOverlay`/`SheetContent` are
  `select-none [-webkit-touch-callout:none]` (a long-press opening a sheet must not let WebKit's selection
  recognizer anchor to the page behind the scrim); `DialogContent` stays selectable because it hosts inputs.
- **item.tsx**: shadcn primitive.
- **chart.tsx**: `ChartConfig = Record<string, {label?, icon?} & ({color?} | {theme:{light,dark}})>`;
  `ChartContainer` wraps Recharts `ResponsiveContainer`, injects `--color-<key>` vars.
- **sonner.tsx**: `Toaster` themed by its `theme` prop when given one (the client passes `AppThemeProvider`'s
  `resolvedTheme`), otherwise via next-themes (the dit app); `ToastHaptics` (rings a haptic once per toast that
  carries an outcome — success/warning/error, never info/loading — tracked by id so a re-render doesn't
  buzz twice); `offset`/`mobileOffset` clear `--dock` (`calc(var(--dock) + 2rem)` desktop, `+ 1rem`
  mobile) so a toast sits above the tab bar / mini-player; Tabler icons per toast type.

### `lib/` and `hooks/`

- `lib/utils.ts` — `cn()` (see above; not a bare `twMerge(clsx(...))`).
- `lib/auth-forms.ts` — `AuthSuccess` (`{token, email, password}`), `AuthSubmitResult` (`{token} | {error}`),
  `LoginSubmit`, `RegisterSubmit` — the seam that lets a caller route credential exchange
  through something other than a Better Auth client in the page.
- `lib/sign-in-state.ts` — `signInState({hasUsers, registration})` → `{kind: "first-account" | "closed" | "open",
  hideRegister, defaultTab}`, the one rule the client's sign-in card and a connect screen share
  (`hasUsers: false` wins over `registration`); each app words the kinds itself.
- `lib/keymap/` (`@workspace/ui/lib/keymap`) — the keys grammar and the keymap engine the dit app's
  panel runs on.
  - `targets.ts` — `isTypingTarget`/`isActivationTarget` recognise their target by shape, not
    `instanceof`, so they answer correctly across realms and in a DOM-free test.
  - `parse.ts` (re-exports `@workspace/settings/keymap`, where the pure grammar lives so the server reads it
    too) — `Combo` (a
    canonical string), `KeyEventLike`, `canonicalCombo(event)` → `Combo | null` (null for a bare modifier,
    Caps Lock, a dead key, a media key), `parseCombo(text)` → `Combo | null`, `isValidCombo(text)`. The
    grammar: modifiers `mod` (⌘/Ctrl), `shift`, `alt` in that order, `+`-joined; a letter is lowercase and
    an uppercase one is `shift+<letter>`, read from the key value (Caps Lock `J` is `shift+j`) except under
    `mod`/`alt`, where `shift` comes from the Shift key (`mod+shift+z`); any other printable character is
    what the browser delivered with no `shift` (`?`, `<`, `:`; `shift+1` is invalid); named keys keep the
    browser's `KeyboardEvent.key` names (`ArrowDown`, `Enter`, `Escape`, `Tab`, `Backspace`, `Delete`,
    `Insert`, `Home`, `End`, `PageUp`, `PageDown`, `F1`–`F24`) and report `shift`; the space bar is `space`
    (never `shift+space`); a chord is two presses opening on a bare `a`–`z` (`g t`). `parseCombo` reads
    either vocabulary (`down`/`ArrowDown`, `enter`, `escape`, `J`, modifiers in any order and case) and
    answers canonically, so stored combos compare as strings.
  - `types.ts` — `Binding<Id>` `{ id, keys, scope, alsoIn?, when?, label, group?, countable?, allowInInput? }`,
    `KeymapState<Id>` `{ scope, pending, count, candidates, conflicts }`, `KeymapRun` `{ count, combo }`,
    `KeymapOverrides` (id → combos; `[]` unbinds), `KeymapEvent`, `KeymapOptions`, `ScopeOptions`, `Keymap`.
  - `keymap.ts` — `createKeymap({ bindings, overrides?, onRun, chordWindowMs?, repeat? })` →
    `{ dispatch, subscribe, state, pushScope(name, { modal? }) → release, popScope, setOverrides,
    setBindings, bindings(), reset }`; `CHORD_WINDOW_MS` (1200, the default window for a chord's second
    key and for each digit of a count), `GLOBAL_SCOPE`. Listener-free: the caller owns the `keydown`
    listener. Resolution keeps the old registry's rules (innermost active scope wins, last declared among
    equals, `when` false = unbound, typing targets only reach `allowInInput`, space/Enter left to a focused
    control, handled events skipped, auto-repeat skipped unless `repeat`); a modal push silences every
    scope beneath it, `"global"` included; a binding's `alsoIn` names scopes it also answers in, at the
    deepest one pushed, so one pushed above a modal lets the binding through it (a conflict is reported in
    each scope a binding answers in). A digit with no chord pending extends the count (not a lone `0`,
    and only while a countable binding answers) and also runs its own binding if it has one; the count
    goes to the next command if `countable`, else is dropped; Escape cancels a pending count or chord. A
    letter opening a chord waits; a single on the same letter in a scope no deeper runs when the window
    lapses or when the second key continues nothing (a deeper single runs at once); a key that breaks a
    pending chord runs as a fresh press and is consumed either way. Bare modifiers never break a pending
    state. `state()` is memoised (same object until it changes, for `useSyncExternalStore`); `candidates`
    are the chord's continuations while one is pending, else every binding a press would reach (one per
    combo; only countable ones while a count builds); `conflicts` lists same-scope duplicates after
    overrides (both are kept; the later declared wins). Invalid declared keys throw; invalid override
    combos and unknown ids are dropped. The typing and activation guards come from `targets.ts`.
  - `format.ts` — `formatCombo(combo, apple)`: a cap's text, case kept (`j`, `J` for `shift+j`), chord
    presses side by side (`gg`), named keys as glyphs or short words (`↓`, `↵`, `esc`, `space`), modifiers
    as `⌥⇧⌘` on Apple and `Ctrl+`/`Alt+`/`Shift+` elsewhere (`⌘Z`, `Ctrl+Z`).
- `lib/modal-scope.tsx` (`@workspace/ui/lib/modal-scope`, its own export since it is `.tsx`) — the seam a
  dialog primitive pushes the client's modal command scope through, since this package cannot import the
  client's registry. `ModalScopeProvider({push, children})` holds a pusher `(surface: {confirm?: () => void})
  => release`; the client's `CommandProvider` renders it with a pusher onto its own `DIALOG_SCOPE`.
  `useModalScope(open, surface?)` pushes while `open` and releases on close or unmount, reading `surface`
  through a `useLatestRef` so a new `confirm` closure every render does not re-push; with no provider above
  it (signed-out pages, the dit app, `apps/web`) it does nothing. The push is a layout effect, so it lands
  before a passive-effect push its own content makes (a list's key scope) and cannot silence it.
  `dialog.tsx`'s `DialogContent`, `alert-dialog.tsx`'s `AlertDialogContent` and `sheet.tsx`'s `SheetContent`
  call it while open; the `modalScope` prop on `DialogContent` and `SheetContent` (default `true`) is the
  escape hatch: `command.tsx`'s `CommandDialog` takes it, since the palette closes itself with a global
  command's key and must not be silenced under its own push, and the client's `PeekPanel` takes it so the
  table's keys stay live beside the panel.
- `lib/logo-paths.ts` — `LOGO: {viewBox, shapes}` — the mark as portable shape data (rect/path), shared
  between `Logo` and Satori-rendered PWA icon routes; `logoShapeKey(shape)` is the React key for a shape.
- `lib/keyed.ts` — `keyedByContent(items, keyOf)` → `{key, item}[]`: React keys from content for lists
  with no id that may repeat a value; a repeat gets `#n`. Use it instead of an index key.
- `lib/formatters.ts` — the one place a person-readable date, time, duration, size, loudness, count, key or
  tempo is written, and the only production file in the client and this package that constructs an `Intl`
  formatter. `FormatPrefs` (`locale`, `clock` `12h|24h`, `relativeWording` `short|long`, `weekStart` `0|1|6`,
  `timeZone` IANA or `"auto"`, `tempo` (`TempoPrefs` from `@workspace/session-diff/format`: `{rounding
  raw|integer|one-decimal, suffix}`), `keyNotation`,
  `playerTime`) and `DEFAULT_FORMAT_PREFS` (today's output: the package's `DIFF_FORMAT_DEFAULTS` of `en-GB`, raw
  tempo with no suffix and sharps, then 24-hour, long wording, Sunday, auto, elapsed and remaining).
  `formattersFor(prefs, resolvedZone)` → `Formatters`,
  pure: `resolvedZone` is what `"auto"` reads as; a preferred zone wins over it. Members: `date` (a bare
  `YYYY-MM-DD` is a calendar day, read the same in every zone), `dateTime`, `time`, `relative(value, now?)`,
  `dayLabel(value, asOf)` (`Today`/`Yesterday` by calendar day in the zone, else `Mon 3 Aug`),
  `calendarDate(isoDay)`, `calendarDay(value)` (the zone's day as a UTC-midnight number), `duration`, `timeInSet(seconds)` (`<1m`, `14m`, `2h 14m`, whole hours from ten: `38h`), `timecode`,
  `bytes(bytes, decimals = 2)`, `lufs`, `number`, `tempo(bpm, {unit?, whole?})` (`unit: true` where a sentence
  needs "BPM", `false` where something beside it adds it, absent under a label, when `tempo.suffix` decides;
  `whole` makes a statistic or detected tempo read whole under `raw`), `key(tonic, scale)` (`spellKey` in the
  preferred notation), and the values `keyNotation`, `weekStart`, `timeZone`, `playerTime`. Also
  `defaultFormatters(timeZone?)` (the defaults, memoised per zone: a page with no viewer), `runtimeZone()`,
  `isTimeZone(zone)`, `zonedParts(instant, zone)` (the wall clock the heatmap window's arithmetic reads). A
  figure the app has always rounded with `toFixed`/`Math.round` keeps that rounding and only takes the
  locale's decimal sign (`localDecimalPoint` from `@workspace/session-diff/format`), so the defaults cannot drift on
  how `Intl` rounds a half.
- `components/format-provider.tsx` (`"use client"`) — `FormatProvider({prefs, zone})`, `useFormat()` and
  `Formatted` (a render-prop for a table cell or a peek field, which is not a component of its own). With no
  provider `useFormat()` returns `defaultFormatters()`, which is what `apps/web` renders with. `zone` is the
  zone the server formatted in; through hydration the provider reads it (`useSyncExternalStore`'s server
  snapshot), after it the browser's own when `timeZone` is `"auto"`. A component without `"use client"` that
  formats (`SaveTimeline`, `SaveDiffCard`, `DiffReadouts`, `LoudnessReading`, `LoudnessScale`) cannot
  read the context in a server render, so it takes the set as a `format` prop instead (the client's RSC passes
  `cachedFormatters()`, a client caller `useFormat()`), falling back to `defaultFormatters(timeZone)` for a
  page rendered ahead of time.
- `lib/format.ts` — `formatTimecode(ms)` / `formatSeconds(s)` (`1:32`,
  clamped at `0:00`): the locale-free clock the formatter set's `timecode` and the player readout use.
- `lib/art.ts` — `ArtVars` (the `--art-light`/`-glow-light`/`-dark`/`-glow-dark`/`--art-image` inline
  channel), `ACCENT_TONES` (per role and theme: the fixed lightness, the chroma scale and cap; foundation.css
  derives the `--art-fallback` accent from the same numbers, and `styles/appearance.test.ts` pins them) and
  `artVarsFromAccent(hue, chroma, image?)`: when the hue is null the pair is `var(--art-fallback-*, grey)`,
  the document's no-artwork accent where one is set, grayscale otherwise. The client's `lib/art.ts`
  `artVarsFromArtwork` builds on it with the API's image URL.
- `lib/appearance.ts` — `APPEARANCE`, the appearance attributes on `<html>` as data (per preference: the
  `data-*` attribute, its values, and the default, the value with no rule that renders as no attribute at
  all), `AppearanceKey`/`AppearanceValue<K>`, `ART_FALLBACK_PROPERTY` (`--art-fallback`),
  `readAppearance(key)` (outside React; the default on the server or for an unknown value),
  `useAppearance(key)` (`useSyncExternalStore` over a `MutationObserver` on `<html>`'s attributes; reads the
  document on the first client render too, as Motion's own reduced-motion hook does) and `useDensity()`
  (`--density` as a number, read from the stylesheet once per change of `data-density`; the grid's row
  estimate uses it). Nothing in the package sets an attribute; the settings layer does.
- `lib/loudness.ts` — `formatLufs`, `formatTruePeak`/`formatTruePeakValue`, `formatSignedDecimal`,
  `loudnessMeasuredLabel(measured, total)`. `formatLufs` is the default spelling the formatter set's `lufs`
  localises, and what `apps/web` and `loudnessRuler` write with.
- `lib/ruler-scale.ts` — `positionOf(value, min, max)` (clamped percentage), `markTitle(config, mark)`:
  `RulerScale`'s arithmetic, which the client's strips and presets use too. `timeRuler(from, to, format)` is the
  commit ruler's domain: `from` and `to` are epoch milliseconds, the config has five evenly spaced stops (the ends
  included), numbered in clock times (`format.time`) when the span is a day or less and in dates (`format.date`)
  when it is longer, and an empty span (one instant) is widened to a day so a lone mark still has somewhere to
  stand. `RulerConfig`, `RulerMark` and `tempoRuler(format)` (the 60–200 BPM preset, `CollectionTempo` and the save
  diff's tempo readout) live in `@workspace/session-diff/ruler`.
- `lib/waveform-bars.ts` — `MAX_BARS` (160, the grid the strips share), `BAR_PITCH` (4 px a bar by default),
  `barCountFor(width, pitch?)` (`clamp(24, width/pitch, 160)`; the client's track page passes the visuals policy's
  `waveformDetail`), `bucketOf(seconds, duration, count?)`, `peakCeiling(...series)`,
  `toBars(peaks, count, scale?)` (bucket-max resampling against a shared ceiling).
- `lib/sample-path.ts` — `sampleFileName(path)` and `sampleFolder(path)`: a sample's display name and folder,
  split on either separator (the stored path is the saving machine's). Every surface that names a sample uses
  them (`SampleDelta`, the client's samples graph and rows, the session page's SAMPLES).
- `lib/patchbay.ts` — `PatchNode`, `PatchCable`, `PatchbayLayout`, `PatchbayOptions`, `PATCHBAY_ROW_PX` (24),
  and `layoutPatchbay(left, right, cables, options?)`: drops cables naming an unknown id and merges repeats
  (dashed if any copy or either end is missing); folds each right node with one left neighbour into that
  node's `own` count; orders the left rail by drawn cable count then label, the right by its neighbours' mean
  row (barycentre) then label, then sweeps the left once more by barycentre (ties keep the previous order);
  the `maxLeft`/`maxRight` caps cut after ordering, report the cut in `moreLeft`/`moreRight` and drop cables
  and `own` entries for cut rows. Labels compare with a fixed-locale `Intl.Collator("en", { numeric: true })`
  and fall back to id, so the result does not depend on input order or runtime locale.
- `lib/constellation.ts` — the `Constellation`'s data and pure half, importable on the server: `ConstellationNode`
  (`id`, `label`, `meta?`, `count` (the note's count line), `shape` `"circle" | "square"`, `x`, `y`, `size` (radius
  or half a square's side, screen pixels), `warn?`, `link?` `{ label, href }`), `ConstellationEdge` (a tuple
  `[source, target, weight, thickness]` by node index: weight 0–1 by the item's rarity, thickness 1–3 px, a
  tuple since a library's web carries thousands), `ConstellationData` `{ nodes, edges, key }`; `adjacencyOf`,
  `matchesOf(nodes, query)` (label or meta, case-insensitive, blank matches none), `litOf(adjacency, held,
  matches)` → `Lit` `{ held, nodes, edges }` or `null` (a held node lights its neighbourhood, else the matches
  light alone, else nothing), and `fitOf(points, minRatio)` (the camera state framing points in sigma's framed
  coordinates, the box at three quarters of the view, never past the whole drawing).
- `lib/day-label.ts` — `lastSaveLabel(since)`. A save's `Today`/`Yesterday` is the formatter set's `dayLabel`.
- `lib/globals.d.ts` — `declare module "*.css"`.
- `hooks/use-mobile.ts` — `MOBILE_BREAKPOINT = 768` (exported), `useIsMobile()` via
  `useSyncExternalStore`, server snapshot `false`. `useReducedMotion` (motion a stylesheet can't reach, e.g.
  a canvas loop) is in `lib/motion.ts`.
- `hooks/use-file-drop.ts` — `useFileDrop({onFiles, disabled})` → `{dragging, open, rootProps,
  inputProps}`; drives `DropZone`.
- `hooks/use-latest-ref.ts` — `useLatestRef<T>(value)`: a ref that always holds the most recently
  committed value, for callbacks (debounced saves, unmount cleanup) that outlive the render that made
  them.
- `hooks/use-hydrated.ts` — `useHydrated()`: false for the server render and hydration pass, true after;
  read browser-only state (URL, viewport) once it is true, often with a render-time state adjustment.
- `hooks/use-keyboard-inset.ts` — `keyboardInset(layoutHeight, {height, offsetTop})` (pure) and
  `useKeyboardInset()` via `useSyncExternalStore` over `visualViewport`'s `resize`/`scroll`, server
  snapshot `0`. `Dock.tsx` is its only consumer, writing `data-keyboard` and `--keyboard` on `body`.
- `hooks/use-scroll-restoration.ts` — `useScrollRestoration(ref, pane?)`: saves an inner scroll
  container's offset under the history entry it belongs to (`sessionStorage`, `pj:scroll`; the
  Navigation API's entry key, or a `__pjEntry` stamp in `history.state` re-applied with the same value
  whenever Next's history writes drop it) and puts it back in a layout effect on a traverse or a reload.
  A `ResizeObserver` on the container's first child re-applies the target while streamed content is
  still growing the page, until it is reached, a 1 s deadline passes, or the reader touches the page.
  `pane` separates the offsets of two containers standing on one entry (the notebook's list and
  editor). `ScrollRoot` and the client's `ArtProvider` are its only callers — between them they own
  every scroll container in the app.

### `src/styles/` — Tailwind v4 CSS-first design-token layer

Full reference in `DESIGN.md`; this is only what a package consumer needs to know.
`globals.css` imports four parts, so a surface can take only the ones it renders (exported as
`@workspace/ui/styles/*`): `foundation.css` (variants, the token spine, the art accent, the theme mapping,
motion utilities, base layer), `atmosphere.css` (the fixed layers on `<body>` and the masthead frame,
`.masthead__art`/`.masthead__scrim`, sized by `--masthead-h`), `doc.css` (the block editor's output) and
`motion.css`. The static site (`apps/web`) imports foundation, atmosphere and motion only.
`globals.css`: `@import "tailwindcss"; @import "shadcn/tailwind.css";`, a
`@source` into `apps/client/node_modules/@blocknote/shadcn` and into `../**/*.{ts,tsx}` (no
tailwind.config; PostCSS via `@tailwindcss/postcss`). Custom variants: `dark` (`.dark *`), `stack`
(`width <= 1180px`), `phone` (`width < 768px`, the same floor `useIsMobile`/`MOBILE_BREAKPOINT` use so CSS
and JS tiers can't drift), `fine`/`coarse` (hover-capable vs coarse pointer), `rail-seam` (a rail block
following another, including through the `display: contents` wrapper `RailMore` folds away), and
`motion-reduce`/`motion-safe`, which take over Tailwind's own names so that the OS preference is overridden
by `data-motion` on `<html>` (`reduce` everywhere, `full` never); each branch wraps its condition in
`:where()`, so a rule keeps the specificity the bare media query gave it. The token layer writes every
reduced-motion rule as `@variant motion-reduce { … }` except the two on pseudo-elements (`body::after`, the
`::view-transition-*` tree), which a variant cannot reach and `motion.css` spells out twice (the OS branch
and the `data-motion="reduce"` twin, pinned equal by `styles/appearance.test.ts`). `:root`/
`.dark` declare the neutral spine (`--paper/-sunk`, `--ink/-soft/-faint`, `--rule/-strong`, `--glass/
-edge`), the artwork channel (`--art/-glow/-ink/-image`, resolved from inline `--art-light`/`--art-dark`
pairs an `ArtProvider` sets — never `--art` directly), `--warn`/`--danger`, the type scale (`--t-micro`…
`--t-display`), layout tokens (`--column`, `--rail`, `--gutter`, `--measure`, `--menubar`, `--player-card`,
`--density`, the entity masthead's `--masthead-band`/`--masthead-head`), the body face (`--font-body`, with
`--font-system-sans`/`--font-system-serif` beside it),
motion (`--dur-instant/-quick/-move/-settle/-arrive/-bloom`, `--ease-arrive`/`-leave`), and the phone-only
`--dock`/`--tabbar`/`--miniplayer` chrome-height variables (declared on `body`, not `:root`, because a
custom property is substituted on the element that declares it). `@theme inline` maps the spine onto
shadcn's colour tokens, the two ease tokens (so `ease-arrive`/`ease-leave` exist as Tailwind utilities) and
the four font vars (injected by the client's `next/font/local`). Also here: `.wash` page-light (relative-colour
`--wash-core/-deep/-lift` off `--art`, dithered via an SVG noise mask), `body::after` grain, the `.doc`
BlockNote-output treatment (including `.doc[data-variant="lyrics"]`'s syllable/rhyme gutter, rhyme colour
hue-rotated off `--art`), `.wave` bars, `.masthead__art` / `__tone` / `__field` blur and drift, the
`motion-ink`/`-reveal`/`-move`/`-press`/`-settle` utilities, the running-order and cover-morph
`::view-transition-*` keyframes, `@media (min-width: 1800px)`/`(width < 768px)` layout overrides, and the
ambient-loop reduced-motion block.
`@layer base`: border reset, `html { @apply font-mono }`, `body { touch-action: manipulation }`, pointer
cursor on enabled buttons/`[role=button]`.

**Appearance attributes.** One attribute per appearance preference on `<html>` (`APPEARANCE` in
`lib/appearance.ts`; the table of values is in `DESIGN.md` → Appearance). Every rule hangs off `:root`, moves
tokens rather than components, and the default value has no rule, so a document with no attribute renders
exactly as before any existed. `data-density` (`compact`/`comfortable`/`spacious`) sets `--density`, which
the entity table's cell padding and `Row` multiply their vertical padding by; `data-text` (`sm`/`md`/`lg`/`xl`)
sets the `--t-*` scale and points Tailwind's `--text-xs`/`-sm`/`-base` at it; `data-radius`
(`none`/`sm`/`md`/`lg`) sets `--radius`; `data-width` (`narrow`/`wide`) sets `--column`, `--measure` and
`--gutter`; `data-masthead` (`tall`/`short`) sets `--masthead-band`/`--masthead-head`; `data-font`
(`mono`/`sans`/`serif`) sets `--font-body` and the document's face (anything naming `font-mono` stays mono);
all in foundation.css. `data-grain` (`off`/`subtle`/`full`) sets `--grain-opacity` (`off` also removes
`body::after`) and `data-glow` (`off`/`soft`/`full`) the wash's key and haze alphas, `off` hiding `.wash` and
`.masthead__art`, in atmosphere.css; `soft` calms the field's `--art-sat-*`/`--art-opacity` in motion.css,
where `data-ambient="off"` stops the four ambient loops (the phone rule still holds under `on`) and
`data-motion` (`system`/`reduce`/`full`) runs through the two variants above. `data-editor`
(`compact`/`reading`) sets `.doc`'s leading and size in doc.css. The inline `--art-fallback` (any colour,
matched by `[style*="--art-fallback:"]`) derives the four `--art-fallback-*` tokens at `ACCENT_TONES` and
replaces the grayscale `--art`/`--art-glow` where it is set; a cover's inline pair still wins, because its
resolver rules come later at equal weight. `styles/appearance.test.ts` parses the four files and pins every
value's rule, the defaults' absence, the no-attribute tokens, the reduced-motion twins and the fallback's
numbers.

### components.json ×2

- `packages/ui`: style **radix-mira**, rsc true, baseColor neutral, cssVariables, iconLibrary tabler,
  aliases → `@workspace/ui/*`, extras `rtl:false, menuColor:default-translucent, menuAccent:subtle`.
- `apps/client`: same style; css path points to the ui package's globals.css; aliases
  `ui→@workspace/ui/components`, `components→@/components`; **external registries `@canvas-ui`
  (canvasui.dev), `@blocks-so` (blocks.so)**. Add components: `bunx shadcn@latest add <name> -c
  apps/client` → files land in `packages/ui/src/components`.
- radix-mira = small dense components (buttons h-5→h-8, text-xs/relaxed everywhere).

### `block-editor/` (BlockNote wrapper)

`EDITOR_VARIANTS: Record<EditorVariant, React.LazyExoticComponent<...>>` in `variants.ts`
(`EditorVariant = "document" | "lyrics" | "plain"`) — a `React.lazy` registry so each variant's schema,
plugins and menus stay out of the other variants' bundles. `BlockEditor` (`index.tsx`) picks the variant
and wraps it in `Suspense`; **a mounted editor's variant/schema is fixed for its lifetime** (BlockNote has
no way to swap schema post-mount), so changing `variant` remounts via React's lazy-component-type
reconciliation.

- `frame.tsx` — `EditorFrame` (generic over BlockNote's schema types): chrome off
  (`formattingToolbar/linkToolbar/filePanel/sideMenu/tableHandles={false}`), `slashMenu?: boolean`
  (`false` for a variant that mounts its own slash-menu controller), `children` for variant-mounted
  suggestion-menu controllers.
- `lib/block-document.ts` (pure, server-safe) — `parseInitialValue(raw)`: unwraps up to two layers of
  `JSON.stringify` (some rows were double-encoded by a prior save path) and falls back to a plain-text
  paragraph; `isBlankDocument(blocks)`; `isBlankStoredDocument(raw)`. `lib/reveal-focus.ts` — `REVEAL_FOCUS`,
  `revealFocusTarget(root)`, `hasRevealFocusRegion(root)`.
- `use-document.ts` — `useBlockDocument
  (value, onChange, normalise?)`: parses once in a `useState` initialiser (a mounted editor never re-reads
  `initialContent`), reads `onChange` through `useLatestRef` so `useEditorChange` subscribes once, and
  runs an optional `normalise(blocks)` pass in the same one-off parse.
- `text-blocks.ts` — `textBlockSpecs(paragraph?)`: the seven-block text-only set (paragraph, heading,
  bullet/numbered/check list item, quote, section) shared by the lyrics and plain variants. Returns a
  **fresh object literal per call** — two editors mounted at once must not share schema state; do not
  cache it, and never build a schema with `BlockNoteSchema.create().extend()`, which mutates the
  module-level default specs shared by every editor on the page.
- `section-block.tsx` — `createSectionBlockSpec` (inline-content `section` block — a verse/chorus/bridge
  label, or any heading-like break in a plain note), `sectionInputRule` (`[Chorus]` on its own line
  rewrites the block).
- `document.tsx` — `DocumentEditor` (default export): BlockNote's stock schema, no extensions.
- `plain.tsx` — `PlainEditor` (default) + `plainSchema` (named export, for tests): `textBlockSpecs()`
  with the stock paragraph, no input rule, no suggestion menus, no analysis plugin.
- `lyrics/schema.ts` — `lyricsSchema = BlockNoteSchema.create({ blockSpecs: textBlockSpecs
  (createLyricParagraphSpec()) })`; `LyricsEditor` type alias.
- `lyrics/paragraph-block.ts` — `createLyricParagraphSpec`: BlockNote's paragraph redeclared with
  `meta.hardBreakShortcut: "none"` (`createParagraphBlockSpec` takes no options, so redeclaring is the
  only way to free Shift+Enter into a plain block split — one visual line, one block, which is the unit
  the syllable/rhyme analysis counts). Copied from BlockNote's own `Paragraph/block.ts` (MPL-2.0) so a
  paragraph still round-trips identically elsewhere.
- `lyrics/context.ts` — `LyricsDictionary` (`analyze`/`rhymes`/`synonyms`, implemented by the app —
  `packages/ui` never talks to the API), `WordAnalysis`, `RhymeEntry`, `SynonymSense`, `LyricsPrefixes`,
  `LyricsContext` (`{ dictionary, prefixes }` from the app's provider, `null` without one — the editor still
  edits, the gutter stays empty, prefix menus don't claim their trigger characters). The prefixes have no
  default here: the settings registry's `editor.rhymePrefix`/`editor.synonymPrefix` are their one home.
  `lyrics/text.ts` — `WORD` regex, `words()` (curly apostrophes folded straight), `lastWord()`.
- `lyrics/analysis.ts` — `readLines`, `holdCounts` (keeps a line's last-resolved syllable count while a
  word mid-edit is unknown to the cache, so the figure doesn't flicker on every keystroke),
  `groups`/`sectionStats`/`scheme` (rhyme-scheme letters: perfect rhymes cluster first by shared rhyme
  key, then loose lines join the earliest cluster they slant-rhyme with; a letter used by only one line
  gets none; letters restart per section), `decorate`, `analysisKey`, `createAnalysisPlugin`,
  `lyricsAnalysis(dictionary)` (the `createExtension` wrapper — the field is `prosemirrorPlugins`; a
  misspelled `plugins` key is silently dropped). One analysis pass per doc change, debounced dictionary
  lookups applied via a metadata-only transaction so nothing in React re-renders for them.
- `lyrics/normalise.ts` — `splitSoftBreaks` (idempotent — `toBe`-equal when nothing splits): a paragraph
  joined by `\n` (BlockNote's hard-break fold) becomes one paragraph block per visual line, each carrying
  the source run's styles.
- `lyrics/slash-menu.tsx` — `lyricsSlashMenuItems(editor)`: BlockNote's default items plus "Section".
- `lyrics/suggestions.tsx` — `LyricsSuggestion`, `rhymeItems`/`synonymItems` (dictionary-backed loaders),
  `abortable(load)` (cancels the previous keystroke's in-flight request; a rejection resolves to `[]`
  since BlockNote calls `getItems` with no catch), `LyricsSuggestionMenu` (presentation), and
  `LyricsSuggestionMenus` (mounts the `/`, `\`, and `~` `SuggestionMenuController`s — the two dictionary
  menus mount only when a dictionary is present, so the prefixes type as themselves without one).
- `lyrics/index.tsx` — the assembled `LyricsEditor` (default export): reads the dictionary once at
  creation (schema/extensions are fixed for the editor's life — a dictionary swap needs a remount),
  `useBlockDocument(value, onChange, splitSoftBreaks)`, mounts `sectionInputRule` +
  `lyricsAnalysis(dictionary)`, frame with `slashMenu={false}` and `<LyricsSuggestionMenus>`.
- Tests co-located as `*.test.ts(x)`: `analysis.test.ts`, `normalise.test.ts`, `schema.test.ts`,
  `suggestions.test.ts` (block-editor level: `schema.test.ts`); `lib/block-document.test.ts`.
- BlockNote facts worth knowing: `createExtension({key, keyboardShortcuts, inputRules,
  prosemirrorPlugins, tiptapExtensions})` — the docs page names the plugin field `plugins`; the source
  says `prosemirrorPlugins`, and a `plugins` key is silently ignored. `editor.schema` is `readonly`, fixed
  at `BlockNoteEditor.create`. Placeholder keys: `default` shows on whichever empty line has the caret,
  `emptyDocument` on a lone empty block — both need setting for a lone empty line to show one string.
  `SuggestionMenuController`'s wrapper already calls `useSuggestionMenuKeyboardNavigation` and owns
  `aria-activedescendant`/`aria-controls`, so a custom `suggestionMenuComponent` must not call it again
  and should reuse the `bn-suggestion-menu`/`bn-suggestion-menu-item-<index>` ids.

## packages/api (`@workspace/api`)

**Shared API types + openapi-fetch client + Better Auth client + generated enums.** No build script —
consumed as source TS. Has real scripts now: `typecheck`, `lint` (`@workspace/eslint-config/base`),
`test` (`bun test --parallel`). `tsconfig.json` extends `@workspace/typescript-config/library.json`
(`noEmit: true`, `types: ["node", "bun"]`). `createFetchWithRetry` returns a `FetchFn`, not `typeof fetch`, which
under Bun's types also demands `fetch.preconnect`. `server` is a **devDependency** so `enums.test.ts` can import the
server's raw enum arrays and drizzle-schema source directly and assert the generated copies match.

exports map:

```json
"./api": "./src/api.d.ts",
"./lib/*": "./src/*.ts"
```

### Files (`src/`)

- **`v1.d.ts`** (13.3k lines) and **`enums.ts`** — generated (`enums.ts` is **committed**;
  `v1.d.ts` is gitignored, so a fresh worktree runs root `typegen` first) by `apps/server/scripts/generate-api.ts` via `app.request("/api/openapi")` — offline, no
  live server needed. `enums.ts` mirrors the server's pgEnum source arrays and other schema-owned value lists
  (`MEMBER_ROLES`/`INSTANCE_ROLES`/`REGISTRATION_MODES`/`ENTITY_KINDS`/
  `COMMENT_TARGETS`/`LABEL_TARGETS`/`SAVED_VIEW_KINDS`/`ACTIVITY_ACTIONS`/`JOB_KINDS`/`JOB_STATUSES`/
  `AUDIO_EXTENSIONS`/`MEASURE_NAMES`/`DAW_CAPABILITIES`, each with a derived union type; the client's `lib/daw.ts`
  and `@workspace/ui`'s facets take `DawCapability` from here). `enums.test.ts` is the regression guard: it re-imports the server's raw
  arrays and asserts equality, so a changed pgEnum with a forgotten regen fails CI instead of shipping
  stale client options.
- **`api.d.ts`** (410 lines) — hand-written aliases over `operations[...]` from `v1.d.ts`: the full
  domain (`Project`, `Collection`, `Track`, `Session`, `Status`, `Label`, `PriorityLevel` (a level as a row
  carries it, `components["schemas"]["PriorityLevel"]`), `PriorityScaleLevel` (a level of the scale route, with
  `isDefault` and `counts`), `PriorityFallback`/`MoveReport` (what a move reports), `Image`, `Asset`,
  `AttachedAsset` (an entity's attachment row: the asset plus `uploadedBy`; not `AssetAttachment`, the files
  table's attachment-target row), `CommentWithReplies`, `Link`, `Daw`, `Job`, `Sharelink`, `SavedView`, `ProjectMember`/`Invite`,
  `SessionSave`/`SessionStructure`/`PluginUsage`, `TrackAudio*`, `HeatmapDay`/`UserHeatmapDay`,
  `WordAnalysis`/`RhymeResult`/`SynonymResult` (lyrics dictionary), `NoteSummary`/`NoteDetail`, `Instance`
  (the sign-in card's and admin About pane's public facts), `AdminSettings`/`AdminSettingsPatch`,
  `InstanceUsersPage`/`InstanceUser`/`InstanceUserPatch`, `AdminResetLink`, `AdminStorage`/`StorageReport`
  — around 95 type aliases path-coupled to operation ids). Re-exports `ActionError` from `action-result.ts`
  and `EntityKind`/`TableEntityKind` from `entity.ts`.
- **`action-result.ts`** — `ActionError = {error: string, status?: number, code?: string, details?:
  Record<string, unknown>}` (`status` is present exactly when an HTTP response produced the error;
  `code`/`details` come from the API's error envelope when it carried them), `isActionError`, `isNotFound
  (error)` (true for `status` 404 or 403 — a missing row and a forbidden one read the same to the caller),
  `toActionResult<T>(result, fallback, options?)` (openapi-fetch result → payload or `ActionError`;
  `allowEmpty` treats a `204`/empty body as success), `toActionOutcome<T>(result, fallback, success,
  options?)` (for calls whose payload the caller ignores — reports a caller-given value on success instead
  of the body). Both are **async**: message precedence is per-call `messages[status]` → the server's
  `{error}` envelope → shared `DEFAULT_MESSAGES` (401/403/404) → `response.statusText` → the caller's
  fallback; `status`/`code`/`details` are reported regardless of which message won. openapi-fetch already
  consumes a failed response's body into `result.error`, so the envelope is read from there first; the
  body is only `.clone().json()`'d when it survived unread. Tested in `action-result.test.ts`.
- **`api-base-url.ts`** — `FALLBACK_API_URL = "http://localhost:8080"`, `serverApiBaseUrl` (server-side
  calls and the web app's `proxy.ts` forward of `/api/*`: `INTERNAL_API_URL` → fallback — `INTERNAL_API_URL`
  is the API's in-network address, `http://api:8080` under compose, read at start-up and never inlined).
- **`api-client.ts`** — `createFetchWithRetry(options?)` (exponential backoff on transient socket errors —
  `UND_ERR_*`, `EPIPE`/`ECONNRESET`/`ETIMEDOUT`/etc., and on `502/503/504/408` — with a fast first retry
  for a stale keep-alive socket), `defaultFetch` (a pre-built instance), `ApiClient` type,
  **`createApiClient`** — one factory with two call shapes: `createApiClient({baseUrl, auth?, headers?,
  credentials?, retry?})` and a positional overload `createApiClient(baseUrl, headers?)`.
  `auth: {header: "cookie"|"authorization", value: () => Promise<string|null>}` is applied as an
  openapi-fetch middleware, resolved per request (not once at construction) since a cookie belongs to the
  request being served and a browser token may need a lazy fetch on first use.
- **`authed-client.ts`** — `createServerApiClient(getCookie, getOrigin, getForwardedFor?)` (forwards the incoming request's
  Cookie and Origin headers; without the Origin, the API's `csrfProtection` refuses every bodyless mutation as a
  possible cross-site form post. The optional third getter supplies the incoming `X-Forwarded-For`, sent on
  unchanged so the API's rate limits key on the caller rather than on the web container; no value, no header), `createBrowserApiClient()` (relative `baseUrl: ""` + `credentials: "include"` — same-origin so
  the HttpOnly session cookie rides it; the web app's `proxy.ts` forwards `/api/*` through), `uploadMultipart<T>
  (path, file, fields, onProgress?): Promise<T | ActionError>` (raw `XMLHttpRequest`, not `fetch`, because
  only XHR reports upload progress; goes straight to the API rather than through a server action, which
  caps bodies at Next's 1MB limit; a non-2xx response carries `status`, plus `code`/`details` when
  `responseText` parses as an envelope with a string `error`).
- **`auth-client.ts`** — `AuthClient` type, `authClient` (Better Auth React client with the
  `anonymousClient()` plugin for guest sign-in, `deviceAuthorizationClient()` (the `/device` page's
  `device`, `device.approve`, `device.deny`) and `oauthProviderClient()` from
  `@better-auth/oauth-provider/client`, which signs the page's query string onto every mutating auth
  request as `oauth_query` so the client's `/sign-in` and `/consent` pages can resume an OAuth provider
  flow), `createAuthClientFor(baseURL, options?)`. Base URL
  resolution: `window` present → `undefined` (same-origin, `/api/auth/*` rewritten, so the session cookie
  is first-party and `SameSite=Lax` works) → else `process.env.API_URL` → Vite's `import.meta.env
  .VITE_API_URL` → `FALLBACK_API_URL`. No `dotenv` import (it broke browser bundles with
  "process is not defined"). `packages/api/tsconfig.json` overrides the library preset's
  `declaration`/`declarationMap` to `false`: `@better-auth/oauth-provider`'s client plugin infers a return
  type that reaches into that package's private build chunks, which `tsc` can only print as a portable
  declaration when declaration emission is off — moot for this package anyway, since it has no build step
  and is consumed as source.
- **`entity.ts`** — types only, no runtime exports: `EntityKind` (re-exported from `enums.ts`),
  `TableEntityKind = Exclude<EntityKind, "project">` (the kinds that carry labels, bulk ops and table
  rows).
- **`upload.ts`** — `IMAGE_ACCEPT`, `AUDIO_ACCEPT` (from `AUDIO_EXTENSIONS` + `"audio/*"`), `isAudioFileName`.
  The upload ceiling is `MAX_UPLOAD_CEILING_MB` in `@workspace/settings/bounds`; the limit actually in force is
  served by `GET /api/uploads/limits`.

### Import patterns

- Types: `import { Project, Track, ActionError } from "@workspace/api/api"`
- API client: `import { createApiClient } from "@workspace/api/lib/api-client"`, or the server/browser
  wrappers from `@workspace/api/lib/authed-client"`
- Auth: `import { authClient } from "@workspace/api/lib/auth-client"`
- Enums: `import { DAW_OPTIONS, AUDIO_EXTENSIONS } from "@workspace/api/lib/enums"`

## packages/dsp (`@workspace/dsp`)

**The audio maths the server, the page and the AudioWorklet share**, a dependency of `apps/server` and
`apps/client`. A Rust crate (`rust/`) compiles to one WebAssembly module, `pkg/dsp.wasm` (gitignored, built
everywhere, never committed), and a TypeScript loader runs it in every host. The TypeScript is consumed as source
through `"./*": "./src/*.ts"` (`@workspace/dsp/runtime`, `@workspace/dsp/host/bun`, `@workspace/dsp/spectrum`); the
binary is reached by relative URL from the host modules, never through `exports`. It cannot live in
`@workspace/api`: that package lists `server` as a devDependency, so the server depending on it would be a cycle.
`packages/dsp/README.md` covers prerequisites, scripts and how to add an export.

```
rust/Cargo.toml            crate projammr_dsp, edition 2024, crate-type [cdylib, rlib]; ebur128, rubato (no default
                           features); release profile opt-level s, lto,
                           codegen-units 1, panic abort, strip
rust/rust-toolchain.toml   channel 1.97.1, target wasm32-unknown-unknown, clippy + rustfmt, profile minimal
rust/Cargo.lock            committed
rust/src/lib.rs            the export surface: every #[unsafe(no_mangle)] fn and nothing else
rust/src/error.rs          DspError (None 0, BadHandle 1, BadArgument 2, Unsupported 3, OutOfMemory 4),
                           record()/last() over a thread-local Cell, status(Result) -> i32
rust/src/registry.rs       Registry<T> (generational handles), Table<T>, the Handles trait
rust/src/util/fft.rs       forward(len)/inverse(len)/FftPair::new(len): the crate's radix-2 FFT, power-of-two lengths, plans cached per size
rust/src/util/window.rs    hann(n), sqrt_hann(n): periodic, 0.5 − 0.5·cos(2πi/n), computed in f64
rust/src/util/mel.rs       MelBank: mel-spaced triangles over a power spectrum (a sub-bin band takes its nearest bin)
rust/src/analysis/         Session (session.rs), Peaks, Loudness, Spectrum, LiveReadouts — see below
rust/src/analysis/offline/ the offline analyses (flag bits 4–12) and the feature comparison — see below
rust/src/play/             the Lab's playback blocks and Chain (see "Playback chain" below)
rust/examples/params.rs    prints src/params.ts from play::params::typescript()
rust/tests/chain_allocations.rs  counting global allocator: Chain::process never allocates
scripts/build.ts           cargo → wasm-opt → pkg/dsp.wasm, with the gzipped size gate
scripts/params.ts          `bun run params`: cargo run --example params > src/params.ts
src/runtime.ts             ABI_VERSION, DspErrorCode, DSP_FUNCTIONS, DspExports, DspError, Dsp, instantiate(Sync)
src/host/bun.ts            dspWasmUrl, loadDsp()
src/host/browser.ts        dspModuleUrl, compileDsp(), loadDsp()
src/host/worklet.ts        DspProcessorOptions, loadDsp(options)
src/spectrum.ts            SPECTRUM_LAYOUT and the spectrum meter, band centres, window and envelope helpers
src/analysis.ts            AnalysisSession: the typed wrapper over one analysis_* session (see below)
src/offline.ts             OfflineAnalyses (getters over a finished session), FeatureSet, alignFeatures, diffFeatures
src/live.ts                createLiveLoudnessMeter/createLiveSpectrumMeter: process/take meters on it
src/params.ts              generated: Block, BLOCK_BYPASSED, the choice enums, Param, PARAMS, Meter
src/chain.ts               Chain (typed wrapper over chain_*), CHAIN_QUANTUM, EQ_CURVE_BANDS
```

Scripts: `build` (`bun scripts/build.ts`), `params` (`bun scripts/params.ts`), `typecheck` (`tsc --noEmit`, `src` and `scripts`), `lint`
(`cargo clippy --target wasm32-unknown-unknown --all-targets -- -D warnings`, then ESLint; ESLint runs last so
`lint:ci`'s appended `--max-warnings 0` reaches it rather than clippy), `test` (`cargo test` in `rust/`, then
`bun test --parallel`), `format` (Prettier, then `cargo fmt`).

**Build.** `cargo build --release --target wasm32-unknown-unknown` with `RUSTFLAGS=-C target-feature=+simd128`, then
`wasm-opt -Oz --enable-simd --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext
--enable-mutable-globals --enable-reference-types --enable-multivalue` (wasm-opt refuses Rust's output without
every one of them), then a 160 KB gzipped gate that throws. The script prints the plain and gzipped sizes. A crate
no export calls adds nothing to the module, because LTO drops it. `wasm-opt` 116 is the verified minimum; trixie's
`binaryen` package (120) accepts the same flags.

**ABI rules** (the module doc of `rust/src/lib.rs` states them; `wasm-bindgen` is not used because its glue needs a
`TextDecoder` and `AudioWorkletGlobalScope` has none):

- Numbers only. Names are `snake_case`, prefixed by object kind; `dsp_*` is the module itself. The module has no
  imports, so every host instantiates it with `{}`.
- Pointers and byte counts are `usize`/`*mut u8` in Rust (32-bit in wasm, 64-bit in native tests); every export's
  `u32` result reaches JavaScript as a signed number, so the loader reads pointers and handles with `>>> 0`.
- Objects live in one `thread_local!` `RefCell<Registry<T>>` per kind (`registry::Table<T>`). On
  wasm32-unknown-unknown without atomics, std's `thread_local!` is a plain `static` cell, so this is the
  single-threaded global without any `unsafe`; natively it keeps each test thread's objects apart. Rust 2024 denies
  references to `static mut`, which is why a bare static is not used. `Handles::open` (`*_new`: the handle, or 0 with
  the constructor's error recorded), `close` (`*_free`: 0 or `BadHandle`) and `with_object` (a per-handle call,
  `BadHandle` when unknown) are the three shapes. `with_object` holds the table's borrow while its closure runs, so
  the closure must not reach the same table (a re-entrant borrow panics, which aborts).
- A handle's low 16 bits are the slot index plus one (so 0 is never a handle), its high 16 bits the slot's
  generation, bumped on removal: a handle freed and then reused by another object misses the new object. 65,535 live
  objects per kind; `insert` past that fails and `open` records `OutOfMemory`. Objects are boxed so a `*_ptr` into
  one never moves.
- `dsp_last_error()` is errno-like: set by a failing `*_new` or `dsp_alloc`, never cleared by success.
- `dsp_alloc(bytes)` aligns to 16. It returns 0 with `BadArgument` for 0 bytes (a zero-size `alloc` is undefined
  behaviour) and `OutOfMemory` when `Layout` rejects the size or memory cannot grow; `dsp_free` ignores a null pointer
  or 0 bytes. Every `unsafe` block in the crate is in `lib.rs`.
- Results come back through `*_ptr`/`*_len` pairs into object-owned storage, valid until the next call on the handle.
- `ABI_VERSION` is 1 in both `lib.rs` and `runtime.ts`; `Dsp`'s constructor throws on a mismatch.

**Loader** (`src/runtime.ts`). `DSP_FUNCTIONS` is a `const` array of `{ name, params, returns }` records;
`DspExports` is a mapped type derived from it (each parameter a `number`, `returns` one of `number`, `bigint`,
`void`), so an export is added to `lib.rs` and appended to that array in the same change. `Dsp.withF32(length, fn)`
allocates `length × 4` bytes, hands `fn` a fresh `Float32Array` view and the pointer, and frees in `finally`; length 0
never allocates and passes pointer 0, and a non-integer, negative or over-`2^30 − 1` length throws `RangeError`.
`readF32(ptr, len)` copies. `check(code, what)` throws `DspError` on a non-zero status; `nonZero(value, what)` throws
the module's last error for a 0 result and otherwise returns the value unsigned. `instantiate` accepts bytes or a
`Module`; `instantiateSync` takes a `Module`. A `memory.grow` detaches every view over the old buffer (a detached
view reads length 0), so no view is kept across a call.

**Hosts.** Relative imports inside `src/host/` carry `.js` suffixes (`../runtime.js`): the server type-checks this
source under NodeNext, which requires them, and both Bun and TypeScript's Bundler resolution map them to `.ts`.

- `host/bun.ts`: `Bun.file(new URL("../../pkg/dsp.wasm", import.meta.url))`, one fresh instance per `loadDsp()`
  (callers memoise). The server bundle leaves `@workspace/dsp` external, so in the `api` image the module is
  `/app/packages/dsp/src/host/bun.ts` and the URL resolves to `/app/packages/dsp/pkg/dsp.wasm`.
- `host/browser.ts`: `new URL(…)` asset plus `WebAssembly.compileStreaming(fetch(…))`, the `Module` cached in a
  module-level promise that is cleared when compilation fails.
- `host/worklet.ts`: `loadDsp({ processorOptions: { module } })` instantiates synchronously and throws `TypeError`
  when `module` is not a `WebAssembly.Module`.

Turbopack does not do the same remap: unlike Bun and TypeScript's "bundler" resolution, it looks for a literal
`analysis.js` and fails, and webpack's equivalent knob (`experimental.extensionAlias`) is explicitly unsupported
under Turbopack. `apps/client/next.config.ts`'s `turbopack.rules` runs a loader
(`apps/client/turbopack/strip-relative-js-extension.cjs`) over `packages/dsp/src/**/*.ts` first, stripping the
`.js` before Turbopack resolves it — needed the moment the client statically imports anything in this package with
a relative import of its own (`@workspace/dsp/live`, `@workspace/dsp/host/browser`; `@workspace/dsp/spectrum`
alone never triggered it, having none).

**Tests.** `cargo test` covers the registry (distinct non-zero handles, double removal, stale handles after slot
reuse, capacity), the `Handles` shapes on a test-only table, `DspError`, `dsp_alloc`/`dsp_free` natively, the FFT
cache (one plan per size, round trip, a bin-centre sine) and the windows (periodic symmetry, sum `n/2`, overlap-add
to 1 and 2 at `n/2` and `n/4` hops, `sqrt_hann² = hann`). The bun layer instantiates the built `pkg/dsp.wasm`:
`runtime.test.ts` (exports equal `DSP_FUNCTIONS` by name and parameter count, no imports, the ABI check, detaching
growth, `withF32` freeing and its zero and range cases, error codes through `dsp_alloc(0)`, and `DspErrorCode`
against the enum parsed out of `rust/src/error.rs`), `host-bun.test.ts` and `host-worklet.test.ts`.

### Playback chain (`rust/src/play/`, `src/params.ts`, `src/chain.ts`)

One `Chain` per source runs every block in `BlockId` order: `TimePitch` → `BandSolo` → `Eq` → `Compressor` →
`Reverb` → `Stereo` → `Crossfeed` → `Device` → `Gain`. Every block after `TimePitch` implements `play::Block`
(`set(ParamId, f32)`, in-place `process` on interleaved stereo, `reset`, and `meter(MeterId) -> Option<f32>`, which
the compressor answers for `GainReductionDb` and the stereo block for `Correlation`). `Chain::block(id)` is the one
place an id maps to a block.

- **Parameters.** `play/params.rs` is the single table: `blocks!` (id order, bypassed-by-default), `params!` (name,
  block, `Domain::Range`/`Toggle`/`Choice`), `meters!`, and the `choices!` macro each block uses to declare the enum
  a choice parameter selects (`TimeMode`, `FilterKind`, `Preset`, `StereoMode`, `Device`). `chain_set` refuses an
  unknown id or a value outside the domain (NaN included) with `BadArgument`. `src/params.ts` is generated by
  `bun run params` and is prettier-stable; `params::tests::the_committed_params_ts_matches_the_table` fails when it
  drifts. The EQ's 32 parameters come four to a band (`Kind`, `Hz`, `GainDb`, `Q`) and the EQ indexes them by offset.
- **Contract.** `chain_process(h, input, input_frames, output, output_frames) -> i32` pulls: `input` is the source
  from the read position to its end, the chain reads as many frames as the speed needs and returns that count (or a
  negated `DspError` code), and `output` is always filled. Past `input_frames` the source reads as silence, so the
  tail plays out. Work runs in quanta of at most `QUANTUM` (128) frames; a parameter change lands at the next quantum
  and cross-fades across it (biquad coefficients, gain and width ramps, a mode fade, a dry/processed fade for a
  bypass). A block fully bypassed is reset and skipped. `chain_latency` is the output frames between a frame being
  read and heard at the current settings (1,536 at speed 1). `chain_meter` returns NaN for an unknown handle or meter.
  `chain_set_eq_curve(h, ptr, 31)` swaps the eight bands for 31 peaking bands at Q 4.3 (±12 dB); `len` 0 restores them.
- **Stretcher** (`stretch.rs`): N 2048, synthesis hop 512, √Hann both sides, peaks on the channel sum with ±2-bin
  neighbours, nearest-peak regions, flux normalised by the frame's magnitude with a 0.1 floor before the 1.5 × median
  test (without the floor rounding noise resets the phases of a steady sine and costs about 2 dB). At a ratio of
  exactly 1 it passes the input through bit-exact, delayed by 1,536 frames; an overlap-add weight array lets it move
  in and out of the vocoder without a gap (entering writes the input's share of the three earlier frames; leaving
  re-aligns the read position by `HOP − last advance`, and the drifted phases cost under 1.5 dB for one hop).
  Ratio 0.5–4. Latency at ratio T is `1024 + 512·T` output frames.
- **Pitch** (`pitch.rs`): `TimeMode::ratios(speed, semitones)` gives (stretch, resample); the `rubato::Async` septic
  resampler (fixed 128-frame output, ±2× ratio) runs only while the resample ratio is not 1, and is reset when it
  engages.
- **Other blocks.** `biquad.rs` (RBJ designs in f64, DF2T, `Biquad` cross-fades to its target over one call),
  `eq.rs`, `dynamics.rs` (`Settings`, `gain_reduction_db`), `reverb.rs` (Freeverb, pre-delay up to 100 ms; a preset
  also sets the pre-delay; Club caps wet at 0.35), `stereo.rs` (`StereoMode::apply`, `Correlation` in f64 over 300 ms),
  `crossfeed.rs` (bs2b default), `bands.rs` (`Crossover` LR4 pairs; lower bands take each higher split's all-pass so
  the five sum flat; no band soloed plays everything), `device.rs` (a `Profile` per device through private `Eq`,
  `Compressor`, `Reverb` and a 120 Hz `Crossover` for the club's mono sub), `gain.rs` (dim −20, trim, normalise
  offset in dB).
- **Wrapper.** `Chain` in `src/chain.ts` allocates its output (`frames × 2` f32) and 31-gain curve buffers once with
  `dsp_alloc`, builds a fresh `output` view on every read, throws `DspError` for failing codes and `RangeError` for a
  curve that is not 31 long, and `free()` is idempotent.
- **Size.** With the analysis session and the chain, plus the offline analyses, the module is 228.1 KB, 106.6 KB gzipped. The FFT is the
  crate's own radix-2 transform (`util/fft.rs`, power-of-two lengths only): `rustfft`'s planner compiled an algorithm
  for every length into the module and was about 40 % of its code and data.

### `src/spectrum.ts`

- **`SPECTRUM_LAYOUT`** — 96 bands (a tenth of an octave) from 20 Hz to 20 kHz, `fftSize` 8192 (5.9 Hz
  bins at 48 kHz), tilt 4.5 dB/octave about 1 kHz, floor −120 dB. Changing it changes what a stored curve
  means, so stored curves have to be re-measured after a change.
- **`Spectrum`** — `{ hz, db }`, band centres and tilted levels, so a row describes its own band centres
  and a reader never needs the constants to draw it.
- **`spectrumBandCentres(layout)`**, **`spectrumWindow(curves, fallback)`** (48 dB down from the loudest
  point with 1 dB of headroom, the ceiling rounded up to a multiple of 6 so the window only moves when a
  curve is added; fallback `[−66, −18]`) and **`spectrumEnvelope(curves)`** (power-domain mean plus min and
  max per band, skipping curves measured on another band count) are the module's remaining exports.

The long-term average spectrum meter is Rust (`rust/src/analysis/spectrum.rs`), on the crate's own radix-2
FFT. Two hosts run it through an `AnalysisSession` with `ANALYSIS_SPECTRUM`: the server's track-audio
analysis, which stores the curve as `ltas` (`apps/server/src/db/queries/track-audios.ts`), and the client's
worklet processor (`apps/client/src/lib/dsp/processor.worklet.ts`, built by `bun run build:worklet`) for the
live readout. `packages/dsp/src/spectrum-reference.fixture.json` holds the expected curves for the test
signals, captured from the TypeScript meter the Rust port replaced; `analysis.test.ts` and `live.test.ts`
hold the port to them within 0.1 dB.

### `src/match-eq.ts`

Pure TypeScript, not Rust: `matchEqGains(reference, mine)` takes two `Spectrum` curves on `SPECTRUM_LAYOUT`
and returns 31 gains on `MATCH_EQ_BANDS` (the standard ISO 1/3-octave centres, 20 Hz–20 kHz) — the layout's
1/10-octave bands under each ISO centre averaged, the mean removed so the match changes tone rather than
level, clamped to ±`MATCH_EQ_MAX_DB` (12). The layout's frequency tilt is in both curves equally, so it
cancels out of the difference without being undone first. The client's `MatchEq` (`components/lab/`) is the
one caller: it recomputes the gains whenever the reference or this version's own spectrum changes, including
on mount, so a `matchEq` restored from `localStorage` gets a curve rather than sitting engaged with none.

### `rust/src/analysis/` and `src/analysis.ts`/`src/live.ts` — the `Analysis` session

One streaming session (`analysis_new(rate, channels, flags)`) is every analyser the server and client need:
it mixes to mono itself (equal weight per channel) for the analysers that want it, so a host decodes once
and taps every figure `flags` named. `flags`
is a bitset — bit 0 peaks, bit 1 loudness, bit 2 spectrum, bit 3 live readouts, bits 4–12 the offline analyses
(below); a higher bit fails `analysis_new` with `BadArgument` rather than being silently ignored.

- **`peaks.rs`** — one magnitude per 50 ms (`rate / 20` frames), the window's extreme sample, rounded to three
  decimals; `finish()` flushes a trailing partial bin.
- **`loudness.rs`** — one `ebur128::EbuR128` in `I | LRA | TRUE_PEAK | M | S`, values rounded to one decimal;
  `-inf` for silence on both integrated loudness and true peak.
- **`spectrum.rs`** — a Hann-windowed FFT meter on the crate's own radix-2 FFT (`util/fft.rs`);
  `SPECTRUM_LAYOUT` stays the single source, carried in through
  `analysis_spectrum_layout(h, bands, low_hz, high_hz, fft_size, tilt_db_per_octave, floor_db)`, which must run
  before the session's first `push` (and only once — the layout cannot change mid-stream). The same struct
  serves both the live per-hop `take_latest()` and the finalised whole-signal `average()` (via `finish()`), one
  band table shared by both.
- **`live.rs`** — flag bit 3's `LiveReadouts` owns its *own* `ebur128::EbuR128` in `Mode::S` (independent of the
  loudness flag, so bit 3 alone still works), closing a 10 ms hop at a time. `ebur128`'s momentary/short-term
  windows are fixed-size ring buffers zero-filled at construction, so a query before the window has actually
  filled reads quieter than it should; the fix (`loudness::primed_lufs`, shared with the offline loudness curve) is additive in the log domain — `raw_lufs + 10·log10(window /
  filled)` — because LUFS is `10·log10(energy) − 0.691`, so scaling the energy is exactly adding a constant dB
  offset, and `-∞ + finite` stays `-∞` under IEEE 754 with no special case. Sample peak per hop is tracked by
  `LiveReadouts` itself (`ebur128`'s own `sample_peak` is a whole-history figure), reset each hop.
- **`session.rs` and the meter it shares** — the session opens its one `Loudness` for bit 1 or for the offline
  curves or clipping (bits 9, 10), but `analysis_lufs`/`lra`/`true_peak_db` answer only when bit 1 was set.
- **`session.rs`** — flags map to `Option<Peaks|Loudness|Spectrum|LiveReadouts>` fields; `push` refuses (bit 2
  set but no `analysis_spectrum_layout` call yet) with `BadArgument`. `analysis_take_loudness`/
  `analysis_take_spectrum` both require flag bit 3; `take_spectrum` additionally needs bit 2 (the spectrum
  object to read from) — bit 3 alone with no spectrum flag always reports "nothing new" for the spectrum half,
  which is indistinguishable from (and as harmless as) no hop having closed yet.
- **`src/analysis.ts`**'s `AnalysisSession` wraps one handle: `push`, `finish`, `frames`/`durationMs`, `peaks`,
  `loudness`, `spectrum` (`null` before the first full window or without the flag), `takeLoudness`/
  `takeSpectrum`, `free` (idempotent). It issues `analysis_spectrum_layout` from `SPECTRUM_LAYOUT` itself when
  constructed with the spectrum flag, so a caller never has to.
- **`src/live.ts`**'s `createLiveLoudnessMeter`/`createLiveSpectrumMeter` wrap a session in one
  `process(channels)`/`take()` shape, so wiring one into a host is a call-site change, not a redesign.

Bun-layer tests pin the wasm session against fixed values captured from a direct run of the original
TypeScript meters (spectrum to 0.1 dB against `spectrum-reference.fixture.json`; live loudness to 0.1 dB
against numbers copied from a direct run of the client's hand-rolled loudness meter, since `packages/dsp`
cannot import `apps/client`), so the Rust port stays proven without a TypeScript original to
compare against. `cargo test`'s true-peak-over-0-dBTP
case uses a cosine (not an arbitrary sine) at 1 kHz/48 kHz: its crest lands exactly on a sample, which isolates
the oversampling interpolation filter's own passband ripple from any inter-sample-alignment effect — a real,
documented property of true-peak metering, not a bug.

### `rust/src/analysis/offline/` and `src/offline.ts` — the offline analyses

Flag bits on the same `Analysis` session, so one decode feeds everything: 4 features, 5 tempo, 6 key, 7 sections,
8 spectrogram, 9 curves (short-term loudness and L/R correlation per second), 10 clipping, 11 silence, 12 pitch
track. `push` accumulates per hop or per second; `analysis_finish` runs the estimators once (a second call does
nothing), and every getter reads null or empty before it. `Offline` (`mod.rs`) owns the analysers and the results;
the session mixes to mono once for the front end and the pitch track.

- **`onsets.rs` (`FrontEnd`)** — the one STFT: frame `frame_len(rate)` (2048 at 48 kHz, the power of two the FFT
  needs), hop `rate / 100` rounded, periodic Hann, **centred** (the frame buffer starts with `n/2` zeros; `finish`
  runs the hops whose centres fall inside the stream, `ceil(frames / hop)`). Power is scaled so a full-scale
  sine's bin reads 1 (`16 / n²`). Per hop: 40 mel bands 20 Hz–16 kHz as `ln(1 + 1000·power)`, spectral flux (sum
  of the positive band differences; 3-tap mean at `finish`), chroma. Per second (by hop centre, so non-integer hop
  rates never drift): mean log-mel and chroma scaled to its largest bin. **Chroma reads spectral peaks** between
  55 Hz and 4 kHz with the frequency refined by a parabola through the log power, adding the peak's three bins to
  `round(12·log2(f/440)) + 69 mod 12`: at N 2048 a bin is 23 Hz, wider than a semitone below 400 Hz, so mapping
  bin centres misnamed a G2 bass as F♯/A♯ and read a C major triad as E minor.
- **`tempo.rs`** — the plan's autocorrelation × log-Gaussian prior (120 BPM, σ one octave), then the octave
  tie-break (a half or double lag whose raw autocorrelation is ≥ 0.85 of the winner's goes to the prior), a
  parabolic sub-lag refinement (90 BPM is lag 66.7), and Ellis's DP (tightness 100) on the envelope over its
  standard deviation. `beatOffsetMs` is the circular mean phase of the DP's beats modulo the period. Measured on
  click trains: 120.0 and 89.9 BPM, offsets 10–20 ms early (the log-mel flux rises as a click enters the frame),
  confidence 0.22 and 0.30 (the autocorrelation lobes spread the mass). `None` for silence or under 2 s.
  `analyseTrackAudio` (`apps/server/src/db/queries/track-audios.ts`) settles the octave against the track's main
  session tempo (`settleTempoOctave`) when it disagrees by roughly 2× or ½× (PROJ-834), which leaves the
  confidence alone. That confidence does not discriminate: over ~70 lags that are neither many nor independent,
  some lag always stands above the rest by chance, so noise and a steady pulse read alike whatever statistic is
  taken over them. PROJ-840 carries the measurements and the two approaches that would separate them.
- **`key.rs`** — the plan's Krumhansl–Kessler correlation over the whole-track chroma. Confidence is the
  winner's margin over the best *non-relative* runner-up (PROJ-834): a major tonic and its relative minor share
  every note, so comparing against it kept the margin near zero for clearly tonal music; excluding it from the
  runner-up search raises the margin without changing which key wins. `None` for a chroma with no variation.
  `analyseTrackAudio` then settles major/minor against the track's main session (`settleKeyMode`) when the
  session names the detected key's relative as its own `Major`/`Minor` scale.
- **`sections.rs`** — features per second are the L2-normalised mel mean and chroma, each scaled by `1/√2` so a
  dot product is the mean of the two cosines. Novelty at second `t` is the Gaussian-weighted mean similarity
  within each 8 s side less the mean across, over in-range pairs only (no false edges at the ends). Boundaries:
  local maxima above `mean + 1σ` and above 0, greedily by height, at least 8 s from each other and from both
  ends. Groups: agglomerative merging of segment centroids while the best cosine is ≥ 0.85, lettered by first
  appearance (`sectionGroupLetter`: A…Z, AA…).
- **`spectrogram.rs`** — 128 mel bands 20 Hz–20 kHz from the front end's power, mean power per 100 ms column
  (by hop centre), dB clamped [−90, 0] → `u8`; column-major, lowest band first.
- **`curves.rs` (`Timeline`)** — feeds the session's `Loudness` itself, splitting each chunk at every 50 ms bin
  (`rate / 20`, the peaks' bin) and second boundary: the curve reads `Loudness::short_term` (primed and gated at
  −70) at each second's end, and a bin is `over` when `prev_true_peak` of any of its pieces exceeds 1. Clipping
  counts frames in runs of ≥ 3 frames with any channel ≥ 0.999 (attributed to the bin each counted frame falls
  in; the third frame adds 3). Correlation is Pearson in f64 per second, channels 0 and 1 (a mono stream reads 1;
  both channels constant read 1, one constant reads 0). Silence is the bins' mean square below 1e-6; a stream
  silent throughout has lead and tail both equal to its duration.
- **`pitch_track.rs`** — YIN on the mono feed low-passed (two `Coefs::low_pass` Butterworth sections through
  `Coefs::tick`) and decimated to `rate / floor(rate / 8000)` (8 kHz at 48 kHz): the difference function costs
  frame × longest lag per hop. Frame 43 ms, W half of it, hop 10 ms, centred; voiced above −50 dBFS RMS; first
  CMNDF dip below 0.15 walked to its minimum, parabolic refinement; median of five hops per stored value.
- **`fingerprint.rs`** — `Quantised { bytes, range }`: linear `u8` over the series' finite min/max (a flat series
  is zeros over `[v, v]`), and `dequantise`.
- **`diff.rs`** — `Features` (dequantised onset, mel, chroma and an optional per-second loudness with gated
  seconds at −70 LUFS), `Series` ids 0 onset, 1 mel, 2 chroma. `align` is the plan's z-scored cross-correlation over
  ±30 s at 100 Hz with 5 s minimum overlap and a 0.3 floor. `diff` linearly interpolates `b`'s rows at `t +
  offset` (a 2.5 s offset lands between seconds), `1.0` where that rounds outside `b`; the summary is
  `[changedSeconds, changedShare, loudestStartMs, loudestEndMs (−1 none), fingerprintSimilarity (NaN without
  chroma)]`, the similarity being the mean cosine of the aligned chroma. Rows are compared by cosine unless one is
  silent (every value within one quantisation step of zero, or for log-mel at or below the −60 dBFS level
  `1e-3`): two silent rows are identical, one silent row against a sounding one is wholly different.
- **`mod.rs`'s `dot`** — the one inner product (YIN, alignment, sections). `opt-level = "s"` turns off LLVM's loop
  and SLP vectorisers, so on wasm with `simd128` it is written in `f32x4` intrinsics (safe calls, no `unsafe`);
  natively it is eight scalar lanes. Measured over 10 minutes of stereo at 48 kHz under Bun: the pitch track
  0.5 s (2.5 s before the intrinsics), align + diff 46 ms, every analysis including the streaming ones 6.8 s, of
  which peaks, loudness and spectrum alone are 4.4 s. Natively at the release profile the pitch track takes
  2.5 s (`cargo test --release -- --ignored pitch_track`).

**Exports**, one block after `chain_*`: `analysis_tempo`/`analysis_key`/`analysis_silence` (pointers to 3, 3 and
2 `f32`s, null when absent), `analysis_{sections,spectrogram,loudness_curve,correlation_curve,clipping,pitch_track}
_{ptr,len}`, `analysis_feature_{ptr,len,range}(h, series)`; `offline_features_{new,set,set_loudness,free}`,
`offline_align(a, b)` (`i32::MIN` when not aligned or a handle is unknown), `offline_diff_new(a, b, offset_ms)` and
`offline_diff_{change,loudness}_{ptr,len}`, `offline_diff_summary`, `offline_diff_free`. `FEATURES` and `DIFFS`
are two more tables; `with_feature_pair` borrows `FEATURES` once to read both handles.

**`src/offline.ts`** — the `ANALYSIS_*` flags for bits 4–12 and `ANALYSIS_OFFLINE`; `OfflineAnalyses(session)`
reads `session.dsp`/`session.handle` (public readonly on `AnalysisSession`) and exposes `tempo`, `key`
(`"F♯ minor"`), `sections` (lettered), `spectrogram` (`{ columns, bytes }`), `loudnessCurve` (`null` where gated),
`correlationCurve`, `clipping`, `silence`, `pitchTrack`, `features` (`{ onset, mel, chroma }` each `{ bytes, min,
max }`). Every decimal is re-rounded (`decimal`) because an `f32` rounded in Rust arrives as `-6.099999904632568`.
`FeatureSet(dsp, features, loudnessCurve?)` loads stored buffers back (freed on a failing set), `alignFeatures`
returns ms or `null`, `diffFeatures` returns `{ change, loudnessDelta, summary: { changedSeconds, changedShare,
loudestChange }, fingerprintSimilarity }`. `Dsp` gained `withU8`/`readU8` beside `withF32`/`readF32`.

## packages/dit (`@workspace/dit`)

A Rust workspace (`Cargo.toml`, crates under `crates/`) for dit, with its own lock and toolchain pin, plus the Bun
host for `dit.wasm` (`@workspace/dit/wasm`, server-only) and its build into `pkg/`; see `dit.md`.

## packages/demo (`@workspace/demo`)

**The demo world every product screenshot is taken from**, as data plus the scripts that build it. Not a runtime
dependency of anything; `apps/web/scripts/screenshots/capture.ts` imports its `seed-result` type. Consumed as source
through `"./*": "./src/*.ts"`; scripts `typecheck`, `lint`, `test`, and the five below. It depends on `@workspace/api`
(the typed client the seed calls) and `@workspace/dit` (the pack builder, the stand-in set's objects, the set parser).

`demo-env`, `seed`, `snapshot` and `restore` start with `assertNotMainCheckout()` (`snapshot-io.ts`): the main
checkout, the parent of `git rev-parse --git-common-dir`, holds the owner's own env, database and media, so they
run only from a linked worktree. `curate` writes only under its `--out` directory and has no such guard. `seed` and
`snapshot` also refuse a workspace notes key equal to the main checkout's (`demoNotesKey`): `worktree-setup.sh`
copies the main env, so until `demo-env` runs the worktree holds the owner's real key. Neither value is ever logged.

- `catalogue.ts` (typed by `model.ts`): four accounts, three projects lit by the covers in `fixtures/covers/`,
  seventeen songs with their bounces, one Ableton session with its save history, comments pinned to versions,
  lyrics, notebook notes, saved views, invites and a share link with a visitor's comment. **Every name in it is
  invented**: the audio and the set are the owner's own unreleased material, and their real names, file names and
  sample paths never enter the repository. `catalogue.test.ts` checks the world is consistent (keys unique,
  every status, label, cover, track, relation and saved-view filter resolves, pins sit inside their version,
  only writers comment, each owner can get an account before their project is built).
- `curate.ts`: private material in, demo-safe inputs out. Reads `~/projammr-demo-audio/curation.json` (outside the
  repo: demo file → the owner's file in `--source-dir`, and per session the owner's `.als` plus text replacements
  for its track names and sample paths), copies each file's audio stream with ffmpeg (no re-encode, tags and
  embedded art dropped), and writes `sets/<session>.json`: the set parsed by dit itself (`loadDit().parse` of
  `@workspace/dit/wasm`, so `bun run --filter @workspace/dit build` has to have made `pkg/dit.wasm`; only this
  script loads it, never `seed`, `restore` or `bun test`), rebased onto the demo producer's home (each sample
  path), renamed, and checked that no replaced name survives. `spreadSamples` (`sample-spread.ts`) then gives the
  paths a `kind` by position (seven in ten `project`, two `library`, one `outside`) and a `status` (a `library`
  sample `unknown`; of the rest, every seventh from the fourth `missing`, at least two, the others `present`), so
  the seed sends a spread that fills the samples map, the trouble lines and the Missing tab, and re-curating gives
  the same set. A `sets/<session>.json` written before this form (tempo a number, samples with `candidates`)
  reads the same, so a seed needs no re-curate.
- `demo-env.ts`: writes a fresh demo-only `NOTES_MASTER_KEY` into this workspace's own
  `apps/server/.env` (`writeDemoEnv`; refuses any other path, and an env naming the main checkout's database).
  Restart the API after it.
- `seed.ts` + `build.ts`: builds the catalogue against an empty instance over HTTP, as its people would: the
  first account signs up (and becomes the instance admin, closing registration) and raises the instance's save
  content retention to its ceiling (the history's saves are months old, and the default 90 days would drop the
  content of those no commit names), everyone else joins through an invite, audio goes up through
  `/assets/upload` + `/tracks/:id/audios`, the share-page comment through an anonymous guest session. A session
  goes up as dit leaves one: `POST /sessions` with the set's facts, `localFilepath`, and the samples with their
  `status` (a push records only `present` and `unknown`, so the pushed saves carry no `samples` and never
  overwrite them); a repo named for the set's folder (`POST /projects/:id/repos`); the set adopted into it
  (`POST /repos/:id/sets`); the demo's machine registered by a beat naming the repos it tracks
  (`PUT /machines/:id`, its id from the owner and the machine name, so a reseed registers the same one); then
  `dit-history.ts` pushes the history under that `X-Machine-Id`, and the track's bounces are attached
  (`POST /sessions/:id/attachments`). Waits for every analysis and image job, then writes `seed-result.json`
  (`seed-result.ts`: the ids, keyed by catalogue key). Refuses an instance that has accounts.
- `dit-history.ts`: `planPush` turns the session's saves into what the hub takes, and `pushHistory` sends it:
  the objects the hub lacks as one pack (`objects/missing`, then `objects`), the saves (200 a request), the
  commits, and the time spans. Every save stands on **one stand-in set**, the committed contract fixture
  `Arranged Set.als` of `dit-daw-ableton`, split into three leaves and laid out by `@workspace/dit/test-pack`
  (the owner's real set never enters the repository), and every save has a hash of its own (a label's SHA-256).
  A save's `meta` is the demo set's, so the diffs, chips and skyline are the demo's, while a set download,
  `restore` or archive gives back that fixture: a real, openable `.als` that does not match the demo's tracks.
  A commit closes at each milestone and at the current save (five for `halogen`), holds the saves since the one
  before, has the milestone's `message`, and is dated a millisecond after its save; no `lineageObjects` are sent,
  whose content holds absolute times a restore cannot shift. Each save ends a sitting (40 to 150 minutes,
  clipped to start after the save before), pushed as a `saves` segment, which gives each commit its time in set.
  The pack builder (`objectRecord`, `recordBytes`, `packOf`) is `@workspace/dit/pack`, shared with
  `apps/server/src/test/dit-objects.ts`.
- `demo-set.ts`: the types of `sets/<session>.json` (`DemoSet`, `DemoSample`, `DemoStructure`) and `setFacts` /
  `saveMeta`, which turn a set into a session's create fields and a save's `meta`.
- `session-history.ts`: `buildHistory(set, session)` turns the real set plus the catalogue's milestones (which
  top-level tracks existed, tempo, devices not yet added, the commit's `message`) into earlier saves (a
  `milestone` closes a commit; a save `between` does not), with evening saves between milestones that add clips
  and samples, deterministic per session key.
- `snapshot.ts` / `restore.ts` (pure half in `snapshot-lib.ts`, I/O in `snapshot-io.ts` and `pg-tools.ts`): the
  fast path. A snapshot is `~/projammr-demo-audio/snapshots/<created-at>/` (plus a `latest` link) holding a
  custom-format dump, the server's `static/` as a tarball, the seed result and `snapshot.json` (commit, newest
  migration, the demo notes key, accounts, a sha256 per part). Both read and write only the workspace's own
  server env and `static/` (`assertWorkspaceEnv`/`assertInWorkspace` follow symlinks to where a path really lies
  and refuse an env or static dir that is itself a symlink) and refuse the main checkout's database, or every
  database when the main checkout's `DATABASE_URL` cannot be read. Restore checks the checksums (and stops and
  says to reseed when the snapshot's migration is not in this checkout), drops and restores the target with
  `WITH (FORCE)`, moves every `public` timestamp column forward by the snapshot's age (skipping "never" sentinels
  from the year 9000), then migrates forward (`runDatabaseRestore`: shifting first leaves the rows a migration
  writes with `now()` at today), replaces the workspace's `static/`, and writes the notes key and the
  database into the workspace's server env. It also copies the snapshot's seed result to
  `<inputs>/seed-result.json`, as `seed` writes it there by default: that file is outside the workspace and
  shared by every worktree, so a worktree that must not touch the owner's inputs passes `--out` to `seed` and
  does not `restore`. `pg-tools.ts` runs
  `pg_dump`/`pg_restore` on the host when their major matches the server's, else inside `--pg-container`.

## packages/test (`@workspace/test`)

**Test-only helpers for what `bun:test` lacks**, a devDependency of client, dit app, server and ui. Consumed as
source through `"./*": "./src/*.ts"`; scripts `typecheck`, `lint`. `globals` — `stubGlobal(name, value)` redefines
the property (so accessor globals like `navigator` can be replaced) and `unstubAllGlobals()` restores the original
descriptors. `env` — `stubEnv(name, value | undefined)` / `unstubAllEnvs()`. `timers` —
`advanceTimersByTimeAsync(ms)` steps fake time a millisecond at a time with a real `setImmediate` between ticks
(not faked by `jest.useFakeTimers`), stopping early once no timer is pending. `wait-for` — `waitFor(fn, { timeout,
interval })` retries until `fn` stops throwing. `fixture` — `partial<T>(value)` stands a `Partial<T>` in for a
full API row, so a focused test fills only the fields the code reads while every field it *does* give stays
checked; prefer it to `as T` (which lets a wrong field name through) and to `as unknown as T` (which checks
nothing). Shallow, so nest a second call for a nested object. `dom` — `dom.ts`, preloaded by `packages/ui/bunfig.toml`
(`../test/src/dom.ts`): registers a happy-dom window on the globals via `@happy-dom/global-registrator`,
then restores the runtime's own `fetch`/`Request`/`Response`/`Headers` over the registrator's — happy-dom's
`fetch` refuses `file://` URLs, which is how a suite loads a local wasm module. It also sets
`MotionGlobalConfig.skipAnimations` and `BASE_UI_ANIMATIONS_DISABLED` so Motion and Base UI animations
resolve instantly, repoints `EventTarget` at the class happy-dom's nodes actually extend, and stubs
`IntersectionObserver` to report every observed element as reached on a microtask.

## packages/release (`@workspace/release`)

**The version sync and the release script**, private, exports nothing; scripts `format`, `typecheck`, `lint`,
`test`. The root `package.json` `version` is the product version. `src/sync-version.ts` resolves the root
`workspaces` globs at run time and sets that version in every workspace manifest, in `packages/dsp/rust/Cargo.toml`
in the `projammr_dsp` entry of `Cargo.lock`, in the `[workspace.package]` version of `packages/dit/Cargo.toml` (its `[workspace.dependencies]` versions are left alone; a manifest without the section throws), in every `dit-*` member entry of `packages/dit/Cargo.lock` (registry packages are left alone) and in each workspace's entry under `"workspaces"` in `bun.lock` (which
`bun install` rewrites otherwise; its `"packages"` entries are never touched), replacing only the version value textually so Prettier's
formatting survives; `syncVersion(root, { check })` takes the root as a parameter and returns the files that
differed. `src/release.ts` holds the pure decisions (`parseReleaseVersion`, `hasUnreleasedSection`,
`rewriteChangelog`) and a thin git shell (`release(root, version, date)`): it refuses a dirty tree, an existing tag
or a changelog without `## [Unreleased]`, then commits exactly the files it changed and makes an annotated tag.
It never pushes. `src/verify-tag.ts` is what `release.yml` runs on the pushed tag: `verifyTag(root, tag)` requires `v<x.y.z>` or
`v<x.y.z-rc.N>` equal to the root version and a non-empty `## [version] - date` section in `CHANGELOG.md`
(`changelogSection`, sharing `releaseHeadingPrefix` with `rewriteChangelog`); the script writes the section to the file
it is given and prints `version=…` and `prerelease=…` for the workflow's output file. Tests run against temporary fixture trees and a throwaway `git init`.

## packages/security-headers (`@workspace/security-headers`)

**The response headers every part of the site sends**, a runtime dependency of `apps/server` and `apps/client`.
One module, `src/index.ts`, consumed as source through `".": "./src/index.ts"`; scripts `typecheck`, `lint`,
`format`, `test` (`index.test.ts` pins the policy string). `securityHeaders({ scriptHashes? })` builds the record
of `X-Content-Type-Options`, `Referrer-Policy` and the report-only `Content-Security-Policy-Report-Only` string,
each base64 sha256 digest in `scriptHashes` added to `script-src` as `'sha256-<digest>'` so the inline script it
names runs unreported. `SECURITY_HEADERS` is `securityHeaders()`, no hashes. The server's `securityHeaders`
middleware sends `SECURITY_HEADERS` on every API response (plus HSTS under `TLS_MODE=acme`, which stays
server-side because only the API knows the TLS mode at runtime) and `apps/client/next.config.ts`'s `headers()`
sends the builder's record with the hash of the root layout's theme script (`THEME_SCRIPT`) on every page, so
neither front door (Caddy, or the Tailscale node) has to add headers. It cannot live in `@workspace/api` for the same reason `@workspace/dsp`
cannot: `@workspace/api` lists `server` as a devDependency. The api image copies its source to
`/app/packages/security-headers`; `build-web` needs it only at build time, since the standalone server bakes the
resolved `headers()` in.

## packages/media (`@workspace/media`)

**The one-bounce rule**, a runtime dependency of `apps/server`. No runtime
dependencies; consumed as source through `".": "./src/index.ts"`, relative imports ending in `.js`; scripts
`typecheck`, `lint`, `format`, `test` (`bounce.test.ts`). `bounceNameOf(path)` splits a path on either
separator into `{ folder, stem }` (stem lowercased, null without an extension). `groupBounces(files, windowMs,
fileOf)` returns every run, singletons included, of files with the same machine (optional), folder and stem,
sorted by modified time then path, a new run starting on a gap over `windowMs` or on a path
(case-insensitive) the run already holds; `fileOf` maps the caller's row to `{ path, mtimeMs, size, machine? }`
so each side keeps its own type. `preferredFirst(order, fileOf)` is the comparator for `"largest"` (size
descending, then lossless), `"smallest"` (size ascending, then lossless) and `"lossless"` (lossless, then size
descending), each ending on the path as a plain string comparison. `isLosslessName` and `LOSSLESS_EXTENSIONS` name
the formats that count as lossless. The server's `bounceGroups` (the
duplicate audit) is its caller; the api image copies its source to `/app/packages/media`.

## packages/session-diff (`@workspace/session-diff`)

**The save-to-save diff model**, pure TypeScript with no React or DOM import: `@workspace/ui` draws it, the web
client and the marketing site compute it from the metas they hold, and `apps/server` runs the same code for the
diff route and MCP (one model, two callers; `lib/save-diff.ts`). Consumed as source through `".": "./src/index.ts"` and
`"./*": "./src/*.ts"`; scripts `typecheck`, `lint`, `format`, `test`. No dependencies: `src/meta.ts` declares the
`SaveMeta`/`SessionTrack` shapes it reads (the API's generated `SaveMeta` is assignable to it), because the generated
types are built from the server and a dependency on them would loop. It is wired the way `@workspace/settings` is:
relative imports end in `.js` for the server's NodeNext typecheck and the client's `turbopack.rules` strips them,
and the api image copies its source to `/app/packages/session-diff`. Every caller imports it from here;
`@workspace/ui` keeps no re-export.

- `src/index.ts` — the save-to-save diff model, built from a registry of facets (`FACETS`), one
  module each beside it: `tempo`, `time-signature`, `key`, `structure`, `clips`, `scenes`,
  `samples`, `daw-version`. A `Facet` (`facet.ts`) names the DAW capability it needs and `compare(before,
  after, format)`s two saves into a `FacetChange` (worded `DiffChip`s and, for a scalar, a `Readout` gauge,
  keys and tempos written in the viewer's `format`); `transitionFacet` builds the text-valued ones, comparing
  what `read` returns and writing what `write` does where a value has more than one spelling (a key).
  `diffSaves(before, after, capabilities?, format?)` → the chips in facet order (a save's feed row);
  `diffSave(before, after, capabilities, format?)` → `SaveDiff` (`first`, `changed`,
  `chips`, `readouts`, `structure`, `samples`, `colors`), the card's whole model; an empty capability list
  (a session scanned before DAWs declared them) compares whatever the saves carry, while `colors` needs the
  `trackColors` claim itself. `diffStructure(before, after)` → `StructureDiff` (`TrackRow`/`DeviceRow`
  statuses, each row's `color`, each plugin's `host`, `truncated`), `changedTrackCount(structure)`, plus
  `keyOf`, `partitionTracks`, `pairRenames`. `src/tree.ts` nests rows by `groupId` (`rowTree`,
  `subtreeSize`, `subtreeChanged`, `lastIndexOf`) for the outline and the skyline; `src/skyline.ts`
  `skylineOf(structure)` is the skyline's geometry (bar levels against the set's longest chain, capped at
  `CHAIN_CEILING` 8; marks; the returns' gap; group spans to `SPAN_LEVELS` 3). Pure over `SaveMeta`, so a
  static page can diff two real saves.
- `src/format.ts` — `DiffFormat` (`number`, `tempo(bpm, {unit?, whole?})`, `key(tonic, scale)`): the three
  ways a diff writes a figure. `@workspace/ui`'s `Formatters` satisfy it; `diffFormat({locale?, keyNotation?,
  tempo?})` builds one (and `formattersFor` builds its own `number`/`tempo`/`key` from it, so the two cannot
  drift), `defaultDiffFormat()` is what a caller with no viewer (the server) writes in. The preferences it is
  built from are `DiffFormatPrefs` with `TempoPrefs` (`{ rounding: TempoRounding, suffix }`), and their defaults are
  `DIFF_FORMAT_DEFAULTS`, which `@workspace/ui`'s `DEFAULT_FORMAT_PREFS` spreads and whose `FormatPrefs.tempo` is
  typed by `TempoPrefs`. `localDecimalPoint(locale)` gives the function that puts the locale's decimal sign in a
  figure already written with a "."; `formattersFor` writes its bytes and loudness through it as the tempo does.
  Also `TempoOptions` and `pluralizeCount(count, noun)`, the one owner every package imports it from
  (`@workspace/session-diff/format`). It lives here because this package cannot import `@workspace/ui` and the
  diff's own copy ("3 tracks") needs it; `@workspace/ui` and the apps import it from here too.
- `src/ruler.ts` — `RulerConfig`, `RulerMark`, `tempoRuler(format)`: the tempo readout's ruler, the shape
  `RulerScale` draws.
- `src/musical-key.ts` — `parseMusicalKey`, `keyParts(key)` (the two halves as written),
  `CIRCLE_OF_FIFTHS_MAJORS`, `circleOfFifthsPosition`, `KeyNotation`, `spellKey(tonic, scale, notation)`
  (sharps is the key as written; flats renames a sharp tonic; Camelot `8B`/`8A` and Open Key `1d`/`1m` number
  a major or minor key's circle position and write any other key as sharps does) and `spokeLabel(index,
  notation)` for the circle's major ring.

## packages/settings (`@workspace/settings`)

**The settings registry: every setting declared once**, a runtime dependency of `apps/server` and `apps/client`. Zod schemas and metadata, no React. Consumed as source through `".": "./src/index.ts"` (the whole
surface) and `"./*": "./src/*.ts"` (a group file's own exports, such as `REGISTRATION_MODES` from
`@workspace/settings/groups/instance-access`); scripts `typecheck`, `lint`, `format`, `test`. It is wired the way
`@workspace/dsp` is: relative imports end in `.js` for the server's NodeNext typecheck, the client's
`turbopack.rules` runs `strip-relative-js-extension.cjs` over `packages/settings/src/**/*.ts` (a build without that
rule fails on `Can't resolve './define.js'`), and
the Dockerfile copies it into `deps`, `prod-deps`, `typegen`, `build-web` and the api image. It cannot live in
`@workspace/api` for the same reason dsp cannot.

```
src/types.ts          SettingScope, SettingSection, SettingSource, SettingLockScope, SettingControl, SettingGroup,
                      SettingDefinition<V, K>, Resolved<V>; the three unions as runtime lists too, SETTING_SCOPES,
                      SETTING_SOURCES, SETTING_LOCK_SCOPES, for a zod enum or a loop over every scope
src/define.ts         defineGroup, defineSetting, GroupModule, buildRegistry (the load-time checks); INSTANCE_ONLY
                      (`scopes: ["instance"]`, `lockable: false`, spread into an instance-only key) and wholeNumber
src/bounds.ts         MAX_UPLOAD_CEILING_MB, PASSWORD_LENGTH_FLOOR/CEILING: the bounds something besides a setting is
                      built from (the server's body cap and Better Auth's bounds, next.config.ts, the UI's
                      WIDEST_PASSWORD_RULE). Imports nothing, so Next's config loader can read it
src/groups/index.ts   one line per group file, alphabetical, nothing else
src/groups/<id>.ts    one group: `export const group = defineGroup(…)`, `export const settings = [defineSetting(…), …]`
src/registry.ts       GROUPS, SETTINGS, RegisteredSetting, SettingKey, SettingsValues, isSettingKey, settingsFor,
                      settingsReceivedBy
src/keymap.ts         the keys grammar (pure, no imports): Combo, KeyEventLike, canonicalCombo, parseCombo,
                      isValidCombo; read by the ui keymap engine and the server
src/values.ts         valuesSchema, ValuesShape
src/resolve.ts        resolveSetting, resolve, SettingLayers, SettingLocks, ResolvedSettings
src/document.ts       documentAttributes, documentProperties
src/test-support.ts   FIXTURE: the definition fields a test does not care about
```

**A definition** (`SettingDefinition<V, K>`): `key` (`<group>.<name>`), `group` (the key's first segment, checked by
the type as well as at load), `label`, `description`, `keywords` (extra search words), `scopes` (the scopes it
accepts, highest first: its cascade), `schema`, `default`, `control` (the hub's editor: toggle, text, colour,
select, multiselect, number, slider, duration, list, or `custom` naming a client component), optional `minRole`
(the lowest project role that may write it at project scope), `audience` (`public` also reaches signed-out pages,
`all` every member, `admin` instance admins only), optional `restartRequired`, optional `lockable` (locks apply
unless it is `false`), optional `document` (`{ attribute, value(v) }` or `{ property, value(v) }`, mirroring the
value onto `<html>` as an attribute or an inline style's CSS custom property). A
`number` or `duration` control may name a `placeholder`: what an empty field means, for a key whose schema takes
`null` (the hub's field clears it to `null`). **A group** (`SettingGroup`) has `id`, `section`, `label`, optional
`description`, `order`, and optional `advanced`: tuning most instances never touch, which the hub folds under its
head with a reset for the whole group.
`defineSetting` takes the value type from the schema alone, so a `z.enum` keeps its members rather than widening to
`string` against a literal default. **Schemas carry no `.default()`**: zod fills an absent key from a default nested
in `.optional()`, which would make `valuesSchema` turn "not in the patch" into a write; the default lives in
`default`.

**Adding a group** is one file under `src/groups/` and one line in `groups/index.ts`
(`export * as <camelCaseOfFile> from "./<file>.js";`, kept alphabetical), and no other edit. The file imports
`defineGroup` and `defineSetting` from `../define.js`, never from the package index (the index imports the
registry, which imports the groups). A group of instance keys the server acts on also maps each key in
`POLICY_SETTINGS` (`apps/server/src/lib/instance-policy.ts`); `instance-policy.test.ts` names the instance keys
left outside the policy, so a key that is neither mapped nor listed there fails it. Leave `settings` unannotated: a `SettingDefinition[]` annotation erases the
literal keys and with them every key's value type. `groups/index.test.ts` fails when a file under `groups/` is
missing from the index or the index is out of order. Checks that throw at module load, each naming the key or group:
a group id that is empty or has a dot; a key whose first segment is not its `group`, or with nothing after it;
empty `scopes`, or scopes not running highest first (user, then project, then instance); a default its schema rejects; a group id declared twice; a
setting in another group's file; a key declared twice (naming both groups); a document attribute or property two
keys write.

**The registry.** `SETTINGS` is frozen and keyed by key, typed per key (`SETTINGS["editor.rhymePrefix"].default`
is a `string`); `SettingsValues` maps each `SettingKey` to its schema's output; `isSettingKey(string)` narrows a key
from the wire. `GROUPS` is frozen, sorted by `order` then id; `SETTINGS` follows group order, then declaration order.
`settingsFor(scope)` lists the definitions accepting a scope; `settingsReceivedBy(isAdmin)` the ones a signed-in
caller receives (every key but `audience: "admin"` ones for a non-admin), which the server's reads and the client
palette's settings results both use. `valuesSchema(definitions)` is the patch validator:
a strict object (an unknown key fails with `unrecognized_keys`) whose members are each schema `.nullable()
.optional()`, so a patch names only what it changes and `null` clears a key; typed per key when given definitions
with literal keys, and keyed by any dotted string when given `settingsFor(scope)`.

**The resolver.** `resolveSetting(definition, layers, locks)` is pure. `layers` holds a record of values per scope
plus `env`; `locks` a set of locked keys per lockable scope. It walks the key's `scopes` in order and takes the first
value its schema accepts (the parsed value, so a schema that strips keys strips them); a value the schema rejects is
skipped and its scope listed under `invalid`; then `env`, then `default` (parsed too, so no caller holds the
registry's own object). `source` names the layer that won. A layer
holding a key the key's scopes do not list is never read. **Locks:** a lock counts only on a key not declared
`lockable: false`, at a scope the key accepts, over a row that exists at that scope; the instance lock wins when
both lock a key. A lock starts the walk at the locking scope and reports `lockedBy`, so every scope above it is
inert; if the locking scope's own row is rejected the walk continues below it with the lock kept. `resolve(layers,
locks)` runs it over every registered key and is typed per key.

**`documentAttributes(effective)`** maps each definition whose `document` entry names an `attribute` to it, leaving
off one whose `value` returns `null`. A key missing from `effective`, or holding a value its schema rejects, maps
from its default, so `documentAttributes({})` gives the attributes the registry alone implies.
**`documentProperties(effective)`** is its sibling for a `document` entry naming a `property`: the same rules, onto
a CSS custom property's name instead of an attribute's. Both take an optional `definitions` list (default every
registered setting), which `SettingsStore`'s paint passes the settings with a `document` entry so it never walks
the rest.

**Groups.** `groups/index.ts` exports one line per file, `groups/<id>.ts`: the Personal groups `appearance`,
`commands`, `editor`, `feedback`, `formats`, `keybindings`, `lab`, `layout`, `pages`, `palette`, `playback`, `visuals`, plus the
Project groups (below), the Instance groups (below). `groups/palette.ts` owns the
palette's vocabularies as `as const` id lists: `PALETTE_EMPTY_GROUPS` and `PALETTE_PREFIX_COMMANDS` (the prefix
command ids `palette.aliases` values are drawn from; the client's `PREFIX_COMMANDS` must equal it). `groups/keybindings.ts` declares `keybindings.client` (`user`/`instance`, a `custom` `keybinding-map` control): a record of free-string command ids
to at most four combos, `[]` meaning unbound, so a stale id survives to be listed as unknown. `comboSchema` accepts
the canonical form only (`parseCombo(combo) === combo`). The file also owns the shared constants
`RESERVED_CLIENT_COMMANDS` and `LINKED_CLIENT_COMMANDS`. The **Personal** section's keys take
`user` scope over `instance` and not `project`: a project value would be offered and never read, since the
policies and format preferences they feed are built from the read with no project layer (`apps/client`'s
`cachedPolicies()`/`viewerFormat()` with no project). The exceptions run `["user", "project", "instance"]`:
`appearance.accentFallback` (the project layout's nested `SettingsProvider` resolves it with the project layer
and the store paints it as the art fallback, so a project-set accent shows on that project's pages under a user
with none of their own) and the conventions a project sets for its members, `formats.weekStart`,
`formats.timeZone`, `formats.tempoRounding`, `formats.tempoSuffix`, `formats.keyNotation`,
`lab.normaliseTarget` and `visuals.loudnessReference` (the project layout re-provides the policies and the
format provider from the project's layer, and a server component on a project route passes its project's id to
`cachedPolicies()`/`cachedFormatters()`).
`lab.speedRange`, `lab.pitchRange`, `lab.compressor`, `lab.reverb` and `lab.eqPreset` each union their shape
with `RACK_DEFAULT` (`{ rack: true }`, exported with `isRackDefault` and `RackDefault` from `groups/lab.ts`),
which is also their default: "the rack's own" is a stored value, because `null` in a patch clears the row and
would hand the choice back to an instance default.
`editor` carries `editor.rhymePrefix` /
`editor.synonymPrefix` (the trigger characters, `z.string().min(1).max(4)`, control text), `editor.rhymeSuggestions`
/ `editor.synonymSuggestions` (booleans, default `true`, control toggle: whether the prefix opens a menu at all),
`editor.newNoteMode` (`z.enum(["lyrics", "plain"])`, default `lyrics`, control select: what a new note starts as)
and `editor.syllableCounts` / `editor.rhymeLetters` (booleans, default `true`, control toggle, each with a
`document` entry — `data-lyrics-syllables` / `data-lyrics-rhymes`, `"off"` when hidden — that
`packages/ui/src/styles/doc.css` reads to blank the lyrics gutter's columns).

**`appearance.ts`** (package root, not a group file) holds `APPEARANCE`: plain data, no imports, mapping each
appearance preference (`density`, `text`, `grain`, …) to its `<html>` attribute, its values and its default —
the shape `groups/appearance.ts`'s definitions and `document` entries are built from. Being import-free lets
`@workspace/ui` depend on `@workspace/settings` (`package.json`) purely to read this one list (`lib/appearance.ts`)
for its own hooks and tokens, without pulling in the registry, the resolver or a group's zod schemas — a bundler
reaching `APPEARANCE` through `@workspace/ui` resolves nothing further.

**`options.ts`**: `optionsOf(labels)` turns a `Record<value, label>` into a control's `{ value, label }[]` in the
record's own order, for a `select`/`multiselect` control built from an enum rather than spelled out by hand.
`arrangedList(item)` is the zod shape for a list the viewer reorders and can hide entries from — items of
`{ id, shown, ...item }`, refined so each of the app's own ids appears at most once. `allShown(ids)` builds such a
list's default: every id, in order, all shown. `completeArrangedList(stored, defaults)` is the one rule for ids a
stored list leaves out: it keeps the stored rows whose id the default names, then appends each missing default row,
so a missing id is shown with the default's own row for it. The shell policy mapping and the `ordered-list` control
both run through it.

**The Instance groups** (section instance, every key `INSTANCE_ONLY`). Each key but registration and the branding
the server does not act on is a value of the server's instance policy, and its schema is the policy's schema for
that value (`POLICY_SETTINGS`, `apps/server/src/lib/instance-policy.ts`, `docs/agents/server-api.md`); a seeded key
takes its variable's value as the `env` layer. Audience `public` for registration, `guestAccess`, `selfDeletion`,
`passwordMin`/`passwordMax`, the brand's name, images and colours and `updateCheck`; `admin` for the rest.
`restartRequired` on `sessionLifetimeDays` and `mcpEnabled` only.

| Group (order) | Keys |
|---|---|
| `instance-access` Access (10) | `registration` (`REGISTRATION_MODES`, select), `closeAfterFirst`, `invitesBypass`, `requireVerifiedEmail`, `guestAccess`, `selfDeletion` (toggles), `sessionLifetimeDays` (1–365 d), `linkLifetimeMinutes` (5 min–7 d), `passwordMin`/`passwordMax` (`PASSWORD_LENGTH_FLOOR`–`CEILING`), `lockoutFreeFailures` (1–100), `lockoutBaseMinutes` (1 min–1 d), `lockoutMaxMinutes` (1 min–7 d) |
| `instance-branding` Branding (20) | `name` and `mailSenderName` (1–60 characters, default `Projammr`), `logoImageId`/`iconImageId` (an instance image id or null; custom control `image`), `themeColour`/`backgroundColour` (six-digit hex, default `#080808`, the dark paper `PAPER_DARK` pins in `packages/ui`'s `brand-colours.test.ts`), `updateCheck` |
| `instance-limits` Limits (30) | `maxUploadMb` (≤ `MAX_UPLOAD_CEILING_MB`, seed `MAX_UPLOAD_MB`), `projectCapGb`/`userCapGb` (≥ 0 or null, placeholder "No cap", seeds `MAX_PROJECT_GB`/`MAX_USER_GB`), `pushSamplesEverywhere` (toggle, default off), `audioTypes`/`imageTypes` (lists ⊆ `AUDIO_EXTENSIONS`/`IMAGE_TYPES`, exported here with `ORPHAN_MODES`), `auditIntervalHours`, `orphanMode`, `guestRetentionDays`, `longestAudioHours` |
| `instance-jobs` Background work (40) | `analysisWorkers` (1–64, seed `MEDIA_CONCURRENCY`), `jobRetentionDays`, `activityRetentionDays` (or null, placeholder "Forever"), `saveContentRetentionDays` (1–36500, default 90, seed `SAVE_CONTENT_RETENTION_DAYS`) |
| `instance-integrations` Integrations (50) | `mcpEnabled`, `mcpToolGroups` (multiselect of `MCP_SCOPES`), `logLevel` (`LOG_LEVELS`, seed `LOG_LEVEL`) |
| `instance-rate-limits` Rate limits (900, `advanced`) | `<bucket>.burst` and `<bucket>.perMinute` for each of `RATE_BUCKETS` (name → label, what it meters, default and floor), a whole number no lower than the floor, whose message names it |

`registration` keeps its own reads (`cachedRegistrationMode`, `admitSignUp`) outside the policy.
`groups/instance.test.ts` pins the audiences, the restart-required keys, the floors and the nullable keys.

**Project groups.** Section `project`, scopes `project` over `instance`, `minRole: "admin"` (except
`project-audio.storageCapGb`, `owner`), audience `all`. Every key mirrors a field of the server's
`ProjectPolicy` (`apps/server/src/db/queries/project-policy.ts`) one for one, and its `default` is that
field's default in `DEFAULT_PROJECT_POLICY` — the registry's defaults are the one home of them, and the
policy derives from this registry rather than the other way round. `project-defaults.trackStatusId`/
`collectionStatusId` and `.labelIds` take a `custom` control (`project-status`, `project-labels`) the hub
registers under `settings-hub/controls/custom/`; a status or a label id the project no longer has is
skipped by the reader, not by the schema here.

| Group (order) | Keys | Notes |
|---|---|---|
| `project-defaults` Defaults (70) | `trackStatusId`/`collectionStatusId` (custom `project-status`), `labelIds` (custom `project-labels`), `artists` (list of text), `explicit`, `newSessionMain` (toggles) | What a new track, collection or session starts with when its creation leaves the field out |
| `project-sharing` Sharing (80) | `shareKind` (`SHARE_KINDS`, select), `shareExpiresDays` (duration, d, nullable, placeholder "Never"), `shareCommentPrivacy` (`SHARE_COMMENT_PRIVACIES`, select), `shareDownloads`/`guestComments` (toggles), `inviteRole` (`INVITE_ROLES`, select), `inviteDays` (duration, d), `whoMayInvite` (`WHO_MAY_INVITE_ROLES`, select) | `project-sharing.ts` owns and exports the enums the server's `Sharelink["shareType"]`, `ShareCommentPrivacy` and `WhoMayInvite` mirror |
| `project-conventions` Conventions (90) | `quietAfterDays` (duration d, 0 allowed and counts nothing quiet), `todayNewHours` (duration h) | the only two conventions fields |
| `project-audio` Audio (100) | `auditTooShortSeconds`/`auditNearSilentLufs`/`auditHotPeakDbtp`/`auditLeadSilenceSeconds`/`auditTailSilenceSeconds`/`auditNameMismatch` (number with a unit), `tempoKeyCorrection` (toggle), `tempoKeyCorrectionPercent` (number, %), `sameBounceWindowMinutes` (duration min), `duplicateKeep` (select, `DUPLICATE_KEEPS`), `mp3Kbps` (select, string enum of the bitrates `DownloadAssetDialog.tsx`'s `MP3_BITRATES` offers), `autoAnalyse` (toggle), `storageCapGb` (number GB, nullable, placeholder "No cap") | `mp3Kbps` is a string, since `SelectControl` edits strings only — the server side `Number()`s it; `storageCapGb` is `minRole: "owner"`; `DUPLICATE_KEEPS` is declared here |

`groups/project-defaults-sharing.test.ts` and `groups/project-conventions-audio.test.ts` pin the scopes, `minRole`,
audience and each default against the policy literal, and the custom components' names.

## packages/eslint-config (`@workspace/eslint-config`)

exports: `./base` (`base.js`, exports `config`), `./next-js` (`next.js`, exports `nextJsConfig` — a
different name), `./react-internal` (`react-internal.js`, exports `config`), `./design-tokens`
(`design-tokens.js`, exports `designTokens`), `./react-hooks` (`react-hooks.js`, exports
`reactHooksConfig`), `./react` (`react.js`, exports `reactConfig`), `./typescript` (`typescript.js`,
default-exports `typescript-eslint`).

The package pins `typescript` to `~6.0.3` while every other workspace is on TypeScript 7: typescript-eslint
parses with the `typescript` its importer resolves, supports <6.1 only, and TS 7 has no JavaScript API. A
config that needs typescript-eslint imports it from here, never from a package that would resolve TS 7.

- **`base.js`** — `js.configs.recommended` + `eslint-config-prettier` + `tseslint.configs.recommended` +
  `turbo/no-undeclared-env-vars` (warn) + `eslint-plugin-only-warn` (**every rule downgraded to a
  warning — lint never fails the build**) + ignores `dist/**`, `.next/**`, `**/.turbo/**`,
  `**/coverage/**`. `apps/server`'s `eslint.config.js` spreads this directly (adding its own
  `no-restricted-imports` rule scoping `node:child_process` to `src/lib/media.ts`) — **the "server has no
  eslint config" claim in older notes is stale; it has one.**
- **`react-hooks.js`** — `reactHooksConfig`: the `eslint-plugin-react-hooks` recommended rules shared by
  the Next.js client, `packages/ui` and the dit app, with `react-hooks/incompatible-library`
  off (TanStack Table/Virtual return functions the React Compiler can't memoize — the library's design,
  not a call-site defect).
- **`react.js`** — `reactConfig`: `@eslint-react/eslint-plugin`'s `recommended-typescript` preset, shared
  by the client, `packages/ui` and the dit app.
- **`typescript.js`** — re-exports `typescript-eslint` for the dit app, which builds its own rule set.
- **`next.js`** — `nextJsConfig`: base + `@next/eslint-plugin-next` recommended + core-web-vitals +
  `reactConfig` + `reactHooksConfig`.
- **`react-internal.js`** — `config`: same shape as `next.js` minus `@next/next` — for libraries that use
  React without Next (`packages/ui`).
- **`design-tokens.js`** — `designTokens`: an **opt-in** `no-restricted-syntax` rule flagging class names
  outside the design language — Tailwind's raw type scale (`text-xs`…`text-2xl`), arbitrary font sizes
  (`text-[...]`), named Tailwind colour hues, `shadow-{xs..2xl}`, and hex colour literals — checked in
  both plain string literals and template-literal segments (so it catches `cn()` calls built from a
  template string too). A consumer spreads it under a `files` glob rather than the flat config array.
- Consumers: `apps/client` → `nextJsConfig`; `packages/ui` → `react-internal`'s `config`; `apps/server` →
  `base`'s `config` directly (own eslint.config.js, own extra rule); `apps/dit-app` → its own
  `eslint.config.mjs` built from `./typescript`, `./react`, `./react-hooks` and `./design-tokens` (no
  only-warn, so its errors fail lint).

## packages/typescript-config

No exports field; consumed by path (`extends: "@workspace/typescript-config/<name>.json"`).

- **`base.json`** — strict, `noUncheckedIndexedAccess`, ES2022 target, `lib: [es2022, DOM,
  DOM.Iterable]`, `module`/`moduleResolution: NodeNext`, `declaration`+`declarationMap`, `skipLibCheck`,
  `incremental: false`, `isolatedModules`, `moduleDetection: force`, `resolveJsonModule`.
- **`nextjs.json`** — base + `plugins: [{name: "next"}]`, `module: ESNext`, `moduleResolution: Bundler`,
  `allowJs`, `jsx: preserve`, `noEmit`.
- **`react-library.json`** — base + `jsx: react-jsx`, `module: ESNext`, `moduleResolution: Bundler` (the
  bundler-style resolution is load-bearing: `packages/ui` is consumed as source by Turbopack and Vite, and
  NodeNext's mandatory `.js` import suffixes broke `next build`). Used by `packages/ui`.
- **`library.json`** — base + `target/lib: ES2022`+DOM, `module: ESNext`, `moduleResolution: Bundler`,
  `verbatimModuleSyntax`. Used by `packages/api`.
- **`apps/server/tsconfig.json`** extends `base.json` directly (not a packages/typescript-config preset
  built for it) with its own overrides: `declaration`/`declarationMap` off, `types: ["node"]`,
  `verbatimModuleSyntax`, `rootDir: src` → `outDir: dist`. `.js` import suffixes are mandatory
  server-side. Server has both `lint` (`eslint .`) and `typecheck` (`tsc -p tsconfig.typecheck.json`)
  scripts now.

## Cross-package gotchas

- **Every `packages/ui` suite runs under happy-dom** (the `bunfig.toml` preload), `.ts` and `.tsx` alike.
  happy-dom does not reflect ARIA attributes onto element properties: assert `getAttribute("aria-expanded")`.
  The same preload (`@workspace/test/dom.ts`) sets `MotionGlobalConfig.skipAnimations` and
  `BASE_UI_ANIMATIONS_DISABLED` after registering the DOM, so a Motion animation and a Base UI overlay's
  `getAnimations()` wait both resolve instantly instead of hanging on happy-dom's `Element.animate` stub.
  `skipAnimations` only *finishes* an animation when the tree is under `LazyMotion` — render with
  `{ wrapper: MotionProvider }` or an `AnimatePresence` exit never completes and a bare
  `onAnimationComplete` (the `EmptySection` reveal) never fires.
- **An animated value never reaches the DOM under happy-dom**, whichever route it takes: its
  `Element.animate` is a stub that applies nothing, so `onAnimationStart`/`onAnimationComplete` fire with
  the right target while the inline style still holds the value it started from. Assert the styles a
  render resolves — an `initial`, a `style` prop, a motion value a component `set`s — and the attributes a
  component writes, never an animation's end state.
- **The preload also repairs two globals happy-dom leaves wrong**: `EventTarget` points at the runtime's
  own class rather than the one its nodes extend, so `element instanceof EventTarget` — how Motion tells an
  element from a selector in `inView` — is false for the whole document; and there is no
  `IntersectionObserver` at all, so the preload installs one that reports every observed element as
  reached, on a microtask. A test that needs the waiting state before that report swaps in its own
  observer (`section-arrival.test.tsx`).
- **Two `motion-*` utilities on one element cancel.** Each sets `transition-property`, so the one Tailwind
  emits last wins and the other's properties stop transitioning. Pick the one utility whose list covers
  every property that changes (`motion-press` exists because a button needs ink and scale together); a
  property no utility lists gets an explicit `transition-[…] duration-(--dur-*) ease-arrive`.
- **`hidden` cannot be beaten by a utility.** Tailwind v4 preflight ships
  `[hidden]:where(:not([hidden="until-found"])){display:none!important}`. Responsive folding (`RailMore`)
  must toggle the `hidden` *class*, not the attribute, so a later `md:` utility can win at equal
  specificity.
- **Arbitrary-property utilities beat but don't merge with named padding utilities** — `tailwind-merge`
  treats `[padding-bottom:...]` and `pb-4` as different groups, so the shorthand and the arbitrary
  property coexist and whichever comes later in class order wins visually. `Sheet`'s `EDGE_SPACER` is a
  flex-item `::after` for exactly this reason: an inset baked into padding would be clobbered by a
  consumer's `p-0`/`py-2`.
- **`cn`/tailwind-merge never dedupes across different variant prefixes** — a `data-[side=…]:w-3/4`
  utility and a consumer's plain `w-full` are different utilities to tailwind-merge and both survive,
  with the variant-prefixed one winning on specificity. Any component whose geometry varies by a data
  attribute and that a consumer might want to override should pick the classes in JS (`SIDE_CLASSES`
  pattern), not with `data-[…]:` utilities.
- **Heatmap dates are UTC calendar days, never local instants.** `new Date("2026-01-15")` parses as UTC
  midnight; mixing that with a local-time `Date` constructor or reader slides a day.
