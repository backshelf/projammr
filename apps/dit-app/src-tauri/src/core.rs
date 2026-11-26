//! The app's one shared state: the snapshot's reducer, the running daemon and everything a command or the socket
//! needs of them.
//!
//! The daemon runs on threads of its own; a folding thread reads what it reports and hands it to the [`Reducer`],
//! and an emitting thread sends the snapshot to the panel and the bar at most ten times a second. Signing in or out
//! attaches or detaches the hub on the running daemon.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use dit_cli::RemoteSource;
use dit_core::remote::{self, DeviceCode, Instance, Machine, RemoteError, UserConfig};
use dit_core::{Registry, RepoList, ScriptKit};
use dit_daemon::event::{DaemonEvent, Input};
use dit_daemon::queue::{Phase, PushEvent};
use dit_daemon::renders::ledger::Ledger;
use dit_daemon::renders::{RenderControl, RenderOptions};
use dit_daemon::runner::{Hub, Options, Running, start};
use dit_daemon::{Config, SystemClock};
use dit_ipc::{Run, Serving};
use tauri::{AppHandle, Emitter};

use crate::auth::{auth_after, failure_line, forget_sign_in};
use crate::deep_link::{self, Link, Waiting};
use crate::paths::Paths;
use crate::readout::RepoReadout;
use crate::reducer::{Reducer, ScriptFacts};
use crate::remote::AppRemote;
use crate::renders::Announced;
use crate::restore::Home;
use crate::snapshot::{Auth, AuthState, Pending, PendingRestore, Settings, Snapshot};
use crate::state::AppState;
use crate::{art, cli_install, commit, login_item, media, panel, permissions, shortcut, tray};

mod backfill;
mod hub;
mod machine;
mod renders;
mod restore;
mod set_hub;

pub use renders::{Rejection, check_roots};

/// The event the panel listens for; its payload is the whole snapshot.
pub const STATE_EVENT: &str = "dit://state";

/// The shortest gap between two snapshots sent to the panel.
const EMIT_EVERY: Duration = Duration::from_millis(100);

/// How often the open set's readout, which includes time passing, and the permissions are read again.
const REFRESH_EVERY: Duration = Duration::from_secs(60);

/// How long a repo mutation waits for another process's lock before the daemon retries it itself.
const LOCK_WAIT: Duration = Duration::from_secs(2);

/// How long a sign-out waits for the daemon to let go of the hub before it carries on.
const DETACH_WAIT: Duration = Duration::from_secs(5);

/// Something to tell the daemon, run on the thread that owns it.
type Job = Box<dyn FnOnce(&Running) + Send>;

/// A running daemon, which the thread that folds its events owns: it is not `Sync`, so every command reaches it as a
/// [`Job`] that thread runs between events.
struct Live {
    jobs: Sender<Job>,
    stop: Arc<AtomicBool>,
    folding: JoinHandle<()>,
    /// The instance it pushes to; `None` when it was started without a sign-in.
    instance: Option<String>,
}

impl Live {
    /// Stops the daemon, waiting for what it is writing.
    fn halt(self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = self.folding.join();
    }
}

