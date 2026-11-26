//! The daemon: everything the dit app does with repos, as one state machine.
//!
//! [`Daemon`] owns every repo mutation: saves recorded when a file settles, checkpoints, segments, adopting. It is
//! fed [`Input`]s and answers with [`DaemonEvent`]s on a channel; nothing in it sleeps or reads a clock but through
//! [`Clock`], so a test drives it with `on_event` and a fake clock. Because the repo's advisory lock is per open
//! file description, the daemon is the single writer of its process: one worker thread calls it (see
//! [`crate::runner`]); commands from the cli arrive on the socket and take the lock like any other process, waiting.
//!
//! What it does with a filesystem event: a top-level set file arms a [`Settle`] (quiet 2 s, then it must decode);
//! a path under `Samples/` arms one only if the latest save of some set references it (quiet 5 s, size and mtime
//! stable); everything under `.dit/` and the DAW's other managed folders is ignored. A settled file is recorded;
//! a torn one goes up the retry ladder, a locked repo is retried every 5 s for a minute and then every 30 s.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc::Sender;
use std::time::{Duration, UNIX_EPOCH};

use dit_core::{Daw, DawError, LogState, ObjectId, Registry, Repo, RepoError, RepoList, Signal};

use crate::Clock;
use crate::catchup;
use crate::checkpoint::{self, Outcome};
use crate::event::{DaemonEvent, Input, OpenSetInfo, Origin};
use crate::fswatch::{FsEvent, Fswatch, Subscription};
use crate::openset::Chain;
use crate::script::{ScriptEvent, ScriptMessage};
use crate::segments::{Event as SegmentEvent, Key, Tracker, Upsert};
use crate::settle::{Probe, Rule, Settle, Verdict};
use crate::title::{self, Window};

/// How long a locked repo is retried every [`LOCKED_RETRY_MS`] before it is called busy and retried every
/// [`BUSY_RETRY_MS`].
const LOCKED_FOR_MS: i64 = 60_000;
const LOCKED_RETRY_MS: i64 = 5_000;
const BUSY_RETRY_MS: i64 = 30_000;
/// How often every key the app has seen open is checked for a checkpoint on a tick.
const CHECKPOINT_EVERY_MS: i64 = 60_000;

pub struct Config {
    pub registry: Registry,
    /// The user's home folder, where the DAWs' own files are looked for.
    pub home: PathBuf,
    /// `repos.toml`: the repos to track.
    pub repos_file: PathBuf,
    pub clock: Arc<dyn Clock>,
    /// How long a repo mutation waits for another process's lock before the daemon retries it itself.
    pub lock_wait: Duration,
}

/// The filesystem watcher the daemon subscribes each repo to.
struct Watching {
    fswatch: Arc<Fswatch>,
    sender: Sender<FsEvent>,
}

struct Tracked {
    repo: Repo,
    /// The sample files the latest save of each working file references, relative to the repo, and the working
    /// files that reference them.
    samples: HashMap<String, Vec<PathBuf>>,
    _subscription: Option<Subscription>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Set,
    Sample,
}

/// A path that is dirty and not yet settled.
struct Slot {
    repo: PathBuf,
    kind: Kind,
    settle: Settle,
    locked_since: Option<i64>,
    told_busy: bool,
}

/// Why recording a settled path stopped before finishing every referencing set.
enum RecordStop {
    Torn,
    Locked,
    Failed(String),
}

/// What recording a settled path came to: every save that succeeded, plus an optional stop on a later file.
struct Recorded {
    saved: Vec<(PathBuf, ObjectId)>,
    stop: Option<RecordStop>,
}

pub struct Daemon {
    config: Config,
    events: Sender<DaemonEvent>,
    watch: Option<Watching>,
    repos: BTreeMap<PathBuf, Tracked>,
    declined: HashSet<PathBuf>,
    offered: HashSet<PathBuf>,
    slots: HashMap<PathBuf, Slot>,
    chain: Chain,
    tracker: Tracker,
    /// The repo each key the tracker has been told of belongs to.
    key_repo: HashMap<Key, PathBuf>,
    /// Spans to write that are not written yet (the repo was locked), the latest of each start.
    pending_segments: HashMap<(Key, i64), dit_core::Segment>,
    open_info: Option<OpenSetInfo>,
    open_key: Option<(Key, Signal)>,
    script_connected: bool,
    log_running: bool,
    windows_running: Option<bool>,
    running: bool,
    last_checkpoint_scan: i64,
    /// The latest save of a branch a checkpoint was declined for, so it is not tried again until another lands.
    declined_checkpoint: HashMap<Key, ObjectId>,
}

impl Daemon {
    /// A daemon with no watcher: it records what it is told about. The runner gives it one with [`Daemon::watch`].
    pub fn new(config: Config, events: Sender<DaemonEvent>) -> Daemon {
        Daemon {
            config,
            events,
            watch: None,
            repos: BTreeMap::new(),
            declined: HashSet::new(),
            offered: HashSet::new(),
            slots: HashMap::new(),
            chain: Chain::new(),
            tracker: Tracker::new(),
            key_repo: HashMap::new(),
            pending_segments: HashMap::new(),
            open_info: None,
            open_key: None,
            script_connected: false,
            log_running: false,
            windows_running: None,
            running: false,
            last_checkpoint_scan: 0,
            declined_checkpoint: HashMap::new(),
        }
    }

    /// Subscribes every repo, now and later, to `fswatch`, whose events arrive on `sender`.
    pub fn watch(&mut self, fswatch: Arc<Fswatch>, sender: Sender<FsEvent>) {
        self.watch = Some(Watching { fswatch, sender });
    }

    fn now(&self) -> i64 {
        self.config.clock.now_ms()
    }

    fn emit(&self, event: DaemonEvent) {
        let _ = self.events.send(event);
    }

    /// Reads the repo list (searching the DAWs' folders for repos the first time), then opens and catches up every
    /// repo in it: a save is recorded, from the file's mtime, for each set that changed while the app was away.
    pub fn launch(&mut self) {
        let registry = &self.config.registry;
        let home = &self.config.home;
        let listed = RepoList::update(&self.config.repos_file, |list| {
            if !list.bootstrapped {
                for daw in registry.all() {
                    let roots = daw.project_roots(home).unwrap_or_default();
                    for root in roots {
                        for repo in catchup::find_repos(&root, daw.managed_subfolders()) {
                            list.add(&repo);
                        }
                    }
                }
                list.bootstrapped = true;
            }
            (list.repos.clone(), list.declined.clone())
        });
        let (repos, declined) = match listed {
            Ok(listed) => listed,
            Err(error) => {
                self.emit(DaemonEvent::RepoError {
                    repo: self.config.repos_file.clone(),
                    message: error.to_string(),
                });
                self.emit(DaemonEvent::Launched);
                return;
            }
        };
        self.declined = declined
            .into_iter()
            .map(|path| path.canonicalize().unwrap_or(path))
            .collect();
        for repo in repos {
            self.track(&repo, Some(Origin::CatchUp));
        }
        self.report_newest_save();
        self.refresh_open();
        self.emit(DaemonEvent::Launched);
    }

