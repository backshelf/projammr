//! Puts the daemon on a worker thread with everything that feeds it: the filesystem watcher, the Live script's
//! listener, a ticker and a poller for the DAW's log and window list.
//!
//! One thread, the worker, owns the [`Daemon`] and so every repo mutation. The others only turn what they hear into
//! [`Input`]s. Every helper thread wakes at least every 100 ms to see whether it should stop.

use std::collections::BTreeSet;
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use dit_core::Registry;
use dit_core::remote::{Machine, Remote};

use crate::Clock;
use crate::beat::{Beat, HubPulse, Report};
use crate::daemon::{Config, Daemon};
use crate::event::{DaemonEvent, Input};
use crate::fswatch::{FsEvent, Fswatch};
use crate::queue::{Phase, Queue, QueueOptions};
use crate::renders::service::Service;
use crate::renders::{RenderControl, RenderEvent, RenderOptions};
use crate::route::{Link, Router, Tracking, presence};
use crate::script::{ScriptEvent, ScriptServer};
use crate::title;

pub struct Options {
    /// The Live script's folder, where the port file goes; `None` runs without the listener.
    pub script_folder: Option<PathBuf>,
    /// The version the script's greeting names.
    pub app_version: String,
    /// How often the daemon is ticked.
    pub tick: Duration,
    /// How often the DAW's log and window list are read.
    pub poll: Duration,
    /// The sign-in to push and beat with, and the machine it beats as; `None` runs without the hub.
    pub hub: Option<Hub>,
    /// How the push queue paces itself.
    pub queue: QueueOptions,
    /// The render engine's settings; `None` runs without it. It needs `hub` as well: a render is added to the hub.
    pub renders: Option<RenderOptions>,
}

/// The hub the daemon pushes to and beats at, as one signed-in machine.
pub struct Hub {
    /// The sign-in, opened once for the run; [`Running::sign_in`] replaces it.
    pub remote: Arc<Remote>,
    pub machine: Machine,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            script_folder: None,
            app_version: String::new(),
            tick: Duration::from_secs(1),
            poll: Duration::from_secs(5),
            hub: None,
            queue: QueueOptions::default(),
            renders: None,
        }
    }
}

/// A running daemon. Dropping it stops it.
pub struct Running {
    inputs: Sender<Input>,
    events: Receiver<DaemonEvent>,
    fswatch: Arc<Fswatch>,
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
    hub: Mutex<Option<HubParts>>,
    wiring: Wiring,
    _script: Option<ScriptServer>,
}

impl Running {
    /// Sends the daemon an input (adopting a folder, say).
    pub fn send(&self, input: Input) {
        let _ = self.inputs.send(input);
    }

    /// What the daemon reports.
    pub fn events(&self) -> &Receiver<DaemonEvent> {
        &self.events
    }

    /// The one filesystem watcher, for the render watcher to subscribe to.
    pub fn fswatch(&self) -> Arc<Fswatch> {
        self.fswatch.clone()
    }