pub struct Core {
    pub paths: Paths,
    pub remote: AppRemote,
    app: AppHandle,
    registry: Registry,
    home: PathBuf,
    app_version: String,
    reducer: Mutex<Reducer>,
    dirty: Sender<()>,
    live: Mutex<Option<Live>>,
    /// The open set's session is being read from the hub.
    reading_set: Mutex<set_hub::Reading>,
    /// Held for each read-modify-write of the user config, so two commands never lose each other's change.
    config: Mutex<()>,
    /// The address that finishes the sign-in in flight; empty until the instance has issued its code.
    login: Mutex<Option<String>>,
    serving: Mutex<Option<Serving>>,
    /// What the machine says of the settings the config does not hold.
    host: Mutex<Host>,
    /// Links that came before the daemon's launch catch-up finished.
    links: Waiting,
    /// The hub project chosen for a folder the panel adopted, by the folder's canonical path, until the daemon
    /// reports it tracked and its first push goes there.
    binds: Mutex<HashMap<PathBuf, String>>,
    /// The account's projects are being read for the repo list's links.
    learning: AtomicBool,
    /// The render engine's controls while a hub is attached: what accepting and turning down a render, and `dit
    /// renders` over the socket, call.
    render_control: Mutex<Option<Arc<dyn RenderControl>>>,
    /// The renders that have already asked for a notification.
    announced: Mutex<Announced>,
    /// The restore that is running, if one is.
    restoring: Mutex<Option<restore::Restoring>>,
    /// Where the commit the restore screen shows would be written, read with the commit from the hub.
    restore_home: Mutex<Option<(i64, Home)>>,
    /// The backfill window's state and the run it drives, which the cli's `dit backfill` shares.
    pub backfill: Arc<crate::backfill::Backfill>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The settings the user config does not hold: what the OS and the shortcut registration say.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Host {
    /// Why the configured shortcut is not registered.
    pub shortcut_error: Option<String>,
    pub autostart: bool,
    /// The link `dit` is installed as, when it points at this app's cli.
    pub cli_installed: Option<String>,
    /// What the render watcher never looks in (from the DAWs, so fixed for a run).
    pub built_in_excluded: Vec<String>,
    /// What the producer turned down, from the render ledger.
    pub rejected_files: Vec<crate::snapshot::RememberedFile>,
    pub never_here_folders: Vec<String>,
}

/// The settings the config holds, with what an empty list of watch roots means, and what `host` says.
pub fn settings_of(config: &UserConfig, home: &Path, host: &Host) -> Settings {
    Settings {
        shortcut: config.shortcut.clone(),
        shortcut_error: host.shortcut_error.clone(),
        max_upload_mb: config.max_upload_mb.unwrap_or(0),
        watch_roots: if config.watch_roots.is_empty() {
            vec![home.display().to_string()]
        } else {
            config.watch_roots.clone()
        },
        excluded: config.excluded.clone(),
        autostart: host.autostart,
        machine_name: config.machine(),
        cli_installed: host.cli_installed.clone(),
        built_in_excluded: host.built_in_excluded.clone(),
        rejected_files: host.rejected_files.clone(),
        never_here_folders: host.never_here_folders.clone(),
    }
}

/// Opens `url` in the default browser.
pub fn open_url(url: &str) -> Result<(), String> {
    let status = Command::new("open")
        .arg(url)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| format!("Couldn't open a browser: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Couldn't open a browser: open {status}"))
    }
}

impl Core {
    /// The state a launch starts from. Nothing runs until [`Core::launch`].
    pub fn new(app: AppHandle, paths: Paths) -> (Arc<Core>, Receiver<()>) {
        let home = dirs::home_dir().unwrap_or_default();
        let registry = dit_daws::registry();
        let mut notices = Vec::new();
        let config = UserConfig::load(&paths.config).unwrap_or_else(|error| {
            notices.push(error.to_string());
            UserConfig::default()
        });
        let (rejected_files, never_here_folders) =
            crate::renders::remembered(&Ledger::beside(&paths.config));
        let host = Host {
            built_in_excluded: crate::renders::built_in_excluded(&registry),
            rejected_files,
            never_here_folders,
            ..Host::default()
        };
        let mut snapshot = Snapshot::empty(settings_of(&config, &home, &host));
        snapshot.permissions.screen_recording = permissions::granted();
        snapshot.notices = notices;
        let (dirty, signals) = mpsc::channel();
        let core = Arc::new_cyclic(|weak| {
            let backfill = Core::backfill_for(weak, &paths, &registry);
            Core {
                remote: AppRemote::for_app(paths.config.clone(), paths.dev),
                app_version: app.package_info().version.to_string(),
                reducer: Mutex::new(Reducer::new(
                    snapshot,
                    Arc::new(RepoReadout::new(registry.clone())),
                )),
                app,
                paths,
                registry,
                home,
                dirty,
                live: Mutex::default(),
                reading_set: Mutex::default(),
                config: Mutex::default(),
                login: Mutex::default(),
                serving: Mutex::default(),
                host: Mutex::new(host),
                links: Waiting::default(),
                binds: Mutex::default(),
                learning: AtomicBool::new(false),
                render_control: Mutex::default(),
                announced: Mutex::default(),
                restoring: Mutex::default(),
                restore_home: Mutex::default(),
                backfill,
            }
        });
        (core, signals)
    }

