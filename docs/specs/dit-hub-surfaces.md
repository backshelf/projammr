# dit hub surfaces and samples spec

_Written 2026-10-19. Mode: plan. Brief: "plan out epic 3 (hub surfaces and samples, PROJ-1357). we'll run
this as a /vibe session once we have a concrete plan. i believe the initial roadmap stuff should still be in
the repo". Epic 3 of the dit roadmap (`.claude/plans/scanner-dit-roadmap.md`); the settled behaviour of dit as
a whole is `.claude/specs/scanner-dit.md`, which this spec narrows to one epic._

## Summary

Epics 1 and 2 made dit push every save and commit of a Live set to the Projammr server. This epic makes that
history visible and useful on the web, and makes samples part of it. A session's history page becomes the
set's commit log: commits newest first, the saves that led to each folded under it, a time ruler above that
places every save and commit on every machine, and any two of them comparable with the diff drawing the
session page already has. From any commit the producer or a collaborator gets the set back: as a file, as a
zip with its samples, or restored onto a computer through dit. Each project folder gets a repo page, and the
collection and track pages a repositories table. Samples are tracked from the first save, pushed only when a
repo says so, stored once per instance however many repos use them, and counted toward storage once. The one
thing it must get right: a commit the hub holds can always be got back whole, and the page never claims more
than the hub has.

## The feature

### Who and where

- **The producer** (owner or editor) reads the log, compares, downloads, restores through dit, flips a repo's
  "push samples", and sees the repo's storage.
- **A collaborator who is an editor** does everything the producer does on the web. **A viewer** reads the
  log, compares and downloads; the push-samples toggle and the restore button are not offered.
- **An outsider on a share link** sees nothing new; share pages are unchanged.
- **The instance admin** sets how long the content of an uncommitted save is kept, can force every repo to
  push samples, and sees repository storage and what sample sharing saved on the Storage page.
- **Surfaces.** The web client on desktop and phone: the session page (History section, Samples section, rail),
  the session history page, the repo page, the repositories table on collection and track pages, project
  settings (Assets), instance settings (Background work, Limits, Storage). The API and MCP. The cli gains one
  setting command and a sample phase in its push. The dit app (epic 4) answers the restore probe later;
  nothing here waits for it.

### Concepts

- **Commit log.** The commits on a set's `main` branch, newest first. A commit's chips are the difference from
  the previous commit on the branch; a save's chips, folded under the commit that pushed it, are the
  difference from the previous save. A checkpoint is a commit whose message dit wrote.
- **Whole.** A commit on the hub is whole: the hub records a commit only once it holds every object the set
  needs. Its samples may follow it; the hub says how many of them it holds.
- **Sample object.** A file under the repo's `Samples/`, content-addressed, stored once per instance. A
  **reference** is a set's use of a sample at a path, with its kind (`project`, `outside`, `library`);
  references are recorded with every save whether or not the object is ever pushed, so the hub always knows
  what a set needs and what it holds.
- **Repo page.** One page per repository, inside its project: `/project/<id>/repo/<repoId>`.

### Interface

**The cli.** `dit config push-samples on|off` sets the bound repo's push-samples setting on the hub (through
the API; the hub is the record) and caches the answer; `dit config push-samples` alone prints it. `dit
status` shows "samples: pushed", "samples: local only" or "samples: pushed (instance)" from that cache. A
push has two phases: the set's objects and the commit, then the commit's sample objects when the setting is
on. `dit commit` runs the first phase and says "samples pending, run dit push" when the second is due; `dit
push` runs both. References always ride the save.

**The hub API**, as the web, dit and MCP see it:

- List a session's commits on a branch, newest first, `limit` up to 500; each with its covered saves, its
  author's name, and how many of its sample references the hub holds.
- Diff any two saves or commits of a session, across branches, in the shape the diff drawing consumes.
- Download a commit's set, or any save's set; download a commit as a zip with its samples; download one held
  sample; download a repository as a zip.
- A repo: name, project, sets with their sessions, each set's branches with their tip commit (id, message,
  time), last push (time, machine name), storage (sets, samples, saved by sharing), push-samples setting and
  whether the instance forces it; the list of a project's repos with their storage, and the repos holding a
  track's or a collection's sets.
- `PATCH /repos/:id` for the push-samples setting (editor).
- The push negotiation treats a sample object as held when any repo of a project the caller is a member of
  holds it, and links it without an upload.
