# Reference: Monorepo root & conventions

_Updated 2026-11-27._

## Layout

```
projammr-monorepo/            Bun 1.4.3 workspace (`packageManager` pin), turbo ^2.11.10 (Docker builds on oven/bun:1.4.2-slim)
├── apps/client               Next.js 16.4.0 frontend (`bun --bun next dev`)
├── apps/server                Hono REST API, port 8080, mounted at /api
├── apps/dit-app               dit's menu bar app: Tauri 2 shell in `src-tauri/` (its own Cargo workspace), React panel in `src/` (Vite); `dit.md` "The app"
├── apps/web                   Astro 7 + Starlight static site: the marketing pages and the docs (`web.md`)
├── apps/e2e                   the compose stack driver, the boot smoke check and the Playwright browser suite (private workspace, no `test` script)
├── packages/ui                @workspace/ui — shadcn/ui (radix-mira), heavy shared lib
├── packages/api                @workspace/api — shared API types + openapi-fetch client + auth-client
├── packages/dit                @workspace/dit — Rust workspace (dit-core, dit-daws, dit-daw-ableton, dit-cli, dit-ipc, dit-daemon, dit-wasm) and WASM loader
├── packages/dsp               @workspace/dsp — Rust → WebAssembly audio maths (pkg/dsp.wasm) and its TypeScript loader
├── packages/media             @workspace/media — shared audio format metadata and helpers
├── packages/security-headers  @workspace/security-headers — the response headers the API and the web app both send
├── packages/session-diff      @workspace/session-diff — the save-to-save diff model, pure TypeScript shared by the server and the client
├── packages/settings          @workspace/settings — the settings registry: every setting's declaration and the resolver
├── packages/release           @workspace/release — the version sync and release scripts (exports nothing)
├── packages/demo              @workspace/demo — the screenshots' demo catalogue, its seed and snapshot/restore
├── packages/test              @workspace/test — bun:test stubs shared across suites
├── packages/eslint-config     @workspace/eslint-config
├── packages/typescript-config @workspace/typescript-config
├── .env.example               template for the root .env docker-compose reads (Postgres creds, secrets, URLs)
├── extensions/ableton/        Ableton Live 12.4.5+ / 13 JS/TS extension (outside Bun workspaces while the beta SDK `.tgz` in `vendor/` is private & gitignored)
├── fixtures/covers/           four cover images used as accent-extraction fixtures (copied into apps/web/src/assets/covers/)
├── docs/agents/               the area references for coding agents (these files)
├── docs/screenshots/          the JPEGs the READMEs embed (1600 px desktop, 585 px phone); demo data seeded through
│                              the API under a throwaway account, never the owner's catalogue; `.dockerignore`d
└── .claude/                   local Claude Code harness (gitignored on backshelf repos; not required to contribute)
```

Root README is real (repo summary + prerequisites). The client dev script (`apps/client/package.json`) is plain
`next dev`.

