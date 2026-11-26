# `@workspace/ui`

The component library and the design-token layer every Projammr surface shares: the web client, the dit app's
renderer and the public share page all render from here, so they read as one product. It started from shadcn/ui
(radix-mira style, Tabler icons) and has been reshaped to `DESIGN.md`: quieter than stock shadcn, true-neutral
paper and ink, artwork as the only source of colour, studio-gear readouts instead of cards and charts.

Consumed as TypeScript source: there is no build step, and the consuming bundler (Turbopack, Vite) compiles it.

## Exports

```json
"./globals.css":                  the design tokens and base styles (Tailwind v4, CSS-first)
"./fonts.css", "./fonts/*":       the four self-hosted faces
"./postcss.config":               the PostCSS config consumers reuse
"./components/*":                 one component per file
"./components/block-editor":      the BlockNote wrapper (a directory, so it has its own key)
"./hooks/*":                      shared React hooks
"./lib/*":                        pure helpers
```

Import as `@workspace/ui/components/button`, `@workspace/ui/hooks/use-mobile`, `@workspace/ui/lib/utils`. Code inside
the package uses the same public names.

## What is in here

- **Primitives**: button, icon button, input and input group, textarea, label, field, checkbox, switch, slider,
  select, combobox, command, tabs, badge, status chip, segmented and toggle pills, avatar, skeleton, spinner,
  progress, separator, empty state, item, card.
- **Overlays**: dialog, alert dialog, confirm-delete dialog, sheet, popover, tooltip, dropdown and context menus,
  the sidebar, sonner toasts, floating note. Overlay presence and focus are handled by shared helpers so every
  overlay animates and restores focus the same way.
- **Product pieces**: the drop zone, the heatmap, the height reveal, the logo, the theme
  provider, the motion provider, haptics, the layout shells, and the shared auth forms the client and the dit app
  both render.
- **Block editor**: the BlockNote wrapper behind notes, descriptions and lyrics, with the document helpers in
  `lib/block-document`.
- **Hooks**: `use-mobile`, `use-coarse-pointer`, `use-apple-platform`, `use-hydrated`, `use-keyboard-inset`,
  `use-scroll-restoration`, `use-file-drop`, `use-latest-ref`.
- **Lib**: `utils` (`cn` with the project's own class-merge rules), `hotkeys`, `motion` (the shared easing and
  duration vocabulary, reduced-motion aware), `overlay`, `shell`, `table-config`, `heatmap`, `keyed`, `logo-paths`.

## Adding a component

shadcn components are added from the client and land in `src/components`:

```bash
bunx shadcn@latest add <name> -c apps/client
```

Then bring it in line with `DESIGN.md`: the token names in `src/styles/globals.css` are the vocabulary, and an
opt-in ESLint rule (`@workspace/eslint-config/design-tokens`) flags raw Tailwind sizes, hues and shadows that sit
outside it.

## Scripts

| Script | What it does |
| --- | --- |
| `bun run typecheck` | `bun check` |
| `bun run lint` | ESLint (`@workspace/eslint-config/react-internal`) |
| `bun run test` | `bun test --parallel`, colocated `*.test.ts(x)` |
| `bun run format` | Prettier |

## Gotchas

- `./components/*` is a pattern and cannot resolve a directory; a component that grows into a directory needs its
  own exact export key, as `block-editor` has.
- Tailwind v4 infers sources from the process cwd, so consumers name this package's files with `@source` in their
  own stylesheet.
- The dit app imports this package from shipped renderer code although it is a devDependency there; Vite bundles
  it, so that works.
