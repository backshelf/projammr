//! The backfill window's side of the app: what Find, Check and the run look like to the window, who owns them and what
//! stops them.
//!
//! Rust owns the run, not the window. [`Backfill`] holds the roots and the folders found under them, what Check read
//! of each folder and the person's corrections, and the run the daemon's driver goes through; the window is a view
//! of [`View`], sent whole on every change, and a set of commands. Closing the window on Find or Check forgets what
//! it holds and removes the `.dit/` folders Check made; closing it on Bring in pauses the run, which the state file
//! keeps for the next window to show. The cli's `dit backfill` reaches the same run through [`BackfillControl`]: its
//! events fold into the same view.

mod build;
mod check;
mod engine;
mod find;
mod view;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use dit_core::Registry;
use dit_core::remote::{Remote, RemoteError, SetTarget};
use dit_daemon::backfill::propose::Hub;
use dit_daemon::backfill::{
    BackfillControl, BackfillError, Checked, Event, FolderState, Plan, ProjectFacts, Recorder,
    RunStatus, Summary, discard,
};

pub use engine::{Connect, Engine, Real};
pub use view::{EVENT, Target, View};

use crate::snapshot::BackfillState;

/// The shortest gap between two views sent to the window.
const EMIT_EVERY: Duration = Duration::from_millis(100);

/// How long quitting waits for a run to stop at its next step: a pause is taken between sets and between the
/// requests of a push, and a pack on its way finishes first. A run that is still going then is left where the state
/// file has it, which a killed run resumes from.
const QUIT_WAIT: Duration = Duration::from_secs(15);

/// How often quitting asks a run to pause again while it waits.
const QUIT_RETRY: Duration = Duration::from_millis(100);

/// What the backfill asks of the app around it.
pub trait Host: Send + Sync + 'static {
    /// The signed-in connection to the hub.
    fn remote(&self) -> Result<Remote, RemoteError>;
    /// The instance's host, for the lines that name it; `None` with no sign-in.
    fn host(&self) -> Option<String>;
    /// The run's standing changed: the panel's menu says it.
    fn standing(&self, standing: Option<BackfillState>);
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// What Check made of one folder.
#[derive(Debug, Clone)]
enum Outcome {
    /// Waiting its turn.
    Pending,
    Reading {
        read: u32,
        of: u32,
    },
    Checked(Checked),
    /// The folder could not be read: the line to show.
    Failed(String),
}

/// One folder Check was asked to read.
#[derive(Debug, Clone)]
struct Entry {
    facts: ProjectFacts,
    /// Check made the folder's `.dit/`; kept once any Check did, since a second finds it there.
    created: bool,
    outcome: Outcome,
    /// The hub project the folder goes into; `None` until the hub has been asked.
    project: Option<i64>,
    /// Where each set goes, by the set file.
    targets: HashMap<PathBuf, SetTarget>,
}

impl Entry {
    fn checked(&self) -> Option<&Checked> {
        match &self.outcome {
            Outcome::Checked(checked) => Some(checked),
            _ => None,
        }
    }
}

/// What the person changed after Check proposed, kept while the window stays open so Back does not lose it.
#[derive(Debug, Clone, Default)]
struct Correction {
    project: Option<i64>,
    targets: HashMap<PathBuf, SetTarget>,
}

/// A set of the folder on the right, before Check has read it.
#[derive(Debug, Clone)]
struct SetFacts {
    file: PathBuf,
    copies: usize,
}

