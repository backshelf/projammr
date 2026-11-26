# apps/dit-app

dit's menu bar app: a Tauri 2 shell (`src-tauri/`, Rust) around a Vite + React panel (`src/`). The shell runs
`dit-daemon`, serves the cli over the local socket and owns the bar item and the panel window. Full reference:
`docs/agents/dit.md`, "The app". Read it before editing.

## Commands

```bash
bun run dev          # tauri dev with the dev identifier (below); Vite starts through beforeDevCommand. macOS only
bun run dev:web      # Vite alone on :1420, in a browser: every invoke fails, there is no app behind it
bun run build        # vite build, then typecheck. Never `tauri build`
bun run test         # bun test --parallel; the bridge is mocked with @tauri-apps/api/mocks
bun run lint         # eslint over src/
bun run lint:rust    # cargo clippy -D warnings over src-tauri. macOS only; turbo's `lint` does not run it
bun run package      # tauri build --bundles app,dmg. macOS only; no updater, no signing key needed
# a release also passes `-c src-tauri/tauri.release.conf.json` and TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)
cargo test --manifest-path src-tauri/Cargo.toml   # macOS only
```

## Layout

- `src/ipc.ts` — the panel/app contract: `Snapshot`, `Commands`, `STATE_EVENT`. Hand-written; the Rust twin is
  `src-tauri/src/snapshot.rs`. Change both and `fixtures/snapshot.json` together.
- `src/bridge.ts` — typed `call`, `onState`, `onFocus`, `pickFolders` and `mediaUrl` (`convertFileSrc`, for audio the
  app has allowed) over `invoke`, `listen`, the dialog plugin and the asset protocol.
  `src/store.ts` and `use-snapshot.ts` — the one snapshot store. Outside tests, nothing else in `src/` imports
  `@tauri-apps/*`.
- `src/panel.tsx` — the panel: the snapshot, `screenOf(snapshot, nav)` (`screen.ts`, pure) choosing the one screen,
  the keys (`keymap.ts`, `createKeymap`), focus on show (`focus-target.ts`) and the window's height
  (`use-panel-height.ts`). Navigation (`Nav`: home, repos, settings) is the panel's own state, never the app's.
- `src/screens/` — one file per screen (sign-in, machine-name, repos, adopt, adopting, set, restore, settings); `src/set/` — the
  set screen's parts (masthead, skyline readout and its model, commit box with `suggestion.ts` and `draft.ts`, saves,
  last commit, track proposal, status lines); `src/renders/` — the render band under the saves (`render-list.tsx`, a
  listbox that owns `↑/↓`, `Y`, `N`, `Space`), one `render-card.tsx` for every card state, the "Not this set" picker, the
  player (`preview-player.ts`, ported from the retired scanner) and `render-model.ts`, its
  pure copy and facts; `src/commit-shortcut.ts` — how the commit box takes `⌘↩`;
  `src/settings/` — the settings rows, the shortcut recorder, the folder list and the list of remembered decisions;
  `src/accelerator.ts` — the recorder's press to the accelerator string the app registers.
- `src/update-offer.tsx` — the menu's "Update to <version>" and "Updating…" (`UpdateItem`), reading `Snapshot.update`
  through `UpdateProvider`, which the panel wraps the screen in.
- `src/backfill/` — the backfill window (`backfill.html` loads `main.tsx`): `window.tsx` shows the step the view names
  (`find`, `check`, `run`, `done`) in one `frame.tsx`; `folder-list.tsx` is the folder listbox, `picker.tsx` the
  combobox, `keys.ts` the window's keys, `model.ts` its pure copy. It reads `BackfillView` from `src/backfill-ipc.ts`
  (`dit://backfill`, `fixtures/backfill.json`) through `backfill/store.ts`; design in `DESIGN.md`, `### The backfill
window (dit)`.
- `src-tauri/` — its own Cargo workspace. `src/update.rs` is the updater; its feed and public key are in
  `tauri.release.conf.json` only.

## Rules

- **Linux CI never compiles Tauri.** `build`, `typecheck`, `lint` and `test` run on ubuntu through turbo and must
  not need webkit or a Rust toolchain; anything that does goes in `dev`, `package` or `lint:rust`, and the macOS
  workflow (`.github/workflows/dit-app-package.yml`) runs it. Pure logic belongs in a `dit-*` crate that Linux tests.
- **The Rust side owns state.** The panel derives its screen from `Snapshot` and asks through `call`; it holds no
  token and reads no path.
- Design: the panel's register is in `DESIGN.md` (`### The panel (dit)` under Layout, `### Panel (dit)` under
  Components). The `design` rule loads for `src/**/*.{tsx,css}`; read the section before a visual change.
- `@tauri-apps/*` npm packages and the `tauri*` crates move together by hand, one minor at a time (Dependabot
  ignores both); `tauri build` refuses a minor mismatch.

## Updates

`tauri-plugin-updater` is registered only when the config has `plugins.updater`, which `tauri.release.conf.json` alone
carries (with `createUpdaterArtifacts`, which makes `tauri build` demand the signing key). A dev run or a local
`bun run package` has no updater and needs no key. `src-tauri` tests run the plugin against a loopback `latest.json`
with a key made in the test; the real key's private half is a release secret and is never in the repo.

## Dev identifier

`tauri dev` runs under `app.projammr.dit.dev` (`src-tauri/tauri.dev.conf.json`): its own data folder, no
start-at-login, so it can run beside an installed build. It still claims `dit.sock` and the Keychain service `dit`,
so quit an installed app before `bun run dev`.

## Plugins and the OS in the dev loop

Most of what `src-tauri` does with the Mac cannot be tried under `bun run dev`; run a built, installed app for these
(`bun run package`, copy `dit.app` to `/Applications`, quit it from the panel menu first if another runs):

