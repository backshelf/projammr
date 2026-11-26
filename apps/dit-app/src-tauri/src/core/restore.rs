//! The restore screen: what the hub says of the commit a `projammr://dit/checkout/<id>` link names, and running the
//! restore the person asks for with "Restore and open".
//!
//! `dit_core::remote::restore` has no way to stop part way (its progress callback only listens), so a restore that
//! has begun cannot be cancelled: closing the screen then means the new branch is still written and Live is not
//! asked to open it.

use dit_core::remote::{Progress, Remote};
use serde::Deserialize;

use super::*;
use crate::restore as rules;
use crate::snapshot::RestoreState;

/// What a link names that the account cannot read, or that is not there.
const NOT_YOURS: &str = "That link isn't one of yours.";
/// What a commit names that no repo here holds.
const NOT_TRACKED: &str = "Not tracked by dit on this computer.";

/// A restore that is running: the commit, and whether the screen was closed meanwhile.
pub(super) struct Restoring {
    closed: Arc<AtomicBool>,
}

/// The hub's commit (`GET /commits/:id`), as far as the screen reads it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommitView {
    hash: String,
    message: String,
    dit_set_id: Option<String>,
    repo_id: i64,
    session_name: String,
}

/// Where the restore screen is for a step the core reported: the objects fetched so far, or the file being written.
fn progress_state(progress: Progress, file: &str) -> RestoreState {
    match progress {
        Progress::Fetching { objects } => RestoreState::Fetching { objects },
        Progress::Writing => RestoreState::Writing {
            file: file.to_string(),
        },
    }
}

/// The restore screen for a restore the core refused or could not finish: its own line. A name that was taken (a
/// branch, or the file of one) says so without the name to try, which comes as data for the field to take.
fn failed_state(error: &dit_core::remote::RestoreError) -> RestoreState {
    use dit_core::remote::RestoreError;
    match error {
        RestoreError::BranchFileExists { path, suggestion } => RestoreState::Failed {
            message: format!(
                "{} already exists.",
                path.file_name().map_or_else(
                    || path.display().to_string(),
                    |name| name.to_string_lossy().into_owned()
                )
            ),
            suggestion: Some(suggestion.clone()),
            existing: Some(path.display().to_string()),
        },
        RestoreError::BranchExists { name, suggestion } => RestoreState::Failed {
            message: format!("A branch named {name} already exists."),
            suggestion: Some(suggestion.clone()),
            existing: None,
        },
        other => RestoreState::Failed {
            message: other.to_string(),
            suggestion: None,
            existing: None,
        },
    }
}

/// What the hub's answer for a commit says to the person.
fn view_problem(error: &RemoteError) -> String {
    match error {
        RemoteError::Refused {
            status: 403 | 404, ..
        } => NOT_YOURS.to_string(),
        other => other.to_string(),
    }
}

impl Core {
    /// A restore link arrived: the restore screen shows, and what the hub says of the commit is read on a thread. A
    /// link for the commit already shown changes nothing, and none is taken while a restore runs.
    pub(super) fn begin_restore(self: &Arc<Self>, commit_id: i64) {
        if self
            .snapshot()
            .pending_restore
            .is_some_and(|pending| pending.commit_id == commit_id)
        {
            return;
        }
        if lock(&self.restoring).is_some() {
            self.with_reducer(|reducer| {
                reducer.notice("A restore is still running. Wait for it to finish.".to_string());
            });
            return;
        }
        *lock(&self.restore_home) = None;
        self.with_reducer(|reducer| {
            reducer.set_pending_restore(Some(PendingRestore::link(commit_id)));
        });
        let core = self.clone();
        thread::spawn(move || core.read_commit(commit_id));
    }

    /// Asks the hub for the commit and says what came of it on the screen.
    fn read_commit(&self, commit_id: i64) {
        let found = self.commit_view(commit_id);
        if let Ok((_, home)) = &found {
            *lock(&self.restore_home) = home.clone().map(|home| (commit_id, home));
        }
        self.with_reducer(|reducer| {
            reducer.fill_pending_restore(commit_id, |pending| match found {
                Ok((view, home)) => {
                    pending.message = Some(view.message);
                    pending.set = Some(view.session_name);
                    pending.branch = Some(rules::default_branch(&view.hash));
                    if home.is_none() {
                        pending.problem = Some(NOT_TRACKED.to_string());
                    }
                }
                Err(problem) => pending.problem = Some(problem),
            });
        });
    }

