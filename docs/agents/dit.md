# Reference: dit (`packages/dit`, `@workspace/dit`)

**A Rust workspace for dit, the git-shaped DAW reader that replaced the Electron scanner**, reached by Bun scripts and turbo the way
`packages/dsp` is. It has its own Cargo workspace, lock and toolchain pin; `packages/dsp/rust` stays outside it with
its own lock and release profile. The root `packages/*` glob makes it a Bun workspace, so no root config names it.

```
Cargo.toml              [workspace] resolver 3, members = ["crates/*"] (a glob: a new crate needs no edit here);
                        [workspace.package] version (the repo version), edition 2024, license AGPL-3.0-only;
                        [workspace.dependencies] shared dependency versions
Cargo.lock              committed
rust-toolchain.toml     channel 1.97.1, target wasm32-unknown-unknown, clippy + rustfmt, profile minimal
package.json            @workspace/dit: build, typecheck, lint, test, format scripts
scripts/lint.ts         cargo fmt --check, cargo clippy --workspace --all-targets -- -D warnings, then eslint
scripts/build-wasm.ts   builds pkg/dit.wasm (see "Loader and build")
src/                    the Bun host for dit.wasm (`@workspace/dit/wasm`)
crates/dit-core/        the DAW-agnostic core
crates/dit-daw-ableton/ the Ableton Live module; depends on dit-core by path
crates/dit-daws/        the DAW registry, the contract suite and the real-set sweep
crates/dit-cli/         the `dit` library and binary
crates/dit-ipc/         the local socket between `dit` and the dit app
crates/dit-daemon/      the app's watching, counting and deciding parts, tested without a window
crates/dit-wasm/        dit.wasm
```

The dit app, `apps/dit-app`, is outside this workspace and depends on these crates by path ("The app").

Crates inherit `version`, `edition` and `license` with `.workspace = true` and set `publish = false`.

## Crates

**`dit-core`** holds everything DAW-neutral. `serde` (with `derive`), `serde_json` and `thiserror` are
workspace dependencies. `dit-daw-ableton` depends on it with `default-features = false`, because the `store`
feature pulls in C code the wasm build must not reach.

- `daw.rs`: the `Daw` trait a DAW module implements (`id`, `display_name`, `set_extensions`, `managed_subfolders`,
  `is_project_folder`, `find_sets`, `decode`/`encode` between file bytes and document, `split` into a `Tree`,
  `mask`/`unmask` of volatile values through a side list, `parse` into `SetMeta`, `sample_refs`, `list_backups`), `Backup`, and
  `DawError` (`Corrupt`, `Malformed`, `Unsupported`; strings only, so the wasm crate can map it to a numeric code).
  `Registry::new` takes `&'static dyn Daw` values and refuses a duplicate id or a duplicate extension (compared
  lowercase); `by_id`, `for_file` (extension, case-insensitive) and `for_project_folder` (asks each DAW's
  `is_project_folder`) answer lookups.
- `tree.rs`: `Tree { parts }`, `Part { kind: Gap | Track | Section, tag, id, leaves }`,
  `Leaf { kind: Text | Blob, tag, bytes }`. The parts partition the document exactly, so `join` is the
  concatenation of every leaf's bytes in order.
- `meta.rs`: `SetMeta` and `SetStructure`, camelCase serde that matches the JSON the server stores as a save's
  meta (`SaveMeta` in `apps/server/src/db/schema/saves.ts`, `sessionStructureSchema` in
  `sessions.ts`). Every top-level field serialises (`null` when `None`); optional fields inside `structure` and its
  tracks are skipped when `None`. Track and group ids are `i64`; `plugins` is a `BTreeMap`, so a serialised
  `SetMeta` is deterministic and can sit inside a content-addressed object.