    /// Starts the emitting thread: every signal on `signals` sends the latest snapshot, no more than ten times a
    /// second, and sets the bar from it.
    pub fn emit_from(self: &Arc<Self>, signals: Receiver<()>) {
        let core = self.clone();
        let app = self.app.clone();
        self.backfill.emit_with(move |view| {
            let _ = app.emit(crate::backfill::EVENT, view);
        });
        thread::spawn(move || {
            let mut bar = tray::Shown::default();
            while signals.recv().is_ok() {
                while signals.try_recv().is_ok() {}
                let snapshot = core.snapshot();
                let _ = core.app.emit(STATE_EVENT, &snapshot);
                bar.show(&core.app, &snapshot);
                thread::sleep(EMIT_EVERY);
            }
        });
    }

    /// Opens the stored sign-in and starts the daemon with it.
    pub fn launch(self: &Arc<Self>) {
        self.refresh_script();
        // A run a quit or a crash left stopped shows in the menu as paused from the first snapshot.
        self.backfill.load();
        let hub = self.connect();
        self.start_daemon(hub);
    }

    pub fn snapshot(&self) -> Snapshot {
        lock(&self.reducer).snapshot().clone()
    }

    /// Runs `change` on the reducer, then has the new snapshot sent.
    pub fn with_reducer<T>(&self, change: impl FnOnce(&mut Reducer) -> T) -> T {
        let out = change(&mut lock(&self.reducer));
        let _ = self.dirty.send(());
        out
    }

    pub fn serve(&self, serving: Serving) {
        *lock(&self.serving) = Some(serving);
    }

    /// Quits and starts the app again, the way [`tauri::AppHandle::restart`] does: the exit runs `shutdown` first.
    pub fn restart(&self) -> ! {
        self.app.restart()
    }

    /// Stops answering the socket and stops the daemon, waiting for what it is writing. A backfill goes first: it is
    /// paused and given the time to stop at its next step, and it asks the daemon to let go of its folder as it does.
    pub fn shutdown(&self) {
        self.backfill.shutdown();
        lock(&self.serving).take();
        let live = lock(&self.live).take();
        if let Some(live) = live {
            live.halt();
        }
    }

    fn script_kit(&self) -> Option<ScriptKit> {
        self.registry
            .all()
            .iter()
            .find_map(|daw| daw.script_kit(&self.home))
    }

    /// Reads what the machine says of Live's script again: after it was installed or reinstalled, and at launch.
    pub fn refresh_script(&self) {
        let facts = self.script_facts();
        self.with_reducer(|reducer| reducer.set_script(facts));
    }

    /// What the machine says of Live's script: whether Live is installed, and whether the script is and where.
    fn script_facts(&self) -> ScriptFacts {
        self.registry
            .all()
            .iter()
            .find_map(|daw| {
                let kit = daw.script_kit(&self.home)?;
                let installed = kit.status().installed;
                Some(ScriptFacts {
                    live_found: crate::daw_app::is_installed(*daw),
                    installed,
                    path: installed.then(|| kit.folder.display().to_string()),
                })
            })
            .unwrap_or_default()
    }

