//! The render engine on threads: the whole-home watcher subscription, the engine's worker, an uploader that adds
//! one render at a time to the hub, and the controls the app and the cli use to accept or reject a proposal.
//!
//! The engine thread owns the [`Engine`] and feeds it what the watcher hears and the time. The uploader thread runs
//! [`run_upload`] for each proposal it is given, so a slow upload delays the next one but never the engine, and one
//! upload is out at a time on the one signed-in connection. [`Control`] is what `dit renders accept` and `reject`
//! reach through the app: it checks the ledger itself and hands the upload to the uploader.

use std::collections::HashMap;
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use dit_core::remote::Remote;
use dit_core::{Registry, Repo, RepoList};

use crate::Clock;
use crate::event::DaemonEvent;
use crate::fswatch::{FsEvent, Fswatch, Subscription};

use super::driver::{self, UploadEnd, run_upload, session_facts};
use super::engine::{Catalogue, Engine, EngineConfig, Output, SetRef};
use super::event::{RenderEvent, cards};
use super::ledger::Ledger;
use super::rejections;
use super::rules::{Exclusions, is_audio_path};

/// How long a set list is reused before the repos are read again.
const SETS_TTL_MS: i64 = 15_000;

/// How long a track title is reused.
const TITLE_TTL_MS: i64 = 10 * 60_000;

/// How long a failed title lookup (no track, hub unreachable) is remembered, so a render of a set whose hub is away
/// is not made to wait for a request each time.
const TITLE_MISS_TTL_MS: i64 = 60_000;

/// How often the engine looks at the clock.
const TICK: Duration = Duration::from_millis(500);

/// How the render engine behaves.
#[derive(Debug, Clone)]
pub struct RenderOptions {
    /// The ledger file (`Ledger::default_path`).
    pub ledger_path: PathBuf,
    /// The largest file to upload, in MiB; 0 for no limit.
    pub max_upload_mb: u64,
    /// The folders a DAW exports to.
    pub export_dirs: Vec<PathBuf>,
    /// The folders watched for bounces (`UserConfig.watch_roots`); none watches the whole home folder.
    pub roots: Vec<PathBuf>,
    /// Folders never offered from (`UserConfig.excluded`), their whole trees, on top of the built-in exclusions.
    pub excluded: Vec<PathBuf>,
}

/// The signed-in connection, which the app replaces when the producer signs in again.
#[derive(Clone)]
pub struct SharedRemote(Arc<Mutex<Arc<Remote>>>);

impl SharedRemote {
    pub fn new(remote: Arc<Remote>) -> Self {
        SharedRemote(Arc::new(Mutex::new(remote)))
    }

    /// The connection as it is now.
    pub fn get(&self) -> Arc<Remote> {
        self.0.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    /// Uses `remote` from now on.
    pub fn replace(&self, remote: Arc<Remote>) {
        *self.0.lock().unwrap_or_else(|p| p.into_inner()) = remote;
    }
}

struct Cache {
    sets: Option<(i64, Vec<SetRef>)>,
    titles: HashMap<i64, (i64, Option<String>)>,
}

/// The sets the hub holds sessions for, read from the tracked repos, and their tracks' titles, asked of the hub and
/// cached per session.
pub struct HubCatalogue {
    registry: Registry,
    repos_file: PathBuf,
    remote: SharedRemote,
    clock: Arc<dyn Clock>,
    cache: Mutex<Cache>,
}

/// Reads every pushed set bound to `instance` from the tracked repos listed in `repos_file`.
pub fn read_sets_for_instance(
    registry: &Registry,
    repos_file: &std::path::Path,
    instance: &str,
) -> Vec<SetRef> {
    let Ok(list) = RepoList::load(repos_file) else {
        return Vec::new();
    };
    let mut sets = Vec::new();
    for folder in list.repos {
        let Ok(repo) = Repo::open(&folder, registry) else {
            continue;
        };
        let Ok(Some(binding)) = repo.remote_binding() else {
            continue;
        };
        if binding.instance != instance {
            continue;
        }
        let (Ok(pushed), Ok(files)) = (repo.pushed_sets_to(&binding), repo.sets()) else {
            continue;
        };
        for (set_id, pushed) in pushed {
            let Some(file) = files.get(&set_id) else {
                continue;
            };
            let mut branches = vec!["main".to_string()];
            if let Ok(branch_files) = repo.branch_files(&set_id) {
                for branch in branch_files.into_keys() {
                    if !branches.contains(&branch) {
                        branches.push(branch);
                    }
                }
            }
            for branch in pushed.branches.keys() {
                if !branches.contains(branch) {
                    branches.push(branch.clone());
                }
            }
            let mut save_times_ms: Vec<i64> = branches
                .iter()
                .flat_map(|branch| {
                    repo.saves(&set_id, branch)
                        .map(|saves| saves.into_iter().map(|save| save.file_updated_at).collect())
                        .unwrap_or_else(|_| Vec::new())
                })
                .collect();
            save_times_ms.sort_unstable();
            save_times_ms.dedup();
            sets.push(SetRef {
                session_id: pushed.session_id,
                set_path: repo.root().join(file),
                project_folder: Some(repo.root().to_path_buf()),
                save_times_ms,
            });
        }
    }
    sets
}

impl HubCatalogue {
    pub fn new(
        registry: Registry,
        repos_file: PathBuf,
        remote: SharedRemote,
        clock: Arc<dyn Clock>,
    ) -> Self {
        HubCatalogue {
            registry,
            repos_file,
            remote,
            clock,
            cache: Mutex::new(Cache {
                sets: None,
                titles: HashMap::new(),
            }),
        }
    }