- Instance settings: retention days for uncommitted content (exists, default 90; now seedable from `.env` the
  way the storage caps are) with the last prune's time and bytes freed, and "push samples from every
  repository" (default off).
- A probe: is a dit on one of this user's machines online. Answered by epic 4's app; in this epic it answers
  no.

**MCP.** `list_repos(project)` and `get_commit(commit)` as they exist; `list_commits(session, branch?,
since?)`; `diff_commits(session, from, to)`. No writes.

### Flows

**Read the log.**

1. From a session's **History** section (the latest six log rows, "All 48 commits" opening the page) or the
   sidebar's session, the history page opens on the log of `main`.
2. The masthead reads the set's name and a summary line: "48 commits · 212 saves · 3 machines · first seen
   14 Mar 2026", counted over the whole history, not the loaded page.
3. Under it the **commit ruler**: a time axis from the first save to now, one lane per machine, every save a
   faint tick, every commit a mark, checkpoints lighter. Pointing at a mark names it; clicking one scrolls the
   log to it.
4. The log: one row per commit with its message, author, machine, time since, its chips, and "3 saves" that
   unfolds the saves beneath it; the saves come with the page. Thirty commits show at first; **Older commits**
   shows up to five hundred.
5. Checkpoints are hidden by default: a checkpoint and the saves it pushed fold under the next named commit,
   whose fold reads "2 checkpoints · 14 saves". Checkpoints newer than the latest named commit show as quiet
   rows. **Show checkpoints** at the head of the log puts them all in line.

**Compare two states.**

1. On the ruler, drag across two marks or click one then shift-click another; or on a row, **Compare**, which
   takes the row as **To** and the commit before it as **From**. The address gains `?from=&to=`.
2. The comparison draws under **Comparing** the way the session page's structure does, across branches when
   the two are on different ones. **From** and **To** change either end; **Clear** starts again.

**Get a state back.**

1. A commit row's actions: **Download set**, **Download with samples**, **Restore on this computer**, **Copy
   dit command**. A save row has **Download set**.
2. **Download set** fetches the set file as dit pushed it, named `<session name>.als`.
3. **Download with samples** fetches a zip: the set file, the `Samples/` files the hub holds at their paths, and
   a `MANIFEST.txt` listing every sample the set references as "included", "not pushed" or "outside the project
   folder". The button's tooltip says "12 of 15 samples included" and the count moves as samples land. It is
   absent when the hub holds none of the commit's samples.
4. **Restore on this computer** asks the hub whether a dit on this user's machines is online. With one, it
   opens `projammr://dit/checkout/<commit id>`; dit writes the commit as a new branch file (default name
   `restore-<short id>`) and opens it in Live. With none, the button is disabled: "Needs dit on this
   computer." In this epic the hub always answers no.
5. **Copy dit command** copies `dit checkout <short id> -b restore-<short id>` and says "Copied". Its tooltip
   says "Run it in the project folder on a computer that has this repo." The short id is dit's eight hex
   characters.

**The repo page.**

1. From the session's rail (**Repository** → its name), the repositories table, or the project's Assets
   settings.
2. The page reads: the folder's name as the title, its project, "Last push 2h ago from studio-mac" (the machine
   as plain text), and the storage readout: sets, samples, and "1.2 GB saved by sharing".
3. **Push samples**, a switch, for editors: on, dit pushes this repo's sample objects with each commit. When
   the instance forces it the switch is on and locked: "On for every repository on this instance."
4. The sets: one row per set, its session, its branches each with its tip commit (message, time since) and a
   **Download set** per tip.
5. **Download repository** fetches every set at the tip of its `main` branch plus every held sample, as one
   zip with the folder's layout and a manifest.

**The repositories table.** On a track page, a table of the repos holding a set whose session belongs to the
track; on a collection page, the repos of its tracks. Same row treatment as the sessions table: name, sets,
branches, last push (time and machine), storage. A row opens the repo page. The table appears once a repo
holds one of the page's sets; before that the page is unchanged.

**Samples on the session page.** The **Samples** section lists each sample the latest save references with its
state: "on the hub" (and a download for that one file), "not pushed", "outside the project folder", or
"missing" as today when Live could not find it.

**Settings.**

1. Project → **Assets**: the storage line gains **Repositories <size>**, and a list of the project's repos
   with their storage, each opening its repo page.
2. Instance → **Background work**: **Keep the content of uncommitted saves for** (exists; days, default 90)
   gains the line "Last pruned 3h ago · 412 MB freed".