    /// Opens the stored sign-in and puts what it says into the snapshot. `None` when there is none to push with.
    fn connect(&self) -> Option<Hub> {
        let opened = self.remote.open();
        let host = || {
            UserConfig::load(&self.paths.config)
                .ok()
                .and_then(|config| config.instance)
                .map(|instance| instance.url().to_string())
        };
        let machine = opened.as_ref().ok().map(|_| {
            let name = UserConfig::load(&self.paths.config)
                .map(|config| config.machine())
                .unwrap_or_else(|_| dit_core::machine::name(None));
            remote::machine_id_at(&self.paths.config).map(|id| Machine {
                id,
                name,
                platform: remote::platform().to_string(),
                app_version: self.app_version.clone(),
            })
        });
        match (opened, machine) {
            (Ok(remote), Some(Ok(machine))) => {
                self.with_reducer(|reducer| {
                    reducer.set_auth(Auth {
                        state: AuthState::SignedIn,
                        host: Some(remote.client().instance().url().to_string()),
                        pending: None,
                    });
                    reducer.set_hub(Some(machine.name.clone()));
                });
                self.first_signed_in();
                Some(Hub {
                    remote: Arc::new(remote),
                    machine,
                })
            }
            (opened, machine) => {
                let error = machine
                    .and_then(Result::err)
                    .or_else(|| opened.err())
                    .unwrap_or(RemoteError::NoInstance);
                let (auth, notice) = auth_after(&error, host());
                self.with_reducer(|reducer| {
                    reducer.set_auth(auth);
                    reducer.set_hub(None);
                    if let Some(notice) = notice {
                        reducer.notice(notice);
                    }
                });
                None
            }
        }
    }

    fn start_daemon(self: &Arc<Self>, hub: Option<Hub>) {
        let instance = hub
            .as_ref()
            .map(|hub| hub.remote.client().instance().url().to_string());
        let config = Config {
            registry: self.registry.clone(),
            home: self.home.clone(),
            repos_file: self.paths.repos.clone(),
            clock: Arc::new(SystemClock),
            lock_wait: LOCK_WAIT,
        };
        let options = Options {
            script_folder: self.script_kit().map(|kit| kit.folder),
            app_version: self.app_version.clone(),
            hub,
            renders: self.render_options(),
            ..Options::default()
        };
        let running = match start(config, options) {
            Ok(running) => running,
            Err(error) => {
                self.with_reducer(|reducer| {
                    reducer.notice(format!(
                        "dit couldn't start watching your projects: {error}"
                    ));
                });
                // No catch-up is coming, and a link has nothing to wait for.
                self.launched();
                return;
            }
        };
        let stop = Arc::new(AtomicBool::new(false));
        let (jobs, requests) = mpsc::channel();
        let folding = {
            let (core, stop) = (self.clone(), stop.clone());
            thread::spawn(move || core.fold(running, &requests, &stop))
        };
        // Which project each hub repo is in gives the repo list its links to the web.
        if instance.is_some() {
            self.learn_repo_projects();
        }
        *lock(&self.live) = Some(Live {
            jobs,
            stop,
            folding,
            instance,
        });
    }

