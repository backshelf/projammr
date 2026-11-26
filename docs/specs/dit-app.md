# dit app spec: the menu bar app, panel, script and renders

_Written 2026-10-21. Mode: plan. Brief: "Please plan out the next epic for the dit work" (epic 4 of the dit
roadmap, PROJ-1358)._

## Summary

Epics 1 to 3 made dit a cli that records every save of a Live set with its content, pushes commits to the
Projammr hub, and a web client that shows that history. This epic gives dit its day-to-day surface: a macOS
menu bar app that is dit's long-running process. The bar reads the open set and how many saves it has since
its last commit; the panel under it is lit by the set's track artwork, shows the set's skyline with the
changed tracks lit, and holds the commit box with its message already written from the diff. Behind the
panel the app watches every repo folder for saves, listens to a small script inside Live for what is open and
what is changing, counts the time a set is open, makes checkpoint commits when the producer forgets, sees a
new bounce anywhere on the machine and offers it as a track version with one click, pushes everything when the
hub is reachable, answers the web's "Open in DAW" and "Restore on this computer", and serves the cli over a
local socket. The one thing it must get right: no save Live makes is ever missed, and nothing the app does
ever writes to a file Live wrote.

## The feature

### Who and where

- **The producer** (owner or editor) installs the app on the Mac they make music on, signs it in once, lets
  it track their project folders, commits from the panel, and accepts renders. They are the only person
  assumed to run it.
- **A collaborator who is an editor** sees on the web what the app adds: time in the set per commit and per
  session, "Open in Live on <machine>" while a set is open, a version's link to the commit it was bounced
  from, and a Restore button that works when a dit is online on their own machine. **A viewer** sees the
  same, read-only. **An outsider on a share link** sees nothing new.
- **The instance admin** sees nothing new; the machines pane is epic 5.
- **Surfaces.** The menu bar app on macOS (the bar, the panel, its settings screen). The cli, which works
  without the app and through it when it runs. The web client on desktop and phone: the session page's
  masthead and rail, the history page, the track's version rows, the Open in DAW and Restore buttons. The hub
  API and MCP. The docs.

### Concepts

- **The app.** One process that starts at login, lives in the menu bar and owns everything that happens on
  the machine without the user: the save watcher, the script listener, the render watcher, segments,
  checkpoints, the push queue, presence and the local socket. The cli is the same crate as a second binary;
  with the app running, `dit commit`, `dit push`, `dit status`, `dit renders` and `dit time` go through the
  socket so the bar and the panel change at once, and the cli never touches the Keychain while the app runs.
- **The bar.** The status item's title: the open set's name, `●` and the saves since the last commit when
  there are any, `·` and the branch when it is not `main`, `·` and `♪` while a render waits. The icon alone
  with nothing open. The bar is a readout, never a meter.
- **The panel.** A popover under the bar item, open from a click or the global shortcut, floating over
  full-screen Live, closed by `Esc` or a click outside. It has one screen at a time: sign-in, the repo list,
  the adopt offer, the set, the restore prompt, settings.
- **The script.** A control-surface script the app installs into Live's User Library Remote Scripts folder as
  `dit`; the user enables it once in Live › Settings › Link, Tempo & MIDI. Over TCP loopback it tells the app,
  as newline-delimited JSON, which document is open, the set's tracks and devices as they change, tempo, key
  and time signature, and whether Live is playing or recording. It is the first open-set signal and the
  source of the live skyline and idle detection.
- **Open set.** The set Live has open on this machine: the script's answer, else the newest set named in
  Live's `Log.txt` and `Indexer.txt`, else Live's window title, else the most recently saved set in any repo.
- **Segment.** A span of time a set was open on a machine: from the script's open to its close (else the log
  or the title, else the first and last save), paused after fifteen minutes with no script event, no transport
  and no save, resumed on the next. Segments push with saves and are summed per commit and per session.
- **Render proposal.** An audio file the render watcher judged to be a bounce of a set, waiting in the panel
  with its reasons until the user accepts or turns it down.
