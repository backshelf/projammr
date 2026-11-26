//! What the app does around the backfill: the run's claim on the daemon, the window, and what quitting and sleeping
//! do to a run.

use std::sync::Weak;

use dit_core::remote::Remote;
use dit_daemon::backfill::{BackfillControl, Owner, Recorder, State};

use super::*;
use crate::backfill::{self, Backfill, Connect, Host, Real};
use crate::backfill_window;
use crate::snapshot::BackfillState;

/// What the backfill asks of the app. The core owns the backfill, so the link back is weak.
struct CoreHost {
    core: Weak<Core>,
}

impl Host for CoreHost {
    fn remote(&self) -> Result<Remote, RemoteError> {
        self.core
            .upgrade()
            .ok_or(RemoteError::NoInstance)?
            .remote
            .open()
    }

    fn host(&self) -> Option<String> {
        let core = self.core.upgrade()?;
        let config = UserConfig::load(&core.paths.config).ok()?;
        config.instance.map(|instance| instance.host().to_string())
    }

    fn standing(&self, standing: Option<BackfillState>) {
        if let Some(core) = self.core.upgrade() {
            core.with_reducer(|reducer| reducer.set_backfill(standing));
        }
    }
}

/// The run's claim on the daemon: the push queue leaves a folder alone while the run pushes it, and the daemon
/// tracks the folder once it is brought in.
struct CoreOwner {
    core: Weak<Core>,
}

impl Owner for CoreOwner {
    fn hold(&self, folder: &Path) {
        let Some(core) = self.core.upgrade() else {
            return;
        };
        // The hold must be in before the run touches the folder, so this waits for the daemon's thread to apply it.
        let (applied, held) = mpsc::channel();
        let folder = folder.to_path_buf();
        let told = core.tell(move |running| {
            running.hold(&folder);
            let _ = applied.send(());
        });
        if told.is_ok() {
            let _ = held.recv_timeout(DETACH_WAIT);
        }
    }

    fn release(&self, folder: &Path) {
        if let Some(core) = self.core.upgrade() {
            let folder = folder.to_path_buf();
            let _ = core.tell(move |running| running.release(&folder));
        }
    }

    fn join(&self, folder: &Path) {
        if let Some(core) = self.core.upgrade() {
            let folder = folder.to_path_buf();
            let _ = core.tell(move |running| running.send(Input::AddRepo(folder)));
        }
    }
}

/// Who a backfill's commits are by: `DIT_AUTHOR`, else `USER`, else `unknown`, as the cli reads them.
fn author() -> String {
    let env = dit_cli::Env::from_process();
    [env.author, env.user]
        .into_iter()
        .flatten()
        .find(|value| !value.is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}

impl Core {
    /// The backfill, with the app's daemon, connection and user config behind it.
    pub(super) fn backfill_for(
        core: &Weak<Core>,
        paths: &Paths,
        registry: &Registry,
    ) -> Arc<Backfill> {
        let config = paths.config.clone();
        let recorder = Recorder {
            registry: registry.clone(),
            author: author(),
            machine: Arc::new(move || {
                UserConfig::load(&config)
                    .map(|config| config.machine())
                    .unwrap_or_else(|_| dit_core::machine::name(None))
            }),
        };
        let connect: Connect = {
            let core = core.clone();
            Box::new(move || core.upgrade().ok_or(RemoteError::NoInstance)?.remote.open())
        };
        let engine = Real::new(
            recorder.clone(),
            &State::beside(&paths.config),
            &paths.repos,
            Arc::new(CoreOwner { core: core.clone() }),
            connect,
        );
        Backfill::new(
            Arc::new(CoreHost { core: core.clone() }),
            Arc::new(engine),
            registry.clone(),
            recorder,
            paths.repos.clone(),
        )
    }

    /// The panel's `open_backfill`: the window, brought forward if it is open, on the run there is.
    pub fn open_backfill(&self) -> Result<(), String> {
        self.backfill.open();
        backfill_window::open(&self.app)
    }

    /// The window's `backfill_close`: closes it, which is what the red button does.
    pub fn close_backfill(&self) {
        if !backfill_window::close(&self.app) {
            self.backfill.closed();
        }
    }

    /// The window is gone, however it went.
    pub fn backfill_closed(self: &Arc<Self>) {
        let backfill = self.backfill.clone();
        // Removing what Check made can take a while, and this runs on the thread that owns the windows.
        thread::spawn(move || backfill.closed());
    }

    /// Pauses the run after the step it is in; a pause with no run going is forgotten when the next one starts.
    pub fn pause_backfill(&self) {
        BackfillControl::pause(self.backfill.as_ref());
    }

    /// The Mac is going to sleep: a run pauses, and carries on when the person resumes it.
    pub fn sleep(&self) {
        self.pause_backfill();
    }

    /// The backfill's view, as `get_backfill` and the event carry it.
    pub fn backfill_view(&self) -> backfill::View {
        self.backfill.view()
    }
}
