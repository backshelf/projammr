//! The backfill's state file: `backfill.json` beside the user config (`~/Library/Application Support/dit/backfill.json`
//! on macOS). It holds what the producer pressed Start on (the [`Plan`]) and how far each folder got, so a run that
//! stops for any reason (paused, quit, killed) resumes at the set it was on, and a window opened later shows it.
//!
//! The file is written like the renders ledger, through [`State::update`]: a lock file for the read, the change and the
//! write, the write a temp file renamed into place, and a file that does not parse an error, never an empty state.
//! Only one run goes at a time on a machine, whoever started it: [`RunLock`] is the lock a run holds for its whole
//! life, in a file of its own so the short update lock never has to wait for it.

use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

use dit_core::remote::{RemoteError, SetTarget, UserConfig};
use serde::{Deserialize, Serialize};

use crate::jsonfile;

const FILE: &str = "backfill.json";

/// What Start was pressed on: the folders to bring in, in the order they run (newest first).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Plan {
    pub folders: Vec<FolderPlan>,
}

/// One project folder to bring in, and what to do with each of its sets.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderPlan {
    pub path: PathBuf,
    /// The hub project the folder's repo is made in.
    pub project_id: i64,
    /// Whether Check made the folder's `.dit/`: going back to Find or closing the window then removes it.
    pub created_dit: bool,
    pub sets: Vec<SetPlan>,
}

impl FolderPlan {
    /// Whether `other` asks for the same work: the same folder, project and sets, each going to the same place. A
    /// run of one resumes the other where it stopped.
    fn same_work(&self, other: &FolderPlan) -> bool {
        self.path == other.path && self.project_id == other.project_id && self.sets == other.sets
    }
}

/// One set of a folder, as Check recorded it, and where the hub should put it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPlan {
    /// The set's id in the folder's repo.
    pub set_id: String,
    /// The set file.
    pub file: PathBuf,
    pub target: SetTarget,
}

/// Where a folder is in a run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FolderState {
    /// Not started.
    Waiting,
    /// Recording the folder's sets and committing each once: `done` of `of` are brought in.
    Committing {
        done: u32,
        of: u32,
    },
    /// Sending the folder's objects to the hub: `sent` of `of` bytes, `of` being what the hub did not hold when the
    /// folder's turn came.
    Uploading {
        sent: u64,
        of: u64,
    },
    /// The hub cannot be reached or is busy; the folder carries on when it answers.
    WaitingForHub,
    Done,
    /// The run stopped while the folder was being brought in.
    Paused,
    /// The folder could not be brought in, in words the producer reads. The other folders go on.
    Failed(String),
}

/// What a finished folder holds, from the repo the run left.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    /// The time of the oldest save of the folder's sets, milliseconds since the epoch: a save's own time, which for
    /// a copy from `Backup/` is when the file was last modified, never when the commit was made.
    pub first_save: Option<i64>,
    /// The saves on the `main` branches of the sets that were brought in.
    pub saves: u64,
    /// The sets brought in.
    pub sets: u32,
    /// The bytes sent to the hub for the folder.
    pub bytes: u64,
}

/// A folder's line in the state file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderRun {
    pub state: FolderState,
    /// How many of the plan's sets, from the first, are recorded and committed: a run resumes at the next.
    pub committed: u32,
    /// The id of each track the folder's [`SetTarget::NewTrack`] titles were made as on the hub, so a run that stops
    /// and goes on does not make a second track of the same title.
    #[serde(default)]
    pub tracks: BTreeMap<String, i64>,
    /// The bytes sent to the hub for the folder so far, over every run that worked on it.
    #[serde(default)]
    pub bytes: u64,
    /// Set once the folder is [`FolderState::Done`].
    pub totals: Option<Totals>,
}

impl Default for FolderRun {
    fn default() -> Self {
        FolderRun {
            state: FolderState::Waiting,
            committed: 0,
            tracks: BTreeMap::new(),
            bytes: 0,
            totals: None,
        }
    }
}

