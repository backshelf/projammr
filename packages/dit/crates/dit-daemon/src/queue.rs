//! The push queue: what each repo still owes the hub, and one worker that sends it.
//!
//! The daemon says what happened (a save was recorded, a commit was made); the queue turns that into a map of repo
//! to the most it is wanted to send, and one worker thread takes the cheapest due entry, pushes it and says what
//! came of it. One worker means one push at a time on the one [`Remote`] opened for the sign-in, so a slow repo
//! delays the others but nothing ever runs two uploads against the instance at once.
//!
//! Each push is `dit_core::remote::push`, which records every step the hub confirmed: a push that fails halfway
//! sends only the rest next time. How a failure is met depends on what it is: the network being away, or the hub
//! being busy or down, is retried with the beat's backoff; a refusal the hub means (a storage cap, a repo the account
//! cannot write) stops that repo until something wants it again and is reported in the hub's words; a sign-in the hub
//! no longer accepts pauses the whole queue until [`Queue::resume`] gives it a new one.
//!
//! A repo with no hub repo is never pushed here. Making one is the producer's choice (`dit push` names the project),
//! and the queue only keeps current what is already bound.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use dit_core::remote::{PushError, PushOptions, PushReport, Remote, RemoteError, push};
use dit_core::{Registry, Repo, RepoError};

use crate::Clock;
use crate::beat::retry_delay_ms;
use crate::event::DaemonEvent;

/// How much of a push a repo is wanted to send. Later phases include the earlier ones, so wants of one repo merge
/// to the largest, and the cheapest due phase runs first: a save reaches the hub before another repo's samples.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Phase {
    /// The saves and the time spans beside them (`PushOptions::saves_only`).
    Saves,
    /// Also the commits and their lineage, without sample objects.
    Commits,
    /// Everything, sample objects too. Queued by the queue itself once a `Commits` push has finished.
    Everything,
}

/// What the queue reports about a repo.
#[derive(Debug, Clone, PartialEq)]
pub enum PushEvent {
    /// A push of `phase` began.
    Started { repo: PathBuf, phase: Phase },
    /// A push finished. The report is empty when the hub already had everything.
    Pushed { repo: PathBuf, report: PushReport },
    /// A push could not finish for a reason that passes (no network, the hub busy): it runs again in
    /// `retry_in_ms`.
    Waiting {
        repo: PathBuf,
        message: String,
        retry_in_ms: i64,
    },
    /// A push stopped for a reason waiting will not mend, in the hub's own words. `storage_limit` says the hub
    /// refused for its storage cap. The repo is pushed again when something wants it.
    Failed {
        repo: PathBuf,
        message: String,
        storage_limit: bool,
    },
}

/// How the queue behaves.
#[derive(Debug, Clone, Copy)]
pub struct QueueOptions {
    /// How long a newly wanted repo waits before it is pushed, so the saves of one burst go as one push.
    pub debounce_ms: i64,
}

impl Default for QueueOptions {
    fn default() -> Self {
        QueueOptions { debounce_ms: 1_000 }
    }
}

/// How long the worker sleeps between looks at the clock, which a test owns.
const LOOK: Duration = Duration::from_millis(100);

/// The wait after a 429: the hub's rate-limit window is a minute.
const RATE_LIMITED_MS: i64 = 60_000;

/// The wait after another process held the repo's lock.
const LOCKED_MS: i64 = 5_000;

struct Entry {
    phase: Phase,
    /// The time, in ms, the repo is next due.
    due: i64,
    /// The order wants came in, which breaks ties between repos wanted at one phase.
    order: u64,
}

struct State {
    entries: BTreeMap<PathBuf, Entry>,
    /// The repo being pushed now.
    running: Option<PathBuf>,
    /// Consecutive failures that were retried, per repo.
    failures: BTreeMap<PathBuf, u32>,
    /// Repos the queue keeps off: still wanted, never taken until released.
    held: BTreeSet<PathBuf>,
    remote: Arc<Remote>,
    signed_out: bool,
    stop: bool,
    order: u64,
}