    /// The hub's commit and where its set is on this computer, or the line saying why not.
    fn commit_view(&self, commit_id: i64) -> Result<(CommitView, Option<rules::Home>), String> {
        let remote = self.remote.open().map_err(|error| error.to_string())?;
        let view: CommitView = remote
            .get(&format!("/commits/{commit_id}"))
            .map_err(|error| view_problem(&error))?;
        let repos = RepoList::load(&self.paths.repos)
            .map(|list| list.repos)
            .unwrap_or_default();
        let home = view.dit_set_id.as_deref().and_then(|set_id| {
            rules::locate(
                &repos,
                &self.registry,
                remote.client().instance(),
                view.repo_id,
                set_id,
            )
        });
        Ok((view, home))
    }

    /// The panel's `restore`: writes the commit as the new branch `name` on a thread and opens the file in the DAW.
    /// The name is refused here, in the core's words, before anything is asked of the hub.
    pub fn restore(self: &Arc<Self>, commit_id: i64, name: &str) -> Result<(), String> {
        rules::check_branch_name(name)?;
        let pending = self
            .snapshot()
            .pending_restore
            .filter(|pending| pending.commit_id == commit_id)
            .ok_or("That restore isn't waiting any more.")?;
        if let Some(problem) = pending
            .problem
            .filter(|problem| problem == NOT_YOURS || problem == NOT_TRACKED)
        {
            return Err(problem);
        }
        let remote = self.remote.open().map_err(|error| error.to_string())?;
        let closed = Arc::new(AtomicBool::new(false));
        {
            let mut running = lock(&self.restoring);
            if running.is_some() {
                return Err("A restore is already running.".to_string());
            }
            *running = Some(Restoring {
                closed: closed.clone(),
            });
        }
        let home = lock(&self.restore_home)
            .clone()
            .filter(|(id, _)| *id == commit_id)
            .map(|(_, home)| home);
        self.with_reducer(|reducer| reducer.set_restore(RestoreState::Fetching { objects: 0 }));
        let (core, name) = (self.clone(), name.to_string());
        thread::spawn(move || core.run_restore(&remote, commit_id, &name, home, &closed));
        Ok(())
    }

    /// The restore itself, on its own thread: the screen follows its progress and its end.
    fn run_restore(
        &self,
        remote: &Remote,
        commit_id: i64,
        name: &str,
        home: Option<rules::Home>,
        closed: &AtomicBool,
    ) {
        let repos = RepoList::load(&self.paths.repos)
            .map(|list| list.repos)
            .unwrap_or_default();
        let file = home
            .as_ref()
            .map_or_else(|| name.to_string(), |home| home.file_for(name));
        let outcome = dit_core::remote::restore(
            &repos,
            &self.registry,
            remote,
            commit_id,
            Some(name),
            &mut |progress| {
                if closed.load(Ordering::SeqCst) {
                    return;
                }
                let state = progress_state(progress, &file);
                self.with_reducer(|reducer| reducer.set_restore(state));
            },
        );
        *lock(&self.restoring) = None;
        let closed = closed.load(Ordering::SeqCst);
        match outcome {
            Ok(restored) => self.restored(&restored, closed),
            Err(error) if closed => {
                self.with_reducer(|reducer| reducer.notice(format!("The restore failed: {error}")));
            }
            Err(error) => self.with_reducer(|reducer| reducer.set_restore(failed_state(&error))),
        }
    }

    /// The branch is written: it is pushed, and the screen says the file is open in the DAW, or why it is not.
    fn restored(&self, restored: &dit_core::remote::Restored, closed: bool) {
        let name = restored
            .file
            .file_name()
            .map_or_else(String::new, |name| name.to_string_lossy().into_owned());
        // The restore recorded the new file's first save itself: the hub is to have it.
        let root = restored.repo.clone();
        let _ = self.tell(move |running| running.push(&root, Phase::Saves));
        self.refresh();
        if closed {
            self.with_reducer(|reducer| {
                reducer.notice(format!("Restored {name}. It wasn't opened."));
            });
            return;
        }
        let note = crate::daw_app::open(&self.registry, &restored.file).err();
        self.with_reducer(|reducer| {
            reducer.set_restore(RestoreState::Opened { file: name, note });
        });
    }