/// The contents of `backfill.json`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct State {
    pub plan: Plan,
    /// One entry for each folder of `plan`, in the same order.
    pub folders: Vec<FolderRun>,
    /// The run stopped on request (paused, the app quitting, the cli's connection dropping) rather than finishing
    /// or being killed.
    pub paused: bool,
}

impl State {
    /// `backfill.json` in the folder of the default user config.
    pub fn default_path() -> Result<PathBuf, RemoteError> {
        Ok(Self::beside(&UserConfig::default_path()?))
    }

    /// `backfill.json` in the folder of the user config at `config`.
    pub fn beside(config: &Path) -> PathBuf {
        config.with_file_name(FILE)
    }

    /// The state at `path`; an empty one when there is no file yet. A file that does not parse is an `InvalidData`
    /// error naming the file, and is left as it is.
    pub fn load(path: &Path) -> io::Result<Self> {
        jsonfile::load(path)
    }

    /// Reads the state, lets `change` edit it and writes it back, all under the state's lock file, so two processes
    /// never lose each other's change. Returns what `change` returns. When the file cannot be read or parsed,
    /// `change` does not run and nothing is written.
    pub fn update<T>(path: &Path, change: impl FnOnce(&mut State) -> T) -> io::Result<T> {
        jsonfile::update(path, change)
    }

    /// Starts the state over for `plan`, keeping what a stopped run already did of the same work: a folder
    /// finished stays finished, and one that went part of the way resumes at its next set. A folder that asks for
    /// other work than before (a set matched to another session, a project changed) begins again; every step is
    /// safe to repeat, so that costs time and nothing else. `created_dit` is kept once any run set it, so a rerun
    /// that finds the `.dit/` there still knows the run made it.
    pub fn begin(&mut self, mut plan: Plan) {
        let before = std::mem::take(self);
        let mut folders = Vec::with_capacity(plan.folders.len());
        for folder in &mut plan.folders {
            let earlier = before
                .plan
                .folders
                .iter()
                .zip(&before.folders)
                .find(|(old, _)| old.same_work(folder));
            let run = match earlier {
                Some((old, run)) => {
                    folder.created_dit |= old.created_dit;
                    FolderRun {
                        state: if run.state == FolderState::Done {
                            FolderState::Done
                        } else {
                            FolderState::Waiting
                        },
                        committed: run.committed,
                        tracks: run.tracks.clone(),
                        bytes: run.bytes,
                        totals: run.totals.clone(),
                    }
                }
                None => FolderRun::default(),
            };
            folders.push(run);
        }
        *self = State {
            plan,
            folders,
            paused: false,
        };
    }

    /// The project of the last folder planned: where the next backfill's folders go by default.
    pub fn last_project(&self) -> Option<i64> {
        self.plan.folders.last().map(|folder| folder.project_id)
    }

    /// How the run stands, as a window or the cli reads it. `running` is whether a run holds the machine's run
    /// lock now, which the state file cannot say: a run that was killed leaves its folders as they were.
    pub fn status(&self, running: bool) -> RunStatus {
        RunStatus {
            folders: self
                .plan
                .folders
                .iter()
                .zip(&self.folders)
                .map(|(folder, run)| FolderStatus {
                    path: folder.path.clone(),
                    state: run.state.clone(),
                    totals: run.totals.clone(),
                })
                .collect(),
            paused: self.paused,
            running,
        }
    }
}

/// A folder of the run and where it stands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderStatus {
    pub path: PathBuf,
    pub state: FolderState,
    /// What the folder holds, once it is [`FolderState::Done`].
    pub totals: Option<Totals>,
}

/// How a run stands: every folder of the plan, and whether it is going or stopped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunStatus {
    pub folders: Vec<FolderStatus>,
    /// The run stopped on request and waits to be resumed.
    pub paused: bool,
    /// A run holds the machine's run lock: this process, or another (the cli and the app share one run).
    pub running: bool,
}