3. Instance → **Limits**: **Push samples from every repository** (off by default).
4. Instance → **Storage**: each project's row shows its repositories' share; under the total, "Samples stored
   once · shared by 3 projects · 1.2 GB saved".

### States

**History page.**

- No saves: "No saves yet." The ruler is absent.
- Saves, no commits: the ruler and the saves as rows; above them, "Every save is here. Name one with dit to make
  it a commit."
- Commits: the log as in Flows.
- A pruned save (content dropped by retention): its row keeps its chips; **Download set** is disabled with
  "Content of uncommitted saves is kept for 90 days; this one has expired." It still compares.
- A commit whose samples are still landing: nothing on the row; the zip's tooltip counts what is held.
- Older commits: the button shows progress in place; at five hundred it says "Showing the latest 500 commits."
- Viewer: no **Restore**; downloads and compare as for everyone.
- Phone: the ruler collapses its machine lanes into one; rows and the compare work as on desktop; **Restore** is
  disabled with "Needs dit on this computer."

**Repo page.**

- Nothing pushed yet: the title and project, then "Nothing pushed yet."
- Populated: as in Flows.
- Viewer: the push-samples switch is shown read-only.

**Repositories table.** Absent until one repo holds one of the page's sets.

**Samples section.** Unchanged when the set uses no samples; otherwise each row carries its state.

**Download with samples.** Present only when at least one referenced sample is held; the tooltip counts.

**Settings.** The retention line reads "Not pruned yet" before the first run and "Last prune failed <time>"
after a failed one.

### Rules

- The log shows `main`. A set's other branches (which only a restore creates in this release) are listed on
  the repo page with their tip commit and download; the branch picker is a later epic.
- A commit's chips are its difference from the previous commit on its branch; a save's are from the previous
  save. The session page's structure keeps comparing the latest save with the one before it.
- Downloads are open to every member, viewers included. **Restore** and the push-samples switch need editor.
- A commit on the hub is whole and downloadable; a pruned save is not downloadable and never will be.
- Sample references are recorded with every save and pushed with every commit; dit's saves write fills the
  session's samples list from them, so the Samples section and the project's samples pages read dit sets as
  they read scanned ones. Sample objects are pushed only when the repo's push-samples setting is on, or the
  instance forces it, in a phase after the commit; a sample the storage cap refuses never blocks the set's
  commit. Only `Samples/` is tracked; a reference whose path escapes the folder is "outside" and never read.
  A sample's bytes are hashed once per `(path, size, mtime)` and the result cached in `.dit/`.
- Push-samples is held on the hub, written by the repo page and by `dit config push-samples`; last write wins.
  The instance setting forces it on for every repo and locks the switch.
- The push negotiation treats a sample object as held when any repo of a project the caller is a member of
  holds it: the caller could already read those bytes, so nothing new is exposed. An object held only by a
  project the caller is not in is uploaded again and stored once.
- A repo object counts once toward storage: toward the project and the account of its earliest push on the
  instance. A project or account that pushes or links it later pays nothing for it. When that project is
  deleted, the object stays while any repo references it and its charge moves to the project and account of
  the earliest remaining push; an object nothing references is deleted. A charge that moves is not checked
  against the receiving cap; the next upload is.
- Retention: the scheduled job drops the content of saves no commit names as its own once they are older
  than the instance's retention days; their metadata, chips and place in the ruler stay. Sample objects then
  referenced by nothing are freed. Each run records its time and the bytes it freed.
- Existing data: sessions the scanner recorded have saves without content and no commits, and show the
  "Every save is here" state; sessions added by hand show "No saves yet."; only dit repos have a repo page.

### Input

- Log rows are a list; each fold is a button with its expanded state announced. Row actions are real buttons
  with labels, and tooltips naming the machine or branch they act on; disabled ones say why.
- The ruler is keyboard-operable: focus it, arrows move between marks, Enter sets **From** then **To**, Esc
  clears. Marks are 44px targets on touch. Reduced motion: no scroll animation to a mark, the compare appears
  in place.
- The compare keeps `]` and `[` to step changed tracks, and `?from=&to=` in the address.
- Settings fields save on change, as every setting does; the two instance settings are findable by name in
  the settings search and the command palette.

### Copy

