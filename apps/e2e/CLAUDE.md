# apps/e2e

End-to-end checks against the shipped compose stack: the proxy, `web`, `api` and the database, started from
`docker-compose.yml` and nothing else. Full reference: `docs/agents/monorepo.md` (Testing, CI).

## Layout

- `src/stack.ts` — the stack driver: `up [--build]`, `logs`, `down [--images]`. It writes `.stack/stack.env`
  (gitignored: fresh `BETTER_AUTH_SECRET` and `NOTES_MASTER_KEY`, `PUBLIC_HOST=localhost`, `MIGRATE_BACKUP=0`, and
  `PROJAMMR_VERSION` when set), runs compose under the fixed project `projammr-e2e`, and after `up` saves the
  proxy's local CA to `.stack/ca.crt`. `--build` layers `docker-compose.build.yml` over the pulled images and tags
  what it builds `e2e` unless `PROJAMMR_VERSION` says otherwise; `down` removes the volumes, and `--images` also
  the images the build override builds (never a `latest` tag).
- `src/smoke.ts` — the boot check: first sign-up is the admin, a second is refused, a project and a track, a WAV
  uploaded and linked, its `audio_analysis` job done, the file served under `/media`, `/api/health` reporting a
  version (equal to `E2E_EXPECT_VERSION` when set: the release workflow's check that the tag's version reached the
  image). Bun built-ins and relative imports only, so a runner with nothing but Bun can run it against pulled images.
- `src/wav.ts` — `toneWav(seconds = 2)`, the sine WAV the smoke (two seconds) and the upload spec (ten, so it
  is still playing when the spec checks the player) both send. No imports.
- `playwright.config.ts`, `tests/` — the browser suite (below).
- `docker-compose.e2e.yml` — replaces the proxy's published ports with `E2E_HTTP_PORT` and `E2E_HTTPS_PORT`
  (defaults 80 and 443). It is the only difference from the stack users run.

## Commands

```bash
bun run typecheck        # bun check
bun run lint             # warnings only locally; CI fails on any
bun run stack up --build # build the images from this checkout and start the stack
bun run smoke            # E2E_BASE_URL (default https://localhost), E2E_CA_FILE and E2E_EXPECT_VERSION (optional)
bun run test:e2e         # the Playwright suite; E2E_BASE_URL as for the smoke
bun run stack down --images
```

There is no `test` script on purpose: turbo's `test` runs on every gate and both the smoke and the suite need a
running stack.

## The Playwright suite

Chromium only, specs in `tests/`, `baseURL` from `E2E_BASE_URL` (default `https://localhost`). The browser runs with
`ignoreHTTPSErrors`: the proxy's certificate comes from a CA generated per stack, and the smoke already proves the TLS
path with verification on.

**Start every run from a fresh stack** (`stack.ts down`, then `up`). The first sign-up on an instance makes the
instance admin and closes registration behind it, so a stack that already has accounts refuses the suite's own
sign-up. That sign-up is `tests/sign-up.spec.ts`, Playwright's `setup` project: it registers `OWNER` through the UI,
asserts the account is the admin, and saves the session to `.stack/owner.json`. Every other project has
`dependencies: ["setup"]` and loads that session, so its specs start signed in. The specs share the one instance and
run in order on one worker; a spec that needs a project or track it is not testing makes one with `seedTrack` (API
calls as the signed-in owner) rather than depending on another spec's data.

`tests/fixtures.ts` holds what every spec shares: `test` and `expect` (re-exported from Playwright), `OWNER` and
`OWNER_STATE`, `seedTrack`, `seedTrackAudio` (a tone uploaded and linked as the track's first version, through the
API), `newVisitorContext`, and the axe helper. A cookie-bearing multipart post from a Playwright `request` context
needs an explicit `Origin` (a browser sends one; `seedTrackAudio` builds it from the project's `baseURL`); JSON posts
pass without one. `newVisitorContext(browser)` is a context with no session, for a signed-out guest or a second
account: a context made from `browser` inherits the project's options, the owner's saved session included, so it is
given an empty storage state, and the caller closes it. A link the UI only copies (a share link, an invite link) is
read from the clipboard: `test.use({ permissions: ["clipboard-read", "clipboard-write"] })`, then
`navigator.clipboard.readText()`. **Every spec ends with `await expectNoSeriousViolations(page)`** on
its final page: it runs `AxeBuilder` and fails listing each serious or critical violation as `rule (impact): target`.
Moderate and minor findings are not gated. A failure here is a defect in the app: fix it there (a missing accessible
name, a list item outside its list) rather than excluding the rule or the element.

Locators are `getByRole` and `getByLabel`. When a control has no accessible name, give it one in the client rather
than reaching for a `data-testid`; the one exception is the drop zone's hidden file input.

Playback has no `<audio>` element to read: the player bar's control turns from Play to Pause and the seek slider's
`aria-valuenow` moves while it plays. Headless Chromium plays the WAV without a sound device. The track page's seek
slider (inside `main`) steps five seconds per arrow key, Home and End go to the ends, and its `aria-valuetext` reads
`0:10 of 1:00`. The comments popover is a `dialog` named after its pill ("Comments on v1", then "1 comment on v1"),
and it fades in: wait for `opacity` 1 before running axe over it, or axe reads its text mid-fade as low contrast. The
tracks table is at `/project/<id>/track/all`; the first row's title cell is the grid's one tab stop, reached by Tab
after the sidebar, player and toolbar controls.

Iterating on one spec against a stack that already has the owner: `bunx playwright test <spec> --no-deps`, since the
`setup` dependency would try the first sign-up again.

```bash
export E2E_HTTP_PORT=18080 E2E_HTTPS_PORT=18443
bun apps/e2e/src/stack.ts down; bun apps/e2e/src/stack.ts up --build
cd apps/e2e && E2E_BASE_URL=https://localhost:18443 bunx playwright test   # `bunx playwright install chromium` once
```

A failure leaves `playwright-report/` and `test-results/` (traces) in `apps/e2e`, both gitignored.

## The compose hazard

A checkout's root `.env` can carry `COMPOSE_FILE` and a real `TS_AUTHKEY` (`worktree-setup.sh` strips both from a
worktree's copy, but the main checkout's is the live stack's), and compose reads `.env` from the project directory, so
a bare `docker compose up` in the repository root can start a second Tailscale node on someone else's key. Every compose call goes through `src/stack.ts`, which passes `-p projammr-e2e` and `--env-file` naming its own
file; never run a bare `docker compose` here, and check that `docker ps` shows nothing new outside `projammr-e2e-*`.

## Running the smoke locally

Pick free high ports, so the stack does not collide with one already running:

```bash
export E2E_HTTP_PORT=18080 E2E_HTTPS_PORT=18443
bun apps/e2e/src/stack.ts up --build
E2E_BASE_URL=https://localhost:18443 E2E_CA_FILE=apps/e2e/.stack/ca.crt bun apps/e2e/src/smoke.ts
bun apps/e2e/src/stack.ts down --images
```

With `E2E_HTTPS_PORT` set, `up` also writes `TRUSTED_ORIGINS` naming `https://localhost` and the remapped origin: the
API refuses a cookie-bearing form post (the upload) whose `Origin` is not on that list, whatever host it addressed.
`E2E_CA_FILE` is how the smoke trusts the proxy's certificate; it never turns verification off.
