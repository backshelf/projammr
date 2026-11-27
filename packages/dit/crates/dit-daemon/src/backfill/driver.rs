//! The backfill run: the folders of a [`Plan`] one at a time, newest first as planned, each recorded and committed set
//! by set, bound to its sessions, and sent to the hub with byte progress, with every step written to the state file
//! before the next begins.
//!
//! One [`Driver`] serves the dit app (its window and the socket's `dit backfill`) and the terminal's `dit backfill`
//! when no app answers, so the two cannot disagree about where a run stands: the state file says, and the run lock
//! allows one run on a machine whoever started it. A run stops when it is paused (between sets, and between the
//! requests of a push), when the hub refuses the sign-in, or when the process ends; each leaves the state file at the
//! set it was on, and [`Driver::start`] on the same folders, or [`Driver::resume`], carries on from there. A step that
//! is repeated records nothing twice: a recording that is there is skipped, a set already bound is left bound, and a
//! push sends only what the hub does not hold.

use std::collections::VecDeque;
use std::fmt;
use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use dit_core::RepoList;
use dit_core::remote::{
    self, PushError, PushOptions, PushProgress, Remote, RemoteError, SetAdoption, SetTarget,
};

use super::run::{self, Recorder, Trouble};
use super::state::{
    FolderManifest, FolderPlan, FolderRun, FolderState, Plan, RunLock, RunStatus, State, Summary,
    Totals,
};
use crate::beat::retry_delay_ms;

/// Maximum number of project folders a backfill run pushes concurrently.
pub const MAX_CONCURRENCY: usize = 4;

/// What a run tells whoever started it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// A folder's state changed, or its upload moved (about four times a second).
    Folder { path: PathBuf, state: FolderState },
    /// The run stopped on request and is saved at the set it was on.
    Paused,
}

/// Why a run did not finish.
#[derive(Debug)]
pub enum BackfillError {
    /// Another run holds the machine's run lock: the app's window, or a terminal.
    Busy,
    /// The run was paused. The state file keeps its place: start the same folders again, or resume.
    Paused,
    /// There are no folders to bring in.
    Nothing,
    /// The state file cannot be read or written.
    State(String),
    /// The hub connection could not be opened (no instance, not signed in).
    Remote(RemoteError),
    /// The hub no longer accepts the sign-in. The run is paused until the producer signs in again.
    SignedOut { host: String },
}

impl fmt::Display for BackfillError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BackfillError::Busy => f.write_str(
                "A backfill is running on this machine already. Wait for it, or pause it first.",
            ),
            BackfillError::Paused => {
                f.write_str("Paused. Run the same command to carry on where it stopped.")
            }
            BackfillError::Nothing => f.write_str("There are no projects to bring in."),
            BackfillError::State(message) => f.write_str(message),
            BackfillError::Remote(error) => error.fmt(f),
            BackfillError::SignedOut { host } => {
                write!(f, "Signed out of {host}. Run dit login, then carry on.")
            }
        }
    }
}

impl std::error::Error for BackfillError {}

impl BackfillError {
    fn state(error: std::io::Error) -> Self {
        BackfillError::State(error.to_string())
    }
}

/// What the app hands the cli, so `dit backfill` through the socket and the window are one run.
pub trait BackfillControl: Send + Sync {
    /// Brings in the folders of `plan`, resuming the stopped run of the same work, and returns when every folder is
    /// done or failed ([`BackfillError::Paused`] when the run is paused instead). `out` hears each change as it
    /// happens, on the calling thread.
    fn start(&self, plan: Plan, out: &mut dyn FnMut(Event)) -> Result<Summary, BackfillError>;

    /// Like [`BackfillControl::start`], overlapping up to `concurrency` independent folders (clamped to
    /// `1..=MAX_CONCURRENCY`).
    fn start_with_concurrency(
        &self,
        plan: Plan,
        _concurrency: usize,
        out: &mut dyn FnMut(Event),
    ) -> Result<Summary, BackfillError> {
        self.start(plan, out)
    }