impl RunStatus {
    /// What the folders that are done add up to.
    pub fn summary(&self) -> Summary {
        let mut summary = Summary::default();
        for totals in self.folders.iter().filter_map(|folder| {
            (folder.state == FolderState::Done)
                .then_some(folder.totals.as_ref())
                .flatten()
        }) {
            summary.first_save = match (summary.first_save, totals.first_save) {
                (Some(a), Some(b)) => Some(a.min(b)),
                (a, b) => a.or(b),
            };
            summary.saves += totals.saves;
            summary.sets += totals.sets;
            summary.projects += 1;
        }
        summary
    }
}

/// What a run brought in, as the completion line reads it: "Your history goes back to March 2019: 3,412 saves across
/// 266 sets in 41 projects."
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// The time of the oldest save brought in, milliseconds since the epoch; `None` when nothing was.
    pub first_save: Option<i64>,
    pub saves: u64,
    pub sets: u32,
    /// The folders that were brought in.
    pub projects: u32,
}

/// The machine's run lock, held for as long as a run goes. A second run on the machine (a cli beside the app, or two
/// terminals) finds it held and is refused; dropping the lock, or the process ending, frees it.
#[derive(Debug)]
pub struct RunLock {
    _file: File,
}

impl RunLock {
    fn file_for(state: &Path) -> io::Result<File> {
        if let Some(folder) = state.parent() {
            std::fs::create_dir_all(folder)?;
        }
        OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(state.with_extension("running"))
    }

    /// Takes the run lock for the state file at `state`; `None` when another run holds it.
    pub fn take(state: &Path) -> io::Result<Option<RunLock>> {
        let file = Self::file_for(state)?;
        match file.try_lock() {
            Ok(()) => Ok(Some(RunLock { _file: file })),
            Err(std::fs::TryLockError::WouldBlock) => Ok(None),
            Err(std::fs::TryLockError::Error(error)) => Err(error),
        }
    }