impl State {
    /// Takes the repo to push now: the lowest phase among those due and not held, the earliest wanted of them.
    fn take(&mut self, now: i64) -> Option<(PathBuf, Phase, u32)> {
        let repo = self
            .entries
            .iter()
            .filter(|(repo, entry)| entry.due <= now && !self.held.contains(*repo))
            .min_by_key(|(_, entry)| (entry.phase, entry.order))
            .map(|(repo, _)| repo.clone())?;
        let entry = self.entries.remove(&repo)?;
        let failures = self.failures.get(&repo).copied().unwrap_or(0);
        self.running = Some(repo.clone());
        Some((repo, entry.phase, failures))
    }

    /// Wants `repo` at `phase` no earlier than `due`; an entry already there keeps the larger phase and the later
    /// due time.
    fn want(&mut self, repo: &Path, phase: Phase, due: i64) {
        self.order += 1;
        let order = self.order;
        let entry = self
            .entries
            .entry(repo.to_path_buf())
            .or_insert(Entry { phase, due, order });
        entry.phase = entry.phase.max(phase);
        entry.due = entry.due.max(due);
    }
}

struct Shared {
    state: Mutex<State>,
    changed: Condvar,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// What a push came to, before the queue decides what to do about it.
#[derive(Debug)]
enum Outcome {
    Done(PushReport),
    /// The hub refused a sample pack for its storage cap after the push sent `report`.
    Capped {
        message: String,
        report: PushReport,
    },
    Retry {
        message: String,
        after_ms: i64,
    },
    Failed(String),
    SignedOut {
        host: String,
    },
    /// The repo has no hub repo.
    Unbound,
}

/// Sorts a failed push into the outcome the queue acts on. `failures` is how many pushes of the repo have already
/// been retried, which sets how long the next wait is.
fn classify(error: PushError, failures: u32) -> Outcome {
    let backoff = retry_delay_ms(failures + 1);
    let message = error.to_string();
    match error {
        PushError::StorageLimit { message, report } => Outcome::Capped {
            message,
            report: *report,
        },
        PushError::Unreachable { .. } | PushError::TimedOut { .. } => Outcome::Retry {
            message,
            after_ms: backoff,
        },
        PushError::Remote(RemoteError::SignedOut { host }) => Outcome::SignedOut { host },
        PushError::Remote(RemoteError::Refused { status: 429, .. }) => Outcome::Retry {
            message,
            after_ms: backoff.max(RATE_LIMITED_MS),
        },
        PushError::Remote(RemoteError::Refused { status, .. })
            if status == 408 || status >= 500 =>
        {
            Outcome::Retry {
                message,
                after_ms: backoff,
            }
        }
        PushError::Remote(RemoteError::Unexpected { .. }) => Outcome::Retry {
            message,
            after_ms: backoff,
        },
        PushError::Repo(RepoError::Locked(_)) => Outcome::Retry {
            message,
            after_ms: LOCKED_MS,
        },
        _ => Outcome::Failed(message),
    }
}

fn options_of(phase: Phase) -> PushOptions {
    match phase {
        Phase::Saves => PushOptions {
            saves_only: true,
            ..PushOptions::default()
        },
        Phase::Commits => PushOptions {
            skip_samples: true,
            ..PushOptions::default()
        },
        Phase::Everything => PushOptions::default(),
    }
}

fn run(registry: &Registry, remote: &Remote, repo: &Path, phase: Phase, failures: u32) -> Outcome {
    let repo = match Repo::open(repo, registry) {
        Ok(repo) => repo,
        Err(error) => return Outcome::Failed(error.to_string()),
    };
    match repo.remote_binding() {
        Ok(Some(_)) => {}
        Ok(None) => return Outcome::Unbound,
        Err(error) => return Outcome::Failed(error.to_string()),
    }
    match push(&repo, remote, &options_of(phase)) {
        Ok(report) => Outcome::Done(report),
        Err(error) => classify(error, failures),
    }
}

/// Applies what a push of `repo` at `phase` came to: the events, the retry, the follow-up.
fn finish(
    shared: &Shared,
    events: &Sender<DaemonEvent>,
    now: i64,
    repo: PathBuf,
    phase: Phase,
    outcome: Outcome,
) {
    let say = |event: PushEvent| {
        let _ = events.send(DaemonEvent::Push(event));
    };
    let mut state = shared.lock();
    state.running = None;
    match outcome {
        Outcome::Done(report) => {
            state.failures.remove(&repo);
            if phase == Phase::Commits {
                state.want(&repo, Phase::Everything, now);
            }
            drop(state);
            say(PushEvent::Pushed { repo, report });
        }
        Outcome::Capped { message, report } => {
            state.failures.remove(&repo);
            drop(state);
            say(PushEvent::Pushed {
                repo: repo.clone(),
                report,
            });
            say(PushEvent::Failed {
                repo,
                message,
                storage_limit: true,
            });
        }
        Outcome::Retry { message, after_ms } => {
            *state.failures.entry(repo.clone()).or_default() += 1;
            state.want(&repo, phase, now + after_ms);
            drop(state);
            say(PushEvent::Waiting {
                repo,
                message,
                retry_in_ms: after_ms,
            });
        }
        Outcome::Failed(message) => {
            state.failures.remove(&repo);
            drop(state);
            say(PushEvent::Failed {
                repo,
                message,
                storage_limit: false,
            });
        }
        Outcome::SignedOut { host } => {
            state.want(&repo, phase, now);
            let first = !state.signed_out;
            state.signed_out = true;
            drop(state);
            if first {
                let _ = events.send(DaemonEvent::SignedOut { host });
            }
        }
        Outcome::Unbound => {
            state.failures.remove(&repo);
        }
    }
}

/// The worker: takes due repos and pushes them until stopped.
fn work(
    shared: Arc<Shared>,
    events: Sender<DaemonEvent>,
    clock: Arc<dyn Clock>,
    registry: Registry,
) {
    loop {
        let job = {
            let mut state = shared.lock();
            loop {
                if state.stop {
                    return;
                }
                let now = clock.now_ms();
                if !state.signed_out
                    && let Some((repo, phase, failures)) = state.take(now)
                {
                    break (repo, phase, failures, state.remote.clone());
                }
                state = shared
                    .changed
                    .wait_timeout(state, LOOK)
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .0;
            }
        };
        let (repo, phase, failures, remote) = job;
        let _ = events.send(DaemonEvent::Push(PushEvent::Started {
            repo: repo.clone(),
            phase,
        }));
        let outcome = run(&registry, &remote, &repo, phase, failures);
        finish(&shared, &events, clock.now_ms(), repo, phase, outcome);
    }
}

/// The queue and its worker thread. Dropping it stops the worker after the push it is in.
pub struct Queue {
    shared: Arc<Shared>,
    clock: Arc<dyn Clock>,
    options: QueueOptions,
    worker: Option<JoinHandle<()>>,
}

impl Queue {
    /// Starts the worker. `remote` is the sign-in opened once for the run; `events` hears [`DaemonEvent::Push`] and
    /// [`DaemonEvent::SignedOut`].
    pub fn start(
        remote: Arc<Remote>,
        registry: Registry,
        events: Sender<DaemonEvent>,
        clock: Arc<dyn Clock>,
        options: QueueOptions,
    ) -> Queue {
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                entries: BTreeMap::new(),
                running: None,
                failures: BTreeMap::new(),
                held: BTreeSet::new(),
                remote,
                signed_out: false,
                stop: false,
                order: 0,
            }),
            changed: Condvar::new(),
        });
        let worker = {
            let shared = shared.clone();
            let clock = clock.clone();
            thread::spawn(move || work(shared, events, clock, registry))
        };
        Queue {
            shared,
            clock,
            options,
            worker: Some(worker),
        }
    }

    /// Wants `repo` pushed as far as `phase`, after the debounce. Wants of one repo merge to the largest phase.
    pub fn want(&self, repo: &Path, phase: Phase) {
        let due = self.clock.now_ms() + self.options.debounce_ms;
        self.shared.lock().want(repo, phase, due);
        self.shared.changed.notify_one();
    }

    /// Drops what `repo` is wanted for, as when it stops being tracked.
    pub fn forget(&self, repo: &Path) {
        let mut state = self.shared.lock();
        state.entries.remove(repo);
        state.failures.remove(repo);
    }

    /// Keeps the queue off `repo`: it stays wanted, with its phase and due time, but is not taken until
    /// [`Queue::release`]. A push of `repo` already running is not interrupted. [`Queue::forget`] leaves the hold.
    pub fn hold(&self, repo: &Path) {
        self.shared.lock().held.insert(repo.to_path_buf());
    }

    /// Lifts the hold on `repo` and wakes the worker, so what was wanted meanwhile is pushed.
    pub fn release(&self, repo: &Path) {
        self.shared.lock().held.remove(repo);
        self.shared.changed.notify_one();
    }

    /// The repos being held.
    pub fn held(&self) -> Vec<PathBuf> {
        self.shared.lock().held.iter().cloned().collect()
    }

    /// Signs the queue in again after [`DaemonEvent::SignedOut`]: what was wanted is pushed with `remote`.
    pub fn resume(&self, remote: Arc<Remote>) {
        let mut state = self.shared.lock();
        state.remote = remote;
        state.signed_out = false;
        let now = self.clock.now_ms();
        for entry in state.entries.values_mut() {
            entry.due = entry.due.min(now);
        }
        drop(state);
        self.shared.changed.notify_one();
    }

    /// What is wanted and not yet being pushed, by repo.
    pub fn wanted(&self) -> Vec<(PathBuf, Phase)> {
        self.shared
            .lock()
            .entries
            .iter()
            .map(|(repo, entry)| (repo.clone(), entry.phase))
            .collect()
    }

    /// Whether nothing is wanted and nothing is being pushed.
    pub fn is_idle(&self) -> bool {
        let state = self.shared.lock();
        state.entries.is_empty() && state.running.is_none()
    }

    /// Whether the hub refused the sign-in and the queue waits for [`Queue::resume`].
    pub fn is_signed_out(&self) -> bool {
        self.shared.lock().signed_out
    }

    /// Stops the worker, waiting for the push it is in.
    pub fn stop(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        self.shared.lock().stop = true;
        self.shared.changed.notify_one();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl Drop for Queue {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc::{self, Receiver};
    use std::time::Instant;

    use dit_core::remote::test_support::{MockServer, Recorded, Reply, remote_to};
    use dit_core::{RemoteBinding, Repo};
    use serde_json::json;

    use super::*;
    use crate::test_support::{FakeClock, project, registry, write_set};

    const REPO_ID: i64 = 3;

    fn state(remote: Arc<Remote>) -> State {
        State {
            entries: BTreeMap::new(),
            running: None,
            failures: BTreeMap::new(),
            held: BTreeSet::new(),
            remote,
            signed_out: false,
            stop: false,
            order: 0,
        }
    }

    /// A hub that takes everything a push sends and holds every object, answering by path.
    fn hub() -> MockServer {
        MockServer::route(|request: &Recorded| {
            let body = match request.path_only() {
                "/api/repos/3" => {
                    json!({"id": REPO_ID, "sets": [], "pushSamples": false, "pushSamplesForced": false})
                }
                "/api/repos/3/sets" => json!({"ditSetId": "x", "sessionId": 11}),
                "/api/repos/3/saves" => json!({"saved": 1}),
                "/api/repos/3/segments" => json!({"recorded": 0}),
                "/api/repos/3/objects/missing" => json!({"missing": []}),
                "/api/repos/3/commits" => json!({"inserted": 1}),
                "/api/uploads/limits" => json!({"maxBytes": 1 << 20}),
                other => return Reply::json(404, json!({"error": other}).to_string()),
            };
            Reply::json(200, body.to_string())
        })
    }

    fn paths(server: &MockServer) -> Vec<String> {
        server
            .requests()
            .iter()
            .map(|request| format!("{} {}", request.method, request.path_only()))
            .collect()
    }

    /// A repo with one recorded save of `Song.fset`, bound to `server` unless `bound` is false.
    fn repo_on(server: &MockServer, bound: bool) -> (tempfile::TempDir, PathBuf, Repo) {
        let (root, dir, repo) = project("Queue");
        write_set(&dir.join("Song.fset"), "<doc>\n<t/>", 1_000);
        repo.record_save(&dir.join("Song.fset")).unwrap();
        if bound {
            repo.bind_remote(&RemoteBinding {
                instance: server.url.clone(),
                repo: REPO_ID,
            })
            .unwrap();
        }
        (root, dir, repo)
    }

    fn queue(remote: Remote, clock: &FakeClock) -> (Queue, Receiver<DaemonEvent>) {
        let (tx, rx) = mpsc::channel();
        let queue = Queue::start(
            Arc::new(remote),
            registry(),
            tx,
            Arc::new(clock.clone()),
            QueueOptions { debounce_ms: 0 },
        );
        (queue, rx)
    }

    /// The next push event matching `want`, within ten seconds.
    fn next(events: &Receiver<DaemonEvent>, want: impl Fn(&DaemonEvent) -> bool) -> DaemonEvent {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            let event = events.recv_timeout(left).expect("an event in time");
            if want(&event) {
                return event;
            }
        }
    }

    fn pushed(event: &DaemonEvent) -> bool {
        matches!(event, DaemonEvent::Push(PushEvent::Pushed { .. }))
    }

    #[test]
    fn a_save_alone_is_pushed_without_asking_about_the_repo() {
        let server = hub();
        let (_root, dir, _repo) = repo_on(&server, true);
        let clock = FakeClock::default();
        let (queue, events) = queue(remote_to(&server), &clock);

        queue.want(&dir, Phase::Saves);
        let DaemonEvent::Push(PushEvent::Pushed { repo, report }) = next(&events, pushed) else {
            unreachable!()
        };

        assert_eq!(repo, dir);
        assert_eq!(report.branches[0].saves, 1);
        let paths = paths(&server);
        assert!(paths.contains(&"POST /api/repos/3/saves".to_string()));
        assert!(
            !paths.iter().any(|path| path.contains("commits")
                || path.contains("missing")
                || path == "GET /api/repos/3"),
            "{paths:?}"
        );
        assert!(queue.is_idle());
    }

    #[test]
    fn a_held_repo_is_not_pushed_until_released() {
        let server = hub();
        let (_root, dir, _repo) = repo_on(&server, true);
        let clock = FakeClock::default();
        let (queue, events) = queue(remote_to(&server), &clock);

        queue.hold(&dir);
        queue.want(&dir, Phase::Saves);
        std::thread::sleep(Duration::from_millis(400));

        assert!(server.requests().is_empty(), "{:?}", paths(&server));
        assert_eq!(queue.wanted(), vec![(dir.clone(), Phase::Saves)]);
        assert_eq!(queue.held(), vec![dir.clone()]);
        assert!(!queue.is_idle());

        queue.release(&dir);
        let DaemonEvent::Push(PushEvent::Pushed { repo, .. }) = next(&events, pushed) else {
            unreachable!()
        };
        assert_eq!(repo, dir);
        assert!(queue.held().is_empty());
    }

    #[test]
    fn holding_one_repo_does_not_stop_another() {
        let server = hub();
        let (_root_a, held_dir, _repo_a) = repo_on(&server, true);
        let (_root_b, other_dir, _repo_b) = repo_on(&server, true);
        let clock = FakeClock::default();
        let (queue, events) = queue(remote_to(&server), &clock);

        queue.hold(&held_dir);
        queue.want(&held_dir, Phase::Saves);
        queue.want(&other_dir, Phase::Saves);
        let DaemonEvent::Push(PushEvent::Pushed { repo, .. }) = next(&events, pushed) else {
            unreachable!()
        };

        assert_eq!(repo, other_dir);
        assert_eq!(queue.wanted(), vec![(held_dir, Phase::Saves)]);
    }

    #[test]
    fn forgetting_a_repo_leaves_its_hold() {
        let server = hub();
        let (_root, dir, _repo) = repo_on(&server, true);
        let clock = FakeClock::default();
        let (queue, _events) = queue(remote_to(&server), &clock);

        queue.hold(&dir);
        queue.want(&dir, Phase::Saves);
        queue.forget(&dir);

        assert!(queue.wanted().is_empty());
        assert_eq!(queue.held(), vec![dir]);
    }

    #[test]
    fn commits_are_followed_by_everything() {
        let server = hub();
        let (_root, dir, repo) = repo_on(&server, true);
        let set = repo.sets().unwrap().into_keys().next().unwrap();
        repo.commit(&set, "main", "idea", "me", dit_core::CommitKind::User)
            .unwrap();
        let clock = FakeClock::default();
        let (queue, events) = queue(remote_to(&server), &clock);

        queue.want(&dir, Phase::Commits);
        next(&events, pushed);
        next(&events, pushed);

        let requests = paths(&server);
        assert_eq!(
            requests
                .iter()
                .filter(|path| *path == "POST /api/repos/3/commits")
                .count(),
            2,
            "the commit and its lineage: {requests:?}"
        );
        assert_eq!(
            requests
                .iter()
                .filter(|path| *path == "GET /api/repos/3")
                .count(),
            2,
            "a commits push, then everything: {requests:?}"
        );
    }

    #[test]
    fn wants_of_one_repo_merge_to_the_largest_phase() {
        let server = hub();
        let (_root, dir, _repo) = repo_on(&server, true);
        let clock = FakeClock::default();
        clock.set(1_000);
        let (tx, _events) = mpsc::channel();
        let queue = Queue::start(
            Arc::new(remote_to(&server)),
            registry(),
            tx,
            Arc::new(clock.clone()),
            QueueOptions {
                debounce_ms: 60_000,
            },
        );

        queue.want(&dir, Phase::Saves);
        queue.want(&dir, Phase::Commits);
        queue.want(&dir, Phase::Saves);

        assert_eq!(queue.wanted(), [(dir.clone(), Phase::Commits)]);
        assert!(server.requests().is_empty(), "the debounce has not passed");
        queue.forget(&dir);
        assert!(queue.is_idle());
    }

    #[test]
    fn a_repo_with_no_hub_repo_is_left_alone() {
        let server = hub();
        let (_root, dir, _repo) = repo_on(&server, false);
        let clock = FakeClock::default();
        let (queue, events) = queue(remote_to(&server), &clock);

        queue.want(&dir, Phase::Saves);
        let deadline = Instant::now() + Duration::from_secs(10);
        while !queue.is_idle() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }

        assert!(queue.is_idle());
        assert!(server.requests().is_empty());
        assert!(
            !events.try_iter().any(|event| pushed(&event)),
            "nothing was pushed"
        );
    }

    #[test]
    fn a_busy_hub_is_retried_after_the_backoff_and_not_before() {
        let busy = Arc::new(Mutex::new(true));
        let server = {
            let busy = busy.clone();
            MockServer::route(move |request: &Recorded| {
                if *busy.lock().unwrap() {
                    return Reply::json(503, json!({"error": "busy"}).to_string());
                }
                match request.path_only() {
                    "/api/repos/3/sets" => {
                        Reply::json(200, json!({"ditSetId": "x", "sessionId": 11}).to_string())
                    }
                    _ => Reply::json(200, json!({"saved": 1}).to_string()),
                }
            })
        };
        let (_root, dir, _repo) = repo_on(&server, true);
        let clock = FakeClock::default();
        clock.set(10_000);
        let (queue, events) = queue(remote_to(&server), &clock);

        queue.want(&dir, Phase::Saves);
        let DaemonEvent::Push(PushEvent::Waiting { retry_in_ms, .. }) = next(&events, |event| {
            matches!(event, DaemonEvent::Push(PushEvent::Waiting { .. }))
        }) else {
            unreachable!()
        };
        assert_eq!(retry_in_ms, 5_000);

        // The hub is back, but the wait has not passed.
        *busy.lock().unwrap() = false;
        let asked = server.requests().len();
        clock.set(14_999);
        thread::sleep(Duration::from_millis(400));
        assert_eq!(server.requests().len(), asked, "no request before the wait");
        assert_eq!(queue.wanted().len(), 1);

        clock.set(15_000);
        next(&events, pushed);
        assert!(queue.is_idle());
    }

    #[test]
    fn a_refused_sign_in_pauses_the_queue_until_it_is_resumed() {
        let refuse = Arc::new(Mutex::new(true));
        let server = {
            let refuse = refuse.clone();
            MockServer::route(move |request: &Recorded| {
                if *refuse.lock().unwrap() {
                    return Reply::json(401, json!({"error": "no"}).to_string());
                }
                match request.path_only() {
                    "/api/repos/3/sets" => {
                        Reply::json(200, json!({"ditSetId": "x", "sessionId": 11}).to_string())
                    }
                    _ => Reply::json(200, json!({"saved": 1}).to_string()),
                }
            })
        };
        let (_root, dir, _repo) = repo_on(&server, true);
        let clock = FakeClock::default();
        let (queue, events) = queue(remote_to(&server), &clock);

        queue.want(&dir, Phase::Saves);
        let DaemonEvent::SignedOut { host } = next(&events, |event| {
            matches!(event, DaemonEvent::SignedOut { .. })
        }) else {
            unreachable!()
        };
        assert_eq!(host, server.host());
        assert!(queue.is_signed_out());

        let asked = server.requests().len();
        clock.set(600_000);
        thread::sleep(Duration::from_millis(400));
        assert_eq!(
            server.requests().len(),
            asked,
            "a paused queue sends nothing"
        );
        assert_eq!(queue.wanted(), [(dir.clone(), Phase::Saves)]);

        *refuse.lock().unwrap() = false;
        queue.resume(Arc::new(remote_to(&server)));
        next(&events, pushed);
        assert!(!queue.is_signed_out());
    }

    #[test]
    fn a_storage_cap_refusal_stops_with_the_hubs_message() {
        let server = hub();
        let shared = Shared {
            state: Mutex::new(state(Arc::new(remote_to(&server)))),
            changed: Condvar::new(),
        };
        let (tx, rx) = mpsc::channel();
        let repo = PathBuf::from("/tmp/Song Project");
        let report = PushReport::default();

        finish(
            &shared,
            &tx,
            0,
            repo.clone(),
            Phase::Everything,
            classify(
                PushError::StorageLimit {
                    message: "Storage is full: 5 GB of 5 GB.".to_string(),
                    report: Box::new(report.clone()),
                },
                0,
            ),
        );

        let events: Vec<_> = rx.try_iter().collect();
        assert_eq!(events.len(), 2);
        assert!(matches!(
            &events[0],
            DaemonEvent::Push(PushEvent::Pushed { report: sent, .. }) if *sent == report
        ));
        assert!(matches!(
            &events[1],
            DaemonEvent::Push(PushEvent::Failed { message, storage_limit: true, .. })
                if message == "Storage is full: 5 GB of 5 GB."
        ));
        assert!(
            shared.lock().entries.is_empty(),
            "stopped until something wants the repo again"
        );
    }

    #[test]
    fn failures_are_sorted_by_whether_waiting_mends_them() {
        let refused = |status| {
            PushError::Remote(RemoteError::Refused {
                host: "hub".into(),
                status,
                code: None,
                details: None,
                message: "no".into(),
            })
        };
        let retried = |error: PushError, failures: u32| match classify(error, failures) {
            Outcome::Retry { after_ms, .. } => Some(after_ms),
            _ => None,
        };

        assert_eq!(
            retried(PushError::Unreachable { host: "hub".into() }, 0),
            Some(5_000)
        );
        assert_eq!(
            retried(PushError::TimedOut { host: "hub".into() }, 2),
            Some(20_000)
        );
        assert_eq!(
            retried(PushError::Unreachable { host: "hub".into() }, 9),
            Some(60_000)
        );
        assert_eq!(retried(refused(503), 0), Some(5_000));
        assert_eq!(retried(refused(429), 0), Some(60_000));
        assert_eq!(retried(refused(408), 0), Some(5_000));
        assert_eq!(retried(refused(403), 0), None);
        assert_eq!(retried(refused(413), 0), None);
        assert_eq!(
            retried(PushError::Repo(RepoError::Locked(PathBuf::from("x"))), 0),
            Some(5_000)
        );
        assert!(matches!(
            classify(PushError::NotBound, 0),
            Outcome::Failed(_)
        ));
        assert!(matches!(
            classify(
                PushError::Remote(RemoteError::SignedOut { host: "hub".into() }),
                0
            ),
            Outcome::SignedOut { .. }
        ));
    }

    #[test]
    fn the_cheapest_due_phase_goes_first() {
        let server = hub();
        let mut state = state(Arc::new(remote_to(&server)));
        let (a, b, c) = (
            PathBuf::from("/a"),
            PathBuf::from("/b"),
            PathBuf::from("/c"),
        );
        state.want(&a, Phase::Everything, 0);
        state.want(&b, Phase::Saves, 0);
        state.want(&c, Phase::Saves, 5_000);

        assert_eq!(state.take(0).map(|job| job.0), Some(b));
        state.running = None;
        assert_eq!(state.take(0).map(|job| job.0), Some(a));
        state.running = None;
        assert_eq!(state.take(0), None, "the third is not due");
        assert_eq!(state.take(5_000).map(|job| job.0), Some(c));
    }
}