- Masthead summary: "48 commits · 212 saves · 3 machines · first seen 14 Mar 2026".
- Fold: "3 saves" / "2 checkpoints · 14 saves"; toggle "Show checkpoints"; "Older commits" / "Showing the
  latest 500 commits."
- Row actions: "Download set" / "Download with samples" / "Restore on this computer" / "Copy dit command" /
  "Compare".
- Tooltips: "12 of 15 samples included" / "Needs dit on this computer." / "Copied" / "Run it in the project
  folder on a computer that has this repo."
- cli: "samples pending, run dit push" / "samples: pushed" / "samples: local only" / "samples: pushed
  (instance)".
- Pruned: "Content of uncommitted saves is kept for <n> days; this one has expired."
- Empty: "No saves yet." / "Every save is here. Name one with dit to make it a commit." / "Nothing pushed yet."
- Repo page: "Last push <time> from <machine>" / "Push samples" / "On for every repository on this instance." /
  "<size> saved by sharing" / "Download repository".
- Samples: "on the hub" / "not pushed" / "outside the project folder" / "missing"; manifest states "included" /
  "not pushed" / "outside the project folder".
- Settings: "Repositories" / "Keep the content of uncommitted saves for" / "Push samples from every
  repository" / "Last pruned <time> · <size> freed" / "Not pruned yet" / "Last prune failed <time>" / "Samples
  stored once · shared by <n> projects · <size> saved".

### Failure

- A download of a pruned save answers with the row's message; the button is disabled before it can be asked.
- The probe times out or answers no: **Restore** is disabled with its message; nothing is opened.
- The zip is streamed. Every object of a sample is checked before its entry begins; a sample that fails the
  check is listed in the manifest as "not pushed". An object that vanishes after its entry began ends the
  response, so the client sees a failed download rather than a truncated archive; `MANIFEST.txt` is the last
  entry.
- The prune job fails: nothing is dropped that run; the setting shows "Last prune failed <time>" and the next
  run retries.
- A push the storage cap refuses fails with the server's message, as today; a linked sample is never charged,
  so a shared sample never trips it. A refused sample leaves the commit on the hub and the sample pending.

## Reach

- MCP: yes. `list_repos`, `list_commits` (with `since`), `get_commit` and `diff_commits`, so an AI client can
  answer "what changed in science this week" and "which repos pushed today". No writes: committing, restoring
  and the settings need the file or an admin.
- Docs: yes, under PROJ-1364 (the docs task outside the epics). `guide/session-history` becomes the commit
  log (ruler, folds, checkpoints, compare, downloads, restore, copy command, pruned state); `guide/sessions`
  for the History section, the Samples states and the rail's Repository row; a new `guide/repositories` for
  the repo page, the repositories table and Download repository; `admin/storage` for the Repositories figures
  and the sharing readout; `admin` and `self-hosting/configuration` for the retention line, its seed variable
  and "push samples from every repository"; `api` for the MCP tools; the dit cli page for `dit config
push-samples` and the two-phase push.

## Ideas taken

- Commit ruler above the log — the history page's one bold element; brushing it sets the compare.
- Checkpoints fold quiet — a checkpoint every two hours no longer buries named commits.
- Copy the dit command — restore works with the cli before epic 4's app answers the deep link, on a computer
  that has the repo.
- Saves load with the page, the log grows on demand — thirty rows first, five hundred at most.
- Hub skips samples it already holds — within the projects the caller is a member of, in the push negotiation.
- Samples section says what's on the hub, per sample — and downloads one file alone.
- Download repository — the web's clone until `dit clone` ships.
- Repo page shows the push-samples toggle and its storage split — the setting lives where the repo is.
- Project Assets page lists repositories — beside the storage line it already has.
- Admin storage shows the dedupe — the total explains itself.
- Retention prune as a scheduled job with a last-run line — the setting shows it is doing something.
- MCP `list_commits` takes `since` — one call for "what changed this week".
- MCP `list_repos` on a project — already built in epic 2; kept.

## Ideas set aside

- Structure marks changes since the last commit — not chosen; the structure keeps comparing consecutive saves.
- Commits in the command palette — not chosen.
- Commit permalinks (`?at=`) — not chosen; `?from=&to=` stays the only deep link into the page.
- "Still arriving" on a commit — dropped at the crush: a commit on the hub is whole by construction
  (`apps/server/src/db/queries/commits.ts:400-402, 521-547`); the zip tooltip's count covers samples landing.