    /// How the run stands, `None` when there has never been one. Reads the state file, so a run another process
    /// started shows too; a state file that cannot be read is an error.
    fn status(&self) -> Result<Option<RunStatus>, BackfillError>;

    /// Stops the run in this process after the step it is in: between sets, or between the requests of a push. A
    /// cli whose connection dropped is a cli that wants this.
    fn pause(&self);
}

/// What the run asks of the app's daemon for a folder it is bringing in.
pub trait Owner: Send + Sync {
    /// The run owns `folder`: the push queue must leave it alone until [`Owner::release`], so nothing else pushes it.
    fn hold(&self, folder: &Path);
    /// The run is done with `folder`, brought in or not.
    fn release(&self, folder: &Path);
    /// `folder` is whole on the hub: the daemon tracks it from here, and records what Live saves in it.
    fn join(&self, folder: &Path);
}

/// An owner with no daemon to ask, for a run in the terminal: a finished folder joins the app through `repos.toml`,
/// which the app reads when it launches.
pub struct Alone;

impl Owner for Alone {
    fn hold(&self, _: &Path) {}
    fn release(&self, _: &Path) {}
    fn join(&self, _: &Path) {}
}

/// How a run is set up.
pub struct Config {
    pub recorder: Recorder,
    /// `backfill.json`, the state file.
    pub state: PathBuf,
    /// `repos.toml`, the list of repos the app tracks; a finished folder is added to it.
    pub repos: PathBuf,
    pub owner: Arc<dyn Owner>,
    /// How long a folder waits before it asks the hub again after the `n`th failure in a row.
    pub retry: fn(u32) -> Duration,
    /// How often an upload's progress is reported.
    pub progress_every: Duration,
    /// How many independent folders may push concurrently (clamped to `1..=MAX_CONCURRENCY`).
    pub concurrency: usize,
}

fn retry_after(failures: u32) -> Duration {
    Duration::from_millis(u64::try_from(retry_delay_ms(failures)).unwrap_or(0))
}

impl Config {
    /// A run with no daemon to ask, the beat's backoff between attempts and progress four times a second.
    pub fn new(recorder: Recorder, state: PathBuf, repos: PathBuf) -> Self {
        Config {
            recorder,
            state,
            repos,
            owner: Arc::new(Alone),
            retry: retry_after,
            progress_every: Duration::from_millis(250),
            concurrency: 1,
        }
    }
}

/// Why a folder stopped before it was done.
enum Stop {
    Paused,
    Failed(String),
    SignedOut(String),
    /// The state file could not be written: the whole run ends.
    State(String),
}

/// The run of one machine: starts, pauses and resumes it. Share it between threads; the run itself is one thread's
/// call to [`Driver::start`] or [`Driver::resume`].
pub struct Driver {
    config: Config,
    pause: AtomicBool,
}

impl Driver {
    pub fn new(config: Config) -> Self {
        Driver {
            config,
            pause: AtomicBool::new(false),
        }
    }

    /// Stops the run this process is in after the step it is in. A pause with no run going stops the next run before
    /// its first step; [`Driver::clear_pause`] takes it back, and a run that ends clears it.
    pub fn pause(&self) {
        self.pause.store(true, Ordering::SeqCst);
    }

    /// Forgets a pause no run has acted on, for a window that begins something new.
    pub fn clear_pause(&self) {
        self.pause.store(false, Ordering::SeqCst);
    }

    /// How the run stands, `None` when there has never been one. A state file that cannot be read is an error, not
    /// "no run".
    pub fn status(&self) -> Result<Option<RunStatus>, BackfillError> {
        let state = State::load(&self.config.state).map_err(BackfillError::state)?;
        if state.plan.folders.is_empty() {
            return Ok(None);
        }
        let running = RunLock::held(&self.config.state).map_err(BackfillError::state)?;
        Ok(Some(state.status(running)))
    }