    /// Takes one input. A tick also looks at everything that is due.
    pub fn on_event(&mut self, input: Input) {
        match input {
            Input::Fs(event) => self.fs_event(event),
            Input::Script(event) => self.script_event(event),
            Input::LogPolled(state) => self.log_polled(state),
            Input::WindowsPolled(windows) => self.windows_polled(windows),
            Input::Tick => self.tick(),
            Input::AddRepo(path) => self.track(&path, Some(Origin::CatchUp)),
            Input::Adopt(folder) => self.adopt(&folder),
            Input::Decline(folder) => self.decline(&folder),
            Input::Stop => {}
        }
        self.refresh_open();
    }

    /// Looks at every path whose settle is due, writes the tracker's progress, and now and then checks the open
    /// sets for a checkpoint.
    pub fn tick(&mut self) {
        let now = self.now();
        let due: Vec<PathBuf> = self
            .slots
            .iter()
            .filter(|(_, slot)| slot.settle.due(now))
            .map(|(path, _)| path.clone())
            .collect();
        for path in due {
            self.run_slot(&path, now);
        }
        let upserts = self.tracker.handle(SegmentEvent::Tick { now });
        self.apply_upserts(upserts);
        self.flush_segments();
        if now - self.last_checkpoint_scan >= CHECKPOINT_EVERY_MS {
            self.last_checkpoint_scan = now;
            let keys: Vec<Key> = self.key_repo.keys().cloned().collect();
            for key in keys {
                self.checkpoint(&key);
            }
        }
    }

    // ---- repos

    /// Opens a repo and starts watching it. With `catch_up`, records what changed while the app was away.
    fn track(&mut self, path: &Path, catch_up: Option<Origin>) {
        let root = match path.canonicalize() {
            Ok(root) => root,
            Err(error) => {
                self.emit(DaemonEvent::RepoUnreachable {
                    repo: path.to_path_buf(),
                    message: error.to_string(),
                });
                return;
            }
        };
        if self.repos.contains_key(&root) {
            return;
        }
        let repo = match Repo::open(&root, &self.config.registry) {
            Ok(repo) => repo.with_lock_wait(self.config.lock_wait),
            Err(error) => {
                self.emit(DaemonEvent::RepoUnreachable {
                    repo: root,
                    message: error.to_string(),
                });
                return;
            }
        };
        let subscription = self.subscribe(&root);
        self.repos.insert(
            root.clone(),
            Tracked {
                repo,
                samples: HashMap::new(),
                _subscription: subscription,
            },
        );
        self.emit(DaemonEvent::RepoTracked { repo: root.clone() });
        self.resume_tracker(&root);
        if let Some(origin) = catch_up {
            self.catch_up(&root, origin);
        }
        self.reindex(&root);
    }

    fn subscribe(&self, root: &Path) -> Option<Subscription> {
        let watch = self.watch.as_ref()?;
        let dit = root.join(".dit");
        match watch.fswatch.subscribe(
            root,
            move |path| !path.starts_with(&dit),
            watch.sender.clone(),
        ) {
            Ok(subscription) => Some(subscription),
            Err(error) => {
                self.emit(DaemonEvent::RepoError {
                    repo: root.to_path_buf(),
                    message: format!("cannot watch: {error}"),
                });
                None
            }
        }
    }

    /// Tells the tracker the last span each branch has, so spans never overlap across a restart.
    fn resume_tracker(&mut self, root: &Path) {
        let Some(tracked) = self.repos.get(root) else {
            return;
        };
        let mut resumes = Vec::new();
        for (set_id, _) in working_files(&tracked.repo) {
            let branches = std::iter::once("main".to_string()).chain(
                tracked
                    .repo
                    .branch_files(&set_id)
                    .unwrap_or_default()
                    .into_keys(),
            );
            for branch in branches {
                if let Ok(Some(last)) = tracked
                    .repo
                    .segments(&set_id, &branch)
                    .map(|s| s.last().copied())
                {
                    resumes.push((
                        Key {
                            set_id: set_id.clone(),
                            branch,
                        },
                        last,
                    ));
                }
            }
        }
        for (key, last) in resumes {
            self.tracker.resume(key, &last);
        }
    }

    fn catch_up(&mut self, root: &Path, origin: Origin) {
        let Some(tracked) = self.repos.get(root) else {
            return;
        };
        let caught = match tracked.repo.catch_up() {
            Ok(caught) => caught,
            Err(error) => {
                self.emit(DaemonEvent::RepoError {
                    repo: root.to_path_buf(),
                    message: error.to_string(),
                });
                return;
            }
        };
        for (path, result) in caught {
            match result {
                Ok(Some(id)) => self.saved(root, &path, id, origin),
                Ok(None) => {}
                // Torn or busy at launch: the watcher's ladder takes it from here.
                Err(RepoError::Daw(DawError::Corrupt(_))) | Err(RepoError::Locked(_)) => {
                    self.arm(root, &path, Kind::Set);
                }
                Err(error) => self.emit(DaemonEvent::RepoError {
                    repo: root.to_path_buf(),
                    message: format!("{}: {error}", path.display()),
                }),
            }
        }
    }

    fn adopt(&mut self, folder: &Path) {
        let canonical = folder
            .canonicalize()
            .unwrap_or_else(|_| folder.to_path_buf());
        let Some(daw) = self.config.registry.for_project_folder(&canonical) else {
            self.emit(DaemonEvent::RepoError {
                repo: folder.to_path_buf(),
                message: "not a project folder of a DAW dit knows".into(),
            });
            self.emit(DaemonEvent::Adopted { folder: canonical });
            return;
        };
        if let Err(error) = Repo::init(&canonical, daw) {
            self.emit(DaemonEvent::RepoError {
                repo: folder.to_path_buf(),
                message: error.to_string(),
            });
            self.emit(DaemonEvent::Adopted { folder: canonical });
            return;
        }
        let _ = RepoList::update(&self.config.repos_file, |list| list.add(&canonical));
        self.declined.remove(&canonical);
        self.track(&canonical, Some(Origin::Adopt));
        self.emit(DaemonEvent::Adopted { folder: canonical });
    }

    fn decline(&mut self, folder: &Path) {
        let canonical = folder
            .canonicalize()
            .unwrap_or_else(|_| folder.to_path_buf());
        let _ = RepoList::update(&self.config.repos_file, |list| list.decline(&canonical));
        self.declined.insert(canonical);
    }

    /// Rebuilds which sample files the latest saves of a repo reference.
    fn reindex(&mut self, root: &Path) {
        let Some(tracked) = self.repos.get_mut(root) else {
            return;
        };
        let mut index: HashMap<String, Vec<PathBuf>> = HashMap::new();
        for (set_id, rel) in working_files(&tracked.repo) {
            let mut files = vec![("main".to_string(), rel)];
            files.extend(tracked.repo.branch_files(&set_id).unwrap_or_default());
            for (branch, file) in files {
                let Ok(Some(latest)) = tracked
                    .repo
                    .log(&set_id, &branch)
                    .map(|log| log.last().copied())
                else {
                    continue;
                };
                let Ok(save) = tracked.repo.read_save(&latest) else {
                    continue;
                };
                for sample in save.samples {
                    if let Some(relative) = sample.relative {
                        index.entry(relative).or_default().push(root.join(&file));
                    }
                }
            }
        }
        tracked.samples = index;
    }

    /// The repo whose folder holds `path`, the deepest if several do.
    fn repo_of(&self, path: &Path) -> Option<PathBuf> {
        self.repos
            .keys()
            .filter(|root| path.starts_with(root))
            .max_by_key(|root| root.components().count())
            .cloned()
    }

