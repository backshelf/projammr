# Projammr (dit) — Ableton Live Extension

Ableton Live extension built with Ableton’s JavaScript/TypeScript Extensions SDK (`1.0.0-beta.1`, Ableton Live 12.4.5+ / Live 13 Beta).

This directory sits outside the monorepo’s Bun workspaces (`apps/*`, `packages/*`) because Ableton’s Extensions SDK is still in closed beta and its tarballs are gitignored under `vendor/`.

## Actions

1. **Projammr: Commit / Open dit…** (right-click any Audio/MIDI Track, Scene, Clip, or Clip Slot)
   - Talks directly to the running `dit` menu bar app over `dit.sock`.
   - Shows the current set, branch, saves since last commit, and suggested diff summary in a Projammr-styled modal dialog.
   - Commits (and pushes, or keeps local with `--no-push`) or opens the `dit` menu bar panel.

2. **Projammr: Add Note / Cue Point…** (right-click an Arrangement time selection on an Audio or MIDI Track)
   - Captures the selected track names, 1-based bar range (`Bars X.Y–A.B`), and `positionMs`.
   - Adds a Live Cue Point at the selection start (in one undo step) and/or posts a timestamped comment to Projammr (`POST /api/comments`).

3. **Projammr: Sync Comments to Cue Points…** (right-click any Audio/MIDI Track or Scene)
   - Resolves the open set’s bound Projammr session → primary/latest `track_audio` version → open timestamped comments.
   - Converts each comment’s `positionMs` to beats at the current tempo, skips duplicates already in Live, and adds all selected Cue Points in one undo step (`withinTransaction`).

## Setup (SDK tarballs)

Ableton’s beta SDK tarballs are **not committed** to this repo (`vendor/` is gitignored). Download `extensions-sdk-1.0.0-beta.1.zip` from Ableton’s beta portal and extract the two tarballs into `extensions/ableton/vendor/`:

```bash
mkdir -p extensions/ableton/vendor
unzip -j ~/Downloads/extensions-sdk-1.0.0-beta.1.zip \
  "extensions-sdk-1.0.0-beta.1/ableton-extensions-sdk-1.0.0-beta.1.tgz" \
  "extensions-sdk-1.0.0-beta.1/ableton-extensions-cli-1.0.0-beta.1.tgz" \
  -d extensions/ableton/vendor
```

Then install, test, and build:

```bash
cd extensions/ableton
cp .env.example .env   # point EXTENSION_HOST_PATH at your Live app bundle
npm install
npm test
npm run build
```

## Running in Ableton Live

### Developer Mode (live reload)
1. In Live: **Settings › Extensions** → enable **Developer Mode**.
2. Run:
   ```bash
   cd extensions/ableton
   npm start
   ```

### Installing as an `.ablx` package
Build a distributable archive and install it via **Settings › Extensions** in Live:

```bash
cd extensions/ableton
npm run pack
```

## Authentication for Projammr API calls

For posting and syncing comments, the extension looks up the bearer token in order:
1. `PROJAMMR_TOKEN` environment variable
2. `<extension storageDirectory>/auth.json` (`{ "<instanceUrl>": "<token>" }`)
3. `dit`’s existing macOS Keychain entry (`service = "dit"` or `"dit.dev"`, `account = <instanceUrl>`)

You can also override the target server URL via `PROJAMMR_INSTANCE` in `.env`.