    /// The project the last run's last folder went to: where the next one goes by default.
    pub fn last_project(&self) -> Result<Option<i64>, BackfillError> {
        Ok(State::load(&self.config.state)
            .map_err(BackfillError::state)?
            .last_project())
    }

    /// Brings in the folders of `plan`. The state file is started over for it, keeping what a stopped run of the same
    /// work already did, then every folder not done is brought in. See [`BackfillControl::start`].
    pub fn start(
        &self,
        remote: &Remote,
        plan: Plan,
        out: &mut dyn FnMut(Event),
    ) -> Result<Summary, BackfillError> {
        self.start_with_concurrency(remote, plan, self.config.concurrency, out)
    }

    /// Like [`Driver::start`], running up to `concurrency` folders concurrently (clamped to `1..=MAX_CONCURRENCY`).
    pub fn start_with_concurrency(
        &self,
        remote: &Remote,
        plan: Plan,
        concurrency: usize,
        out: &mut dyn FnMut(Event),
    ) -> Result<Summary, BackfillError> {
        if plan.folders.is_empty() {
            return Err(BackfillError::Nothing);
        }
        let lock = self.lock()?;
        self.clear_pause();
        State::update(&self.config.state, |state| state.begin(plan))
            .map_err(BackfillError::state)?;
        let ended = self.go(remote, lock, concurrency.clamp(1, MAX_CONCURRENCY), out);
        self.clear_pause();
        ended
    }

    /// Carries on the stopped run the state file holds, from the set it was on.
    pub fn resume(
        &self,
        remote: &Remote,
        out: &mut dyn FnMut(Event),
    ) -> Result<Summary, BackfillError> {
        let lock = self.lock()?;
        self.clear_pause();
        let held = State::update(&self.config.state, |state| {
            state.paused = false;
            !state.plan.folders.is_empty()
        })
        .map_err(BackfillError::state)?;
        if !held {
            return Err(BackfillError::Nothing);
        }
        let ended = self.go(
            remote,
            lock,
            self.config.concurrency.clamp(1, MAX_CONCURRENCY),
            out,
        );
        self.clear_pause();
        ended
    }

    fn lock(&self) -> Result<RunLock, BackfillError> {
        RunLock::take(&self.config.state)
            .map_err(BackfillError::state)?
            .ok_or(BackfillError::Busy)
    }

    fn stopped(&self) -> bool {
        self.pause.load(Ordering::SeqCst)
    }