- **`projammr://` links** reach only a bundled app that LaunchServices has seen, which means one in `/Applications`
  (`CFBundleURLTypes` comes from `plugins.deep-link` in `tauri.conf.json`; the dev config empties it). Test one with
  `open projammr://session/<id>` or `open projammr://dit/checkout/<id>`.
- **The notification's "Add as version" action** is reported to a bundled app only: under `tauri dev` macOS attributes
  the notification to Terminal and no action arrives. Whether the button shows may depend on the notification style in
  System Settings, Notifications, dit (Alert or Banner): the PR's manual checks record what each does.
- **Start at login** is never on under the `.dev` identifier (`set_setting autostart` rejects). The LaunchAgent is
  `~/Library/LaunchAgents/app.projammr.dit.plist`; `launchctl list | grep dit` shows it after the next login.
- **Screen Recording** is granted to the app's code identity (see the signing section): an ad hoc rebuild asks again.
  macOS asks once; after that "Grant" in settings opens System Settings instead.
- **Install the dit command** asks for an administrator password and links `/usr/local/bin/dit`; it refuses under the
  `.dev` identifier. Tests never run it: only the command string it builds is tested.
- **The artwork scheme** (`dit-art://`) and the asset protocol are the webview's: they work under `tauri dev`, but the
  scheme needs a signed-in app (the token is read in Rust).

## Signing

A pull request's CI build is signed ad hoc (`signingIdentity "-"`), and an ad hoc build has a new code identity every
time: the Keychain asks to let the app read dit's item again and the Screen Recording grant is lost. A release (the
`release.yml` tag workflow, or `dit-app-package.yml` run with `release: true`) is signed with one self-signed identity
named `app.projammr.dit` (a 10-year certificate with the code-signing usage), so every release has the same code
identity and an update keeps both. `APPLE_SIGNING_IDENTITY` overrides the config's `"-"`; the workflow imports the
identity into a temporary keychain from the secrets `DIT_SIGNING_P12` (base64 of the p12) and
`DIT_SIGNING_P12_PASSWORD`, then asserts `Authority=app.projammr.dit` on the app and on the bundled `dit`. The secrets
are never named `APPLE_CERTIFICATE*`: Tauri's own import takes only Apple-named identities. There is no
notarisation, so the first open needs the Gatekeeper dance (the site's `/dit/` page says so). The p12, its password
and the certificate are in `~/.projammr-secrets/dit-signing/` on the maintainer's Mac, and the update key in
`~/.projammr-secrets/dit-updater/`.

A build you run every day needs the same stable identity, and it can be the release's, so a local build and a
released one share their Keychain and Screen Recording grants. Steps for you to run, once; nothing here does it for you:

1. Import the p12 (the password is in `p12-password.txt` beside it):

   ```bash
   security import ~/.projammr-secrets/dit-signing/dit-signing.p12 -k ~/Library/Keychains/login.keychain-db \
     -f pkcs12 -P "$(cat ~/.projammr-secrets/dit-signing/p12-password.txt)" -T /usr/bin/codesign
   security find-identity -p codesigning        # lists "app.projammr.dit"
   ```

   The certificate is self-signed, so `find-identity -v` calls it not trusted; `codesign` signs with it by name all
   the same, and no trust setting is needed.

2. Build with it and install:

   ```bash
   cd apps/dit-app
   APPLE_SIGNING_IDENTITY="app.projammr.dit" bun run package
   cp -R src-tauri/target/release/bundle/macos/dit.app /Applications/
   codesign -dvv /Applications/dit.app 2>&1 | grep Authority   # Authority=app.projammr.dit
   ```

3. Open the app, and answer the Keychain prompt with Always Allow, and grant Screen Recording once. Both survive
   the next build signed by the same identity.

## Gotchas

- `src/app.css` names `@source` explicitly: Tailwind v4 infers its sources from the process cwd, which is
  `apps/dit-app` under Vite but the repo root under `turbo`, so an unnamed scan would miss or overreach.
- `@workspace/ui` is a devDependency but Vite bundles it into the panel, so it ships.
- `vite.config.ts` uses `strictPort` on 1420 because `tauri.conf.json`'s `devUrl` names it; a busy port must fail.
- `bunfig.toml` preloads `@workspace/test`'s happy-dom setup. `mockIPC` never drops a listener on `unlisten`, so a test
  that emits after stopping sees Tauri log a missing-callback line; the handler is still not called.
- A component test ends with `teardown` from `src/test-support.tsx`, not `cleanup` and `clearMocks` alone: listeners
  stop asynchronously, and mocks cleared before they do leave Tauri's event plumbing gone. `mockApp` answers
  `get_snapshot`, records every other command and lets a test throw to refuse one; `renderScreen` renders one screen
  with the providers the panel gives it.
- Every `Input` in the panel is `PanelInput`: below the phone tier the field steps up to the lead size, and the panel
  is always below it.
- The panel's content is at least `min-h-56` tall so a menu or the project picker opens inside the window, which is
  sized to the content and cannot draw a popup outside itself.
- The set screen's `SetMasthead` pulls itself to the panel's edges with `-mx-4 -mt-4`, which assumes the panel's `p-4`.
- `⌘↩` is claimed, not listened for: the panel's one keymap treats a matched key as handled, so the commit box claims
  it through `commit-shortcut.ts` and the panel runs the claim. `Chrome` in tests installs the same keymap.
- The draft lives in `localStorage` (`dit-app:commit-drafts:v1`); a test that mounts the commit box clears it first.
- `eslint`'s design-token rule bans `motion-reduce:` in components; the skyline readout's reduced-motion rule is in
  `app.css` on `data-reduced-motion`, which the component sets from `useReducedMotion`.