- Time in the set per commit and per session — handed to epic 4 (PROJ-1358) whole: nothing records, stores or
  pushes segments, and epic 4's app is the producer.
- Last push links to the machine; a machine's row lists its repos — handed to epic 5 (PROJ-1359): dit
  machines are name strings on sessions, not rows, until epic 5 turns scanner devices into dit machines.
- Download named as the file was named at that commit — set aside: dit sends a set's file name once, at
  adoption; `<session name>.als` stands.
- The repo's path on the last machine — set aside: dit never sends it, and a home-folder path on a page every
  member sees is a privacy cost for no gain.
- Keyset paging past five hundred commits — set aside: no cursor exists in the tree; `limit` reaches 500.

## Critiques

- A browser cannot tell whether dit is installed, so the restore button cannot know its own state → changed:
  the hub probes the user's machines the way the scanner's Open in DAW does; epic 4's app answers, so in this
  epic the button is disabled with its message and "Copy dit command" is the working path.
- "First pusher pays" needs a sample object to outlive the project that pushed it → changed: the payer is
  derived from the earliest remaining push; deleting a project frees only what nothing else uses, and the
  charge moves to the next earliest.
- Live references samples outside `Samples/`, so the zip can never be complete for those → kept as briefed:
  only `Samples/` is tracked; the manifest and the Samples section name the outside references.
- An instance-wide "have it" by hash would let any editor read another project's bytes → changed at the
  crush: the claim is scoped to projects the caller is a member of.

## Not included

- The branch picker and showing any branch but `main` on the session page (epic 6).
- A restore that completes end to end: the probe answers no and the deep link has no handler until epic 4.
- Time in the set (epic 4). A dit machines pane and machine links (epic 5).
- Backfill, retiring the scanner, deep diffs, clone and pull.
- Share page changes; commits in the activity feed; commit search.
- MCP writes.
- Tracking samples outside the project folder; skipping an upload for an object held only by a project the
  caller is not in.
- Downloading a save that retention has pruned.
- The repo's path and the set's file name per commit.

## Handed to later epics

Recorded here and on each epic's Jira description.