Every build needs Rust as well as Bun: `packages/dsp/rust/rust-toolchain.toml` pins 1.97.1 with the
`wasm32-unknown-unknown` target, clippy and rustfmt (rustup installs them on the first `cargo` run there), and
`wasm-opt` 116 or later has to be on `PATH` (`cargo install wasm-opt`, or the distribution's `binaryen`). A
missing tool fails `bun run build` with the tool's own message.

## Root scripts

`build|dev|lint|format` → `turbo <same>`. `typegen` → `turbo typegen`. `typecheck` → `turbo typegen typecheck`.
`test` → `turbo run test --filter=!server` (see Testing below). Two more scripts exist only for the
workflow: `lint:ci` → `turbo lint -- --max-warnings 0` (CI's zero-warning gate), `test:ci` → `turbo run test
--filter=!server --concurrency=1` (one package at a time, see CI below) and `audit` → `bun audit`
with the advisory ignore (see CI below); `knip` runs knip over the whole repository (Formatting / linting
below). The product version lives in the root `package.json`;
`version:sync` (`bun packages/release/src/sync-version.ts`) writes it into every workspace manifest, `packages/dsp/rust/Cargo.toml`
the `projammr_dsp` entry of `Cargo.lock`, the `[workspace.package]` version of `packages/dit/Cargo.toml`, every `dit-*` member entry of `packages/dit/Cargo.lock`, `apps/dit-app/src-tauri/Cargo.toml` and `Cargo.lock`, and each workspace's entry under `"workspaces"` in `bun.lock`, `version:check` is the same with `--check` (writes nothing, exits non-zero
listing the files that differ), and `release <x.y.z | x.y.z-rc.N>` (`packages/release/src/release.ts`) bumps the root, syncs,
dates the changelog's `## [Unreleased]` section, commits `chore(release): x.y.z` and tags `vx.y.z` without pushing
(see `packages/release` in `packages.md`). Every workspace that declares `format` is reached by `turbo format`; a workspace without one is skipped
silently. Root devDeps: knip ^6.44.2, prettier ^3.9.10, prettier-plugin-astro ^1.1.2, prettier-plugin-tailwindcss
^0.8.1, turbo ^2.11.10, typescript ^7.1.0-dev.20261010.1.

## turbo.json

- `globalEnv`: 27-var allowlist turbo hashes into task caching (server + client runtime config — DATABASE_URL,
  BETTER_AUTH_SECRET/URL, NOTES_MASTER_KEY, INTERNAL_API_URL, MAX_UPLOAD_MB, FFMPEG_PATH, etc. — and the
  site's `WEB_PORT`).
- `build`: dependsOn `^build` and `server#typegen`, inputs `["$TURBO_DEFAULT$", ".env*"]`, outputs
  `[".next/**", "!.next/cache/**", "!.next/dev/**"]`.
- `lint`/`format`/`typecheck`: dependsOn same-named upstream, no outputs.
- `typegen`: outputs `["../../packages/api/src/v1.d.ts", "../../packages/api/src/enums.ts"]` (relative to
  `apps/server`, where the task runs). Inputs add `packages/settings`'s `package.json` and `src/**` (minus its tests)
  to `$TURBO_DEFAULT$`: the OpenAPI document's settings schemas come from that registry, and no dependency task
  carries it into the hash, so a new setting key would otherwise replay a cached `v1.d.ts` without it.
- `@workspace/dsp#build`: inputs `package.json`, `scripts/build.ts`, `rust/**` minus `rust/target/**`; outputs
  `pkg/**`. turbo names a package task by package name, and a `pkg#task` entry inherits nothing from the generic
  task, so it carries its own inputs and no `server#typegen` edge. `client#build` and `server#build` reach it
  through `^build`.
- `web#build`: dependsOn `[]` and outputs `dist/**`, so `apps/web` builds with no typegen, secret or wasm
  (`docs/agents/web.md`). With no dependency task in its hash, its inputs name what the build reads from outside
  `apps/web`: `$TURBO_DEFAULT$` plus `packages/ui`'s `package.json` and `src/**` (minus its tests), and the root
  `.env.example`, `docker-compose.yml` and `docker-compose.tailscale.yml` the environment reference imports raw. A new import from outside the
  package needs a `$TURBO_ROOT$/…` input here, or a cache hit replays a stale `dist/`.
- `web#typegen`: `cache: false`, outputs `openapi/**`. Root `bun run typegen`, and so root `bun run typecheck`,
  rewrites `apps/web/openapi/*.json` from the server's in-process spec on every run.
- `test`: `cache: false`, dependsOn `^build`, so every suite that depends on `@workspace/dsp` runs after the wasm
  is built. `^build` builds a task's dependencies, not the package itself, so `@workspace/dsp#test` has its own
  entry: `cache: false`, dependsOn `build`. Through `@workspace/api`'s devDependency on `server`, `^build` also
  pulls `server#build` and `server#typegen` into `bun run test`, so the test run needs `BETTER_AUTH_SECRET` and
  `NOTES_MASTER_KEY` (locally from `apps/server/.env`).
- `web#test`: `cache: false`, dependsOn `^build` and `build`: its links test reads the built `dist/`, so
  `bun run test` builds the site first.
- `dev`: `cache: false`, `persistent: true`, dependsOn `^build`. `ui: "tui"`.

## Workspaces and lifecycle scripts

- Workspace globs (root `package.json` `workspaces`): `apps/*`, `packages/*`; one `bun.lock` at the root; the
  isolated linker (`node_modules/.bun/` store, per-workspace symlinks into it).
- `trustedDependencies` (root `package.json`): esbuild — the only third-party package
  whose postinstall Bun runs. wordpos is not among them, which is why `apps/server`'s own `postinstall`
  builds its WordNet index (see Env below).- `bun install --frozen-lockfile` accepts a checkout with a workspace missing (it notes the skip) as long as no
  remaining workspace depends on it; the Dockerfile relies on that to leave `apps/dit-app` out.
- `apps/dit-app` is a Bun workspace with a Cargo workspace inside it (`src-tauri/`, path dependencies into
  `packages/dit/crates`). Its `build` is `vite build && bun run typecheck` and never compiles Tauri, so the
  ubuntu jobs and the Docker image never need webkit; `dev`, `package` and `lint:rust` run Tauri or clippy over it
  and only on a Mac. Root `bun run dev` (`turbo dev`) therefore starts `tauri dev` for it. `src-tauri/Cargo.toml` and `Cargo.lock` carry the product version (`version:sync`).
- Root `.npmrc` is **empty** (0 bytes).

## Licence and notices

The project is AGPL-3.0-only: the text is the root `LICENSE`, declared as `"license": "AGPL-3.0-only"` in every
tracked `package.json` and as `license` in `packages/dsp/rust/Cargo.toml`. A new workspace's `package.json` carries
the same field. `THIRD_PARTY_NOTICES.md` holds the notices for bundled data, binaries and fonts. The licences of
every third-party package in the dit app's bundle are listed in the app's own notices.

## Formatting / linting

- `.prettierrc`: semi true, double quotes, 2-space, LF, trailingComma es5, printWidth 80,
  prettier-plugin-astro (with an `astro` parser override for `*.astro`) and prettier-plugin-tailwindcss with
  `tailwindStylesheet: packages/ui/src/styles/globals.css`, `tailwindFunctions: ["cn", "cva"]`.
- `.prettierignore`: dist/, node_modules/, .next/, .turbo/, coverage/, bun.lock.
- Linting is per-workspace ESLint 10 flat `eslint.config.js` files (`apps/client/eslint.config.js`,
  `packages/ui/eslint.config.js`, etc.), built on `@workspace/eslint-config` (`./base`, `./next-js`,
  `./react`, `./react-internal`, `./design-tokens`, `./react-hooks`, `./typescript` exports). There is no
  root ESLint config.
- `knip.jsonc` (root) configures knip over every workspace: unused files, exports, types, duplicate exports and
  dependencies. Knip's plugins find most entries (Next, Astro, Playwright, the test files, anything a
  `package.json` script runs); the config names the rest (the server's `server.ts`, backfills and scripts, the `.claude/` scripts and hooks, which run by path) and
  lists each false positive with the reason beside it. An export used only in its own file is a finding: drop the
  `export`. An export only a tool reads (a drizzle `pgEnum` in `apps/server/src/db/schema/`) carries a
  `/** @public … */` tag instead.

## TypeScript

Root `tsconfig.json` just extends `@workspace/typescript-config/base.json`:

- `base.json`: strict, ES2022, NodeNext module/resolution, `noUncheckedIndexedAccess: true`, declaration+map,
  isolatedModules, skipLibCheck.
- `nextjs.json`: + next plugin, ESNext/Bundler, jsx preserve, noEmit. `react-library.json`: jsx react-jsx.
- Every workspace is on typescript `^7` but `apps/web`, which pins a 7.1 nightly for its `.astro` content mapper
  (`docs/agents/web.md`'s **Typecheck**).
- `apps/server` has two configs: `tsconfig.json` (editor and `src`-only settings; `bun run build` is two
  separate `bun build` invocations — `src/server.ts src/db/migrate.ts --outdir=dist`, giving `dist/server.js`
  and `dist/db/migrate.js`, then `scripts/reset-link.ts scripts/make-admin.ts scripts/rotate-notes-key.ts --outdir=dist/scripts` for the
  CLI scripts (`docs/agents/server-api.md`'s **Mail** and **Notes**) — kept separate because folding extra entry points
  into one `bun build` call re-roots `--outdir` at their common parent instead of `src/`; no type check
  either way) and `tsconfig.typecheck.json` (`bun run typecheck` → `bun check -p tsconfig.typecheck.json`) — it
  does not extend the shared preset.
- Every package's `tsconfig.json` includes its own test files, so `bun run typecheck` covers them and the
  language server resolves them against the package rather than falling back up the tree. `apps/client` used
  to `exclude` `**/*.test.ts(x)`, which left its 127 test files outside the client project: the editor
  resolved them against the bare root `tsconfig.json` (`NodeNext`, no `@/*` paths) and reported imports as
  unresolvable, while the gates type-checked none of them. Removing the exclude cost the clean `next build`
  nothing measurable (9.29s against a 9.32s baseline), because no route imports a test file.

## Testing

Every package runs `bun test` from its own `test` script (`bun test --parallel`: files spread over workers, each in
a fresh global, so one file's `mock.module` or stubbed global never reaches another). turbo's `test` task is
uncached. A bare `bun test` at the root finds nothing on purpose (root `bunfig.toml` ignores `apps/**` and
`packages/**`): it would skip each package's `bunfig.toml` preloads and share one global across every file. Root
`bun run test` covers client, web (after building it), ui, api, dsp (whose script runs `cargo test` before
its `bun test`) and demo; web and demo run plain `bun test` (neither mocks a module). The server suite needs a
live Postgres, so it runs on its own — `cd apps/server && bun run test`; no port is bound. `packages/test`
(`@workspace/test`) holds the stubs `bun:test` lacks: `globals` (`stubGlobal`/`unstubAllGlobals`), `env` (`stubEnv`/`unstubAllEnvs`), `timers`
(`advanceTimersByTimeAsync`, which lets promises settle between fake-timer ticks) and `wait-for` (`waitFor`).
`bun:test` matchers are typed against the received value, so a loosely typed expectation needs
`expect<unknown>(…)`; `expect(p).rejects` blocks until `p` settles, so under fake timers assert it after
advancing.

`apps/e2e` has no `test` script, because turbo's `test` runs on every gate and its checks need a running stack. Its
smoke (`src/smoke.ts`) proves the shipped compose stack boots and serves the path every install takes, through the
proxy over its own local CA: the first sign-up is the instance admin and a second is refused, a project and a track
are created, a generated WAV is uploaded and linked, the queued `audio_analysis` job reaches `done`, the file comes
back under `/media`, and `/api/health` reports a version. `src/stack.ts` runs the stack (`up [--build]`, `logs`,
`down [--images]`) under the compose project `projammr-e2e` with its own generated env file, never the root `.env`.
Locally: `E2E_HTTP_PORT=18080 E2E_HTTPS_PORT=18443 bun apps/e2e/src/stack.ts up --build`, then
`E2E_BASE_URL=https://localhost:18443 E2E_CA_FILE=apps/e2e/.stack/ca.crt bun apps/e2e/src/smoke.ts`, then
`bun apps/e2e/src/stack.ts down --images` (`apps/e2e/CLAUDE.md`).

The same workspace holds the browser suite, Playwright with Chromium against that stack, run by
`bun run test:e2e` in `apps/e2e` (the script exists there and not as `test`, for the same reason). Seven specs: the
first sign-up through the UI (Playwright's `setup` project: it asserts the account is the instance admin and saves
its session, which every other project loads); creating a project, a collection and a track; uploading a WAV to a
track and playing it in the player; a comment left at a seeked position whose timecode moves the playhead back
(`timecoded-comment.spec.ts`); the tracks table walked with Tab and the arrow keys alone, an edit and a picker opened
with Enter and left with Escape (`tracks-keyboard.spec.ts`); a share link opened signed out, where a guest comments
and the owner then sees it (`share-guest-comment.spec.ts`); and an invite accepted by a second account that
registers through it and appears in the members list (`invite.spec.ts`). Each spec ends by running axe (`@axe-core/playwright`) over its final
page through `expectNoSeriousViolations`, which fails on any serious or critical violation. The suite needs a fresh
stack, since only the first sign-up on an instance is accepted: `stack.ts down` then `up` before every run, with
`E2E_BASE_URL` naming the proxy (`https://localhost:18443` when the ports are remapped as above).

## Env / running things

- `.env.example` (root, committed): copy to `.env` at the repo root for `docker compose` — POSTGRES_USER/PASSWORD/DB,
  PROJAMMR_VERSION (commented out; which release of the api and web images the stack pulls, `latest` unset),
  BETTER_AUTH_SECRET, NOTES_MASTER_KEY (both `openssl rand -base64 32`, required — compose fails fast without
  them), PUBLIC_HOST (default `localhost`; the one name the stack is opened by, from which compose derives
  every `https://` URL: BASE_URL, BETTER_AUTH_URL, CLIENT_URL; the web app reads its own origin from each request),
  commented-out TRUSTED_ORIGINS/INTERNAL_API_URL/TRUSTED_PROXY_HOPS/TLS_MODE/MAX_UPLOAD_MB/
  MEDIA_CONCURRENCY/SAVE_CONTENT_RETENTION_DAYS/JOB_RETRY_DELAY_MS with explanations, and commented-out SMTP_URL/MAIL_FROM: unset means
  the instance sends no mail at all (reset/verification/change-email/invite mail hide themselves, and
  password recovery falls to the instance admin — `POST /admin/users/:id/reset-link` or `bun
dist/scripts/reset-link.js <email>`), see `docs/agents/server-api.md`'s **Mail**; commented-out
  MAX_PROJECT_GB/MAX_USER_GB (unset means no storage cap).
  `apps/server/.env` (gitignored, for running outside Docker) is separate and stays as-is.
- Per-app env files are gitignored: `apps/server/.env` (DATABASE_URL, CLIENT_URL), `apps/client/.env`
  (INTERNAL_API_URL, the API's address for server-side calls and the `/api` forward, default
  `http://localhost:8080`; API_URL; BETTER_AUTH_SECRET).
- **Server heap:** the pronouncing dictionary (`apps/server/src/lib/pronunciation.ts`) adds ~60 MB resident heap
  once warmed, built lazily after `Bun.serve` in `server.ts`. `wordpos`'s postinstall writes its
  `fast-index.*.json` into `wordnet-db`'s `dict/`, and throws without them — and Bun never runs it, since wordpos
  is not a trusted dependency. `apps/server`'s `postinstall` (`scripts/ensure-wordnet-index.mjs`) generates the
  files when missing; the Dockerfile's `prod-deps` stage copies that script in so it runs there too.
- Every package script runs its tool on Bun: `bun --bun <tool>` (next, eslint, prettier, drizzle-kit)
  where Bun has no replacement of its own, and Bun's own where it does (`bun test`,
  `bun build`, `bun check`, `bun --watch`, `bun <script>`). The type check is `bun check` in every workspace
  but `apps/web`, whose `.astro` files need tsc's content mapper (`web.md`'s **Typecheck**).
- Server: `bun run dev` → `bun --watch src/server.ts` (:8080, or `PORT`). Client: `bun run dev` →
  `bun --bun next dev` (:3000, or `PORT`/`-p`). Site: `bun run dev`
  → `astro dev` (:4321, or `WEB_PORT`, which `astro.config.ts` reads in place of `PORT`). `PORT` is in
  turbo's `globalEnv`, but `turbo dev` hands both tasks one environment and both read it, so anything running
  the pair on non-default ports has to start them separately (see **Worktrees**).
- Root `bun run typegen` = `turbo typegen` → `apps/server` runs `bun scripts/generate-api.ts` offline (in-process
  `app.request("/api/openapi")`, no port, no DB) and writes `packages/api/src/v1.d.ts` + `enums.ts`;
  `enums.ts` is **committed**, `v1.d.ts` is gitignored. Root `bun run typecheck` = `turbo typegen typecheck`.
  Drift gate before committing a route or enum change:
  `bun run typegen && git diff --exit-code packages/api/src/enums.ts`.
- Server `bun run generate` = `drizzle-kit generate`; `bun run migrate` = `bun src/db/migrate.ts` (drizzle-orm's
  migrator in `src/db/migrator.ts`, which also owns the migrations folder path `drizzle.config.ts` imports).

## Worktrees

A worktree is set up with `.claude/hooks/worktree-setup.sh <path> [--db <suffix>]` (below, under the Claude
harness).

- **Ports:** the main checkout runs on `:3000`, `:8080` and `:4321`. A second checkout's servers are started
  one by one with their own `PORT`/`WEB_PORT`, not through turbo, which would hand the API and the client one
  environment when both read `PORT`.
- **Env that has to move together:** the browser only ever talks to the client origin (`proxy.ts` forwards
  `/api/*` and `/.well-known/*`, which is what keeps the session cookie first-party), so `apps/client/.env`
  gets `INTERNAL_API_URL`/`API_URL` at the API's port and `apps/server/.env` gets
  `BETTER_AUTH_URL`/`TRUSTED_ORIGINS` at the client's. `worktree-setup.sh` points those at the API, which is
  right for a worktree that only runs the gates.
- **Database:** `pj-dev-pg`, a plain container on `localhost:5432`. Not compose's `db` service, which publishes
  no port and so cannot be reached from a dev server on the host. A worktree's database is
  `projammr_<suffix>` (`worktree-db.sh`). Run `pj-dev-pg` on the Postgres major `docker-compose.yml`'s `db`
  service pins (17), which is what CI's `test-build` and the shipped image run: majors differ in behaviour a
  test can pin (18 reports a refused `ON DELETE RESTRICT` as `23001`, 17 as `23503`). `worktree-db.sh` warns
  on every call when the server's major is not the pinned one. A pool under 6 connections starves the
  lock-race tests in `apps/server/src/routes/assets.test.ts`, which hold five at once.
- **Memory**, not ports, is what parallel dev servers exhaust. On macOS the ceiling is Docker Desktop's VM as
  well as the host: `pj-dev-pg` and every worktree's suite share its memory with whatever else runs in Docker.
- **Turbo cache:** every worktree shares the main checkout's `.turbo/cache`, and turbo never evicts from it.
  `build`'s outputs exclude `.next/dev/**` as well as `.next/cache/**`: Next writes the dev server's own
  cache there, and caching it made each `client#build` entry well over a gigabyte.
- **Machine tools** beyond Bun and Docker: rustup and binaryen's `wasm-opt` for `packages/dsp`; bash 4 or
  later and `flock` ahead of the system's on `PATH`, for `run-gates.sh`'s queue; `twg` logged in as the
  Claude account (`jira.md`); and a TypeSafe key for `.claude/jev/` (`TYPESAFE_API_KEY` on macOS, where
  Claude Code keeps no `~/.claude/.credentials.json`). `FFMPEG_PATH` in the server `.env` can name a Homebrew
  `ffmpeg` in place of `apps/server/deps`.

## Docker

- `Dockerfile` (root; one build graph, two targets): `base` (`oven/bun:1.4.2-slim`, Debian trixie, pinned by
  digest); `build-dsp` (`rust:1.97.1-slim-trixie`, pinned by digest, the same toolchain the crate's
  `rust-toolchain.toml` names, so `rustup toolchain install` in a layer of its own only adds the wasm32 target,
  clippy and rustfmt; `wasm-opt` from binaryen's `version_116` x86_64 tarball on amd64 and from trixie's `binaryen`
  package (120) on arm64, since binaryen publishes no aarch64 Linux build of 116; Bun copied from `base`; then
  `bun scripts/build.ts` behind cache mounts for the cargo registry and `rust/target`, and `cp -r pkg /pkg`);
  `build-dit` (the same image, `wasm-opt` install and Bun copy; `packages/dit` is a Cargo workspace, so it copies
  `rust-toolchain.toml`, `Cargo.toml`, `Cargo.lock`, `package.json`, `scripts/` and the whole `crates/` tree, then
  `bun scripts/build-wasm.ts` behind cache mounts for the cargo registry and `target`, and `cp -r pkg /pkg`);
  `deps` (every manifest but the dit app's, `bun install --frozen-lockfile --ignore-scripts` behind a
  BuildKit cache mount; the dit app is dockerignored and Bun skips the missing workspace) → `build-api`
  (`bun run build` → `dist/server.js` + `dist/db/migrate.js`), `typegen` (runs `scripts/generate-api.ts` with
  throwaway `BETTER_AUTH_SECRET`/`NOTES_MASTER_KEY` values from `openssl rand -base64 32`, generated in that
  `RUN`, so the server's env module loads; `v1.d.ts` is gitignored,
  so the image has to generate it) and `build-web` (copies `v1.d.ts` from `typegen`, then `bun --bun next build`,
  standalone output; no build ARGs, so one image serves any hostname: the API's address is the container's
  `INTERNAL_API_URL` at start-up and the public origin and scheme come from each request). `typegen` and `build-web` copy `/pkg` from `build-dsp` into
  `packages/dsp/pkg` after their source copy of the package → `prod-deps` (the server's manifests only,
  `bun install --frozen-lockfile --omit=dev --omit=peer`: ~150 MB with no drizzle-kit, TypeScript or next; the
  server's postinstall builds the WordNet index here) → `api` and `web`.
- `api`: `ffmpeg` is the static binary from `mwader/static-ffmpeg:8.1` (pinned by digest; a `static-ffmpeg` stage
  whose `/ffmpeg` alone is copied to `/usr/local/bin/ffmpeg`, so no ffprobe and no shared libraries), and
  `postgresql-client-17` comes from trixie (matching the `db` service's `postgres:17` major
  version — needed on PATH for `applyMigrations`'s own pre-migrate `pg_dump`, see `docs/agents/db.md`);
  `FFMPEG_PATH` resolves on PATH; WORKDIR `/app/apps/server` holds `dist/`,
  `src/db/migrations/`, the prod-deps tree (data packages included — nothing in it may be pruned as "unused"),
  `packages/dsp`'s source at `/app/packages/dsp` plus `build-dsp`'s `/pkg` at `/app/packages/dsp/pkg`,
  `packages/dit`'s `package.json` and `src` plus `build-dit`'s `/pkg` at `/app/packages/dit/pkg` (`typegen` copies
  `src` alone: generation imports the server, which imports `@workspace/dit/wasm`, but never loads the module),
  `packages/security-headers`' source at `/app/packages/security-headers` and `packages/settings`' at
  `/app/packages/settings` (the bundle
  leaves workspace packages external and all three ship as TypeScript, dsp plus `pkg/dsp.wasm`, so a workspace the server
  imports at runtime is copied into the image as well as into `deps`, `prod-deps` and any stage that compiles
  against it; `src/host/bun.ts` finds the module relative to itself; a workspace with third-party dependencies of
  its own, `@workspace/settings` with zod, also needs `prod-deps`' `/app/packages/<name>/node_modules` beside its
  source, because the isolated install keeps its links into the store only there, and without them the server
  fails at boot with `Cannot find package 'zod'`), the `static/{assets,images}` skeleton owned by `bun` (no `converted` — nothing reads or writes it), and an empty `backups/` directory (the pre-migrate dump's target).
  `USER bun`, `HEALTHCHECK` on `/api/health` (503 while the database is unreachable), entrypoint
  `apps/server/docker-entrypoint.sh` (migrate, then `exec bun dist/server.js`). `server.ts` handles
  SIGTERM/SIGINT: end open job event streams, stop accepting, drain, end the pool, exit.
- `web`: the traced standalone bundle plus `.next/static` and `public`; `USER bun`, `HOSTNAME=0.0.0.0`;
  `HEALTHCHECK` on `/api/health` through the rewrite, so "healthy" also means it reaches the API;
  `CMD bun server.js`.
- `docker-compose.yml`: `db` (`postgres:17-alpine`, digest-pinned, healthchecked); `api` (the published image
  `ghcr.io/backshelf/projammr-api:${PROJAMMR_VERSION:-latest}`, no `build:` block — `PROJAMMR_VERSION` in `.env`
  pins a release, unset follows `latest`; `init: true` so Docker's tini reaps the ffmpeg children, `depends_on: db` healthy, **not published** — every
  client, including dit's bearer-token requests, reaches it through the `proxy` service's `/api` and
  `/media` routes, the same path the browser's Next rewrite already used — volumes `static-data` and
  `backups-data` (the migrator's pre-migrate dumps, see `docs/agents/db.md`)); `web` (the published image
  `ghcr.io/backshelf/projammr-web:${PROJAMMR_VERSION:-latest}`, `depends_on: api` healthy, not published,
  `INTERNAL_API_URL=http://api:8080` as env,
  `BETTER_AUTH_SECRET` shared with the api); `proxy`
  (`caddy:2.11.4-alpine`, digest-pinned, `depends_on: web` healthy, ports 80, 443 and 443/udp, the root
  `Caddyfile` bind-mounted read-only, volumes `caddy-data` and `caddy-config`); `backup` (profile `backup` only,
  never started by plain `up` — a one-shot `pg_dump` plus a `static-data` tarball into `backups-data`, run by
  hand with `docker compose --profile backup run --rm backup` before a risky operation). `BETTER_AUTH_SECRET`/
  `NOTES_MASTER_KEY` are required (`${VAR:?…}`); `NOTES_MASTER_KEY_PREVIOUS` (only during a key rotation) and
  `SMTP_URL`/`MAIL_FROM`/`MAX_PROJECT_GB`/`MAX_USER_GB`/`DB_POOL_MAX`/`MEDIA_CONCURRENCY`/`SAVE_CONTENT_RETENTION_DAYS`/`JOB_RETRY_DELAY_MS`/
  `LOG_FORMAT`/`LOG_LEVEL`/`MIGRATE_BACKUP` pass through only when `.env` sets them. `TRUSTED_PROXY_HOPS` (default 1) and `TLS_MODE` (default `internal`) are always
  set on `api`, since the server needs a real default in compose regardless of whether `.env` names one
  (`apps/server/src/lib/client-address.ts`, `apps/server/src/middleware/security-headers.ts`).
- `docker-compose.build.yml` (root): the override that builds `api` and `web` from the checkout instead of pulling
  them. It adds only the two `build:` blocks (`context: .`, `target: api` / `web`), so the image names and
  `PROJAMMR_VERSION` tag of the base file still apply to what is built:
  `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`, or
  `COMPOSE_FILE=docker-compose.yml:docker-compose.build.yml` in `.env`. A from-source Tailscale install lists all
  three files.
- `Caddyfile` (root): two sites built from `PUBLIC_HOST`. `https://` uses `tls internal` (Caddy's local CA; the
  global `skip_install_trust` stops it trying to write the container's trust store); `handle /api/*` and
  `handle_path /media/*` (the latter rewriting to `/static{uri}`, the api's own mount) reverse-proxy straight to
  `api:8080` — with no `request_body` limit of their own, since the api enforces `MAX_UPLOAD_MB` itself
  (`maxRequestBodySize`) and a proxy cap could only refuse first with a bare 413 — so a bearer-token client and a
  cookie-authenticated browser request reach the api by the same route now that it is not published; everything
  else falls through to `web:3000`. `TLS_MODE=acme|internal`, a switch between this block and a real-certificate
  one, is a seam left for a later epic — `tls internal` is still the only mode. `http://` serves the CA root at
  `/ca.crt` from `/data/caddy/pki/authorities/local/root.crt` and 308-redirects everything else to HTTPS. HTTPS
  is what makes a LAN hostname a secure context (AudioWorklet
  for the live loudness meter, clipboard); Better Auth names the session cookie `__Secure-…` from the scheme of
  its base URL and the client reads the same name from the scheme Caddy forwards (`X-Forwarded-Proto`), so every
  derived URL is `https://`
  and the site is HTTPS-only. Caddy keeps the incoming `Host`, so Next's server-action origin check passes.
  `reverse_proxy` appends its own address to `X-Forwarded-For` and ignores anything a caller already put
  there — a browser is never a trusted proxy — which is what makes a caller-claimed address impossible to
  forge through it; `TRUSTED_PROXY_HOPS` counts this one hop and no other: Caddy routes `/api/*`
  and `/media/*` straight to `api:8080`, and the web service forwards the chain unchanged rather than adding
  a hop of its own (`apps/client/CLAUDE.md` / `client.md`). Caddy sets no response headers: the API and the
  web app each send `@workspace/security-headers`' set themselves, so either front door serves them.
  iOS fetches home-screen icons outside Safari and does not honour a user-installed CA root for them, so under
  `tls internal` the installed app shows iOS's monogram tile even though `/apple-icon` opens in Safari; only a
  publicly trusted certificate (a real hostname with ACME, or the Tailscale override) gives the installed app its
  icon.
- `docker-compose.tailscale.yml` (root): the opt-in override that serves the stack from a Tailscale node in place
  of Caddy, layered on with `COMPOSE_FILE=docker-compose.yml:docker-compose.tailscale.yml` in `.env` (with
  `docker-compose.build.yml` between them when building from source). It puts
  `proxy` in a `caddy` profile no plain `up` activates, adds `tailscale` (`tailscale/tailscale`, digest-pinned,
  `depends_on: web` healthy, no ports, volume `tailscale-state`, the root `tailscale-serve.json` bind-mounted
  read-only as `TS_SERVE_CONFIG`, healthcheck on containerboot's `:9002/healthz`) and sets `TLS_MODE: acme` on
  `api`. The node's name is `PUBLIC_HOST`'s first label (`TS_HOSTNAME` derived in the `command`, which refuses a
  `PUBLIC_HOST` that is not `*.ts.net`), so `PUBLIC_HOST` is the node's full MagicDNS name. `TS_AUTHKEY` is read
  only on first login (`TS_AUTH_ONCE`); the state volume keeps it. `tailscale-serve.json` carries the Caddyfile's
  HTTPS routes in Tailscale's serve format (`/api` → `http://api:8080/api`, `/media` → `http://api:8080/static`,
  `/` → `http://web:3000`: serve strips the mount and appends the rest to the target's path) and turns Funnel on
  (`AllowFunnel`). Serve _sets_ `X-Forwarded-For` to the connection's source — the tailnet peer, or the public
  client for Funnel traffic — so `TRUSTED_PROXY_HOPS` stays 1. `apps/web/test/stack.test.ts` holds its handlers
  to `stack.ts`'s `ROUTES`.
- `.dockerignore` keeps out node_modules, build output, `.git`, `.env*`, tests, `apps/server/{deps,static}`,
  `packages/dsp/{pkg,rust/target}` and `packages/dit/{pkg,target}` (the image builds its own), `samples`, `apps/dit-app`, `apps/web` (the static
  site, hosted on its own; the `web` target is the Next.js client), and the tooling and doc directories.
- A `static-data` volume created by an earlier root-run image is root-owned, so the `bun` user cannot write
  uploads into it. Fix it once:
  `docker compose run --rm --user root --entrypoint chown api -R bun:bun /app/apps/server/static`.

## CI

`.github/workflows/ci.yml` runs on every pull request to `master`, and is called by `release.yml` on a tag (it
declares `workflow_call`; the caller passes `secrets: inherit` or the `CI_*` secrets arrive empty). A pull request
gets one job, `test-build`: the build, then every suite. The static jobs (`lint`, `format`, `typecheck`, `audit`)
carry `if: github.event_name != 'pull_request'`, so they run for a release only; before that they are local gates
(`.claude/scripts/run-gates.sh`). Actions minutes are the constraint: `ci.yml` does not run on a push to `master` (only `pages.yml` runs on pushes
that touch site/docs inputs), and the browser suite, the app package and the upgrade check stay off pull requests. The images
are not built there; a Dockerfile or compose change is checked locally with
`docker buildx bake -f docker-compose.yml -f docker-compose.build.yml api web` (the compose files need
`BETTER_AUTH_SECRET` and `NOTES_MASTER_KEY` set to interpolate). All but `audit` share one composite action,
`.github/actions/setup/action.yml` (installs Bun at the `packageManager`-pinned version,
restores the Bun cache, installs Rust 1.97.1 with the wasm32 target, clippy and rustfmt through
`dtolnay/rust-toolchain@master` (the `toolchain` input needs the `@master` ref), restores `Swatinem/rust-cache@v2`
for the Rust workspaces, `packages/dsp/rust`, `packages/dit` and `apps/dit-app/src-tauri` (after the toolchain,
because its key includes the rustc version), puts binaryen `version_116`'s `wasm-opt` on `PATH` unless the
`wasm-opt` input is `"false"`, and runs `bun install --frozen-lockfile`).
The workflow adds three root `package.json` scripts: `lint:ci`, `test:ci` and `audit`. Dependabot updates the dit
workspace's crates monthly (`.github/dependabot.yml`).

- `lint`: `bun run lint:ci` (root script `turbo lint -- --max-warnings 0`) — the shared config's
  `eslint-plugin-only-warn` downgrades every rule to a warning locally, so this is the only place a lint
  finding fails anything. `@workspace/dsp`'s lint script runs `cargo clippy -- -D warnings` first, so clippy
  findings fail it too. A second step, `No Jira keys in source`, fails on any `PROJ-<n>` match from
  `git grep` over `apps` and `packages` (tracked files only, so `node_modules` is never walked), excluding
  `apps/server/src/db/migrations/`, which is squashed at the 1.0 baseline. A third step, `bun run version:check`,
  fails when any workspace manifest or the Rust crate is not at the root `package.json`'s version.
- `format`: `bun run format` then `git diff --exit-code`. The gate is that running the real formatter changes
  nothing, rather than a separate `prettier --check` pass: `turbo format` only reaches workspaces that declare
  the script, so a check over a different file set would miss exactly the drift it is there to catch.
- `test-build`, the pull request's one job: a `postgres:17` service container, `ffmpeg` installed directly (no
  PPA), then `bun run build` (first, because it writes `pkg/dsp.wasm` and `pkg/dit.wasm`, which the server suite
  needs and, running outside turbo, cannot build for itself), `bun run test:ci` (every suite but the server's, one
  package at a time: each already runs `bun test --parallel` across the runner's cores and the Rust packages
  compile, so side by side they starve each other), the `static/{assets,images,analysis}` skeleton (`storeUpload`
  writes with flag `wx` and never creates the directory), `bun run migrate` and the server's `bun run test`. Needs
  `DATABASE_URL` (built from the DB password secret), `BETTER_AUTH_SECRET` and `NOTES_MASTER_KEY` (typegen imports
  the Hono app, whose env module throws without them, and turbo runs `server#typegen` ahead of the build).
- `typecheck`: `bun run typecheck`, then a drift check (`git diff --exit-code packages/api/src/enums.ts`) against
  the enums typegen just regenerated, then `bun run knip`, which sits here rather than in `lint` because it
  resolves imports of the gitignored `v1.d.ts` that step writes. Needs `BETTER_AUTH_SECRET`/`NOTES_MASTER_KEY`.
- `audit`: `bun run audit` (root script `bun audit --audit-level=high --ignore GHSA-vfj7-8cjw-p6xm`). An ignore is
  an advisory with no fixed release: `braces` 3.0.3 (stack exhaustion on deeply nested patterns), the last release
  ever published. Dev tooling only: `micromatch` under `fast-glob` under `@next/eslint-plugin-next` and the shadcn
  CLI. Drop it once a fixed `braces` ships.

`.github/workflows/upgrade.yml` is a separate workflow with one job, `upgrade`, run on `workflow_dispatch` only:
start it by hand before a release that carries a migration. It proves the last release's data still
migrates: a step finds the newest dump in `apps/server/src/db/baselines/` and every later step is conditional on
its output, so with no dump committed the job prints that no baseline exists and passes; committing the first dump at
the 1.0 tag is what turns it on. With one it restores the dump into a `postgres:17` service through `docker cp` and
the container's own `pg_restore` (the runner's is 16 and refuses a dump written by 17), runs `bun run migrate` with
`MIGRATE_BACKUP=0`, builds `@workspace/dsp` and `@workspace/dit`, and runs `bun run test:smoke` in `apps/server`: eight files from the
parallel half of the server suite (auth, `/me`, projects, collections, tracks, track audios, comments, sessions) that
sign up and read and write the core entities over HTTP. Same secrets and `ffmpeg`/`static/` setup as `test-build`.

`.github/workflows/e2e.yml` runs the browser suite in one job, `browser`, on `workflow_dispatch` and when
`release.yml` calls it on a tag (`workflow_call`; it has no tag trigger of its own, so a tag runs it once). It calls the setup
action with `dsp: "false"` (the images build the WebAssembly themselves), loads `api` and `web` through
`docker/bake-action` from the same compose files with `SOURCE_REVISION` and read-only `type=gha` scopes, starts a
fresh stack with `bun apps/e2e/src/stack.ts up`, installs Chromium
with `bunx playwright install --with-deps chromium` and runs `bun run test:e2e` in `apps/e2e`. On failure it uploads
`playwright-report/` and `test-results/` as the `playwright-report` artifact and prints `stack.ts logs`;
`stack.ts down` runs under `if: always()`. Needs no secrets.

Three secrets, generated once and never written to the repo: `CI_DB_PASSWORD`, `CI_BETTER_AUTH_SECRET`,
`CI_NOTES_MASTER_KEY`. Each is set in both the Actions and the Dependabot secret stores, since a
Dependabot-triggered run reads the Dependabot store.

Four more secrets belong to the release, in the Actions store only: `DIT_SIGNING_P12` (base64 of the p12 of the
self-signed code-signing identity `app.projammr.dit`) and `DIT_SIGNING_P12_PASSWORD`, and `TAURI_SIGNING_PRIVATE_KEY`
and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (the minisign key whose public half is in `tauri.release.conf.json`). The
repository variable `PUBLIC_REPO` is `true` once the repository is public, which turns the attestations on. On the
maintainer's Mac the originals are in `~/.projammr-secrets/dit-signing/` (certificate, key, p12 and its password) and
`~/.projammr-secrets/dit-updater/` (the update key and its password, public half beside it). **Losing the update key
ends updates for every installed dit app**: the public half is baked into each install. Back both folders up outside
GitHub.

`.github/dependabot.yml` watches the root `bun` ecosystem (covers every workspace through the one
`bun.lock`), `cargo` for `/packages/dit` and `/apps/dit-app/src-tauri`, and `github-actions`, all monthly.
Minor/patch `bun` and `cargo` bumps group into one PR; every action update groups into one PR; major `bun` bumps
open individually. `tauri*` and `@tauri-apps/*` ignore minor and major updates in both ecosystems: the crate and
the npm packages must share a minor or `tauri build` refuses, so they are bumped by hand, together.

`.github/workflows/dit-app-package.yml` builds the dit app on `macos-latest` on `workflow_dispatch` and when
`release.yml` calls it (`workflow_call`), never for a pull request (a macOS runner bills at ten times a Linux
one); both take a `release` input, default false. It calls the setup action with `wasm-opt: "false"` (the input, default
`"true"`, gates only the x86_64 Linux binaryen download, so the Rust toolchain and the `apps/dit-app/src-tauri`
cache stay), generates throwaway secrets and runs `bun run typegen`, then in `apps/dit-app`:
`bun run build`, `cargo fmt --check`, `bun run lint:rust` (clippy `-D warnings`), `cargo test`, and `bun run
package` (`tauri build --bundles app,dmg`, signed ad hoc with `signingIdentity "-"`). It asserts
`Contents/MacOS/dit-app` and `LSUIElement` in the bundle's `Info.plist` and uploads the dmg as the `dit-dmg`
artifact. The `projammr` scheme's `CFBundleURLTypes` assertion is a commented line in the step, for the deep-link
plugin to enable. With `release: true` the job runs on the pinned `macos-15` and the package step differs: a step
imports the p12 into a temporary keychain (`security import -f pkcs12`, `set-key-partition-list`, put on the user's
search list; deleted again under `always()`), and `bun run package -c src-tauri/tauri.release.conf.json` runs with
`APPLE_SIGNING_IDENTITY=app.projammr.dit` and the `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` secrets, which makes Tauri
write the update bundle (`dit.app.tar.gz` and its `.sig`) beside the dmg. A step asserts `Authority=app.projammr.dit`
on the app and on `Contents/MacOS/dit` and `codesign --verify --strict --deep`; another copies the dmg, the update
bundle and its signature to `dit-macos-arm64.dmg`, `dit-macos-arm64.app.tar.gz` and `….sig` (`releases/latest/download/`
addresses an asset by name) and uploads them as the `dit-release` artifact instead of `dit-dmg`. No notarisation:
there is no Apple credential.

`.github/workflows/release.yml` runs on a pushed `v*` tag, in one run, with `concurrency: release-<ref>` and no
cancelling. `verify` runs `packages/release/src/verify-tag.ts` (the tag is `v<root version>`, the changelog has a
non-empty `## [version] - date` section; the section is the release body and the update feed's notes; `-rc.N` is a
pre-release); it then calls `ci.yml` and `e2e.yml`. After both, `images-arch` builds `api` and `web` natively on
`ubuntu-latest` (`linux/amd64`) and `ubuntu-24.04-arm` (`linux/arm64`) — no QEMU emulation — with
`docker/build-push-action`, pushing each single-arch image by digest (`push-by-digest=true,name-canonical=true,push=true`)
to `ghcr.io/backshelf/projammr-{api,web}` under per-arch GHA cache scopes (`{api,web}-{amd64,arm64}`), with buildx
provenance (`mode=max`), an SBOM, `APP_VERSION` on the api target (what `/api/health` reports), and the revision, date
and version labels, uploading each digest as `digest-{api,web}-{amd64,arm64}`. `images` downloads both arch digests for
each image, merges them into the multi-arch `x.y.z` manifest list with `docker buildx imagetools create`, inspects the
merged manifest digest, and attests it when `PUBLIC_REPO` is `true`; `app` runs in parallel with the image jobs and
calls `dit-app-package.yml` with `release: true`. `smoke` pulls the pushed images through `apps/e2e/src/stack.ts up`
(no `--build`) and runs `apps/e2e/src/smoke.ts` with `E2E_EXPECT_VERSION`, which asserts `/api/health` reports the
tag's version. `draft` downloads the app assets, writes `latest.json` (version, notes, `pub_date`, and a
`darwin-aarch64` entry with the `.sig` text and the asset's URL) and `SHA256SUMS`, and creates the GitHub release as a
draft (a rerun uploads over an existing release). `publish` runs last, after the smoke: for a stable version it moves
`x.y` and `latest` onto the `x.y.z` images (`docker buildx imagetools create`), then un-drafts the release (`--latest`,
or `--prerelease` for an `-rc`, which keeps its images at `x.y.z-rc.N` alone). A failing job leaves a draft and no
`latest`. With the repository variable `PUBLIC_REPO` set to `true`, `actions/attest-build-provenance` attests both
merged images and the three app assets; it needs a public repository on this plan. The updater feed
(`releases/latest/download/latest.json`), the dmg link and anonymous GHCR pulls (a one-off package visibility change in
the GHCR settings after the first push) also need the repository public, so the first tag is cut after that.

`.github/workflows/pages.yml` builds and deploys the static Astro + Starlight site (`apps/web`) to GitHub Pages
(`https://backshelf.github.io/projammr`). It triggers on `push` to `master` when `apps/web/**`,
`packages/ui/src/lib/site.ts`, `.env.example`, `docker-compose.yml`, or `docker-compose.tailscale.yml` change, plus
`workflow_dispatch`, with `concurrency: pages` (`cancel-in-progress: false`) and `permissions: contents: read, pages: write,
id-token: write`. `build` installs dependencies with Bun (reusing `~/.bun/install/cache`), configures Pages
(`actions/configure-pages`), runs `bun run --cwd apps/web build` and `bun run --cwd apps/web test` (no server, DB,
secrets or Rust toolchain needed), and uploads `apps/web/dist` with `actions/upload-pages-artifact`; `deploy` publishes
the artifact to the `github-pages` environment with `actions/deploy-pages`.

Status checks are advisory: branch protection is unavailable on the plan, so a red check does not block a
merge.

## .mcp.json

- `next-devtools`: stdio, `npx -y next-devtools-mcp@latest`.

Machine-specific servers (an IDE's MCP on a local port, a locally hosted Projammr MCP) belong in the user-level
config, not here. Jira comes from the `atlassian` plugin, so its tools are `mcp__plugin_atlassian_atlassian__*`.

## Local harness: `.claude/` (gitignored)

`.claude/` is gitignored on `backshelf/projammr` (`.gitignore`) and stays local to the maintainer's machine rather
than being committed to the repository. Contributors do not need it: all gates run through the root `package.json`
scripts (`bun run lint`, `bun run typecheck`, `bun run build`, `bun run knip`, `bun run test`, and
`cd apps/server && bun run test`).

Project-scoped agent skills live in `.agents/skills/` (tracked by `skills-lock.json` — e.g. `better-auth-*`,
`baseline-ui`/`fixing-*`, `vercel-*`, `tailwind-design-system`, `typescript-advanced-types`). Don't hand-edit
installed skills; they are managed by their upstream skill installer.

On machines where the maintainer's local `.claude/` harness is installed, it provides optional hooks and scripts such
as `scripts/run-gates.sh` (queued local gate runner), `hooks/worktree-setup.sh` / `hooks/worktree-db.sh` (worktree
bootstrap and per-worktree database management), and `hooks/format-on-edit.sh`.

## Gotchas list

1. Semicolons are ON (prettier `semi: true`).
2. Bun as PID 1 ignores SIGTERM unless the program installs a handler; `server.ts` has one, and compose's
   `init: true` covers reaping of the media children.
3. `enums.ts` is committed and `v1.d.ts` is gitignored — run root `bun run typegen` after server route/enum
   changes and commit `enums.ts` with the change; a fresh worktree needs `typegen` before anything imports
   `v1.d.ts`. Turbo's cache is keyed on inputs, not on the worktree, so in a fresh worktree root
   `bun run typegen` can report `FULL TURBO` and replay another worktree's log without writing `v1.d.ts`
   there; `cd apps/server && bun scripts/generate-api.ts` writes it unconditionally.
4. packages/ui is heavy: radix-ui + shadcn + recharts + sonner + Blocknote + `@tabler/icons-react`.
5. `components.json` in apps/client: style radix-mira, icons tabler, aliases → @workspace/ui; extra registries
   `@canvas-ui`/`@blocks-so`. shadcn add targets `-c apps/client`; components land in `packages/ui/src/components`.
6. Server gitignores `/static/` — uploaded content is local-only outside Docker (the `static-data` volume
   covers it inside Docker).
7. WebStorm MCP port is hardcoded; next-devtools MCP is the one actually enabled day to day.
8. `git worktree add -b feat/x/y` fails when branch `feat/x` already exists (git refuses a ref nested
   under a branch name) — use `feat/x-y` instead.
9. `bun run <script> -- --flag` strips the `--`, so a turbo-wrapped script receives the flag itself and rejects it.
   To reach the per-workspace tool, run turbo directly (`bunx turbo lint -- --max-warnings 0`) or add a root
   script that does (`lint:ci`).
10. `packages/dsp` and `packages/dit` are the two `packages/*` workspaces with a `build` script and turbo `outputs` (`pkg/**`). Their
    `pkg/*.wasm` binaries are never committed, so anything that runs their code outside turbo builds them first (the server
    suite, a fresh worktree), and every Dockerfile stage that copies either package's source also copies `/pkg`
    from `build-dsp` / `build-dit`. `rust-toolchain.toml` pins an exact patch release (`1.97.1`): rustup matches toolchains by
    name, and the official Rust image names its toolchain `1.97.1`, so a `1.97` channel would download a second
    toolchain inside `rust:1.97.1-slim-trixie`. `wasm-opt` 116 refuses Rust's output unless run with
    `--enable-bulk-memory` (plus `simd`, `nontrapping-float-to-int`, `sign-ext`, `mutable-globals`,
    `reference-types`, `multivalue`). `lint:ci` appends `--max-warnings 0` to the end of the package's lint script,
    which is why ESLint runs after clippy there. `next.config.ts` has no `turbopack`/`webpack` block and no
    `serverExternalPackages`.