    /// Hands the daemon's events to the reducer and runs the jobs commands left for it, until told to stop; reads
    /// the open set again each minute. Owns the daemon, which stops when this returns.
    fn fold(self: &Arc<Self>, running: Running, requests: &Receiver<Job>, stop: &AtomicBool) {
        self.render_attached(&running);
        let mut refreshed = Instant::now();
        while !stop.load(Ordering::SeqCst) {
            match running.events().recv_timeout(Duration::from_millis(250)) {
                Ok(DaemonEvent::Adopted { folder }) => {
                    self.with_reducer(|reducer| reducer.finish_adopting(&folder));
                }
                Ok(DaemonEvent::Launched) => self.launched(),
                Ok(event) => {
                    let needs_projects = self.with_reducer(|reducer| {
                        reducer.apply(&event);
                        reducer.needs_projects()
                    });
                    match &event {
                        DaemonEvent::AdoptOffer { folder, .. } => {
                            self.offer_projects(folder.clone())
                        }
                        DaemonEvent::RepoTracked { repo } => self.bind_if_chosen(repo),
                        DaemonEvent::Render(card) => self.render_changed(card),
                        DaemonEvent::Push(_) if needs_projects => self.learn_repo_projects(),
                        DaemonEvent::RejectionsSynced => self.publish_remembered(),
                        DaemonEvent::SignedOut { .. } => art::clear_cache(),
                        _ => {}
                    }
                    // What the hub says of the open set changes with the set, a commit and a push.
                    if matches!(
                        event,
                        DaemonEvent::OpenSet(_)
                            | DaemonEvent::Committed { .. }
                            | DaemonEvent::Push(PushEvent::Pushed { .. })
                    ) {
                        self.learn_set();
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
            while let Ok(job) = requests.try_recv() {
                job(&running);
            }
            if refreshed.elapsed() >= REFRESH_EVERY {
                refreshed = Instant::now();
                self.refresh_machine();
                self.with_reducer(Reducer::refresh);
            }
        }
    }

    /// The stored sign-in may have changed (a sign-in or sign-out here, or `dit login` over the socket): read it
    /// again and attach the hub to the running daemon, or detach it when there is none. A daemon that is not
    /// running is started with the sign-in.
    pub fn reconcile(self: &Arc<Self>) {
        let hub = self.connect();
        if hub.is_none() {
            art::clear_cache();
        }
        let instance = hub
            .as_ref()
            .map(|hub| hub.remote.client().instance().url().to_string());
        let mut live = lock(&self.live);
        let Some(running) = live.as_mut() else {
            drop(live);
            self.start_daemon(hub);
            return;
        };
        let core = self.clone();
        let attached = instance.is_some();
        let _ = running.jobs.send(Box::new(move |running| match hub {
            Some(hub) => {
                if let Err(error) = running.attach_hub(hub) {
                    core.with_reducer(|reducer| {
                        reducer.notice(format!("dit couldn't reach the hub: {error}"));
                    });
                }
                core.render_attached(running);
            }
            None => {
                running.detach_hub();
                core.render_detached();
            }
        }));
        running.instance = instance;
        drop(live);
        if attached {
            self.learn_repo_projects();
            self.learn_set();
        }
    }

    /// Has the running daemon do `job`; an error when none runs.
    pub fn tell(&self, job: impl FnOnce(&Running) + Send + 'static) -> Result<(), String> {
        let jobs = lock(&self.live).as_ref().map(|live| live.jobs.clone());
        jobs.ok_or_else(|| "dit isn't watching your projects right now.".to_string())?
            .send(Box::new(job))
            .map_err(|_| "dit isn't watching your projects right now.".to_string())
    }

    /// Reads the open set's repo again.
    pub fn refresh(&self) {
        self.with_reducer(Reducer::refresh);
    }

    /// Edits the user config on disk and takes the result into the snapshot's settings. A change that refuses
    /// leaves the file as it was.
    pub fn update_config(
        &self,
        change: impl FnOnce(&mut UserConfig) -> Result<(), String>,
    ) -> Result<(), String> {
        let _held = lock(&self.config);
        let mut config = UserConfig::load(&self.paths.config).map_err(|e| e.to_string())?;
        change(&mut config)?;
        config.save(&self.paths.config).map_err(|e| e.to_string())?;
        let settings = settings_of(&config, &self.home, &lock(&self.host));
        self.with_reducer(|reducer| reducer.set_settings(settings));
        Ok(())
    }

    /// Keeps the commit box's text for the set file at `set` until it is committed. Emitted through the throttled
    /// snapshot stream so screen transitions read the latest draft from the single Rust store.
    pub fn set_draft(&self, set: String, message: String) {
        self.with_reducer(|reducer| reducer.set_draft(set, message));
    }

    /// Commits the latest save of the set file at `set`, as the cli's `dit commit` does with its message and its
    /// default; the commit is wanted on the hub afterwards.
    pub fn commit(&self, set: &str, message: &str) -> Result<(), String> {
        let root = commit::commit(&self.remote, &self.registry, set, message)?;
        self.with_reducer(|reducer| reducer.set_draft(set.to_string(), String::new()));
        self.refresh();
        // With no daemon or no hub there is nothing to push: the commit is made and kept here.
        let _ = self.tell(move |running| running.push(&root, Phase::Commits));
        Ok(())
    }

    /// Runs what the cli sent over the socket, then brings the app up to date with what it did.
    pub fn run_for_cli(
        self: &Arc<Self>,
        run: Run,
        stderr: &mut dyn std::io::Write,
    ) -> dit_ipc::Done {
        let verb = run.argv.iter().find(|arg| !arg.starts_with('-')).cloned();
        let cwd = run.cwd.clone();
        let control = self.render_control();
        let backfill: &dyn dit_daemon::backfill::BackfillControl = self.backfill.as_ref();
        let done = dit_cli::handle(
            run,
            stderr,
            &self.remote,
            control.as_deref(),
            Some(backfill),
        );
        match verb.as_deref() {
            Some("login" | "logout") => self.reconcile(),
            Some("init") if done.code == 0 => {
                let _ = self.tell(move |running| running.send(Input::AddRepo(cwd)));
            }
            Some("commit") if done.code == 0 => {
                self.with_reducer(|reducer| reducer.clear_drafts_in(&cwd));
            }
            Some("script") => self.refresh_script(),
            _ => {}
        }
        self.refresh();
        done
    }

    /// Starts the device-grant sign-in on a thread; the code reaches the panel through the snapshot. A sign-in
    /// already waiting is shown again instead ("Open again").
    pub fn sign_in(self: &Arc<Self>, host: Option<String>) -> Result<(), String> {
        let instance = host
            .as_deref()
            .map(Instance::parse)
            .transpose()
            .map_err(|e| e.to_string())?;
        {
            let mut waiting = lock(&self.login);
            if let Some(uri) = &*waiting {
                if !uri.is_empty() {
                    open_url(uri)?;
                }
                return Ok(());
            }
            *waiting = Some(String::new());
        }
        let shown = instance
            .map(|instance| instance.url().to_string())
            .or_else(|| self.snapshot().auth.host);
        self.with_reducer(|reducer| {
            reducer.set_auth(Auth {
                state: AuthState::SigningIn,
                host: shown,
                pending: None,
            });
            reducer.clear_notices();
        });
        let core = self.clone();
        thread::spawn(move || {
            let result = core.log_in(host.as_deref());
            *lock(&core.login) = None;
            match result {
                Ok(()) => core.reconcile(),
                Err(error) => core.login_failed(&error),
            }
        });
        Ok(())
    }

    fn log_in(&self, host: Option<&str>) -> Result<(), RemoteError> {
        let tokens = self.remote.tokens()?;
        remote::login(
            &self.paths.config,
            tokens.as_ref(),
            &remote::SystemClock,
            host,
            |code| self.show_code(code),
            |error| {
                self.with_reducer(|reducer| {
                    reducer.notice(format!(
                        "The previous session may still be open on the instance: {error}"
                    ));
                });
            },
        )
        .map(|_| ())
    }

    fn show_code(&self, code: &DeviceCode) {
        *lock(&self.login) = Some(code.verification_uri_complete.clone());
        self.with_reducer(|reducer| {
            let host = reducer.snapshot().auth.host.clone();
            reducer.set_auth(Auth {
                state: AuthState::SigningIn,
                host,
                pending: Some(Pending {
                    user_code: code.user_code.clone(),
                    verification_uri: code.verification_uri.clone(),
                }),
            });
        });
        if let Err(error) = open_url(&code.verification_uri_complete) {
            self.with_reducer(|reducer| reducer.notice(error));
        }
    }

    fn login_failed(&self, error: &RemoteError) {
        let host = self.snapshot().auth.host;
        let (auth, notice) = match error {
            RemoteError::Denied | RemoteError::Expired => (
                Auth {
                    state: AuthState::SignedOut,
                    host,
                    pending: None,
                },
                Some(failure_line(error)),
            ),
            other => auth_after(other, host),
        };
        let notice = notice.or_else(|| Some(failure_line(error)));
        self.with_reducer(|reducer| {
            reducer.set_auth(auth);
            if let Some(notice) = notice {
                reducer.notice(notice);
            }
        });
    }

    /// Forgets the sign-in on this computer: stops pushing, takes this computer off the account's machines on the
    /// instance and deletes the token. The session itself stays open on the instance (the cli's `dit logout` is the
    /// one that ends it); saves keep being recorded. The instance stays in the config, so signing in again needs no
    /// address.
    pub fn sign_out(self: &Arc<Self>) -> Result<(), String> {
        let tokens = self.remote.tokens().map_err(|e| e.to_string())?;
        let removal = forget_sign_in(&self.paths.config, tokens.as_ref(), || {
            self.stop_pushing();
        })
        .map_err(|e| e.to_string())?;
        art::clear_cache();
        if let Some(error) = removal {
            self.with_reducer(|reducer| {
                reducer.notice(format!(
                    "This computer may still be listed in your machines on the instance: {error}"
                ));
            });
        }
        self.reconcile();
        Ok(())
    }

    /// Detaches the hub from the running daemon and waits for it to be gone, so that no beat registers this machine
    /// again once it has been removed from the instance.
    fn stop_pushing(self: &Arc<Self>) {
        let (done, detached) = mpsc::channel();
        let core = self.clone();
        let told = self.tell(move |running| {
            running.detach_hub();
            core.render_detached();
            let _ = done.send(());
        });
        if told.is_ok() {
            let _ = detached.recv_timeout(DETACH_WAIT);
        }
    }

    /// The panel's `open_web`: `path` on the instance this machine signs in to.
    pub fn web_url(&self, path: Option<&str>) -> Result<String, String> {
        let config = UserConfig::load(&self.paths.config).map_err(|e| e.to_string())?;
        let instance = config
            .instance
            .ok_or_else(|| "No instance to open. Sign in first.".to_string())?;
        Ok(join_url(instance.url(), path))
    }
}

/// `path` on the instance at `origin`; the instance's front page for none.
fn join_url(origin: &str, path: Option<&str>) -> String {
    let path = path.unwrap_or("");
    let separator = if path.is_empty() || path.starts_with('/') {
        ""
    } else {
        "/"
    };
    format!("{origin}{separator}{path}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_home_folder_is_the_watch_root_until_roots_are_chosen() {
        let home = Path::new("/Users/me");
        let host = Host::default();
        let mut config = UserConfig::default();
        assert_eq!(settings_of(&config, home, &host).watch_roots, ["/Users/me"]);

        config.watch_roots = vec!["/Volumes/Music".to_string()];
        config.excluded = vec!["/Volumes/Music/old".to_string()];
        config.max_upload_mb = Some(40);
        config.shortcut = Some("Alt+Shift+D".to_string());
        config.machine = Some("Studio Mac".to_string());
        let settings = settings_of(&config, home, &host);
        assert_eq!(settings.watch_roots, ["/Volumes/Music"]);
        assert_eq!(settings.excluded, ["/Volumes/Music/old"]);
        assert_eq!(settings.max_upload_mb, 40);
        assert_eq!(settings.shortcut.as_deref(), Some("Alt+Shift+D"));
        assert_eq!(settings.machine_name, "Studio Mac");
        assert!(!settings.autostart);
        assert_eq!(settings.shortcut_error, None);
        assert_eq!(settings.cli_installed, None);
    }

    #[test]
    fn what_the_machine_says_is_carried_into_the_settings() {
        let host = Host {
            shortcut_error: Some("Alt+D is taken by another app.".to_string()),
            autostart: true,
            cli_installed: Some("/usr/local/bin/dit".to_string()),
            ..Host::default()
        };
        let settings = settings_of(&UserConfig::default(), Path::new("/Users/me"), &host);
        assert_eq!(
            settings.shortcut_error.as_deref(),
            Some("Alt+D is taken by another app.")
        );
        assert!(settings.autostart);
        assert_eq!(
            settings.cli_installed.as_deref(),
            Some("/usr/local/bin/dit")
        );
    }

    const FIXTURES: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/dit/crates/dit-daw-ableton/fixtures/Contract Fixtures Project"
    );

    /// `DaemonEvent::Launched` arrives only after the daemon has launched and caught up every repo in its list:
    /// the catch-up's own events all come before it.
    #[test]
    fn launched_arrives_after_the_launch_catch_up_of_every_repo() {
        let dir = tempfile::tempdir().unwrap();
        let registry = dit_daws::registry();
        let project = dir.path().join("Test Project");
        std::fs::create_dir(&project).unwrap();
        std::fs::copy(
            Path::new(FIXTURES).join("Empty Set.als"),
            project.join("Empty Set.als"),
        )
        .unwrap();
        dit_core::Repo::init(&project, registry.all()[0]).unwrap();
        let repos_file = dir.path().join("repos.toml");
        RepoList::update(&repos_file, |list| {
            list.add(&project.canonicalize().unwrap())
        })
        .unwrap();

        let running = start(
            Config {
                registry,
                home: dir.path().to_path_buf(),
                repos_file,
                clock: Arc::new(SystemClock),
                lock_wait: LOCK_WAIT,
            },
            Options::default(),
        )
        .unwrap();

        let mut before = Vec::new();
        loop {
            let event = running
                .events()
                .recv_timeout(Duration::from_secs(30))
                .expect("the daemon emits Launched");
            if matches!(event, DaemonEvent::Launched) {
                break;
            }
            before.push(event);
        }
        running.stop();

        assert!(
            before
                .iter()
                .any(|event| matches!(event, DaemonEvent::RepoTracked { .. })),
            "the repo was tracked before Launched"
        );
        assert!(
            before.iter().any(|event| matches!(
                event,
                DaemonEvent::SaveRecorded {
                    origin: dit_daemon::event::Origin::CatchUp,
                    ..
                }
            )),
            "its catch-up save was recorded before Launched"
        );
    }

    /// Adopting a folder against a real daemon: the sets are listed as saving, their first saves come before
    /// `DaemonEvent::Adopted`, and the list is gone once they have landed.
    #[test]
    fn an_adopted_folders_sets_are_listed_until_their_first_saves_have_landed() {
        let dir = tempfile::tempdir().unwrap();
        let registry = dit_daws::registry();
        let project = dir.path().join("Adopt Project");
        std::fs::create_dir(&project).unwrap();
        for set in ["Arranged Set.als", "Empty Set.als", "Volatile Set.als"] {
            std::fs::copy(Path::new(FIXTURES).join(set), project.join(set)).unwrap();
        }
        let tracked = project.canonicalize().unwrap();
        let settings = settings_of(&UserConfig::default(), dir.path(), &Host::default());
        let mut reducer = Reducer::new(
            Snapshot::empty(settings),
            Arc::new(RepoReadout::new(registry.clone())),
        );
        let running = start(
            Config {
                registry,
                home: dir.path().to_path_buf(),
                repos_file: dir.path().join("repos.toml"),
                clock: Arc::new(SystemClock),
                lock_wait: LOCK_WAIT,
            },
            Options::default(),
        )
        .unwrap();

        reducer.begin_adopting(&project, tracked.clone());
        let listed = reducer.snapshot().adopting.clone().unwrap();
        assert_eq!(listed.set_count, 3);
        assert_eq!(
            listed
                .sets
                .iter()
                .map(|set| set.name.as_str())
                .collect::<Vec<_>>(),
            ["Arranged Set", "Empty Set", "Volatile Set"]
        );
        running.send(Input::Adopt(project.clone()));

        let mut landed = 0;
        loop {
            let event = running
                .events()
                .recv_timeout(Duration::from_secs(30))
                .expect("the daemon emits Adopted");
            if let DaemonEvent::Adopted { folder } = &event {
                assert_eq!(folder, &tracked);
                break;
            }
            if matches!(
                &event,
                DaemonEvent::SaveRecorded {
                    origin: dit_daemon::event::Origin::Adopt,
                    ..
                }
            ) {
                landed += 1;
            }
            reducer.apply(&event);
        }
        running.stop();

        assert_eq!(landed, 3, "every set's first save came before Adopted");
        assert_eq!(
            reducer.snapshot().adopting,
            None,
            "and the list went when the last of them landed"
        );
    }

    #[test]
    fn a_web_path_joins_the_instance_whether_or_not_it_starts_with_a_slash() {
        let origin = "https://projammr.example";
        assert_eq!(join_url(origin, None), origin);
        assert_eq!(join_url(origin, Some("")), origin);
        assert_eq!(
            join_url(origin, Some("/sessions/4")),
            "https://projammr.example/sessions/4"
        );
        assert_eq!(
            join_url(origin, Some("sessions/4")),
            "https://projammr.example/sessions/4"
        );
    }
}