    fn go(
        &self,
        remote: &Remote,
        _lock: RunLock,
        concurrency: usize,
        out: &mut dyn FnMut(Event),
    ) -> Result<Summary, BackfillError> {
        let state = State::load(&self.config.state).map_err(BackfillError::state)?;
        let pending: VecDeque<(usize, &FolderPlan, &FolderRun)> = state
            .plan
            .folders
            .iter()
            .enumerate()
            .filter_map(|(index, folder)| {
                let run = &state.folders[index];
                (run.state != FolderState::Done).then_some((index, folder, run))
            })
            .collect();

        if concurrency <= 1 || pending.len() <= 1 {
            let mut reporter = Reporter {
                sink: Sink::Direct(out),
                state: &self.config.state,
                every: self.config.progress_every,
                last: None,
                current: FolderState::Waiting,
            };
            for (index, folder, run) in pending {
                if self.stopped() {
                    return self.paused(&mut reporter);
                }
                match self.folder(remote, &mut reporter, index, folder, run) {
                    Ok(()) | Err(Stop::Failed(_)) => {}
                    Err(Stop::Paused) => return self.paused(&mut reporter),
                    Err(Stop::SignedOut(host)) => {
                        self.mark_paused()?;
                        return Err(BackfillError::SignedOut { host });
                    }
                    Err(Stop::State(message)) => return Err(BackfillError::State(message)),
                }
            }
            let state = State::load(&self.config.state).map_err(BackfillError::state)?;
            return Ok(state.status(true).summary());
        }

        enum RunStop {
            Paused,
            SignedOut(String),
            State(String),
        }

        let workers = concurrency.min(pending.len());
        let queue = Mutex::new(pending);
        let stop_reason: Mutex<Option<RunStop>> = Mutex::new(None);
        let (tx, rx) = mpsc::channel::<Event>();

        thread::scope(|scope| {
            for _ in 0..workers {
                let tx = tx.clone();
                scope.spawn(|| {
                    let mut reporter = Reporter {
                        sink: Sink::Channel(tx),
                        state: &self.config.state,
                        every: self.config.progress_every,
                        last: None,
                        current: FolderState::Waiting,
                    };
                    loop {
                        if self.stopped() {
                            let mut guard = stop_reason
                                .lock()
                                .unwrap_or_else(|poisoned| poisoned.into_inner());
                            if guard.is_none() {
                                *guard = Some(RunStop::Paused);
                            }
                            return;
                        }
                        let next = queue
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner())
                            .pop_front();
                        let Some((index, folder, run)) = next else {
                            return;
                        };
                        match self.folder(remote, &mut reporter, index, folder, run) {
                            Ok(()) | Err(Stop::Failed(_)) => {}
                            Err(Stop::Paused) => {
                                let mut guard = stop_reason
                                    .lock()
                                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                                if guard.is_none() {
                                    *guard = Some(RunStop::Paused);
                                }
                                return;
                            }
                            Err(Stop::SignedOut(host)) => {
                                self.pause();
                                let mut guard = stop_reason
                                    .lock()
                                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                                *guard = Some(RunStop::SignedOut(host));
                                return;
                            }
                            Err(Stop::State(message)) => {
                                self.pause();
                                let mut guard = stop_reason
                                    .lock()
                                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                                *guard = Some(RunStop::State(message));
                                return;
                            }
                        }
                    }
                });
            }
            drop(tx);
            for event in rx {
                out(event);
            }
        });

        match stop_reason.into_inner().unwrap_or_else(|p| p.into_inner()) {
            Some(RunStop::Paused) => {
                self.mark_paused()?;
                out(Event::Paused);
                return Err(BackfillError::Paused);
            }
            Some(RunStop::SignedOut(host)) => {
                self.mark_paused()?;
                return Err(BackfillError::SignedOut { host });
            }
            Some(RunStop::State(message)) => return Err(BackfillError::State(message)),
            None => {}
        }