    // ---- filesystem events

    fn fs_event(&mut self, event: FsEvent) {
        let Some(root) = self.repo_of(&event.path) else {
            return;
        };
        let Ok(rel) = event.path.strip_prefix(&root) else {
            return;
        };
        let parts: Vec<_> = rel.components().collect();
        let Some(tracked) = self.repos.get(&root) else {
            return;
        };
        let kind = match parts.as_slice() {
            [] => return,
            [first, ..] if first.as_os_str() == ".dit" => return,
            [file] => {
                let name = file.as_os_str().to_string_lossy();
                let extension = event
                    .path
                    .extension()
                    .map(|ext| ext.to_string_lossy().to_lowercase());
                let is_set = extension.is_some_and(|ext| {
                    tracked
                        .repo
                        .daw()
                        .set_extensions()
                        .iter()
                        .any(|known| known.to_lowercase() == ext)
                });
                if !is_set || name.starts_with("._") {
                    return;
                }
                Kind::Set
            }
            _ => {
                let relative = parts
                    .iter()
                    .map(|part| part.as_os_str().to_string_lossy())
                    .collect::<Vec<_>>()
                    .join("/");
                if !tracked.samples.contains_key(&relative) {
                    return;
                }
                Kind::Sample
            }
        };
        self.arm(&root, &event.path, kind);
    }

    /// Makes `path` dirty now: a new slot, or another event for the one it has.
    fn arm(&mut self, root: &Path, path: &Path, kind: Kind) {
        let now = self.now();
        if let Some(slot) = self.slots.get_mut(path) {
            slot.settle.event(now);
            return;
        }
        let mut settle = Settle::new(
            match kind {
                Kind::Set => Rule::Decode,
                Kind::Sample => Rule::Stable,
            },
            now,
        );
        if kind == Kind::Sample
            && let Ok(meta) = fs::metadata(path)
        {
            settle.observe(meta.len(), mtime_ms(&meta));
        }
        self.slots.insert(
            path.to_path_buf(),
            Slot {
                repo: root.to_path_buf(),
                kind,
                settle,
                locked_since: None,
                told_busy: false,
            },
        );
    }

    fn run_slot(&mut self, path: &Path, now: i64) {
        let Some(mut slot) = self.slots.remove(path) else {
            return;
        };
        let Some(daw) = self.repos.get(&slot.repo).map(|tracked| tracked.repo.daw()) else {
            return;
        };
        let kind = slot.kind;
        match slot.settle.check(now, || probe(daw, path, kind)) {
            Verdict::Wait => {
                self.slots.insert(path.to_path_buf(), slot);
            }
            Verdict::Gone => {}
            Verdict::GaveUp => self.gave_up(&slot.repo, path),
            Verdict::Ready => {
                let recorded = self.record(&slot.repo.clone(), path, kind);
                for (file, id) in recorded.saved {
                    self.saved(&slot.repo, &file, id, Origin::Watch);
                }
                match recorded.stop {
                    None => {}
                    Some(RecordStop::Torn) => match slot.settle.tear(now) {
                        Verdict::GaveUp => self.gave_up(&slot.repo, path),
                        _ => {
                            self.slots.insert(path.to_path_buf(), slot);
                        }
                    },
                    Some(RecordStop::Locked) => {
                        let since = *slot.locked_since.get_or_insert(now);
                        let waited = now - since;
                        if waited >= LOCKED_FOR_MS && !slot.told_busy {
                            slot.told_busy = true;
                            self.emit(DaemonEvent::RepoBusy {
                                repo: slot.repo.clone(),
                            });
                        }
                        let retry = if waited < LOCKED_FOR_MS {
                            LOCKED_RETRY_MS
                        } else {
                            BUSY_RETRY_MS
                        };
                        slot.settle.defer(now + retry);
                        self.slots.insert(path.to_path_buf(), slot);
                    }
                    Some(RecordStop::Failed(message)) => self.emit(DaemonEvent::RepoError {
                        repo: slot.repo.clone(),
                        message,
                    }),
                }
            }
        }
    }

    fn gave_up(&self, root: &Path, path: &Path) {
        self.emit(DaemonEvent::GaveUp {
            repo: root.to_path_buf(),
            file: path.to_path_buf(),
        });
    }

    /// Records a settled path: the set file itself, or every working file that references the sample.
    fn record(&mut self, root: &Path, path: &Path, kind: Kind) -> Recorded {
        let Some(tracked) = self.repos.get(root) else {
            return Recorded {
                saved: Vec::new(),
                stop: None,
            };
        };
        let files = match kind {
            Kind::Set => vec![path.to_path_buf()],
            Kind::Sample => path
                .strip_prefix(root)
                .ok()
                .map(|rel| rel.to_string_lossy().replace('\\', "/"))
                .and_then(|rel| tracked.samples.get(&rel).cloned())
                .unwrap_or_default(),
        };
        let mut saved = Vec::new();
        let mut stop = None;
        for file in files {
            match tracked.repo.record_save(&file) {
                Ok(Some(id)) => saved.push((file, id)),
                Ok(None) => {}
                Err(RepoError::Locked(_)) => {
                    return Recorded {
                        saved,
                        stop: Some(RecordStop::Locked),
                    };
                }
                Err(RepoError::Daw(DawError::Corrupt(_))) => {
                    stop.get_or_insert(RecordStop::Torn);
                }
                // Gone between the settle and the record, or never a set of this repo: nothing to record.
                Err(RepoError::NotASet(_)) => {}
                Err(RepoError::Io(message)) if !file.exists() => {
                    let _ = message;
                }
                Err(error) => {
                    return Recorded {
                        saved,
                        stop: Some(RecordStop::Failed(format!("{}: {error}", file.display()))),
                    };
                }
            }
        }
        Recorded { saved, stop }
    }

    /// A save was recorded: tell the shell and, when it came from the watcher, count the activity, look for a
    /// checkpoint and let the open-set chain know a newer save exists.
    fn saved(&mut self, root: &Path, file: &Path, id: ObjectId, origin: Origin) {
        let Some(tracked) = self.repos.get(root) else {
            return;
        };
        let Ok(save) = tracked.repo.read_save(&id) else {
            return;
        };
        let Ok(Some((set_id, branch))) = tracked.repo.working_file(file) else {
            return;
        };
        let rel = file
            .strip_prefix(root)
            .unwrap_or(file)
            .to_string_lossy()
            .replace('\\', "/");
        self.emit(DaemonEvent::SaveRecorded {
            repo: root.to_path_buf(),
            set_id: set_id.clone(),
            branch: branch.clone(),
            file: rel,
            save: id,
            at: save.file_updated_at,
            unreadable: save.unreadable,
            origin,
        });
        self.reindex(root);
        if origin != Origin::Watch {
            return;
        }
        let key = Key { set_id, branch };
        self.key_repo.insert(key.clone(), root.to_path_buf());
        let now = self.now();
        let upserts = self.tracker.handle(SegmentEvent::Activity {
            at: now,
            key: key.clone(),
        });
        self.apply_upserts(upserts);
        self.chain.report(
            Signal::Saves,
            save.file_updated_at,
            Some(file.to_path_buf()),
        );
        self.checkpoint(&key);
    }

    // ---- segments and checkpoints