- **Machine.** This Mac as the hub knows it: a name (the computer's name until changed in settings), a
  platform, when it was last seen, and the set it has open. The app heartbeats every 30 seconds; a machine is
  online for 90 seconds after its last heartbeat.

### Interface

**The bar.** `science123` · `science123 ● 3` · `science123 ● 3 · orchestral` · `science123 ● 3 · ♪`. A
small progress arc beside the count while pushing. The icon alone when nothing is open, signed out, or Live
is not running.

**The panel's screens.**

- *Sign in*: the instance address, "Sign in", and the device-flow wait ("Approve this computer in your
  browser." with "Open again").
- *Repos* (signed in, nothing open): the repos the app knows, recent first, filtered as you type, each with
  its last commit's message and time and a link to its session on the web; the first-run line when there are
  none.
- *Adopt* (Live opened a set in a folder that is not a repo): the folder's name and set count, the project
  picker (last used), "Track it", "Not now".
- *Set* (the main screen): masthead lit by the track's artwork with the set's name, branch, machine time in
  the set since the last commit and "Open on the web"; the skyline with the tracks changed since the last
  commit lit; the commit box with its suggestion as clauses and the helper line; the saves since the last
  commit, each with its chips and its push dot; the renders waiting; the track proposal when the set has no
  commit yet; the last commit and "Nothing to commit" when there are no saves.
- *Restore* (a `projammr://dit/checkout/<commit id>` link arrived): the commit's message and set, the branch
  name field (`restore-<short id>`), "Restore and open", "Cancel".
- *Settings*: machine name; instance (read-only); start at login; global shortcut; max upload size (MB, 0 =
  no limit); render watcher roots (the home folder by default) and excluded folders (the built-in list shown,
  the user's additions removable); files marked "Not a bounce" and folders marked "Never here", each removable;
  Live's script (installed path, connected or not, "Reinstall"); "Install the dit command" (the app carries
  the cli and links it into `/usr/local/bin`, asking for an administrator once; "Installed" with the path
  after); permissions (Screen Recording for Live's window title, "Open System Settings").
- *Menu* (`…` in the panel's head): Settings, Track a folder… (the adopt offer for a folder that was told
  "Not now"), Sign out, Quit.

**The cli.** `dit script install` writes the script into Live's User Library and prints where; `dit script
status` says whether it is installed and connected. `dit renders`, `dit renders accept <id> [--set <set>]`,
`dit renders reject <id> [--never-here]`, `dit time [<set>]` and `dit status` print what the panel shows (and
`--json`), through the app when it runs. `dit login` and the panel share one sign-in. Every command works with
the app stopped; a commit made then is picked up by the app's catch-up when it starts.

**The script's protocol.** The app listens on a loopback port it writes beside the script; the script
connects on Live's start and reconnects on its own. Messages: `document` (path, when it opened), `tracks`
(the set's tracks in order with name, colour, type, group and device list), `song` (tempo, key, time
signature), `transport` (playing, recording), `closed`. The app never sends anything but a greeting.

**The hub API**, as the app, the web and MCP see it:

- Machines: one `PUT /machines/:id` registers and heartbeats (the app generates the id once; name, platform,
  version, the open set's session id, the repo ids it tracks); a name another of the user's machines holds is
  refused and the panel shows the name field. `GET /machines` lists the caller's machines with their online
  state and tracked repos; `DELETE /machines/:id` on sign-out. `GET /sessions/:id/presence` answers the
  caller's online machines, each saying whether it tracks the session's repo and whether it has the set open:
  what the web's Open in DAW and Restore buttons read. The session detail carries `openOn` (machine and
  owner) while a machine has it open.
- Segments: `POST /repos/:id/segments` in the same push cycle as saves (set, branch, machine, start, end,
  source); a re-push of a segment that grew extends it and never double-counts. Read per session (the union
  of every segment) and per commit (the segments clipped to the window between the previous commit's save
  and this commit's save).
- Lineage objects: the push uploads a commit's Save and Commit objects beside its content, for every commit
  this machine made including those pushed before; the hub stores them and serves any object it holds, so
  a restore can bring a commit's whole chain to a machine that never had it. `GET /commits/:id` answers a
  commit's message, time, set and repo for the restore screen.
- A render accepted: `POST /assets/upload`, then `POST /sessions/:id/renders {assetId, bouncedFromSaveId}`,
  which attaches the file to the session, makes it a version of the session's track recording the save it
  was bounced from (the commit is derived), and makes it the primary unless the track's primary is pinned.
  A session with no track answers 409; the panel's track proposal runs first. The web's "set primary" (and
  MCP's) pins; an auto-promote never does.
- Session detail gains the hours in the set.

**MCP.** `list_machines(project?)`: name, platform, last seen, online, open session. `list_commits` rows and
`get_commit` carry `timeInSet`; the session detail its total. No writes: committing, accepting a render and
restoring all need the file.

### Flows

**Sign in.**

1. First launch shows the sign-in screen. The user enters the instance address and chooses "Sign in".
2. The browser opens the instance's approval page; the user approves this computer once.
3. The app stores the token in the Keychain, registers the machine under the computer's name, installs Live's
   script, turns on start at login, and shows the repo list with the first-run line. Back out: close the tab;
   the panel says "Not signed in."
4. On first launch the app also asks macOS for Screen Recording (for Live's window title) with a line in the
   panel saying why; a refusal leaves the other three signals in charge and settings shows how to grant it.
   The first time the render watcher reads a file in Desktop, Documents or Downloads, macOS asks for that
   folder; the panel's settings explain all four prompts under Permissions.

**Adopt a project folder.**

1. Live opens a set in a folder that is not a repo. The bar shows the icon; the panel is the adopt offer:
   "Track this project?", the folder's name and set count, the project picker.
2. "Track it" makes the folder a repo in the chosen project, records a save of every set in it as it stands
   (the panel lists the sets as they land), warns once if the folder is synced by Dropbox or iCloud, and opens
   the set screen with the commit box and the track proposal.
3. "Not now" hides the offer for that folder; "Track a folder…" in the menu brings it back.

**A working session.**

1. Live saves the set. The watcher waits for the file to settle and its gzip trailer to be whole, records the
   save with the file's mtime as its time (retrying while another dit holds the repo lock), posts its
   metadata and the open segment so far, and the bar's count goes up. A referenced file replaced under
   `Samples/` records a save the same way.
2. The script reports the tracks as they change; the skyline lights the tracks changed since the last commit.
3. The user opens the panel. The commit box holds the suggestion as clauses; clicking a clause drops it; the
   text stays editable; a draft left behind is kept per set until committed or cleared. `⌘↩` commits: the lit
   tracks settle, the count returns to zero, the commit pushes itself with the content of every save since
   the previous commit.
4. With no commit after 10 saves or 2 hours of open time, the app commits a checkpoint ("checkpoint · 2h 14m",
   the open time since the last commit whichever rule fired) and pushes it the same way. A set with no user
   commit yet gets no checkpoint: its saves wait for the first commit and its track proposal.
5. The first commit of a set proposes its track: existing tracks and sets whose titles match the set's name
   and the folder's, best first, ending with "New track: <folder without ` Project`>". The user picks one.
6. Closing the set in Live (the script's `closed`, else the log) ends the segment; a set left open with no
   activity for fifteen minutes pauses it.

**A new render.**

1. The user exports from Live to any folder under the watcher's roots. The watcher sees the new audio file
   once its size has stopped changing, then holds it for a minute so the pair and stem-batch rules can see
   what else arrives.
2. The app scores it: the open set, minutes since the last save, name similarity to the set and its track,
   the folder, the file's length. Above the threshold it becomes a proposal: a notification ("New bounce:
   science123 v4.wav", with "Add as version"), `♪` in the bar, and a card in the panel with the file name
   (wrapped, never cut), its length, "bounced 4 min after your last save", the set it matched, its reasons in
   plain words, and a play button.
3. Two files with the same stem and different audio extensions written within a minute are one proposal; the
   card names both and says which it will upload: the largest file under the max upload size. Three or more
   same-prefix files within a minute, or any file in a stems folder, are never offered. A card and its
   notification therefore arrive about a minute after the export finishes.
4. "Add as version" uploads it, attaches it to the session, makes it a version of the track recording the
   save or commit it was bounced from, and makes it the primary unless the user pinned a version on the web.
   Offline, the card says "Queued" and the upload rides the push queue. "Not this set" offers a picker. "Not
   a bounce" remembers the file. "Never here" adds the folder to the ignore list.

**Open in DAW and Restore (web → app).**

1. The web's Open in DAW and Restore buttons read the hub's presence answer for the session: the user's
   online machines and which of them tracks the set's repo. A machine tracks it: both buttons are enabled and
   their tooltips name it ("Opens the file on Studio Mac", "Restores on Studio Mac"). None does: both are
   disabled, Open in DAW with "Needs dit on the computer that has this set.", Restore with "Needs dit on this
   computer." There is no other path: a session's old scanner file path plays no part.
2. Open in DAW sends `projammr://session/<id>`; the app takes key focus, finds the set in its repos and opens
   its file in Live. A set no repo on this machine holds: the panel says "Not tracked by dit on this
   computer." A link that reaches a machine with no handler shows the web's fallback dialog, which says the
   link needs dit running on this computer.
3. Restore sends `projammr://dit/checkout/<commit id>`; the panel opens on the restore screen with the
   commit's message and set (read from the hub) and the branch name `restore-<short id>`. "Restore and open"
   fetches from the hub whatever of the commit's chain this machine lacks (the commit, its save and the
   objects that rebuild it, and its ancestors' commit and save records), writes `<set> @<name>.als` as a
   branch forked from that commit, records it as the branch's first save, and opens it in Live. A commit
   this machine made needs no fetch. A set Live has open is never written to; the new file is a sibling.
   "Cancel" does nothing.

**Catch-up at launch.**

1. The app starts (at login, or after a quit or crash). For every repo it knows, it compares each set's mtime
   with its last recorded save and records what Live saved while it was away, as saves at the file's time.
2. The push queue resumes from disk; renders accepted offline upload; the heartbeat starts; the script
   reconnects.

**Settings and sign-out.**

1. The menu's Settings opens the settings screen in the panel; every change applies at once; the global
   shortcut is recorded by pressing it.
2. Sign out forgets the token and stops pushing; saves keep being recorded. Quit stops everything; the panel
   says scheduled work stops with it.

### States

**The bar.** The icon alone (signed out, nothing open, Live not running); the set's name; name and count; name,
count and branch; the `♪` while a render waits; the progress arc while pushing.

**The panel.**

- Signed out: the sign-in screen. Approval pending: "Approve this computer in your browser." with "Open
  again". Approved elsewhere or revoked: "Signed out of <host>. Sign in to keep pushing."
- Signed in, nothing open, no repos: "Open a set in Live and dit will offer to track its project."
- Signed in, nothing open: the repo list, recent first, with a filter field.
- Live not running: the last open set's screen under "Live isn't running."
- Open set, not a repo: the adopt offer. Adopting: the sets listed as their first saves land.
- Open set, no saves since the last commit: "Nothing to commit" over the skyline, the last commit (message,
  time, pushed or pending), the renders waiting.
- Open set with saves: the masthead, the lit skyline, the commit box ready, the saves with chips and push
  dots, the renders waiting. First commit: the track proposal above the box.
- Pushing: the arc in the bar; the panel lists what is going up.
- Offline: "Can't reach <host>. Saves and commits are kept here and will push when it's back." Everything
  local works; render cards accepted say "Queued".
- Script not installed or not connected: "Live's dit script isn't enabled. Enable it in Live › Settings ›
  Link, Tempo & MIDI for live changes." The skyline shows the last save's tracks, unlit.
- Screen Recording refused: a line under Permissions in settings; nothing in the set screen.
- A render card: waiting; playing; uploading (with progress); queued; added ("Added as version"); turned down
  (gone).
- Restore screen: ready; writing ("Fetching the commit…", "Writing science @restore-a1b2.als…"); opened;
  failed with the reason.
- Reduced motion: a lit track stays lit (state, not decoration) but nothing fades or settles; counts change in
  place.

**The web.**

- Session masthead: "Open in Live on Studio Mac" beside the saved-ago line while a machine has it open. A dit
  set's saved-ago line reads its newest save's time.
- Session rail: "Time in the set" with the hours total.
- History page: each commit row carries "2h 14m" (time in the set since the previous commit); the masthead
  summary gains "· 38h in the set".
- Version rows (track page, versions list): "from commit 'added strings'" linking to the commit on the history
  page, when the version was accepted from a render.
- Open in DAW: enabled with "Opens the file on <machine>" when a dit machine tracks the set's repo, on the
  session page and on every sessions-table row (the table reads the caller's machines once per page);
  disabled with "Needs dit on the computer that has this set." otherwise. Restore enabled with "Restores on
  <machine>" on the same condition, disabled with "Needs dit on this computer." otherwise. The fallback
  dialog behind either says the link needs dit running on this computer.

### Rules

- A save is recorded once the file has not changed for a few seconds and its gzip trailer is whole; its time
  is the file's mtime; a `Locked` repo is retried for up to a minute; a file that will not parse is stored
  whole, marked "Couldn't read this save", and parsed again by the next release that can. A referenced file
  under `Samples/` replaced in place records a save whose time is the sample's mtime (or a millisecond past
  the last save's when that is not later); a commit after it is a real commit. A save made while the app was
  not running is recorded at launch from the file's mtime.
- A commit with nothing changed since the previous commit is refused: "Nothing to commit since <message>."
  Checkpoints follow 10 saves or 2 hours of open time, whichever first, counted since the last commit; none
  before a set's first user commit. The suggested message and `dit commit`'s default message come from one
  source, so the panel and the cli word a commit the same way.
- Segments are per set, branch and machine; a segment pauses after fifteen minutes with no script event,
  transport or save; the sources are the script, then `Log.txt`/`Indexer.txt`, then the window title, then
  first-and-last save. Segments push beside saves in the same push cycle; the hub sums them.
- A render is matched against the open set first; below the threshold nothing is offered. Files in a stems
  folder (`stems`, `stemz` and the like) are never offered; three or more same-prefix files within a minute
  are a stem batch and never offered; exactly two with the same stem and different audio extensions are one
  render, of which only the largest file under the max upload size is uploaded; when none is under it, the
  card says "Over your size limit" and offers "Add anyway". "Not a bounce" is remembered forever; "Never here"
  ignores the folder. The newest accepted render is the track's primary unless a version is pinned on the web.
- The render watcher's roots default to the home folder; the built-in exclusions are `Library`, caches,
  `.git`, `node_modules`, the Trash, iCloud and Dropbox placeholders, and inside every project folder
  `Backup/`, `Samples/`, `Freeze/`, `Recorded/`, `Ableton Project Info/` and stems. Only files whose size
  has settled are considered.
- The app never writes to a set Live has open and never overwrites a file Live wrote; a restore writes one new
  sibling file.
- One app instance at a time (the socket decides; a second instance hands the panel to the first and quits);
  one instance per install; the machine name is unique per account on the hub.
- Deep links: the app registers `projammr://`; `session/<id>` opens the set; `dit/checkout/<id>` opens the
  restore screen; anything else is ignored with a line in the panel. The scanner is not considered: dit is
  the handler.
- The push queue is on disk, ordered, resumed on launch, retried with backoff; a push the cap refuses stops
  with the server's message and nothing local is lost.
- Start at login is on after sign-in; the global shortcut is none until set; the max upload size is 0 (no
  limit).
- The push uploads lineage objects (a commit's Save and Commit records) for every commit it has made,
  including commits pushed before this release, the next time it pushes; so a machine that pushed before can
  restore any of its commits anywhere once it has pushed again.
- Existing data: machines are new rows; nothing existing changes. The scanner's rows and routes stay until
  epic 5 deletes them and are never read by anything built here.

### Input

- The panel opens from the bar item or the global shortcut and lands focus in the commit box when there is
  one. `⌘↩` commits, `Esc` closes, `↑`/`↓` move through renders, `Y` accepts the focused one and `N` is
  "Not a bounce" (the other two turn-downs stay buttons), `Space` plays it, `⌘,` opens settings. The menu is
  a real menu button. Every control has a label; the bar item's accessibility label reads the title in words
  ("science123, 3 saves since the last commit").
- The skyline is one tab stop that names the hovered or focused track ("Bass · +EQ Eight").
- Touch targets do not apply; hit areas are at least 28px, the panel being a desktop popover.
- The web adds no entry points; the new readouts are text in existing rows and the masthead.

### Copy

- Bar: `science123`, `science123 ● 3`, `science123 ● 3 · orchestral`, `science123 ● 3 · ♪`.
- Masthead: "2h 14m in this set since the last commit" / "Open on the web".
- Helper under the commit box: "A commit names the set as it is now, so you can find it later."
- Commit box: the suggestion ("+2 tracks, +EQ Eight on Bass, tempo 120 → 124"); empty: "Nothing to commit".
- Refused: "Nothing to commit since '<message>'."
- First run: "Open a set in Live and dit will offer to track its project."
- Adopt: "Track this project?" / "science Project has 8 sets. dit keeps every save and lets you name the ones
  that matter." / "Track it" / "Not now". Sync warning: "This folder is synced by <service>. Two computers
  sharing one repo will corrupt it."
- Track proposal: "Which track is this?" / "New track: science".
- Render: "New bounce" / "science123 v4.wav · 3:42 · bounced 4 min after your last save" / reasons "named
  like the set · in its folder · 4 min after your last save" / "Add as version" / "Not this set" / "Not a
  bounce" / "Never here" / pair: "science123 v4.wav and .mp3 · uploads the .wav (48 MB)" / "Over your size
  limit" / "Add anyway" / "Queued" / "Added as version".
- Notification: "New bounce: science123 v4.wav" / action "Add as version".
- Checkpoint message: "checkpoint · 2h 14m".
- Push: "Can't reach <host>. Saves and commits are kept here and will push when it's back." / "<host> refused
  the push: <server message>."
- Sign-in: "Approve this computer in your browser." / "Open again" / "Not signed in." / "Signed out of <host>.
  Sign in to keep pushing." / "<host> uses a certificate this computer doesn't trust. Install the instance's
  certificate and try again."
- Live: "Live isn't running." / "Live's dit script isn't enabled. Enable it in Live › Settings › Link, Tempo &
  MIDI for live changes."
- Permissions: "dit reads Live's window title to know which set is open when the script is off. Allow Screen
  Recording in System Settings." / "macOS asks before dit reads a file in Desktop, Documents or Downloads; say
  yes so bounces there are found."
- Restore: "Restore 'added strings' as a new branch" / "Branch name" / "Restore and open" / "Cancel" / "Fetching
  the commit…" / "Writing science @restore-a1b2.als…" / "Opened in Live".
- Deep link, untracked: "Not tracked by dit on this computer."
- Settings labels: "Machine name", "Instance", "Start at login", "Global shortcut", "Max upload size (MB)",
  "Watch for bounces in", "Never look in", "Files marked Not a bounce", "Live's dit script", "Install the dit
  command" / "Installed at /usr/local/bin/dit", "Permissions". Name clash: "Another of your machines is
  called <name>. Pick another name."
- Web: "Open in Live on Studio Mac" / "Time in the set" / "2h 14m" / "38h in the set" / "from commit 'added
  strings'" / "Opens the file on Studio Mac" / "Restores on Studio Mac" / "Needs dit on this computer." /
  "Needs dit on the computer that has this set." / fallback dialog: "This link needs dit running on this
  computer."

### Failure

- Instance unreachable: everything local continues; pushes and accepted renders queue; `dit status` lists
  what is pending.
- Token revoked or expired: pushes stop with the sign-in message; saves continue locally.
- Storage cap reached: the push stops with the server's message; the saves stay in `.dit/`.
- A chunk upload interrupted: it resumes from the objects the hub already has.
- Live has the target file open: a restore to that name waits and says so; a different name is offered.
- The script missing or Live older than its API: the fallbacks take over; the skyline goes quiet and says why.
- The script's port taken: the app picks another and rewrites the file beside the script; the script
  reconnects.
- A set fails to parse: stored anyway, marked, retried later.
- A folder moves: the repo moves with it; the hub learns the new name at the next push.
- Screen Recording refused: the title signal is skipped; settings says how to grant it.
- A protected folder refused: bounces there are not seen; settings says so beside the root.
- The Keychain locked or absent: "dit can't read its sign-in from the Keychain." and the sign-in screen.
- A second app instance: it hands the panel to the running one and quits.
- A deep link for a commit or session the hub does not know, or this account cannot read: "That link isn't
  one of yours." in the panel.
- Live not installed: the script is not installed and settings says "Live wasn't found."

## Reach

- MCP: yes. `list_machines` (name, platform, last seen, online, open session); `timeInSet` on `list_commits`
  rows and `get_commit`; the session's total in its detail. No writes: committing, accepting a render and
  restoring need the file on the machine.
- Docs: yes, under PROJ-1364. A `dit/*` section replacing `scanner/*`: install and sign in (the app, the
  device-flow approval, the Keychain, the permissions it asks for), the panel (the bar's title, the commit
  box, saves and chips, checkpoints, the skyline and the script and how to enable it in Live), adopting a
  project, renders (the watcher's roots and exclusions, the pair rule, the size limit, how a render becomes a
  version and its commit link), time in the set, the cli's new commands. `guide/sessions` for Open in DAW
  through dit and "Open in Live on"; `guide/session-history` for the time readouts and Restore; `guide/
  audio-versions` for the commit link on a version. Not built by this run.

## Ideas taken

- Time in the set in the masthead — the set screen's masthead carries the hours since the last commit.
- Saves listed with their chips and a push dot — each save under the box shows what changed and whether it
  reached the hub.
- Draft message survives closing the panel — a draft is kept per set until committed or cleared.
- Suggestion chips you can switch off — the suggestion is clauses; one click drops a clause from the text.
- Skyline hover names the track — the panel's skyline behaves as the web's.
- Open on the web — a link from the masthead and from each repo row to the session on the hub.
- First-run line and a filterable repo list — orientation with no repos; recent-first filtering for hundreds.
- Play the render before deciding — a play button and `Space` from a third of the way in.
- Reasons on the render card — plain-words reasons, the scanner's.
- A notification for a new bounce — macOS notification with an "Add as version" action; nothing else notifies.
- Versions link back to their commit on the web — the version row shows "from commit '…'" to the history page.
- A render waiting shows in the bar — one `♪` glyph after the count.
- Accepting offline queues the upload — the push queue carries render uploads; the card says "Queued".
- Catch up missed saves at launch — the watcher records what Live saved while the app was not running.
- Start at login, on by default — a login item with a toggle in settings.
- Idle trims time in the set — a segment pauses after fifteen quiet minutes.
- Time in the set on the API and MCP — session detail and commit rows carry it.
- Presence carries the open set — the heartbeat names the open set; the web masthead says "Open in Live on".
- MCP `list_machines` — machines with online state and the open set.

## Ideas set aside

- Heatmap counts hours where segments exist — not chosen.
- Sign out revokes the hub session — not chosen; sign out forgets the token, revocation stays a row on the web.
- Scanner skips folders with `.dit/` — not chosen.

## Critiques

- Live's window title needs the Screen Recording permission → kept as briefed: asked on first run and
  explained in the panel; refused, the other signals carry on.
- The stem-batch rule swallows a wav+mp3 export pair → changed: two files with the same stem and different
  audio extensions within a minute are one render; only the largest file under the settings' max upload size
  is uploaded; three or more stay a stem batch.
- The whole-home watch brings three folder prompts and every write on the machine → kept as briefed: the home
  folder by default, the built-in exclusions listed in settings, the prompts explained under Permissions.

## Not included

- Backfill and its batch screen; deleting the scanner, its routes and its `projammr://` registration; scanner
  devices becoming dit machines and the machines pane; signing, notarising and the release workflow (epic 5).
- Any support for the scanner: no coexistence handling for `projammr://`, no scanner path for Open in DAW, no
  reading of scanner devices or rejections. The scanner is legacy and dit takes precedence wherever the
  scanner was; its code stays untouched until epic 5 deletes it, and dit copies what it borrows (icons, the
  matching rules) rather than referencing it.
- Branches beyond `checkout <commit> -b`, the branch picker, clone and pull (epic 6); merge (epic 7).
- Windows and Linux (epic 9). The cli runs there; the app does not.
- The scanner's catalogue: no batch review, no "Loose nearby", no track merging from the panel. One card per
  render.
- Notifications for anything but a new bounce.
- A scorer that learns from accepts and rejects; thresholds are fixed (offer at the scanner's ask line).
- Pulling a commit's content from the hub for anything but a restore.
- Showing a branch other than `main` on the web.
- Hub-shared render rejections: "Not a bounce" and "Never here" are remembered per machine.

## Handed to later epics

Recorded here and on each epic's Jira description.

- **Epic 5 (PROJ-1359):** render rejections shared across a user's machines through the hub (this epic keeps
  them per machine); a `machine_id` on segments, saves and commits once scanner devices become dit machines
  (this epic keys them by machine name); the release workflow building and signing the app and the dmg.
- **Epic 6 (PROJ-1360):** restoring a set that no repo on this machine has pushed (clone and pull); `dit fetch`
  proper over the lineage objects this epic pushes and serves.

## Layout

**The set screen.** The masthead is the panel's one bold element; the skyline sits right under it as the
instrument, the commit box under that, so the commit motion runs from the lit tracks through the box to the
bar. Saves and renders read beneath in that order. Every other screen (sign-in, repos, adopt, restore,
settings) is a plain stack under the same head.

```
┌──────────────────────────────────────────┐
│ ▒▒▒ art-lit masthead ▒▒▒▒▒▒▒▒▒▒▒▒▒▒ [⋯] │
│ science123 · main                        │
│ 2h 14m in this set since the last commit │
│ Open on the web ↗                        │
├──────────────────────────────────────────┤
│ ▂▅▇▂▃▅▂▁▆▂▃  ▂▅   ← skyline, lit = changed│
│   ▴    ·                                 │
├──────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐ │
│ │ +2 tracks, +EQ Eight on Bass,        │ │
│ │ tempo 120 → 124                      │ │
│ └──────────────────────────────────────┘ │
│ [+2 tracks] [+EQ Eight on Bass] [tempo…] │
│ A commit names the set as it is now…     │
│                              Commit ⌘↩   │
├──────────────────────────────────────────┤
│ 3 saves since 'added strings'            │
│ ● 22:47  +EQ Eight on Bass               │
│ ● 22:12  tempo 120 → 124                 │
│ ○ 21:58  +2 tracks            (pending)  │
├──────────────────────────────────────────┤
│ NEW BOUNCE                               │
│ ▶ science123 v4.wav · 3:42               │
│   bounced 4 min after your last save     │
│   named like the set · in its folder     │
│   [Add as version] [Not this set] [Not a │
│   bounce] [Never here]                   │
└──────────────────────────────────────────┘
```

With no saves the box reads "Nothing to commit" and the last commit sits where the saves list is; with no
render waiting the last band is absent; on a set's first commit the track proposal sits above the box.

## Feasibility

| Item | Verdict | Why | Rough size | Chosen |
| ---- | ------- | --- | ---------- | ------ |
| Replaced `Samples/` file records a save | big change | `repo/save.rs:109-112` skips on an equal XML hash; `commit.rs:69` compares trees; hub unique `(sessionId, fileUpdatedAt)` `saves.ts:71` | ~150/220 Rust | kept: samples compared, save time = sample mtime (or last + 1 ms), commit/status compare samples |
| Local socket, cli through the app | big change | `dit-cli` is bin-only (`Cargo.toml:8-10`), prints and opens the Keychain inside commands | ~590/400 (lib split + `dit-ipc`) | kept |
| One source for the commit clauses | big change | `diff.rs:204-234` `summary_line` has no device/rename clauses; the spec's example is the TS grammar | ~150/120 Rust | kept: structured clauses in Rust, joined by the cli, toggled by the panel |
| Primary unless pinned on the web | big change | no pin exists: `track-audios.ts:434-453` only `isPrimary` | ~35/60 + one column | kept: `primary_pinned`, set by the web's and MCP's set-primary |
| Unreadable set stored and parsed later | big change | `record_save` stores nothing for a file that won't decode (`save.rs:77-81`) | ~150 core + hub field | kept |
| Restore of a commit this machine never had | overhaul | the hub stores no Save/Commit objects (`remote/pack.rs:116-118`); `checkout_new_branch` reads them locally (`checkout.rs:54,67`) | ~600+ across dit and hub | kept as the overhaul: lineage objects pushed, stored, served and imported; the first stream of the dit line |
| Open in DAW on sessions-table rows | big change | `ListSession` has no holder; 50–200 rows a page | ~40 client | shrunk to one `GET /machines` read per page |
| Checkpoint before a set's first user commit | now | the push has no project to bind to (`PushOptions.project`) | 0 | none until the first user commit |
| Render hold window and scorer | now | the ≥3 batch rule needs a hold; the scanner's scorer is 640 lines of TS | 60 s hold; scorer ~220/200 | 60 s hold, the smaller scorer |
| `dit` on PATH from a dmg | now | unspecified by the spec | ~60 | bundle the cli, "Install the dit command" in settings |
| Workspace placement | now | a Tauri crate inside `packages/dit` compiles webkit on Linux CI and in `Dockerfile:77-85` | — | daemon crates in `packages/dit/crates`, the Tauri crate its own workspace at `apps/dit-app/src-tauri` |
| Installable build | now (CI big change) | no macOS job in `ci.yml`; the setup action bundles `wasm-opt` with the toolchain | ~110 CI | arm64 only, ad-hoc for CI, a self-signed identity for local builds |
| Bar item accessibility label | now | `tray-icon` exposes the `NSStatusItem`; `objc2-app-kit` sets the label | +25 | kept |
| Masthead bitmap lit by artwork | now | `/static/*` needs the bearer; a Rust URI scheme serves it | ~60/20 | kept |
| Everything else in the spec | now | shapes in the tree (reports in `.omp/plans/research/dit-app.*.md`) | ~10,000/7,500 | kept |

## Decisions

- The restatement of the stub, the dit spec's app states and flows, and what epic 3 handed down is the
  feature — nothing bent.
- Done is a daily driver plus an installable build — real work runs through the app; `tauri build`
  yields an unsigned `.app`/`.dmg`; signing and the release workflow stay in epic 5.
- The app installs Live's script on the first signed-in run, no prompt, and the cli has `dit script install`
  — copying a folder into the User Library is harmless; the panel says to enable it.
- The dit app owns `projammr://`, handling Open in DAW for tracked sets as well as Restore — the scanner is
  legacy and no longer works; dit takes precedence wherever the scanner was, and nothing here supports it.
- The panel is a popover under the bar item — the commit moment is a glance and a keystroke; nothing to move.
- Settings are a screen inside the panel — one window, one design, short settings.
- Window title kept as a signal with its permission — the prompt is explained.
- A wav+mp3 pair is one render and only the largest file under the size limit uploads — "always upload the
  highest quality available"; the limit lives in settings as the scanner's did.
- Whole-home watch kept — Live exports anywhere; the exclusions and the prompts are explained in settings.
- Nothing notifies but a new bounce — the app is a daemon, not a feed.
- A replaced sample records a save, with the sample's mtime as its time — handed down from epic 3; the
  enabling change is small.
- The cli goes through the app's socket whenever the app runs — the Keychain is read by one binary, the bar
  changes at once; the cli becomes a library and the Tauri crate uses it.
- One Rust source for the suggested message — the panel and `dit commit` word a commit the same way.
- A pin is a column on the version — the web's and MCP's set-primary pin; the rule lives with the data
  (Server Authority).
- An unreadable set is stored whole and parsed later — the dit spec's rule, built now rather than left.
- Restore brings lineage objects from the hub — chosen over a rootless branch: the push
  uploads Save and Commit records, the hub serves objects, the restore imports the chain; fork points are
  recorded, and epic 6's fetch stands on it.
- The sessions table reads the caller's machines once per page — no per-row probe, no server list field.
- No checkpoint before a set's first user commit — a checkpoint cannot bind a repo to a project.
- Renders hold for a minute before a card; the scorer is the smaller port — the stem-batch rule needs the
  hold, and the five signals the spec names fit the smaller scorer.
- The app carries the cli and installs it from settings — a dmg user gets `dit` on PATH.
- Daemon crates in `packages/dit/crates`, the Tauri crate in its own workspace at `apps/dit-app/src-tauri` —
  Linux CI and Docker keep building the dit workspace untouched; one daemon crate, two binaries.
- arm64 only, a self-signed identity for local builds — the universal build doubles compile for no Intel target;
  the identity keeps the Keychain and permission grants across rebuilds.
- `N` is "Not a bounce"; reduced motion keeps a lit track lit — the common no; state is not decoration.
- The scanner is not supported anywhere — it is legacy and no longer works; anywhere scanner was before, dit
  now takes precedence.

## Outcome

Built as specified; nothing from the Reach was dropped except the docs-site `dit/*` pages and guides, which move to follow-up work. Changed while building, and why:
- `objects/fetch` answers `409 objects_missing` with the hashes instead of an `X-Dit-Missing` header, which overflowed a client's response-header limit on a long miss list.
- `bouncedFrom` carries `sessionId`, so a version can link to its session.
- The app gained commands the panel needed: `track_folder`, `quit`, `allow_media`, `cancel_restore`, `validate_branch_name`, `forget_rejection`, `forget_never_here`, and a Repos menu item.
- Restore never waits on a file Live has open.
- Sign out forgets the token locally and removes the machine; it never revokes the hub session.
- No render is uploaded before the producer accepts it; the auto-accept option was removed.
- Still to do with a human and Live: the manual checks in the PR body (script, Screen Recording, notification action, full-screen shortcut, tray arc).