struct Inner {
    step: view::Step,
    roots: Vec<PathBuf>,
    found: Vec<ProjectFacts>,
    searching: bool,
    find_cancel: Arc<AtomicBool>,
    /// Bumped by each search: the one before it stops adding.
    find_epoch: u64,
    chosen: Option<PathBuf>,
    /// The sets of a folder as Find lists them, read when the folder is first shown.
    set_lists: HashMap<PathBuf, Vec<SetFacts>>,
    entries: Vec<Entry>,
    check_cancel: Arc<AtomicBool>,
    /// Bumped each time the entries are replaced or dropped: a Check thread of an earlier one stops writing.
    epoch: u64,
    /// The hub is being asked.
    asking: bool,
    projects: Vec<view::Project>,
    hubs: HashMap<i64, Hub>,
    storage: Option<view::Storage>,
    hub_error: Option<String>,
    corrections: HashMap<PathBuf, Correction>,
    /// The run as the state file and the events say.
    run: Option<RunStatus>,
    /// The plan of the run, for the folders' projects.
    plan: Option<Plan>,
    /// Facts of run folders Find and Check never listed (a run resumed after the app restarted).
    facts: HashMap<PathBuf, ProjectFacts>,
    /// The run's file is read again at the next event.
    reload: bool,
    /// Runs going in this process: the window's and the cli's.
    runs: usize,
    error: Option<String>,
    /// The finished run was shown and closed: the next window opens on Find.
    dismissed: bool,
    standing: Option<BackfillState>,
    /// The instance's host, read when the window opens.
    host: Option<String>,
}

impl Inner {
    fn new() -> Self {
        Inner {
            step: view::Step::Find,
            roots: Vec::new(),
            found: Vec::new(),
            searching: false,
            find_cancel: Arc::default(),
            find_epoch: 0,
            chosen: None,
            set_lists: HashMap::new(),
            entries: Vec::new(),
            check_cancel: Arc::default(),
            epoch: 0,
            asking: false,
            projects: Vec::new(),
            hubs: HashMap::new(),
            storage: None,
            hub_error: None,
            corrections: HashMap::new(),
            run: None,
            plan: None,
            facts: HashMap::new(),
            reload: false,
            runs: 0,
            error: None,
            dismissed: false,
            standing: None,
            host: None,
        }
    }

    /// Whether the folder `path` is one the run or Check knows by name.
    fn knows(&self, path: &Path) -> bool {
        self.found.iter().any(|facts| facts.path == path)
            || self.entries.iter().any(|entry| entry.facts.path == path)
            || self
                .run
                .as_ref()
                .is_some_and(|run| run.folders.iter().any(|folder| folder.path == path))
    }
}

/// The run and the window's state around it. Shared between the commands, the cli's socket and the threads that
/// search, check and run.
pub struct Backfill {
    host: Arc<dyn Host>,
    engine: Arc<dyn Engine>,
    registry: Registry,
    recorder: Recorder,
    repos_file: PathBuf,
    inner: Mutex<Inner>,
    /// Signalled when a run ends.
    ended: Condvar,
    dirty: Sender<()>,
    signals: Mutex<Option<Receiver<()>>>,
    /// The thread reading folders, joined before anything it wrote is removed.
    checker: Mutex<Option<JoinHandle<()>>>,
    /// Held by the commands that take a step away (Next, Back, close, Start), one at a time.
    transition: Mutex<()>,
}

impl Backfill {
    pub fn new(
        host: Arc<dyn Host>,
        engine: Arc<dyn Engine>,
        registry: Registry,
        recorder: Recorder,
        repos_file: PathBuf,
    ) -> Arc<Self> {
        let (dirty, signals) = mpsc::channel();
        Arc::new(Backfill {
            host,
            engine,
            registry,
            recorder,
            repos_file,
            inner: Mutex::new(Inner::new()),
            ended: Condvar::new(),
            dirty,
            signals: Mutex::new(Some(signals)),
            checker: Mutex::new(None),
            transition: Mutex::new(()),
        })
    }

    /// Starts the thread that sends the view to the window at most ten times a second, with `send`.
    pub fn emit_with(self: &Arc<Self>, send: impl Fn(&View) + Send + 'static) {
        let Some(signals) = lock(&self.signals).take() else {
            return;
        };
        let backfill = self.clone();
        thread::spawn(move || {
            while signals.recv().is_ok() {
                while signals.try_recv().is_ok() {}
                send(&backfill.view());
                thread::sleep(EMIT_EVERY);
            }
        });
    }