- `store/`: object ids, codecs and the filesystem `Store` (see "Objects").
- `materialise.rs`: `materialise_xml`, ungated (see "The repo"'s "Reading back").
- `fingerprint.rs`: `file_fingerprint`, the retired scanner's `<size>:<sha1 of the first and last 64 KiB>` match string (see
  "The repo"'s "The match fingerprint"); behind `store` or `remote`.
- `repo/`: `Repo`, `.dit/` and recording saves, behind the `store` feature (see "The repo").
- `remote/`: the user config, the HTTP client, the token store and the device grant, behind the `remote` feature
  (see "Signing in"). `store` and `remote` are both default features; the wasm build and the DAW crates turn both
  off with `default-features = false`.

**`dit-daw-ableton`** has `Ableton`, the `Daw` for `als` sets (managed subfolders `Samples`, `Backup`, `Freeze`,
`Recorded`, `Ableton Project Info`) (see "The Ableton module").

**`dit-daws`** holds `registry()`, the one place the DAW modules are listed, and the contract suite and sweep
(see "Adding a DAW").

**`dit-cli`** is the `dit` command line as a library (`lib.rs`) with a thin `main.rs`, over `dit-core`,
`dit-daws`, `dit-ipc` and `dit-daemon` (for `dit renders`: the ledger, the upload driver and the card; see "The cli"
and "Renders").

**`dit-ipc`** is the socket protocol, its client and its server skeleton (see "The local socket"); it depends on
nothing else in the workspace.

**`dit-daemon`** is what the dit app does that is not a window, written so tests drive it with no Live, screen or
network: the daemon state machine, the watcher, settle rules, catch-up, checkpoints, the segment tracker, the script
listener, the window list, the open-set chain, the push queue and the machine beat (see "The daemon", "Time in a
set", "The open set and the script", "Machines and the push queue" and "Renders"), the render engine included: the
whole-home watcher subscription, the settle and hold, the pair and batch rules, the score, the ledger and the hub
steps that add a render, and the backfill (project discovery, Check, proposals, the resumable run; see "The
backfill"). It depends on `dit-core`, `notify`, `lofty` (a render's
length and container), `sha2` (its fingerprint) and `strsim` (the score's name measure), and on `core-graphics` on
macOS only.

**`dit-wasm`** is the `cdylib` (and `rlib`, for native tests) behind `dit.wasm`: `dit-core` and `dit-daws` with
default features off, so no C code (see "The wasm module").

## Objects

`dit-core/src/store/` keeps every leaf, chunk, tree, save and commit once, named by hash. `sha2` and `hex` are
unconditional, so the wasm build (default features off) computes and verifies ids and decodes trees. Only `zstd`,
`libc` (a dependency on Apple targets only, for a batch's syncs) and the filesystem `Store` sit behind the default-on
`store` feature.

**Id rule.** An `ObjectId` is the SHA-256 of `kind byte ‖ body`, shown and serialised as 64 lowercase hex chars.
`ObjectKind`: `Blob = 1`, `Chunked = 2`, `Tree = 3`, `Save = 4`, `Commit = 5`. Save and Commit bodies are
`serde_json` of their structs (`Save` is in "The repo" below).

**Files.** `Store::open(dir)` takes the `objects/` directory itself (`.dit/objects`). An object is
`<dir>/<first two hex chars>/<full hex id>`, holding zstd level 3 of `kind byte ‖ body`. `put` skips an object
that exists and otherwise writes a temp file (`.tmp-<pid>-<n>`) in the same shard directory, `sync_all`s it and
renames it into place, so two writers of one object both succeed. `get` decompresses, splits the kind byte,
recomputes the id and returns `StoreError::Corrupt` when it differs from the file's name; it never repairs.
`StoreError` (`Io`, `Missing`, `Corrupt`, `Malformed`) holds strings and ids only.

**Durability rule.** A file at an object's name is durable before anything names the object, and `put` relies on it:
it skips an existing object, so a zero-length or torn file renamed into place before a power loss would never be
rewritten, and a log could name it. A single `put` gets this from `sync_all` before the rename. On Apple platforms
`sync_all` is `fcntl(F_FULLFSYNC)`, a flush of the whole drive's cache, and a save writes an object per leaf and
chunk, so a first save of a large set (about a thousand objects) would spend seconds flushing. A save's objects
therefore go through a `Batch` (`Store::batch()`, then `Batch::put` and `Batch::put_leaf`, which skip an object
already stored or already in the batch):

1. Each object is written to its temp file and pushed to the drive: a plain `fsync` on Apple platforms,
   `sync_all` elsewhere.
2. `Batch::finish` flushes the drive's cache once (`F_FULLFSYNC` on the store directory; a no-op elsewhere).
3. Only then does it rename every temp file into place.
4. It syncs each shard directory it renamed into (plain `fsync` on Unix; Windows cannot open a directory to sync
   it). On Apple platforms that reaches the drive, and the `F_FULLFSYNC` that the log write's own `sync_all` issues
   makes the renames stable before the log is renamed into place.
5. Only after `finish` returns may the caller write the log that names the objects.

A crash before the renames leaves `.tmp-*` files and no object at its name; a crash after leaves durable objects
nothing names, which is harmless. A batch dropped unfinished (an early `?` return) removes its temp files. Nothing
reads an object of a batch before `finish`. `Repo::commit` stores one object and keeps the plain `put`.

**Leaves.** `Store::put_leaf` stores a leaf of at most 256 KiB (262,144 bytes) as one Blob. A larger one is cut
by `cdc.rs` and each piece is stored as a Blob, plus a Chunked object whose id is returned. Reading goes through
`ObjectRead::get` and the free function `read_leaf`, which returns a Blob's body or joins a Chunked object's
chunks; `Store` implements the trait, and the wasm build implements it over an in-memory pack. `read_tree`
turns a stored Tree object back into a `Tree` with every leaf read (`read_tree_object` stops at the decoded
`TreeObject`, for readers that need only part and leaf ids, like diffs); it is the one tree reader, for the repo and
the wasm build alike.

**Chunking** is a gear-hash cut, and the parameters are storage format (changing one orphans stored chunks):
`MIN` 16 KiB, `MAX` 256 KiB, `MASK` `0xffff0000` (about 64 KiB past `MIN`). The gear table is 256 words from
xorshift32 (`13, 17, 5`) seeded `0x9e3779b9`. A chunk `[start, end)` ends at `min(start + MAX, len)`; when
`start + MIN >= end` it is the rest. Otherwise the hash starts at 0 at `start + MIN` and rolls
`h = (h << 1) + GEAR[byte]` over each byte; the chunk ends after the first byte where `h & MASK == 0`, or at `end`.

**Streaming leaves.** `Batch::put_reader(reader) -> (ObjectId, bytes read)` stores a leaf without holding it whole:
one `MAX + 1` byte buffer, filled, cut with the same `next_cut` over its first `MAX` bytes (the extra byte only tells a
leaf that ends on the buffer from one that goes on), the chunk put, the rest moved to the front. The ids are those
`put_leaf` gives the same bytes at any read size; a test holds it at the sizes around the cuts. It is how sample
files, which run to gigabytes, are tracked.

**Tree body** (`encode_tree`/`decode_tree` over `TreeObject { parts: Vec<PartEntry> }`, `PartEntry { kind, tag, id,
leaves: Vec<LeafEntry> }`, `LeafEntry { kind, tag, object }`), all integers little-endian:

```text
tree body   = u8 version (= 1) ‖ u32 part_count ‖ part*
part        = u8 kind (0 Gap, 1 Track, 2 Section) ‖ opt_str tag ‖ opt_str id ‖ u32 leaf_count ‖ leaf*
leaf        = u8 kind (0 Text, 1 Blob) ‖ opt_str tag ‖ [u8; 32] object id
opt_str     = u8 0  |  u8 1 ‖ u32 byte_len ‖ UTF-8 bytes
```

Decoding rejects an unknown version or kind byte, a truncated body and trailing bytes.

**Chunked body** is the chunk ids concatenated, 32 bytes each, in order; a length that is not a multiple of 32 is
malformed.

## The repo

`dit-core/src/repo/` is a Live `Project` folder with `.dit/` inside it. The whole module needs the filesystem
`Store`, so it sits behind the `store` feature, which also enables the optional `toml` and `gethostname`
dependencies; the wasm build never sees it. `dit-core` cannot depend on a DAW crate, so callers hand the DAW over:
`Repo::init(dir, daw)` and `Repo::open(path, &Registry)`.

```text
.dit/
  config.toml                   daw = "<DAW id>"
  sets.toml                     [sets]  <set id> = "<main file, relative to the project, `/` separated>"
                                [branches.<set id>]  <branch> = "<branch file, likewise>"
  lock                          the writer lock (an empty file, locked while a mutating call runs)
  objects/                      the object store (Store::open(".dit/objects"))
  samples.json                  the sample read cache: {files: {<project-relative path>: {size, mtime (ns), object}}}
  logs/<set id>/<branch>        save ids, one hex id per line, in recording order
  refs/sets/<set id>/<branch>   a commit id (read_ref / write_ref)
```

`init` refuses a folder the DAW does not recognise as a project folder (`RepoError::NotAProject`) and leaves files
already in `.dit/` alone. `open` looks for `.dit/` in the given path, then its parent, and resolves the DAW id in
`config.toml` with `Registry::by_id`; an unknown id is `RepoError::UnknownDaw`. Writes to `sets.toml`, a log or a ref
are a temp file renamed into place in the same directory; a log append is read all, add the line, write, rename.

**Locking.** Those writes are read-modify-write, so two writers (the daemon and a cli run, or two cli
runs) would lose each other's update. Every public mutator (`init`, `record_save`, `commit`, `checkout_new_branch`,
`import_backups`, `write_ref`) takes the advisory lock on `.dit/lock` (`repo/lock.rs`, `std::fs::File::try_lock`)
as its first statement, before its first read, and holds it until it returns; the `RepoLock` guard releases it on
drop, including on an error. A waiting writer polls every 20 ms and gives up after 10 s with `RepoError::Locked`
(`another dit command is writing to this repo …`). The lock is per open file description, so it conflicts with itself
inside one process: a mutator holding it calls only unlocked internals (`write_ref_unlocked`, `append_log`,
`write_log`, `store_save`, `register_set`), never another public mutator. Reads (`log`, `saves`, `history`,
`read_ref`, `sets`, `branch_files`, `materialise`) never lock; they see whole files because every write is a rename.
A holder of a `Repo` shortens or lengthens the wait with `Repo::with_lock_wait(duration)` (the app waits 2 s and
retries itself, so a long first read of a large sample does not pin its worker); `init`'s is `Repo::init_waiting`.

**Branches.** A set (one set id) has branches, each with its own working file and its own save log. `main` is the
set's own file, listed in `[sets]`, and never appears in `[branches]`; any other branch is a file dit wrote,
`<main stem> @<branch>.<main ext>` beside the main file, listed under `[branches.<set id>]` (`Repo::branch_files`).
`record_save` resolves a file to `(set id, branch)`: a `[sets]` file is `main`, a `[branches]` file is that branch,
anything else is a new set on `main`. A branch name is 1 to 64 characters that are letters, digits, space, `-`, `_` or
`.`, not starting or ending with `.` or space, and not a Windows device name (`CON`, `PRN`, `AUX`, `NUL`,
`COM1`-`COM9`, `LPT1`-`LPT9`, `COM`/`LPT` with a superscript `¹²³`; any case, with or without an extension, judged on
the trimmed part before the first `.`); anything else is `RepoError::BadBranchName`. `check_branch_name` guards every
place a name is joined into a path (`read_ref`, `write_ref`, `log`, `append_log`), and `main` passes there.
`check_set_id` guards the same joins: a set id is 1 to 64 ASCII letters and digits, else `RepoError::BadSetId`, so a
hand-edited `sets.toml` cannot reach outside `.dit/`.

**Set ids.** A set gets a stable id at its first save: the first 16 hex chars of SHA-256 over its relative file name,
the time in nanoseconds and the process id, hashed again with a counter appended if `sets.toml` already has it. A set
file must sit inside the project, outside `.dit/`, and carry one of the DAW's `set_extensions()` (ignoring case);
anything else is `RepoError::NotASet`, never a new set.

**A save** (`Save`, camelCase JSON, stored as a Save object) holds `setId`, `branch`, `xmlHash` (hex SHA-256 of the XML), `tree`
(the masked Tree object), `side` (a Blob whose body is the side list as a JSON array of strings), `raw` (a Blob or
Chunked leaf holding the file's bytes; present only on a save of a file no document could be read from), `fileUpdatedAt` (the
file's mtime in milliseconds since the epoch, floored, the retired scanner's rule; see "Replaced
samples" for the exception), `machine`
(the machine name, see "User config"), `meta` (`SetMeta`, or `null`), `viewOnly`, `unreadable` and `samples`
(`SampleRef[]`: `path`, `kind` `project|outside|library`, `relative`, `object`, `size`; omitted from the stored JSON
when empty so ids of sets without samples stand; the push sends it on every save, `object` and `size` as `null`
until a sample is tracked). A save either holds the document (`xmlHash`, `tree` and `side` present, `raw` absent) or the
raw file (`raw` present; `xmlHash`, `tree`, `side` and `meta` absent, `unreadable` true); an absent field is left out
of the stored JSON, so the id of a save of the document kind is the hash of the same JSON as before `raw` existed.
`Save::document()` gives `(tree, side)` when there is a document.

**Record order** (`Repo::record_save(set_path) -> Option<ObjectId>`):

1. Read the file (see "Reading under a writer") and `Daw::decode` it. A file that is not whole is the
   `DawError::Corrupt` as it came (a file caught mid-write); nothing is stored and the caller may retry. One that is
   whole but that no document can be read from is stored raw ("Unreadable files").
2. Resolve the file to `(set id, branch)`, hash the XML, and if it equals the `xmlHash` of the last entry of that
   branch's log and no sample changed ("Replaced samples"), return `None`.
3. `Daw::split`, then `mask_tree`: `Daw::mask` on each Text leaf with one side list threaded through the whole tree
   in part and leaf order (Blob leaves are never masked).
4. Into one store `Batch` ("Objects", **Durability rule**): `Batch::put_leaf` per leaf, the `TreeObject` through
   `encode_tree`, and the side list as a Blob.
5. `Daw::parse` the unmasked XML. A parse error still records the save, with `meta: null` and `unreadable: true`.
   `Daw::sample_refs` reads the references (an error is no references) and `Repo::contain_samples` applies
   containment: a `project` ref whose `relative` is absolute, contains `..` or resolves, symlinks followed, outside
   `<root>/Samples` becomes `outside` with no `relative`; one inside the project but not under `Samples/` stays
   `project` with no `relative`. `import_backups` goes through the same step.
   Then `Repo::track_samples` (`repo/samples.rs`) reads each `project` ref that still has a `relative` and a regular
   file at it through `Batch::put_reader` into the same batch, and fills `object` (the Blob or Chunked leaf id) and
   `size`. A file that is missing, not a regular file or unreadable leaves the ref `object: null` and the save is
   still recorded; a file that is not there is quiet, and any other failure to stat, open or read it prints
   `dit: could not read <relative>: <error>` on stderr. Only `Samples/` is ever read: a ref outside it, or contained out of the project, is not.
   A first read of a file of 32 MiB or more prints `dit: reading <relative> (<n> MiB)` on stderr.
   `.dit/samples.json` maps each project-relative path to the `(size, mtime in ns)` it was read at and its leaf id; a
   file with the same size and mtime is not read again. The cache is written atomically after `Batch::finish`
   (`record_save` and `import_backups` both), never for a file whose mtime or length moved during the read, and a
   missing or unparseable one is an empty cache. `import_backups` resolves refs against today's `Samples/`, so a
   backup's sample bytes are today's.
6. `viewOnly` is set when the new tree id equals the last save's tree id and every sample has the object it had:
   only masked values (ids, timestamps) changed.
7. Put the Save object in the batch, `finish` the batch, then append its id to the log.

**Replaced samples.** The skip of step 2 is for an unchanged file, and a replaced sample is a change. With the XML
hash equal to the latest save's, `record_save` still tracks the samples (cache hits cost one `stat` each) and compares
them with the latest save's by path and object id: a tracked file whose object is not the one the latest save has for
that path is changed, and the call records a save with the same tree and the new sample objects (`viewOnly` false). A
file that cannot be read now (gone, drive unmounted) is no change, so a missing sample never records a save; one that
appears after the save does (in `record_save`; `Repo::stale` checks only samples whose latest save already has an
object). A touched file with the same bytes re-hashes to the same object: nothing is recorded, and
the cache is written so it is not read again. The save's `fileUpdatedAt` is the latest of the set file's time and
the changed samples' times, or the latest save's time plus one millisecond when that is not later: the log stays in
time order, the hub's unique `(session, fileUpdatedAt)` is never hit, and this is the one case where a save's time
is not the set file's mtime. A set the latest save could not parse (`unreadable`, `meta: null`) that parses now is
recorded the same way, with the one millisecond rule. A sample that changed with its size and mtime unchanged (`cp -p`,
`rsync --times`) is invisible: the cache trusts size and mtime.

**Unreadable files.** A file that is whole (`Daw::decode` accepts it) but that no document can be split from (the
DAW module returns an error from `split`, or the `decode` is `Unsupported`) is stored as it is on disk, not refused:
`Batch::put_leaf` of the file's bytes (a Chunked leaf when large) and a Save with `raw` naming that leaf,
`unreadable: true`, `meta: null` and no `xmlHash`, `tree` or `side`. Another `record_save` of the same bytes returns
`None`; one that can read the file (the file changed, or a newer release can split it) records a normal save, whose
`xmlHash` differs from the raw save's. `Repo::stale` is always true for a set whose latest save is unreadable, so a
launch tries again. `Repo::materialise` returns the raw bytes of such a save, so checkout and restore write the file
as it was; `Repo::materialise_xml` and `Repo::diff` have no document to read and are `RepoError::NoDocument`. A file
that is not whole (`decode` says `Corrupt`) is still refused with nothing stored.

**Reading under a writer.** `record_save` reads the file through one open file and compares its length and mtime before
and after: a file that changed under the read is refused as `DawError::Corrupt` and nothing is stored, so the bytes and
the time `fileUpdatedAt` takes are one state of the file.

**Idempotency and order.** "Latest save" and "previous save" always mean the last entry of
`logs/<set id>/<branch>`, the order saves were recorded in. `Repo::saves(set_id, branch)` returns them sorted by
`fileUpdatedAt`, then `machine`, for readers; the idempotency and `viewOnly` comparisons never use that sort. A save
records the machine, so the same state saved on two machines is two saves with two ids; within one repo the same state
records once.

**Reading back.** `dit_core::materialise_xml(objects, daw, tree, side)` (in `materialise.rs`, not gated on `store`)
reads the tree with `read_tree` from any `ObjectRead`, reads the side list from the Blob at `side` (a JSON array of
strings), and `unmask_tree`s it (each Text leaf unmasked as it was masked, then joined): the original XML byte for
byte. Its
error is `MaterialiseError { Store, Daw }`. `Repo::materialise_xml(&Save)` is one call to it over the repo's store.
`Repo::materialise(&Save)` then `Daw::encode`s it into the set file's bytes.

**A commit** (`Commit`, camelCase JSON, stored as a Commit object) holds `setId`, `branch`, `save` (the save it
names), `parent` (the branch head it was made on, or `null`), `message`, `author`, `kind` (`user` or `checkpoint`) and
`at` (milliseconds since the epoch). `Repo::commit(set_id, branch, message, author, kind)` names the latest save of the
branch's log (`RepoError::NoSaves` when it has none) and moves `refs/sets/<set id>/<branch>` to the new commit. When the
branch already has a head and the head's save is in the same state as the latest save (`Save::same_state`: the same
`tree`, or the same raw bytes, and the same bytes for every sample, compared by path and object id), it is refused with
`RepoError::NothingToCommit { since }`, shown as `Nothing to commit since '<message>'.`; a branch without a head takes
its first commit even when the save is view-only. `Repo::read_commit(id)` reads one back.

**What is waiting.** `Repo::saves_since_commit(set_id, branch)` counts the log entries after the head commit's save
(all of them with no head, or when the head's save is in another branch's log); `Repo::working_changed(set_id,
branch)` is whether a commit would be accepted now (the latest save is not in the head's state, or there is a save and
no head). `dit status` reads both.

**Catching up.** `Repo::stale(set_path)` says whether recording a set file might give a save, from `stat`s alone: true
for a file no save was recorded from, a latest save that is `unreadable`, a file time that is not the latest save's
`fileUpdatedAt`, or a tracked sample whose size or mtime is not what `.dit/samples.json` read (a sample that is gone is
not stale). A save recorded for a sample alone has a time later than the file's, so that set reads as stale until its
file next changes; recording it again returns `None` and costs one decode. `Repo::catch_up()` records each stale file
`find_sets` lists and returns what each came to (`(path, Result<Option<ObjectId>, RepoError>)`; files that are not
stale are not listed): the saves made while nothing was watching, collapsed to the file's last state. The cli does not
use it: its commands record every working file every time. `Repo::newest_save_at()` is the `(set id, branch, time)`
of the working file whose latest save is newest, reading each log's last entry only.

**Time in a set.** `repo/time.rs` keeps the spans a set was open on this machine in `.dit/time/<set id>/<branch>`: one
JSON object a line, `{"start","end","source"}` (milliseconds since the epoch; `source` is `script`, `log`, `title`
or `saves`, best first), sorted by `start`. A span is named by its `start`: `Repo::upsert_segment(set, branch,
&Segment)` replaces the line with that start, else inserts, so the open span is rewritten as it grows; an `end` before
its `start` is `RepoError::BadSegment`. It takes the writer lock and writes the whole file through a temp file and a
rename, so a crash leaves the old file or the new one (a leftover `.tmp-*` beside it is ignored). The file carries no
machine name: it is this machine's, and the push stamps its own. `Repo::segments` reads it; a last line cut short (a
write something else did not finish) is dropped, any other line that does not read is an error.

`Repo::time_in_set(set, branch, from, to)` is the length of the union of the spans inside the window (overlaps count
once). `Repo::time_since_commit` is that from the time of the save the head commit names, so saves and time since a
commit read the same window. `Repo::time_by_commit` is each commit's time newest first: its window is after the
previous commit's save up to and including its own save, the window the hub sums a commit's time over; a commit from
another branch's lineage counts that branch's spans. `format_span(ms)` words a length.

`dit-daemon/src/segments.rs` is the tracker that makes the spans: a pure state machine, `Tracker::handle(Event) ->
Vec<Upsert>`, with every event carrying its time (no clock inside). Events: `Open { at, key, source }` (a signal says
the set is open), `Activity { at, key }` (a save, a script message), `Playing { at, key, playing }`, `Close { at, key
}` and `Tick { now }`; a `Key` is `{ set_id, branch }` and sets are counted independently; an `Upsert { key, segment }`
is for `Repo::upsert_segment`. The rules: a span opens on the first signal (an activity alone opens a `saves` span) and
is written at once with no length; a quiet quarter hour (`IDLE_AFTER_MS`) ends it at its last activity, not fifteen
minutes later, and the next activity opens a new span with the same source; the transport playing is continuous
activity (the script sends nothing between play and stop) so a span ends fifteen minutes after the stop at the
earliest; a better source (script, log, title, saves) takes a span over and keeps its start; a close ends it at the
close unless it had already gone idle; spans of a set never overlap, since a new one starts no earlier than the last
ended and an activity stamped inside a span already kept (a save found at launch) adds nothing; progress is written on
a tick, which the app sends at least once a minute, so a crash loses at most that minute. A tracker started after the
app was away is told the store's last span with `Tracker::resume`, which is all crash recovery needs.

**History.** `Repo::history(set_id, branch)` walks `parent` links from the branch head and returns
`HistoryEntry { id, commit, saves }` newest first, each save paired with its id. A commit's `saves` come from its own `commit.branch` log: the
entries after its parent's save (from the start when the parent's save is not in that log or there is no parent), up
to its own save inclusive. A walk from a branch therefore crosses into the commits it was checked out from, and their
saves stay folded under them.

**Checkout.** `Repo::checkout_new_branch(commit, name)` is the only command that creates a branch. It refuses a bad
name (`main` in any case included) with `BadBranchName`, a name `[branches]` already has, compared without case, with
`BranchExists`, and a branch file that exists with `BranchFileExists`. Case matters because refs and logs are files
named after the branch and macOS and Windows file names ignore it (`Main` would write `main`'s ref). The file is
`materialise` of the commit's save, created with `create_new` so an existing file is never overwritten, even in a race;
the ref is then pointed at the commit and the branch added to `[branches.<set id>]`, in that order, so a failure
removes the file and leaves only an unlisted ref behind, which never blocks a retry. It records no save: the next `record_save` of the new file does, in `logs/<set id>/<name>`
under the same set id. A first commit on that branch right away is `NothingToCommit`, since its save's tree is the
source commit's.

**Importing backups.** `Repo::import_backups(set_id, branch) -> Result<ImportReport, RepoError>` takes the branch's
working file from `sets.toml` (an unknown set or branch is `NotASet`), asks `Daw::list_backups` for that file's
copies (a branch file `Song @alt.als` has its own, `Song @alt [….als]`) and records each as a save of that branch,
oldest first, through the same `store_save` that `record_save` uses (split, mask, store, parse, build the Save; it
does not touch the log). Every backup's objects go into one `Batch`, finished before the log is written. A
backup's `fileUpdatedAt` is its `saved_at` through the same millisecond floor, moved a millisecond later while another
save of the branch (the working file's included) or an earlier backup of the import has that time, so no two saves of
a branch share one (the hub 409s a second save at an occupied millisecond, and the queue does not retry that);
`machine` is this machine. Backups are older than the live file, so they are inserted into the log, never
appended: each save id goes immediately before the first entry whose save has a later `fileUpdatedAt`, but always
before the log's last entry, whatever the backups' mtimes say (a project copied without its times gives them later
ones; a copy that tied with a save is after it). With an empty log they go in time order. The log is written once per
import. The last entry stays the newest state of the file, so "latest save" for idempotency, `viewOnly` and `commit`
keeps meaning what `record_save` needs, and live saves still append. `viewOnly` of an imported save is judged against
the save before it in the log after insertion; saves already recorded are never rewritten. A backup whose `xmlHash`
equals that of any save already in the branch's log (or of an earlier backup in the same import) is skipped, so a
second import records nothing. A copy that cannot be decoded, or decodes and cannot be split, is stored whole the way
`record_save` stores an unreadable file (`store_raw`: a save with `raw`, `unreadable: true`, no tree), and one whose
bytes are already a `raw` save of the branch is skipped as already saved. `ImportReport { imported, skipped }`:
`imported` holds the new save ids in time order (unreadable copies included) and `skipped` holds `(path, reason)` for
a backup already saved or one the disk would not read (the error text); the rest import. A failure of the store or
the log is an error for the whole call and leaves the log as it was.

**Bringing a set in.** `Repo::record_history(set_path) -> SetOutcome` is the backfill's per-set recording: the set
file as it is now (`record_save`), then its `Backup/` copies (`import_backups`) on the branch the file belongs to
(`main` for a set's own file), so the log ends in the working file's save with the copies before it in time order.
`SetOutcome { set_id, branch, current, imported, commit }` holds what it did: `current` is `None` when the branch's
latest save already held the file, `commit` is `None` here. `Repo::backfill_set(set_path, author)` is that plus the
set's one commit, `BROUGHT_IN` ("Brought into dit", kind `User`) at the newest state, made only when the branch's
head (`read_ref`) is `None`: "no head commit", not "no saves", so
a set the watcher's catch-up already recorded still gets its commit, and a set with a commit (the producer's own, or
this call's earlier run) gets none. Every step skips what is recorded, so a call on a set done before records and
commits nothing, and one cut short by a crash is simply run again. A set file that is not whole (`Corrupt`, or
changed while read) is `record_save`'s error and nothing of the set is recorded; a copy's sample bytes are today's
(`import_backups` resolves refs against today's `Samples/`).

**The match fingerprint.** `dit_core::fingerprint::file_fingerprint(path) -> io::Result<String>` is
`<size>:<sha1 hex of the first and last 64 KiB>` of a file (all of it up to 128 KiB). It is the retired scanner's
rule, ported, so a session the scanner recorded matches the file it
came from; the hub stores the string and never reads it. It is not `Save.xmlHash` and not the render fingerprint
(`dit:` + sha256, `renders/probe.rs`).

## Diffs

`dit-core/src/diff.rs` says what changed between two saves from their trees and parsed meta alone: it never reads a
leaf and never decodes XML. The core is pure and needs no feature:
`diff_trees(a: &TreeObject, a_meta: Option<&SetMeta>, b: &TreeObject, b_meta: Option<&SetMeta>) -> DiffSummary`.
`Repo::diff(&Save, &Save)` (behind `store`, an impl block in `diff.rs`) reads each save's tree with `Store::get` and
`decode_tree` and calls it with each save's `meta`. `DiffSummary` is camelCase JSON (the cli's `--json` prints it):
`tracksAdded`, `tracksRemoved`, `tracksChanged` and `sectionsChanged` (lists of names), `scalars`
(`ScalarChange { field, from, to }`) and `samplesReplaced` (see "Clauses and the summary line").

**Pairing.** Gap parts are ignored. A Track part pairs with the Track on the other side of the same `(tag, id)`,
the id being the track element's raw `Id`, which is stable across saves; a Track with no id pairs by its position
among the id-less Tracks of that tag. A Section part pairs by `(tag, position among Sections of that tag)`. A
repeated `(tag, id)` pairs by occurrence. A part on one side only is added or removed (a Section, changed); a Track
whose id changed with identical content is therefore removed and added.

**Digests.** A paired part is changed when the SHA-256 of `encode_part` (the same bytes `encode_tree` writes for it)
differs. The leaves are object ids of masked text, so a part whose only change was Live renumbering or view state
digests the same, and a view-only pair gives an empty diff.

**Naming.** A track is named from the `structure.tracks` entry of its own side's meta whose `id` equals the part id
parsed as `i64`; with no meta, no structure or no match, `<tag> <id>` (the tag alone with no id). An added track is
named from `b`, a removed one from `a`, a changed one from `b`. `sectionsChanged` holds the tag of each Section whose
digest differs or that exists on one side only.

**Scalars.** Compared only when both saves have meta (otherwise `scalars` is empty), in this order: `tempo` (the
stored string; `126` and `126.0` are the same tempo), `time signature` (`4/4`), `key` (`rootNote` and `scale` together, e.g. `C Minor`, whichever are
present), `scenes` (`scenesCount`) and `Live` (`dawVersion`). `from` or `to` is `None` when the value appears or
disappears, and that is a change. One `Scalar` enum owns each field's meta reading, name, comparison and clause.

**Clauses and the summary line.** The suggested commit message is one source in Rust, read by the cli and, as data, by
the app's panel. `summary_clauses(&DiffSummary, before: Option<&SetMeta>, after: Option<&SetMeta>) -> Vec<Clause>`
gives the parts in the order they read; a `Clause` is camelCase JSON `{ kind, text }` and `kind` (`ClauseKind`:
`tracks`, `rename`, `devices`, `tempo`, `timeSignature`, `key`, `clips`, `scenes`, `samples`, `dawVersion`,
`trackEdit`, `section`, `sampleBytes`, `more`; the first ten are the web's `DiffChipKind` names) says what the text is
about, so a panel can switch off a kind without reading the words. `summary_line(&DiffSummary, before, after)` is the
clauses joined with `, `, or `no changes`; `Repo::clauses(&Save, &Save)` is `Repo::diff` and `summary_clauses` with
each save's meta.

The words are the web's save chips' (`diffSaves` in `packages/session-diff`, `structure.ts` and the facets), row by
row: `+2 tracks` and `−1 track` (U+2212; the count is of the digest-added and -removed tracks); a track renamed is
`Old → New`; a device gained or lost is `+EQ Eight on Bass` or `−Reverb on Vox`, the first three spelled out and the
rest `N device changes` (`1 device change`); `tempo 120 → 124` (a number, so `126` and `126.0` are the same tempo and
`124.50` reads `124.5`), `time sig 4/4 → 3/4` (not `time signature`), `key A Minor → C Minor` (root note and scale as
one key, written as the set has them: the sharps spelling), `+2 scenes`, `Ableton Live 12.3 → Ableton Live 12.4`; a
side with no value reads `—` (U+2014), and a value that went away is not worded; `+3 audio clips`, `−1 midi clip`;
`+2 samples` (sample files the set references, by path). Where the web says nothing: `~Bass` for a track whose part
digest changed with no rename or device clause to say so, `~Locators` for a changed Section, and `Replaced sample
kick.wav` for each tracked sample under `Samples/` whose bytes differ though the set's tree does not (what a sample-only
save is). The order is tracks, renames, devices, `~` tracks, `~` sections, tempo, time sig, key, scenes, DAW version,
clips, sample files, replaced samples. Past five clauses the first five stay and the rest are one `and N more` (kind
`more`).

The metas add what the trees cannot, so with either meta missing there are no rename, device, clip or sample-file
clauses and no scalars. Tracks are paired between metas by the DAW's track id (by exact name, then by auto-numbered
canonical key where either has none), so a track renamed and given a device at once is `Old → New` and `+Reverb on New`,
one track; the web pairs a rename only when the devices did not change, so it would call that a removed and an added
track. A paired track whose name changed solely because its 1-based track number (or return letter) shifted when an
earlier track was added, removed or reordered (Ableton's leading `#` / default auto-numbering) is not reported as a
rename. `DiffSummary.samplesReplaced` (file
names, once each, in the later save's order) is filled by `Repo::diff`, which has the saves' sample objects, and is
empty from `diff_trees`; a sample that was not referenced before is added, not replaced, and one that could not be
read before (missing) and can now counts as replaced.

## The Ableton module

### Parsing

`parse/mod.rs` (`Ableton::parse`) reads the decoded XML into a `SetMeta` in one pass, the document held whole in
memory. It owns the `quick-xml` event loop and the stack of open tags, and hands every element (its `Path` and its
`Tag` attributes) to each `Visitor`: `fields.rs`, `samples.rs` and `structure.rs`. A
`Path` matches by pattern (`is`, `starts_with`): a tag name, `a|b` for either of two, `*` for any. Attribute values
are decoded by the module (`&amp; &lt; &gt; &quot; &apos; &#N; &#xN;`); a character reference past U+10FFFF or in
the surrogate range is left as written. A `quick-xml` error, a mismatched or unclosed element, or a document with
no root element is `DawError::Malformed`; a field the set does not carry is `null`, never an error.

Fields are read by tag path, not by first match in the document, so a clip's `<Tempo>` before the master's never
wins. Paths are under `LiveSet` (any root name):

| `SetMeta` field | Read from                                                                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dawVersion`    | `Creator` on the root `<Ableton>` (`Ableton Live 11.3.10`), else `Live <MajorVersion>`                                                                                        |
| `tempo`         | `LiveSet/MainTrack\|MasterTrack/DeviceChain/Mixer/Tempo/Manual@Value`, else its `Effective`; two decimals, no trailing zeros (`127`, `127.5`, `127.25`); digits and dots only |
| `timeSignature` | `…/Mixer/TimeSignature`: `Numerator` and `Denominator` when both are there, else `Manual` (below), rendered `n/d`; a clip's or device's `TimeSignature` is never read         |
| `rootNote`      | `LiveSet/ScaleInformation/RootNote`, index 0–11 as `C C# D D# E F F# G G# A A# B`                                                                                             |
| `scale`         | `LiveSet/ScaleInformation/Name`; a bare integer (Live 12's mode index) is dropped                                                                                             |
| `tracksCount`   | `AudioTrack` and `MidiTrack` children of `LiveSet/Tracks` (return and group tracks are not counted); `0` for an empty `Tracks`, null when it is absent                        |
| `scenesCount`   | `Scene` children of `LiveSet/Scenes`, or, when `Scenes` is absent, of `LiveSet/SceneNames` (Live 10)                                                                          |

Real sets write the master's time signature as one number in `Manual`: `(numerator − 1) + 99 × log2(denominator)`,
decoded as `numerator = v % 99 + 1`, `denominator = 2^(v / 99)` (201 is 4/4, 302 is 6/8). A value that is not a
whole number, or is outside 0–494 (denominators 1 to 16), is null.

`samplePaths` holds one path per distinct sample in document order, the first 500. It is `[]` for a set that parses
and references no samples; `null` only means the meta was never read. Every `<SampleRef>` in the document is read
from its own `<FileRef>` child (a `SourceContext` inside the ref describes the file it was made from and is
ignored). The path is the first non-empty of `Path`, `RelativePath`, the Live 10 relative path, `Name`. A Live 10
ref has no `RelativePath` value but spells the path as `RelativePath/RelativePathElement@Dir` steps beside its
`Name`; that path counts when `HasRelativePath` is `true`, `RelativePathType` is `3` and no step is empty (an empty
`Dir` is a step up, so the file's place is unknown and the `Name` is the path). `SearchHint` elements are not read.

`Ableton::sample_refs` (`parse::sample_refs`, the same visitor) lists every distinct path, uncapped, as a `SampleRef`
with `object` and `size` `None`. `kind` is the ref's `RelativePathType`: `3` `project`, `5` and `6` `library`,
anything else (or none) `outside`, the scanner's map. For a `project` ref `relative` is its `RelativePath`, else the
Live 10 element path, as written and unchecked; containment is the repo's job.

### Structure

`parse/structure.rs` fills `SetMeta.structure` for the web's diff (structure chips, skyline). It is a third `Visitor`
over the same pass, and `parse` calls its `fill` after `Fields`, because `structure.scenes` is `scenesCount` itself
rather than a second count. The master is not a structure track, and `structure` is `null` for a set with no
`LiveSet/Tracks` children. `clips` and `scenes` are always filled (the scanner never filled `scenes`); a set with
tracks and no clips has `clips: {audio: 0, midi: 0}`.

A track is a direct child of `LiveSet/Tracks` tagged `AudioTrack`, `MidiTrack`, `ReturnTrack` or `GroupTrack`; a
self-closing one has no entry. The same names recur in routing lists and frozen copies deeper down, and are never
tracks. Each entry reads:

| Field     | Read from                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `kind`    | the element: `audio`, `midi`, `return`, `group`                                                                          |
| `id`      | the track's `Id`, when a whole number                                                                                    |
| `name`    | `Name/EffectiveName@Value` directly under the track; empty when absent                                                   |
| `groupId` | the direct child `TrackGroupId`, only when ≥ 0 (Live writes -1 at the top level)                                         |
| `color`   | the direct child `Color` or `ColorIndex`, as `#rrggbb` (below); a clip's colour is never the track's                     |
| `devices` | the children with an `Id` of each `Devices` chain in the track that is not inside a rack (`parse/devices.rs` names them) |

Devices. A rack (`InstrumentGroupDevice`, `AudioEffectGroupDevice`, `MidiEffectGroupDevice`, `DrumGroupDevice`) is
listed once and its branches are never descended. A built-in device is named from the element by a display-name map
(`Eq8` is `EQ Eight`, `OriginalSimpler` is `Simpler`), else the element split on capitals. A plugin host
(`PluginDevice`, `AuPluginDevice`, `VstPluginDevice`) is named from the direct child `Name` (`PlugName` for VST2) of
its info block: `Vst3PluginInfo` is `vst3`, `VstPluginInfo` is `vst`, `AuPluginInfo` is `au`. Only direct children of
the info block are read, so a nested preset's `<Name>` (whether before or after the plugin's own `<Name>`) is ignored,
and a direct-child `Manufacturer` (before or after `Name`) is attached. `plugins` maps
each display name to `{host, manufacturer?}` and is omitted when the set names none. A plugin whose block never names
it is dropped from the chain, though it used a slot of the cap.

Clips. `clips.audio` and `clips.midi` count `AudioClip` and `MidiClip` elements with an `Id` anywhere inside a kept
track.

Colour (`parse/palette.rs`). Live's 70-colour palette as `#rrggbb` lowercase. Live 11 and later write `Color`, a
palette index 0–69. Live 10 (the root's `Creator`, else `MinorVersion`, names the major version) writes `ColorIndex`:
140–199 are palette 0–59 and 278–287 are 60–69. Any other index, `ColorIndex` from any other version, or no colour
element leaves `color` off.

Caps. 256 tracks and 64 devices per track are kept; hitting either sets `truncated: true`, which is otherwise
omitted. A track past the cap contributes no clips or plugins; `tracksCount` still counts every track.

### Masking

`mask.rs` empties the values Live rewrites on every save and keeps the originals in a side list, so a part's
hash does not change just because Live renumbered an id or moved the view. One `regex::bytes::Regex` holds both
lists as an alternation, so matches arrive in document order and the value is what sits between the quotes
(`[^"]*`):

- `Id` lists, `<Tag Id="…"`: `Vst3Preset`, `AuPreset`, `VstPreset`, `FileRef`, `RelativePathElement`,
  `WarpMarker`.
- `Value` lists, `<Tag Value="…"`: `IsContentSelectedInDocument`, `IsContentSelected`, `SelectedEnvelope`,
  `LastSelectedClipEnvelopeIndex`, `LastSelectedTimeableIndex`, `LeftTime`, `RightTime`, `LaneHeight`,
  `SelectedDevice`, `TakeCounter`, `EffectiveName`, `UpperDisplayString`.

`mask(text, side)` runs per Text leaf and appends to `side`. A value that is already empty is still pushed, so the
counts stay aligned. A value that is not valid UTF-8 cannot become a `String`, so `mask` leaves that match as it is.

`unmask(text, side)` also runs per Text leaf, on the masked leaf, and counts only matches whose value is empty: the
n-th empty-valued match takes `side[n]`, and a match that still has a value (the non-UTF-8 case) is skipped. It
returns the text and how many values it used; running out is `DawError::Malformed`. Unmasking leaf by leaf is what
makes it the exact inverse of `mask`: over the joined document, a Blob body holding `<LeftTime Value="" />` would
count as a masked value, and a match opened inside a comment in one leaf could run on into the next.

Callers never call either directly: `dit_core::mask_tree(daw, &tree) -> (Tree, side)` masks every Text leaf in part
and leaf order with one side list (Blob leaves never), and `dit_core::unmask_tree(daw, &masked, &side)` unmasks each
Text leaf from a cursor into the side list, passes Blob leaves through, joins, and is `Malformed` when values are left
over. `record_save`, `materialise_xml`, the contract suite and the sweep all go through the pair.

### Project folders

`project.rs` holds the retired scanner's rule.
`is_project_folder(dir)` is true when `dir` is an existing directory whose final name ends in ` Project`,
compared case-insensitively. `find_sets(project)` returns the regular files directly inside `project` whose
extension is `als` (case-insensitive), sorted by path; it does not recurse, so the copies under `Backup/` are
never sets, and it skips hidden files (macOS writes `._<name>.als` metadata files on some drives). A missing
folder is an `io::Error`, not an empty list.

Finding project folders under a root, and what each holds, is the daemon's (see "The daemon", "Finding projects to
bring in"); recording a project's sets is `Repo::backfill_set` (see "The repo", "Bringing a set in").

### Backups

`backups.rs` (`list_backups(set)`) lists Live's dated copies of one set from the `Backup/` folder beside it,
non-recursive; a missing folder is an empty list, any other read error is an `io::Error`. **Name rule:** a file
counts when its name matches `^(.*) \[YYYY-MM-DD HHMMSS\]\.als$` with the extension ASCII case-insensitive
(`(?i-u:als)`; digits are ASCII; the hour, minute and second are one unseparated block), built once in a
`LazyLock<Regex>`. Only files count, never folders. **Own-set filter:** the captured set name must equal the set file's stem exactly (case-sensitive), the
scanner's `backupBelongsTo` rule, because one `Backup/` folder holds every set's copies side by side, so `Song`
never picks up `Song 2`, and a set whose name has brackets (`Song [Remix]`) still matches because the pattern is
greedy up to the final stamp. **Time:** `Backup::saved_at` is the file's mtime and the stamp in the name is
ignored. The stamp is the moment Live replaced the copy, not the moment it was saved (on 2,219 measured backups it
equalled the next save's birth time 2,186 times and its own mtime never). The list is sorted by `saved_at`, ties
by path; an entry whose mtime cannot be read is left out.

### The open set and the script

`Daw` has six defaulted methods for knowing the set the DAW has open (the defaults know nothing): `app_names()`
(`["Live"]`, the window owner), `log_open_set(home) -> LogState { running, set }`, `title_hint(owner, title) ->
Option<TitleHint { set_stem }>`, `script_kit(home) -> Option<ScriptKit>`, `script_enabled(home) -> Option<bool>` and
`project_roots(home) -> Vec<PathBuf>` (the folders the DAW's settings say projects live in: Ableton's `Library.cfg`
`UserFolderInfoList`, which the app searches for repos on first launch).
Three more defaulted methods serve the app: `bundle_ids()` (Ableton: `["com.ableton.live"]`, to find the installed Live
with `NSWorkspace` and open a set with it), `track_colour(index) -> Option<&'static str>` (the palette entry as
`#rrggbb`, the same table and the same form a saved set's track metas carry, so a live track from the script, which
reports Live's colour index, is coloured as a saved one; out of the palette: none), and `device_display_name(class_name,
name) -> Option<String>` (maps a live device's internal class name through `parse::devices::display_name`, keeping the
plugin's own name for third-party hosts, so live tracks from the script match saved `.als` device names).
The types are ungated in `dit-core/src/openset.rs`: `Signal` (`Script`, `Log`, `Title`, `Saves`, best first; the
time store's `Source` is the same type), `OpenSet { path, signal, at }`, `ScriptKit { folder, files, version }` with
`install()` and `status() -> KitStatus { installed, version, current }`.

**Log files** (`openset.rs`; read from a real Live 12.4.6, formats in the module's header). `Log.txt`,
`Indexer.txt` and `Library.cfg` are in the newest `~/Library/Preferences/Ableton/Live <version>/` (versions compared
as numbers, with beta suffixes like `13.0b26` sorting before their release). The log is read from its last `info: Started: Live …` line (the tail read in doubling chunks from 256 KiB,
so a multi-megabyte log costs its last run). Running means no `Live App: GlobalExit(): Start` after that line. The set
is the last `Loading document "<path>"` (paths are absolute and unescaped) that is not Live's own: a load under
`<User Library>/Templates` is a new unsaved set (none); any other load under the User Library, or inside an `.app`
bundle, says nothing. `Indexer.txt`'s last `Configure: CurrentProject: '<folder>'` is a cross-check: stamped after the
load and naming a folder other than the set's, it means Live moved on (a temporary project for a new set) and the set
is none. The User Library is `<ProjectPath>/User Library` of the `UserLibrary` element of `Library.cfg` (a producer
may have moved it), else `~/Music/Ableton/User Library`. `title_hint` strips `.als`, a trailing `*`, ` [project]`
and ` - Ableton Live …` from the window title (Live's real title format is unverified) and answers none for the
application's bare name.

**The script** is `dit-daw-ableton/script/dit/{__init__,protocol,tracks}.py`, embedded with `include_str!` and
installed as the control surface `dit`. It only connects out to the app on 127.0.0.1 (the port and nonce from the
`port` file beside it), reads Live's object model and writes nothing to the set. It runs from `schedule_message`
ticks on Live's thread and never blocks: non-blocking sockets, one pass a tick, the track walk once every ten ticks,
reconnect after 1, 2, 4, then 5 seconds. `Song.file_path` has no listener, so it is polled each tick. It speaks the
wire in the plan's C5: `hello` (nonce, Live version, script version), then `document`, `tracks`, `song`, `transport`
and `closed` (from `disconnect`, which Live calls when the set closes), each sent when it changes and all again after a
reconnect. The app answers `greeting` and nothing else. `protocol.py` and `tracks.py` are pure Python 3.9-compatible;
their tests are `script/tests/` (`test_protocol.py`, `test_surface.py`), run by `python3 -m unittest discover -s
crates/dit-daw-ableton/script/tests` and by `cargo test -p dit-daw-ableton` (`tests/script_python.rs`, which skips
with a message when `python3` is missing). Bump `SCRIPT_VERSION` in `protocol.py` and `VERSION` in `script.rs`
together; a test checks they agree.

**The Live Extension** (`extensions/ableton/`, outside the Bun workspaces while Ableton's beta Extensions SDK tarballs
stay gitignored under `vendor/`) complements the remote script on Live 12.4.5+ / Live 13 with right-click context menu
actions and Projammr-styled modal dialogs (commit / open `dit` panel over `dit.sock`, add a note / cue point from an
Arrangement selection, and sync timestamped Projammr comments to Live Cue Points). It cannot replace the remote script
because Extensions `1.0.0-beta.1` exposes no background listeners, transport state, set `filePath`, track colours, or
device kinds.

**The listener, the window list and the chain** (`dit-daemon`). `script.rs`: `ScriptServer::start(folder, app,
Sender<ScriptEvent>)` listens on a loopback port, writes `<port>\n<nonce>` (32 hex chars from `/dev/urandom`, mode 0600) to `folder/port`, and serves each connection on its own thread: the first line must be a `hello` with the nonce,
all of it within 10 s of the connection being accepted (one deadline for the whole line, not for each read, so a
client trickling bytes is dropped too), or the connection is dropped unheard; the nonce is compared in constant time;
at most 8 connections are open at once, counting those still to say hello, and the ones past that are closed as they
arrive (`Limits` holds both numbers, which a test sets short); the app answers `{"type":"greeting","app"}`; a line over `MAX_LINE`
(1 MiB) ends the connection; lines that do not parse are skipped. `ScriptEvent` is `Connected { live, script }`,
`Message(ScriptMessage)` (`Document`, `Tracks`, `Song`, `Transport`, `Closed`) and `Disconnected`. Dropping the
server removes the port file. `title.rs`: `windows()` is `CGWindowListCopyWindowInfo` with
`kCGWindowListOptionAll` on macOS (empty elsewhere, so Linux builds); owner names need no permission, titles need
Screen Recording (`screen_recording_granted()` is `CGPreflightScreenCaptureAccess`); `is_running(windows, daw)`,
`hint(windows, daw)` (two windows naming different sets name none) and `resolve(hint, known_sets)` (a stem two repos
share names none). `openset.rs`: `Chain::report(Signal, at, Option<PathBuf>)`, `set_running(bool)` and
`current(now) -> Option<OpenSet>`: the best signal that names a set wins; a signal that stops naming one (the script's
`closed`, a Save As) is believed for `HOLD_MS` (5 s) with the last answer held before a lower signal takes over; with
the DAW not running only `Saves` counts. The chain's winner is the `Source` of the segment tracker's `Open`.

### Split and join

`split.rs` walks the document's bytes once with a hand-written tag scanner (no XML library, so every offset is
exact). A tag ends at the first `>` outside a `"` or `'` quoted value. A comment ends at `-->`, CDATA at `]]>`, a
processing instruction at `?>` and a `<!…>` declaration at its first unquoted `>`; none of these change the element
stack. A self-closing tag pushes nothing and a closing tag pops. Every part is a Gap until a boundary element opens:

| Opens under                      | Element                                              | Part    | `tag`        | `id`                                                                 |
| -------------------------------- | ---------------------------------------------------- | ------- | ------------ | -------------------------------------------------------------------- |
| `Ableton` › `LiveSet` › `Tracks` | any                                                  | Track   | element name | the raw `Id` value as written (no entity decoding), `None` if absent |
| `Ableton` › `LiveSet`            | `MasterTrack`, `MainTrack`, `PreHearTrack`, `Scenes` | Section | element name | `None`                                                               |

Gap parts carry neither. Live 10's `SceneNames` is not a boundary, so it stays in a Gap.

- **Whitespace handover.** A boundary part starts at the end of the previous markup, so the newline and
  indentation before `<AudioTrack …>` belong to the track and the Gap before it ends at the previous `>`. The part
  ends after its closing tag (or is the whole self-closing tag), and the next Gap starts there. Two boundaries back
  to back leave an empty Gap, which is no part at all.
- **Blob leaves.** A Gap is one Text leaf. Inside a Track or Section part, the body of the outermost `Buffer`,
  `ProcessorState` or `ControllerState` (after its open tag's `>`, before its `</…>`) is one Blob leaf whose `tag`
  is the element name; the Text leaves either side hold the tags and carry no tag. A blob element nested inside
  another is part of the outer body, and a self-closing or empty blob element yields no Blob leaf. No leaf is ever
  empty.
- **Malformed.** `DawError::Malformed`, never a panic: a closing tag that does not match the open element or closes
  nothing, an element still open at the end of input, an unterminated tag, quoted value, comment, CDATA or
  processing instruction, a `<` outside quotes inside a tag, a tag with no name, and a boundary element name or
  `Id` that is not UTF-8.

`join(split(x)) == x` holds for any partition, so `tests/roundtrip.rs` writes each test document as the exact tree
it must split into and asserts every part's kind, tag and id and every leaf's bytes.

### Gzip

`gzip.rs`, behind the default-on `gzip` feature. Without it (the wasm build) both directions return
`Unsupported` and the host gunzips and gzips.

- **`decode`.** An empty file is `DawError::Corrupt`, since no set is zero bytes. Other input not starting `1f 8b`
  is plain XML and passes through unchanged. Otherwise zlib's own gzip
  mode (`inflateInit2_`, window bits 31) parses the header and checks the CRC32 and length; anything short of
  `Z_STREAM_END` with all input consumed is `DawError::Corrupt`, so a truncated or concatenated gzip file
  fails rather than decoding short.
- **`encode`** rebuilds Live's own file: the header `1f 8b 08 00 00 00 00 00 00 <os>` (no flags, no mtime, extra
  flags 0; the OS byte 19 on macOS, 11 on Windows, 3 elsewhere), raw deflate through
  `deflateInit2_(level 6, Z_DEFLATED, -15, memLevel 9, Z_DEFAULT_STRATEGY)` run with `Z_FINISH` until
  `Z_STREAM_END`, then the CRC32 and the length mod 2³², little-endian. memLevel 9 is what re-creates Live's bytes
  (zlib's default is 8), and `flate2` cannot set it, so the module calls `libz-sys` directly.
- **Byte-exactness needs stock zlib.** `libz-sys`'s default `stock-zlib` feature links the system zlib (Apple's
  1.2.12 on macOS), whose output matches Live's; zlib-ng still round-trips but compresses to different bytes.
- **The OS byte** is the zlib `OS_CODE` of the machine that saved the set: 11 from Windows, and from macOS 3 up to
  Live 12.2 and 19 from Live 12.3. Re-encoding an older macOS set therefore differs from the file in byte 9 alone.

## Adding a DAW

A DAW is one crate, `crates/dit-daw-<id>`, and one line in `crates/dit-daws/src/lib.rs`. The crate implements
`dit_core::Daw` on a unit struct (see "Crates" for the methods) and depends on `dit-core` with
`default-features = false`; any C code goes behind a default-on feature, like `gzip`, so the wasm build can leave it
out. `dit-daws` forwards that feature (`gzip = ["dit-daw-ableton/gzip"]`) and depends on the module without its
defaults. The registry line is `Registry::new(vec![&dit_daw_ableton::Ableton, &dit_daw_<id>::<Type>])`, which
`expect`s the result: a duplicate id or extension is a programming error the suite reports.

**Fixtures** live in `crates/dit-daw-<id>/fixtures/`, holding one project folder (the one subfolder
`is_project_folder` accepts) with the sets inside it, each under 200 KB, and a `README.md` saying where they came
from. `crates/dit-daw-ableton/fixtures/Contract Fixtures Project/` is the example. A DAW with none fails the suite,
naming the folder it expected. At least one set should hold values `mask` takes out and blob bodies, or the mask
round trip proves nothing (Ableton's `Volatile Set.als`, pinned by a test in `mask.rs`).

**The contract suite**, `crates/dit-daws/tests/contract.rs`, is one function per check, each looping over
`registry().all()` and naming the DAW and the fixture in every assertion. It checks that:

- the id matches `^[a-z0-9][a-z0-9-]{0,31}$`, the display name is not blank and the extensions are lowercase
  without a dot;
- managed subfolders are declared, and a plain temp folder is not a project folder;
- the fixture project holds sets, each small enough to be a template, and `find_sets` on a copy with foreign files,
  a hidden file and a set under a managed subfolder finds only files the registry assigns to that DAW;
- for every fixture, `split` then `join` is the decoded document, `unmask_tree` of `mask_tree` is the document, `parse`
  succeeds, and `decode(encode(doc))` is the document. Fixtures need not re-encode to their own bytes, so the
  suite does not compare them;
- `decode` errors on an empty file and the first half of a fixture, `split` errors on the first half of a decoded
  fixture, and `parse` errors on an empty, half and 64-byte garbage document; garbage `decode` and empty or garbage
  `split` only have to return, because a module may pass unrecognised bytes through as a plain document. Every call
  runs under `catch_unwind`, so a panic is reported as one;
- `list_backups` on a copy of the project with no backup folder is empty.

**The sweep**, `crates/dit-daws/tests/sweep.rs`, runs the round trips over real sets. With `DIT_FIXTURE_SETS` naming
a folder it walks it recursively, following no symlinks, opens files for reading only, and for every file a
registered DAW claims counts decode, split and parse failures (a set Live is mid-write on is normal) and exact
joins, exact unmasks and re-encodes equal to the file bytes with byte 9, the gzip OS byte, ignored. It prints one
summary line per DAW and fails on a set that decodes but does not split, or whose join or unmask is inexact,
listing the files; decode and parse failures are only counted, but a panic in either fails it too. Unset, it prints a line and
passes.

```bash
DIT_FIXTURE_SETS=~/Documents/Ableton cargo test --release -p dit-daws --test sweep -- --nocapture
```

Always `--release`: over a few thousand sets a debug build takes hours, a release one about 25 minutes.

## The daemon

`dit-daemon` is what the dit app runs: `Daemon` (`daemon.rs`) is one state machine, `on_event(Input)`, that owns every
repo mutation the app makes (saves recorded when a file settles, checkpoints, segments, adopting) and answers on a
`Sender<DaemonEvent>`. Time comes from an injected `Clock` (`now_ms`; `SystemClock` in the app, a settable fake in
tests) and the DAWs from the `Registry` in its `Config { registry, home, repos_file, clock, lock_wait }`, so a test
drives it with `on_event`/`tick` and a fake DAW, no thread and no filesystem watcher. `runner::start(config, Options)`
puts it on one worker thread (the repo's advisory lock is per open file description, so one thread must own the
mutations; cli commands that arrive through the socket take the lock like any process and wait) with a ticker (1 s),
a poller (5 s: `Daw::log_open_set` and `title::windows()` become `LogPolled` and `WindowsPolled`), the script
listener (when `Options::script_folder` is set), the watcher and, with `Options::hub` and `Options::renders`, the render
engine (see "Renders"), and returns `Running { send(Input), events(), fswatch(), push(), hold(), release(), sign_in(),
wake(), renders(), accept_render(), reject_render(), render_control(), stop() }`; every helper thread wakes at least every 100
ms to check for the stop.

**Inputs** (`event.rs`): `Fs(FsEvent)`, `Script(ScriptEvent)`, `LogPolled(LogState)`, `WindowsPolled(Vec<Window>)`,
`Tick`, `AddRepo(path)` (a repo made elsewhere, as by `dit init`), `Adopt(folder)` (the producer accepted the adopt
offer: `Repo::init`, list it, track it, record its sets as `Origin::Adopt`), `Decline(folder)`, `Stop`.

**Events** (`DaemonEvent`): `SaveRecorded { repo, set_id, branch, file, save, at, unreadable, origin }` (`origin` is
`Watch`, `CatchUp` or `Adopt`; `at` is the save's time), `Committed { …, kind, message }` (checkpoints),
`OpenSet(Option<OpenSetInfo { path, signal, repo, set_id, branch }>)`, `LiveRunning(bool)`, `Script(ScriptEvent)` (the
script's messages passed on as they came, for the live skyline), `AdoptOffer { folder, set }` (the open set is in a
project folder dit does not track and the producer has not declined; once per folder), `RepoTracked`,
`RepoUnreachable { repo, message }`, `RepoBusy` (locked for over a minute), `GaveUp { repo, file }` (torn for ten
minutes), `RepoError { repo, message }` and `Render(RenderEvent)` (a render's card changed, see "Renders").

**The watcher** (`fswatch.rs`). One notify 8.2.0 `RecommendedWatcher` (FSEvents, inotify) fans events out by path
prefix: `Fswatch::subscribe(prefix, filter, Sender<FsEvent>) -> Subscription` (dropping it ends it). `FsEvent { path,
removed }` is one per path (a rename's two paths are two events, the `from` side `removed`); reads are not events. It
watches the smallest set of roots covering the subscribers: a subscriber under a watched root adds nothing, one above
existing roots replaces them (once, never in a loop, since FSEvents mishandles watch/unwatch churn), so two
streams over overlapping trees never deliver an event twice. The filter runs on the watcher's thread before anything
is queued. The daemon subscribes each repo folder (filter: not under `.dit/`); the render watcher subscribes to the
home folder through `Running::fswatch()` with its own filter and receives only what that accepts.

**Dirty paths** (`settle.rs`). A top-level file with a set extension (not `._*`) arms a `Settle` on any event, including
the removal half of Live's rename-then-create; a path under the repo that a latest save's `samples` names (an index
rebuilt after each recorded save) arms one for the sample; everything else, including `.dit/`, `Backup/`, `Freeze/` and
unreferenced `Samples/` files, is ignored. `Settle::new(rule, now)`, `event`, `observe`, `defer`, `check(now, probe)
-> Verdict { Ready, Wait, GaveUp, Gone }` and `tear` are pure. `Rule::Decode` (a set): check 2 s after the last event
(never later than 10 s after the first of a burst, so a stream of events cannot starve it), then the file must
`Daw::decode`; a torn file is looked at again after 2, 4, 8, 16 and 30 s, then every 30 s, and given up after 10 min.
`Rule::Stable` (samples, and renders, see "Renders"): `(size, mtime)` must be the same at two looks 5 s apart. A check that
finds the file gone drops the path (a later event re-arms it). A recording that comes back `Corrupt` (the read changed
under it) steps the same ladder; `Locked` is retried every 5 s for a minute, then `RepoBusy` and every 30 s. Each
repo is opened with `Repo::with_lock_wait(Config::lock_wait)` (2 s in the app) so a long hold by another writer does
not pin the worker.

**Launch and catch-up** (`Daemon::launch`, `catchup.rs`). The repo list is `dit_core::RepoList` (`repos.rs`):
`repos.toml` beside `config.toml` with `repos`, `declined` and `bootstrapped`; `RepoList::update(path, f)` holds a lock
file for the read-modify-write, since `dit init` (which adds the repo it makes) and the app both write it. The first
launch searches each `Daw::project_roots(home)` (Ableton: the `UserFolderInfoList` of `Library.cfg`) to depth 3 for
folders with `.dit/config.toml` (not inside repos, hidden folders or the DAW's managed subfolders) and adds them;
`bootstrapped` makes that once. Each listed repo is opened (one that cannot be is `RepoUnreachable` and stays listed),
its last tracker spans handed to the tracker (`Tracker::resume`), and `Repo::catch_up` records a save, at the file's
mtime, for each stale set and registers a set that appeared while the app was away (`Origin::CatchUp`, not counted as
activity). A set torn or locked at launch goes to the watcher's ladder. `Repo::working_file(path) -> (set, branch)`
resolves a set file for the open-set chain.

**Finding projects to bring in** (`backfill/discover.rs`). `find_projects(root, daw, cancel, on_found) -> Vec<PathBuf>`
walks `root` at any depth (the catch-up's depth-3 search is for repos dit made; a producer's projects can sit deeper),
hands each project folder (`Daw::is_project_folder`) to `on_found` as it is found, and returns them sorted. A project
folder is a result and is never searched inside, so a ` Project` nested in another is not offered; `root` is searched
whatever it is called and is itself a result when it is a project folder. Not entered: hidden folders and the names
of the render rules (`renders::rules::is_excluded_name`: `Library`, `Application Support`, `Trash`, `node_modules`,
stem folders, sync placeholders) and the DAW's managed subfolders. The one carve-out is `Ableton`, which the render
rules exclude as Live's library folder: projects live there too. A symlink to a folder is followed once, by its
canonical path, so a loop ends and a project reached twice is found once. `cancel` is read before each folder; set,
the walk returns what it has. `project_facts(folder, daw, &RepoList) -> io::Result<ProjectFacts>` reads one folder:
`sets` (`find_sets`), `bytes` (the apparent size of everything under it, symlinks not followed, `.dit/` left out),
`newest` (the latest mtime over the sets and their `list_backups`, in milliseconds; `None` with no set), `already`
(the canonical path is on the `RepoList`, or the folder holds a `.dit/`) and `synced_by`. `synced_by(path)` names the
sync service a path sits in (iCloud Drive, Dropbox, Google Drive, OneDrive, Box) from where each keeps its folder on a
Mac; the app's "synced by another service" warning and the backfill's per-folder doubt both read it.

**Checkpoints** (`checkpoint.rs`). After each recorded save and, once a minute, for every set the session has seen
open: a branch with a head commit and 10 saves (`saves_since_commit`) or 2 h (`time_since_commit`) since it gets a
`CommitKind::Checkpoint` commit by `dit`, `checkpoint · 2h 14m` (the open time since the head, whichever rule fired;
`format_span`). No head commit, no saves or neither rule fired is `NotDue`; due but the latest save is unreadable or
equals the head's state (ten view-only saves: `NothingToCommit`) is `Declined` and not tried again until another save
lands; a locked repo is `Busy` and tried later.

**Open set and time.** `Input::Script`, `LogPolled` and `WindowsPolled` and the newest save feed the open-set `Chain`
(see "The open set and the script"; DAW running is the script connected, else the window list, else the log's run).
When the winner changes, `OpenSet` is emitted and the tracker is told: a winner that is a script, log or title signal
resolved to a tracked set is `Open` (its source), the previous set `Close`; a `Saves` winner, a held answer (the script
just said `closed`) and no winner open nothing, so the saves of a closed Live never count as open time. Script
messages are activity (the transport is `Playing`), a recorded save from the watcher is activity, and the tracker's
spans are written with `Repo::upsert_segment` on every change and tick; one the repo was too locked to take is kept and
retried each tick.

**Tests.** `daemon.rs` drives `on_event`/`tick` with a fake DAW (`test_support.rs`: marker-prefixed files, masked
`id="n"` values, `<sample rel="…"/>` refs) and a fake clock: rename-then-create, a file gone at the check, a burst
capped at 10 s, the torn ladder and give-up, a replaced sample (and an unreferenced one ignored), a growing sample, a
locked repo through `RepoBusy` to recorded, a restart after a crash with the sample cache gone, catch-up and new sets,
first-launch bootstrap, an unreachable repo, checkpoints (none before the first user commit; 10 saves; unreadable),
the script's open set becoming a segment, the adopt offer, adopt, and ignored paths. `tests/watch.rs` runs the real
event stream (FSEvents or inotify): a subscriber sees a created file, and a running daemon records a rewritten Ableton
fixture set. They are written not to flake (deadlines of 8 to 60 s; the end-to-end test rewrites the set with a new tempo
every 8 s until a save is recorded, because an event written before the stream is live is lost) and skip, saying so, when
the platform will not start a watcher or `DIT_SKIP_FS_TESTS` is set; they are gated to macOS and Linux.

## The cli

`crates/dit-cli` is the `dit` command line (`clap` derive), a library and a binary. `src/lib.rs` holds the command
tree, `run` (dispatch) and the process entry `main_process`; `src/main.rs` only calls it. `src/commands.rs` is one
function per command returning a serialisable result, `src/output.rs` the text and JSON of those results, and
`src/context.rs` the `Context`; every call into the repo is `dit-core`'s `Repo` API and `dit_daws::registry()`.
`--json` is global. With it a command prints its result as one line of JSON; errors still go to stderr as text.

**The `Context` seam.** A command never reads the process's environment, writes to its stderr or opens the
Keychain directly — all of those come through `Context { env: Env, err: &mut dyn Write, remote: &dyn RemoteSource,
renders: Option<&dyn RenderControl>, backfill: Option<&dyn BackfillControl> }` (the exception is `dit-core`'s
sample reader in `repo/samples.rs`, which writes large-file and unreadable-sample notices directly with `eprintln!`).
`Env` (from `dit-ipc`) is `DIT_AUTHOR`, `USER` and `DIT_MACHINE` as the requester had them; `err` is where
warnings and the sign-in code go, so stdout stays the result alone; `RemoteSource` (`Send + Sync`) gives the user
config's path, the token store (`TokenStore` is `Send + Sync` too) and `open()`, the signed-in `Remote`. `SystemRemote`
is the terminal's: the default config path and the Keychain. `run` returns `Done { text, refusal }` or a `CliError`;
`finish` turns either into the `dit_ipc::Done { stdout, code, refusal }` that is printed locally and sent over
the socket, so the text, `--json` bytes and exit code are one code path. `handle(run, err, remote, renders, backfill)`
is the entry the app's `Handler` calls: it parses the argv with the same `Cli` and runs it with the app's own
`RemoteSource` and, in `Context::renders` and `Context::backfill`, its render engine (`dit renders` asks that instead
of the ledger; see "Renders") and its backfill run (`dit backfill` runs through it; see "The backfill"). The
machine-name lookup that names a repo's saves can warn (a config that does not load) from inside a save, which cannot
borrow `err`, so the warning is held in the context and written by `flush_notes` after each save.

**Commands.** All run from the project folder or one folder inside it (`Repo::open` looks at the current folder and
its parent).

- `dit init`: the current folder, or its parent when that is the project folder (`registry().for_project_folder`
  picks the DAW; none is `Not a Live project folder.`). `Repo::init`, then a save of every `daw.find_sets(root)`.
  Run again it opens the repo and records what changed. It also adds the repo to the app's list (`repos.toml`, see
  "The daemon"); a list that cannot be written does not fail `init`.
- `dit status [<set>]`: one row per working file, sorted by file. With no `<set>` it first records every set file
  `find_sets` returns, so a set saved into the project since the last command joins as a new set. Each row also
  carries `pendingSaves`, `pendingCommits` and `pendingSamples` from one `pending` call matched by `(set id, branch)`;
  status stays offline. When the push-samples setting has been heard (see below) it ends with `samples: pushed`,
  `samples: pushed (instance)` or `samples: local only` (JSON `samples`: `pushed`, `instance`, `localOnly`); a repo
  that has never heard it prints no line and has no `samples` key.
- `dit log [<set>]`: `Repo::history` of the set's branch, newest first.
- `dit commit [-m <message>] [--no-push] [<set>]`: commits the working file's latest save as a `User` commit. The
  author is `DIT_AUTHOR`, else `USER`, else `unknown`. With no message it is `summary_line` of the change from the
  branch head's save to the latest save (the same line `dit diff` prints first), `Initial commit` when the branch has no
  head (`INITIAL_COMMIT`; the spec names no first-commit suggestion, so `initial_clauses()` gives it as one
  `ClauseKind::Initial` clause for the panel, and the cli uses the same constant), or `Unreadable save` when either save
  holds its file whole and there is nothing to compare. Unless `--no-push` is
  given it then pushes the committed set (`PushOptions { set, project: None, skip_samples: true }`; a first push binds
  to the only project). The push is a try: whatever it does, the commit stands and the command exits 0, with `pushed`
  or `pushError` in the JSON (see "Pushing"). It runs the set phase only; when the push worked and the repo's setting
  asks for samples the commit still has to send, it ends with `samples pending, run dit push` (JSON
  `samplesPending: true`).
- `dit push [<set>] [--project <name>]`: `<set>` is resolved like any other, and naming any file of a set pushes the
  whole set; with none every set is pushed. Errors exit 1 with the `PushError` line. `src/push.rs` opens the remote
  through `RemoteSource::open`: it loads the user config, returns `No instance to sign in to.` when it names no
  instance without touching the token store, else takes the token store and `Remote::open`.
- `dit config push-samples [on|off]`: `src/config.rs`. Alone it prints the setting from the cache in `.dit/config.toml`
  (below), offline; a repo that has never heard from its hub is `samples: local only`. With `on` or `off` it
  `PATCH`es `/repos/:id { pushSamples }` through `dit_core::remote::set_push_samples` (the hub is the record; last
  write wins), caches the hub's whole answer and prints it. `set_push_samples` takes the way to open the remote
  (`cx.remote.open`) and calls it only after the repo's binding is read, so an unbound repo is refused before the remote
  (and the keychain) is touched (`This repo has not been pushed yet. Run dit push first.`); an editor-only refusal prints the hub's own line and
  caches nothing. `samples: pushed` is the repo's switch, `samples: pushed (instance)` the instance forcing it for
  every repo, `samples: local only` neither. Anything but `on` or `off` is a usage error.
- `dit remote set <url>`: `src/remote.rs`, `dit_core::remote::rebind` with `cx.remote.open` (see "Pushing", "Moving the
  binding"). Prints `This repo pushes to <url> now, not <old>: <n> sets moved.` or `This repo already pushes to
<url>.`; errors exit 1 with the `RebindError` line.
- `dit diff [<a> [<b>]] [--set <name>]`: `Repo::diff` between two saves. With no ids it lazy-saves the target working
  file (`--set` names it as `<set>` does) and compares the branch head's save to the latest save; a branch with no
  commit is `` `<file>` has no commits yet. ``. With `<a>` it compares that save to the latest save of the working
  file it was recorded from, saving that file first, and `--set` is ignored. With `<a> <b>` it compares the two and
  records nothing.
- `dit save [<set>]`: `Repo::record_save` of the target working file, printing the new save's short id or
  `No change`. A file that does not decode is an error here, not the lazy-save warning. With no `<set>` it takes the
  working file modified last on disk (the recorded saves cannot know which file Live wrote last).
- `dit checkout <commit> -b <name>`: `Repo::checkout_new_branch` writes the commit's save as `<stem> @<name>.<ext>`
  beside the set's file and points the new branch at the commit. `-b` is required. Prints the new file's path; no
  save of it is recorded until the next `status`, `commit` or `save`.
- `dit restore <commit> [--name <branch>]`: `<commit>` is the commit's id on the instance (a number, as `GET
/commits/:id` takes it), not a hash prefix. Looks in the repo `cwd` is in, then in `repos.toml` (beside the user
  config), for the one bound to the commit's hub repo with its set (`remote::restore`, see "Restoring a commit from
  the hub"). Prints `Restored as branch <name>: <file>`; JSON is `Restored`. `Fetching from the hub…` and `Writing the
file…` go to stderr. It is the cli face of the app panel's restore and needs a sign-in like `push`.
- `dit time [<set>]`: how long each working file's set was open, from the spans in `.dit/time` (see "Time in a set"):
  `<file> (<branch>): <total> in the set, <since> since the last commit` (`no commits yet` with no head), then
  one `  <8 hex> <message>  <span>` per commit, newest first. Spans read `2h 14m`, `41m`, `2h` or `<1m`
  (`format_span`). It records nothing and needs no app: with none running there are no spans and every figure is
  `<1m`; a running app's open span lags by up to its last minute. `<set>` is resolved like any other.
- `dit script install|status`: the control-surface script of each DAW that has one (Ableton: `script_kit`).
  `install` writes its files and a `VERSION` marker into `<User Library>/Remote Scripts/dit` (the User Library from
  `Library.cfg`, else `~/Music/Ableton/User Library`), each through a temp file and a rename, leaving a file that is
  already as shipped alone (`wrote N files`, or `already up to date`) and the app's `port` file untouched; it says to
  restart Live when Live is running. `status` says installed, current (the version and every file as shipped) and
  whether Live's last run had it switched on (`Control Surface="dit"` in the last group of `MidiRemoteScript` slot
  lines of `Log.txt`; `unknown` with no Live log); connected is `needs the dit app`. Neither touches Live's own files.
- `dit login [<url>]`, `dit logout`, `dit whoami`: sign this machine in to an instance, end its session, and say who
  it is signed in as (see "Signing in"). They run anywhere, not only in a project folder.
- `dit renders [accept <id> [--set <session>] | reject <id> [--never-here]]`: the audio renders the app found (see
  "Renders"). They run anywhere, not only in a project folder. The list is one line per render not rejected, `<id>
<state> <name> (<N files>, <size>)`, or `No renders.`; with no app answering it is read from `renders.json` and ends
  with `The dit app isn't running; this list may be out of date.` (on stderr under `--json`, which prints the array of
  cards). `accept` has the app upload in the background, or with no app uploads here (`Uploading <file>…` on stderr)
  and prints `Added <name> to session <n>.`; `reject` prints `Rejected <name> as not a bounce.`
- `dit backfill [--in <root>...]`: with no folder, lists the project folders found under the roots (`--in`, repeatable,
  else each DAW's `project_roots` and `~/Music`; roots that do not exist are skipped, a folder reached twice is listed
  once), newest save first: `<path>  <n> sets  <size>  last saved <d Mon yyyy>`, with the home folder as `~` and ` ·
already in dit` or ` · synced by <service>` after it, or `No Live projects found.`. `--json` is the array of
  `{path, sets, bytes, newest, already, syncedBy}`. Sizes are 1024-based with one decimal (`2.3 GB`, the unit of the
  hub's caps), dates are UTC.
- `dit backfill <folder>... [--project <id>]`: brings those project folders in (see "The backfill"). Each argument must
  be a project folder of a DAW; a folder already in dit (on `repos.toml`, or holding a `.dit/`) is skipped with a note
  (`Everything here is already in dit.` when none is left), except a folder the stopped run in the state file still
  holds, which is that run being resumed. The project is `--project`, else the last backfill's, else the account's only
  one (`You're in several projects (A 3, B 5). Run dit backfill --project <id>.`; an explicit id the account is not
  in is `You're not in project <id>.`; all read from `GET /me/projects`). The command then Checks each folder
  (`Reading <folder> · <n> sets`; an unrecordable set, or one stored whole, is noted), reads the hub's candidates and
  tracks, proposes each set's target as the app's window will (`<set> matches '<session>'`), asks the storage check
  (`Needs 8.4 GB of your 31 GB left.`, or `Needs 14.2 GB. No storage limit on this instance.`; over the room left it
  refuses with `These folders need <X> and you have <Y> left. Run it again with fewer folders.` and removes the
  `.dit/` folders Check made, as does any other failure before the run starts), builds the `Plan` (folders newest save
  first, `created_dit` from Check) and runs it through `Context::backfill` when the app answered, else through a
  `Control` of its own over `Driver::new(Config::new(recorder, backfill.json, repos.toml))` in the terminal; both read
  one state file, so the same command resumes a stopped run whichever of them stopped it. Progress is on stderr, one
  line when a folder starts reading, at its first and last commit, at each tenth of its upload (`<folder>: uploading
3.1 of 8.4 GB`), once per wait for the hub and on a failure. A stderr that cannot be written to is the client having
  hung up (the socket's frames fail once it has gone): the command calls `BackfillControl::pause` once and the run
  stops after the step it is in, so Ctrl-C through the app is a pause. The result is on stdout: `brought in <folder>:
8 sets, 37 saves, 2.3 GB` per folder done, `failed <folder>: <reason>` per folder that failed, `paused; run the same
command to carry on` for a paused run, and `history goes back to March 2019: 3,412 saves across 266 sets in 41
projects` once anything is done. A paused run (or a refused sign-in) and any failed folder exit 1 after the result
  (`<n> folders could not be brought in.`); another run on the machine is `A backfill is running on this machine
already…`.

**Id prefixes.** `diff`'s and `checkout`'s ids are prefixes of the lowercase hex of an id, at least 4 characters
(shorter is ``Id prefix `<p>` is too short.``). They resolve across every set and branch: `diff` over each
branch's commit history (a commit stands for the save it names) and save log, `checkout` over commits only. Two
distinct ids starting with the prefix is ``Ambiguous id `<p>`.`` (a commit and the save it names count as two);
none is ``No commit or save `<p>`.`` (``No commit `<p>`.`` for `checkout`).

**`<set>`** names a working file: a `[sets]` or `[branches]` entry whose file name, with or without its extension,
equals the argument (`Song`, `Song.als` and `Song @alt` each pick one file). The entry is a `(set id, branch)`. No
match, or more than one, is an error that names the argument. With no `<set>`, `log` and
`commit` take the only working file, else the one whose latest save has the greatest `fileUpdatedAt`; a repo with no
saves to choose from is `No sets in this repo.`

**Lazy saves.** No app is needed to record saves. `status` records a save of each working file it reports, and
`commit` records one of the file it commits (of every candidate first, when it is choosing the default, so a file
Live just saved can win). `log` records nothing. `record_save` returning `None` is an unchanged file. A file that
does not decode (Live is mid-write) or is missing is `warning: <file>: <error>` on stderr, and the command goes on
with the saves already recorded.

**JSON.** Ids are 64 hex chars, a save's being its id in the save log; times are milliseconds since the epoch.

```text
init    {root, daw, sets: [{setId, file, branch}]}
status  {sets: [{setId, file, branch, savesSinceCommit, workingChanged, pendingSaves, pendingCommits, pendingSamples}], samples?}   samples = pushed|instance|localOnly, absent until heard
log     {commits: [{id, message, author, at, kind, saves: [{id, at, viewOnly}]}]}     save at = fileUpdatedAt
commit  {id, message, diff, pushed?, pushError?, samplesPending?}                     diff = DiffSummary, null for a first commit; pushed = a push's PushReport, pushError its message; both absent with --no-push; samplesPending only when true
push    PushReport {bound?, branches: [{setId, branch, saves, commits, objectsStored, objectsKnown, objectsClaimed, samples?}]}   bound = {project, repoId}, left out when the repo was already bound; samples = {commits, objectsStored, objectsKnown, objectsClaimed}, left out when the sample phase did nothing; a push the storage cap ended prints this for what it sent, then exits 1
config  {samples}                                                                     pushed|instance|localOnly
diff    DiffSummary                                                                   {tracksAdded, tracksRemoved, tracksChanged, sectionsChanged, scalars, samplesReplaced}
save    {id}                                                                          id = null for no change
checkout {file, branch, setId}                                                        file relative to the project folder
time    {sets: [{setId, file, branch, totalMs, sinceCommitMs, commits: [{id, message, ms}]}]}  milliseconds the set was open; commits newest first
script  {scripts: [{daw, folder, version, installed, current, written?, enabled, running}]}   written only for install; enabled = null when the DAW's log cannot say
login   {instance, machine, user: {id, name, email}}                                  whoami prints the same
logout  {instance}                                                                    instance = null when nothing was signed in
backfill (list)  [{path, sets, bytes, newest, already, syncedBy}]                              newest = ms | null; syncedBy = service | null
backfill <folder>...  {folders: [{path, state, sets?, saves?, bytes?, error?}], summary: {firstSave, saves, sets, projects}, paused}   state = done|failed|paused|waiting; sets, saves, bytes for done, error for failed; firstSave = ms of the oldest save | null
```

`savesSinceCommit` counts the log entries after the head commit's save (all of them with no head, or when the head's
save is in another branch's log). `workingChanged` is true when the latest save's tree differs from the head
commit's save's tree, or there is a save and no head.

**Text** is plain and git-like, without colour: `status` is one line per file
(`<file> (<branch>): <n> saves since the last commit, changes to commit`, plus `, <n> saves and <n> commits to push`
when either is non-zero, plus `, samples pending` when commits' samples wait, and a last `samples: …` line when the
setting is known), `log` one `<8 hex> <message>` line per commit with an indented `save <8 hex>` line under
it per folded save, `commit` is `[<branch> <8 hex>] <message>`, then (unless `--no-push`) `Pushed to <host>.`, or
the push's error line followed by ` The commit is kept here; run dit push to send it.` (no such note after `Can't
reach` or `took too long to answer`, which say so already). `push` prints `Bound this repo to <project> on <host>.` when it bound the repo, then
`<main file> (<branch>): <n> saves, <n> commits, <n> objects uploaded (<n> new to the hub)` per branch that sent
saves or commits (`uploaded` is `objectsStored + objectsKnown`, `new to the hub` is `objectsStored`: an object the hub already
held for another repo is uploaded but not new; `, <n> already on the hub` follows when the hub linked objects without
an upload), then `<main file> (<branch>): samples of <n> commits, <n> objects uploaded (<n> new to the hub)` for the
sample phase (only when some commit had sample objects), or `Everything is pushed.` A push the storage cap
ended prints those lines for what it sent, then `<hub's refusal> The commits are on the hub; dit push sends the
samples when there is room.` on stderr and exits 1 (no `Everything is pushed.`). A `login` that replaced a session the
instance did not end prints `warning: the previous session may still be open on the instance: <error>` to stderr.
`diff` is the summary line (the same line `dit commit` takes as its default message), then a line per non-empty list
(`Added: …`, `Removed: …`, `Changed: …`, `Sections: …`, `Replaced samples: …`) and
one `<field>: <from> → <to>` per scalar, or `No changes.`; `save` is the 8-hex id or `No change`; `checkout` is the
new file's path; `login` and `whoami` are `Signed in to <host> as <name> (<email>) on <machine>`, `logout` is
`Signed out of <host>` or `Not signed in.`

**Errors** print one line to stderr and exit 1: `Not a dit repo. Run dit init in a Live project folder.`
(`RepoError::NotARepo`), `Nothing to commit since '<message>'.` (`RepoError::NothingToCommit`), and every other
`RepoError` as its own text.

`crates/dit-cli/tests/cli.rs` runs the built binary in temp copies of the Ableton contract fixture project,
rewriting a set's tempo with `Ableton` to make a change. `tests/socket.rs` runs it against a `dit-ipc` server
that answers with `handle`: the bytes match a local run, the requester's environment is the one used, a dead socket
file runs locally, and an app of another protocol version stops the command.

## The local socket

`crates/dit-ipc` is the one way `dit` and the dit app talk, and it is why the app can be the only process that
touches the Keychain: while it runs, the cli hands it the command line and prints what comes back. No token ever
crosses the socket; the app opens the Keychain itself. `protocol.rs` is the wire, `client.rs` and `server.rs` are
`cfg(unix)` (other platforms have the wire and nothing to connect with, so the cli still builds there and always runs
locally).

**Where.** `dit_ipc::default_path()` is `dit/dit.sock` in the config folder, beside `config.toml`:
`~/Library/Application Support/dit/dit.sock` on macOS. A path past the platform's socket limit (103 bytes on macOS) can
hold no listener, so a client treats it as nothing listening. Tests pass their own short path (`/tmp/...`).

**Wire.** One JSON object per line. A request is `{"v":1,"id":n,"cwd","env":{"DIT_AUTHOR","USER","DIT_MACHINE"},"argv":[…]}`
(the arguments after `dit`, `--json` included) or an op, `{"v":1,"id":n,"op":"ping"|"show-panel"}`. The answer
carries the request's `id`: any number of `{"stream":"stderr","text"}` frames as the command runs (so `dit login`
shows its code while it waits), then `{"done":{"stdout","code","refusal"}}` for a command, `{"ok":true}` for an op,
or `{"error":"…"}` for a request that was not run. A server answers a request of another `v` with `error`, never
runs it. One connection takes requests one after another.

**Client.** `Client::connect(path)` is `None` when nothing listens (no socket, a socket file nobody listens on, a path
too long for a socket) and an error for anything else. `run(Run, &mut dyn Write)` streams stderr into the writer and
returns the `Done`; `ping` and `show_panel` are the ops, which wait at most `OP_TIMEOUT` (3 s, `with_op_timeout` sets
another) for the app and otherwise fail with an `IpcError::Io` whose source is `io::ErrorKind::TimedOut`, so a second
launch does not hang on a wedged first one; `run` waits as long as the command takes. The cli connects first and runs the command itself only on
`None`; a refused request (the app speaks another protocol version) or a lost connection is the command's error, never
a reason to run it locally, because a command run here while the app is up would touch the Keychain and the repos.

**Server.** `Server::claim(path)` takes the instance lock, `dit.sock.lock` beside the socket (`File::try_lock`, held for
the process's life), and binds. `None` means another instance holds the lock: the caller is a second instance and
sends `show_panel` to the first, then exits. The lock winner owns the socket path outright: whatever file is there is a
crashed instance's and is replaced, not probed. The socket is made inside a staging folder only the user can enter, set
to mode 0600 there and renamed into place, so there is no moment at which another user could connect. `serve(Arc<dyn
Handler>)` answers on a thread of its own, a thread per connection, until the returned `Serving` is dropped, which
stops accepting, removes the socket and then releases the lock. A `Handler` has `run(Run, &mut dyn Write) -> Done` (its
stderr writes become frames at once) and `show_panel()`; the app's `run` is `dit_cli::handle`.

**A command that outlives its reader.** The server writes each stderr frame as the command produces it and a write
that fails ends the connection, so a command that keeps going after the client has gone (`dit backfill`) finds out
from its own stderr: `Context::tell` reports whether a line was written, and a backfill that learns nobody is
listening pauses its run. No protocol change carries it.

## Signing in

`dit_core::remote` (the `remote` feature) signs a machine in to a Projammr instance and is the connection every
later hub call goes through. A sign-in holds a session token, never a password, and the token lives only in the token
store: it is in no config file, message or output (`Token`'s `Debug` prints `Token(..)`).

**User config.** `UserConfig` is `dit/config.toml` in the platform's config folder (`~/Library/Application Support`
on macOS), with `instance` (an origin) and `machine`. The machine name (`dit_core::machine::name`) is the config's
`machine` if non-empty, else `DIT_MACHINE` if set and non-empty, else the host name; it is the device name `dit login`
sends, and the name the CLI records saves under. `dit login` writes only the instance: `machine` is in the config
only when someone put it there, so `DIT_MACHINE` keeps working after a sign-in. The CLI gives a repo the name through
`Repo::with_machine(lookup)`, and the repo asks only when it records a save, so `log`, `diff`, `checkout`, `remote set`
and a `status` that records nothing never read the user config. A config that does not load (bad TOML, a bad instance)
is one warning on stderr, naming the file and the error, and the saves of that command are recorded under
`machine::name(None)`; it never fails a local command. `Instance::parse` takes an `http://` or `https://` address down to its lowercased origin, so a pasted page URL
works; an address without a scheme, or with credentials in it, is refused. The instance is the web client's origin,
which serves the API under `/api`.

**HTTP.** `Client` is a `ureq` agent that sends `X-Device-Name: <machine>` on every request, and `X-Machine-Id: <id>` once it has one (`Client::with_machine_id`; `Remote::open` reads it from `UserConfig.machine_id`, a malformed one is none). A request without a body
may take 30 s; finding the host's address and connecting to it may take 10 s each; a request that carries a body, JSON
or bytes, may take `upload_timeout(bytes)`: 2 minutes and a second for each 64 KiB of the serialised body, so a long run
of commits is given as long as a pack of the same size. It follows no redirect: a 3xx answer would replay the request
without the token, which reads as a sign-out, so it is `RemoteError::Redirected` saying `redirected to <location>; sign
in with that address` (the instance lives at that address). A push of a bound repo says `This repo pushes to <bound
url>, which redirects to <origin>. If the instance moved, run dit login <origin>, then dit remote set <origin>.` instead,
where `<origin>` is the redirect's `Location` read as an `Instance`; a `Location` that is missing, relative or not an
instance address says `which redirects elsewhere.` and names no command.
A request that runs out of time after the connection is up is `RemoteError::TimedOut`, whose message names no command;
one that runs out of time resolving or connecting is `Unreachable`, as no answer at all. A push adds `Saved here; dit
push to try again.` to a timeout as `PushError::TimedOut`.
`https` certificates verify against the system trust store only (`rustls` with the platform verifier; no bundled
root set is linked), and plain `http` is allowed for an instance without TLS. `Remote::open(config, tokens)` adds the
stored token as `Authorization: Bearer` and reads a 401 on any call as `Signed out of <host>. Run dit login.`

**The device grant** (RFC 8628, client id `dit`, the server half in `server-api.md`): `POST /api/auth/device/code`;
the cli prints the code and the verification address to stderr and opens `verification_uri_complete` in the browser;
it then polls `POST /api/auth/device/token` every `interval` seconds, adding 5 s for that poll and every later one
on `slow_down`, continuing on `authorization_pending`, and ending on `access_denied`, `expired_token` or `expires_in`.
Once the code is approved, the token stored for that instance is read and the new token stored in its place (a store
that cannot be written signs the new session out again and leaves the old token); the session the old token belongs to
is then signed out (`/api/auth/sign-out`; a token the instance does not know is a success, a stored token that cannot be
read or any other failure is passed to `login`'s `on_previous_session_error` at once, which the cli prints as a warning,
whatever the rest of the login comes to). `get-session` then names the user, and the config is saved only after it
answers: a network failure after approval keeps a good sign-in, while
a token `get-session` rejects (a 401 or no session) is deleted again and leaves the config as it was. `logout` posts `/api/auth/sign-out` with the Bearer, then deletes the token whether or not the
instance answered (a warning says the session may still be open), and keeps the instance in the config. The app's
sign-out is not this: it leaves the session open and removes the machine instead (see "The app", _Sign in and out_);
`remote::remove_machine` is its `DELETE /machines/:id`.

**Token store.** `TokenStore` (`get`, `set`, `delete`; `Send + Sync`, so the app can share one across the commands it
runs) per instance. On macOS it is the login Keychain through
`keyring-core` and `apple-native-keyring-store` (service `dit`, account the instance's origin); every other platform
has none yet, and `dit login` fails with `dit can't store a sign-in on this platform yet.`

**Messages** a person sees: `Can't verify <host>'s certificate. Install its CA: <HTTPS_DOCS_URL>` for a certificate
the system does not trust (`HTTPS_DOCS_URL` follows `SITE.url` in `packages/ui/src/lib/site.ts`), `Can't reach
<host>: <reason>` for no answer, `<host> took too long to answer.` for a request that ran out of time once
connected, `Unexpected answer from <host>: <detail>` for a status or body dit does not expect,
`Sign-in was denied. Not signed in.`, `The sign-in code expired. Not signed in.`, `Not signed in to <host>. Run dit
login.` and `No instance to sign in to. Run dit login <url>.`

**Tests** (`remote/tests.rs`) run against an in-process mock instance on a `TcpListener` thread, with `MemoryTokens`
for the keyring and a fake `Clock` so the poll loop runs instantly; the certificate test makes a real TLS handshake
with an `rcgen` self-signed certificate.

## Pushing

`dit_core::remote::push` (features `store` and `remote`) sends a repo's saves and commits to a repo on the instance
it is signed in to; `pending` counts what is not sent yet from local state alone. `PushOptions { set, project,
skip_samples, saves_only }` names one set by id, the project a first push creates the repo in, whether to leave the
sample phase out and whether to send the saves alone.
`PushReport { bound, branches }` lists the binding a push made and, per branch that sent anything, `BranchPush {
setId, branch, saves, commits, objectsStored, objectsKnown, objectsClaimed, segments, lineage, samples }` (`segments`
and `lineage` left out when zero). `Pending { setId, branch,
saves, commits, samples }` lists non-zero branches only (`samples` counts the branch's commits after the sample cursor
that have a tracked sample, only while the cached setting says samples are pushed): per set in `sets.toml`
order, `main` first, then the other branches alphabetically. `pending` takes a set id to count that set alone (`dit
status <set>` passes the one it resolved) and reads nothing of the others.

**The binding.** `[remote]` in `.dit/config.toml` holds `instance` (the origin) and `repo` (the hub repo's id). It
is written right after `POST /projects/:id/repos` succeeds, before any set is adopted, so a push that fails later
still keeps it. A repo bound to one instance refuses a push while signed in to another.

**Adopting into chosen sessions.** `remote::adopt_sets(repo, remote, project_id, targets, quiet) -> Adoption`
(`remote/adopt.rs`) is what a first push does for each set, with a say in where each goes: `targets` is
`&[(set id, SetTarget)]`, `SetTarget::{Session(i64), Track(i64), NewTrack(String)}` (serde `camelCase`, for the
backfill's state file). An unbound repo is bound first (`bind_project`: the hub repo is named after the folder, in
`project_id`); a bound one must be of the instance signed in to. Per set: one already recorded in
`refs/remote/<set>.json` for the binding is left as it is (`Adopted` with its session), a `NewTrack` is made first with
`POST /tracks {projectId, title}` (sets sent to one title share the track), then `POST /repos/:id/sets` carries
`sessionId` or `trackId` and, when `quiet`, `quiet: true`. A 409 (a session a repo holds already) is that set's
`SetAdoption::Taken { message }` and leaves it unadopted, so whoever adopted must not push it; any other error ends
the call with what was adopted before it recorded. The push that follows finds each set's pushed file and adopts
nothing.

**Observing a push.** `remote::push_observed(repo, remote, options, observer)` is `push` with an observer,
`&mut dyn FnMut(PushProgress) -> ControlFlow<()>`, which is what the backfill's byte progress and pause go through (the
`remote::restore` progress is the precedent). `PushProgress::Between` is reported before each step (a chunk of saves, a
run of commits, a lineage batch and every pack upload) and `PushProgress::Uploaded { bytes }` right after the hub has
stored a pack. `ControlFlow::Break(())` from either ends the push with `PushError::Stopped`; what the hub confirmed
before stays recorded in the pushed state, like any early error, and a pack already uploaded is on the hub, so the next
push's `objects/missing` does not list it again. `push` is `push_observed` with an observer that always continues.
`remote::object_sizes(store, &saves) -> Vec<(ObjectId, u64)>` lists the objects a push of those saves uploads, once
each across all of them, with `Store::frame_len` (the size of the object's file, not read) of each: what a pack carries
for it without the record header.

**Pushed state.** `.dit/refs/remote/<set id>.json` is `{ "instance": "<origin>", "repoId": n, "sessionId": n,
"branches": { "<branch>": { "commit": "<hex>"|null, "saves": ["<hex>", …] } } }`. `instance` and `repoId` name the hub
repo the set was adopted into and `sessionId` the hub session it was adopted as; all three are written at adoption. A
branch's `saves` grow after each accepted saves chunk; its `commit` moves to the run's last commit after each accepted
commit run. `Repo::pushed_to(set, binding)` is what a push and `pending` read: a file whose `instance` and `repoId`
differ from the binding's, or that was written without them, is absent, so a repo bound to a new hub repo (or the same
instance at another address) adopts its sets again and sends everything. On a repo that is not bound yet, `pending`
treats every pushed file as absent.

**The sample setting.** `[push_samples]` in `.dit/config.toml` (`enabled`, `forced`; `Repo::push_samples`,
`cache_push_samples`, type `PushSamples`) caches the hub repo's `pushSamples` and `pushSamplesForced`, beside
`[remote]` and never inside it (`rebind_remote` compares bindings by equality). Every push asks `GET /repos/:id` once
after the binding is settled (an unbound repo's first push asks after it creates the repo) and rewrites the cache from
the answer; `set_push_samples` (`dit config push-samples on|off`) writes it from the `PATCH` answer. The phase below
runs when `enabled || forced` and `skip_samples` is false. The sets and their branches are checked
(`branch_order`) before any request, so a branch that cannot be pushed refuses the push with nothing sent or bound.

**The first push.** With no binding it lists the user's projects: `--project <name>` picks one (exact name first,
then case-insensitive), a single project is taken without a flag, and several without the flag is an error. It
creates the repo, named after the project folder, and binds. Every set is then adopted (the file name sent is the
base name of the set's main file in `sets.toml`). Once bound, `--project` is ignored. `dit push <set>` pushes the
one set; a first push with a set adopts only that set.

**The order.** The instance and set checks come first, before any request. Then per set in `sets.toml` order, a set
with no pushed file is adopted. Branches go `main` first, then the others alphabetically, except that a checked-out
branch waits until the branch it forked from has gone. Per branch: the unpushed saves go in chunks of 200; the
pending commits, oldest first, are cut into runs of at most 100,000 listed object ids (at least one commit per run).
Per run: `objects/missing` over the run's deduplicated object ids (in requests of 10,000), then the missing objects
in packs under the instance's upload limit (`GET /uploads/limits`, fetched once per push and only when something is
missing), then `POST /commits`. A 409 starting `Objects not held by this repo` redoes the run once. A pack's frame is
the object's stored file as it sits in `.dit/objects`, sent unchanged. Each commit lists `sampleObjects`: the leaf ids
of the samples its own save (`Commit::save`, not every save it folds) references, once each, in reference order, sent
whether or not samples are pushed so the hub can say how many it holds. `objects/missing` answers `{missing, claimed}`;
`claimed` hashes are objects the hub linked to this repo without an upload (a repo of a project the caller is in held
them) and are counted `objectsClaimed`, apart from uploaded ones.

**The saves body.** `POST /repos/:id/saves` takes each save as `{hash, xmlHash, tree, side, fileUpdatedAt, machineName,
meta, viewOnly, unreadable, samples}`; a save that holds its file raw sends `xmlHash`, `tree`, `side` and `meta` as
`null` and adds `raw`, the hex id of the leaf holding the file (omitted from every other save). The objects of such a
save are that leaf and, when it is Chunked, its chunks, listed and uploaded like any save's objects
(`save_objects`).

**The sample phase.** After a branch's commits, with the setting on, each commit after `PushedBranch::samples` (the
cursor, in `refs/remote/<set>.json`, left out while unset), oldest first, has the objects of its sample leaves (a Chunked
leaf is itself plus every chunk, through `LeafObjects`) asked with `objects/missing`, the missing ones uploaded in
packs, then the commits are POSTed again in batches cut like phase 1's runs (the same bodies as in phase 1; at most
100,000 listed object ids a request, at least one commit: the hub links a commit's sample objects only for those it
holds when the commit is posted, and a replay of a recorded commit links any that landed since), and only then the
cursor moved past the batch's commits and written. A failed re-POST leaves the cursor before that batch, and the next
push redoes it. A commit with no sample object is not re-posted, is not counted in `samples.commits` and still moves
the cursor. Turning the setting on later therefore sends the samples of every commit already pushed (nothing but this
phase goes up).

**Time spans and lineage.** Per branch the saves go first, then this machine's time spans (`Repo::segments`): those
that end after `PushedBranch::segments_through` go in `POST /repos/:id/segments` (`{ditSetId, segments: [{branch,
machineName, startedAt, endedAt, source}]}`, up to 500 a request, the machine name as `hub_name` makes it: trimmed, then cut to the longest prefix of whole
characters that is at most 64 UTF-16 code units, the same cut the hub makes; a beat's `name` is cut the same way), once
the hub holds a save of the branch; the cursor moves to the latest end sent, and a span the tracker extended ends
after it and is sent again, which the hub's upsert (by session, branch, machine and start) accepts. Spans are in
the saves-only push and are never why a branch appears in a report. After the commit phase, the lineage phase asks,
for each commit after `PushedBranch::lineage` (unset starts at the first, so a repo pushed before the phase existed
fills in), `objects/missing` for its own save's hash (kind 4) and its commit's hash (kind 5), uploads what is
missing in packs, posts the commits again with `lineageObjects: [<save>, <commit>]` and then moves the cursor; the
hub refuses a commit naming an object the repo does not hold (400 `lineage_not_held`), which is an ordinary push
error. A row of the report says `lineage` when it did; `dit push` prints a line for it only when nothing else of the
branch was sent. `PushOptions::saves_only` sends the saves and spans only, with no `GET /repos/:id`, no commits, no
lineage and no samples: what the daemon sends after a save.

A refusal that is the storage cap, a 413 whose `code` is `storage_limit`, ends the whole push (every later branch
and set too) with `PushError::StorageLimit { message, report }`: the batches completed before it are re-posted and
the cursor moves to the last completed commit, the commit being sent and every later one keep their samples
pending, and what the push sent before (the commits, the completed samples) is in `report`. The error's Display is
the hub's own message, and `dit push` prints the report, then the message with ` The commits are on the hub; dit
push sends the samples when there is room.`, and exits non-zero. Any other failure, a 413 with another code
(`pack_too_large`) or none included, is the push's error as usual and ends the phase where it stood. `dit commit`
never runs this phase.

**Packs.** A pack closes at the smaller of the instance's upload limit and `PACK_TARGET_BYTES` (32 MiB), so a slow
link waits on shorter uploads; a record larger than 32 MiB (but within the upload limit) goes alone in its pack. An
object is refused as `PackError::TooBig { id, which, bytes, exact, limit, place }` when its frame or what it decompresses to
is over `MAX_OBJECT_BYTES` (64 MiB, `PackLimit::ObjectLimit`) or its record, header included, is over the upload limit
(`PackLimit::UploadLimit`, whose message says the instance's admin can raise it). The decompressed size is the one the
frame's header declares (the store writes every frame with its size, so a push reads a header rather than decoding),
else counted by decoding at most `MAX_OBJECT_BYTES + 1` bytes, so a frame that expands without end is never held
whole; a count that stopped there is `exact: false` and the message says the object is "over" the limit rather than
stating a size. `place` is the save and set the object was listed from, filled in by the push. A pack upload may
take `upload_timeout(bytes)`, like every request with a body. The leaf objects a save lists are read
once per push (`LeafObjects`, kept across the push's saves), not once per save.

**Moving the binding.** `dit remote set <url>` (`dit_core::remote::rebind(repo, url, open)`) moves a bound repo to the
address its instance moved to, keeping the hub repo: the step a push's redirect message names. An unbound repo is
refused (`This repo hasn't been pushed yet, so there's no instance to move it from.`), and a `<url>` with the bound
origin succeeds with nothing written, before `open` signs in. Otherwise dit must be signed in at `<url>` (`This repo
would push to <url>; dit is signed in to <signed-in url>. Run dit login <url>.`), and `GET /repos/:id` there must answer: a 403
or 404 is `<url> has no repo <id>; this repo stays bound to <old>.`, and any other failure prints as it is. The answer's
`sets` must then list every set the repo has a push record for under the old binding (`Repo::pushed_sets_to`), each
under the `sessionId` the record names; otherwise it is `<url>'s repo <id> does not hold this repo's sets; this repo
stays bound to <old>.`, because a repo id alone says nothing about which project's repo it is. Nothing is
written before the checks pass. `Repo::rebind_remote(from, instance)` then, under one hold of the lock, gives every
pushed file whose `instance` and `repoId` match the binding the new origin (others are left alone), syncs the
`refs/remote` directory (`atomic::sync_dir`, a no-op off Unix) so no power loss keeps the config and loses a file, and writes
`[remote] instance` in `config.toml` last; a config no longer bound to `from` is `RepoError::RemoteChanged` with
nothing written. Because the config goes last, a run that stops partway is repaired by running the same command again:
the config still names the old origin, the files left behind are rewritten, and the files already moved need no write.
`Rebound { from, to, sets }` reports the two origins and how many pushed files were rewritten.

**Failure.** The first error stops the whole push. Whatever the hub accepted before it stays recorded, and every step
is idempotent, so the next push resumes where it stopped.

**Messages** (`PushError`; each Display is the line the cli prints). `This repo pushes to <bound url>; dit is signed
in to <url>. Run dit login <bound url>.`, `You're in several projects (<names>). Run dit push --project <name>.`,
`You have no projects on <host>.`, `No project named <name> on <host>.`, `This repo has no set <id>.`, `Can't push
branch <b>: it was checked out from branch <f>, which can't be pushed before it.` (the fork is not in the set, or the
forks form a cycle), `This repo has not been pushed yet. Run dit push first.` (`set_push_samples` on an unbound repo), `Can't reach <host>. Saved here; dit push when it's back.` and `<host>
took too long to answer. Saved here; dit push to try again.` A `RemoteError` (signed out, no instance,
certificate, a redirect) and a hub refusal (a 409, a viewer's 403, a 413 that is not the storage cap) print as
they are; the storage cap's 413 on a sample is `PushError::StorageLimit`, whose message is the hub's.

**Commit pushes.** `dit commit` pushes the committed set after writing the commit, unless `--no-push` is given. The
push is a try: the commit stands and the command exits 0 whatever happens. See "The cli" for its output.

**Tests.** `remote/push_tests.rs` drives `push` and `pending` (every script starts with the `GET /repos/:id` the push
makes, after `projects` and the create for a first push; its `samples` module scripts the two phases, a claim, a cap
refusal that fails the push and leaves the commit pushed (also after a completed commit, and a 413 that is not the cap), the backfill when the setting flips on, a forced instance and the setting's
`PATCH`), and `remote/rebind_tests.rs` drives `rebind`, against
the in-process mock hub. The cli cannot reach a mock hub (its token store is the system keychain), so `tests/cli.rs`
covers `--no-push`, the failed auto-push, `dit push` failing cleanly, the status columns, `dit config push-samples`
(printing the cache, refusing an unbound repo), samples tracked through the real Ableton module, and `dit remote set`
refusing an unbound repo and a malformed address, with `HOME` and `XDG_CONFIG_HOME` pointed at a temp folder so a
test never reads a real sign-in.

## Machines and the push queue

**Machine identity on the wire.** `dit login` makes the machine id in memory (`UserConfig::ensure_machine_id`), saves
it with the config only once the sign-in stands, sends it on every request of the sign-in and, once the session is
known, registers the machine (`register`, a beat with nothing open). A hub refusal of that registration (a name another
machine of the account has) is the error `login` returns, with the sign-in kept; a registration the hub could not be
asked for is left to the first request. `RemoteSource::open` (the default the cli and the app share) makes the id for
a sign-in that predates ids (`machine_id_at`) before opening. Every `Remote` method but `post_stream` is wrapped by
`Remote::registered`: a 409 coded `machine_not_registered` (`NOT_REGISTERED_CODE`) registers the machine (name from
the client, `platform()`, dit-core's version) and sends the request once more, once; the beat itself goes through
`put_once` and is never answered with another beat. A streamed upload's body is read, so it is not resent.

**Machines.** A machine is a computer signed in to the instance: `UserConfig.machine_id` (`machine_id` in
`config.toml`; `UserConfig::machine_id_at(path)` makes 32 hex characters from `/dev/urandom` once and keeps it) is
the id the hub knows it by, and the name is the machine name that already rides on every request. `remote/machines.rs`
has `register(remote, &Machine)`, the first beat of a sign-in (nothing open, no repos), which lets a name another
machine of the account holds surface as a 409 `machine_name_taken` before the beat loop runs, and `beat(remote,
&Machine, &Presence { open_session_id, repo_ids })`, both `PUT /machines/<id>` with `{name, platform, appVersion,
openSessionId, repoIds}`. `remove_machine(remote, id)` (`remote/machines.rs`'s `remove`, over `Remote::delete`) is
`DELETE /machines/<id>`, a 204 with no body; the app's sign-out calls it. The hub calls a machine
online when it was heard from within 90 s.

**The beat.** `dit-daemon/src/beat.rs` beats every 30 s, at once when the open set changes (the router nudges it on
`OpenSet`, `RepoTracked` and `RepoUnreachable`) and on waking, one beat out at a time, with a wait that starts at 5 s
and doubles to 60 s while the hub does not answer (the retired scanner's heartbeat rule, ported). `Beater` is the rule as a state machine over a clock it is given (generation counter: an
answer that arrives after a stop is dropped); `Beat` runs it on a thread against a `Pulse`, `HubPulse` over the hub.
What a beat reports is read as it goes out (`route::presence`): the hub ids of the tracked repos bound to the
sign-in's instance, and the hub session of the open set when the script, the log or the title says it is open (the
saves signal does not count). A 400, 403 or 409 is `DaemonEvent::MachineRefused { message }` (once per message), a 401
`DaemonEvent::SignedOut { host }` and the beat stops until `Running::sign_in`; anything else is a failure the backoff
covers. Waking is `Running::wake()`; the thread also calls it itself when the wall clock ran 10 s ahead of the uptime
clock, which is how a sleep looks from inside.

**The queue.** `dit-daemon/src/queue.rs`: a map of repo to the most it is wanted to send (`Phase::Saves`, `Commits`,
`Everything`, merged to the largest) and one worker thread that takes the lowest due phase, so a save is not held
behind another repo's samples, and pushes with the one `Arc<Remote>` opened for the run. `Saves` is `saves_only`;
`Commits` is `skip_samples` (saves, spans, commits, lineage) and queues `Everything` once it succeeds. A repo is
wanted after a debounce (1 s) so a burst is one push. `Router` (the runner's step between the daemon and the app)
wants `Saves` on `SaveRecorded`, `Commits` on `Committed` and `RepoTracked`, which is also what backfills lineage on
the first launch after the update. A repo with no hub repo is left alone: binding one names a project, which is the
producer's choice (`dit push`). Failures are sorted by `classify`: unreachable, timed out, 408, 429 (at least 60 s),
5xx, an answer that is not the hub's JSON and a repo lock held elsewhere are retried (`PushEvent::Waiting`, with the
beat's backoff, 5 s for the lock); a refusal the hub means, the storage cap included, stops that repo and says why in
the hub's words (`PushEvent::Failed { storage_limit }`, after a `Pushed` of what was sent), until something wants it
again; a 401 pauses the queue (`DaemonEvent::SignedOut`, once) until `Queue::resume(remote)`. `DaemonEvent::Push`
carries `Started`, `Pushed`, `Waiting` and `Failed`.

`Queue::hold(repo)` keeps the queue off a repo: what is wanted of it stays wanted (phase and due time kept) but it is
not taken until `Queue::release(repo)`, and `held()` lists the holds. A push of the repo already running is not
interrupted, `forget` leaves the hold and a held, wanted repo keeps `is_idle` false. `Running::hold(repo)` and
`release(repo)` keep the set in the runner's wiring too, so a hold survives `detach_hub` and a queue started by a later
`attach_hub` is built holding it. The backfill holds a folder while it brings it in (one pusher per repo: the queue
would otherwise push a half-pushed repo the moment the daemon tracked it) and the folder joins the daemon with
`Input::AddRepo` when it is done.

`runner::Options { hub: Some(Hub { remote, machine }), queue }` starts both; without `hub` the daemon runs with no
network. `Running::attach_hub(Hub)` and `detach_hub()` sign in and out while the daemon runs (the queue, beat and render
engine start or stop; attaching wants every tracked repo pushed, since their `RepoTracked` events are past; `has_hub()`
says which). `Running::push(repo, phase)`, `sign_in(remote)` and `wake()` are what the app calls. `dit-core` exports its
scripted hub behind the `test-support` feature (`remote::test_support`: `MockServer` with `start`, `start_replies`
for byte bodies and `route` for a handler, `Reply`, `Recorded`, `remote_to`), which `dit-daemon`'s tests use.
`Remote::get_bytes(path, max_bytes)` reads a body past ureq's 10 MB default, `Remote::post_for_bytes(path, body,
max_bytes)` does the same for a POST, and `Client::get_with(path, token, timeout)` takes a timeout of its own. Both
byte readers allow `download_timeout(max_bytes)`: 2 minutes and a second for each MiB of the limit, never more than 30
minutes, so a body that stalls part way is given up on as `RemoteError::TimedOut` (the 1 GiB a restore allows is about
18 minutes, not the hours an upload's rate would give). `RemoteError::Refused` carries the error body's `details`
(`Option<serde_json::Value>`) beside `status`, `code` and `message`.

## Restoring a commit from the hub

`remote::restore(repos, registry, remote, commit_id, name, progress) -> Result<Restored, RestoreError>` (features
`store` and `remote`) brings a commit the hub holds into a repo on this computer as a new branch. It is what the
panel's `restore {commitId, name}` calls and what `dit restore` prints; `progress` is `&mut dyn FnMut(Progress)`, told
`Fetching { objects }` after each fetch the hub answers (objects fetched so far) and `Writing` once before anything
is written. `Restored { repo, setId, branch, file, commit, fetched, requests }`.

**Finding the repo.** `GET /commits/:id` gives `{hash, parentHash, saveHash, branch, ditSetId, repoId, ...}`. The first of
`repos` (the caller's list: `repos.toml`, the repo `cwd` is in) whose `[remote]` binding is that `repoId` on the instance
signed in to, and that has the set `ditSetId`, is the target; none is `RestoreError::NotTracked` (`Not tracked by dit
on this computer.`). A commit with no `saveHash` is `NoSave`. The branch is `name`, else `restore-<7 hex of the
hash>` made unique by `Repo::free_branch_name` (`x`, `x-2`, `x-3`, ...; a trailing `-N` digit suffix is stripped
and numbering tries from `2`, so a taken `fix-2` becomes `fix-3` rather than `fix-2-2`).

**A commit this repo holds** (`Store::contains`) needs no fetch: the branch is checked out at once.

**Otherwise** the commit's branch must be `main` or one of the set's local branches (`BranchNotHere`, before any
fetch): the new branch is checked out from the commit, so the commit's branch is its fork, and `branch_order` could
not push a branch forked from a branch this repo lacks. The whole ancestor chain is learned up front from `GET
/sessions/:id/commits?limit=500` (rows carry `hash`, `parentHash`, `saveHash`; the session id is in `GET
/commits/:id`), followed from the commit back to the first ancestor this repo holds, since a history walk reads each
commit and its own save back to there (`Repo::history` gives a commit whose save is in no log here that save alone).
Then `POST /repos/:id/objects/fetch {hashes}` is asked by depth, each round one request (split only at 10,000
hashes): every chain Commit and Save with the commit's own save; then its `tree` and `side` (or `raw` leaf); then the
tree's leaves; then the chunks of the Chunked ones. That is at most 4 fetches and 2 GETs whatever the chain's length
(the hub allows ten fetches a burst). A chain the 500 rows do not reach back through is finished by reading the
commits themselves, one more round per generation past them.
The answer is
`id (32 bytes) | kind | length u32 LE | stored frame` per held hash, in request order, when the repo holds every hash
asked for. When it does not, the hub answers before streaming anything `409 {error, code: "objects_missing", details:
{hashes: [...]}}` naming every missing hash, and that refusal is `Incomplete(hashes)` (a body of any size: thousands of
hashes do not fit a header). Every record is checked (`kind` against the frame's first byte, the id against
`ObjectId::of`); a record left out, one not asked for, or a body that stops short is `BadAnswer`, as is an
`objects_missing` refusal with no parseable hashes: all before anything is written, with the objects held in memory
until then.

**Writing.** One store batch puts every object (the put path computes each id again), then
`Repo::checkout_new_branch` writes the commit's save (a raw save writes its leaf's bytes), then `record_save` of the
new file makes the branch's first save. A file or branch in the way is `BranchFileExists { path, suggestion }` or
`BranchExists { name, suggestion }`, the suggestion being the next free name; nothing of the file is overwritten. The
objects stored before such a failure stay, harmless.

**Tests.** `remote/restore_tests.rs` serves objects from a second repo, the other computer, whose commits this
computer's copy lacks: the chain imports with its parents and the history reads through it; only the ancestors this
computer lacks are fetched; a local commit makes one request; a hole, a tampered record and a short body write
nothing; a taken name offers another; a large leaf comes with its chunks; a raw save restores its bytes; the new
branch pushes after its fork without sending the hub's commits back.

## Renders

A render is an audio file the producer bounces, proposed to the hub as a version of a session's track. The code is
`dit-daemon/src/renders/`: pure rules (`rules.rs`, `score.rs`, `probe.rs`), the ledger (`ledger.rs`), the hub steps
(`upload.rs`, `driver.rs`), the state machine (`engine.rs`), its threads (`service.rs`) and the card the panel shows
(`event.rs`). The retired scanner's logic is ported here, not shared: the folder and name exclusions, the size limit, the
fingerprint and the score with its default thresholds (credits in each file's header); the format preference of a
pair is `packages/media/src/bounce.ts`.

**Watching.** `Service::start` makes one subscription on the one watcher (`Fswatch::subscribe`) for the whole home
folder with a filter that runs on the watcher's thread: an audio extension (`wav mp3 aiff aif flac m4a aac ogg`) and
not `Exclusions::excludes_below(home, path)`. The exclusions are by name and only below the home folder (a home inside
a folder called `Library` still works): dot names, `~*`, `*.icloud`, `*.dropbox`, `*.tmp`, `node_modules`, `Library`,
`Application Support`, `Trash`, `Backup`, `Samples`, `Freeze`, `Recorded`, `Ableton Project Info`, `Ableton`, any name
with the word `stem`, `stems` or `stemz` (so an export of stems is never offered), the managed subfolders of every DAW
in the registry (`Daw::managed_subfolders`) and the folders the producer said "Never here" to (read from the ledger,
and rebuilt into the shared `Exclusions` when the producer says it again). Nothing scans the home folder at launch;
what was written while the app was away is found only if it is touched again.

**Scope and settings.** `RenderOptions { roots, excluded, max_upload_mb, … }` carry the settings (`UserConfig.watch_roots`,
`excluded`, `max_upload_mb`, which the app maps in). `roots` empty watches the whole home folder; otherwise there is one
subscription per root (canonicalised), each with the filter above, and a name is measured from the deepest root that
holds the path (`Exclusions::excludes_watched`; a path under no root is out). `excluded` folders are out with their
whole trees, kept apart from the ledger's "never here" folders, and the built-in exclusions always apply on top.
`RenderControl::set_scope(roots, excluded)` (and `Running::set_render_scope`) replaces both while the app runs: the new
roots are subscribed before the old subscriptions drop, so an error leaves what was watched; `set_max_upload_mb`
(`Running::set_render_max_upload_mb`) changes the limit for renders judged from then on (a proposal keeps the choice it
was made with). Both are kept in the daemon's wiring so a hub attached later starts with them.

**The hub's shapes.** A save's `fileUpdatedAt` in `GET /sessions/:id/commits` is a `Date` serialised by Hono's
`c.json`, i.e. `Date.toJSON`: `YYYY-MM-DDTHH:MM:SS.mmmZ`; only that form is parsed. `GET /sessions/:id` is the session
with `projectId` and `track: { id, title, … } | null`.

**The bar.** `bar::bar_title` is at most 32 characters: the set's name is cut with an ellipsis to make room, a branch
name that would leave the set under eight characters is cut first, and the count and the glyphs are never cut.
`bar::waiting_renders(cards)` counts the cards that wait for the producer (`proposed`, `over-limit`) for the `♪`.

**Settling and holding.** Each path that passes goes through a `Settle` with `Rule::Stable` (size and mtime equal at
two looks 5 s apart). A stable file is held `HOLD_MS` = 60 s from the moment it became stable, so a second format of
the bounce and the next stem of an export have time to arrive. The engine writes a proposal in `Waiting` to the ledger
when a stable file relates to some set (its place, its name or a save within half a day of it; a file that relates to
nothing is dropped without a trace) and keeps the proposal's file list current as siblings settle or go. A render is
due when every file of it is stable and held; a file changed again is held from the start.

**Pairs and batches.** `group_pairs` makes one render of the files of a folder with the same stem (case ignored):
`Mix.wav` and `Mix.mp3` are one proposal with two files, and `upload_choice` picks the one that goes up, the largest
that fits `max_upload_mb` (0 for no limit), a tie going to a lossless format. `batches` finds runs of three or more
renders whose mtimes chain within 60 s; a render in a run waits until the whole run is due, and each proposal of it
carries `batch: Some(n)` so the panel can say "n files". A run is seen as far as the engine knew of it when its first
member fell due, so an export that pauses for over a minute between stems is two runs.

**Deciding.** A due render is fingerprinted (`dit:<size>:<sha256 of the first and last 64 KiB>`, so a multi-gigabyte
file is named without being read) and probed (`lofty`: duration and container). A file whose fingerprint was
rejected ("Not a bounce"), that sits in a never-here folder or whose bytes another live proposal already holds is
dropped; a render left with no file is removed from the ledger and its card told `rejected`. Because the rejection is
by fingerprint it survives a rename, a move and a restart. The sets the render is scored against are those with a
hub session (`HubCatalogue`: the tracked repos bound to the sign-in's instance, each set's `PushedSet::session_id`,
its save times, its project folder); only those the render relates to are scored, the best five by name first, each
with its track's title as read from `GET /sessions/<id>` and cached 10 min (a miss one minute). `score` takes the
track title, the set's file name and its project folder's name, the file's place (`place_of`), its time against the
save times and its length against the 30 s floor, and gives a confidence and reasons as sentences. A confidence of
0.45 (`ASK_CONFIDENCE`) or more is offered (`Score::is_offered`); less is dropped without a ledger entry. A render
offered whose files all exceed the limit is `OverLimit` ("Over your size limit"), never uploaded; otherwise it is
`Proposed`, however sure the score: nothing is uploaded until the producer accepts it. Every change is written
to the ledger before it is reported.

**Rejections on the hub.** The hub is the record of "Not a bounce" (by fingerprint, one list per user) and "Never
here" (by folder, per machine) under `/machines/rejections`; `renders.json` stays the copy the engine reads
synchronously, untouched by the engine. The ledger gains `unsynced` (changes the hub has not heard: `Unsynced {
remembered: Remembered::{NotABounce {fingerprint, fileName}, NeverHere {folder}}, removed }`, a change that undoes a
waiting one cancels it) and `uploaded` (the one-time upload's marker, never reset). `Ledger::reject`,
`forget_rejected` and `forget_never_here` note the changes. `renders::rejections::flush(ledger, remote)` POSTs the
waiting additions (`{items: [{kind: "not-a-bounce", fingerprint, fileName?} | {kind: "never-here", machineId,
folder}]}`, at most 1000 per request) and DELETEs the removals by the id `GET /machines/rejections` lists, clearing
what the hub took. `sync` is flush, then the one-time upload of the ledger's own lists, then `Ledger::adopt_hub`: the
lists become the hub's (every machine's "Not a bounce", this machine's folders), plus what still waits, less what was
taken back; nothing changes unless every request answered. `Service::start` runs `sync` on a thread of its own and,
when it ends, replaces the engine's never-here filter and sends `DaemonEvent::RejectionsSynced` (the app republishes
its lists); `Control::reject_render` flushes on a thread after the ledger write; `dit renders reject` with no app
opens the remote (`RemoteSource::open`) and flushes, saying one line on stderr if the hub could not be told. The
app's `forget_rejection` flushes on a thread; `forget_never_here` re-attaches the hub, and that attach's sync sends
the removal.

**The ledger.** `renders.json` beside `config.toml` (`Ledger::beside`, `Ledger::default_path`): proposals (`id`,
`name`, `files` with size, mtime and fingerprint, `state`, `session_id`, `track_id`, `bounced_from_save_id`, `score`,
`reasons`, `batch`, `message`, `upload { chosen, asset_id, sent_bytes, total_bytes }`), the rejected fingerprints and
the never-here folders. The app and the cli both write it, so every change is `Ledger::update`, which holds
`renders.lock` for the read, the change and the write (a temp file renamed into place); a file that does not parse is
an error and is never reset, since that would forget every rejection. Ids are allocated once and never reused.

**Adding to the hub.** `driver::run_upload(remote, ledger_path, id, on_change)` is the one routine the app's
uploader and `dit renders accept` (no app) both run, over the steps of `upload.rs`, each written to the ledger
before the next: (1) the proposal becomes `Uploading`; (2) `POST /assets/lookup` by fingerprint for the session's
project (`GET /sessions/<id>` names the project); (3) a miss is `POST /assets/upload`, a multipart body of known length
streamed from the disk, its progress written to the ledger and reported about four times a second; (4) the asset id is
written down; (5) `POST /sessions/<id>/renders { assetId, bouncedFromSaveId }`, where the save is the newest save of
the session at or before the render's mtime (`GET /sessions/<id>/commits?limit=500`, none when it cannot be told); the
proposal is `Added`. The accept is repeat-safe on the hub, so a restart resumes at the step the ledger names:
`Uploading` with no asset id looks up again (and finds the file if the upload got through), with one it goes
straight to the accept, and a crash between the accept and `Added` repeats the accept and nothing else. A 409
`session_has_no_track` returns the proposal to `Proposed` with "This session has no track yet" and its asset kept. A
hub that cannot be reached, a timeout, a 408/429/5xx or an answer that is not the hub's is `QueuedOffline`, retried by
the engine after the beat's backoff (`beat::retry_delay_ms`, 5 s doubling to 60 s) and, after a restart, at once; a 401
is `DaemonEvent::SignedOut` (once) and every retry pauses until `Running::sign_in`; a 413 is `OverLimit` in the hub's
words and any other refusal returns the proposal to `Proposed` with the hub's words. `request_accept` (also what the
cli calls) moves a `Waiting`, `Proposed` or `QueuedOffline` proposal to `Uploading` with the session the producer
named, and `reject` fingerprints the files not read yet, remembers them and, with `never_here`, their folders.

**Threads.** `Service` runs an engine thread (watcher events, a tick every 500 ms against the injected `Clock`, the
uploader's results), an uploader thread (one upload at a time on the one connection, replaced by
`Running::sign_in`) and the watcher's forwarder. `Engine` itself is a state machine: `fs_event(event, now)`,
`tick(now) -> Vec<Output>`, `upload_ended`, `resume`, with the catalogue behind the `Catalogue` trait, so
`engine.rs`'s tests run it with a fake clock and a fake catalogue over real temp files. `Running::stop` stops the
threads; an upload under way is left to the process, because the ledger resumes it at the next launch and waiting for
the last byte of a large file would hold the app's quit.

**The card.** `RenderEvent` (`event.rs`, also `dit_daemon::RenderEvent`) is the one shape of a render outside the
ledger: `{ id, name, state, files: [{path, size}], batch, uploadedFile, pairNote, progress: {sent, total}, score,
reasons, bouncedAfterMs, reasonKinds: {named, inFolder, nearSave}, sessionId, message }` in camelCase, `state` one of
`waiting`, `proposed`, `uploading`, `queued-offline`, `added`, `over-limit`, `rejected` (`RenderState` is the ledger's
`ProposalState`). `reasons` are sentences for logs and the cli; the panel words its card from the facts: `bouncedAfterMs`
is the render's time minus the time of the save nearest it (positive: after the save; `null` with no save time known)
and `reasonKinds` says whether the name is like the track's (`named`), the file sits in the set's folder, beside it or in
the DAW's export folder (`inFolder`), and it was made near a save (`nearSave`, timing at least 0.5). Both are kept in
the ledger (`bounced_after_ms`, `reason_kinds`; a ledger written before them reads as none) and set by `score::score`.
`pairNote` names a pair's upload
(`Mix.mp3 + Mix.wav: uploading Mix.wav`; `none fits the size limit` when over the limit). It arrives as
`DaemonEvent::Render` on every change of state and about four times a second for progress; `Running::renders()` is the
ledger as cards (everything not rejected). A card told `rejected` for a proposal the panel was showing means it was
dropped.

**The app's calls.** `runner::Options { renders: Some(RenderOptions { ledger_path, max_upload_mb,
export_dirs, roots, excluded }) }` starts the engine, and only with `hub` (the renders go to the hub). `Running::accept_render(id,
set_session)`, `reject_render(id, never_here)` and `render_control()` (an `Arc<dyn RenderControl>`, which is
`Send + Sync` where `Running` is not, for the socket's handler) are the calls; `accept_render` returns the card at once
and the upload goes on in the background.

**The cli.** `dit renders` lists one line per proposal that was not rejected, `<id> <state> <name> (<N files>,
<size>)`; `--json` is the array of cards. `dit renders accept <id> [--set <session>]` and `dit renders reject <id>
[--never-here]` follow. The cli is handed the app's `RenderControl` when the app answers (`dit_cli::handle(run, err,
remote, renders)`, `Context::renders`): the app lists, accepts (the upload goes on in the app) and rejects, and the
list is the app's. With no app the cli reads and writes the ledger itself: the list ends with the line `The dit app
isn't running; this list may be out of date.` (on stderr under `--json`), a reject is a ledger write followed by a flush to the hub, and an accept
uploads here, synchronously, with `driver::run_upload` and the cli's own sign-in, saying `Uploading <file>…` on stderr;
when it cannot sign in the render is left `QueuedOffline` for the app to retry, and an accept that does not add the
render exits 1 with the reason. `dit-cli` depends on `dit-daemon` for this (the ledger, the driver and the card).
`dit-daemon` depends only on `dit-core`, so there is no cycle; what the cli is handed is not the app's `Running` (which
is not `Sync`) but the `RenderControl` trait.

**Limits.** There is no scan of the home folder at launch, no scoring against a set the hub has no session for, and
one title request per session per 10 min. A render of a session with no track waits, proposed, until the track exists.
`upload::limits(remote)` reads the instance's `GET /uploads/limits` for the app shell to show; the engine's own limit
is the producer's `max_upload_mb`, and the hub's 413 is the backstop.

**Tests.** `renders/engine.rs` runs the engine over real temp files with a fake clock: the hold (not proposed at 59 s,
proposed at 60 s after stability), pairs and a pair's late second format, batches of three, a batch waiting for its
slowest member, stems, managed subfolders and never-here folders not followed, the largest file under the limit and
an over-limit pair, a sure render still only proposed, a generic name asked about, the track's title deciding, "Not a bounce" surviving a
rename, a move and a restart, resuming held renders, and the retry and sign-in rules. `driver.rs` runs the steps
against a scripted hub (`test_hub.rs`) and re-runs it from the ledger after a crash at each step: no duplicate upload
when the lookup or the asset id exists, and the accept repeated after `Added` was lost. `service.rs` runs the threads
against the same hub (accept in the background, progress, retry on the clock, a refused sign-in) and `tests/renders.rs`
watches a real folder for a bounce (gated like `tests/watch.rs`). `dit-cli/tests/cli.rs` runs the binary with no app
(the list and its stale line, `reject --never-here`, an accept of a missing id) and `tests/renders.rs` runs the
cli handed an app's controls and a hub.

## The backfill

Bringing the projects a producer already has into dit, in one batch. `dit-daemon/src/backfill/` holds it: `discover.rs`
finds the project folders (see "The daemon"), `run.rs` reads a folder into its `.dit/` (Check) and holds the pieces a
run is made of, `propose.rs` proposes where each set goes on the hub, `state.rs` is the state file and the run lock,
and `driver.rs` is the run. `dit backfill` (see "The cli") drives it, with the app's `BackfillControl` when the app
answers the socket and its own `Driver` when none does, and both read one state file, so a run started by either
shows to the other.

**Check** (`run::check(recorder, folder, cancel, progress) -> Result<Checked, CheckError>`). Makes the folder a repo
when it is not one (`Recorder::repo`: `Repo::init` on the folder the DAW module recognises, which is safe to repeat),
then, per set, `Repo::record_history`: the set as it is, then its `Backup/` copies before it in time order, with no
commit and nothing sent. `Recorder { registry, author, machine }` is who records: the DAW modules, the author of each
set's one commit, and the machine name every save carries. `progress(read, sets)` is called before each set and once
at the end; `cancel` is read between sets (a cancelled Check leaves what it recorded, and
`CheckError::Cancelled`). `Checked { path (canonical), created_dit, sets, objects, samples, pushes_samples }`: `created_dit` says Check made
the `.dit/` (so `discard` may remove it); each `CheckedSet { file, set_id, saves, copies, fingerprints, doubt }`
carries the saves on `main`, the count of `Backup/` copies, the match fingerprints (`file_fingerprint` of the set
and of each copy, for `propose`) and a `Doubt`: `Unreadable` (some save is stored whole, `unreadable` true) or
`Unrecorded(message)` (the set could not be recorded, `set_id` is `None`, and it is left out of the plan). A
repo lock held by another process stops the whole Check (`CheckError::Failed`). `objects` is every save object a push of
the recorded sets uploads, once each, with its frame size in the store (`remote::object_sizes`, which reads each
leaf once, plus each set's head Save object, which the lineage phase links; a commit's own object does not exist until
the commit is made and takes a few hundred bytes). `samples` holds each set's head save's sample objects
(`remote::sample_object_sizes`), and `Checked::objects_to_send(instance_forces)` includes them in `storage-check` when
`pushes_samples` is true or `run::instance_pushes_samples(remote)` reports `push_samples_everywhere`.
`run::discard(folder)` removes the folder's `.dit/` and nothing else. `run::storage(remote, project_id, &objects) ->
Storage { bytes, held, remaining }` asks `POST /projects/:id/repos/storage-check`, deduplicating and sending at most
10,000 objects a request; `remaining` is `None` with no cap. `run::trouble(error, host) -> Trouble` sorts a failed
hub step: `Retry` (unreachable, timed out, 408, 429, 5xx, a body that is not the hub's), `Refused("<host> refused the
push: <message>.")` (any other refusal, the storage cap included), `SignedOut(host)` and `Stopped` (the push's own
observer).

**Proposals** (`propose::read(remote, project_id) -> Hub`, `propose::propose(&Hub, &Checked) -> Vec<Proposal>`).
`read` takes the project's `dit-candidates` (sessions no repo holds, each with the path it last recorded, its
fingerprints and its newest save) and its tracks that are not archived (`tracks/summary`). A set matches the session
that last recorded its path (the same path, or one that reaches the same file), else a session that recorded the
fingerprint of the set or of one of its copies (several: the newest save, then the lowest id); a session matches one
set, so a second set that would match it is a new session. A matched session keeps its track. A new session goes on the
track most of the folder's matched sessions are on, else the track whose title reads like the folder's name
(`renders::score::best_match` at `NAMES_A_TRACK`, 0.6), else `SetTarget::NewTrack(<folder name without " Project">)`.
`Proposal { set_id, target, matched: Option<Matched { session_id, name, track_title, by }> }`; a set with no set id is
left out.

**The state file** (`state.rs`). `backfill.json` beside `config.toml`, written like the renders ledger through the
shared `jsonfile` module (`State::update`: the lock file `backfill.lock` for the read, the change and the write, a temp
file renamed into place, an unparseable file an error and left as it is). `State { plan, folders, paused }`: `plan` is
what Start was pressed on (`Plan { folders: [FolderPlan { path, project_id, created_dit, sets: [SetPlan { set_id,
file, target }] }] }`, in run order, newest first), `folders` is one `FolderRun { state, committed, totals }` per plan
folder, and `paused` says the run stopped on request. `FolderState` is `Waiting`, `Committing { done, of }`,
`Uploading { sent, of }`, `WaitingForHub`, `Done`, `Paused` or `Failed(reason)` (serde `camelCase`; `committed` is how
many of the plan's sets, from the first, are recorded and committed, which is where a stopped run resumes; `totals`
is set once a folder is `Done`). `State::begin(plan)` starts the state over for a plan and keeps what an earlier run of
the same work did: a folder with the same path, project and sets (each going to the same place) that was `Done` stays
so, and one that was not resumes at its `committed` set; `created_dit` is kept once any run set it. A folder asking for
other work begins again, which costs time and nothing else. One run goes at a time on a machine, whoever started it:
`RunLock::take(state_path)` holds `backfill.running` (an advisory lock, in a file of its own so the short update lock
never waits for it) for the run's life; a second taker, in this process or another, gets `None`, and a dead process
frees it. `RunStatus { folders: [FolderStatus { path, state, totals }], paused, running }` is how a run stands
(`State::status(running)`; `running` is the lock being held, which the file cannot say, since a killed run leaves its
folders as they were) and `RunStatus::summary() -> Summary { first_save, saves, sets, projects }` adds up the folders
that are `Done`: `first_save` is the time of the oldest save (a save's own time, so a `Backup/` copy counts by when the
file was modified, never by when the commit was made).

**The run** (`driver.rs`). `Driver::new(Config { recorder, state, repos, owner, retry, progress_every })` is shared
between threads; one thread's call to `Driver::start(&Remote, Plan, out)` (or `resume(&Remote, out)`, which carries on
the plan the state file holds) is the run, and returns `Ok(Summary)` when every folder is done or failed. `out` hears
`Event::Folder { path, state }` on the calling thread (every state change, and an upload's progress at most each
`progress_every`, 250 ms, which is not written to the file) and `Event::Paused`. `BackfillError`: `Busy` (the run lock
is held), `Paused`, `Nothing` (an empty plan), `State(message)`, `Remote(RemoteError)` and `SignedOut { host }`.
`Driver::pause()` stops the run in this process after the step it is in; `status()` reads the state file (`None` when
there never was a run) and `last_project()` is the project of the last planned folder, where the next backfill goes by
default. `BackfillControl { start(plan, out), status(), pause() }` is what the app hands the cli (like
`RenderControl`): `Control { driver, remote }` implements it over a `Driver` and a closure that opens the signed-in
connection, which is how both the app and the terminal's `dit backfill` build theirs. `Owner { hold, release, join }`
is what the run asks of the app's daemon: `hold(folder)` before a folder is touched (`Running::hold`, which keeps the
push queue off the repo), `release(folder)` when the run is done with it, `join(folder)` after a folder is `Done`
(`Input::AddRepo`: the daemon tracks it and records what Live saves in it from then on). `Alone` is the owner of a run
with no daemon; a finished folder is added to `repos.toml` either way (a list that cannot be written does not fail a
folder that is on the hub), and the app reads it at launch.

Per folder, newest first as planned, one at a time: the folder must still be there (else `Failed("<name> moved or was
deleted.")`); the repo is opened (made if it was not); each set from `committed` on is `Repo::backfill_set` (record the
set, import its copies, commit "Brought into dit" when the branch has no head) and `committed` is written after each,
so a run killed anywhere resumes at the set it was on and a half-done set is simply redone; `adopt_sets(…, quiet:
true)` binds the repo in the plan's project and adopts each set as planned (a session another run took in the meantime
is that set's `Taken`: it is not sent, and once the others are sent the folder fails with the count and the hub's
words, so the next attempt can propose it again); `objects_of` and `storage` ask what the hub does not hold, which is
the folder's `Uploading { of }` (so `of` after a resume counts only what is left); each adopted set is then pushed on
its own (`PushOptions { set }` through `remote::push_observed`) with an observer that counts uploaded bytes into
`Uploading { sent, of }` and stops the push when the run is paused. A pause is therefore taken between sets, between
the requests of a push (after each pack) and in the wait for a hub; it leaves the folder `Paused` and the file at its
place, and a pack that was on its way is on the hub, so a resume's `objects/missing` leaves it out. A hub step that
cannot get an answer (`Trouble::Retry`) leaves the folder `WaitingForHub` and is asked again after the beat's backoff,
for as long as it takes; a refusal fails only that folder (`Failed("<host> refused the push: <message>.")`, saves kept
in `.dit/`) and the run goes on; a sign-in the hub refuses pauses the run (`BackfillError::SignedOut`).

**Tests.** `backfill/driver_tests.rs` runs the engine over real temp folders (a fake DAW whose `Backup/<set>-*.fset`
files are its copies) against `test_hub.rs`, a scripted hub that keeps repos, objects (and how often each arrived),
adopted sets and the requests: Check (no commit, no request, each object once with its stored size, cancel, a second
Check, `discard`, an unreadable set), a folder brought in (adopts quiet, a matched session, one new track for two
sets, commits by the author, `repos.toml`, the summary's first save being the oldest copy's time), the owner's calls
(held before the first request, joined after the last), a killed run resuming at its set, a pause between sets, a
pause after the first pack of a push resuming with every object sent once, a 413 failing one folder while the next
runs, a hub that is away, a taken session, a moved folder, a refused sign-in, the run lock and a finished folder not
run again. `propose.rs` and `state.rs` have unit tests; `queue.rs` and `tests/hub_attach.rs` hold the push queue's
hold.

## The app

`apps/dit-app` is the menu bar app: a Tauri 2 shell around a Vite and React panel, running `dit-daemon` and serving
the cli over the local socket. It is a Bun workspace (`dit-app`, version synced to the repo) with a Cargo workspace
inside it, `src-tauri/`, that has its own `Cargo.lock` and `rust-toolchain.toml` (1.97.1, clippy and rustfmt, no wasm
target) and reaches `dit-core`, `dit-daws`, `dit-cli`, `dit-daemon` and `dit-ipc` by path into `packages/dit/crates`.
It is not a member of `packages/dit`: a Tauri member would compile webkit under `cargo test --workspace` on the
ubuntu jobs and in the Docker image.

```
package.json              scripts below; @tauri-apps/api and cli pinned to the crate's minor (~2.12)
vite.config.ts            port 1420, strictPort (src-tauri/tauri.conf.json's devUrl); ignores src-tauri
index.html, public/       the theme script, loaded before React, as the client's is
src/app.css               the two @workspace/ui imports and an explicit @source
src/main.tsx              ThemeProvider (bindThemeHotkey false: the panel has no hotkey registry), MotionProvider, Panel
src/ipc.ts                the contract: Snapshot, Commands, STATE_EVENT; written by hand
src/bridge.ts             call, onState, onFocus and pickFolders: typed invoke and listen over Commands, and the dialog plugin
src/store.ts              the snapshot store; use-snapshot.ts is its useSyncExternalStore hook
src/panel.tsx             the panel: snapshot, navigation, keys, focus on show, window height; screen.ts picks the screen
src/screens/              sign-in, machine-name, repos, adopt, adopting, set (head only until the set screen), restore and settings
src/settings/             the settings row, the shortcut recorder and the folder list; accelerator.ts reads a press
src/backfill/             the backfill window's entry (main.tsx, loaded by backfill.html) and screens; see _The backfill window's screens_
src/backfill-ipc.ts      the window's contract: BackfillView, BACKFILL_EVENT, BackfillCommands; fixtures/backfill.json is its fixture
fixtures/snapshot.json    the one Snapshot both sides assert
src-tauri/                the Tauri crate; tauri.conf.json, tauri.dev.conf.json, tauri.release.conf.json, Info.plist, capabilities/
```

**Scripts.** `dev` is `tauri dev -c src-tauri/tauri.dev.conf.json` (Vite comes up through `beforeDevCommand`, `dev:web`
runs Vite alone in a browser, where every `invoke` fails because there is no app behind it); `build` is `vite build
&& bun run typecheck` and never `tauri build`, so `bun run build`, `typecheck`, `lint` and `test` run on Linux and
never touch Tauri; `package` is `tauri build --bundles app,dmg`, run on a Mac (CI does, on `macos-latest`; a release
adds `-c src-tauri/tauri.release.conf.json`, see _Updates_);
`lint:rust` is clippy `-D warnings` over `src-tauri` and is not part of `lint`, because turbo runs `lint` on ubuntu
where Tauri will not compile. `cargo fmt` and `cargo test` run from `src-tauri` on a Mac.

**The bridge.** The Rust side owns every fact and the panel derives its screen from one value: `get_snapshot` answers
the whole `Snapshot`, and each change is one `dit://state` event carrying the whole of it again, so the panel never
merges. The store listens before it asks, and a push that lands before the answer is newer than it and wins.
`call` is typed from `Commands` (a command with no arguments takes none) and rejects with the message the Rust
command returned. The contract is held on both sides by `fixtures/snapshot.json`: `src/ipc.test.ts` types the fixture
against `Snapshot` (a missing field, an extra one or a wrong shape fails the typecheck) and the Rust `Snapshot` in
`src-tauri/src/snapshot.rs` must deserialise it and serialise it back to the same JSON value. A field changed in
`ipc.ts`, the fixture and the Rust type changes in all three.

**The panel.** One screen at a time, chosen by the pure `screenOf(snapshot, nav)`: sign-in while the machine is not
signed in (idle, waiting with the code and "Open again", revoked, Keychain locked), the machine-name prompt when the hub
refused the name (`machine.refused`), the restore screen while a `projammr://dit/checkout` link is pending, then the
person's own navigation (`Nav`: home, repos, settings, from the `⋯`
menu and `⌘,`), and at home the adopt progress (`Snapshot.adopting`: the folder's sets, each "Saving…" or "Saved", as
their first saves land, until the app clears it and the set screen takes over), the adopt offer, the open set, or the
repo list. The `⋯` menu's Quit carries the line "Scheduled work stops until dit is opened again." Navigation is panel state and never
reaches the app. The keys are `createKeymap` bindings, `⌘↩` commit (claimed by the set screen's commit box), Esc
(backs out of repos and settings, else `hide_panel`) and `⌘,`, all firing inside a field; a field that takes Esc itself
(the shortcut recorder, an open menu) stops it first. A screen claims the field to focus when the panel is shown with
`useFocusTarget`, and the panel reports its content height through `resize_panel` so the window follows it. The
recorder sends the global shortcut as `Ctrl+Alt+Shift+Super` modifiers in that order then the key named from
`KeyboardEvent.code` (`Alt+Shift+D`), and refuses a press without Ctrl, Alt or Super. A refused command's reason
(the string the app rejected with) shows as a line under the control that sent it.

**The set screen** (`screens/set.tsx`, parts in `src/set/`). The open set, top to bottom as a commit runs. The root
carries `artVarsFromAccent(artwork.accentHue, artwork.accentChroma, artUrl(artwork.assetPath, 800))`, so the cover
reaches the masthead's blurred band and every `text-art` below it; with no artwork there is no band and the accent is
grayscale. `SetMasthead` is the name, the branch and `timeInSet` since the last commit, and "Open on the web"
(`open_web` with `open.webPath`, absent until a push made the set a session). `SkylineReadout` wraps `SetSkyline` in
`group/save-diff` over `skylineStructure` (`skyline-model.ts`): `diffStructure(headMeta, liveTracks as a synthetic
meta, else latestMeta)` (when `liveTracks` is used, `headMeta`'s XML track ids are stripped so the script's 0-based
positional ids pair by name/auto-numbered key without colliding, and the script's `master` track is omitted when
`headMeta` has none), a set with no commit diffed against an empty one (every track new), and the app's
`tracksChanged` names promoting a `same` row to `changed` (a clip edit has no device change to light it). It is one tab
stop: `←/→/Home/End` move the lit bar (written as `data-hot`, as the web's `SaveDiffControls` does), pointing does the
same over a hit area wider than the 8px bar, and an `aria-live` line names the track ("Bass · +EQ Eight") or counts the
lit ones. With nothing lit it is in `data-mode="whole"` so no bar is ghosted. Under reduced motion (`useReducedMotion`,
`data-reduced-motion`, a rule in `app.css`) the fade goes and `data-mark` stays. The commit box is a `Composer`
(`suggestion.ts`): until the person types, the text is the snapshot's `clauses` joined with `, ` less the ones switched
off; once they type it is theirs and a chip is pressed while its words are in the text, a click taking them out or
appending them. The state is the set's draft in `localStorage` under `dit-app:commit-drafts:v1` (`draft.ts`; a draft
the panel has not, the app's `Snapshot.draft`, is the fallback) and each change is mirrored to `set_draft`. `⌘↩` is
claimed through `commit-shortcut.ts`: the panel's one keymap runs the claim, because a key one keymap matched is
handled and a second listener never sees it. A blank message commits the cli's default; the refusal is the cli's
line, shown in the danger ink. The saves are `SaveRowBody` rows (no `source`, its own `empty` copy) with
`diffSaves` chips read against the next older readable save, the oldest against `headMeta`, and a status-pie dot for
the push state. "Nothing to commit" with the last commit stands where the commit box and saves would be. The track
proposal ("Which track is this?") answers with `propose_track`. Live, script, offline, refused and pushing lines come
from `set/status-model.ts` and are the snapshot's words in the spec's copy. "Track a folder…" in the `⋯` menu is the
folder picker, then `track_folder`, then home (the app has raised the adopt offer); a refusal shows at the top of the
panel through `PanelActions.report`.

**The render cards** (`src/renders/`). Under the saves, or on the repo list when nothing is open, the band "New bounce"
(`render-list.tsx`) lists `Snapshot.renders` less the `waiting` ones, which are the app's minute of holding a file back
and have no card. One component (`render-card.tsx`) draws every state from `card.state`: `proposed` (the file name
wrapped, never cut, its folder in faint ink, then one line of facts: its length, "bounced 4 min after your last save"
(`bouncedAfterMs`, "before" when negative, left out while the daemon has not said), its size; the matched set and the
reasons in the spec's words from `reasonKinds` ("named like the set", "in its folder", "4 min after your last save",
only those that held; the `reasons` sentences are not shown), and the four decisions), `over-limit` (the same, "Over your size limit", "Add anyway" in
place of "Add as version" — note that `dit-daemon`'s `renders/driver.rs` refuses `OverLimit` in `request_accept` and `begin` until the size limit is raised), `uploading` (a `Progress` line from `progress.sent` over `total` in place of the
decisions), `queued-offline` ("Queued", uploads when the hub is back) and `added` ("Added as version"). A pair of
formats is one card: `namesOf` writes "science123 v4.wav and .mp3", `uploadsLine` says "uploads the .wav (48 MB)" from
`uploadedFile`, and a proposed pair adds "Only the largest file under your size limit is uploaded." "Not this set"
(`not-this-set.tsx`) is a `Popover` over `otherSets`; the app has no per-set rejection, so choosing a set is
`accept_render {id, session}` and the picker says so when the folder has no other set on the hub. "Not a bounce" and
"Never here" are `reject_render` with that `mode`. The list is a listbox with one tab stop (roving `tabIndex`, the
cursor kept as an id and an index so a card decided away hands the cursor to its neighbour and focus follows): `↑/↓`,
`Home`/`End` move, `Y` adds, `N` is "Not a bounce", `Space` plays or pauses and `←/→` step ten seconds while that
file is loaded; the keys act only when the event's target is inside the list in the DOM (a popover's arrive through
React's tree), a key with a modifier is the panel's, and `Space` on a button inside a card presses the button. The
decisions are real buttons inside the options, so a screen reader that treats an option's children as presentational
meets the keys first; every decision stays reachable by `Tab`.

The player (`preview-player.ts`) is the retired scanner's render preview player, ported: one
`<audio>` for the panel, `playFrom(path, 1/3)`, `seekBy`, `release`. Its source is asynchronous: `allow_media(path)`
first, then `convertFileSrc` through `bridge.ts`, because the asset protocol serves only what the app has allowed.
The panel pauses on window `blur` and releases the element when the band leaves.

Settings (`screens/settings.tsx`) lists what the render watcher skips under "Bounces": the built-in exclusions
(`Settings.builtInExcluded`) as fixed text under "Never look in" beside the person's own folders, then "Files marked Not
a bounce" (`rejectedFiles`, by the file's name and folder, or its fingerprint when the ledger no longer holds a render
of it) and "Folders marked Never here" (`neverHereFolders`), each with a Forget button that is `forget_rejection
{fingerprint}` or `forget_never_here {folder}`. The "Live's dit script" row reads `Snapshot.script`: `connected`,
`installed` and `not-installed` say so and `live-not-found` says "Live wasn't found."; `script.path`, when the script
is installed, is the "Installed at <path>" line under the row. The Permissions button is "Open System Settings".

**The restore screen** (`screens/restore.tsx`). `screenOf` returns it whenever `Snapshot.pendingRestore` is set, ahead of
navigation, an adopt offer and the open set; the sign-in and machine-name screens still come first. The title is
"Restore '<message>' as a new branch" (or "Restore this commit as a new branch" until the hub has answered, or "Can't
restore this commit" with `pendingRestore.problem`, which shows its line and "Close"). The branch field starts on
`pendingRestore.branch`, each edit asks the app (`validate_branch_name`, latest answer wins) and shows its refusal
under the field with "Restore and open" disabled; the panel holds no branch-name rule. `Snapshot.restore` drives the
rest: `fetching` ("Fetching the commit…" with the object count) and `writing` ("Writing science @restore-a1b2.als…")
hide the form, say a restore cannot be stopped once started and offer "Close", which is `cancel_restore` (the app
keeps going and does not open Live); `opened` is "Opened in Live" with "Done", or "Restored <file>" and the app's
note when Live could not be opened; `failed` keeps the form with the app's reason above it. When the file was in the way
(`failed.existing`) and the app has a free name (`failed.suggestion`, a branch name), "Use <name>" refills the field and
asks `validate_branch_name` like an edit; when `existing` is the open set's path (`Snapshot.open.path`) the line says
"Live has <file> open. Restore under another name." instead. The restore never waits for the file: a file Live holds
never frees up for a restore, so the screen names it and offers the other name. "Cancel", "Close" and "Done" are all
`cancel_restore`, and Esc is the same until a restore runs (then it only hides the panel).

**The backfill window's screens** (`src/backfill/`). The window's webview holds no run: the Rust side owns it
and pushes the whole `BackfillView` as `dit://backfill`, which `backfill/store.ts` keeps through the same
`createPushedStore` the panel's snapshot uses (and shares unchanged parts between pushes, `share.ts`, so a set that
did not change does not render again). `BackfillWindow` (`window.tsx`) shows the step `view.step` names (`find.tsx`,
`check.tsx`, `run.tsx`, `done.tsx`) inside one `Frame` (`frame.tsx`: the step names, the folder list on the left, the
chosen folder on the right, the footer). Every command goes through `actions.ts` (`callBackfill`); a refusal is the line
at the top of the right pane (`reported.ts`), and the new view arrives as the event, never as an answer. The window
keeps only what the app does not: which found folders are **unticked** (folders are ticked until unticked, so one that
turns up mid-search arrives ticked), sent as the ticked paths with `backfill_check`. `model.ts` is the pure copy: the
state lines ("12 of 41 sets", "3.1 of 8.4 GB"), the storage line, the readout, and the picker options and the
`BackfillTarget` each pick means (a matched set keeps its session's track; "New session" on a matched set is a new
session on that session's track, else on the folder's new track). The folder list (`folder-list.tsx`) is one listbox for
every step and owns `↑/↓`, `Home`, `End`, `Space` and `↩`; `keys.ts` is the window's keymap (`⌘O`, `⌘↩`, `⌘[`, `Esc`,
each on only in the steps that use it). `picker.tsx` is the one combobox. Layout and the keys' rationale are in
`DESIGN.md`, "The backfill window (dit)".

**The socket.** The app claims `dit_ipc::default_path()` (`~/Library/Application Support/dit/dit.sock`) at start and
answers the cli through `dit_cli::handle` (see "The local socket"); a second instance sends `show-panel` to the
first and exits.

**The machine.** What the app does with the Mac it runs on is one Rust module each in `src-tauri/src/` (the pure
parts are unit-tested; the plugin and OS calls are checked by hand, see the PR's manual checks) and `core/machine.rs`
joins them to the snapshot. The settings the config does not hold (`shortcutError`, `autostart`, `cliInstalled`) are
the `Host` the core keeps, read again on every panel show and each minute; the first-run memory ("start at login was
switched on", "Live's script was installed", "Screen Recording was asked") is `AppState` in `app-state.json` beside the config.

- _Global shortcut_ (`shortcut.rs`, `tauri-plugin-global-shortcut`). `accelerator(recorded)` turns the recorder's
  string into the plugin's: modifiers in the order Ctrl, Alt, Shift, Super, then the key; `Mod`, `Cmd` and `Command`
  are Super; a key with no Ctrl, Alt or Super is refused (F1 to F24 excepted), as is a chord or a second key. The
  chosen shortcut is saved whether or not it registers; one another app holds is the `set_setting` rejection and stays
  in `Settings.shortcutError` until a shortcut registers. The shortcut toggles the panel.
- _Start at login_ (`login_item.rs`, `tauri-plugin-autostart`, `MacosLauncher::LaunchAgent`). The setting is the
  LaunchAgent `~/Library/LaunchAgents/<identifier>.plist`, read each time, never a config key. It is switched on once,
  after the first successful sign-in, and then only by the person. Under a `.dev` identifier it is never on and
  `set_setting autostart` rejects.
- _Live's script_ (`core/machine.rs`, `core.rs`). The first signed-in run installs the script once, with no prompt
  (`install_script_once`: `ScriptKit::install`, remembered in `AppState.scriptOffered`; a failure is a notice, and
  "Reinstall" in settings is the retry; with Live not installed nothing is installed or remembered, so a later run
  does). `Core::script_facts` reads whether Live is installed (`daw_app::is_installed`, by bundle identifier), whether
  the script is and where, and `Reducer::set_script` turns them into `Snapshot.script`: `connected` (the script said
  hello) over `live-not-found` over `installed` over `not-installed`, with `path` the install folder while installed.
- _Sign in and out_ (`auth.rs`, `Core::sign_out`). A sign-in that fails with the instance's certificate untrusted
  (`RemoteError::Certificate`, matched by variant) reads "<host> uses a certificate this computer doesn't trust.
  Install the instance's certificate and try again."; every other failure keeps dit-core's line, which is the cli's.
  The app's sign-out forgets the sign-in on this computer and ends its session on the instance by removing the
  machine (no separate `POST /api/auth/sign-out`): `DELETE /machines/:id` revokes the machine's session on the hub,
  so the cli on this computer is signed out too and the next sign-in registers a new machine. In order,
  `auth::forget_sign_in` detaches the hub from the daemon (`Core::stop_pushing`, which waits for it so no beat can
  register the machine again), removes this computer from the account's machines (`DELETE /machines/:id`,
  `dit_core::remote::remove_machine`; a failure becomes a notice and never blocks the sign-out), forgets the machine
  id (`forget_machine_id`) and deletes the token. The instance stays in the config, saves keep being recorded and the
  cli's `login` and `logout` continue to work independently.
- _The bar's arc_ (`arc.rs`, `tray.rs`). The title has no glyph for a push in flight (`Snapshot::title` leaves the
  formatter's `pushing` off; `Snapshot::label` keeps it, so the accessibility label says "pushing"). Instead the icon
  is a progress arc while `Snapshot.push.progress` is set: `PushProgress` is the repos of the current burst that have
  finished over the repos wanted since the hub was last caught up (the reducer's `burst`: repos added on a want or a
  start, cleared when none is waiting or going; a repo that stopped waiting or failed counts as done). `arc::step`
  picks one of eight template images (the repo going counts as half done), `arc::frame` draws it in Rust at start-up
  (black, the shape in the alpha) and `tray::Shown` swaps the icon when the step changes. The dit icon itself is the
  retired scanner's tray icon (credited in `tray.rs`).
- _Notification_ (`notify.rs`, `tauri-plugin-notification`). One action type, `render`, with "Add as version", and
  `notify_render(app, id, title, body)`, which the core calls once for each render the first time it is proposed ("New
  bounce: <file>", the set and the length as the body; see _Renders_ below). The action runs `Core::accept_render`, the
  function the `accept_render` command runs, so both light up together; a click on the notification shows the panel.
  macOS reports an action by its title, so both id and title name it; the render's id travels as text in the
  notification's extras.
- _Links_ (`deep_link.rs`, `tauri-plugin-deep-link`). `projammr` is in `plugins.deep-link.desktop.schemes`, which the
  bundler turns into `CFBundleURLTypes`; `tauri.dev.conf.json` empties it. `get_current` at start and `on_open_url`
  hand every link to `Core::link`, which holds it until the daemon's launch catch-up is done. The daemon has no event
  for that, so the core sends `Input::AddRepo` for a path no repo is at (`LAUNCH_PROBE`) once the daemon starts: the
  worker takes its inputs in order, so the `RepoUnreachable` it answers with comes after the catch-up of every repo
  (a test runs a real daemon to show it), is not shown to the panel, and releases the queue. A link then always shows
  the panel with key focus, which is what makes the browser tab that sent it blur and so count as answered.
  `session/<id>` finds the repo whose `.dit/refs/remote/<set>.json` records hub session `<id>` on the signed-in
  instance (`session_file`) and opens the file in the DAW (`daw_app.rs`, below); no such repo is the notice "Not
  tracked by dit on this computer.". `dit/checkout/<commit id>` shows the restore screen (see _Restore_ below);
  anything else is a notice.
- _Opening in the DAW_ (`daw_app.rs`). The DAW module names its bundle identifiers (`Daw::bundle_ids`, Live's is
  `com.ableton.live`); `NSWorkspace.URLForApplicationWithBundleIdentifier` finds the installed app and the file is
  opened with `open -a <app> <file>`, so a set opens in the DAW that wrote it and not in whatever owns the extension.
  A DAW that is not installed is the line "Live wasn't found. <file> is at <path>." Every Open-in-Live path (the
  `session/<id>` link, the restore) goes through it.
- _Renders_ (`core/renders.rs`, `renders.rs`). `start_daemon` gives the daemon `RenderOptions` from `UserConfig`
  (`max_upload_mb`, `watch_roots`, `excluded`; the ledger is `renders.json` beside the config), so the
  engine runs while a hub is attached and `Core.render_control` holds its `RenderControl` for as long: `accept_render`,
  `reject_render` and `dit renders` over the socket (`dit_cli::handle`'s fourth argument) call it. A hub attached or
  detached (`reconcile`) seeds or clears `Snapshot.renders`; `DaemonEvent::Render` folds into it by id (a rejected card
  leaves, `added` ones from before this run never show, the newest three of this run stay) and `derive_renders` adds
  what only the app knows: the file's length (`probe`, read once per file), the matched set and the other sets of its
  repo that are hub sessions (`otherSets`, the "Not this set" picker); `bouncedAfterMs` and `reasonKinds` arrive
  directly on `dit_daemon::RenderEvent`. The bar's `♪` is `bar::waiting_renders` over the
  cards: proposed and over-limit. Changing `watchRoots`, `excluded` or `maxUploadMb` in settings reaches the running
  engine through `set_render_scope` and `set_render_max_upload_mb` (a root that is not a folder is refused before it is
  saved). `notify_render` is called once per render id, when it first becomes `proposed` (`renders::Announced`; the
  renders there already were when the hub was attached never notify), and the action runs `Core::accept_render`.
  There is no per-set rejection in the engine: "Not this set" is `accept_render` with another set's session, and
  `reject_render` takes only `not-a-bounce` and `never-here`. Settings lists what the engine never looks in (the
  built-in names, which the daemon keeps private, are listed in `renders.rs` and a test asks the daemon's own rule
  about each, plus the DAWs' managed subfolders), the files marked "Not a bounce" (the ledger keeps a fingerprint, so a
  file is named only while the ledger still holds a render of it) and the folders marked "Never here"; `forget_rejection`
  and `forget_never_here` edit the ledger under its lock. The engine reads rejected fingerprints from the ledger for each
  file, but keeps the never-here folders in a filter it builds when it starts, so `forget_never_here` re-attaches the
  hub to give it a new one.
- _Restore_ (`core/restore.rs`, `restore.rs`). The checkout link sets `pendingRestore` and a thread reads `GET
/commits/:id` for the message, the session's name and the default branch (`restore-` and seven hex digits); a commit
  the account cannot read is "That link isn't one of yours." and one no tracked repo holds is "Not tracked by dit on
  this computer." (`restore::locate`, the same test the core's `restore` applies). `restore {commitId, name}` refuses
  the name in the core's words first (`restore::check_branch_name` is the core's private `check_branch_name` and the
  refusal of `main`; a test holds it to the core's answer on a real repo for a table of names; `validate_branch_name`
  is the same check for the field), then runs `dit_core::remote::restore` on a thread: its `Progress` is `fetching`
  then `writing` (with the file the core will write, `<set> @<branch>.als`, worked out the way the core names it) in
  `Snapshot.restore`, and the end is `opened` (the file was opened in Live, or `note` says why not) or `failed`. A
  failure is the core's message, except that a taken name is data: `BranchExists` and `BranchFileExists` give a
  `message` without the name to try, `suggestion` (the core's free branch name) and, for the file, `existing` (its
  path). The core creates the new file with `create_new`, so a restore never overwrites a file, whatever Live has open,
  and never waits for one: the screen compares `existing` with the open set and offers `suggestion`. The core's `restore` cannot be stopped, so `cancel_restore` before it runs lets the link go and
  after it only closes the screen: the branch is still written and pushed, Live is not asked to open it, and a notice
  says so.
- _Playing a file_ (`media.rs`). The asset protocol is on with an empty scope and the CSP allows `asset:` in
  `media-src`; `allow_media(path)` adds one canonical audio file that sits under the home folder or a tracked repo.
- _Artwork_ (`art.rs`). The `dit-art` scheme answers `dit-art://localhost/static/<asset path>[?w=<width>]` with the
  hub's `/static/` file, fetched with the bearer token that never reaches the webview. Only `/static/` with no `.`,
  `..`, empty or backslash segment (however percent-encoded) and a query of `w` and `format` alone is passed on; every
  failure is a bare 404, the response is `no-store`, and it allows any origin so the panel can read the pixels.
  `artUrl` in `src/ipc.ts` builds the URL.
- _Screen Recording_ (`permissions.rs`). Asked once, on the first signed-in run; `request_screen_recording` asks the
  first time and, once macOS has been asked, opens System Settings at the pane (macOS never prompts twice).
  `Permissions.screenRecording` is read on each panel show and each minute.
- _The dit command_ (`cli_install.rs`). `install_cli` runs `ln -sf` of the bundled `dit` (beside the app's own
  executable) to `/usr/local/bin/dit` through `osascript`'s administrator prompt; `Settings.cliInstalled` is the link
  path when it points at this bundle's `dit`. A development build refuses.
- _Updates_ (`update.rs`, `tauri-plugin-updater` with its `rustls-tls` default, whose provider the app installs as ring).
  The feed is `plugins.updater` in `tauri.release.conf.json` alone: the endpoint
  `https://github.com/backshelf/projammr/releases/latest/download/latest.json`, the public half of the signing key
  (the private half and its password are the release secrets `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; losing either ends updates for every install) and, beside it,
  `bundle.createUpdaterArtifacts`, which makes `tauri build` write `dit.app.tar.gz` and its `.sig` and demand the
  secret. The base config and `tauri.dev.conf.json` carry none of it, so `bun run dev` and a local `bun run package`
  need no key and have no updater: `update::plugin` registers the plugin only when the config has `plugins.updater`, and
  no `Updates` is made or managed without it (`install_update` then rejects with "This build doesn't update itself.").
  `Updates::watch` checks once at launch and then each six hours by the wall clock (a minute tick compares
  `SystemTime`, so a Mac that slept past the time checks on waking); `check` stores the `Update` it finds and puts
  `Snapshot.update` (`UpdateState`: `none`, `available {version}`, `installing {version}`, `failed {version, message}`)
  in the reducer through the `Shell` trait, which `Core` implements. A feed that cannot be read changes nothing. Only the
  click starts an install: `install_update` takes the held `Update`, shows `installing` ("Updating…"), and a thread
  downloads it (the plugin verifies the minisign signature against the pubkey as the download ends), waits until
  `Snapshot::is_idle`, installs (the plugin verifies again, then swaps the `.app` in place) and relaunches with
  `Core::restart`, so the exit runs `shutdown` and the daemon stops cleanly. A failure at any step leaves the running
  app untouched, shows `failed` with "Couldn't update to <version>. Try again later." under the still-offered item, and
  the next click tries again; a second click during an install is no second one. **Idle** is `Snapshot::is_idle`: no
  push in flight (`push.state` is not `pushing`) and none about to start (`idle` with `pending` above 0); a push that
  is `waiting` for an unreachable hub or `failed` does not hold the update, because the relaunch derives its pushes
  again. The backfill joins the wait by adding its `running` state to that one predicate (a paused run counts as idle).
  The tests run the real plugin on tauri's mock runtime against a loopback `latest.json` and a bundle signed with a key
  made for the test, installing into a throwaway `Fake.app`. The panel's menu reads `Snapshot.update` through
  `UpdateProvider` (`update-offer.tsx`): "Update to 0.10.0" with the failure line under it, "Updating…" disabled, and
  nothing when there is no update. It shows signed out too.
- _Waking and sleeping_ (`wake.rs`). An `NSWorkspaceDidWakeNotification` observer calls `Running::wake`, which beats
  to the hub at once; an `NSWorkspaceWillSleepNotification` observer calls `Core::sleep`, which pauses a backfill run.
- _The backfill_ (`backfill.rs`, `backfill/`, `core/backfill.rs`, `backfill_window.rs`). Rust owns the run and the
  window's state; the window is a view. `Backfill` holds the roots, the folders `find_projects` and `project_facts` list
  as the walk finds them (`find.rs`), what Check read of each ticked folder (`check.rs`: `run::check` into each
  `.dit/`, then the account's projects, `propose::read` and `propose::propose` per project, and `run::storage`, with
  the person's corrections kept for the next Check) and the run, and `build.rs` makes the whole `View`
  (`view.rs`, mirrored in `src/backfill-ipc.ts`; `fixtures/backfill.json` is round-trip tested on the Rust side in
  `view.rs`, while `src/backfill/test-support.ts` loads it as `BackfillView`) that goes out as `dit://backfill`
  at most ten times a second. The step is `find`, `check`, `bring-in` or `done`; a folder stays chosen whenever any is
  listed. The run is an `Engine` (`engine.rs`: the daemon's `Driver` with `Owner` calling the app's daemon, `Running::hold`
  before a folder is touched and `Input::AddRepo` once it is done), so the tests run it with a scripted one. `Backfill`
  is also the `BackfillControl` `Core::run_for_cli` hands `dit_cli::handle`: a cli run and the window's are one run,
  every event folded into the one view, and `status()` is the state file's. Commands (`commands.rs`): `open_backfill`,
  `get_backfill`, `backfill_roots`, `backfill_find`, `backfill_choose`, `backfill_check`, `backfill_set_target`,
  `backfill_set_project`, `backfill_back`, `backfill_start`, `backfill_pause`, `backfill_resume`, `backfill_retry` (the
  failed folder's sets are proposed again, a session the hub no longer lists becoming a new session, and the whole plan
  starts again: every folder not done runs with it) and `backfill_close`. The window (`backfill_window.rs`, label
  `backfill`, `backfill.html` as the second Vite entry, in the capability's `windows`) is one at a time, 1040 by 700,
  brought forward on reopen. Closing it (its `Destroyed` event, on a thread of its own, since removing a `.dit/` can
  take a while) on Find or Check forgets everything and removes the `.dit/` folders Check made; on Bring in it pauses
  the run, and the next window opens on the paused run (`Backfill::open` reads the state file: a run with folders to do
  is `bring-in`, a finished one with a failure is `done` until it is closed). Sleeping pauses it; so does quitting:
  `Core::shutdown` has `Backfill::shutdown` forget Find and Check and pause the run, asking again every 100 ms for up
  to 15 s until it stops, before the socket and the daemon go. `Snapshot.backfill` (`running` or `paused`, null with no
  run or all folders finished) is the panel menu's second line under "Bring in projects…" (`backfill-item.tsx`; the
  repos screen's first-run button opens the same window) and makes `Snapshot::is_idle` false while a run goes; a run a
  quit left stopped is `paused` from launch.
- _The hub_ (`core/hub.rs`). The account's projects fill the adopt offer's picker (`AdoptOffer.projects`) and, with
  each project's repos, tell the repo list which project a hub repo is in, so `RepoRow.webPath` is
  `/project/<id>/repo/<id>`. `adopt {folder, projectId}` tracks the folder and, with a project chosen, runs `dit push
--project <name>` once the daemon reports it tracked. It also starts `Snapshot.adopting` (`Reducer::begin_adopting`):
  the folder's sets (`FolderFacts.sets`, the file stems `find_sets` gives) as `saving`, each flipping to `saved` on its
  `DaemonEvent::SaveRecorded { origin: Adopt }`, and the list goes when every set has landed. A set that stays torn
  would keep it, so `adopt` also sends the daemon an `Input::AddRepo` for a path no repo is at (`ADOPT_PROBE` and the
  folder's path, the launch probe's trick): its `RepoUnreachable` answer comes after everything adopting records and
  ends the list whatever has not landed (the watcher records such a set when it settles).
- _The set's facts_ (`readout.rs`, `reducer.rs`). The reducer reads the open set's branch through `Readout::read`
  into one `SetReadout`, and `derive` turns it into the snapshot's saves (each with its `SetMeta`), the head
  commit with the hub's word on it (`HeadCommit.push`), `firstCommit` (no commit of the user's: a checkpoint is the
  app's own), `headMeta` and `latestMeta`, and `clauses` and `tracksChanged` from `Repo::diff` and `summary_clauses`,
  kept for the last pair of saves they were worked out for. `liveTracks` is the script's latest `tracks` message
  (kept per document, shown only while the script names the open set, with `#rrggbb` track colours resolved through
  `Daw::track_colour` in `readout.rs`). The draft is held per set path in the reducer; `set_draft` updates it without sending a
  snapshot, `commit` empties it.
- _The set's session_ (`core/set_hub.rs`). The set is a hub session once a push has recorded it
  (`PushedSet.session_id`, the readout's `session_id`). On an open, a commit or a push the core reads `GET
/sessions/<id>` on a thread of its own (a request while one runs is queued, never dropped) for the cover
  (`Snapshot.artwork`, `OpenSet.webPath` = `/project/<p>/session/<id>`) and the session's track. A session with no
  track whose set has no commit of the user's gets `Snapshot.trackProposal`: the project's unarchived tracks
  (`GET /projects/<p>/tracks/summary`) whose titles read like the set's name or its folder's
  (`dit_daemon::backfill::propose::track_ranking`, best first, five at most) and the title of a new track, the folder's name without ` Project`. `propose_track {set,
track}` takes a choice's id or `new`; it makes the track (`POST /tracks {projectId, title}`) and links it
  (`PATCH /sessions/<id> {trackId}`), unless the session has a track by then.
- _Track a folder_ (`core/hub.rs`, `plan_folder`). `track_folder {folder}` turns a folder the menu's picker chose into
  the adopt offer (the same `AdoptOffer` the daemon raises for an open set), declined folders included: adopting
  forgets the decline. A folder already in the repo list is refused, and one that holds a `.dit` the list does not
  know is added and tracked with `Input::AddRepo`.

**The dev identifier.** `tauri.dev.conf.json` sets the identifier `app.projammr.dit.dev`, so a `tauri dev` run keeps
its own config folder (`config.toml`, `repos.toml`, `app-state.json` and its own `dit.sock`) and never starts at login;
it can run beside an installed build without sharing its settings or socket, while still sharing the `dit` Keychain
service (`remote.rs` calls `dit_core::remote::system_tokens()`). The installed app's identifier is `app.projammr.dit`.

**Signing.** A pull request's CI build is signed ad hoc (`signingIdentity "-"`), so every build has a new code identity
and the Keychain and the Screen Recording grant ask again after each rebuild. A release build is signed with one
self-signed identity, `app.projammr.dit` (10 years, code-signing usage): `dit-app-package.yml` with `release: true`
imports the p12 from the secrets `DIT_SIGNING_P12` and `DIT_SIGNING_P12_PASSWORD` into a temporary keychain, puts it on
the search list and builds with `APPLE_SIGNING_IDENTITY=app.projammr.dit`, which overrides the config's `"-"`; Tauri
signs the bundled `dit`, the app's binary and the `.app`, inside out, with it, and a step asserts
`Authority=app.projammr.dit` on the app and on `Contents/MacOS/dit` and runs `codesign --verify --strict --deep`. The
import is the workflow's own and the secrets are not named `APPLE_CERTIFICATE*` because Tauri's import resolves only
Apple-named identities. The certificate is not trusted (`find-identity -v` lists none) and `codesign` signs with it by
name regardless. Every release carries the same identity, so an update keeps the Keychain item and the Screen
Recording grant; a Mac's daily-driver build can import the same p12 (`apps/dit-app/CLAUDE.md` has the steps) and share
them. Developer ID signing and notarisation are not set up, so the first open of a downloaded dmg needs Gatekeeper's
Open Anyway. The update bundle has a second, separate signature: the minisign key made with
`bunx tauri signer generate`, whose public half is committed in `tauri.release.conf.json` (see _Updates_).

## The wasm module

`crates/dit-wasm` builds `dit.wasm` with `cargo build -p dit-wasm --target wasm32-unknown-unknown --release`. It
follows the ABI rules of `dsp.wasm` (numbers only, host-allocated buffers, results read through a pointer and length
pair, a version constant the loader checks), and every export is in `src/lib.rs`. The host gunzips a set file
before `dit_parse` and gzips after `dit_materialise`: the module has no zlib.

| Export                                                | Does                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| `dit_abi_version() -> u32`                            | `ABI_VERSION` (1); changes with any export's name, signature or meaning      |
| `dit_last_error() -> u32`                             | the code the most recent export recorded                                     |
| `dit_alloc(bytes) -> *mut u8`, `dit_free(ptr, bytes)` | host-filled memory; `dit_alloc(0)` or an impossible size is null and error 4 |
| `dit_parse(daw, xml, len) -> u32`                     | the `SetMeta` JSON (`serde_json::to_vec`) of a decoded document, as a handle |
| `dit_materialise(daw, pack, len, tree, side) -> u32`  | the document bytes of a stored save, as a handle                             |
| `dit_result_ptr(h)`, `dit_result_len(h)`              | a result's bytes, valid until it is freed                                    |
| `dit_result_free(h) -> u32`                           | 1 when it freed a result, 0 for an unknown handle                            |

`daw` is the position in `dit_daws::registry().all()` (built once), `tree` and `side` point at 32-byte object ids.
The parse and materialise exports return a handle, 0 on failure. Every fallible export sets the last error, 0 on
success. Codes: 0 none, 1 malformed (`DawError::Malformed`), 2 corrupt (`DawError::Corrupt`, and every
`StoreError`: a missing, altered, malformed or truncated object), 3 unsupported (`DawError::Unsupported`), 4 bad
argument (a null pointer with a non-zero length, an unknown daw index or an unknown handle). A null pointer with
length 0 is empty input, which is how the host passes an empty buffer. The last error is per thread, which on wasm
is the one thread.

**The pack** (`src/pack.rs`) holds every object the tree reaches (the Tree, its leaves and their chunks, and the
side list Blob) as records `[id 32 bytes][kind u8][body length u32 LE][body]`, the body uncompressed. `Pack::parse`
refuses a record cut short, an unknown kind byte, and a body whose `ObjectId::of(kind, body)` is not its id (all
error 2), then serves `ObjectRead::get`, where an absent id is `StoreError::Missing`. `Pack<'a>` borrows its bodies
as slices of the input, so parsing copies none of them; `get` copies one body out for `dit_core`'s `read_tree`.
`dit_materialise` hands the pack to `dit_core::materialise_xml`.

`@workspace/dit/wasm` compiles `dit.wasm` once per process (`compileDit()`, cached) and `loadDit()` makes a fresh
instance from it each call, with the ABI check on every instance. WebAssembly memory never shrinks, so a caller that
rebuilds large sets takes an instance per use and drops it, as the server's `lib/dit.ts` does for the commit
download: it builds the pack from the hub's stored objects in one buffer and calls `Dit.materialise`. `src/test-pack.ts` builds a valid tree of Text leaves around any XML
(`buildObjects`, `buildPack`) for `wasm.test.ts` and the server's tests. `src/pack.ts` makes the hub's wire pack from
objects as dit stores them (`objectRecord`: zstd level 3 of the kind byte and body, named by their SHA-256;
`recordBytes`, `packOf`), for the server's tests (`apps/server/src/test/dit-objects.ts` re-exports it) and the demo's
seed (`packages/demo`'s `dit-history.ts`).

**Handles.** Results live in one table, `Mutex<HashMap<u32, Vec<u8>>>`, behind a counter that starts at 1, so 0 is
never a handle. Freeing removes the entry.

**Features.** The normal build depends on `dit-core` and `dit-daws` with `default-features = false`: no `zstd`, no
`libz-sys` (check with `cargo tree -p dit-wasm -e normal --target wasm32-unknown-unknown`). The dev-dependencies
turn `store` and `gzip` back on so native tests can decode the Ableton fixture and record it into a real store. The
root `Cargo.toml` gives the package `opt-level = "s"`, `codegen-units = 1` and `strip = true` in the release profile
(about 1.0 MB stripped, 847 KB after `wasm-opt -Oz`, 331 KB gzipped). The workspace `regex` dependency turns off
default features and keeps `std` and `perf`, so no Unicode tables are linked (`cargo tree -e features -i regex`
shows no `unicode` feature); a pattern that needs one, such as `(?i)` or `\w` in Unicode mode, does not compile.
`mask.rs` uses `(?-u)` and `backups.rs` makes only the `als` extension case-insensitive with `(?i-u:als)`. There is no
workspace-wide `panic = "abort"` or `lto` because that would change the cli's build, and a panic already traps on
`wasm32-unknown-unknown`.

### Loader and build

`bun run --filter @workspace/dit build` runs `scripts/build-wasm.ts`: `cargo build -p dit-wasm --release --target
wasm32-unknown-unknown`, then `wasm-opt -Oz` (dsp's `--enable-*` list without simd) into `pkg/dit.wasm`
(gitignored), then a gate that throws when the gzipped module is over 1 MiB. It prints the raw and gzipped sizes.
Needs `wasm-opt` 116 or later on PATH.

`src/wasm.ts` is the server-only host (exported as `@workspace/dit/wasm`). `loadDit()` reads `pkg/dit.wasm`
beside the package, compiles and instantiates it synchronously (one instance per call), and checks
`dit_abi_version()` against `ABI_VERSION`; a mismatch throws naming both, and a missing file throws with the build
command. `Dit` has two methods: `parse(daw, xml)` takes the gunzipped XML and returns `SetMeta`; `materialise(daw,
pack, treeId, sideId)` takes a pack and two 32-byte ids and returns the XML bytes for the caller to gzip. `daw` is
a name from `DAWS` (`"ableton"` = index 0, the registry order). Both copy their inputs into `dit_alloc` memory and
free it, copy the result out and free its handle. A failing export throws `DitError` carrying `code`
(`DitErrorCode`: 1 malformed, 2 corrupt, 3 unsupported, 4 bad argument).

`src/wasm.test.ts` reads `crates/dit-wasm/src/lib.rs` as text and compares its `ABI_VERSION` with the TypeScript
constant, parses the Ableton fixture, builds packs by hand (a Blob for the XML, a Blob for the empty side list, a
Tree of Text leaves) to round-trip `materialise` with one leaf and with two, and checks a flipped body byte is a
corrupt `DitError`. Turbo has `@workspace/dit#build` (inputs the crates, outputs `pkg/**`) and `@workspace/dit#test`
(uncached, after `build`); the package's `test` script runs `cargo test --workspace` then `bun test`, and `lint`
runs `cargo fmt --check`, clippy and eslint.

## Commands

`cargo` resolves its toolchain only inside a directory holding the pin, so run it from `packages/dit`.

```bash
bun run --filter @workspace/dit build   # scripts/build-wasm.ts: pkg/dit.wasm
bun run --filter @workspace/dit lint    # scripts/lint.ts: fmt --check, clippy -D warnings, eslint
bun run --filter @workspace/dit test    # cargo test --workspace, then bun test (needs pkg/dit.wasm)
bun run --filter @workspace/dit format  # cargo fmt
```

`lint` goes through `scripts/lint.ts` because CI's `lint:ci` has turbo append `--max-warnings 0` to every
workspace's `lint` script, which cargo would reject; the script ignores its arguments.
