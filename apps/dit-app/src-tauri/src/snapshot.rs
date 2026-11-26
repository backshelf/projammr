//! The panel's one view of the app, as `src/ipc.ts` types it. The shapes are held to `fixtures/snapshot.json` by a
//! test here and a test in the web: a field changed on one side and not the other fails a test.

use dit_core::{Clause, SetMeta, StructureTrack};
use dit_daemon::RenderEvent;
use dit_daemon::bar::{BarState, bar_label, bar_title, waiting_renders};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AuthState {
    SignedOut,
    SigningIn,
    SignedIn,
    Revoked,
    KeychainLocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    pub user_code: String,
    pub verification_uri: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Auth {
    pub state: AuthState,
    pub host: Option<String>,
    pub pending: Option<Pending>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Machine {
    pub name: Option<String>,
    /// The name the hub refused, which another of the account's machines has.
    pub refused: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Connection {
    Online,
    Offline,
    NoHub,
    Refused,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Signal {
    Script,
    Log,
    Title,
    Saves,
}

impl From<dit_core::Signal> for Signal {
    fn from(signal: dit_core::Signal) -> Self {
        match signal {
            dit_core::Signal::Script => Signal::Script,
            dit_core::Signal::Log => Signal::Log,
            dit_core::Signal::Title => Signal::Title,
            dit_core::Signal::Saves => Signal::Saves,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSet {
    pub path: String,
    pub name: String,
    pub repo: Option<String>,
    pub branch: Option<String>,
    pub signal: Signal,
    /// The set's page on the instance, for `open_web`; `None` until a push has made the set a session there.
    pub web_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SavePush {
    Pending,
    Pushing,
    Pushed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SaveRow {
    pub id: String,
    pub at: i64,
    pub file: String,
    pub unreadable: bool,
    pub push: SavePush,
    /// What the save says of the set; `None` for an unreadable save.
    pub meta: Option<SetMeta>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LastCommit {
    pub message: String,
    pub at: i64,
}

/// The open set's head commit, with whether the hub has it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeadCommit {
    pub message: String,
    pub at: i64,
    pub push: SavePush,
}

impl From<&HeadCommit> for LastCommit {
    fn from(head: &HeadCommit) -> Self {
        LastCommit {
            message: head.message.clone(),
            at: head.at,
        }
    }
}

/// The set's cover on the hub: a path under `/static/`, and the accent the hub read from its pixels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artwork {
    pub asset_path: String,
    pub accent_hue: Option<f64>,
    pub accent_chroma: Option<f64>,
}

/// A track of the hub the set may be: `track` is its id as a decimal string.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrackChoice {
    pub label: String,
    pub track: String,
}

/// "Which track is this?": the hub's tracks that read like the set, best first, and the title a new one would take.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackProposal {
    pub choices: Vec<TrackChoice>,
    pub new_track: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PushPhase {
    Idle,
    Pushing,
    Waiting,
    Failed,
}

/// How far the current push burst is: the repos pushed of the repos wanted since the hub was last caught up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PushProgress {
    pub done: usize,
    pub total: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PushState {
    pub state: PushPhase,
    pub pending: usize,
    pub message: Option<String>,
    /// Set while `state` is `pushing`.
    pub progress: Option<PushProgress>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScriptPhase {
    /// The DAW has no install of the script, and it can be installed.
    NotInstalled,
    Installed,
    Connected,
    /// The DAW is not installed on this computer, so the script has nowhere to go.
    LiveNotFound,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScriptState {
    pub state: ScriptPhase,
    /// The Live version that said hello while `connected`.
    pub live: Option<String>,
    /// The folder the script is installed in; `None` while it is not installed.
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoRow {
    pub path: String,
    pub name: String,
    pub unreachable: Option<String>,
    pub busy: bool,
    pub last_commit: Option<LastCommit>,
    pub last_active_at: Option<i64>,
    pub web_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HubProject {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptOffer {
    pub folder: String,
    pub set: String,
    pub name: String,
    pub set_count: usize,
    pub synced_by: Option<String>,
    pub projects: Vec<HubProject>,
    pub project_id: Option<i64>,
}

/// Where one set of an adopted folder stands: its first save is being recorded, or is recorded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AdoptingState {
    Saving,
    Saved,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdoptingSet {
    pub name: String,
    pub state: AdoptingState,
}

/// A folder the panel just adopted, while the first saves of its sets are recorded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Adopting {
    pub folder: String,
    /// The folder's name.
    pub name: String,
    pub set_count: usize,
    pub sets: Vec<AdoptingSet>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Permissions {
    pub screen_recording: bool,
}

/// A file the producer said "Not a bounce" to, as settings lists it. The ledger remembers a file by its
/// fingerprint alone, so the name and the folder are known only while a render of the file is still in the ledger.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RememberedFile {
    pub fingerprint: String,
    pub name: Option<String>,
    pub folder: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub shortcut: Option<String>,
    pub shortcut_error: Option<String>,
    pub max_upload_mb: u64,
    pub watch_roots: Vec<String>,
    pub excluded: Vec<String>,
    pub autostart: bool,
    pub machine_name: String,
    pub cli_installed: Option<String>,
    /// What the render watcher never looks in, whatever the producer says (read-only).
    pub built_in_excluded: Vec<String>,
    /// The files marked "Not a bounce", each removable.
    pub rejected_files: Vec<RememberedFile>,
    /// The folders marked "Never here", each removable.
    pub never_here_folders: Vec<String>,
}

/// A set of the hub the render could be a version of instead: the session it is on the hub and the set's name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderSet {
    pub session_id: i64,
    pub name: String,
}

/// One render as the panel's card shows it: the daemon's card, and what only the app can add.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderCard {
    #[serde(flatten)]
    pub render: RenderEvent,
    /// How long the file that is (or would be) uploaded plays, in milliseconds.
    pub duration_ms: Option<u64>,
    /// The name of the set it was matched to.
    pub set: Option<String>,
    /// The other sets of the same repo that are sessions on the hub: the "Not this set" picker's choices.
    pub other_sets: Vec<RenderSet>,
}

/// A `projammr://dit/checkout/<commit id>` link waiting for the restore screen, with what the hub says of the commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingRestore {
    pub commit_id: i64,
    /// The commit's message; `None` until the hub answers.
    pub message: Option<String>,
    /// The set (the hub's session name) the commit belongs to.
    pub set: Option<String>,
    /// The branch name the field starts with: `restore-` and the commit's first seven hex digits.
    pub branch: Option<String>,
    /// Why this restore cannot go: the link is not the account's, nothing here tracks the set, or the hub could not
    /// be asked.
    pub problem: Option<String>,
}

impl PendingRestore {
    /// A link just arrived: nothing is known of the commit yet.
    pub fn link(commit_id: i64) -> Self {
        PendingRestore {
            commit_id,
            message: None,
            set: None,
            branch: None,
            problem: None,
        }
    }
}

/// How far a restore is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum RestoreState {
    Idle,
    /// The commit's objects are coming from the hub; `objects` have arrived.
    Fetching {
        objects: usize,
    },
    /// The objects are being stored and `file` written.
    Writing {
        file: String,
    },
    /// The new working file is written; `note` says why Live did not open it, when it did not.
    Opened {
        file: String,
        note: Option<String>,
    },
    /// The restore did not happen. `message` says why, without the name to try; `suggestion` is a free branch name
    /// for the field when the one asked for was taken; `existing` is the file that was in the way, when one was (the
    /// restore never overwrites it).
    Failed {
        message: String,
        suggestion: Option<String>,
        existing: Option<String>,
    },
}

/// Whether a newer release is on offer, and how far taking it is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum UpdateState {
    /// Nothing newer than this app, or no update feed at all (a development build has none).
    None,
    /// `version` is out; the menu offers it.
    Available { version: String },
    /// `version` is being downloaded, then waits for the app to be idle before it installs and relaunches.
    Installing { version: String },
    /// `version` could not be taken; `message` is the line the menu shows, and the offer stands to be tried again.
    Failed { version: String, message: String },
}

/// How the backfill run stands while one exists: the menu's second line under "Bring in projects…".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum BackfillState {
    /// A run goes, started by the window or by `dit backfill`.
    Running,
    /// A run stopped with folders still to do: paused, or left by a quit or a crash. The window shows "Resume".
    Paused,
}

/// The whole of what the panel shows. The reducer owns it; the panel derives its screen from it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub auth: Auth,
    pub machine: Machine,
    pub connection: Connection,
    pub bar_title: String,
    pub live: bool,
    pub open: Option<OpenSet>,
    pub saves: Vec<SaveRow>,
    pub last_commit: Option<HeadCommit>,
    pub time_since_commit: Option<u64>,
    pub first_commit: bool,
    pub head_meta: Option<SetMeta>,
    pub latest_meta: Option<SetMeta>,
    pub clauses: Vec<Clause>,
    pub tracks_changed: Vec<String>,
    pub live_tracks: Option<Vec<StructureTrack>>,
    pub draft: String,
    pub artwork: Option<Artwork>,
    pub track_proposal: Option<TrackProposal>,
    pub push: PushState,
    pub script: ScriptState,
    pub repos: Vec<RepoRow>,
    pub adopt_offer: Option<AdoptOffer>,
    pub renders: Vec<RenderCard>,
    pub permissions: Permissions,
    pub settings: Settings,
    pub notices: Vec<String>,
    pub pending_restore: Option<PendingRestore>,
    pub restore: RestoreState,
    /// The folder just adopted, while the first saves of its sets are recorded.
    pub adopting: Option<Adopting>,
    pub update: UpdateState,
    /// The backfill run, `None` with no run or once every folder has finished.
    pub backfill: Option<BackfillState>,
}

impl Snapshot {
    /// Whether nothing the app does is half done, so it may be replaced and relaunched: no push is in flight or about
    /// to start, and no backfill runs (a paused one counts as idle: it resumes from its state file). A repo that is
    /// `waiting` (the hub is out of reach) or `failed` has nothing in flight, and the relaunch derives its pushes
    /// again.
    pub fn is_idle(&self) -> bool {
        if self.backfill == Some(BackfillState::Running) {
            return false;
        }
        match self.push.state {
            PushPhase::Pushing => false,
            PushPhase::Idle => self.push.pending == 0,
            PushPhase::Waiting | PushPhase::Failed => true,
        }
    }

    /// The bar's reading of this snapshot.
    pub fn bar_state(&self) -> BarState<'_> {
        BarState {
            signed_in: self.auth.state == AuthState::SignedIn,
            live: self.live,
            set: self.open.as_ref().map(|open| open.name.as_str()),
            saves: self.saves.len(),
            branch: self.open.as_ref().and_then(|open| open.branch.as_deref()),
            renders: waiting_renders(
                &self
                    .renders
                    .iter()
                    .map(|card| card.render.clone())
                    .collect::<Vec<_>>(),
            ),
            pushing: self.push.state == PushPhase::Pushing,
        }
    }

    /// The bar's title. A push in flight is the progress arc on the icon, not a glyph in the title.
    pub fn title(&self) -> String {
        bar_title(&BarState {
            pushing: false,
            ..self.bar_state()
        })
    }

    /// The title in words, which still says a push is in flight.
    pub fn label(&self) -> String {
        bar_label(&self.bar_state())
    }

    /// The nothing-yet snapshot a launch starts from.
    pub fn empty(settings: Settings) -> Snapshot {
        Snapshot {
            auth: Auth {
                state: AuthState::SignedOut,
                host: None,
                pending: None,
            },
            machine: Machine {
                name: None,
                refused: None,
            },
            connection: Connection::NoHub,
            bar_title: String::new(),
            live: false,
            open: None,
            saves: Vec::new(),
            last_commit: None,
            time_since_commit: None,
            first_commit: false,
            head_meta: None,
            latest_meta: None,
            clauses: Vec::new(),
            tracks_changed: Vec::new(),
            live_tracks: None,
            draft: String::new(),
            artwork: None,
            track_proposal: None,
            push: PushState {
                state: PushPhase::Idle,
                pending: 0,
                message: None,
                progress: None,
            },
            script: ScriptState {
                state: ScriptPhase::NotInstalled,
                live: None,
                path: None,
            },
            repos: Vec::new(),
            adopt_offer: None,
            renders: Vec::new(),
            permissions: Permissions {
                screen_recording: false,
            },
            settings,
            notices: Vec::new(),
            pending_restore: None,
            restore: RestoreState::Idle,
            adopting: None,
            update: UpdateState::None,
            backfill: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use dit_core::remote::UserConfig;

    use super::*;
    use crate::core::{Host, settings_of};

    const FIXTURE: &str = include_str!("../../fixtures/snapshot.json");

    #[test]
    fn the_fixture_the_web_asserts_round_trips_through_the_rust_type() {
        let wanted: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
        let snapshot: Snapshot = serde_json::from_value(wanted.clone()).unwrap();
        assert_eq!(serde_json::to_value(&snapshot).unwrap(), wanted);
    }

    fn pushing(state: PushPhase, pending: usize) -> Snapshot {
        let settings = settings_of(&UserConfig::default(), Path::new("/"), &Host::default());
        let mut snapshot = Snapshot::empty(settings);
        snapshot.push.state = state;
        snapshot.push.pending = pending;
        snapshot
    }

    #[test]
    fn a_push_in_flight_or_about_to_start_is_not_idle() {
        assert!(pushing(PushPhase::Idle, 0).is_idle());
        assert!(!pushing(PushPhase::Idle, 2).is_idle());
        assert!(!pushing(PushPhase::Pushing, 1).is_idle());
    }

    #[test]
    fn a_push_that_waits_for_the_hub_or_failed_holds_nothing() {
        assert!(pushing(PushPhase::Waiting, 1).is_idle());
        assert!(pushing(PushPhase::Failed, 1).is_idle());
    }

    #[test]
    fn a_backfill_that_runs_is_not_idle_and_one_that_is_paused_is() {
        let mut snapshot = pushing(PushPhase::Idle, 0);
        snapshot.backfill = Some(BackfillState::Running);
        assert!(!snapshot.is_idle());
        snapshot.backfill = Some(BackfillState::Paused);
        assert!(snapshot.is_idle());
        snapshot.backfill = None;
        assert!(snapshot.is_idle());
    }
}