    /// Changes the state under its lock, has the view sent and the menu told when the run's standing moved.
    fn update<T>(&self, change: impl FnOnce(&mut Inner) -> T) -> T {
        let (out, standing) = {
            let mut inner = lock(&self.inner);
            let out = change(&mut inner);
            let now = standing_of(&inner);
            let moved = (inner.standing != now).then_some(now);
            inner.standing = now;
            (out, moved)
        };
        if let Some(standing) = standing {
            self.host.standing(standing);
        }
        let _ = self.dirty.send(());
        out
    }

    /// [`Backfill::update`] while the entries are still the ones of `epoch`; `false` when they were replaced.
    fn update_if(&self, epoch: u64, change: impl FnOnce(&mut Inner)) -> bool {
        self.update(|inner| {
            let current = inner.epoch == epoch;
            if current {
                change(inner);
            }
            current
        })
    }

    /// Reads the run the state file holds, which a run stopped by quitting or killed left: the menu says "Paused" at
    /// launch, and the window opens on it.
    pub fn load(&self) {
        let run = self.engine.status();
        let plan = self.engine.plan();
        let host = self.host.host();
        self.update(|inner| {
            inner.host = host;
            if inner.runs == 0 {
                inner.run = kept(run, &mut inner.error);
                inner.plan = kept(plan, &mut inner.error);
            }
        });
    }

    /// The window is opening: a fresh one shows the run there is, if one is stopped or goes, else Find.
    pub fn open(&self) {
        self.load();
        self.update(|inner| {
            if inner.step != view::Step::Find || !inner.entries.is_empty() || inner.runs > 0 {
                return;
            }
            let Some(run) = &inner.run else { return };
            let unfinished = run.running || run.folders.iter().any(|f| !finished(&f.state));
            let failed = run
                .folders
                .iter()
                .any(|f| matches!(f.state, FolderState::Failed(_)));
            if unfinished {
                inner.step = view::Step::BringIn;
            } else if failed && !inner.dismissed {
                inner.step = view::Step::Done;
            }
        });
    }

    /// The whole of what the window shows now.
    pub fn view(&self) -> View {
        let mut inner = lock(&self.inner);
        build::build(self, &mut inner)
    }

    /// The window was closed, by the red button or `backfill_close`. On Find and Check that leaves nothing behind;
    /// on Bring in the run pauses and the next window shows it paused; on Done the readout is dismissed.
    pub fn closed(&self) {
        let _step = lock(&self.transition);
        let step = lock(&self.inner).step;
        match step {
            view::Step::Find | view::Step::Check => self.forget(),
            view::Step::BringIn => self.engine.pause(),
            view::Step::Done => {
                self.forget();
                self.update(|inner| inner.dismissed = true);
            }
        }
    }

    /// The app is quitting: Find and Check are forgotten (what Check made is removed), and a run is paused and given
    /// time to stop at its next step, so the state file says where it was. The pause is asked for again while it
    /// waits: a run that was only starting forgets the first.
    pub fn shutdown(&self) {
        {
            let _step = lock(&self.transition);
            let step = lock(&self.inner).step;
            if matches!(step, view::Step::Find | view::Step::Check) {
                self.forget();
            }
        }
        let deadline = Instant::now() + QUIT_WAIT;
        let mut inner = lock(&self.inner);
        while inner.runs > 0 {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            self.engine.pause();
            inner = self
                .ended
                .wait_timeout(inner, left.min(QUIT_RETRY))
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .0;
        }
    }

