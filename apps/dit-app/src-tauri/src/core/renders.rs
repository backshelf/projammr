//! What the app does with the render engine the daemon runs: starting it from the settings, keeping the panel's cards
//! and the notification in step with what it says, and the decisions the panel sends back ("Add as version", the
//! turn-downs, and taking a remembered turn-down away).

use dit_daemon::renders::ledger::Ledger;
use dit_daemon::renders::rejections;
use dit_daemon::renders::{RenderEvent, RenderState};
use serde::Deserialize;

use super::*;
use crate::{notify, renders};

/// What the panel says when a render is decided on while no render engine runs: it needs a hub to be attached, and
/// folders to watch.
const NO_ENGINE: &str =
    "dit isn't looking for bounces right now. Sign in, and check the folders it watches.";

/// How the panel turns a render down.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Rejection {
    /// "Not a bounce": this file is never proposed again, whatever its name.
    NotABounce,
    /// "Never here": the same, and nothing is proposed from the folder.
    NeverHere,
}

impl Rejection {
    fn never_here(self) -> bool {
        self == Rejection::NeverHere
    }
}

impl Core {
    /// Where the render ledger is: beside the user config.
    pub fn ledger_path(&self) -> PathBuf {
        Ledger::beside(&self.paths.config)
    }

    /// The render engine's settings as the config says them: the size limit, the folders watched (the whole home
    /// folder for none) and the folders never looked in. A sure render is never added without asking.
    fn render_settings(&self) -> RenderOptions {
        let config = UserConfig::load(&self.paths.config).unwrap_or_default();
        RenderOptions {
            ledger_path: self.ledger_path(),
            max_upload_mb: config.max_upload_mb.unwrap_or(0),
            export_dirs: Vec::new(),
            roots: config.watch_roots.iter().map(PathBuf::from).collect(),
            excluded: config.excluded.iter().map(PathBuf::from).collect(),
        }
    }

    /// The settings to start the engine with. A folder that is not there (a drive that is unplugged) would stop the
    /// whole hub from being attached, so it is left out with a notice; when every folder chosen is missing there is
    /// nothing to watch, and the engine is not started (an empty list would watch the home folder, which is not what
    /// was chosen).
    pub(super) fn render_options(&self) -> Option<RenderOptions> {
        let mut options = self.render_settings();
        let (present, missing) = split_roots(options.roots);
        for root in &missing {
            self.with_reducer(|reducer| {
                reducer.notice(format!(
                    "{} isn't there, so dit isn't looking for bounces in it.",
                    root.display()
                ));
            });
        }
        if present.is_empty() && !missing.is_empty() {
            return None;
        }
        options.roots = present;
        Some(options)
    }

    /// The engine's controls while a hub is attached.
    pub fn render_control(&self) -> Option<Arc<dyn RenderControl>> {
        lock(&self.render_control).clone()
    }

    /// A hub was attached to `running` (or the daemon began): take its engine's controls, show the renders it holds
    /// and count them as announced, so a render found before now never notifies.
    pub(super) fn render_attached(&self, running: &Running) {
        let cards = running.renders();
        lock(&self.announced).seed(&cards);
        *lock(&self.render_control) = running.render_control();
        self.with_reducer(|reducer| reducer.set_renders(cards));
    }

    /// The hub was detached: no engine, no cards.
    pub(super) fn render_detached(&self) {
        *lock(&self.render_control) = None;
        self.with_reducer(|reducer| reducer.set_renders(Vec::new()));
    }

    /// The engine said a render changed, and the reducer has taken it in: notify when it is first ready to be added,
    /// and read the remembered turn-downs again when one was just made.
    pub(super) fn render_changed(&self, card: &RenderEvent) {
        if card.state == RenderState::Rejected {
            self.publish_remembered();
        }
        if !lock(&self.announced).first(card) {
            return;
        }
        let snapshot = self.snapshot();
        let shown = snapshot
            .renders
            .iter()
            .find(|shown| shown.render.id == card.id);
        let (title, body) = renders::announcement(
            card,
            shown.and_then(|shown| shown.set.as_deref()),
            shown.and_then(|shown| shown.duration_ms),
        );
        if let Err(error) = notify::notify_render(&self.app, card.id, &title, &body) {
            self.with_reducer(|reducer| {
                reducer.notice(format!("dit couldn't show a notification: {error}"));
            });
        }
    }

    /// Reads what the ledger remembers (the files and folders turned down) into the settings.
    pub(super) fn publish_remembered(&self) {
        let (rejected_files, never_here_folders) = renders::remembered(&self.ledger_path());
        {
            let mut host = lock(&self.host);
            host.rejected_files = rejected_files;
            host.never_here_folders = never_here_folders;
        }
        self.publish_settings();
    }

    /// The panel's `accept_render`: adds the render `id` to the hub as a version of its set's track, or of the track
    /// of the set whose hub session is `session` ("Not this set"). The upload goes on in the background and shows in
    /// the card.
    pub fn accept_render(&self, id: u64, session: Option<i64>) -> Result<(), String> {
        let control = self.render_control().ok_or(NO_ENGINE)?;
        control.accept_render(id, session).map(|_| ())
    }