    /// Whether a run holds the run lock for the state file at `state` now.
    pub fn held(state: &Path) -> io::Result<bool> {
        Ok(Self::take(state)?.is_none())
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;

    fn set(id: &str, target: SetTarget) -> SetPlan {
        SetPlan {
            set_id: id.to_string(),
            file: PathBuf::from(format!("/music/{id}.als")),
            target,
        }
    }

    fn folder(name: &str, sets: Vec<SetPlan>) -> FolderPlan {
        FolderPlan {
            path: PathBuf::from(format!("/music/{name} Project")),
            project_id: 4,
            created_dit: true,
            sets,
        }
    }

    fn path_in(dir: &TempDir) -> PathBuf {
        State::beside(&dir.path().join("config.toml"))
    }

    #[test]
    fn the_file_sits_beside_the_user_config() {
        assert_eq!(
            State::beside(Path::new("/home/dit/config.toml")),
            Path::new("/home/dit/backfill.json")
        );
    }

    #[test]
    fn a_missing_file_is_an_empty_state_and_an_unparseable_one_is_an_error_left_alone() {
        let dir = TempDir::new().unwrap();
        let path = path_in(&dir);
        assert_eq!(State::load(&path).unwrap(), State::default());

        fs::write(&path, "not json").unwrap();
        let error = State::load(&path).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert!(error.to_string().contains("backfill.json"), "{error}");
        assert!(State::update(&path, |_| ()).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "not json");
    }

    #[test]
    fn a_state_survives_the_file() {
        let dir = TempDir::new().unwrap();
        let path = path_in(&dir);
        let plan = Plan {
            folders: vec![folder(
                "science",
                vec![
                    set("a", SetTarget::Session(12)),
                    set("b", SetTarget::NewTrack("science".into())),
                ],
            )],
        };
        State::update(&path, |state| {
            state.begin(plan.clone());
            state.folders[0].state = FolderState::Failed("no".into());
            state.folders[0].committed = 1;
            state.paused = true;
        })
        .unwrap();

        let state = State::load(&path).unwrap();
        assert_eq!(state.plan, plan);
        assert_eq!(state.folders[0].committed, 1);
        assert_eq!(state.folders[0].state, FolderState::Failed("no".into()));
        assert!(state.paused);
    }

    #[test]
    fn begin_keeps_a_finished_folder_and_the_set_a_stopped_one_reached() {
        let done = folder("done", vec![set("a", SetTarget::Track(2))]);
        let part = folder(
            "part",
            vec![
                set("b", SetTarget::Session(7)),
                set("c", SetTarget::Track(2)),
            ],
        );
        let mut state = State::default();
        state.begin(Plan {
            folders: vec![done.clone(), part.clone()],
        });
        state.folders[0] = FolderRun {
            state: FolderState::Done,
            committed: 1,
            totals: Some(Totals {
                first_save: Some(5),
                saves: 3,
                sets: 1,
                bytes: 9,
            }),
            ..FolderRun::default()
        };
        state.folders[1].state = FolderState::Paused;
        state.folders[1].committed = 1;
        state.paused = true;

        // The same folders again, the second now found with its `.dit/` already there.
        let mut again = part.clone();
        again.created_dit = false;
        state.begin(Plan {
            folders: vec![done.clone(), again],
        });

        assert_eq!(state.folders[0].state, FolderState::Done);
        assert_eq!(state.folders[0].totals.as_ref().unwrap().saves, 3);
        assert_eq!(state.folders[1].state, FolderState::Waiting);
        assert_eq!(
            state.folders[1].committed, 1,
            "it resumes at its second set"
        );
        assert!(state.plan.folders[1].created_dit, "the first run made it");
        assert!(!state.paused);
    }

    #[test]
    fn begin_starts_a_folder_over_when_a_set_goes_somewhere_else() {
        let mut state = State::default();
        state.begin(Plan {
            folders: vec![folder("a", vec![set("x", SetTarget::Session(1))])],
        });
        state.folders[0].committed = 1;
        state.folders[0].state = FolderState::Done;

        state.begin(Plan {
            folders: vec![folder("a", vec![set("x", SetTarget::Session(2))])],
        });

        assert_eq!(state.folders[0], FolderRun::default());
    }

    #[test]
    fn the_summary_adds_up_the_folders_that_are_done() {
        let mut state = State::default();
        state.begin(Plan {
            folders: vec![
                folder("a", vec![]),
                folder("b", vec![]),
                folder("c", vec![]),
            ],
        });
        let totals = |first, saves, sets| {
            Some(Totals {
                first_save: first,
                saves,
                sets,
                bytes: 0,
            })
        };
        state.folders[0] = FolderRun {
            state: FolderState::Done,
            committed: 0,
            totals: totals(Some(900), 10, 2),
            ..FolderRun::default()
        };
        state.folders[1] = FolderRun {
            state: FolderState::Done,
            committed: 0,
            totals: totals(Some(300), 5, 1),
            ..FolderRun::default()
        };
        state.folders[2] = FolderRun {
            state: FolderState::Failed("x".into()),
            committed: 0,
            totals: totals(Some(1), 99, 9),
            ..FolderRun::default()
        };

        assert_eq!(
            state.status(false).summary(),
            Summary {
                first_save: Some(300),
                saves: 15,
                sets: 3,
                projects: 2,
            }
        );
    }

    #[test]
    fn the_run_lock_is_held_by_one_taker_at_a_time() {
        let dir = TempDir::new().unwrap();
        let path = path_in(&dir);

        let first = RunLock::take(&path).unwrap().expect("a free lock");
        assert!(RunLock::take(&path).unwrap().is_none());
        assert!(RunLock::held(&path).unwrap());
        // Updating the state is not blocked by a run that holds the lock.
        State::update(&path, |state| state.paused = true).unwrap();

        drop(first);
        assert!(!RunLock::held(&path).unwrap());
        assert!(RunLock::take(&path).unwrap().is_some());
    }
}
