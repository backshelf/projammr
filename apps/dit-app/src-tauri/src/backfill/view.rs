//! What the backfill window is sent, as `src/backfill-ipc.ts` types it. The shapes are held to
//! `fixtures/backfill.json` by a test here and a test in the web: a field changed on one side and not the other fails
//! a test.

use std::path::Path;

use dit_daemon::backfill::{FolderState, RunStatus, SetTarget, Summary, Totals};
use serde::{Deserialize, Serialize};

/// The event the window listens for; its payload is the whole [`View`].
pub const EVENT: &str = "dit://backfill";

/// Which of the window's steps the app is in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Step {
    Find,
    Check,
    /// A run that goes, is paused or was stopped.
    BringIn,
    /// A run with every folder finished.
    Done,
}

/// Where a folder stands, in whichever step it is shown: the checking states, then the run's own.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum FolderView {
    /// Found and listed; Check has not read it.
    Idle,
    Reading {
        read: u32,
        of: u32,
    },
    Checked,
    Waiting,
    Committing {
        done: u32,
        of: u32,
    },
    Uploading {
        sent: u64,
        of: u64,
    },
    WaitingForHub,
    Done,
    Paused,
    Failed {
        reason: String,
    },
}

impl From<&FolderState> for FolderView {
    fn from(state: &FolderState) -> Self {
        match state {
            FolderState::Waiting => FolderView::Waiting,
            FolderState::Committing { done, of } => FolderView::Committing {
                done: *done,
                of: *of,
            },
            FolderState::Uploading { sent, of } => FolderView::Uploading {
                sent: *sent,
                of: *of,
            },
            FolderState::WaitingForHub => FolderView::WaitingForHub,
            FolderState::Done => FolderView::Done,
            FolderState::Paused => FolderView::Paused,
            FolderState::Failed(reason) => FolderView::Failed {
                reason: reason.clone(),
            },
        }
    }
}

/// What Check found in a folder that makes it doubtful.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderDoubt {
    pub unreadable: u32,
    pub unrecorded: u32,
    pub synced_by: Option<String>,
}

/// One project folder, as the list on the left shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub path: String,
    pub name: String,
    /// The folder's name without its " Project": what the list and the run title it by.
    pub title: String,
    pub sets: usize,
    pub bytes: u64,
    pub newest: Option<i64>,
    pub already: bool,
    pub state: FolderView,
    pub doubt: Option<FolderDoubt>,
}

/// Where a set goes on the hub.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Target {
    Session { id: i64 },
    Track { id: i64 },
    NewTrack { name: String },
}

impl From<&SetTarget> for Target {
    fn from(target: &SetTarget) -> Self {
        match target {
            SetTarget::Session(id) => Target::Session { id: *id },
            SetTarget::Track(id) => Target::Track { id: *id },
            SetTarget::NewTrack(name) => Target::NewTrack { name: name.clone() },
        }
    }
}

impl From<&Target> for SetTarget {
    fn from(target: &Target) -> Self {
        match target {
            Target::Session { id } => SetTarget::Session(*id),
            Target::Track { id } => SetTarget::Track(*id),
            Target::NewTrack { name } => SetTarget::NewTrack(name.clone()),
        }
    }
}

/// The existing session a set is matched to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    pub session_id: i64,
    pub name: String,
    pub track_id: Option<i64>,
    pub track_title: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SetDoubtKind {
    /// Stored whole, read again later.
    Unreadable,
    /// Left out of the run; the message says why.
    Unrecorded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SetDoubt {
    pub kind: SetDoubtKind,
    pub message: Option<String>,
}

/// One set of the chosen folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Set {
    pub file: String,
    pub name: String,
    pub set_id: Option<String>,
    pub copies: usize,
    pub saves: Option<usize>,
    pub doubt: Option<SetDoubt>,
    pub target: Option<Target>,
    pub matched: Option<Match>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Track {
    pub id: i64,
    pub title: String,
}

/// A session no repo holds, which a set can be matched to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: i64,
    pub name: String,
    pub track_id: Option<i64>,
    pub track_title: Option<String>,
    pub taken_by: Option<String>,
}

/// An account project a folder can go into.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Project {
    pub id: i64,
    pub name: String,
}

/// The chosen folder, on the right.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chosen {
    pub folder: String,
    pub name: String,
    pub project: Option<i64>,
    pub tracks: Vec<Track>,
    pub sessions: Vec<Session>,
    pub new_track: String,
    pub sets: Vec<Set>,
}

/// What the folders would add to the hub's storage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Storage {
    pub bytes: u64,
    pub remaining: Option<u64>,
}

/// One folder of the run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RunFolder {
    pub path: String,
    pub state: FolderView,
    pub totals: Option<Totals>,
}

/// How the run stands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Run {
    pub running: bool,
    pub paused: bool,
    pub folders: Vec<RunFolder>,
}

impl From<&RunStatus> for Run {
    fn from(status: &RunStatus) -> Self {
        Run {
            running: status.running,
            paused: status.paused,
            folders: status
                .folders
                .iter()
                .map(|folder| RunFolder {
                    path: display(&folder.path),
                    state: FolderView::from(&folder.state),
                    totals: folder.totals.clone(),
                })
                .collect(),
        }
    }
}

/// What the folders that are done add up to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Totalled {
    pub first_save: Option<i64>,
    pub saves: u64,
    pub sets: u32,
    pub projects: u32,
}

impl From<Summary> for Totalled {
    fn from(summary: Summary) -> Self {
        Totalled {
            first_save: summary.first_save,
            saves: summary.saves,
            sets: summary.sets,
            projects: summary.projects,
        }
    }
}

/// The whole of what the window shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub step: Step,
    pub host: Option<String>,
    pub roots: Vec<String>,
    pub searching: bool,
    pub folders: Vec<Folder>,
    pub chosen: Option<Chosen>,
    pub projects: Vec<Project>,
    pub storage: Option<Storage>,
    pub hub_error: Option<String>,
    pub can_start: bool,
    pub run: Option<Run>,
    pub summary: Option<Totalled>,
    pub sessions_path: Option<String>,
    pub error: Option<String>,
}

/// A path as the window is told it.
pub fn display(path: &Path) -> String {
    path.display().to_string()
}

/// The last component of `path`, which is how the list names a folder.
pub fn name_of(path: &Path) -> String {
    path.file_name()
        .map_or_else(|| display(path), |name| name.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../../../fixtures/backfill.json");

    #[test]
    fn the_fixture_the_web_asserts_round_trips_through_the_rust_type() {
        let wanted: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
        let view: View = serde_json::from_value(wanted.clone()).unwrap();
        assert_eq!(serde_json::to_value(&view).unwrap(), wanted);
    }

    #[test]
    fn a_target_converts_to_the_engines_and_back() {
        for target in [
            SetTarget::Session(8),
            SetTarget::Track(2),
            SetTarget::NewTrack("science".to_string()),
        ] {
            assert_eq!(SetTarget::from(&Target::from(&target)), target);
        }
    }

    #[test]
    fn the_engines_folder_states_keep_their_words() {
        let json = |state: &FolderState| serde_json::to_value(FolderView::from(state)).unwrap();
        assert_eq!(
            json(&FolderState::WaitingForHub),
            serde_json::json!({ "state": "waiting-for-hub" })
        );
        assert_eq!(
            json(&FolderState::Uploading { sent: 3, of: 9 }),
            serde_json::json!({ "state": "uploading", "sent": 3, "of": 9 })
        );
        assert_eq!(
            json(&FolderState::Failed("no".to_string())),
            serde_json::json!({ "state": "failed", "reason": "no" })
        );
    }
}