    /// The panel's `reject_render`.
    pub fn reject_render(&self, id: u64, rejection: Rejection) -> Result<(), String> {
        let control = self.render_control().ok_or(NO_ENGINE)?;
        control
            .reject_render(id, rejection.never_here())
            .map(|_| ())
    }

    /// Settings' remove button on a file marked "Not a bounce": it can be proposed again. The engine reads the
    /// ledger for each file it follows, so this is at once; the hub, which is the record, is told off this thread.
    pub fn forget_rejection(&self, fingerprint: &str) -> Result<(), String> {
        Ledger::update(&self.ledger_path(), |ledger| {
            ledger.forget_rejected(fingerprint)
        })
        .map_err(|error| error.to_string())?;
        self.publish_remembered();
        self.tell_hub_of_rejections();
        Ok(())
    }

    /// Settings' remove button on a folder marked "Never here". Updates the ledger, reloads the running render
    /// engine's filter in-place without tearing down the hub connection, and flushes the removal to the hub.
    pub fn forget_never_here(self: &Arc<Self>, folder: &str) -> Result<(), String> {
        Ledger::update(&self.ledger_path(), |ledger| {
            ledger.forget_never_here(Path::new(folder))
        })
        .map_err(|error| error.to_string())?;
        self.publish_remembered();
        let _ = self.tell(|running| running.reload_render_never_here());
        self.tell_hub_of_rejections();
        Ok(())
    }

    /// Sends the hub what the ledger holds that it has not heard, without making the caller wait for the network.
    /// With no hub, or one that cannot be reached, it stays in the ledger for the next attach.
    fn tell_hub_of_rejections(&self) {
        let Ok(remote) = self.remote.open() else {
            return;
        };
        let path = self.ledger_path();
        thread::spawn(move || {
            let _ = rejections::flush(&path, &remote);
        });
    }

    /// A render setting changed in the config: the running engine takes it. The size limit applies to renders judged
    /// from now on; a changed folder list watches the new folders before it lets the old go, and an error (a folder
    /// that cannot be watched) leaves what was watched and is shown as a notice.
    pub fn render_setting_changed(self: &Arc<Self>, key: &str) -> Result<(), String> {
        let options = self.render_settings();
        let core = self.clone();
        match key {
            "watchRoots" | "excluded" => self.tell(move |running| {
                if let Err(error) = running.set_render_scope(options.roots, options.excluded) {
                    core.with_reducer(|reducer| reducer.notice(error));
                }
            }),
            "maxUploadMb" => self.tell(move |running| {
                running.set_render_max_upload_mb(options.max_upload_mb);
            }),
            _ => Ok(()),
        }
    }
}

/// `roots` split into the folders that exist and the ones that do not.
fn split_roots(roots: Vec<PathBuf>) -> (Vec<PathBuf>, Vec<PathBuf>) {
    roots.into_iter().partition(|root| root.is_dir())
}

/// The folders a `watchRoots` setting names, each of which must be a folder that exists: the engine watches them,
/// and one that is not there cannot be.
pub fn check_roots(roots: &[String]) -> Result<(), String> {
    match roots.iter().find(|root| !Path::new(root).is_dir()) {
        Some(root) => Err(format!("{root} isn't a folder dit can watch.")),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_rejection_is_never_here_only_for_the_folder_turn_down() {
        assert!(!Rejection::NotABounce.never_here());
        assert!(Rejection::NeverHere.never_here());
    }

    #[test]
    fn the_panels_words_for_a_turn_down_are_read_as_the_two_rejections() {
        let read = |text: &str| serde_json::from_value::<Rejection>(serde_json::json!(text));
        assert_eq!(read("not-a-bounce").unwrap(), Rejection::NotABounce);
        assert_eq!(read("never-here").unwrap(), Rejection::NeverHere);
        assert!(read("not-this-set").is_err());
    }

    #[test]
    fn roots_that_are_not_there_are_left_out_and_named() {
        let dir = tempfile::tempdir().unwrap();
        let here = dir.path().to_path_buf();
        let gone = dir.path().join("Unplugged");

        let (present, missing) = split_roots(vec![gone.clone(), here.clone()]);

        assert_eq!(present, [here]);
        assert_eq!(missing, [gone]);
        assert_eq!(split_roots(Vec::new()), (Vec::new(), Vec::new()));
    }

    #[test]
    fn watch_roots_must_be_folders_that_exist() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().display().to_string();
        assert_eq!(check_roots(std::slice::from_ref(&folder)), Ok(()));
        assert_eq!(check_roots(&[]), Ok(()));
        let file = dir.path().join("a.txt");
        std::fs::write(&file, "x").unwrap();
        let missing = dir.path().join("gone").display().to_string();
        assert_eq!(
            check_roots(&[folder, missing.clone()]),
            Err(format!("{missing} isn't a folder dit can watch."))
        );
        assert!(check_roots(&[file.display().to_string()]).is_err());
    }
}