    fn read_sets(&self) -> Vec<SetRef> {
        let instance = self.remote.get().client().instance().url().to_string();
        read_sets_for_instance(&self.registry, &self.repos_file, &instance)
    }
}

impl Catalogue for HubCatalogue {
    fn sets(&self) -> Vec<SetRef> {
        let now = self.clock.now_ms();
        if let Some((read_at, sets)) = &self.cache.lock().unwrap_or_else(|p| p.into_inner()).sets
            && now - read_at < SETS_TTL_MS
        {
            return sets.clone();
        }
        let sets = self.read_sets();
        self.cache.lock().unwrap_or_else(|p| p.into_inner()).sets = Some((now, sets.clone()));
        sets
    }

    fn track_title(&self, session_id: i64) -> Option<String> {
        let now = self.clock.now_ms();
        if let Some((at, title)) = self
            .cache
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .titles
            .get(&session_id)
            && now - at
                < if title.is_some() {
                    TITLE_TTL_MS
                } else {
                    TITLE_MISS_TTL_MS
                }
        {
            return title.clone();
        }
        let title = session_facts(&self.remote.get(), session_id)
            .ok()
            .and_then(|facts| facts.track_title);
        self.cache
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .titles
            .insert(session_id, (now, title.clone()));
        title
    }
}

/// What the app and the cli can ask of the render engine, however it is reached. The running app implements it;
/// `dit renders` calls it through the socket and reads the ledger itself when no app answers.
pub trait RenderControl: Send + Sync {
    /// Every render the producer has not rejected, as cards.
    fn renders(&self) -> Vec<RenderEvent>;
    /// Adds the render `id` to the hub as a version of the track of `set_session`, or of the session it is proposed
    /// for when `None`. The upload goes on in the background; the card says it has begun.
    fn accept_render(&self, id: u64, set_session: Option<i64>) -> Result<RenderEvent, String>;
    /// Says the render `id` is not a bounce, and with `never_here` that nothing is to be proposed from its folder.
    fn reject_render(&self, id: u64, never_here: bool) -> Result<RenderEvent, String>;
    /// Replaces the folders watched (none: the home folder) and the folders excluded, as the settings screen edits
    /// them. The built-in exclusions and the "never here" folders always apply on top. A root that cannot be watched
    /// is an error and leaves what was watched as it was.
    fn set_scope(&self, roots: Vec<PathBuf>, excluded: Vec<PathBuf>) -> Result<(), String>;
    /// Replaces the size limit, in MiB (0 for no limit), for renders judged from now on.
    fn set_max_upload_mb(&self, max_upload_mb: u64);
    /// Reloads the ledger's `never_here` folder exclusions in place without restarting the service.
    fn reload_never_here(&self) {}
}

/// The parts of the engine the app's calls reach.
pub struct Control {
    ledger_path: PathBuf,
    events: Sender<DaemonEvent>,
    uploads: Sender<u64>,
    exclusions: Arc<RwLock<Exclusions>>,
    /// The hub the turn-downs are written through to.
    remote: SharedRemote,
    home: PathBuf,
    fswatch: Arc<Fswatch>,
    /// Where the watcher's events go: the engine's forwarder.
    fs_events: Mutex<Sender<FsEvent>>,
    inputs: Mutex<Sender<Input>>,
    subscriptions: Mutex<Vec<Subscription>>,
}

impl Control {
    fn say(&self, proposal: &super::ledger::Proposal) -> RenderEvent {
        let card = RenderEvent::of(proposal);
        let _ = self.events.send(DaemonEvent::Render(card.clone()));
        card
    }
}

impl RenderControl for Control {
    fn renders(&self) -> Vec<RenderEvent> {
        Ledger::load(&self.ledger_path)
            .map(|ledger| cards(&ledger))
            .unwrap_or_default()
    }