    /// Drops Find and Check: the search stops, what Check read is forgotten and the `.dit/` folders it made are
    /// removed. A run's own folders are never removed.
    fn forget(&self) {
        let dropped = self.update(|inner| {
            inner.find_cancel.store(true, Ordering::Relaxed);
            inner.find_epoch += 1;
            let dropped = self.drop_entries(inner);
            let run = inner.run.take();
            let plan = inner.plan.take();
            let (epoch, find_epoch) = (inner.epoch, inner.find_epoch);
            let (dismissed, standing, runs, error, host) = (
                inner.dismissed,
                inner.standing,
                inner.runs,
                inner.error.take(),
                inner.host.take(),
            );
            *inner = Inner::new();
            inner.epoch = epoch;
            inner.find_epoch = find_epoch;
            inner.run = run;
            inner.plan = plan;
            inner.dismissed = dismissed;
            inner.standing = standing;
            inner.runs = runs;
            inner.error = error;
            inner.host = host;
            dropped
        });
        self.remove(dropped);
    }

    /// Stops Check and takes its entries, returning the folders whose `.dit/` it made. The caller removes them with
    /// [`Backfill::remove`] once the Check thread has let go.
    fn drop_entries(&self, inner: &mut Inner) -> Vec<PathBuf> {
        inner.check_cancel.store(true, Ordering::Relaxed);
        inner.epoch += 1;
        inner.asking = false;
        inner.hubs.clear();
        inner.projects.clear();
        inner.storage = None;
        inner.hub_error = None;
        std::mem::take(&mut inner.entries)
            .into_iter()
            .filter(|entry| entry.created)
            .map(|entry| entry.facts.path)
            .collect()
    }

    /// Waits for the Check thread to stop, then removes the `.dit/` of each of `folders`.
    fn remove(&self, folders: Vec<PathBuf>) {
        if let Some(checker) = lock(&self.checker).take() {
            let _ = checker.join();
        }
        for folder in folders {
            let _ = discard(&folder);
        }
    }

    /// Back: from Check to Find, removing what Check made. The person's corrections stay for the next Check.
    pub fn back(&self) -> Result<(), String> {
        let _step = lock(&self.transition);
        if lock(&self.inner).step != view::Step::Check {
            return Err("There is no step to go back to.".to_string());
        }
        let dropped = self.update(|inner| {
            inner.step = view::Step::Find;
            self.drop_entries(inner)
        });
        self.remove(dropped);
        Ok(())
    }

    /// Start: brings the checked folders in, on a thread of its own. The view moves to Bring in at once.
    pub fn begin(self: &Arc<Self>) -> Result<(), String> {
        let _step = lock(&self.transition);
        let (plan, left_out) = {
            let inner = lock(&self.inner);
            check::plan_of(&inner)?
        };
        // Folders none of whose sets could be recorded are not brought in, and keep nothing Check made.
        for folder in left_out {
            let _ = discard(&folder);
        }
        let prior = self.enter(&plan);
        let backfill = self.clone();
        thread::spawn(move || {
            let _ = backfill.run_with(prior, &mut |_| {}, |out| backfill.engine.start(plan, out));
        });
        Ok(())
    }

    /// Resume: carries on the stopped run where it was, on a thread of its own.
    pub fn resume(self: &Arc<Self>) -> Result<(), String> {
        let _step = lock(&self.transition);
        let prior = {
            let inner = lock(&self.inner);
            if inner.runs > 0 || inner.run.as_ref().is_some_and(|run| run.running) {
                return Err("The run is going already.".to_string());
            }
            if inner.run.is_none() {
                return Err("There is no run to resume.".to_string());
            }
            inner.step
        };
        self.enter_again();
        let backfill = self.clone();
        thread::spawn(move || {
            let _ = backfill.run_with(prior, &mut |_| {}, |out| backfill.engine.resume(out));
        });
        Ok(())
    }