    fn apply_upserts(&mut self, upserts: Vec<Upsert>) {
        for upsert in upserts {
            self.pending_segments
                .insert((upsert.key, upsert.segment.start), upsert.segment);
        }
        self.flush_segments();
    }

    /// Writes the spans waiting; one the repo was too busy to take stays for the next try.
    fn flush_segments(&mut self) {
        let pending: Vec<_> = self
            .pending_segments
            .iter()
            .map(|(k, s)| (k.clone(), *s))
            .collect();
        for ((key, start), segment) in pending {
            let Some(root) = self.key_repo.get(&key).cloned() else {
                self.pending_segments.remove(&(key, start));
                continue;
            };
            let Some(tracked) = self.repos.get(&root) else {
                self.pending_segments.remove(&(key, start));
                continue;
            };
            match tracked
                .repo
                .upsert_segment(&key.set_id, &key.branch, &segment)
            {
                Ok(()) => {
                    self.pending_segments.remove(&(key, start));
                }
                Err(RepoError::Locked(_)) => {}
                Err(error) => {
                    self.pending_segments.remove(&(key, start));
                    self.emit(DaemonEvent::RepoError {
                        repo: root,
                        message: format!("segments: {error}"),
                    });
                }
            }
        }
    }

    fn checkpoint(&mut self, key: &Key) {
        let Some(root) = self.key_repo.get(key).cloned() else {
            return;
        };
        let Some(tracked) = self.repos.get(&root) else {
            return;
        };
        let latest = tracked
            .repo
            .log(&key.set_id, &key.branch)
            .ok()
            .and_then(|log| log.last().copied());
        if latest.is_some() && self.declined_checkpoint.get(key) == latest.as_ref() {
            return;
        }
        match checkpoint::run(&tracked.repo, &key.set_id, &key.branch) {
            Outcome::NotDue | Outcome::Busy => {}
            Outcome::Declined => {
                if let Some(latest) = latest {
                    self.declined_checkpoint.insert(key.clone(), latest);
                }
            }
            Outcome::Committed { commit, message } => {
                self.emit(DaemonEvent::Committed {
                    repo: root.clone(),
                    set_id: key.set_id.clone(),
                    branch: key.branch.clone(),
                    commit,
                    kind: dit_core::CommitKind::Checkpoint,
                    message,
                });
                self.reindex(&root);
            }
            Outcome::Failed(error) => self.emit(DaemonEvent::RepoError {
                repo: root,
                message: format!("checkpoint: {error}"),
            }),
        }
    }

    // ---- the open set

    fn script_event(&mut self, event: ScriptEvent) {
        let now = self.now();
        match &event {
            ScriptEvent::Connected { .. } => self.script_connected = true,
            ScriptEvent::Disconnected => {
                self.script_connected = false;
                self.chain.report(Signal::Script, now, None);
            }
            ScriptEvent::Message(ScriptMessage::Document { path, .. }) => {
                self.chain
                    .report(Signal::Script, now, path.as_ref().map(PathBuf::from));
            }
            ScriptEvent::Message(ScriptMessage::Closed) => {
                self.chain.report(Signal::Script, now, None)
            }
            ScriptEvent::Message(_) => {}
        }
        self.update_running();
        self.emit(DaemonEvent::Script(event.clone()));
        // Update `open_key` before stamping activity so switching sets or opening an unsaved set
        // never records a phantom 0 ms segment on the previous set.
        self.refresh_open();
        // Anything the script says is the set being used; the transport says it continuously.
        if let Some((key, _)) = self.open_key.clone() {
            let upserts = match event {
                ScriptEvent::Message(ScriptMessage::Transport { playing, .. }) => {
                    self.tracker.handle(SegmentEvent::Playing {
                        at: now,
                        key,
                        playing,
                    })
                }
                ScriptEvent::Message(ScriptMessage::Closed) | ScriptEvent::Disconnected => {
                    Vec::new()
                }
                _ => self.tracker.handle(SegmentEvent::Activity { at: now, key }),
            };
            self.apply_upserts(upserts);
        }
    }

    fn log_polled(&mut self, state: LogState) {
        let now = self.now();
        self.log_running = state.running;
        self.chain.report(Signal::Log, now, state.set);
        self.update_running();
    }

    fn windows_polled(&mut self, windows: Vec<Window>) {
        let now = self.now();
        let daws = self.config.registry.all();
        self.windows_running =
            (!windows.is_empty()).then(|| daws.iter().any(|daw| title::is_running(&windows, *daw)));
        let known = self.known_sets();
        let named = daws
            .iter()
            .find_map(|daw| title::hint(&windows, *daw))
            .and_then(|hint| title::resolve(&hint, &known));
        self.chain.report(Signal::Title, now, named);
        self.update_running();
    }

    /// Every set file of every tracked repo.
    fn known_sets(&self) -> Vec<PathBuf> {
        let mut known = Vec::new();
        for (root, tracked) in &self.repos {
            for (set_id, rel) in working_files(&tracked.repo) {
                known.push(root.join(rel));
                known.extend(
                    tracked
                        .repo
                        .branch_files(&set_id)
                        .unwrap_or_default()
                        .into_values()
                        .map(|f| root.join(f)),
                );
            }
        }
        known
    }

    fn update_running(&mut self) {
        let running = self.script_connected || self.windows_running.unwrap_or(self.log_running);
        self.chain.set_running(running);
        if running != self.running {
            self.running = running;
            self.emit(DaemonEvent::LiveRunning(running));
        }
    }

    /// The newest save across the repos is a witness for the chain: the set to fall back to.
    fn report_newest_save(&mut self) {
        let mut newest: Option<(i64, PathBuf)> = None;
        for (root, tracked) in &self.repos {
            let Ok(Some((set_id, branch, at))) = tracked.repo.newest_save_at() else {
                continue;
            };
            let file = if branch == "main" {
                tracked
                    .repo
                    .sets()
                    .ok()
                    .and_then(|sets| sets.get(&set_id).cloned())
            } else {
                tracked
                    .repo
                    .branch_files(&set_id)
                    .ok()
                    .and_then(|files| files.get(&branch).cloned())
            };
            if let Some(file) = file
                && newest.as_ref().is_none_or(|(held, _)| at > *held)
            {
                newest = Some((at, root.join(file)));
            }
        }
        if let Some((at, path)) = newest {
            self.chain.report(Signal::Saves, at, Some(path));
        }
    }

    /// Asks the chain which set is open and, when that changed, tells the shell and the tracker.
    fn refresh_open(&mut self) {
        let now = self.now();
        let (winner, held) = self.chain.current_held(now);
        let info = winner.map(|set| {
            let resolved = self.resolve(&set.path);
            OpenSetInfo {
                path: set.path,
                signal: set.signal,
                repo: resolved.as_ref().map(|(root, _)| root.clone()),
                set_id: resolved.as_ref().map(|(_, key)| key.set_id.clone()),
                branch: resolved.map(|(_, key)| key.branch),
            }
        });
        if info != self.open_info {
            self.open_info = info.clone();
            self.emit(DaemonEvent::OpenSet(info.clone()));
            if let Some(info) = &info {
                self.offer_adoption(info);
            }
        }
        // Only a signal that says the DAW has the set open counts as open time: not a newest save, and not an
        // answer only held for a moment after the script said the set closed.
        let wanted = info.and_then(|info| {
            let (root, key) = self.resolve(&info.path)?;
            (info.signal != Signal::Saves && !held).then(|| {
                self.key_repo.insert(key.clone(), root);
                (key, info.signal)
            })
        });
        if wanted == self.open_key {
            return;
        }
        let mut upserts = Vec::new();
        if let Some((old, _)) = &self.open_key
            && wanted.as_ref().is_none_or(|(new, _)| new != old)
        {
            upserts.extend(self.tracker.handle(SegmentEvent::Close {
                at: now,
                key: old.clone(),
            }));
        }
        if let Some((key, signal)) = &wanted {
            upserts.extend(self.tracker.handle(SegmentEvent::Open {
                at: now,
                key: key.clone(),
                source: *signal,
            }));
        }
        self.open_key = wanted;
        self.apply_upserts(upserts);
    }