        let state = State::load(&self.config.state).map_err(BackfillError::state)?;
        Ok(state.status(true).summary())
    }

    fn mark_paused(&self) -> Result<(), BackfillError> {
        State::update(&self.config.state, |state| state.paused = true).map_err(BackfillError::state)
    }

    fn paused(&self, reporter: &mut Reporter) -> Result<Summary, BackfillError> {
        self.mark_paused()?;
        reporter.sink.send(Event::Paused);
        Err(BackfillError::Paused)
    }

    /// Brings in one folder and writes how it ended. A folder that fails is [`FolderState::Failed`] and the run goes on
    /// to the next; a stop that ends the run is the `Err`, with the folder left as [`FolderState::Paused`].
    fn folder(
        &self,
        remote: &Remote,
        reporter: &mut Reporter,
        index: usize,
        folder: &FolderPlan,
        run: &FolderRun,
    ) -> Result<(), Stop> {
        let owner = &self.config.owner;
        owner.hold(&folder.path);
        let ended = self.bring_in(remote, reporter, index, folder, run);
        owner.release(&folder.path);
        match ended {
            Ok((totals, manifest)) => {
                // A list that cannot be written must not fail a folder that is on the hub: the app's own `Join`
                // tracks it now and `dit init` leaves it out of the list the same way.
                let _ = RepoList::update(&self.config.repos, |list| list.add(&folder.path));
                reporter.set(index, &folder.path, FolderState::Done, |run| {
                    run.totals = Some(totals);
                    run.manifest = Some(manifest);
                })?;
                owner.join(&folder.path);
                Ok(())
            }
            Err(Stop::Failed(message)) => {
                reporter.set(
                    index,
                    &folder.path,
                    FolderState::Failed(message.clone()),
                    |_| {},
                )?;
                Err(Stop::Failed(message))
            }
            Err(Stop::Paused) => {
                reporter.set(index, &folder.path, FolderState::Paused, |_| {})?;
                Err(Stop::Paused)
            }
            Err(stop @ Stop::SignedOut(_)) => {
                reporter.set(index, &folder.path, FolderState::Paused, |_| {})?;
                Err(stop)
            }
            Err(stop @ Stop::State(_)) => Err(stop),
        }
    }

    fn bring_in(
        &self,
        remote: &Remote,
        reporter: &mut Reporter,
        index: usize,
        folder: &FolderPlan,
        run: &FolderRun,
    ) -> Result<(Totals, FolderManifest), Stop> {
        let committed = run.committed;
        let path = folder.path.as_path();
        if !path.is_dir() {
            let name = path.file_name().map_or_else(
                || path.display().to_string(),
                |name| name.to_string_lossy().into_owned(),
            );
            return Err(Stop::Failed(format!("{name} moved or was deleted.")));
        }
        let recorder = &self.config.recorder;
        let of = u32::try_from(folder.sets.len()).unwrap_or(u32::MAX);
        let from = committed.min(of);
        reporter.set(
            index,
            path,
            FolderState::Committing { done: from, of },
            |_| {},
        )?;
        let repo = recorder
            .repo(path)
            .map_err(|error| Stop::Failed(error.to_string()))?;

        for (at, set) in folder.sets.iter().enumerate().skip(from as usize) {
            if self.stopped() {
                return Err(Stop::Paused);
            }
            repo.backfill_set(&set.file, &recorder.author)
                .map_err(|error| {
                    let name = set.file.file_name().map_or_else(
                        || set.file.display().to_string(),
                        |name| name.to_string_lossy().into_owned(),
                    );
                    Stop::Failed(format!("{name}: {error}"))
                })?;
            let done = u32::try_from(at + 1).unwrap_or(u32::MAX);
            reporter.set(index, path, FolderState::Committing { done, of }, |run| {
                run.committed = done;
            })?;
        }
        if self.stopped() {
            return Err(Stop::Paused);
        }

        let host = remote.client().instance().host().to_string();
        let mut made = run.tracks.clone();
        let mut targets: Vec<(String, SetTarget)> = Vec::with_capacity(folder.sets.len());
        for set in &folder.sets {
            let target = match &set.target {
                SetTarget::NewTrack(title) => {
                    let id = match made.get(title) {
                        Some(id) => *id,
                        None => {
                            let id = self.hub(reporter, index, path, &host, |_| {
                                remote::create_track(remote, folder.project_id, title)
                                    .map_err(PushError::from)
                            })?;
                            made.insert(title.clone(), id);
                            reporter.remember(index, |run| {
                                run.tracks.insert(title.clone(), id);
                            })?;
                            id
                        }
                    };
                    SetTarget::Track(id)
                }
                other => other.clone(),
            };
            targets.push((set.set_id.clone(), target));
        }
        let adoption = self.hub(reporter, index, path, &host, |_| {
            remote::adopt_sets(&repo, remote, folder.project_id, &targets, true)
        })?;
        let mut adopted: Vec<&str> = Vec::with_capacity(adoption.sets.len());
        let mut session_ids: Vec<i64> = Vec::with_capacity(adoption.sets.len());
        let mut taken: Vec<&str> = Vec::new();
        for (set_id, answer) in &adoption.sets {
            match answer {
                SetAdoption::Adopted { session_id } => {
                    adopted.push(set_id);
                    session_ids.push(*session_id);
                }
                SetAdoption::Taken { message } => taken.push(message),
            }
        }
        let track_id = targets.iter().find_map(|(_, target)| match target {
            SetTarget::Track(id) => Some(*id),
            _ => None,
        });
        let track_title = folder.sets.iter().find_map(|set| match &set.target {
            SetTarget::NewTrack(title) => Some(title.clone()),
            _ => None,
        });
        let matched_existing = folder
            .sets
            .iter()
            .any(|set| matches!(set.target, SetTarget::Session(_) | SetTarget::Track(_)));
        let manifest = FolderManifest {
            repo_id: adoption.repo_id,
            track_id,
            track_title,
            matched_existing,
            session_ids,
        };

        let samples = self.hub(reporter, index, path, &host, |_| {
            remote::pushes_samples(&repo, remote)
        })?;
        let objects = run::objects_of(&repo, &adopted, samples)
            .map_err(|error| Stop::Failed(error.to_string()))?;
        let storage = self.hub(reporter, index, path, &host, |_| {
            run::storage(remote, folder.project_id, &objects).map_err(PushError::from)
        })?;
        let of_bytes = storage.bytes;
        reporter.set(
            index,
            path,
            FolderState::Uploading {
                sent: 0,
                of: of_bytes,
            },
            |_| {},
        )?;

        // What earlier runs of the folder sent, which a push that resumes does not send again.
        let before = run.bytes;
        let mut sent = 0u64;
        for set_id in &adopted {
            if self.stopped() {
                return Err(Stop::Paused);
            }
            let options = PushOptions {
                set: Some((*set_id).to_string()),
                ..PushOptions::default()
            };
            let pushed = self.hub(reporter, index, path, &host, |reporter| {
                remote::push_observed(&repo, remote, &options, &mut |progress| {
                    if let PushProgress::Uploaded { bytes } = progress {
                        sent = sent.saturating_add(bytes);
                        reporter.progress(
                            path,
                            FolderState::Uploading {
                                sent: sent.min(of_bytes),
                                of: of_bytes,
                            },
                        );
                    }
                    if self.stopped() {
                        ControlFlow::Break(())
                    } else {
                        ControlFlow::Continue(())
                    }
                })
            });
            reporter.remember(index, |run| run.bytes = before + sent)?;
            pushed?;
        }

        if let Some(message) = taken.first() {
            let count = taken.len();
            return Err(Stop::Failed(format!(
                "{count} of {} sets could not be bound to the sessions chosen for them, and were not sent: {message}",
                folder.sets.len()
            )));
        }
        let totals = run::totals(&repo, &adopted, before + sent)
            .map_err(|error| Stop::Failed(error.to_string()))?;
        Ok((totals, manifest))
    }

    /// Runs one step that talks to the hub. A hub that cannot be reached, is busy or is rate limiting leaves the folder
    /// [`FolderState::WaitingForHub`] and is asked again after the backoff, for as long as it takes; a refusal the hub
    /// means fails the folder, a sign-in it refuses ends the run, and a pause ends the wait.
    fn hub<T>(
        &self,
        reporter: &mut Reporter,
        index: usize,
        path: &Path,
        host: &str,
        mut attempt: impl FnMut(&mut Reporter) -> Result<T, PushError>,
    ) -> Result<T, Stop> {
        let mut failures = 0u32;
        loop {
            let error = match attempt(reporter) {
                Ok(value) => return Ok(value),
                Err(error) => error,
            };
            match run::trouble(error, host) {
                Trouble::Retry => {
                    failures += 1;
                    let back = reporter.current.clone();
                    reporter.set(index, path, FolderState::WaitingForHub, |_| {})?;
                    self.wait((self.config.retry)(failures))?;
                    reporter.progress(path, back);
                }
                Trouble::Refused(message) => return Err(Stop::Failed(message)),
                Trouble::SignedOut(host) => return Err(Stop::SignedOut(host)),
                Trouble::Stopped => return Err(Stop::Paused),
            }
        }
    }

    /// Sleeps `delay`, in short steps so a pause ends it.
    fn wait(&self, delay: Duration) -> Result<(), Stop> {
        let until = Instant::now() + delay;
        loop {
            if self.stopped() {
                return Err(Stop::Paused);
            }
            let left = until.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Ok(());
            }
            thread::sleep(left.min(Duration::from_millis(50)));
        }
    }
}

