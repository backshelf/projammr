# packages/ui (`@workspace/ui`)

shadcn/ui component library (radix-mira style, Tabler icons) consumed as source TSX by the client and the
dit app, plus `src/styles/globals.css`, the design-token layer. Full reference: `docs/agents/packages.md`
(component index, custom component APIs, `cn()`, block editor, `@workspace/api`). Design language:
`DESIGN.md`. Read both before adding or changing a component.

## Commands

```bash
bun run test             # bun test; bunfig.toml preloads a happy-dom window (@workspace/test/dom.ts)
bun test src/components/sheet.test.tsx
bun run typecheck        # bun check
bun run lint
# add a shadcn component: run from the repo root, it lands in packages/ui/src/components
bunx shadcn@latest add <name> -c apps/client
```

## Layout

- `src/components/` — shadcn primitives plus Projammr-specific ones: `status-chip`, `table` (`entity`
  variant, `PinnedCell`, `TrackCell`, `RowPlay`, `Meter`), `icon-button`, `heatmap`, `drop-zone`,
  `confirm-delete-dialog`, `block-editor/` (BlockNote wrapper: document / lyrics / plain variants),
  `forms/` (auth cards, `FormController`), `layout/` (`PageHead`, `SectionHead`, `Rail*`, `Rows`, …),
  `motion-provider` (mounts Motion's feature set), `format-provider` (`FormatProvider`, `useFormat`,
  `Formatted`), and the signature gear the client and `apps/web` both render from props: `waveform`,
  `loudness/`, `session-structure/`.
- `src/lib/` — `utils.ts` (`cn`), `overlay.ts` (overlay classes, `composeRender`), `overlay-presence.ts`
  (Motion enter/exit plumbing for Base UI overlays), `table-config.ts`, `shell.ts`, `motion.ts` (`m`, the
  `SPRING`/`FADE`/`LEAVE` transitions, the `SURFACE`/`POP`/`OPTICAL` variants, `useReducedMotion`),
  `formatters.ts` (`FormatPrefs`, `DEFAULT_FORMAT_PREFS`, `formattersFor`: the only file here that
  constructs an `Intl` formatter), and the
  gear's pure half: `format.ts`, `art.ts`, `loudness.ts`, `ruler-scale.ts`, `waveform-bars.ts`,
  `day-label.ts`. Key parsing (`musical-key`) and the save diff model live in `@workspace/session-diff`.
- `src/hooks/` — `use-file-drop`, `use-latest-ref`, …
- Exports are mapped in `package.json`: `@workspace/ui/components/*`, `/lib/*`, `/hooks/*`, `/globals.css`,
  `/fonts.css`.

## Rules

- **Tokens only.** No Tailwind palette colours (`green-600`, `bg-black/50`); colour comes from artwork
  tokens, status/label colours, `--warn`, `--danger`. The `design-tokens` ESLint config enforces this
  where it is enabled.
- A behaviour that applies to any entity belongs here or in the client's shared table/form machinery, not
  in one client module.
- A component with no `"use client"` that writes a date, number, key or tempo takes the viewer's
  `Formatters` as a `format` prop (a server render cannot read `useFormat()`'s context), falling back to
  `defaultFormatters()` for `apps/web`; a `"use client"` one calls `useFormat()`.
- `cn()` uses a custom `extendTailwindMerge` with a `font-size` group for the type scale; a size class it
  does not know is silently dropped by a later text class.
- Credit external sources (registries, blog posts) at the top of the file.

## Gotchas

- Every suite runs under happy-dom, which does not reflect ARIA attributes onto properties: assert
  `getAttribute("aria-expanded")`, not `ariaExpanded`.
- Responsive folding must toggle the `hidden` *class*, not the attribute; preflight's `[hidden]` rule is
  `!important`.
- `tailwind-merge` never dedupes across variant prefixes (`data-[side=…]:w-3/4` vs `w-full`); pick
  geometry classes in JS (`SIDE_CLASSES` in `sheet.tsx`) when consumers may override them.
- Icons are `@tabler/icons-react` only; shadcn's generated components may reach for `lucide-react`, which is not
  installed: swap the icon for its Tabler equivalent.