    /// `(repo, key)` of a set file a tracked repo has registered.
    fn resolve(&self, path: &Path) -> Option<(PathBuf, Key)> {
        let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        let root = self.repo_of(&canonical)?;
        let (set_id, branch) = self
            .repos
            .get(&root)?
            .repo
            .working_file(&canonical)
            .ok()??;
        Some((root, Key { set_id, branch }))
    }

    fn offer_adoption(&mut self, info: &OpenSetInfo) {
        if info.repo.is_some() || info.signal == Signal::Saves {
            return;
        }
        let canonical_path = info
            .path
            .canonicalize()
            .unwrap_or_else(|_| info.path.clone());
        let Some(folder) = canonical_path.parent().map(Path::to_path_buf) else {
            return;
        };
        if self.repo_of(&canonical_path).is_some()
            || self.declined.contains(&folder)
            || self.config.registry.for_project_folder(&folder).is_none()
            || !self.offered.insert(folder.clone())
        {
            return;
        }
        self.emit(DaemonEvent::AdoptOffer {
            folder,
            set: canonical_path,
        });
    }
}

/// What a look at `path` finds, by the rule its kind follows.
fn probe(daw: &dyn Daw, path: &Path, kind: Kind) -> Probe {
    match kind {
        Kind::Set => match fs::read(path) {
            Ok(bytes) => match daw.decode(&bytes) {
                Err(DawError::Corrupt(_)) => Probe::Torn,
                _ => Probe::Whole,
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Probe::Gone,
            Err(_) => Probe::Torn,
        },
        Kind::Sample => match fs::metadata(path) {
            Ok(meta) => Probe::Stat {
                size: meta.len(),
                mtime: mtime_ms(&meta),
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Probe::Gone,
            Err(_) => Probe::Torn,
        },
    }
}

fn mtime_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_millis() as i64)
}

