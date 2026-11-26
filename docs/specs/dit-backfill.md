# dit backfill spec: backfill, machines and retiring the scanner

_Written 2026-10-22. Mode: plan. Brief: "pls plan the next dit epic? i think we're up to 5 now?" (epic 5 of
the dit roadmap, PROJ-1359; the last epic of release 1)._

## Summary

Epics 1 to 4 made dit a cli, a hub and a menu bar app that records every save of a set Live opens from now on.
This epic brings everything before that in, removes the scanner, and ships the app. A backfill window in the
dit app finds the producer's Live project folders. For each folder it proposes a track and the existing
session each set matches. Once the producer starts it, every chosen folder becomes a repo, each set gets one
commit at its current state, and Live's `Backup/` copies become earlier saves, all with their content.
Existing sessions keep everything attached to them, and every session takes its tempo, key and structure from
its newest save. Then the scanner, its routes, its devices and its docs pages are deleted. Machines become
proper rows the web lists and links to, "Not a bounce" follows the producer across machines, and a tag builds
the server images and the app's dmg into a GitHub release the app updates itself from. The one thing it must
get right: no existing session, comment, version or note is lost or duplicated when its set is brought in.

## The feature

### Who and where

- **The producer** runs the backfill once on each Mac that holds old projects, and again for a drive found
  later. They see their machines under Settings → Devices, and install and update the app from the release.
- **A collaborator** (editor or viewer) sees the result on the web: sessions that gain a commit log going
  back years and the sessions no set matched. They see no machine but their own.
- **An outsider on a share link** sees nothing new.
- **The instance admin** sees every user's machines in Instance settings, and installs the server from the
  release's images.
- **Surfaces.** The dit app's backfill window, its panel menu and its update item. The cli (`dit backfill`).
  The web client: Settings → Devices, Instance → Machines, the repo page and repositories table, the sessions
  table, the session page's facts. The hub API and MCP. The public site's `/dit/` page. The GitHub release.

### Concepts

- **Backfill.** Bringing existing Live project folders into dit in one batch: each ` Project` folder becomes a
  repo, each set in it a session (new or existing) with one commit at its current state and its `Backup/`
  copies as earlier saves.
- **Match.** An existing session on the hub that a set on disk is the same set as. A set matches by the file
  path the session last recorded, else by its fingerprint: the set file's size and a hash of its first and
  last 64 KiB, compared with what the session last recorded (the set, or one of its `Backup/` copies, may
  carry it). A matched session keeps its id, track, notes, comments, attachments and versions; the set's
  history is added to it.
- **Content-less save.** A save the hub knows the time and structure of but has no file for: every save the
  scanner recorded. A dit save at the same millisecond fills it in instead of adding a second save; a scanner
  save stamped at a `Backup/` copy's name time is superseded by the copy dit brings in.
- **Machine.** A Mac running dit, as the hub knows it: name, platform, app version, last seen, the set open on
  it, the repos it has pushed. Only what dit registers is a machine; scanner devices are gone. A removed
  machine is signed out and keeps its history under its last name.

### Interface

**The backfill window.** A resizable window of the dit app, separate from the panel, opened from the panel
menu's "Bring in projects…" and the repos screen's first-run button. One window at a time; opening it again
brings it forward. It is one frame for three steps: the folders as a list on the left, the chosen folder on
the right, and a footer with the step's line and its actions. The steps replace one another:

1. _Find_: the roots to search sit above the list (none at first; "Choose folders…" adds one with the system
   picker, each root removable). The list fills with the ` Project` folders found under them as they are
   found, each with its set count, size on disk and the date of its newest save, sorted newest first, ticked
   by default; a folder that is already a repo is listed as "Already in dit" and cannot be ticked. The right
   side lists the chosen folder's sets. "Next" goes on with the ticked folders.