    fn parts(&self) -> MutexGuard<'_, Option<HubParts>> {
        self.hub.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Signs in to a hub while the daemon runs: starts the push queue, the beat and the render engine (when render
    /// options were given) for `hub`, replacing any hub already attached. Every tracked repo is wanted pushed.
    pub fn attach_hub(&self, hub: Hub) -> io::Result<()> {
        self.detach_hub();
        let parts = self.wiring.build(hub)?;
        *self.parts() = Some(parts);
        Ok(())
    }

    /// Signs out of the hub while the daemon runs: stops the queue, the beat and the render engine, waiting for the
    /// push in flight. Saves are still recorded; nothing is sent until [`Running::attach_hub`].
    pub fn detach_hub(&self) {
        let parts = self.parts().take();
        {
            let mut link = self.wiring.link.lock().unwrap_or_else(|p| p.into_inner());
            *link = Link::default();
        }
        // The router held the last other references; dropping these stops the queue's worker, the beat's thread and
        // the render engine.
        drop(parts);
    }

    /// Whether a hub is attached.
    pub fn has_hub(&self) -> bool {
        self.parts().is_some()
    }

    /// Keeps the push queue off `repo`, now and for any hub attached later: the backfill owns the repo while it
    /// brings the folder in, and the folder joins the daemon ([`Input::AddRepo`]) afterwards. What is wanted of it
    /// waits until [`Running::release`]. A push already running is not interrupted.
    pub fn hold(&self, repo: &std::path::Path) {
        self.wiring
            .held
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(repo.to_path_buf());
        if let Some(parts) = &*self.parts() {
            parts.queue.hold(repo);
        }
    }

    /// Lifts the hold of [`Running::hold`]: the queue pushes what it kept waiting for `repo`.
    pub fn release(&self, repo: &std::path::Path) {
        self.wiring
            .held
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(repo);
        if let Some(parts) = &*self.parts() {
            parts.queue.release(repo);
        }
    }

    /// Wants `repo` pushed as far as `phase`: what a commit the panel made asks for. Nothing without a hub.
    pub fn push(&self, repo: &std::path::Path, phase: Phase) {
        if let Some(parts) = &*self.parts() {
            parts.queue.want(repo, phase);
        }
    }

    /// Signs in again after [`DaemonEvent::SignedOut`]: the queue pushes what it kept waiting and the beat resumes,
    /// both with `remote`.
    pub fn sign_in(&self, remote: Arc<Remote>) {
        if let Some(parts) = &*self.parts() {
            parts.pulse.replace(remote.clone());
            parts.queue.resume(remote.clone());
            parts.beat.resume();
            if let Some(renders) = &parts.renders {
                renders.sign_in(remote);
            }
        }
    }

    /// The machine woke from sleep: beat at once and forget any backoff.
    pub fn wake(&self) {
        if let Some(parts) = &*self.parts() {
            parts.beat.wake();
        }
    }

    /// The render engine's controls, to give to whatever answers `dit renders` for the app: `None` without the hub
    /// or without render options. After [`Running::stop`] an accept answers that the engine has stopped; a reject
    /// still writes the ledger.
    pub fn render_control(&self) -> Option<Arc<dyn RenderControl>> {
        self.parts()
            .as_ref()?
            .renders
            .as_ref()
            .map(|service| -> Arc<dyn RenderControl> { service.control() })
    }

    /// Every render the producer has not rejected, as cards: what the panel shows when it opens.
    pub fn renders(&self) -> Vec<RenderEvent> {
        self.render_control()
            .map(|control| control.renders())
            .unwrap_or_default()
    }

    /// Adds the render `id` to the hub as a version of the track of `set_session`, or of the session it is proposed
    /// for when `None`. The upload goes on in the background and its progress arrives as [`DaemonEvent::Render`].
    pub fn accept_render(&self, id: u64, set_session: Option<i64>) -> Result<RenderEvent, String> {
        self.render_control()
            .ok_or_else(|| "The render engine is not running.".to_string())?
            .accept_render(id, set_session)
    }

    /// Says the render `id` is not a bounce, and with `never_here` that nothing is to be proposed from its folder.
    pub fn reject_render(&self, id: u64, never_here: bool) -> Result<RenderEvent, String> {
        self.render_control()
            .ok_or_else(|| "The render engine is not running.".to_string())?
            .reject_render(id, never_here)
    }

    /// Replaces the folders the render engine watches (none: the home folder) and the folders it never offers from,
    /// as the settings screen edits them; they are kept for a hub attached later. An error means a root cannot be
    /// watched and the engine keeps what it had.
    pub fn set_render_scope(
        &self,
        roots: Vec<PathBuf>,
        excluded: Vec<PathBuf>,
    ) -> Result<(), String> {
        if let Some(options) = self
            .wiring
            .renders
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_mut()
        {
            options.roots = roots.clone();
            options.excluded = excluded.clone();
        }
        match self.render_control() {
            Some(control) => control.set_scope(roots, excluded),
            None => Ok(()),
        }
    }

    /// Replaces the render size limit, in MiB (0 for no limit), for renders judged from now on; kept for a hub
    /// attached later.
    pub fn set_render_max_upload_mb(&self, max_upload_mb: u64) {
        if let Some(options) = self
            .wiring
            .renders
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_mut()
        {
            options.max_upload_mb = max_upload_mb;
        }
        if let Some(control) = self.render_control() {
            control.set_max_upload_mb(max_upload_mb);
        }
    }

    /// Reloads the render engine's `never_here` folder exclusions from the ledger in place.
    pub fn reload_render_never_here(&self) {
        if let Some(control) = self.render_control() {
            control.reload_never_here();
        }
    }

    /// Stops the worker and the helpers, waiting for them.
    pub fn stop(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = self.inputs.send(Input::Stop);
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
        self.detach_hub();
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Runs `step` for each item until `stop` is set or the channel closes.
fn forward<T: Send + 'static>(
    stop: Arc<AtomicBool>,
    receiver: Receiver<T>,
    mut step: impl FnMut(T) + Send + 'static,
) -> JoinHandle<()> {
    thread::spawn(move || {
        while !stop.load(Ordering::SeqCst) {
            match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(item) => step(item),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
    })
}

/// Calls `step` every `every` until `stop` is set.
fn every(
    stop: Arc<AtomicBool>,
    every: Duration,
    mut step: impl FnMut() + Send + 'static,
) -> JoinHandle<()> {
    thread::spawn(move || {
        while !stop.load(Ordering::SeqCst) {
            step();
            let mut waited = Duration::ZERO;
            while waited < every && !stop.load(Ordering::SeqCst) {
                let nap = Duration::from_millis(100).min(every - waited);
                thread::sleep(nap);
                waited += nap;
            }
        }
    })
}

pub fn start(config: Config, options: Options) -> io::Result<Running> {
    let fswatch = Arc::new(Fswatch::new().map_err(io::Error::other)?);
    let stop = Arc::new(AtomicBool::new(false));
    let (inputs, input_rx) = mpsc::channel::<Input>();
    let (app_tx, events) = mpsc::channel();
    let (daemon_tx, daemon_rx) = mpsc::channel();
    let (fs_tx, fs_rx) = mpsc::channel::<FsEvent>();
    let mut threads = Vec::new();
    let tracking = Arc::new(Mutex::new(Tracking::default()));

    let daws = config.registry.all().to_vec();
    let registry = config.registry.clone();
    let clock = config.clock.clone();
    let home = config.home.clone();
    let render_home = config.home.clone();
    let repos_file = config.repos_file.clone();
    let mut daemon = Daemon::new(config, daemon_tx);
    daemon.watch(fswatch.clone(), fs_tx);

    threads.push(thread::spawn(move || {
        daemon.launch();
        while let Ok(input) = input_rx.recv() {
            if matches!(input, Input::Stop) {
                break;
            }
            daemon.on_event(input);
        }
    }));
    {
        let inputs = inputs.clone();
        threads.push(forward(stop.clone(), fs_rx, move |event| {
            let _ = inputs.send(Input::Fs(event));
        }));
    }
    {
        let inputs = inputs.clone();
        threads.push(every(stop.clone(), options.tick, move || {
            let _ = inputs.send(Input::Tick);
        }));
    }
    {
        let inputs = inputs.clone();
        threads.push(every(stop.clone(), options.poll, move || {
            for daw in &daws {
                if let Ok(state) = daw.log_open_set(&home) {
                    let _ = inputs.send(Input::LogPolled(state));
                }
            }
            let _ = inputs.send(Input::WindowsPolled(title::windows()));
        }));
    }
    let script = match &options.script_folder {
        Some(folder) => {
            let (script_tx, script_rx) = mpsc::channel::<ScriptEvent>();
            let server = ScriptServer::start(folder, &options.app_version, script_tx)?;
            let inputs = inputs.clone();
            threads.push(forward(stop.clone(), script_rx, move |event| {
                let _ = inputs.send(Input::Script(event));
            }));
            Some(server)
        }
        None => None,
    };
    let link = Arc::new(Mutex::new(Link::default()));
    let wiring = Wiring {
        registry,
        clock,
        events: app_tx.clone(),
        tracking: tracking.clone(),
        queue: options.queue,
        held: Mutex::new(BTreeSet::new()),
        renders: Mutex::new(options.renders),
        home: render_home,
        repos_file,
        fswatch: fswatch.clone(),
        link: link.clone(),
    };
    let parts = match options.hub {
        Some(hub) => Some(wiring.build(hub)?),
        None => None,
    };
    {
        let router = Router { link, tracking };
        threads.push(forward(stop.clone(), daemon_rx, move |event| {
            router.route(&event);
            let _ = app_tx.send(event);
        }));
    }
    Ok(Running {
        inputs,
        events,
        fswatch,
        stop,
        threads,
        hub: Mutex::new(parts),
        wiring,
        _script: script,
    })
}

/// What runs while the daemon is signed in to a hub: the push queue, the beat and the render engine.
struct HubParts {
    queue: Arc<Queue>,
    beat: Arc<Beat>,
    pulse: Arc<HubPulse>,
    renders: Option<Service>,
}

/// What building [`HubParts`] needs, kept so the app can sign in and out while the daemon runs.
struct Wiring {
    registry: Registry,
    clock: Arc<dyn Clock>,
    events: Sender<DaemonEvent>,
    tracking: Arc<Mutex<Tracking>>,
    queue: QueueOptions,
    held: Mutex<BTreeSet<PathBuf>>,
    renders: Mutex<Option<RenderOptions>>,
    home: PathBuf,
    repos_file: PathBuf,
    fswatch: Arc<Fswatch>,
    link: Arc<Mutex<Link>>,
}

impl Wiring {
    /// Starts the queue, the beat and (with render options) the render engine for `hub`, points the router at the
    /// queue and the beat, and has every repo already tracked pushed, since their `RepoTracked` events are past.
    fn build(&self, hub: Hub) -> io::Result<HubParts> {
        let renders_options = self
            .renders
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone();
        let renders = match &renders_options {
            Some(options) => Some(Service::start(
                options.clone(),
                &self.registry,
                self.home.clone(),
                self.repos_file.clone(),
                self.fswatch.clone(),
                hub.remote.clone(),
                self.clock.clone(),
                self.events.clone(),
            )?),
            None => None,
        };
        let queue = Arc::new(Queue::start(
            hub.remote.clone(),
            self.registry.clone(),
            self.events.clone(),
            self.clock.clone(),
            self.queue,
        ));
        let instance = hub.remote.client().instance().url().to_string();
        let pulse = Arc::new(HubPulse::new(hub.remote, hub.machine));
        let report: Report = {
            let tracking = self.tracking.clone();
            let registry = self.registry.clone();
            Arc::new(move || {
                let tracking = tracking.lock().unwrap_or_else(|p| p.into_inner());
                presence(&tracking, &registry, &instance)
            })
        };
        let beat = Arc::new(Beat::start(
            pulse.clone(),
            report,
            self.clock.clone(),
            self.events.clone(),
        ));
        for repo in self.held.lock().unwrap_or_else(|p| p.into_inner()).iter() {
            queue.hold(repo);
        }
        let tracked: Vec<PathBuf> = self
            .tracking
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .repos
            .iter()
            .cloned()
            .collect();
        for repo in &tracked {
            queue.want(repo, Phase::Commits);
        }
        let mut link = self.link.lock().unwrap_or_else(|p| p.into_inner());
        link.queue = Some(queue.clone());
        link.beat = Some(beat.clone());
        drop(link);
        Ok(HubParts {
            queue,
            beat,
            pulse,
            renders,
        })
    }
}
