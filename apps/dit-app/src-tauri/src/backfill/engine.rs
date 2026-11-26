//! The run the window drives and the app hands the cli: the daemon's [`Driver`] behind a trait, so what the app does
//! around a run (what the window shows, when it pauses, how the cli's run joins it) is tested with a run that needs no
//! hub.

use std::path::Path;
use std::sync::Arc;

use dit_core::remote::{Remote, RemoteError};
use dit_daemon::backfill::{
    BackfillControl, BackfillError, Config, Control, Driver, Event, Owner, Plan, Recorder,
    RunStatus, Summary,
};

/// One machine's backfill run.
pub trait Engine: Send + Sync {
    /// Brings in the folders of `plan`, resuming a stopped run of the same work; returns when every folder is done or
    /// failed, or the run stopped. `out` hears each change on the calling thread.
    fn start(&self, plan: Plan, out: &mut dyn FnMut(Event)) -> Result<Summary, BackfillError>;
    /// Carries on the stopped run the state file holds.
    fn resume(&self, out: &mut dyn FnMut(Event)) -> Result<Summary, BackfillError>;
    /// How the run stands; `None` when there never was one, an error when the state file cannot be read.
    fn status(&self) -> Result<Option<RunStatus>, BackfillError>;
    /// The plan of the last run, with how far each folder got, for a screen that opens on it; `None` when there never
    /// was one, an error when the state file cannot be read.
    fn plan(&self) -> Result<Option<Plan>, BackfillError>;
    /// Stops the run after the step it is in.
    fn pause(&self);
    /// Forgets a pause no run was there to take, so the next run does not stop at once.
    fn clear_pause(&self);
    /// The project of the last folder of the last run: where the next backfill goes by default.
    fn last_project(&self) -> Result<Option<i64>, BackfillError>;
}

/// Opens the signed-in connection a run asks for.
pub type Connect = Box<dyn Fn() -> Result<Remote, RemoteError> + Send + Sync>;

/// The daemon's driver, with the connection the app opens and the app's daemon as its owner.
pub struct Real {
    control: Control<Connect>,
    state: std::path::PathBuf,
}

impl Real {
    pub fn new(
        recorder: Recorder,
        state: &Path,
        repos: &Path,
        owner: Arc<dyn Owner>,
        connect: Connect,
    ) -> Self {
        let mut config = Config::new(recorder, state.to_path_buf(), repos.to_path_buf());
        config.owner = owner;
        Real {
            control: Control {
                driver: Driver::new(config),
                remote: connect,
            },
            state: state.to_path_buf(),
        }
    }
}

impl Engine for Real {
    fn start(&self, plan: Plan, out: &mut dyn FnMut(Event)) -> Result<Summary, BackfillError> {
        BackfillControl::start(&self.control, plan, out)
    }

    fn resume(&self, out: &mut dyn FnMut(Event)) -> Result<Summary, BackfillError> {
        let remote = (self.control.remote)().map_err(BackfillError::Remote)?;
        self.control.driver.resume(&remote, out)
    }

    fn status(&self) -> Result<Option<RunStatus>, BackfillError> {
        BackfillControl::status(&self.control)
    }

    fn plan(&self) -> Result<Option<Plan>, BackfillError> {
        let state = dit_daemon::backfill::State::load(&self.state)
            .map_err(|error| BackfillError::State(error.to_string()))?;
        Ok((!state.plan.folders.is_empty()).then_some(state.plan))
    }

    fn pause(&self) {
        BackfillControl::pause(&self.control);
    }

    fn clear_pause(&self) {
        self.control.driver.clear_pause();
    }

    fn last_project(&self) -> Result<Option<i64>, BackfillError> {
        self.control.driver.last_project()
    }
}