    fn accept_render(&self, id: u64, set_session: Option<i64>) -> Result<RenderEvent, String> {
        let proposal = driver::request_accept(&self.ledger_path, id, set_session)?;
        let card = self.say(&proposal);
        self.uploads
            .send(id)
            .map_err(|_| "The render engine has stopped.".to_string())?;
        Ok(card)
    }

    fn reject_render(&self, id: u64, never_here: bool) -> Result<RenderEvent, String> {
        let proposal = driver::reject(&self.ledger_path, id, never_here)?;
        if never_here && let Ok(ledger) = Ledger::load(&self.ledger_path) {
            self.exclusions
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .set_never_here(&ledger.never_here);
        }
        // The hub is told off the caller's thread: a turn-down never waits for the network, and one the hub does
        // not hear stays in the ledger for the next attach.
        let (ledger_path, remote) = (self.ledger_path.clone(), self.remote.get());
        thread::spawn(move || {
            let _ = rejections::flush(&ledger_path, &remote);
        });
        Ok(self.say(&proposal))
    }

    fn set_scope(&self, roots: Vec<PathBuf>, excluded: Vec<PathBuf>) -> Result<(), String> {
        let mut roots: Vec<PathBuf> = if roots.is_empty() {
            vec![self.home.clone()]
        } else {
            roots
                .into_iter()
                .map(|root| root.canonicalize().unwrap_or(root))
                .collect()
        };
        // Coalesce nested or duplicate roots so one file change is never delivered twice.
        roots.sort_by_key(|root| root.components().count());
        let mut deduped: Vec<PathBuf> = Vec::with_capacity(roots.len());
        for root in roots {
            if !deduped.iter().any(|existing| root.starts_with(existing)) {
                deduped.push(root);
            }
        }
        let roots = deduped;

        let mut subscriptions = self
            .subscriptions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let sender = self
            .fs_events
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        // Gate the fresh subscriptions off until the previous batch is dropped so events
        // are never delivered by both batches, while a watch error leaves the old scope intact.
        let active = Arc::new(AtomicBool::new(false));
        let mut fresh = Vec::new();
        for root in &roots {
            let exclusions = self.exclusions.clone();
            let home = self.home.clone();
            let active = active.clone();
            let subscription = self
                .fswatch
                .subscribe(
                    root,
                    move |path| {
                        active.load(Ordering::Acquire)
                            && is_audio_path(path)
                            && !exclusions
                                .read()
                                .unwrap_or_else(|poisoned| poisoned.into_inner())
                                .excludes_watched(&home, path)
                    },
                    sender.clone(),
                )
                .map_err(|error| format!("Can't watch {}: {error}", root.display()))?;
            fresh.push(subscription);
        }
        {
            let mut exclusions = self
                .exclusions
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            exclusions.set_roots(&roots);
            exclusions.set_excluded(&excluded);
        }
        // Drop old subscriptions before activating the fresh ones.
        subscriptions.clear();
        active.store(true, Ordering::Release);
        *subscriptions = fresh;
        Ok(())
    }

    fn set_max_upload_mb(&self, max_upload_mb: u64) {
        let _ = self
            .inputs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .send(Input::MaxUpload(max_upload_mb));
    }

