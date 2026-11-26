# Reference: marketing site and docs (`apps/web`)

The public website: the marketing pages and the docs, one fully static Astro build. Where each kind of file goes,
the rules for writing docs and the package's commands are in `apps/web/CLAUDE.md`; the design language is
`DESIGN.md`'s; the demo world the screenshots come from is `packages/demo` (`packages.md`).

## Stack

- **Astro 7**, static output to `dist/` (no adapter). Marketing pages are `.astro` files in `src/pages/`; `@/*`
  resolves to `src/*`.
- **Starlight 0.42** serves the docs. The `docs` collection (`src/content.config.ts`: `docsLoader()`,
  `docsSchema()`) reads `src/content/docs/`, and every page sits one directory further down, in
  `src/content/docs/docs/`, so its route starts `/docs/`. Starlight brings the docs' search (Pagefind, built into
  `dist/pagefind/`) and contents panel.
- **React** through `@astrojs/react`, only to render `@workspace/ui` components to HTML at build time. No page uses
  a `client:` directive, so nothing hydrates and no React runtime ships.
- **Tailwind v4** through `@tailwindcss/vite`, with two stylesheets:
  - `src/styles/site.css` (imported by `SiteLayout.astro`): all of Tailwind, preflight included,
    `@workspace/ui/fonts.css`, and three of the token layer's four parts: `@workspace/ui/styles/foundation.css`,
    `atmosphere.css` and `motion.css`. Never `globals.css`, which adds `doc.css` (the note editor's output) and
    `@source`s every file in the UI package. Its own `@source` lines name the site's files and each
    `@workspace/ui` file a page renders.
  - `src/styles/docs.css` (Starlight's `customCss`): Tailwind's theme and utilities only, layered under
    Starlight's order, plus the fonts, `foundation.css` and `atmosphere.css`, and the palette mapping below.
  - What each of the four parts holds: the header comment of `packages/ui/src/styles/globals.css`.
- `@astrojs/sitemap` writes `sitemap-index.xml` from `site` (`SITE.url`).
- ESLint through `@workspace/eslint-config`'s `react-internal` config, with `design-tokens` on
  `src/**/*.{ts,tsx}`. TypeScript: **Typecheck** below.

## Routes

Marketing pages (`src/pages/`), each rendered in `src/layouts/SiteLayout.astro` and lit by one of the four covers
(`mono` keeps a page grey):

- `/`: the landing page, set as a save-to-save diff: a masthead with a diff of two saves, one hunk per pillar of the
  product (each proved by real gear or a screenshot), the plans and a close.
- `/dit/`: the dit page, which replaced `/scanner/`: what the menu bar app records, its bounces, backfill and
  updates, and "Download dit for Mac" (`DitDownload.astro`, from `DIT_DOWNLOAD`), lit by the `mono` cover. The
  download is in the header and the close, and the nav, the landing page's calls to action and the 404 page link here.
- `/features/listening/`, `/features/writing/`, `/features/collaboration/`: one pillar each, a level deeper than its
  hunk on the landing page.
- `/pricing/`: the plans, what self-hosting involves, and the stack drawing.
- `/ai/`: how AI is used: in writing the code, in the app, and through the MCP endpoint.
- `404.astro`: the not-found page for the whole site, docs included; Starlight's own is off
  (`disable404Route: true`).
- `/favicon.svg` (`favicon.svg.ts`): the logo from `@workspace/ui/lib/logo-paths`, inked per colour scheme.

Docs (`src/content/docs/docs/`), one flat directory per sidebar group in `astro.config.ts`:

- `index.mdx`: `/docs/`.
- `guide/`, "Using Projammr": the web app.
- Nothing under `scanner/`: that group and its pages are gone, and `/docs/scanner/*` redirects to `/docs/`
  (`public/_redirects`, "Deploying"). The dit docs pages are not written yet.
- `collaboration/`, "Working together": members, roles, invites, share links, comments.
- `admin/`, "Running an instance": the instance admin's pages in the app.
- `api/`, "API": the guides, then the generated "Endpoint reference" (`/docs/api/reference/`) and "Auth endpoint
  reference" (`/docs/api/auth-reference/`).
- `self-hosting/`, "Self-hosting".
- `contributing/`, "Contributing".

## Layout

- `src/layouts/SiteLayout.astro`: the shell of every marketing page: the head (meta, canonical URL, Open Graph, the
  two faces the first viewport paints preloaded), the theme script, header and footer. `art` takes a cover's accent
  variables (`coverArt` in `src/data/covers.ts`); the `atmosphere` slot takes what paints behind the top of the
  page, under the header.
- `src/components/chrome/`: the brand, and the header and footer `src/nav.ts` feeds.
- `src/components/marketing/`: the marketing pages' parts: page heads and cover mastheads, bands lit by one cover,
  the hunk (one claim set as a diff hunk, its proof beside it; its `@@` header carries only the counts, since
  impeccable's craft floor bans a label above a marketing heading), the call-to-action shape and the "Coming soon" mark
  for anything that does not exist, the plan list, dit's download, and static renderings of the app's
  gear (session diff, save history, a version's waveform with its pins, a track under review) drawn with
  `@workspace/ui`'s own components. The session diff (`SessionDiff.astro`) is the app's `SaveDiffCard` as a
  `figure` captioned by `ProofCaption`, over `diffSave` of Halogen's last two saves (`src/data/halogen-saves.ts`,
  whose tracks carry authored colours from Live's palette); its skyline rises and its tempo caret travels on a view
  timeline (`site.css`), so the hero's card, already in view, arrives whole.
- `src/data/`: what the pages draw. `covers.ts` pairs copies of the `fixtures/covers/` covers
  (`src/assets/covers/`) with the hue and chroma the server's `extractPalette` gives each; the gear's data is the
  demo catalogue's invented songs and set, with figures the server's own analysis produced.
- `src/components/theme/`, `src/components/starlight/`, `src/components/docs/`, `src/components/Screenshot.astro`
  and `src/integrations/js-budget.ts`: below.

## Where the site's facts live

- `src/site.ts`: `SITE` (`name`, `url`, `repository`, `license`) and `DIT_DOWNLOAD` (`label`, `requirements`, the
  Gatekeeper line, and `href`: `SITE.repository` + `/releases/latest/download/dit-macos-arm64.dmg`, the dmg the
  release workflow attaches to every release, behind GitHub's `latest` redirect so the link needs no version).
  Nothing is published until the first tag, so the link 404s until then. `SITE.url` is
  the placeholder `https://projammr.example` (the `.example` TLD never resolves) and is `astro.config.ts`'s `site`,
  so every canonical URL, `og:url` and the sitemap carry it.
- `src/nav.ts`: `PRIMARY_NAV` (the header's links, on marketing pages and, through the `SocialIcons` override, in
  the docs) and `FOOTER_NAV`.
- `src/data/pricing.ts`: `PLANS` (Self-hosted, Hosted Solo, Hosted Studio), `PRICE_CURRENCY` and `formatPrice`,
  read by the pricing page and the landing page's plans. Hosting does not exist: every hosted price, storage figure
  and member limit is a placeholder, and a hosted plan's `href: null` renders the "Coming soon" mark. The
  self-hosted plan's storage line refers to the instance's storage caps (the `instance-limits` settings, which
  `MAX_PROJECT_GB`/`MAX_USER_GB` can seed).
- `src/theme.ts`: `THEME_STORAGE_KEY`.

## Theme bridge

One stored choice drives both halves of the site. `src/components/theme/ThemeScript.astro` is an inline `<head>`
script that runs before first paint: it reads `localStorage` under `projammr-theme` (`THEME_STORAGE_KEY`), falls
back to `prefers-color-scheme`, and sets both `.dark` on `<html>` (the token layer's switch, as in the client) and
`data-theme` (Starlight's). It re-resolves when the system scheme changes, and a click on any
`[data-theme-toggle]` flips the resolved theme and stores it. `ThemeToggle.astro` is that button. `SiteLayout`
renders the script on marketing pages, and Starlight's `ThemeProvider` and `ThemeSelect` are overridden with the
same two components, so the docs share the choice. The one-script rule: `apps/web/CLAUDE.md`.

## Starlight overrides and the palette

`astro.config.ts`'s `components` replaces four Starlight components with `src/components/starlight/`:

- `SiteTitle`: the site's `Brand` (mark and name, linking home).
- `SocialIcons`: `PRIMARY_NAV` as labels, then Starlight's own icons (the GitHub link from `social`). Starlight
  renders social icons in the header and in the phone menu's footer, so the primary links reach both without
  re-implementing its header.
- `ThemeProvider` → `ThemeScript`; `ThemeSelect` → `ThemeToggle`.

`src/styles/docs.css` declares the layer order `base, starlight, theme, components, utilities` and maps Starlight's
`--sl-*` variables onto the token spine, unlayered so they outrank Starlight's `starlight.base` values in both
themes (the spine switches with `.dark`):

- Greys: `--sl-color-white` and `gray-1` → `--ink`, `gray-2`/`gray-3` → `--ink-soft`, `gray-4` → `--ink-faint`,
  `gray-5` → `--rule-strong`, `gray-6` → `--rule`, `gray-7` → `--paper-sunk`, `black` → `--paper`.
- Hues (asides, badges, method labels): blue, green and purple sit on the ink ramp; orange is `--warn`, red is
  `--danger`.
- Accent: `--sl-color-accent` is `--art`, which in the docs is always its grayscale fallback, since they carry no
  artwork; the text accent and the accent background are ink.
- Type: `--sl-font` and `--sl-font-mono` → `--font-mono`; the `--sl-text-*` sizes → the type scale (`--t-title`,
  `--t-section`, `--t-lead`, `--t-body`, `--t-small`, `--t-micro`); shadows → `--shadow-menu`/`--shadow-overlay`,
  the small one none. The page title (`.content-panel h1#_top`) is in the display face; content headings are ink
  at weight 600.

## The API reference

- `scripts/openapi.ts` (`bun run typegen`) builds two documents in process, with no server running and no
  database: the Projammr API's from `buildOpenApiDocument()` (`apps/server/scripts/generate-api.ts`, the build
  `packages/api`'s types come from) and Better Auth's from `app.request("/api/auth/openapi")`. It sets placeholder
  `BETTER_AUTH_SECRET`/`NOTES_MASTER_KEY` and `MCP_DISABLED=1` when they are unset, so the server's env module
  loads. Each document's `servers` becomes `https://{host}<base path>`, a variable standing for the reader's own
  instance, and the API's is retitled "Projammr API": the server's own spec keeps `PROJAMMR_API`, the exact title
  (`app.test.ts` pins it).
- It writes `openapi/api.json` and `openapi/auth.json`, committed so the site builds without the server.
  `SPEC_FILES` names both, and `astro.config.ts` imports it.
- `starlight-openapi` renders them at build, at `/docs/api/reference/` and `/docs/api/auth-reference/`, each a
  collapsed sidebar group in the API section. Better Auth's spec has no summaries, so its operations are listed by
  path. Groups and operation titles come from the server's route descriptions (`server-api.md`'s route-file
  template: `describer(tag)`, and a summary is the description's first sentence).
- `test/openapi.test.ts` rebuilds both and fails when a committed file differs from the server's.

## Generated self-hosting references

`src/components/docs/` holds two references built from the repository's own deployment files, each held to them by
a test:

- `EnvReference.astro` (on `self-hosting/configuration.mdx`) reads the root `.env.example`, `docker-compose.yml`
  and `docker-compose.tailscale.yml` as raw text at build (`composeUse` gets the two compose files joined, so a
  variable only the Tailscale override reads, `TS_AUTHKEY`, is not "Outside Docker only"). `parseEnvExample` (`env-reference.ts`) turns each comment block and the assignments under
  it into one entry (a `# NAME=value` line is an optional variable); `composeUse` says what compose does with each
  name: required through `:?`, a compose default through `:-`, passed through, or never read ("Outside Docker
  only"). The comment above a variable in `.env.example` is its public documentation. `test/env-reference.test.ts`
  tests the parser and holds the real `.env.example` to it: every variable documented, each named once, the two
  required secrets matching compose.
- `StackDiagram.astro` (on `self-hosting/stack.mdx` and the pricing page) draws the compose stack from the data in
  `stack.ts` (`SERVICES`, `ROUTES`, `VOLUMES`). `test/stack.test.ts` holds it to `docker-compose.yml` (every
  service and no other, published ports, `depends_on`, profiles, volume mounts, the database port in the API's
  `DATABASE_URL`), the `Caddyfile` (each routed path), `tailscale-serve.json` (one handler per HTTPS route, to the
  same service and port, `/api` and `/media` keeping the API's `/api` and `/static` paths) and the `Dockerfile` (the
  ports the API and web images expose). The diagram draws the default Caddy stack; the Tailscale override is
  documented on `self-hosting/tailscale.mdx`.

A change to any of those files can fail `apps/web`'s suite: update `stack.ts`, or the `.env.example` comment,
in the same change.

## Build guards

`bun run build` fails on:

- a broken docs link. `starlight-links-validator` checks every link on Starlight's content pages; its `exclude`
  list (`astro.config.ts`) names the marketing routes and the generated reference's routes, which are not
  Starlight content and so not its to judge.
- a marketing page over the script budget. `jsBudget()` (`src/integrations/js-budget.ts`), on
  `astro:build:done`, adds up each built page's inline script bodies and loaded script files, plus every chunk
  they import statically, each file once per page (`pageScriptBytes`; a dynamic `import()` loads on demand and is
  left out), and fails naming every page outside `/docs/` over `MARKETING_JS_BUDGET_BYTES` (6 KiB). The docs are
  exempt: search and the contents panel are Starlight's. `test/js-budget.test.ts` covers the counter.

`bun run test` adds:

- `test/marketing-links.test.ts`: over the built `dist/`, every internal `href` on a marketing page reaches a file
  the build wrote, and every `#hash` an `id` on the page it points at. Docs pages are the validator's and skipped.
- `test/screenshots.test.ts`: every `<Screenshot id>` in `src/**/*.{astro,mdx}` has both themes captured for its
  viewport.
- `test/openapi.test.ts`, `test/env-reference.test.ts`, `test/stack.test.ts`: above.

turbo's `web#test` depends on `build`, so under turbo the links test reads a fresh `dist/`.

## Screenshots

- `scripts/screenshots/manifest.ts`: `shots`, one entry per picture: `id`, `shows` (what it is for, so a docs
  writer can find it), `route`, `as` (a catalogue account key, or `guest` signed out; the first account by
  default), `viewports`, `themes` and `steps` (an `agent-browser` command as its arguments, `{ scroll, text? }` or
  `{ pause }`). A route names seeded entities by catalogue key (`{project:…}`, `{track:<project>/<track>}`, and
  `collection`, `session`, `lyrics`, `invite`, `note`, `share`), resolved against the seed's result file.
- `scripts/screenshots/capture.ts` (`bun run screenshots -- --client <url> [--seed <file>] [--only <id,id>]`)
  signs each viewer in once per viewport and captures desktop (1440×900) and phone (iPhone 12, stored 780 px wide)
  in light and dark, with reduced motion, once the network is idle and fonts and images have loaded. It writes
  `src/assets/screenshots/<id>.<theme>.<viewport>.webp`, re-encoding at a lower quality any file over 250 KB. A
  full run (no `--only`, nothing failed) deletes the files the manifest does not name.
  `--seed` defaults to `~/projammr-demo-audio/seed-result.json`; `agent-browser` has to be on `PATH`.
- `<Screenshot id alt viewport? caption? adaptive? wide? />` (`src/components/Screenshot.astro`) renders both
  themes through `astro:assets`' `Image` at responsive widths and shows the one matching the page's theme.
  `adaptive` swaps a desktop shot for its phone capture on a phone, where one exists; `wide` sizes a desktop shot
  for the page's full width rather than a column's. An id with no capture renders a labelled placeholder, and
  `test/screenshots.test.ts` fails on it.

The demo world is restored or seeded into a linked worktree with a database of its own: every script but `curate`
refuses to run from the main checkout, `restore` drops and recreates the database the workspace's
`apps/server/.env` names, and `restore` and `snapshot` refuse the main checkout's database. Commands run from the
repository root, on the worktree's own ports.

The fast path, from a snapshot:

1. Stop the workspace's API: the restore's `DROP DATABASE … WITH (FORCE)` ends its sessions.
2. `bun run --cwd packages/demo restore`: the latest snapshot in `~/projammr-demo-audio/snapshots/`. It moves
   every timestamp forward by the snapshot's age, migrates the database forward, writes the snapshot's demo
   `NOTES_MASTER_KEY` and the database into the workspace's `apps/server/.env`, writes the seed result to
   `~/projammr-demo-audio/seed-result.json`, and prints the demo sign-in.
3. Start the API: `cd apps/server && PORT=<api port> bun run dev`.
4. Build and start the client in production, never `next dev`:
   `cd apps/client && bun run build && PORT=<client port> bun run start`.
5. `bun run --cwd apps/web screenshots -- --client http://localhost:<client port>`, then commit the WebP files.

The full path, when there is no snapshot or `restore` says to reseed (the catalogue changed, or a migration newer
than the snapshot cannot apply):

1. `bun run --cwd packages/demo curate -- --source-dir <dir> --out ~/projammr-demo-audio`: the owner's step; it
   reads a private mapping kept outside the repository, and parses the set with dit's wasm, so build that first
   (`bun run --filter @workspace/dit build`). Skip it when `~/projammr-demo-audio` already holds the audio and
   `sets/*.json`: the seed reads them as they are.
2. `bun run --cwd packages/demo demo-env`, then start the API on an empty database
   (`.claude/hooks/worktree-setup.sh <path> --db <suffix>`): the seed refuses an instance that has accounts.
3. `bun run --cwd packages/demo seed -- --api http://localhost:<api port>`.
4. `bun run --cwd packages/demo snapshot`, then carry on from step 4 of the fast path.

Each script's options are in its header; the package itself is `packages.md`'s **packages/demo**.

## Typecheck

- `bun run typecheck` runs `astro sync` (writes the gitignored `.astro/types.d.ts`), then `scripts/typecheck.ts`:
  `tsc --noEmit --runExternalCode` with the TypeScript pinned in `apps/web/package.json`
  (`7.1.0-dev.20260922.1`; every other workspace is on `^7`).
- `tsconfig.json` registers `@astrojs/ts-content-mapper` for `.astro` under `contentMappers`, which is what lets
  tsc read `.astro` files; `--runExternalCode` lets it run the mapper.
- The mapper hands tsc every `.astro` file in the program, Astro's and Starlight's own under `node_modules`
  included. The script counts their diagnostics on one line and fails on one in this package's own files, or when
  tsc fails with no diagnostic at all. Why a nightly and not `astro check`: `apps/web/CLAUDE.md`.
- `tsconfig.json` extends `astro/tsconfigs/strict`, not `@workspace/typescript-config`, so it has `strict` but no
  `noUncheckedIndexedAccess`. Paths: `@/*` → `src/*`, `@workspace/ui/*` → `packages/ui/src/*`. It includes
  `apps/server/src/types/*.d.ts`, since `scripts/openapi.ts` loads the server's app.

## Deploying

The site is hosted on Cloudflare Pages, apart from the self-hosted stack, and is not deployed. The Pages project's
build settings live on the project, not in the repository.

- `wrangler.toml`: the Pages project `projammr-web`, `pages_build_output_dir = "dist"`, a `compatibility_date`.
- `public/_headers` (copied into `dist/`): `/_astro/*` is cached for a year as `immutable`, since every file name
  there carries its content hash; every path gets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin` and a `Permissions-Policy` refusing camera, microphone and
  geolocation.
- `public/_redirects` (copied into `dist/`): `/scanner/` → `/dit/` and `/docs/scanner/*` → `/docs/`, both 301. The
  site is static with no adapter, and Astro's own `redirects` config would emit meta-refresh stubs that
  `starlightLinksValidator` crawls, so the redirects live in the file Pages reads. The link validator's exclude has
  `/dit/`, since the marketing pages are Astro routes beside Starlight's content.
- A build is a Bun install of the workspace (the `workspace:*` dependencies resolve through the root `bun.lock`)
  and `bun run build` in `apps/web`, into `apps/web/dist/`. turbo's `web#build` depends on nothing, so it needs no
  server typegen, secret, database or Rust toolchain: the OpenAPI documents and the screenshots are committed.
- The domain is `SITE.url` in `src/site.ts`.

## In the monorepo

- Root `bun run dev` starts `astro dev` beside the other apps, on `WEB_PORT` (4321 by default). Turbo's `web#build`/`web#typegen`/`web#test` and the `.dockerignore` entry: `monorepo.md`.
- `devDependencies` `@workspace/demo` (the capture script's `SeedResult` type) and `server` (`scripts/openapi.ts`
  loads its app).

## Gotchas

1. The Dockerfile's `web` target, compose's `web` service and CI's `docker` matrix entry `web` are the Next.js
   client. `apps/web` is dockerignored and in no image.
2. Root `bun run typegen` and `bun run typecheck` rewrite `apps/web/openapi/*.json` (turbo's uncached
   `web#typegen`). Commit their diff with the server change that caused it, or `test/openapi.test.ts` fails.
3. `bun test` run by hand in `apps/web` reads whatever `dist/` holds: `bun run build` first, or run
   `bunx turbo run test --filter=web`.
4. The Edit/Write format hook skips `.astro` and `.mdx`. After editing an `.astro` file run `bun run format` in
   `apps/web` (its script covers `**/*.{ts,tsx,astro}`; MDX is formatted by nothing). ESLint has no `.astro`
   parser, so `.astro` files are not linted.
5. A docs link to a marketing route the validator's `exclude` list does not name fails the build as broken: every
   marketing page the docs link to goes into that list.
6. The configuration reference lists only what `.env.example` names. A variable the server reads that the file
   omits is missing from the site until it is added there with its comment.
7. The site's screenshots (`src/assets/screenshots/`, WebP from the demo catalogue) and the README's
   (`docs/screenshots/*.jpg`) are separate sets.