    /// Try again for the failed folder `folder`: its sets are proposed again where a session was taken in the
    /// meantime, and the run starts again over the same plan. Every folder that is not done runs again with it.
    pub fn retry(self: &Arc<Self>, folder: &str) -> Result<(), String> {
        let _step = lock(&self.transition);
        let folder = PathBuf::from(folder);
        let (prior, plan) = {
            let inner = lock(&self.inner);
            if inner.runs > 0 || inner.run.as_ref().is_some_and(|run| run.running) {
                return Err("The run is going already.".to_string());
            }
            let failed = inner.run.as_ref().is_some_and(|run| {
                run.folders
                    .iter()
                    .any(|f| f.path == folder && matches!(f.state, FolderState::Failed(_)))
            });
            if !failed {
                return Err("That folder didn't fail.".to_string());
            }
            let plan = match inner.plan.clone() {
                Some(plan) => plan,
                None => self
                    .engine
                    .plan()
                    .map_err(|error| error.to_string())?
                    .ok_or("The run's plan is gone.")?,
            };
            (inner.step, plan)
        };
        self.enter_again();
        let backfill = self.clone();
        thread::spawn(move || {
            let go = |out: &mut dyn FnMut(Event)| {
                let plan = backfill.reproposed(plan, &folder)?;
                backfill.engine.start(plan, out)
            };
            let _ = backfill.run_with(prior, &mut |_| {}, go);
        });
        Ok(())
    }

    /// A run starts over `plan`: the view is Bring in, with every folder waiting until the first event reads the file.
    fn enter(&self, plan: &Plan) -> view::Step {
        self.engine.clear_pause();
        self.update(|inner| {
            let prior = inner.step;
            inner.step = view::Step::BringIn;
            inner.runs += 1;
            inner.error = None;
            inner.dismissed = false;
            inner.reload = true;
            // The folders of the run are repos from here: closing the window never removes their `.dit/`.
            for entry in &mut inner.entries {
                if plan
                    .folders
                    .iter()
                    .any(|folder| folder.path == entry.facts.path)
                {
                    entry.created = false;
                }
            }
            inner.run = Some(RunStatus {
                folders: plan
                    .folders
                    .iter()
                    .map(|folder| dit_daemon::backfill::FolderStatus {
                        path: folder.path.clone(),
                        state: FolderState::Waiting,
                        totals: None,
                    })
                    .collect(),
                paused: false,
                running: true,
            });
            inner.plan = Some(plan.clone());
            prior
        })
    }

    /// A run starts over the plan it already has: the same view, going.
    fn enter_again(&self) {
        self.engine.clear_pause();
        self.update(|inner| {
            inner.step = view::Step::BringIn;
            inner.runs += 1;
            inner.error = None;
            inner.dismissed = false;
            inner.reload = true;
            if let Some(run) = &mut inner.run {
                run.paused = false;
                run.running = true;
            }
        });
    }

    /// Runs `go`, folding its events into the view and handing them to `out`, and says how it ended.
    fn run_with(
        &self,
        prior: view::Step,
        out: &mut dyn FnMut(Event),
        go: impl FnOnce(&mut dyn FnMut(Event)) -> Result<Summary, BackfillError>,
    ) -> Result<Summary, BackfillError> {
        let result = go(&mut |event| {
            self.observe(&event);
            out(event);
        });
        self.leave(prior, &result);
        result
    }

    /// Folds one event of the run into the view.
    fn observe(&self, event: &Event) {
        self.update(|inner| match event {
            Event::Folder { path, state } => {
                let missing = inner
                    .run
                    .as_ref()
                    .is_none_or(|run| !run.folders.iter().any(|folder| &folder.path == path));
                if inner.reload || missing || *state == FolderState::Done {
                    inner.reload = false;
                    if let Some(run) = kept(self.engine.status(), &mut inner.error) {
                        inner.run = Some(run);
                    }
                    inner.plan = kept(self.engine.plan(), &mut inner.error).or(inner.plan.take());
                }
                if let Some(run) = &mut inner.run {
                    run.running = true;
                    run.paused = false;
                    if let Some(folder) = run.folders.iter_mut().find(|f| &f.path == path) {
                        folder.state = state.clone();
                    }
                }
            }
            Event::Paused => {
                if let Some(run) = &mut inner.run {
                    run.paused = true;
                }
            }
        });
    }