enum Sink<'a> {
    Direct(&'a mut dyn FnMut(Event)),
    Channel(mpsc::Sender<Event>),
}

impl Sink<'_> {
    fn send(&mut self, event: Event) {
        match self {
            Sink::Direct(out) => out(event),
            Sink::Channel(tx) => {
                let _ = tx.send(event);
            }
        }
    }
}

/// Writes a folder's state and tells the run's listener.
struct Reporter<'a> {
    sink: Sink<'a>,
    state: &'a Path,
    every: Duration,
    /// When the last progress event went out.
    last: Option<Instant>,
    /// The folder's state before it last waited for the hub, which it goes back to.
    current: FolderState,
}

impl Reporter<'_> {
    /// Writes `state` as the folder `index`'s, with whatever else `change` sets in its line, then says so.
    fn set(
        &mut self,
        index: usize,
        path: &Path,
        state: FolderState,
        change: impl FnOnce(&mut FolderRun),
    ) -> Result<(), Stop> {
        let written = state.clone();
        State::update(self.state, |file| {
            if let Some(run) = file.folders.get_mut(index) {
                run.state = written;
                change(run);
            }
        })
        .map_err(|error| Stop::State(error.to_string()))?;
        self.emit(path, state);
        Ok(())
    }

    /// Writes a change to the folder `index`'s line without saying anything: what a resume needs and the window does
    /// not show.
    fn remember(&self, index: usize, change: impl FnOnce(&mut FolderRun)) -> Result<(), Stop> {
        State::update(self.state, |file| {
            if let Some(run) = file.folders.get_mut(index) {
                change(run);
            }
        })
        .map_err(|error| Stop::State(error.to_string()))
    }

    /// Says `state` without writing it: an upload's progress is not what a resume needs, and four writes a second
    /// would be a lot of temp files. Progress is reported at most once in `every`; the end of an upload always is.
    fn progress(&mut self, path: &Path, state: FolderState) {
        let now = Instant::now();
        let finished = matches!(state, FolderState::Uploading { sent, of } if sent >= of);
        let due = finished
            || self
                .last
                .is_none_or(|last| now.duration_since(last) >= self.every);
        if due {
            self.last = Some(now);
            self.emit(path, state);
        } else if !matches!(state, FolderState::WaitingForHub) {
            self.current = state;
        }
    }

    fn emit(&mut self, path: &Path, state: FolderState) {
        if state != FolderState::WaitingForHub {
            self.current = state.clone();
        }
        self.sink.send(Event::Folder {
            path: path.to_path_buf(),
            state,
        });
    }
}

/// A [`Driver`] and the way to open the hub's connection for it: what the app and the cli's terminal run hand to
/// `dit backfill` as its [`BackfillControl`].
pub struct Control<F> {
    pub driver: Driver,
    /// Opens the signed-in connection; asked once for each run.
    pub remote: F,
}

impl<F> BackfillControl for Control<F>
where
    F: Fn() -> Result<Remote, RemoteError> + Send + Sync,
{
    fn start(&self, plan: Plan, out: &mut dyn FnMut(Event)) -> Result<Summary, BackfillError> {
        let remote = (self.remote)().map_err(BackfillError::Remote)?;
        self.driver.start(&remote, plan, out)
    }

    fn start_with_concurrency(
        &self,
        plan: Plan,
        concurrency: usize,
        out: &mut dyn FnMut(Event),
    ) -> Result<Summary, BackfillError> {
        let remote = (self.remote)().map_err(BackfillError::Remote)?;
        self.driver
            .start_with_concurrency(&remote, plan, concurrency, out)
    }

    fn status(&self) -> Result<Option<RunStatus>, BackfillError> {
        self.driver.status()
    }

    fn pause(&self) {
        self.driver.pause();
    }
}