    /// The panel's `cancel_restore`. Before "Restore and open" it lets the link go; once the restore runs it cannot be
    /// stopped, so it only closes the screen and keeps the DAW from being asked to open the file.
    pub fn cancel_restore(&self) {
        if let Some(running) = &*lock(&self.restoring) {
            running.closed.store(true, Ordering::SeqCst);
        }
        *lock(&self.restore_home) = None;
        self.with_reducer(|reducer| reducer.set_pending_restore(None));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cores_progress_is_fetching_then_writing_the_file() {
        assert_eq!(
            progress_state(Progress::Fetching { objects: 0 }, "science @fix.als"),
            RestoreState::Fetching { objects: 0 }
        );
        assert_eq!(
            progress_state(Progress::Fetching { objects: 12 }, "science @fix.als"),
            RestoreState::Fetching { objects: 12 }
        );
        assert_eq!(
            progress_state(Progress::Writing, "science @fix.als"),
            RestoreState::Writing {
                file: "science @fix.als".to_string()
            }
        );
    }

    #[test]
    fn a_restore_that_fails_says_it_in_the_cores_words() {
        use dit_core::remote::RestoreError;
        assert_eq!(
            failed_state(&RestoreError::NotTracked),
            RestoreState::Failed {
                message: "Not tracked by dit on this computer.".to_string(),
                suggestion: None,
                existing: None,
            }
        );
        assert_eq!(
            failed_state(&RestoreError::BranchExists {
                name: "fix".to_string(),
                suggestion: "fix-2".to_string(),
            }),
            RestoreState::Failed {
                message: "A branch named fix already exists.".to_string(),
                suggestion: Some("fix-2".to_string()),
                existing: None,
            }
        );
    }

    #[test]
    fn a_file_in_the_way_is_data_for_the_screen_not_a_sentence() {
        use dit_core::remote::RestoreError;
        assert_eq!(
            failed_state(&RestoreError::BranchFileExists {
                path: PathBuf::from("/Music/science Project/science @restore-a1b2c3d.als"),
                suggestion: "restore-a1b2c3d-2".to_string(),
            }),
            RestoreState::Failed {
                message: "science @restore-a1b2c3d.als already exists.".to_string(),
                suggestion: Some("restore-a1b2c3d-2".to_string()),
                existing: Some("/Music/science Project/science @restore-a1b2c3d.als".to_string()),
            }
        );
    }

    #[test]
    fn a_commit_the_account_cannot_read_is_not_one_of_its_own() {
        let refused = |status| RemoteError::Refused {
            host: "https://hub.test".to_string(),
            status,
            code: None,
            details: None,
            message: "Commit not found".to_string(),
        };
        assert_eq!(view_problem(&refused(404)), "That link isn't one of yours.");
        assert_eq!(view_problem(&refused(403)), "That link isn't one of yours.");
        assert_eq!(view_problem(&refused(500)), "Commit not found");
        assert_eq!(
            view_problem(&RemoteError::Unreachable {
                host: "https://hub.test".to_string(),
                reason: "refused".to_string(),
            }),
            "Can't reach https://hub.test: refused"
        );
    }

    #[test]
    fn the_hubs_commit_is_read_by_the_fields_the_screen_shows() {
        let body = r#"{"id":41,"hash":"a1b2c3d4e5","parentHash":null,"saveHash":"ff","message":"added strings",
            "kind":"user","committedAt":"2026-01-02T03:04:05.000Z","branch":"main","ditSetId":"abc123",
            "repoId":3,"sessionId":812,"sessionName":"science123"}"#;
        let view: CommitView = serde_json::from_str(body).unwrap();
        assert_eq!(view.message, "added strings");
        assert_eq!(view.session_name, "science123");
        assert_eq!(view.dit_set_id.as_deref(), Some("abc123"));
        assert_eq!(rules::default_branch(&view.hash), "restore-a1b2c3d");
        let none: CommitView = serde_json::from_str(
            r#"{"hash":"a","message":"m","ditSetId":null,"repoId":1,"sessionName":"s"}"#,
        )
        .unwrap();
        assert_eq!(none.dit_set_id, None);
    }
}