    /// A run ended: the file says how the folders stand, and the step follows from how it ended.
    fn leave(&self, prior: view::Step, result: &Result<Summary, BackfillError>) {
        let run = self.engine.status();
        let plan = self.engine.plan();
        let stateless = matches!(run, Ok(None));
        self.update(|inner| {
            inner.runs = inner.runs.saturating_sub(1);
            inner.reload = false;
            match kept(run, &mut inner.error) {
                Some(run) => inner.run = Some(run),
                None => {
                    if let Some(run) = &mut inner.run {
                        run.running = false;
                    }
                }
            }
            inner.plan = kept(plan, &mut inner.error).or(inner.plan.take());
            match result {
                Ok(_) => inner.step = view::Step::Done,
                Err(BackfillError::Paused) => {
                    inner.step = view::Step::BringIn;
                    if let Some(run) = &mut inner.run {
                        run.paused = true;
                    }
                }
                Err(error @ BackfillError::SignedOut { .. }) => {
                    inner.step = view::Step::BringIn;
                    if let Some(run) = &mut inner.run {
                        run.paused = true;
                    }
                    inner.error = Some(error.to_string());
                }
                Err(error) => {
                    // The run never began, or the state file could not be kept: the step before it stands. With no
                    // state file behind it the run was never made, so no waiting run is left to resume.
                    if stateless {
                        inner.run = None;
                        inner.plan = None;
                    }
                    inner.step = match prior {
                        view::Step::Find | view::Step::Check => prior,
                        _ => view::Step::BringIn,
                    };
                    inner.error = Some(error.to_string());
                }
            }
        });
        self.ended.notify_all();
    }

    /// `plan` with the failed folder `folder`'s sets proposed again: a session the hub no longer lists as free is
    /// the set's new session, on the folder's other new sessions' track, else on a new track named for the folder.
    fn reproposed(&self, mut plan: Plan, folder: &Path) -> Result<Plan, BackfillError> {
        let Some(at) = plan.folders.iter().position(|f| f.path == folder) else {
            return Ok(plan);
        };
        let project = plan.folders[at].project_id;
        let remote = self.host.remote().map_err(BackfillError::Remote)?;
        let hub =
            dit_daemon::backfill::propose::read(&remote, project).map_err(BackfillError::Remote)?;
        check::free_sessions(&mut plan.folders[at], &hub);
        Ok(plan)
    }
}

impl BackfillControl for Backfill {
    /// The cli's `dit backfill`: the window shows the same run.
    fn start(&self, plan: Plan, out: &mut dyn FnMut(Event)) -> Result<Summary, BackfillError> {
        let prior = self.enter(&plan);
        self.run_with(prior, out, |out| self.engine.start(plan, out))
    }

    fn status(&self) -> Result<Option<RunStatus>, BackfillError> {
        self.engine.status()
    }

    fn pause(&self) {
        self.engine.pause();
    }
}

/// How the run stands for the panel's menu: going, or stopped with folders still to do; nothing once every folder is
/// finished.
fn standing_of(inner: &Inner) -> Option<BackfillState> {
    let run = inner.run.as_ref()?;
    if inner.runs > 0 || run.running {
        Some(BackfillState::Running)
    } else if run.folders.iter().any(|folder| !finished(&folder.state)) {
        Some(BackfillState::Paused)
    } else {
        None
    }
}

/// A folder with nothing more to do: brought in, or failed.
fn finished(state: &FolderState) -> bool {
    matches!(state, FolderState::Done | FolderState::Failed(_))
}

/// What a state file read found, or `None` when there is no run or the file could not be read, in which case the
/// window's `error` says so.
fn kept<T>(read: Result<Option<T>, BackfillError>, error: &mut Option<String>) -> Option<T> {
    match read {
        Ok(found) => found,
        Err(failure) => {
            *error = Some(failure.to_string());
            None
        }
    }
}

#[cfg(test)]
mod tests;