    fn reload_never_here(&self) {
        if let Ok(ledger) = Ledger::load(&self.ledger_path) {
            self.exclusions
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .set_never_here(&ledger.never_here);
        }
    }
}

/// What the engine thread is told.
enum Input {
    Fs(FsEvent),
    UploadEnded(u64, UploadEnd),
    MaxUpload(u64),
    Resume,
    Stop,
}

/// Coordinates shutdown with the uploader thread so shutdown never joins a thread that just
/// entered an upload and the uploader never starts an upload after shutdown has begun.
#[derive(Default)]
struct UploadGate {
    stopping: bool,
    uploading: bool,
}

/// A running render engine. Dropping it stops it.
pub struct Service {
    control: Arc<Control>,
    inputs: Sender<Input>,
    remote: SharedRemote,
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
    uploader: Option<JoinHandle<()>>,
    upload_gate: Arc<Mutex<UploadGate>>,
}

impl Service {
    /// Starts the engine under `home`: subscribes the roots (the whole home when there are none) to `fswatch`, with a
    /// filter that keeps only audio files the exclusions allow, and starts the engine's thread and the uploader's.
    #[allow(clippy::too_many_arguments)]
    pub fn start(
        options: RenderOptions,
        registry: &Registry,
        home: PathBuf,
        repos_file: PathBuf,
        fswatch: Arc<Fswatch>,
        remote: Arc<Remote>,
        clock: Arc<dyn Clock>,
        events: Sender<DaemonEvent>,
    ) -> io::Result<Service> {
        let managed: Vec<String> = registry
            .all()
            .iter()
            .flat_map(|daw| daw.managed_subfolders())
            .map(|name| name.to_string())
            .collect();
        let held = Ledger::load(&options.ledger_path)?;
        let exclusions = {
            let names: Vec<&str> = managed.iter().map(String::as_str).collect();
            Arc::new(RwLock::new(Exclusions::new(&names, &held.never_here)))
        };
        let home = home.canonicalize().unwrap_or(home);
        let remote = SharedRemote::new(remote);

        let (fs_tx, fs_rx) = mpsc::channel::<FsEvent>();
        let stop = Arc::new(AtomicBool::new(false));
        let (inputs, input_rx) = mpsc::channel::<Input>();
        let (uploads, upload_rx) = mpsc::channel::<u64>();
        let upload_gate = Arc::new(Mutex::new(UploadGate::default()));
        let control = Arc::new(Control {
            ledger_path: options.ledger_path.clone(),
            events: events.clone(),
            uploads: uploads.clone(),
            exclusions: exclusions.clone(),
            remote: remote.clone(),
            home: home.clone(),
            fswatch,
            fs_events: Mutex::new(fs_tx),
            inputs: Mutex::new(inputs.clone()),
            subscriptions: Mutex::new(Vec::new()),
        });
        // Watch roots before spawning any background threads so a setup failure leaks nothing.
        control
            .set_scope(options.roots, options.excluded)
            .map_err(io::Error::other)?;
        // The hub's lists are read off this thread: attaching a hub never waits for the network. The engine reads
        // the ledger for each file it follows, so what comes in applies from the next one; the folders it keeps
        // in a filter of its own are replaced here.
        {
            let ledger_path = options.ledger_path.clone();
            let remote = remote.get();
            let exclusions = exclusions.clone();
            let events = events.clone();
            thread::spawn(move || {
                if rejections::sync(&ledger_path, &remote).is_ok() {
                    if let Ok(ledger) = Ledger::load(&ledger_path) {
                        exclusions
                            .write()
                            .unwrap_or_else(|poisoned| poisoned.into_inner())
                            .set_never_here(&ledger.never_here);
                    }
                    let _ = events.send(DaemonEvent::RejectionsSynced);
                }
            });
        }

        let catalogue =
            HubCatalogue::new(registry.clone(), repos_file, remote.clone(), clock.clone());
        let mut engine = Engine::new(
            EngineConfig {
                ledger_path: options.ledger_path.clone(),
                home,
                max_upload_mb: options.max_upload_mb,
                export_dirs: options.export_dirs,
            },
            Box::new(catalogue),
            exclusions,
        );
        // Inspect the pre-startup ledger before returning so callers cannot race `accept_render`
        // against `engine.start` and enqueue the same upload twice.
        let initial = engine.start(clock.now_ms());

        let mut threads = Vec::new();
        {
            let inputs = inputs.clone();
            let stop = stop.clone();
            threads.push(thread::spawn(move || {
                while !stop.load(Ordering::SeqCst) {
                    match fs_rx.recv_timeout(Duration::from_millis(100)) {
                        Ok(event) => {
                            let _ = inputs.send(Input::Fs(event));
                        }
                        Err(RecvTimeoutError::Timeout) => {}
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }
            }));
        }
        threads.push({
            let ledger_path = options.ledger_path.clone();
            let events = events.clone();
            let clock = clock.clone();
            thread::spawn(move || {
                engine_loop(
                    engine,
                    initial,
                    input_rx,
                    clock,
                    uploads,
                    events,
                    ledger_path,
                );
            })
        });
        let uploader = {
            let stop = stop.clone();
            let upload_gate = upload_gate.clone();
            let remote = remote.clone();
            let inputs = inputs.clone();
            let ledger_path = options.ledger_path;
            thread::spawn(move || {
                upload_loop(
                    upload_rx,
                    remote,
                    ledger_path,
                    events,
                    inputs,
                    stop,
                    upload_gate,
                );
            })
        };
        Ok(Service {
            control,
            inputs,
            remote,
            stop,
            threads,
            uploader: Some(uploader),
            upload_gate,
        })
    }

    /// What `dit renders` and the panel reach.
    pub fn control(&self) -> Arc<Control> {
        self.control.clone()
    }

    /// Signs in again after [`DaemonEvent::SignedOut`]: uploads that waited for it go at once with `remote`.
    pub fn sign_in(&self, remote: Arc<Remote>) {
        self.remote.replace(remote);
        let _ = self.inputs.send(Input::Resume);
    }

    /// Stops the threads, waiting for them. An upload under way is left to the end of the process: it resumes at the
    /// next launch from the ledger, where waiting for the last byte of a large file would hold the app's quit.
    pub fn stop(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = self.inputs.send(Input::Stop);
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
        let should_join = {
            let mut gate = self
                .upload_gate
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            gate.stopping = true;
            !gate.uploading
        };
        if let Some(uploader) = self.uploader.take()
            && should_join
        {
            let _ = uploader.join();
        }
    }
}

impl Drop for Service {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Hands the engine what it hears and the time, and carries out what it asks.
fn engine_loop(
    mut engine: Engine,
    initial: Vec<Output>,
    inputs: Receiver<Input>,
    clock: Arc<dyn Clock>,
    uploads: Sender<u64>,
    events: Sender<DaemonEvent>,
    ledger_path: PathBuf,
) {
    // The ledger being unreadable repeats on every tick; it is told once until it changes.
    let mut told: Option<String> = None;
    let mut carry_out = |outputs: Vec<Output>| {
        for output in outputs {
            match output {
                Output::Card(card) => {
                    let _ = events.send(DaemonEvent::Render(*card));
                }
                Output::Upload(id) => {
                    let _ = uploads.send(id);
                }
                Output::SignedOut { host } => {
                    let _ = events.send(DaemonEvent::SignedOut { host });
                }
                Output::Error(message) => {
                    if told.as_ref() != Some(&message) {
                        told = Some(message.clone());
                        let _ = events.send(DaemonEvent::RepoError {
                            repo: ledger_path.clone(),
                            message,
                        });
                    }
                }
            }
        }
    };
    carry_out(initial);
    let mut last_tick = Instant::now();
    loop {
        match inputs.recv_timeout(Duration::from_millis(100)) {
            Ok(Input::Fs(event)) => engine.fs_event(event, clock.now_ms()),
            Ok(Input::UploadEnded(id, end)) => {
                carry_out(engine.upload_ended(id, &end, clock.now_ms()));
            }
            Ok(Input::MaxUpload(mb)) => engine.set_max_upload_mb(mb),
            Ok(Input::Resume) => engine.resume(clock.now_ms()),
            Ok(Input::Stop) | Err(RecvTimeoutError::Disconnected) => return,
            Err(RecvTimeoutError::Timeout) => {}
        }
        if last_tick.elapsed() >= TICK {
            last_tick = Instant::now();
            carry_out(engine.tick(clock.now_ms()));
        }
    }
}

/// Adds each proposal it is given to the hub, one at a time, and tells the engine how each attempt ended.
fn upload_loop(
    jobs: Receiver<u64>,
    remote: SharedRemote,
    ledger_path: PathBuf,
    events: Sender<DaemonEvent>,
    inputs: Sender<Input>,
    stop: Arc<AtomicBool>,
    upload_gate: Arc<Mutex<UploadGate>>,
) {
    while !stop.load(Ordering::SeqCst) {
        let id = match jobs.recv_timeout(Duration::from_millis(100)) {
            Ok(id) => id,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => return,
        };
        {
            let mut gate = upload_gate
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if gate.stopping {
                return;
            }
            gate.uploading = true;
        }
        let end = run_upload(&remote.get(), &ledger_path, id, &mut |proposal| {
            let _ = events.send(DaemonEvent::Render(RenderEvent::of(proposal)));
        });
        {
            let mut gate = upload_gate
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            gate.uploading = false;
        }
        let _ = inputs.send(Input::UploadEnded(id, end));
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use dit_core::remote::test_support::{MockServer, remote_to};
    use dit_core::repo::PushedSet;
    use dit_core::{RemoteBinding, RepoList};

    use super::super::ledger::{ProposalFile, ProposalState};
    use super::super::test_hub::{Hub, hub};
    use super::*;
    use crate::test_support::{FakeClock, project, registry, write_set};

    const WAIT: Duration = Duration::from_secs(30);

    /// A running service over a temp home, a ledger with one proposal of session 5 in `state`, and the scripted hub.
    struct Rig {
        _dir: tempfile::TempDir,
        _fswatch: Arc<Fswatch>,
        ledger: PathBuf,
        file: PathBuf,
        home: PathBuf,
        id: u64,
        service: Service,
        events: Receiver<DaemonEvent>,
        clock: FakeClock,
        server: MockServer,
        hub: Arc<Mutex<Hub>>,
    }

    fn rig(state: ProposalState) -> Option<Rig> {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().canonicalize().unwrap().join("home");
        fs::create_dir_all(&home).unwrap();
        let file = home.join("Canopy v3.wav");
        fs::write(&file, vec![9u8; 4_000]).unwrap();
        let ledger = home.join("renders.json");
        let id = Ledger::update(&ledger, |ledger| {
            let id = ledger.propose(
                "Canopy v3",
                vec![ProposalFile {
                    path: file.clone(),
                    size: 4_000,
                    mtime_ms: 5_000,
                    fingerprint: None,
                }],
                0,
            );
            let proposal = ledger.by_id_mut(id).unwrap();
            proposal.state = state;
            proposal.session_id = Some(5);
            proposal.upload.chosen = Some(0);
            id
        })
        .unwrap();
        let Ok(fswatch) = Fswatch::new() else {
            eprintln!("skipped: this platform cannot start a watcher here");
            return None;
        };
        let fswatch = Arc::new(fswatch);
        let (server, state, remote) = hub();
        let (tx, events) = mpsc::channel();
        let clock = FakeClock::default();
        clock.set(1_000_000);
        let service = Service::start(
            RenderOptions {
                ledger_path: ledger.clone(),
                max_upload_mb: 0,
                export_dirs: Vec::new(),
                roots: Vec::new(),
                excluded: Vec::new(),
            },
            &registry(),
            home.clone(),
            home.join("repos.toml"),
            fswatch.clone(),
            Arc::new(remote),
            Arc::new(clock.clone()),
            tx,
        )
        .ok()?;
        Some(Rig {
            _dir: dir,
            _fswatch: fswatch,
            ledger,
            file,
            home,
            id,
            service,
            events,
            clock,
            server,
            hub: state,
        })
    }

    impl Rig {
        /// Every render card heard until one satisfies `done`; a panic if none does within [`WAIT`].
        fn cards_until(&self, done: impl Fn(&RenderEvent) -> bool) -> Vec<RenderEvent> {
            let deadline = Instant::now() + WAIT;
            let mut seen = Vec::new();
            while Instant::now() < deadline {
                match self.events.recv_timeout(Duration::from_millis(100)) {
                    Ok(DaemonEvent::Render(card)) => {
                        let finished = done(&card);
                        seen.push(card);
                        if finished {
                            return seen;
                        }
                    }
                    Ok(_) | Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
            panic!("no such card; heard {seen:?}");
        }

        fn counts(&self) -> (usize, usize, usize) {
            let hub = self.hub.lock().unwrap();
            (hub.lookups, hub.uploads, hub.accepts)
        }

        fn state(&self) -> ProposalState {
            Ledger::load(&self.ledger)
                .unwrap()
                .by_id(self.id)
                .unwrap()
                .state
        }
    }

    #[test]
    fn accepting_uploads_in_the_background_and_reports_each_state() {
        let Some(rig) = rig(ProposalState::Proposed) else {
            return;
        };
        let control = rig.service.control();

        let started = control.accept_render(rig.id, None).unwrap();
        assert_eq!(started.state, ProposalState::Uploading, "answered at once");

        let seen = rig.cards_until(|card| card.state == ProposalState::Added);
        let states: Vec<_> = seen.iter().map(|card| card.state).collect();
        assert_eq!(states.first(), Some(&ProposalState::Uploading));
        assert_eq!(states.last(), Some(&ProposalState::Added));
        assert!(
            seen.iter().any(|card| card.progress.is_some()),
            "progress is reported while uploading: {seen:?}"
        );
        assert!(seen.iter().all(|card| card.id == rig.id));
        assert_eq!(rig.counts(), (1, 1, 1));
        assert_eq!(control.renders().len(), 1);
        assert_eq!(control.renders()[0].state, ProposalState::Added);
    }

    #[test]
    fn accepting_a_render_that_cannot_be_accepted_is_an_error() {
        let Some(rig) = rig(ProposalState::Added) else {
            return;
        };
        let control = rig.service.control();
        assert!(
            control
                .accept_render(rig.id, None)
                .unwrap_err()
                .contains("added already")
        );
        assert!(
            control
                .accept_render(99, None)
                .unwrap_err()
                .contains("no render 99")
        );
        assert_eq!(rig.counts(), (0, 0, 0));
    }

    #[test]
    fn rejecting_says_so_and_never_here_closes_the_folder_to_the_watcher() {
        let Some(rig) = rig(ProposalState::Proposed) else {
            return;
        };
        let control = rig.service.control();
        assert!(
            !control
                .exclusions
                .read()
                .unwrap()
                .excludes_below(&rig.home, &rig.home.join("Bounces").join("x.wav"))
        );

        let card = control.reject_render(rig.id, true).unwrap();

        assert_eq!(card.state, ProposalState::Rejected);
        rig.cards_until(|card| card.state == ProposalState::Rejected);
        assert!(
            control
                .exclusions
                .read()
                .unwrap()
                .excludes_below(&rig.home, &rig.file.with_file_name("other.wav")),
            "the folder the render was in"
        );
        assert!(
            control.renders().is_empty(),
            "rejected renders are not listed"
        );
    }

    #[test]
    fn a_launch_continues_an_upload_the_last_run_left_under_way() {
        let Some(rig) = rig(ProposalState::Uploading) else {
            return;
        };
        rig.cards_until(|card| card.state == ProposalState::Added);
        assert_eq!(rig.counts(), (1, 1, 1));
    }

    #[test]
    fn an_upload_the_hub_could_not_take_is_retried_after_the_backoff() {
        let Some(rig) = rig(ProposalState::Proposed) else {
            return;
        };
        rig.hub.lock().unwrap().fail = Some(("/lookup", 503));
        rig.service.control().accept_render(rig.id, None).unwrap();

        let seen = rig.cards_until(|card| card.state == ProposalState::QueuedOffline);
        assert!(seen.last().unwrap().message.is_some());
        assert_eq!(rig.state(), ProposalState::QueuedOffline);

        // The engine waits 5 s of the clock it is given; it does not retry before.
        std::thread::sleep(Duration::from_millis(1_200));
        assert_eq!(rig.counts().1, 0);
        rig.clock.set(1_000_000 + 6_000);

        rig.cards_until(|card| card.state == ProposalState::Added);
        assert_eq!(rig.counts(), (1, 1, 1));
    }

    #[test]
    fn a_refused_sign_in_is_reported_once_and_signing_in_again_goes_on() {
        let Some(rig) = rig(ProposalState::Proposed) else {
            return;
        };
        rig.hub.lock().unwrap().fail = Some(("/lookup", 401));
        rig.service.control().accept_render(rig.id, None).unwrap();

        let deadline = Instant::now() + WAIT;
        let host = loop {
            match rig.events.recv_timeout(Duration::from_millis(100)) {
                Ok(DaemonEvent::SignedOut { host }) => break host,
                _ if Instant::now() > deadline => panic!("no sign-out was reported"),
                _ => {}
            }
        };
        assert!(!host.is_empty());
        assert_eq!(rig.state(), ProposalState::QueuedOffline);

        rig.service.sign_in(Arc::new(remote_to(&rig.server)));
        rig.cards_until(|card| card.state == ProposalState::Added);
        assert_eq!(rig.counts(), (1, 1, 1));
    }

    #[test]
    fn the_watched_roots_and_excluded_folders_are_replaced_while_running() {
        let Some(rig) = rig(ProposalState::Proposed) else {
            return;
        };
        let control = rig.service.control();
        let (music, old) = (rig.home.join("Music"), rig.home.join("Music").join("Old"));
        fs::create_dir_all(&old).unwrap();
        let elsewhere = rig.home.join("Other").join("Mix.wav");
        let excludes = |path: &std::path::Path| {
            control
                .exclusions
                .read()
                .unwrap()
                .excludes_watched(&rig.home, path)
        };
        assert!(
            !excludes(&elsewhere),
            "the whole home is watched by default"
        );

        control
            .set_scope(vec![music.clone()], vec![old.clone()])
            .unwrap();
        assert!(!excludes(&music.join("Mix.wav")));
        assert!(excludes(&old.join("Mix.wav")), "an excluded folder");
        assert!(excludes(&elsewhere), "outside the roots");

        control.set_scope(Vec::new(), Vec::new()).unwrap();
        assert!(!excludes(&elsewhere));
        assert!(!excludes(&old.join("Mix.wav")));
    }

    #[test]
    fn stopping_ends_the_threads() {
        let Some(rig) = rig(ProposalState::Proposed) else {
            return;
        };
        let started = Instant::now();
        rig.service.stop();
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    /// A tracked repo whose one set the hub knows as session 5, saved at `saved_ms`.
    fn repo_with_pushed_set(
        instance: &str,
        saved_ms: i64,
    ) -> (tempfile::TempDir, PathBuf, PathBuf) {
        let (root, dir, repo) = project("Canopy");
        write_set(&dir.join("Canopy.fset"), "<doc/>", saved_ms);
        repo.record_save(&dir.join("Canopy.fset")).unwrap();
        repo.bind_remote(&RemoteBinding {
            instance: instance.to_string(),
            repo: 3,
        })
        .unwrap();
        let set = repo.sets().unwrap().into_keys().next().unwrap();
        repo.write_pushed(
            &set,
            &PushedSet {
                instance: instance.to_string(),
                repo_id: 3,
                session_id: 5,
                branches: Default::default(),
            },
        )
        .unwrap();
        let repos_file = root.path().join("repos.toml");
        RepoList::update(&repos_file, |list| {
            list.add(&dir);
        })
        .unwrap();
        (root, dir, repos_file)
    }

    #[test]
    fn the_catalogue_lists_the_sets_the_hub_holds_sessions_for_and_caches_titles() {
        let (server, _state, remote) = hub();
        let instance = remote.client().instance().url().to_string();
        let (_root, dir, repos_file) = repo_with_pushed_set(&instance, 4_000);
        let clock = FakeClock::default();
        clock.set(1_000_000);
        let catalogue = HubCatalogue::new(
            registry(),
            repos_file,
            SharedRemote::new(Arc::new(remote)),
            Arc::new(clock.clone()),
        );

        let sets = catalogue.sets();
        assert_eq!(
            sets,
            [SetRef {
                session_id: 5,
                set_path: dir.join("Canopy.fset"),
                project_folder: Some(dir.clone()),
                save_times_ms: vec![4_000],
            }]
        );

        assert_eq!(catalogue.track_title(5).as_deref(), Some("Canopy"));
        assert_eq!(catalogue.track_title(5).as_deref(), Some("Canopy"));
        let asked = |server: &MockServer| {
            server
                .requests()
                .iter()
                .filter(|request| request.path_only() == "/api/sessions/5")
                .count()
        };
        assert_eq!(asked(&server), 1, "the title is cached per session");
        clock.set(1_000_000 + TITLE_TTL_MS + 1);
        catalogue.track_title(5);
        assert_eq!(asked(&server), 2, "and asked again once it is old");
    }

    #[test]
    fn sets_of_another_instance_are_not_scored_against() {
        let (_server, _state, remote) = hub();
        let (_root, _dir, repos_file) = repo_with_pushed_set("http://elsewhere.example", 4_000);
        let catalogue = HubCatalogue::new(
            registry(),
            repos_file,
            SharedRemote::new(Arc::new(remote)),
            Arc::new(FakeClock::default()),
        );
        assert!(catalogue.sets().is_empty());
    }
}