2. _Check_: dit reads every set in the ticked folders into each folder's `.dit/` (the local recording the run
   would do anyway, with progress per folder in the list) and asks the hub for the project's sessions and for
   what the folders would add to storage. The list shows each folder's set count and whether it has a doubt
   (a set it couldn't read, a sync warning). The right side holds the chosen folder's name, the project it
   goes into (a picker, the last used project by default) and its sets. Each set row has the set's name, its
   `Backup/` copy count, the proposed track (a picker of the project's tracks plus "New track: <name>") and the
   session it matches ("Matches 'science123' on <track>" or "New session"; a picker lists the project's other
   unmatched sessions and "New session"). The storage line sits in the footer beside "Back" and "Start".
   "Back" returns to Find, keeping every correction.
3. _Bring in_: the list shows each folder's state (waiting, committing, uploading, done, paused, failed); the
   right side shows the chosen folder's progress (sets committed, saves stored, data uploaded) and, on a
   failure, its reason and "Try again". "Pause"/"Resume" for the whole run sit in the footer. When every
   folder is done, the completion readout replaces the frame.

Going back to Find, or closing the window on Check, removes the `.dit/` folders Check made; nothing reaches
the hub before Start.

**The panel.** The menu (`…`) gains "Bring in projects…" (with "Paused" or "Running" as a second line while a
run exists) and, when a newer release exists, "Update to <version>". The repos screen's first-run line becomes
"Open a set in Live and dit will offer to track its project, or bring in all your projects at once." with a
"Bring in projects…" button.

**The cli.** `dit backfill` lists the ` Project` folders under the project folders Live knows (its library
settings) and `~/Music`, with set counts and sizes; `dit backfill --in <root>...` lists under other roots.
`dit backfill <folder>...` brings those folders in with the proposals as they stand (existing matches, the
folder's track, the repo's project from `--project <id>` or the last used), printing progress per folder on
stderr; `--json` prints the result as one object. It resumes a stopped run of the same folders. With the app
running it goes through the app and the window shows the same run.

**The web.**

- _Settings → Devices → Machines_ (replacing "Scanners"): first the user's "Not a bounce" files, shared by
  every machine, each removable; then one row per machine of the caller's: name, platform, app version, online
  or last seen, the set open on it, its "Never here" folders (each removable), and the repos it has pushed
  (from its commits and saves) as links to their repo pages. Each row has an anchor (`#machine-<id>`) and
  "Remove", which signs that machine out of dit and keeps its history.
- _Instance → Machines_ (admins): every user's machines: owner, name, platform, app version, last seen.
  Read-only.
- The repo page's "Last push <time> from <machine>" and the repositories table's machine column link to the
  machine's row when the machine is the viewer's; another user's machine stays plain text.
- The sessions table gains an "In dit" column (yes/no), filterable like any column; the completion readout
  and the repo page link to the project's sessions filtered to "No".
- A session's tempo, key, time signature, structure and plugins come from its newest save, so a backfilled
  session's page, the plugins page and the tables show them.
- Assets the scanner uploaded keep their "Rendered on <machine>" line, path and "Copy path"; the "Reveal"
  action is gone.

**The hub API**, as the app, the web and MCP see it:

- Backfill: the repo's sets are adopted with the session and track the producer chose (an existing session,
  or a new one on a chosen or new track) before its saves are pushed; adopting during a backfill writes no
  activity entry. Its commits and saves push like any push.
- Matching: a read of the project's sessions no repo holds, each with its recorded path and the fingerprints
  it has recorded, for the app to propose matches.
- Storage: dit sends the objects a folder would push, each with its size; the hub answers the bytes it doesn't
  hold and the caller's remaining space.
- Saves: a save at the same millisecond as a content-less save fills it; after a chunk lands, a content-less
  save the scanner stamped at a `Backup/` copy's name time is superseded by the dit save that copy became. The
  newest save of a session writes the session's tempo, key, time signature, structure and plugins.
- Machines: every dit request names its machine by id; saves, commits, segments and a repo's last push carry
  the machine's id. `GET /machines` gains the open set's name, the repos each has pushed and its "Never here"
  folders; an admin read lists every user's machines. Removing a machine marks it removed and revokes its
  sign-in.
- Rejections: "Not a bounce" files (by render fingerprint, shared by every machine of the user) and "Never
  here" folders (by path, per machine), listed, added and removed through the hub.
- Sessions list: an `inDit` field and filter.
- The scanner's routes, device commands, rejections and devices are gone, with its settings and the device
  settings scope.

**MCP.** `list_machines` gains app version and the repos a machine pushed; the sessions list tool gains
`inDit` and the filter. No backfill tool: it needs the files on the machine.

**The release.** Pushing a `v*` tag runs the release workflow: it checks the tag equals the root version and
`CHANGELOG.md` has its section, runs the CI and end-to-end gates, builds and pushes
`ghcr.io/backshelf/projammr-{api,web}` for amd64 and arm64 at `x.y.z` with provenance and SBOM, builds the
dit app's arm64 dmg (`dit-macos-arm64.dmg`) signed with the stable self-signed identity `app.projammr.dit`,
signs the update bundle with the updater's key and writes its `latest.json`, writes `SHA256SUMS` with
build-provenance attestations, boots the stack from the new images in a smoke test, and only then tags the
images `x.y` and `latest` and publishes the release. The dmg is not notarised. The first tag is cut once the
repository is public (PROJ-880).

**Updates.** The app checks the latest GitHub release at launch and every six hours. A newer one shows as
"Update to <version>" in the panel menu; choosing it downloads, verifies the update's signature, waits for
the push queue and any backfill to be idle, installs and relaunches. Nothing installs without the click.

**The site.** A `/dit/` page replaces `/scanner/`: what dit is, "Download dit for Mac" linking the latest
release's dmg with the Gatekeeper line under it. The nav, the home page's calls to action and the 404 page
point at it; `/scanner/` and `/docs/scanner/*` redirect to it and to the docs index.

### Flows

**Backfill from the app.**

1. Panel menu › "Bring in projects…". The window opens on Find with no roots.
2. "Choose folders…", pick `~/Music/Ableton`. dit lists the ` Project` folders under it as it finds them,
   ticked; folders already in dit are listed and disabled. Untick the ones that don't matter. "Next".
3. Check: dit reads every set in the ticked folders, with progress per folder, then shows each folder's block
   with its proposals and the storage line. Change a track, pick a different session, or set a folder's
   project. "Start" is enabled when the storage line fits.
4. Bring in: folders run one at a time, newest first. Per set: the sets that have no commit get one, "Brought
   into dit", on their newest state; the folder's sets are adopted as chosen; its saves and commits push, and
   the next folder starts. Live keeps working; a set Live saves during the run is recorded by the watcher once
   its folder is in.
5. The completion readout: "Your history goes back to March 2019: 3,412 saves across 266 sets in 41
   projects." with "See sessions not in dit" (the web's sessions table filtered to "No") and "Done".

Backing out: "Back" on Check returns to Find; closing the window on Find or Check leaves nothing behind.
Closing during Bring in pauses the run; the panel menu shows it as paused, and reopening the window shows the
paused run with "Resume". Quitting the app or the Mac sleeping pauses it the same way; a lost connection makes
its folder wait and carry on when the hub is back.

**Backfill from the cli.** `dit backfill ~/Music/Ableton/science Project` → proposals as they stand → per
folder progress → the completion line. Ctrl-C stops after the current set; running the same command resumes.

**A machine on the web.** Settings › Devices › Machines → the row → a repo link opens the repo page; "Remove"
asks "Remove Studio Mac? It's signed out of dit; its saves and commits stay." → the row goes and the app on
that Mac shows it was signed out. A repo page's "from Studio Mac" opens the row.

**Release and update.** Bump the version, write the changelog section, tag `v0.10.0`, push the tag → the
workflow publishes the release → within six hours each running app shows "Update to 0.10.0" → click → it
relaunches on the new version.

### States

- _Find_: no roots ("Choose the folders your Live projects are in."); searching (folders appear as found, a
  "Searching…" line with the count); none found under the roots ("No Live projects under these folders.");
  folders listed; every folder already in dit ("Everything here is already in dit.").
- _Check_: reading sets ("Reading sets · 12 of 41" per folder); proposals shown; a set that can't be read
  ("Couldn't read this set. It's stored as it is and read again later."); the hub unreachable ("Can't reach
  <host> to check your sessions." with "Try again"; Start disabled); storage over ("These folders need 14.2 GB
  and you have 9.8 GB left. Untick folders until they fit." Start disabled).
- _Bring in_: per folder waiting, committing ("12 of 41 sets"), uploading ("3.1 of 8.4 GB"), waiting for the
  hub ("Waiting for <host>"), done, paused, failed with the reason and "Try again" (the other folders
  continue); the whole run paused ("Paused. Resume to carry on where it stopped.").
- _Done_: the readout; a folder that failed stays listed with its reason and "Try again".
- Panel menu: "Bring in projects…", with "Paused" or "Running" under it while a run exists (opens the
  window); "Update to <version>", "Updating…".
- Machines pane: none ("No machines yet. Install dit on the Mac you make music on." with the `/dit/` link);
  rows; a machine offline ("Last seen 3 days ago"); no "Not a bounce" files (the list is left out).
- Instance machines: none; rows.
- Sessions table "In dit": yes for a session with a repo, no otherwise.

### Rules

- A ` Project` folder is a repo unit (the roadmap's repo rule); sets outside one are not offered. Inside it,
  only sets and `Samples/` are tracked; `Backup/` is read and never written or pushed as a folder; `Freeze/`,
  `Recorded/`, `Ableton Project Info/` and stems folders are never read.
- A `Backup/` copy's save time is its modified time (the stamp in its name is when Live replaced it, not when
  it was saved). Copies are recorded in time order before the current set; two saves of one set at the same
  millisecond are a millisecond apart. A copy dit can't read is stored whole, like any unreadable save.
- A set whose branch has no commit gets exactly one, at its newest state, with the message "Brought into dit";
  a set with a commit gets none. The commit's time is when it was made; the readout's dates come from saves.
- Match order: a session whose recorded path is this file, then a session whose recorded fingerprint is the
  set's or one of its `Backup/` copies', then a new session. Only sessions no repo holds are candidates. A
  session is matched to at most one set; a second set that would match it is proposed as a new session.
  Existing sessions are never grouped into one lineage.
- Track proposal for a new session: the track of the other sessions already in the folder; else an existing
  track whose title is close to the folder's name; else a new track named after the folder without
  " Project". A matched session keeps its track.
- A dit save at the same millisecond as a content-less save fills that save's content; the row keeps its
  source and machine. A content-less save the scanner stamped at a `Backup/` copy's name time is removed once
  the dit save of that copy lands, when no other save of the session lies between them; a content-less save
  with no copy left on disk stays.
- The newest save of a session (dit's or the scanner's) is what its tempo, key, time signature, structure and
  plugins read from.
- Storage: the storage line counts only the bytes the hub doesn't already hold, from the objects Check
  recorded (sample objects only when the repo pushes samples), against the caller's remaining space; with no
  cap it reads "Needs 14.2 GB. No storage limit on this instance." and never blocks.
- The run is resumable at set granularity: its state is on disk; a set half done is redone, since every step
  is safe to repeat.
- The backfill and Live: a set Live has open is read, never written. A folder joins the watcher once its
  backfill is done; saves Live makes before that are caught up then.
- The backfill pushes its own folders; the push queue leaves a repo alone while the backfill pushes it.
- One run at a time per machine; the cli and the window share it.
- Adopting sets during a backfill writes no activity entries and sends no notification.
- Machines: a machine is only what dit registered. Every dit request names its machine by id; the hub records
  that id on the saves, commits and segments a push carries when their machine name is the machine's name,
  and leaves it empty otherwise. Removing a machine marks it removed, revokes its sign-in and keeps its rows;
  its name is free to reuse. A removed machine that is signed in again is a new registration. Existing rows
  take the id of the one machine of their author with that name, else none. A content-less save has none.
- Rejections: "Not a bounce" is the render fingerprint (the file's size and a hash of its first and last 64
  KiB) and applies on every machine of the user; "Never here" is a folder on one machine. Both are written to
  the hub as they are made, from the app or the cli, and wait to sync while the hub is unreachable. Each Mac's
  existing local lists move to the hub on its first launch of this version.
- Links to a machine's row are only drawn for the viewer's own machines.
- Releases: arm64 only; the dmg is signed with the stable self-signed identity, so an update keeps the
  Keychain token and the permissions granted; Gatekeeper needs right-click › Open on first install. The
  release version is the root version and `apps/dit-app` follows it. A pre-release tag (`-rc.N`) never reaches
  the updater.
- Updates never install while a push or a backfill runs, and never without the click.
- Existing data the day it ships: every scanner revision is a content-less save (as recorded since epic 2);
  scanner devices, their commands, settings, backups, rejections and scan settings are deleted, not converted;
  sessions keep their ids and everything attached to them.
- The scanner is gone from the repository, the server, the site and the docs' `scanner/*` pages (removed,
  their URLs redirecting); pages that linked to them link elsewhere. The demo catalogue seeds through the repo
  API, with commits and time spans.

### Input

- The window: `⌘O` is "Choose folders…", `Space` toggles the focused folder or set row's tick, `↩` on a row and
  `⌘↩` anywhere is the step's primary action (Next, Start), `⌘[` is Back, `Esc` closes on Find and Check.
  Every picker is a combobox with type-to-filter. Focus lands on the step's first control. Progress rows are a
  live region that announces a folder finishing or failing, not every count.
- The panel menu items are menu items; "Update to <version>" says the version; the first-run "Bring in
  projects…" is a button.
- The web: the machines rows and the "In dit" column are the existing settings row and table column, keyboard
  and screen reader behaviour unchanged; the anchor scrolls to and focuses the row; each removable list entry
  has a named remove button.

### Copy

- Panel menu: "Bring in projects…" / "Paused" / "Running" / "Update to 0.10.0" / "Updating…".
- First run: "Open a set in Live and dit will offer to track its project, or bring in all your projects at
  once." / "Bring in projects…".
- Window title: "Bring in projects". Steps: "Find", "Check", "Bring in".
- Find: "Choose the folders your Live projects are in." / "Choose folders…" / "Searching… 38 projects so
  far" / "No Live projects under these folders." / "Already in dit" / "Everything here is already in dit." /
  "8 sets · 2.3 GB · last saved 12 Mar 2024" / "Next".
- Check: "Reading sets · 12 of 41" / "Goes into" (project) / "Track" / "New track: science" / "Matches
  'science123' on Science" / "New session" / "4 backups" / "Couldn't read this set. It's stored as it is and
  read again later." / "Can't reach <host> to check your sessions." / "Try again" / storage: "Needs 8.4 GB of
  your 31 GB left." / "These folders need 14.2 GB and you have 9.8 GB left. Untick folders until they fit." /
  "Needs 14.2 GB. No storage limit on this instance." / "Back" / "Start".
- Bring in: "Waiting" / "12 of 41 sets" / "3.1 of 8.4 GB" / "Waiting for <host>" / "Done" / "Paused. Resume
  to carry on where it stopped." / "Pause" / "Resume" / failure: "<host> refused the push: <server message>."
  / "<folder> moved or was deleted." / "Try again".
- Readout: "Your history goes back to March 2019: 3,412 saves across 266 sets in 41 projects." / "See
  sessions not in dit" / "Done".
- Commit message: "Brought into dit".
- Update failure: "Couldn't update to 0.10.0. Try again later."
- Web, machines: "Machines" / "Not a bounce" / "Studio Mac · macOS · dit 0.10.0 · online" / "Last seen 3 days
  ago" / "Open: science123" / "Never here" / "Pushed" / "Remove" / "Remove Studio Mac? It's signed out of dit;
  its saves and commits stay." / "No machines yet. Install dit on the Mac you make music on."
- Web, instance: "Machines" / columns "Owner", "Machine", "Platform", "Version", "Last seen".
- Web, sessions: column "In dit", values "Yes" / "No".
- Site `/dit/`: "Download dit for Mac" / "Apple silicon · macOS 14 or later" / "It isn't notarised: the first
  time, right-click the app and choose Open."
- cli: `brought in science Project: 8 sets, 37 saves, 2.3 GB` / `paused; run the same command to carry on` /
  `history goes back to March 2019: 3,412 saves across 266 sets in 41 projects`.

### Failure

- Hub unreachable during Check: proposals can't be made; Start is disabled with the retry line. During Bring
  in: the folder waits for the hub and carries on when it is back.
- Storage cap reached mid-run: that folder fails with the server's message; the saves stay in `.dit/`; the
  other folders that fit carry on.
- A set or a `Backup/` copy that fails to parse: stored whole and marked, read again later (epic 4's rule).
- A folder that is synced by another service: the adopt warning, shown on its row in Check; it can still be
  ticked.
- A folder moved or deleted mid-run: that folder fails with "<folder> moved or was deleted."; the rest carry
  on.
- The app quits, the Mac sleeps, or the cli is stopped: the run pauses and resumes at the set it was on.
- A session matched by another run on another machine in the meantime: the adoption is refused; the set is
  proposed again as a new session on the next Try again.
- A removed machine's app: its next request is refused as signed out, and the panel shows the sign-in
  screen.
- An update fails to download or verify: the menu shows the failure line; the app stays on its version.
- The release: any step failing leaves the release a draft and the images untagged as `latest`; the smoke
  failing never publishes.

## Reach

- MCP: yes. `list_machines` gains app version and pushed repos; the sessions list gains `inDit` and its
  filter, so an MCP client can find what is outside dit. No backfill or rejection tools: both need the files
  on the machine.
- Docs: yes, under PROJ-1364 (this run deletes the `scanner/*` pages, redirects their URLs, and repoints the
  ten links other pages had to them; it writes no dit docs pages). `dit/*`: installing from the release (the
  Gatekeeper right-click Open), updating, bringing in projects (roots, matching, tracks, backups, storage,
  pausing, the cli form), the machines pane and rejections; `guide/settings-and-profile` for Devices ›
  Machines; `admin/*` for Instance › Machines; `self-hosting/quickstart`, `upgrades` and `deployment` for the
  GHCR images and tags; `guide/index` and every page whose prose names the scanner.

## Ideas taken

- Storage check before start — Check records the sets and its storage line, counting only bytes the hub
  lacks, blocks Start when the folders don't fit.
- Completion readout — the window's Done step and the cli's last line.
- Backups fill old revisions — a dit save fills a content-less save at the same millisecond, and supersedes
  the scanner's backup-stamped one.
- Unmatched sessions list — the sessions table's "In dit" column and the readout's link to it.
- Site downloads the dmg — the new `/dit/` page's "Download dit for Mac".
- In-app update check — the Tauri updater against the GitHub release, from the panel menu.
- Admin machines list — Instance › Machines.

## Ideas set aside

- Sure sets fold away, only doubts as rows — not chosen.
- A skyline on every set row — not chosen.
- The catalogue's keys and command line in the window — not chosen.
- Adopt using the backfill window — not chosen.
- Pausing while Live plays — not chosen.
- Undoing a repo's backfill — not chosen.
- Remembering roots and offering new folders — not chosen.
- Old bounces becoming versions during the backfill — not chosen.
- `dit backfill --dry-run --json` — not chosen.
- Migrating the scanner's rejections — not chosen.
- Backfill progress on the web repositories table — not chosen.
- One activity entry per backfilled repo — taken, then shrunk at the crush: the hub has no repo activity
  kind and no signal for a folder's last push (big change); a backfill writes no entries instead.

## Critiques

- Converting scanner devices into machines leaves rows no dit app ever beats → changed: scanner devices are
  deleted; machines are only what dit registers.
- Ad-hoc release builds change identity every build, so each update re-asks for the Keychain and drops
  Screen Recording → changed: CI signs releases with the stable self-signed identity `app.projammr.dit`;
  Gatekeeper's right-click Open stays.
- `Backup/` copies make the backfill tens of GB → kept as briefed: everything with content; dedupe and the
  storage check are the brake.

## Not included

- Developer ID signing and notarisation — not in this epic or any later one; the dmg is opened with
  right-click › Open the first time.
- Intel or universal builds; Windows and Linux (epic 9).
- Undoing a backfill, a dry run, continuous discovery of new project folders, old bounces as versions, and
  activity entries for a backfill — set aside.
- Migrating anything from the scanner: its rejections, settings and review state are deleted.
- Making the repository public (PROJ-880); the first release waits on it.
- Grouping existing sessions into lineages, branches, clone and pull (epic 6).
- The dit docs pages (PROJ-1364).

## Handed to later epics

None.

## Layout

**A folder list and the chosen folder.** The backfill is hundreds of sets in tens of folders, so the window
keeps the folder as the unit you move between: a list of folders on the left carrying each one's state, the
chosen folder's sets and pickers on the right, and one footer for the step's line and actions. The same frame
serves Find (ticks), Check (proposals) and Bring in (progress).

```
┌ Bring in projects ──────────────────────────────────────┐
│ FIND · CHECK · BRING IN                                 │
│ FOLDERS          │ science Project   Goes into [Alex▾]  │
│ ▸ science    8   │ SET          BACKUPS TRACK   SESSION │
│   halogen    3   │ science123   4  [Science▾] Matches…  │
│   canopy    12   │ science v2   9  [Science▾] [New▾]    │
│   orbit      5   │ science alt  2  [Science▾] [New▾]    │
│   …              │                                      │
│                  │                                      │
├──────────────────┴──────────────────────────────────────┤
│ Needs 8.4 GB of your 31 GB left.       Back    [Start]  │
└─────────────────────────────────────────────────────────┘
```

The folder list is one tab stop (`↑/↓` move, `Space` ticks on Find); `Tab` moves into the chosen folder's rows.

## Feasibility

| Item                                                                         | Verdict                                              | Why                                                                                                                                                                                                                            | Rough size                         | Chosen                                                  |
| ---------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------- |
| Discovering project folders                                                  | now                                                  | `catchup::find_repos` (`dit-daemon/src/catchup.rs:16-42`) and `find_sets`/`list_backups` (`dit-daw-ableton/src/project.rs:10-22`) are the shape                                                                                | ~220 + 120 tests                   | kept                                                    |
| Per-set recording                                                            | big change                                           | `import_backups` has no caller, skips undecodable copies and lets equal-ms ties through (`dit-core/src/repo/import.rs:69-111`); the hub 409s a second hash at an occupied ms (`apps/server/src/db/queries/commits.ts:260-264`) | ~430 incl tests                    | kept                                                    |
| Binding to a chosen session or track                                         | big change                                           | the hub takes `sessionId`/`trackId` (`db/queries/repos.ts:81-94`); `adopt_set` sends neither (`dit-core/src/remote/hub.rs:192-212`)                                                                                            | ~150 + 200 test edits              | kept                                                    |
| Resumable run, one per machine                                               | big change                                           | no run state; only wake is observed (`apps/dit-app/src-tauri/src/wake.rs`); precedent `renders/ledger.rs`                                                                                                                      | ~300                               | kept                                                    |
| `dit backfill` and progress                                                  | big change                                           | the cli's only app hook is renders (`dit-cli/src/lib.rs:353-358`); `push()` reports only at the end (`remote/push.rs`)                                                                                                         | ~400 + app glue ~450 Rust, ~200 TS | kept, full (byte progress, mid-push pause, live search) |
| Push queue coordination                                                      | big change                                           | one non-preemptive worker per run (`dit-daemon/src/queue.rs:1-121`); the router wants pushes on tracked repos (`route.rs:78`)                                                                                                  | ~60                                | kept                                                    |
| Storage check                                                                | overhaul without writing `.dit/`; big change with it | no dry mode in `Repo`/`Store` (`repo/layout.rs:78-100`, `store/mod.rs:139-149`); `objects/missing` needs a repo and claims (`docs/agents/dit.md:1135`)                                                                         | ~80 client + ~150 hub              | kept: Check records into `.dit/`                        |
| Match candidates read                                                        | now                                                  | path and fingerprint on `sessions` (`db/schema/sessions.ts:196-205`); fingerprint is the scanner's size + head/tail hash                                                                                                       | ~130 + ~30 Rust                    | kept                                                    |
| Filling content-less saves                                                   | now (scan/app rows) / big change (backup rows)       | claim at the exact ms exists (`commits.ts:266-277`); backup rows are at the name stamp, dit's at mtime (`docs/agents/dit.md:568-571`)                                                                                          | ~130 + spike                       | kept: supersede rule                                    |
| Activity per repo                                                            | big change                                           | no repo activity kind (`db/schema/enums.ts:25-36`); adopting logs per set (`routes/repos.ts:192`)                                                                                                                              | ~230                               | shrunk: no entries                                      |
| Sessions `inDit` + MCP                                                       | now                                                  | `repoId` on every row (`entities/session/queries.ts:505`); MCP list is generated (`mcp/tools/read.ts:216-265`)                                                                                                                 | ~25 + tests                        | kept                                                    |
| Session facts from the newest save                                           | big change (found in research)                       | the push writes only `currentBranchId` (`commits.ts:381-386`); facts read from the row (`entities/session/queries.ts:363-373`)                                                                                                 | ~50 + tests                        | kept                                                    |
| `machine_id` on saves, commits, segments; Remove signs out and keeps history | overhaul                                             | no id on the wire (`dit-core/src/remote/client.rs:22`); saves carry no owner (`db/schema/saves.ts:36-72`); hard delete (`db/queries/machines.ts:152-165`)                                                                      | ~320 + ~300 tests, spike           | kept (first stream of the hub line)                     |
| Machines pane                                                                | big change                                           | `DevicesPane` is the scanner's (`settings-hub/panes/DevicesPane.tsx`); pushed repos need `machine_id`                                                                                                                          | ~580 + 300 tests                   | kept                                                    |
| Instance › Machines                                                          | now                                                  | `UsersPane` + `GET /admin/*` (`routes/admin.ts:128-145`)                                                                                                                                                                       | ~190 + 110 tests                   | kept                                                    |
| Repo page and table links                                                    | big change                                           | one read shape (`db/queries/repos.ts:177-191`); needs `machine_id`                                                                                                                                                             | ~100 + tests                       | kept                                                    |
| Rejections on the hub                                                        | now (hub) / big change (app)                         | engine reads `renders.json` synchronously (`dit-daemon/src/renders/engine.rs:603-644`)                                                                                                                                         | ~205 hub + ~350 app                | kept                                                    |
| MCP `list_machines`                                                          | now / big change for pushed repos                    | `mcp/tools/machines.ts:6-13`                                                                                                                                                                                                   | ~80                                | kept                                                    |
| Backfill window                                                              | now (window, screens)                                | `WebviewWindowBuilder` beside the NSPanel; parts in `@workspace/ui`                                                                                                                                                            | ~130 + ~1,000                      | kept                                                    |
| Scanner removal                                                              | big change                                           | `routes/machines.ts:17` imports the scanner's id schema; the `"device"` scope spans ~25 files (`packages/settings/src/types.ts:8-18`)                                                                                          | ~390 files deleted, ~185 edited    | kept                                                    |
| Old assets' provenance                                                       | decision                                             | `projammr://asset` is scanner-only (`apps/dit-app/src-tauri/src/deep_link.rs:145`)                                                                                                                                             | ~70 + tests                        | kept the line, dropped Reveal                           |
| Demo through the repo API                                                    | now                                                  | the routes exist (`routes/repos.ts`, `routes/repo-history.ts`)                                                                                                                                                                 | ~260                               | kept, with commits and spans                            |
| Release workflow                                                             | now                                                  | `ci.yml` needs `workflow_call` (`.github/workflows/ci.yml:3-7`); `e2e.yml` triggers on tags (`e2e.yml:13-14`); smoke exists (`apps/e2e/src/smoke.ts`)                                                                          | ~320 + ~110                        | kept                                                    |
| Signed dmg                                                                   | now                                                  | `dit-app-package.yml` as `workflow_call`; spike on the runner's codesign                                                                                                                                                       | ~110                               | kept                                                    |
| Updater, dmg link, attestations                                              | not without a miracle while private                  | the repository is private (`gh repo view`)                                                                                                                                                                                     | ~260 app + workflow                | kept: first tag waits for PROJ-880                      |
| `/dit/` page and redirects                                                   | big change                                           | the buttons live only on `/scanner/` (`apps/web/src/pages/scanner.astro:31,177`); no redirect mechanism (`apps/web/public/` has only `_headers`)                                                                               | ~85 + copy                         | kept: a new `/dit/` page                                |

## Decisions

- The restatement of the stub and what epics 3 and 4 handed down is the feature — nothing bent.
- The batch screen is a dit app window, not the panel — the panel is one 400px screen at a time and the batch
  lists hundreds of sets.
- No Developer ID or notarisation, ever — people installing it deal with Gatekeeper.
- The release workflow is all of PROJ-877 minus the scanner — images, the dmg, checksums and attestations,
  smoke, publish after smoke.
- Scanner devices are deleted, not converted — converted rows would be machines nothing beats.
- Releases are signed with the stable self-signed identity in CI — updates keep the Keychain and permissions.
- Everything with content, `Backup/` included — dedupe and the storage check are the brake.
- The spec's unasked decisions (match order, track proposal, folder order, resumability, the storage block,
  "In dit" as the unmatched list, the machines pane's shape, own-machine links, rejection keys, update
  cadence) approved as written.
- The backfill engine is kept whole: byte progress, pause mid-push, live search — the run is hours long.
- Check records the sets into `.dit/` so the storage line is exact — and backing out removes what it made.
- The scanner's backup-stamped saves are superseded by the copies dit brings in — no double counts.
- A backfill writes no activity entries — one entry per repo needs a repo activity kind the hub lacks.
- `machine_id` is kept, soft delete and revoking the sign-in included — it is the hand-down that makes
  machines rows; it opens the hub line.
- Rejections write through to the hub from the app and the cli — a rejection anywhere holds everywhere.
- The updater and downloads are built now; the first tag waits for the repository to go public (PROJ-880).
- Sessions take their DAW facts from their newest save — with the scanner gone nothing else writes them.
- Old scanner assets keep their provenance line; Reveal goes — only the scanner answered it.
- The download lives on a new `/dit/` page that replaces `/scanner/`.
- Corrections from research, applied: backup time is mtime; fills match the millisecond; the commit rule is
  "no commit yet"; a half-done set is redone; "Not a bounce" is the render fingerprint, listed once; bare
  `dit backfill` lists; ↩ acts on rows and `⌘↩` anywhere; a reopened window shows the paused run; versions
  start above 0.9.0.
- The backfill window is a folder list beside the chosen folder (layout B) — the folder is the unit you move
  between across hundreds of sets.

## Outcome

Built in one pass. The plan was deleted once built; the spec is the record.

Changed in the build:

- The supersede rule deletes a backup-stamped row only when the save just before it arrived in the same push;
  the rule as specced would delete one more stamp behind a deleted one on every later push.
- One ranked track matcher (`propose::track_ranking`) serves the backfill and the panel's first-commit picker.
- `GET /machines` keeps `repoIds` and `openSessionId` beside the new fields; Open in DAW reads the repos a machine
  reports, not only those it pushed.
- The "Ask before deleting" kind `device` became `machine`.
- Set rows in Check have no tick of their own; a folder is brought in whole.
- Try again on Bring in restarts every folder that is not done.

Not done in the PR, and why:

- No GitHub Actions run: hosted runs failed at job start on account billing. The rc dry run, the arm64 images
  under QEMU and the CI signing leg are unproven there; signing was proven locally.
- The manual backfill of real folders inside the app, and Remove signing the app out, wait for the review.
- The supersede rule was not measured on real scanner-era data; none exists on this machine.
- The demo snapshot and its six screenshots wait for the owner's demo audio inputs.