- **Epic 4 (PROJ-1358):** time in the set, per commit ("2h 14m") and per session (the history masthead's hours
  total); the hub table and push field for segments, and the readouts. The probe answer ("is a dit online on
  this user's machines") and the `projammr://dit/checkout/<commit id>` handler.
  A sample replaced in place records no save: dit hashes `Samples/` files when it records a save, and a save is
  recorded only when the set's XML changes, so overwriting a referenced sample without touching the set leaves
  the latest save naming the old bytes until the set is next saved. The epic 4 save watcher treats a change to a
  referenced file under `Samples/` as a reason to record a save.
- **Epic 5 (PROJ-1359):** dit machines as rows: a machines pane under Settings → Devices listing each machine
  with the repos it has pushed, and the repo page's "Last push from <machine>" linking to it.

## Layout

**History page.** The ruler is the page's instrument: it sits under the head, the compare opens right under it
when two marks are brushed, and the log reads beneath.

```
┌ crumbs ──────────────────────────────────────┐
│ science123                      [Show checkpoints]
│ 48 commits · 212 saves · 3 machines · first seen 14 Mar
├──────────────────────────────────────────────┤
│ studio-mac  ·  ·  ·  ●  · ·  ●  ·  ·   ●   · │  ← ruler
│ laptop            ·  ·      ●      ·   ·     │   lanes per machine
│      Mar ─────────── Jun ─────────── Oct     │
├──────────────────────────────────────────────┤
│ COMPARING  From [a1b2c3 ▾] To [d4e5f6 ▾] Clear│  (only with ?from=&to=)
│ ▁▃▅▂▇▃▁  skyline · readouts · tracks · samples│
├──────────────────────────────────────────────┤
│ LOG                                          │
│ ● add strings, tempo 120→124   alex · 2d     │
│   +2 tracks  +EQ Eight on Bass  tempo 120→124│
│   ▸ 3 saves   Download set ▾  Restore  Copy  │
│ ● checkpoint · 2h 14m (quiet)                │
│ ● first commit                 alex · 3w     │
│   ▸ 14 saves                                 │
│            [ Older commits ]                 │
└──────────────────────────────────────────────┘
```

**Repo page.** A `PageHead` page: the switch in the head's action slot, storage as one readout line, each set a
row that opens to its branches.

```
┌ project › science Project ───────────────────┐
│ science Project            [Push samples ◉ on]
│ Last push 2h ago from studio-mac             │
├──────────────────────────────────────────────┤
│ STORAGE   sets 412 MB · samples 2.1 GB · 1.2 GB saved by sharing
├──────────────────────────────────────────────┤
│ SETS                     [Download repository]│
│ science123.als → Session: science123         │
│    main       add strings · 2d   Download set│
│    restore-a1b2  restore · 1w    Download set│
│ science123 idea2.als → Session: idea2        │
│    main       first commit · 3w  Download set│
└──────────────────────────────────────────────┘
```

## Feasibility

| Item                                                                                                                                                                                                  | Verdict               | Why                                                                                                                                                                                                                                            | Rough size                                 | Chosen                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| Samples tracked as objects in `.dit/`, references with kind per save                                                                                                                                  | big change            | `record_save` stores the set tree only (`packages/dit/crates/dit-core/src/repo/save.rs:80-110`); `Save` has no sample field (`:21-45`); no `Daw::sample_refs`; a sample is a Blob/Chunked leaf, kinds 1–5 suffice                              | Rust ~400 code / 450 tests; hub ~190 / 240 | kept                                                        |
| Push-samples setting (column, `PATCH /repos/:id`, instance toggle, `dit config`, `dit status` cache)                                                                                                  | now                   | no column (`apps/server/src/db/schema/repos.ts:23-38`), no repo edit route (`routes/repos.ts:84-130`); toggle pattern `packages/settings/src/groups/instance-access.ts:78-81`; `dit remote set` is the cli template                            | ~+185 hub, ~+150 Rust                      | kept                                                        |
| Push phase for samples after the commit POST                                                                                                                                                          | big change            | push runs objects then commit in one run (`packages/dit/crates/dit-core/src/remote/push.rs:569-614`); per-save object listing would repeat sample ids per save                                                                                 | Rust ~250 / 330                            | kept                                                        |
| Hub skips samples it already holds, instance-wide                                                                                                                                                     | not without a miracle | `missingObjects` is per repo by design (`apps/server/src/db/queries/objects.ts:93-114`; PROJ-1345, security-boundary): a hash-only claim links, then serves, another project's bytes                                                           | —                                          | shrunk to a membership-scoped claim (now, ~+140)            |
| First pusher pays once; charge moves on delete                                                                                                                                                        | big change            | every project and pusher is charged today (`apps/server/src/db/queries/storage-usage.ts:233-255, 302-336`); the audit re-derives the same rule                                                                                                 | ~+300 + 150, flips 5 tests                 | kept, for every object                                      |
| "Still arriving"                                                                                                                                                                                      | overhaul              | a commit exists only once every object is held (`apps/server/src/db/queries/commits.ts:400-402, 521-547`)                                                                                                                                      | —                                          | dropped                                                     |
| Time in the set                                                                                                                                                                                       | overhaul              | no segments, table, route or producer anywhere (grep over dit crates, server, api, docs)                                                                                                                                                       | ~+480 with no producer                     | handed to epic 4                                            |
| Diff endpoint + MCP `diff_commits`                                                                                                                                                                    | big change            | the diff model is pure but lives in `@workspace/ui` (`packages/ui/src/lib/session-diff.ts:97-161`); the server has no ui dependency (`apps/server/package.json:26-30`)                                                                         | ~+370 incl tests                           | kept: model moves to `packages/session-diff`                |
| Thirty a page, Older commits, `since`                                                                                                                                                                 | big change            | `limit` only, max 500 (`apps/server/src/routes/repo-history.ts:140-159`, `db/queries/pagination.ts:45-56`); no cursor in the tree                                                                                                              | ~+130                                      | shrunk: `limit` growth to 500 (~40); MCP `since` kept (+15) |
| Download named as the file was at that commit                                                                                                                                                         | big change            | downloads are `<session name>.als` (`apps/server/src/routes/commits.ts:62-66`); dit sends the name once at adoption                                                                                                                            | ~+120                                      | shrunk: session name                                        |
| Repo path on the last machine                                                                                                                                                                         | big change            | no path column; dit sends the folder name only                                                                                                                                                                                                 | ~+60                                       | dropped (privacy)                                           |
| Last push links to the machine; a machine's row lists its repos                                                                                                                                       | big change            | dit sign-in is an `auth_sessions.device_name` only; Devices has one pane, Scanners                                                                                                                                                             | ~+200 + identity                           | shrunk: plain text; rows handed to epic 5                   |
| Retention last-run line                                                                                                                                                                               | big change            | the sweeper logs counts only (`apps/server/src/db/queries/save-retention.ts:446-484`); `SettingRow` has no status slot; `lastAudit` is returned but never rendered                                                                             | ~+185 server, ~+90 client                  | kept; setting stays in Background work                      |
| Zip with samples, manifest, Download repository, one-sample download                                                                                                                                  | big change            | no zip library in `apps/server/package.json` or `bun.lock`; `materialiseSave` reusable                                                                                                                                                         | ~+550 + 255                                | kept                                                        |
| Repositories table                                                                                                                                                                                    | now                   | `EntityTable` cannot take a non-entity kind; `DataTable` direct as `AssetsTable.tsx:227`; `deleteKind` required (`generic-table-types.ts:284`) becomes optional; section id in `packages/settings/src/groups/pages.ts:28-47`                   | ~+280 incl server read                     | kept                                                        |
| Per-save download route                                                                                                                                                                               | now                   | only `GET /commits/:id/set` exists (`routes/commits.ts:19-69`); same shape over a save                                                                                                                                                         | ~+50                                       | kept                                                        |
| Commit log, folds, checkpoint toggle, ruler, lede, History section, rail row, repo page, Assets line, admin figures, restore button (disabled), copy command, pruned state, `.env` seed, MCP list/get | now                   | shapes in the tree: `save-timeline.tsx:21-57`, `ruler-scale.ts:11-65`, `OpenInDawButton.tsx:29-63`, `CopyButton.tsx:20-35`, `route-pattern.ts:4` + `entities/project/routes.ts:15-22`, `SettingsStorage.tsx:13-45`, `mcp/tools/repos.ts:19-74` | ruler ~300, repo page ~455, the rest small | kept                                                        |

## Decisions

- The restatement of the stub plus the dit spec's web and settings states is the feature — nothing bent.
- Whatever the cli still lacks for samples (tracking `Samples/`, the setting, the push path) is in scope — "if
  it hasn't been done, it needs to be done"; phase 4 found none of it exists.
- The restore button, its link shape and its disabled state ship now — epic 4 has nothing web-side left to do.
- No repos section on the project page; a repositories table on collection and track pages, and a rail link
  from the session — a project-wide list is unscoped and useless.
- The session page shows `main` only; branches are listed on the repo page — no half-built picker before epic 6.
- Viewers can download a commit's set — they can already hear everything, and the set is the record.
- The samples zip holds what the hub has and says what is missing; hidden when nothing is held — never a
  silent partial.
- A deduped object counts once, toward the earliest pusher — the dit spec's "restorable elsewhere without a
  surprise bill"; applied to every object, not samples alone, so one rule the audit can re-derive.
- Push-samples is writable from the repo page and the cli, held on the hub, last write wins — server authority
  with both doors open.
- The session page's History section is the log's first six rows — one component, two places.
- Restore detection probes the machine like the scanner — a real answer rather than a guess; disabled until
  epic 4 answers.
- Objects are reference-counted by their link rows; the charge moves on delete — "first pusher pays" without
  leaks.
- Only `Samples/` is tracked; outside references are named, not copied — the dit spec's rule kept.
- The samples half stays whole in this epic — it is the epic's second name; nothing smaller is the feature.
- The upload skip is membership-scoped — the only shape that keeps the project boundary.
- "Still arriving" dropped — the hub never holds a half commit; the zip tooltip covers samples.
- Time in the set goes to epic 4 with its data — readouts with no producer are dead code.
- Paging is `limit` growth to 500 — no cursor in the tree, and 500 commits is years of work on one set.
- The diff model moves to a shared package — the server runs the same diff the client draws.
- Downloads are `<session name>.als`; the repo page shows no path — neither field exists and the path is a
  privacy cost.
- Machine names are plain text; machine rows go to epic 5 — epic 5 owns machine identity.
- The retention line is kept and the setting stays in Background work — the key rename buys nothing.
- Every item handed to a later epic is written in this spec, the plan and that epic's Jira description.

## Outcome

Plan mode. The plan is `.omp/plans/dit-hub-surfaces.md`: sixteen steps in five lines (the log, repos,
accounting and settings, dit, hub samples) with six contracts, to be built as a vibe session with a worktree
per line. Hand-downs recorded on PROJ-1358 and PROJ-1359; PROJ-1357 points here.