/// `(set id, main file)` of every set of a repo.
fn working_files(repo: &Repo) -> Vec<(String, String)> {
    repo.sets()
        .map(|sets| sets.into_iter().collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc::{self, Receiver};

    use dit_core::{CommitKind, Repo};

    use super::*;
    use crate::script::ScriptTrack;
    use crate::test_support::*;

    const T0: i64 = 1_700_000_000_000;
    const S: i64 = 1000;

    struct Harness {
        _root: tempfile::TempDir,
        home: PathBuf,
        dir: PathBuf,
        repos_file: PathBuf,
        repo: Repo,
        daemon: Daemon,
        events: Receiver<DaemonEvent>,
        clock: FakeClock,
    }

    impl Harness {
        fn set(&self) -> PathBuf {
            self.dir.join("Song.fset")
        }

        fn set_id(&self) -> String {
            self.repo.sets().unwrap().into_keys().next().unwrap()
        }

        fn drain(&self) -> Vec<DaemonEvent> {
            self.events.try_iter().collect()
        }

        fn at(&self, offset_ms: i64) {
            self.clock.set(T0 + offset_ms);
        }

        fn fs(&mut self, path: &Path, removed: bool) {
            self.daemon.on_event(Input::Fs(FsEvent {
                path: path.to_path_buf(),
                removed,
            }));
        }

        /// Writes the set (mtime = the clock) and tells the daemon, as an editor save would.
        fn save_set(&mut self, body: &str) {
            let path = self.set();
            write_set(&path, body, self.clock.now_ms());
            self.fs(&path, false);
        }

        fn recorded(&self, events: &[DaemonEvent]) -> usize {
            events
                .iter()
                .filter(|e| matches!(e, DaemonEvent::SaveRecorded { .. }))
                .count()
        }
    }

    /// A project with its set recorded once, a daemon launched over it, and the launch's events drained.
    fn launched(prepare: impl FnOnce(&Path, &Repo)) -> Harness {
        let (root, dir, repo) = project("Song");
        let home = root.path().canonicalize().unwrap().join("home");
        fs::create_dir_all(&home).unwrap();
        let repos_file = home.join("repos.toml");
        prepare(&dir, &repo);
        RepoList::update(&repos_file, |list| {
            list.bootstrapped = true;
            list.add(&dir);
        })
        .unwrap();
        let clock = FakeClock::default();
        clock.set(T0);
        let (events_tx, events) = mpsc::channel();
        let config = Config {
            registry: registry(),
            home: home.clone(),
            repos_file: repos_file.clone(),
            clock: Arc::new(clock.clone()),
            lock_wait: Duration::from_millis(50),
        };
        let mut daemon = Daemon::new(config, events_tx);
        daemon.launch();
        let harness = Harness {
            _root: root,
            home,
            dir,
            repos_file,
            repo,
            daemon,
            events,
            clock,
        };
        harness.drain();
        harness
    }

    /// The common start: one set, recorded, no commit.
    fn with_recorded_set() -> Harness {
        launched(|dir, repo| {
            write_set(&dir.join("Song.fset"), "v0", T0 - 3_600_000);
            repo.record_save(&dir.join("Song.fset")).unwrap();
        })
    }

    #[test]
    fn a_rename_then_create_save_is_recorded_two_seconds_after_the_last_event() {
        let mut h = with_recorded_set();
        let path = h.set();
        h.at(0);
        // Live renames the old file into Backup/ and creates a new one at the path.
        h.fs(&path, true);
        h.at(100);
        h.save_set("v1");
        h.at(1_000);
        h.daemon.tick();
        assert_eq!(h.recorded(&h.drain()), 0, "still inside the quiet period");

        h.at(2_100);
        h.daemon.tick();

        let events = h.drain();
        let Some(DaemonEvent::SaveRecorded {
            at,
            origin,
            file,
            unreadable,
            ..
        }) = events.first()
        else {
            panic!("{events:?}");
        };
        assert_eq!(
            (*at, *origin, file.as_str(), *unreadable),
            (T0 + 100, Origin::Watch, "Song.fset", false)
        );
        assert_eq!(h.repo.log(&h.set_id(), "main").unwrap().len(), 2);
    }

    #[test]
    fn a_file_that_is_gone_at_the_check_is_forgotten_until_it_comes_back() {
        let mut h = with_recorded_set();
        let path = h.set();
        h.at(0);
        h.fs(&path, true);
        fs::remove_file(&path).unwrap();
        h.at(2_000);
        h.daemon.tick();
        assert!(h.drain().is_empty() && h.daemon.slots.is_empty());

        h.at(2_500);
        h.save_set("v1");
        h.at(4_600);
        h.daemon.tick();
        assert_eq!(h.recorded(&h.drain()), 1);
    }

    #[test]
    fn a_stream_of_events_is_checked_by_ten_seconds() {
        let mut h = with_recorded_set();
        h.at(0);
        h.save_set("v1");
        for second in 1..=12 {
            h.at(second * S);
            let path = h.set();
            h.fs(&path, false);
            h.daemon.tick();
        }
        assert_eq!(
            h.recorded(&h.drain()),
            1,
            "recorded at the 10 s cap while events kept coming"
        );
    }

    #[test]
    fn a_file_caught_mid_write_is_retried_on_the_ladder_and_recorded_once_whole() {
        let mut h = with_recorded_set();
        let path = h.set();
        h.at(0);
        fs::write(&path, b"half a gzip with no marker").unwrap();
        h.fs(&path, false);
        for (offset, expect) in [(2_000, 0), (4_000, 0)] {
            h.at(offset);
            h.daemon.tick();
            assert_eq!(h.recorded(&h.drain()), expect, "torn at {offset}");
        }
        // Torn at 2 s (next look 4 s later), torn at 4 s (next 8 s later), whole by 6 s.
        h.at(6_000);
        write_set(&path, "v1", T0 + 6_000);
        h.at(12_000);
        h.daemon.tick();

        assert_eq!(h.recorded(&h.drain()), 1);
    }

    #[test]
    fn a_file_torn_for_ten_minutes_is_given_up_with_an_event() {
        let mut h = with_recorded_set();
        let path = h.set();
        h.at(0);
        fs::write(&path, b"never whole").unwrap();
        h.fs(&path, false);
        let mut gave_up = false;
        for second in (2..=700).step_by(2) {
            h.at(second * S);
            h.daemon.tick();
            gave_up |= h
                .drain()
                .iter()
                .any(|e| matches!(e, DaemonEvent::GaveUp { .. }));
        }
        assert!(gave_up);
        assert!(h.daemon.slots.is_empty());
    }

    #[test]
    fn a_replaced_sample_records_a_save_once_its_size_has_held_for_five_seconds() {
        let sample = |dir: &Path| dir.join("Samples/k.wav");
        let mut h = launched(|dir, repo| {
            fs::create_dir_all(dir.join("Samples")).unwrap();
            fs::write(sample(dir), b"kick").unwrap();
            write_set(&dir.join("Song.fset"), &with_sample("v0"), T0 - 3_600_000);
            repo.record_save(&dir.join("Song.fset")).unwrap();
        });
        h.at(0);
        fs::write(sample(&h.dir), b"a snare instead").unwrap();
        h.fs(&sample(&h.dir), false);
        // A file nothing references costs nothing.
        fs::write(h.dir.join("Samples/other.wav"), b"x").unwrap();
        let other = h.dir.join("Samples/other.wav");
        h.fs(&other, false);
        assert_eq!(h.daemon.slots.len(), 1);

        h.at(4_999);
        h.daemon.tick();
        assert_eq!(h.recorded(&h.drain()), 0);
        h.at(5_000);
        h.daemon.tick();

        let events = h.drain();
        assert_eq!(h.recorded(&events), 1);
        let log = h.repo.log(&h.set_id(), "main").unwrap();
        let (before, after) = (
            h.repo.read_save(&log[0]).unwrap(),
            h.repo.read_save(&log[1]).unwrap(),
        );
        assert_eq!(before.tree, after.tree, "only the sample changed");
        assert!(!after.view_only);
    }

    #[test]
    fn a_sample_still_growing_waits_until_it_holds_still() {
        let mut h = launched(|dir, repo| {
            fs::create_dir_all(dir.join("Samples")).unwrap();
            fs::write(dir.join("Samples/k.wav"), b"kick").unwrap();
            write_set(&dir.join("Song.fset"), &with_sample("v0"), T0 - 3_600_000);
            repo.record_save(&dir.join("Song.fset")).unwrap();
        });
        let sample = h.dir.join("Samples/k.wav");
        h.at(0);
        fs::write(&sample, b"first").unwrap();
        h.fs(&sample, false);
        h.at(3_000);
        fs::write(&sample, b"first and more").unwrap();
        h.fs(&sample, false);

        h.at(8_000);
        h.daemon.tick();
        assert_eq!(
            h.recorded(&h.drain()),
            0,
            "changed since the event; looked at again in five seconds"
        );
        h.at(13_000);
        h.daemon.tick();
        assert_eq!(h.recorded(&h.drain()), 1);
    }

    #[test]
    fn a_locked_repo_is_retried_every_five_seconds_then_called_busy_and_recorded_when_free() {
        let mut h = with_recorded_set();
        let lock = fs::File::options()
            .write(true)
            .open(h.dir.join(".dit/lock"))
            .unwrap();
        lock.lock().unwrap();
        h.at(0);
        h.save_set("v1");
        h.at(2_000);
        h.daemon.tick();
        assert_eq!(h.recorded(&h.drain()), 0);

        let mut busy = 0;
        for offset in (7_000..=70_000).step_by(5_000) {
            h.at(offset);
            h.daemon.tick();
            busy += h
                .drain()
                .iter()
                .filter(|e| matches!(e, DaemonEvent::RepoBusy { .. }))
                .count();
        }
        assert_eq!(busy, 1, "told once, after a minute");
        assert!(h.daemon.slots.len() == 1, "still trying");

        lock.unlock().unwrap();
        h.at(110_000);
        h.daemon.tick();
        assert_eq!(h.recorded(&h.drain()), 1);
        assert!(h.daemon.slots.is_empty());
    }

    #[test]
    fn a_crash_before_the_sample_cache_was_written_records_nothing_twice() {
        let mut h = launched(|dir, repo| {
            fs::create_dir_all(dir.join("Samples")).unwrap();
            fs::write(dir.join("Samples/k.wav"), b"kick").unwrap();
            write_set(&dir.join("Song.fset"), &with_sample("v0"), T0 - 3_600_000);
            repo.record_save(&dir.join("Song.fset")).unwrap();
        });
        // The app died after the save but before samples.json: the cache is gone.
        fs::remove_file(h.dir.join(".dit/samples.json")).unwrap();
        let (events_tx, events) = mpsc::channel();
        let config = Config {
            registry: registry(),
            home: h.home.clone(),
            repos_file: h.repos_file.clone(),
            clock: Arc::new(h.clock.clone()),
            lock_wait: Duration::from_millis(50),
        };
        let mut restarted = Daemon::new(config, events_tx);

        restarted.launch();

        assert_eq!(
            events
                .try_iter()
                .filter(|e| matches!(e, DaemonEvent::SaveRecorded { .. }))
                .count(),
            0
        );
        assert_eq!(
            h.repo.log(&h.set_id(), "main").unwrap().len(),
            1,
            "the sample read again came out the same"
        );
        assert!(
            h.dir.join(".dit/samples.json").exists(),
            "and the cache is back"
        );
        h.daemon.on_event(Input::Tick);
    }

    #[test]
    fn launch_records_what_changed_while_the_app_was_away_at_the_files_mtime_and_registers_new_sets()
     {
        let h = launched(|dir, repo| {
            write_set(&dir.join("Song.fset"), "v0", T0 - 7_200_000);
            write_set(&dir.join("Steady.fset"), "s0", T0 - 7_200_000);
            repo.record_save(&dir.join("Song.fset")).unwrap();
            repo.record_save(&dir.join("Steady.fset")).unwrap();
        });
        // The app stops; Live saves Song and a new set appears.
        write_set(&h.dir.join("Song.fset"), "v1", T0 - 3_600_000);
        write_set(&h.dir.join("Fresh.fset"), "f0", T0 - 1_800_000);
        let (events_tx, events) = mpsc::channel();
        let config = Config {
            registry: registry(),
            home: h.home.clone(),
            repos_file: h.repos_file.clone(),
            clock: Arc::new(h.clock.clone()),
            lock_wait: Duration::from_millis(50),
        };
        let mut restarted = Daemon::new(config, events_tx);

        restarted.launch();

        let mut saved: Vec<(String, i64, Origin)> = events
            .try_iter()
            .filter_map(|event| match event {
                DaemonEvent::SaveRecorded {
                    file, at, origin, ..
                } => Some((file, at, origin)),
                _ => None,
            })
            .collect();
        saved.sort_by(|a, b| a.0.cmp(&b.0));
        assert_eq!(
            saved,
            [
                ("Fresh.fset".to_string(), T0 - 1_800_000, Origin::CatchUp),
                ("Song.fset".to_string(), T0 - 3_600_000, Origin::CatchUp)
            ]
        );
        assert_eq!(h.repo.sets().unwrap().len(), 3, "the new set is registered");
    }

    #[test]
    fn the_first_launch_searches_the_daws_folders_for_repos_once() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().canonicalize().unwrap().join("home");
        let found = home.join("Projects/Collection/Old Project");
        fs::create_dir_all(&found).unwrap();
        let old = Repo::init(&found, &FAKE).unwrap();
        write_set(&found.join("Old.fset"), "o", T0 - 1_000_000);
        old.record_save(&found.join("Old.fset")).unwrap();
        let repos_file = home.join("repos.toml");
        let clock = FakeClock::default();
        clock.set(T0);
        let (events_tx, events) = mpsc::channel();
        let mut daemon = Daemon::new(
            Config {
                registry: registry(),
                home: home.clone(),
                repos_file: repos_file.clone(),
                clock: Arc::new(clock),
                lock_wait: Duration::from_millis(50),
            },
            events_tx,
        );

        daemon.launch();

        assert!(
            events
                .try_iter()
                .any(|e| matches!(e, DaemonEvent::RepoTracked { repo } if repo == found))
        );
        let list = RepoList::load(&repos_file).unwrap();
        assert_eq!(list.repos, [found]);
        assert!(list.bootstrapped);
    }

    #[test]
    fn a_repo_that_cannot_be_opened_is_reported_and_kept_in_the_list() {
        let h = launched(|_, _| {});
        let (events_tx, events) = mpsc::channel();
        RepoList::update(&h.repos_file, |list| {
            list.add(Path::new("/gone/Away Project"))
        })
        .unwrap();
        let mut again = Daemon::new(
            Config {
                registry: registry(),
                home: h.home.clone(),
                repos_file: h.repos_file.clone(),
                clock: Arc::new(h.clock.clone()),
                lock_wait: Duration::from_millis(50),
            },
            events_tx,
        );
        again.launch();
        assert!(
            events
                .try_iter()
                .any(|e| matches!(e, DaemonEvent::RepoUnreachable { .. }))
        );
        assert_eq!(RepoList::load(&h.repos_file).unwrap().repos.len(), 2);
    }

    #[test]
    fn ten_saves_after_a_user_commit_make_a_checkpoint_and_none_before_it() {
        let mut h = with_recorded_set();
        let set = h.set_id();
        // Ten saves with no user commit yet: none.
        for n in 1..=10 {
            h.at(n * 10 * S);
            h.save_set(&format!("a{n}"));
            h.at(n * 10 * S + 2_100);
            h.daemon.tick();
        }
        let early = h.drain();
        assert_eq!(h.recorded(&early), 10);
        assert!(
            !early
                .iter()
                .any(|e| matches!(e, DaemonEvent::Committed { .. }))
        );

        h.repo
            .commit(&set, "main", "first", "ada", CommitKind::User)
            .unwrap();
        for n in 1..=10 {
            h.at(200 * S + n * 10 * S);
            h.save_set(&format!("b{n}"));
            h.at(200 * S + n * 10 * S + 2_100);
            h.daemon.tick();
        }

        let events = h.drain();
        let committed: Vec<_> = events
            .iter()
            .filter_map(|e| match e {
                DaemonEvent::Committed { kind, message, .. } => Some((*kind, message.clone())),
                _ => None,
            })
            .collect();
        assert_eq!(
            committed,
            [(CommitKind::Checkpoint, "checkpoint \u{b7} 3m".to_string())],
            "the open time since the head's save: the saves' own span"
        );
        assert_eq!(h.repo.saves_since_commit(&set, "main").unwrap(), 0);
    }

    #[test]
    fn an_unreadable_latest_save_gets_no_checkpoint_and_no_error() {
        let mut h = with_recorded_set();
        let set = h.set_id();
        h.repo
            .commit(&set, "main", "first", "ada", CommitKind::User)
            .unwrap();
        for n in 1..=10 {
            h.at(n * 10 * S);
            h.save_set(&format!("<broken/> {n}"));
            h.at(n * 10 * S + 2_100);
            h.daemon.tick();
        }
        let events = h.drain();
        assert_eq!(h.recorded(&events), 10);
        assert!(!events.iter().any(|e| matches!(
            e,
            DaemonEvent::Committed { .. } | DaemonEvent::RepoError { .. }
        )));
    }

    #[test]
    fn the_scripts_open_set_becomes_a_segment_that_grows_with_the_transport_and_ends_at_the_close()
    {
        let mut h = with_recorded_set();
        let set = h.set_id();
        h.at(0);
        h.daemon.on_event(Input::Script(ScriptEvent::Connected {
            live: "12.4.6".into(),
            script: "1".into(),
        }));
        h.daemon.on_event(Input::Script(ScriptEvent::Message(
            ScriptMessage::Document {
                path: Some(h.set().display().to_string()),
                at: T0,
            },
        )));

        let events = h.drain();
        let open = events.iter().find_map(|e| match e {
            DaemonEvent::OpenSet(Some(info)) => Some(info.clone()),
            _ => None,
        });
        let info = open.expect("the open set changed");
        assert_eq!(
            (info.signal, info.set_id.as_deref(), info.branch.as_deref()),
            (Signal::Script, Some(set.as_str()), Some("main"))
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e, DaemonEvent::LiveRunning(true)))
        );
        assert_eq!(
            h.repo.segments(&set, "main").unwrap().len(),
            1,
            "written the moment it opened"
        );

        h.at(S);
        h.daemon.on_event(Input::Script(ScriptEvent::Message(
            ScriptMessage::Transport {
                playing: true,
                recording: false,
            },
        )));
        h.at(60 * S);
        h.daemon.tick();
        assert_eq!(
            h.repo.segments(&set, "main").unwrap()[0].end,
            T0 + 60 * S,
            "playing is continuous activity"
        );

        h.at(90 * S);
        h.daemon
            .on_event(Input::Script(ScriptEvent::Message(ScriptMessage::Closed)));
        let spans = h.repo.segments(&set, "main").unwrap();
        assert_eq!(spans.len(), 1);
        assert_eq!((spans[0].start, spans[0].end), (T0, T0 + 90 * S));
        assert_eq!(
            h.repo
                .time_in_set(&set, "main", i64::MIN, i64::MAX)
                .unwrap(),
            90 * S
        );
    }

    #[test]
    fn script_messages_are_passed_on_for_the_panel() {
        let mut h = with_recorded_set();
        let tracks = vec![ScriptTrack {
            id: 0,
            name: "Bass".into(),
            color: None,
            kind: "audio".into(),
            group_id: None,
            devices: vec![],
        }];
        h.daemon
            .on_event(Input::Script(ScriptEvent::Message(ScriptMessage::Tracks {
                tracks,
            })));
        h.daemon.on_event(Input::Script(ScriptEvent::Disconnected));
        let seen: Vec<_> = h
            .drain()
            .into_iter()
            .filter(|e| matches!(e, DaemonEvent::Script(_)))
            .collect();
        assert_eq!(seen.len(), 2);
    }

    #[test]
    fn with_live_not_running_the_newest_save_is_the_open_set_and_opens_no_time() {
        let mut h = with_recorded_set();
        let set = h.set_id();
        h.daemon.report_newest_save();
        h.daemon.on_event(Input::Tick);
        assert_eq!(
            h.daemon.open_info.as_ref().map(|i| i.signal),
            Some(Signal::Saves)
        );
        h.at(10 * 60 * S);
        h.daemon.tick();
        assert!(h.repo.segments(&set, "main").unwrap().is_empty());
    }

    #[test]
    fn a_set_in_a_project_dit_does_not_track_is_offered_once_and_not_after_a_decline() {
        let mut h = with_recorded_set();
        let other = h.dir.parent().unwrap().join("Other Project");
        fs::create_dir_all(&other).unwrap();
        write_set(&other.join("New.fset"), "n", T0);
        let doc = |path: &Path| {
            Input::Script(ScriptEvent::Message(ScriptMessage::Document {
                path: Some(path.display().to_string()),
                at: T0,
            }))
        };
        h.daemon.on_event(Input::Script(ScriptEvent::Connected {
            live: "x".into(),
            script: "1".into(),
        }));

        h.daemon.on_event(doc(&other.join("New.fset")));
        h.daemon.on_event(doc(&h.set()));
        h.daemon.on_event(doc(&other.join("New.fset")));

        let offers: Vec<_> = h
            .drain()
            .into_iter()
            .filter(|e| matches!(e, DaemonEvent::AdoptOffer { .. }))
            .collect();
        assert_eq!(offers.len(), 1, "once per folder");

        h.daemon.on_event(Input::Decline(other.clone()));
        assert!(RepoList::load(&h.repos_file).unwrap().is_declined(&other));
        let again = h.dir.parent().unwrap().join("Third Project");
        fs::create_dir_all(&again).unwrap();
        write_set(&again.join("T.fset"), "t", T0);
        h.daemon.on_event(Input::Decline(again.clone()));
        h.daemon.on_event(doc(&again.join("T.fset")));
        assert!(
            !h.drain()
                .iter()
                .any(|e| matches!(e, DaemonEvent::AdoptOffer { .. }))
        );
    }

    #[test]
    fn adopting_a_folder_makes_it_a_repo_records_its_sets_and_lists_it() {
        let mut h = with_recorded_set();
        let other = h.dir.parent().unwrap().join("Other Project");
        fs::create_dir_all(&other).unwrap();
        write_set(&other.join("New.fset"), "n", T0 - 5_000);

        h.daemon.on_event(Input::Adopt(other.clone()));

        let events = h.drain();
        assert!(
            events
                .iter()
                .any(|e| matches!(e, DaemonEvent::RepoTracked { .. }))
        );
        assert!(events.iter().any(|e| matches!(e, DaemonEvent::SaveRecorded { origin: Origin::Adopt, file, .. } if file == "New.fset")));
        assert!(events.iter().any(|e| matches!(
            e,
            DaemonEvent::Adopted { folder } if folder == &other.canonicalize().unwrap()
        )));
        assert!(
            RepoList::load(&h.repos_file)
                .unwrap()
                .repos
                .contains(&other.canonicalize().unwrap())
        );
    }

    #[test]
    fn switching_to_unsaved_set_after_idle_records_no_phantom_zero_ms_segment() {
        let mut h = with_recorded_set();
        let set_id = h.set_id();
        let path = h.set();
        h.at(0);
        h.daemon.on_event(Input::Script(ScriptEvent::Connected {
            live: "12.0".into(),
            script: "1".into(),
        }));
        h.daemon.on_event(Input::Script(ScriptEvent::Message(
            ScriptMessage::Document {
                path: Some(path.display().to_string()),
                at: T0,
            },
        )));
        h.at(60 * S);
        h.daemon.tick();
        // Go idle (past 15 minutes) so the open segment closes at T0 + 0.
        h.at(20 * 60 * S);
        h.daemon.tick();
        let before = h.repo.segments(&set_id, "main").unwrap();
        assert_eq!(before.len(), 1);

        // File -> New arrives at T0 + 25 min: must not open a phantom [t, t] segment on the previous set.
        h.at(25 * 60 * S);
        h.daemon.on_event(Input::Script(ScriptEvent::Message(
            ScriptMessage::Document {
                path: None,
                at: T0 + 25 * 60 * S,
            },
        )));
        let after = h.repo.segments(&set_id, "main").unwrap();
        assert_eq!(after, before);
    }

    #[test]
    fn multi_set_sample_save_emits_first_set_even_if_second_set_is_torn() {
        let mut h = launched(|dir, repo| {
            fs::create_dir_all(dir.join("Samples")).unwrap();
            fs::write(dir.join("Samples/k.wav"), b"kick").unwrap();
            write_set(&dir.join("A.fset"), &with_sample("a0"), T0 - 3_600_000);
            write_set(&dir.join("B.fset"), &with_sample("b0"), T0 - 3_600_000);
            repo.record_save(&dir.join("A.fset")).unwrap();
            repo.record_save(&dir.join("B.fset")).unwrap();
        });
        h.at(0);
        // Replace the shared sample and make B.fset torn/corrupt.
        fs::write(h.dir.join("Samples/k.wav"), b"snare").unwrap();
        fs::write(h.dir.join("B.fset"), b"half written torn set").unwrap();
        h.fs(&h.dir.join("Samples/k.wav"), false);

        h.at(5_100);
        h.daemon.tick();

        let events = h.drain();
        assert!(
            events.iter().any(|e| matches!(
                e,
                DaemonEvent::SaveRecorded { file, .. } if file == "A.fset"
            )),
            "Set A's SaveRecorded must not be dropped when Set B is torn: {events:?}"
        );
    }

    #[test]
    fn events_under_dit_and_outside_every_repo_are_ignored() {
        let mut h = with_recorded_set();
        let dit = h.dir.join(".dit/logs/x");
        h.fs(&dit, false);
        h.fs(Path::new("/somewhere/else/Song.fset"), false);
        let backup = h.dir.join("Backup/Song [2026].fset");
        h.fs(&backup, false);
        let hidden = h.dir.join("._Song.fset");
        h.fs(&hidden, false);
        let wav = h.dir.join("Recorded/take.wav");
        h.fs(&wav, false);
        assert!(h.daemon.slots.is_empty());
    }
}
