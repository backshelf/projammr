//! Updates. A release app asks the latest GitHub release for a newer build at launch and every six hours, and offers
//! it in the panel menu. A click takes it: download, verify the signature against the key in the release config,
//! wait until the app is idle, install over the running bundle and relaunch. Nothing installs unasked, and nothing
//! installs while a push is in flight.
//!
//! The feed and the public key live in `tauri.release.conf.json` only. A build without them (`bun run dev`,
//! `bun run package`) never registers the plugin, so it has no updater at all.

use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime};

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Runtime, Wry};
use tauri_plugin_updater::{Update, Updater, UpdaterExt};

use crate::core::Core;
use crate::snapshot::UpdateState;

/// The plugin's name in `plugins` of the Tauri config.
const CONFIG_KEY: &str = "updater";

/// How long a check or the feed may take before it is given up until the next one.
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);

/// How long the download of a release may take: the bundle is tens of megabytes.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// When the app looks for an update: once at launch, then every `every`. The clock is read each `tick`, so a Mac that
/// slept past the time checks when it wakes rather than a sleep's worth of awake time later.
#[derive(Debug, Clone, Copy)]
pub struct Cadence {
    pub every: Duration,
    pub tick: Duration,
    /// How often a waiting install asks whether the app is idle yet.
    pub idle_poll: Duration,
}

impl Cadence {
    pub const RELEASE: Cadence = Cadence {
        every: Duration::from_secs(6 * 60 * 60),
        tick: Duration::from_secs(60),
        idle_poll: Duration::from_secs(2),
    };
}

/// What the flow asks of the rest of the app.
pub trait Shell: Send + Sync + 'static {
    /// Puts `state` in the snapshot.
    fn show(&self, state: UpdateState);
    /// Whether the app may be replaced now: [`crate::snapshot::Snapshot::is_idle`], which is where a long job joins
    /// the wait.
    fn is_idle(&self) -> bool;
    /// Starts the app again, the installed build. Does not return.
    fn relaunch(&self);
}

impl Shell for Core {
    fn show(&self, state: UpdateState) {
        self.with_reducer(|reducer| reducer.set_update(state));
    }

    fn is_idle(&self) -> bool {
        self.snapshot().is_idle()
    }

    fn relaunch(&self) {
        self.restart()
    }
}

/// The updater plugin when this build carries an update feed (`plugins.updater` in its config), else `None`. A
/// release build has the feed from `tauri.release.conf.json`; a development build or a local package has none.
pub fn plugin<R: Runtime>(
    config: &tauri::Config,
) -> Option<TauriPlugin<R, tauri_plugin_updater::Config>> {
    if !config.plugins.0.contains_key(CONFIG_KEY) {
        return None;
    }
    // The plugin's TLS stack names no crypto provider; the app's other clients use ring, and so does this one. A
    // provider that is already installed is the same one.
    let _ = rustls::crypto::ring::default_provider().install_default();
    Some(tauri_plugin_updater::Builder::new().build())
}

type MakeUpdater = dyn Fn() -> Result<Updater, tauri_plugin_updater::Error> + Send + Sync;

/// What the flow holds between a check and the click.
#[derive(Default)]
struct Held {
    /// The release on offer.
    offer: Option<Update>,
    /// A click is being carried out: the download, the wait for idle, the install.
    installing: bool,
}

pub struct Updates {
    shell: Arc<dyn Shell>,
    updater: Box<MakeUpdater>,
    cadence: Cadence,
    held: Mutex<Held>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The line the menu shows under an offer that could not be taken.
fn failure_line(version: &str) -> String {
    format!("Couldn't update to {version}. Try again later.")
}

impl Updates {
    /// The release flow over the feed in the app's config.
    pub fn new(app: AppHandle<Wry>, shell: Arc<Core>) -> Arc<Updates> {
        Updates::with(
            shell,
            move || app.updater_builder().timeout(CHECK_TIMEOUT).build(),
            Cadence::RELEASE,
        )
    }

    /// The flow over `updater`, which is made afresh for each check.
    pub fn with(
        shell: Arc<dyn Shell>,
        updater: impl Fn() -> Result<Updater, tauri_plugin_updater::Error> + Send + Sync + 'static,
        cadence: Cadence,
    ) -> Arc<Updates> {
        Arc::new(Updates {
            shell,
            updater: Box::new(updater),
            cadence,
            held: Mutex::default(),
        })
    }

    /// Checks now, then whenever [`Cadence::every`] has passed, for the rest of the run.
    pub fn watch(self: &Arc<Self>) -> JoinHandle<()> {
        let updates = self.clone();
        thread::spawn(move || {
            let mut last = SystemTime::now();
            tauri::async_runtime::block_on(updates.check());
            loop {
                thread::sleep(updates.cadence.tick);
                if last
                    .elapsed()
                    .is_ok_and(|gone| gone < updates.cadence.every)
                {
                    continue;
                }
                last = SystemTime::now();
                tauri::async_runtime::block_on(updates.check());
            }
        })
    }

    /// Asks the feed whether a newer build is out and shows the answer. A feed that cannot be read changes nothing:
    /// the next check tries again.
    pub async fn check(&self) {
        let found = match (self.updater)() {
            Ok(updater) => updater.check().await,
            Err(error) => Err(error),
        };
        let update = match found {
            Ok(update) => update,
            Err(error) => {
                eprintln!("dit: couldn't check for an update: {error}");
                return;
            }
        };
        let mut held = lock(&self.held);
        if held.installing {
            return;
        }
        let state = match &update {
            Some(update) => UpdateState::Available {
                version: update.version.clone(),
            },
            None => UpdateState::None,
        };
        held.offer = update;
        drop(held);
        self.shell.show(state);
    }

    /// The click on "Update to <version>": takes the release on offer. The work goes on a thread of its own, which
    /// the handle joins. A click while one is under way is no second one.
    pub fn install(self: &Arc<Self>) -> Result<Option<JoinHandle<()>>, String> {
        let update = {
            let mut held = lock(&self.held);
            if held.installing {
                return Ok(None);
            }
            let update = held.offer.clone().ok_or("There is no update to install.")?;
            held.installing = true;
            update
        };
        self.shell.show(UpdateState::Installing {
            version: update.version.clone(),
        });
        let updates = self.clone();
        Ok(Some(thread::spawn(move || updates.take(update))))
    }

    /// Downloads `update`, waits for the app to be idle, installs it and relaunches; a failure at any step leaves
    /// the app as it was and the offer in the menu with the failure line under it.
    fn take(&self, update: Update) {
        let version = update.version.clone();
        match self.fetch_and_install(update) {
            Ok(()) => self.shell.relaunch(),
            Err(error) => {
                eprintln!("dit: couldn't update to {version}: {error}");
                lock(&self.held).installing = false;
                self.shell.show(UpdateState::Failed {
                    message: failure_line(&version),
                    version,
                });
            }
        }
    }

    fn fetch_and_install(&self, mut update: Update) -> Result<(), tauri_plugin_updater::Error> {
        update.timeout = Some(DOWNLOAD_TIMEOUT);
        // The download is checked against the signature before it comes back; the install checks it again.
        let bundle = tauri::async_runtime::block_on(update.download(|_, _| {}, || {}))?;
        while !self.shell.is_idle() {
            thread::sleep(self.cadence.idle_poll);
        }
        update.install(&bundle)
    }
}

#[cfg(test)]
mod tests;
