//! The open set's branch read out of its repo: the saves since its last commit with their metas and push dots, the
//! last commit, what changed since it (as the suggested message's clauses and the tracks to light), and the time
//! counted since it.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;

use dit_core::{
    Clause, CommitKind, ObjectId, Registry, Repo, SetMeta, initial_clauses, summary_clauses,
};

use crate::reducer::{FolderFacts, HubRepo, HubSetRef, Readout, RepoFacts, SetReadout};
use crate::snapshot::{HeadCommit, LastCommit, SavePush, SaveRow};

/// What a save says of itself, which never changes once it is recorded, keyed by its id.
#[derive(Clone)]
struct Facts {
    at: i64,
    unreadable: bool,
    meta: Option<SetMeta>,
}

/// The most saves' facts held; past it the held ones are let go and read again as needed.
const FACTS_HELD: usize = 512;

/// What changed from one save to a later one, kept for the pair it was worked out for: the readout runs on every
/// save and each minute, and the pair rarely changes between.
struct Diffed {
    head: ObjectId,
    latest: ObjectId,
    clauses: Vec<Clause>,
    tracks_changed: Vec<String>,
}

pub struct RepoReadout {
    registry: Registry,
    facts: Mutex<HashMap<ObjectId, Facts>>,
    diffed: Mutex<Option<Diffed>>,
}

/// Whether the branch whose head is `head` holds a commit of the user's: a checkpoint is the app's own. A chain that
/// cannot be read to its end (a restored branch whose ancestors are not here) counts as having one.
fn has_user_commit(repo: &Repo, head: Option<ObjectId>) -> bool {
    let mut next = head;
    while let Some(id) = next {
        let Ok(commit) = repo.read_commit(&id) else {
            return true;
        };
        if commit.kind == CommitKind::User {
            return true;
        }
        next = commit.parent;
    }
    false
}

impl RepoReadout {
    pub fn new(registry: Registry) -> Self {
        RepoReadout {
            registry,
            facts: Mutex::default(),
            diffed: Mutex::default(),
        }
    }

    fn facts(&self, repo: &Repo, id: &ObjectId) -> Option<Facts> {
        let mut held = self.facts.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(facts) = held.get(id) {
            return Some(facts.clone());
        }
        let save = repo.read_save(id).ok()?;
        let facts = Facts {
            at: save.file_updated_at,
            unreadable: save.unreadable,
            meta: save.meta,
        };
        if held.len() >= FACTS_HELD {
            held.clear();
        }
        held.insert(*id, facts.clone());
        Some(facts)
    }

    /// What changed from the save `head` to the save `latest`, as clauses and as the tracks whose content changed;
    /// nothing when either cannot be compared (no document, or no meta to word it with).
    fn changes(
        &self,
        repo: &Repo,
        head: &ObjectId,
        latest: &ObjectId,
    ) -> (Vec<Clause>, Vec<String>) {
        let mut held = self.diffed.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(done) = held
            .as_ref()
            .filter(|done| done.head == *head && done.latest == *latest)
        {
            return (done.clauses.clone(), done.tracks_changed.clone());
        }
        let compared = (|| {
            let (before, after) = (repo.read_save(head).ok()?, repo.read_save(latest).ok()?);
            let diff = repo.diff(&before, &after).ok()?;
            let clauses = summary_clauses(&diff, before.meta.as_ref(), after.meta.as_ref());
            Some((clauses, diff.tracks_changed))
        })();
        let (clauses, tracks_changed) = compared.unwrap_or_default();
        *held = Some(Diffed {
            head: *head,
            latest: *latest,
            clauses: clauses.clone(),
            tracks_changed: tracks_changed.clone(),
        });
        (clauses, tracks_changed)
    }

    fn set_readout(&self, repo: &Repo, set_id: &str, branch: &str) -> Option<SetReadout> {
        let log = repo.log(set_id, branch).ok()?;
        let head_id = repo.read_ref(set_id, branch).ok()?;
        let head = head_id
            .as_ref()
            .map(|id| repo.read_commit(id))
            .transpose()
            .ok()?;
        let since = match head
            .as_ref()
            .and_then(|head| log.iter().position(|id| *id == head.save))
        {
            Some(at) => &log[at + 1..],
            None => &log[..],
        };
        let binding = repo.remote_binding().ok()?;
        let pushed_set = binding
            .as_ref()
            .and_then(|binding| repo.pushed_to(set_id, binding).ok().flatten());
        let pushed: HashSet<ObjectId> = pushed_set
            .as_ref()
            .and_then(|set| {
                set.branches
                    .get(branch)
                    .map(|pushed| pushed.saves.iter().copied().collect())
            })
            .unwrap_or_default();
        let head_pushed = pushed_set
            .as_ref()
            .and_then(|set| set.branches.get(branch))
            .is_some_and(|pushed| pushed.commit.is_some() && pushed.commit == head_id);
        let file = working_file(repo, set_id, branch);
        let saves = since
            .iter()
            .rev()
            .filter_map(|id| {
                let facts = self.facts(repo, id)?;
                Some(SaveRow {
                    id: id.to_string(),
                    at: facts.at,
                    file: file.clone(),
                    unreadable: facts.unreadable,
                    push: if pushed.contains(id) {
                        SavePush::Pushed
                    } else {
                        SavePush::Pending
                    },
                    meta: facts.meta,
                })
            })
            .collect();
        let head_meta = head
            .as_ref()
            .and_then(|head| self.facts(repo, &head.save))
            .and_then(|facts| facts.meta);
        let latest_id = log.last();
        let latest_meta = latest_id
            .and_then(|id| self.facts(repo, id))
            .and_then(|facts| facts.meta)
            .or_else(|| head_meta.clone());
        let (clauses, tracks_changed) = match (&head, latest_id) {
            (Some(head), Some(latest)) if head.save != *latest => {
                self.changes(repo, &head.save, latest)
            }
            // A branch's first commit has no head to word a change against.
            (None, Some(_)) => (initial_clauses(), Vec::new()),
            _ => Default::default(),
        };
        Some(SetReadout {
            saves,
            last_commit: head.map(|head| HeadCommit {
                message: head.message,
                at: head.at,
                push: if head_pushed {
                    SavePush::Pushed
                } else {
                    SavePush::Pending
                },
            }),
            time_since_commit: None,
            first_commit: !has_user_commit(repo, head_id),
            head_meta,
            latest_meta,
            clauses,
            tracks_changed,
            session_id: pushed_set.map(|set| set.session_id),
        })
    }
}

/// The name of the file a branch of a set is saved from.
fn working_file(repo: &Repo, set_id: &str, branch: &str) -> String {
    let relative = if branch == "main" {
        repo.sets().ok().and_then(|sets| sets.get(set_id).cloned())
    } else {
        repo.branch_files(set_id)
            .ok()
            .and_then(|files| files.get(branch).cloned())
    };
    relative
        .as_deref()
        .and_then(|path| path.rsplit('/').next())
        .unwrap_or(set_id)
        .to_string()
}

impl Readout for RepoReadout {
    fn track_colour(&self, index: i64) -> Option<String> {
        self.registry
            .all()
            .iter()
            .find_map(|daw| daw.track_colour(index))
            .map(str::to_string)
    }

    fn device_display_name(&self, class_name: &str, name: &str) -> String {
        self.registry
            .all()
            .iter()
            .find_map(|daw| daw.device_display_name(class_name, name))
            .unwrap_or_else(|| name.to_string())
    }

    fn read(&self, repo: &Path, set_id: &str, branch: &str) -> Option<SetReadout> {
        let repo = Repo::open(repo, &self.registry).ok()?;
        let mut read = self.set_readout(&repo, set_id, branch)?;
        read.time_since_commit = repo
            .time_since_commit(set_id, branch)
            .ok()
            .filter(|ms| *ms > 0)
            .map(|ms| (ms / 1000) as u64);
        Some(read)
    }

    fn repo(&self, path: &Path) -> RepoFacts {
        let Ok(repo) = Repo::open(path, &self.registry) else {
            return RepoFacts::default();
        };
        let mut last_commit: Option<LastCommit> = None;
        for set_id in repo.sets().unwrap_or_default().into_keys() {
            let branches = repo.branch_files(&set_id).unwrap_or_default();
            for branch in std::iter::once("main").chain(branches.keys().map(String::as_str)) {
                let Ok(Some(head)) = repo.read_ref(&set_id, branch) else {
                    continue;
                };
                let Ok(commit) = repo.read_commit(&head) else {
                    continue;
                };
                if last_commit.as_ref().is_none_or(|held| commit.at > held.at) {
                    last_commit = Some(LastCommit {
                        message: commit.message,
                        at: commit.at,
                    });
                }
            }
        }
        let newest_save = repo.newest_save_at().ok().flatten().map(|(_, _, at)| at);
        let binding = repo.remote_binding().ok().flatten();
        RepoFacts {
            last_active_at: [last_commit.as_ref().map(|commit| commit.at), newest_save]
                .into_iter()
                .flatten()
                .max(),
            last_commit,
            hub_sets: binding
                .as_ref()
                .map(|binding| hub_sets(&repo, binding))
                .unwrap_or_default(),
            hub: binding.map(|binding| HubRepo {
                instance: binding.instance,
                repo_id: binding.repo,
            }),
        }
    }

    fn duration_ms(&self, file: &Path) -> Option<u64> {
        dit_daemon::renders::probe::probe(file).duration_ms
    }

    fn folder(&self, folder: &Path) -> FolderFacts {
        let sets = self
            .registry
            .for_project_folder(folder)
            .and_then(|daw| daw.find_sets(folder).ok())
            .unwrap_or_default()
            .iter()
            .filter_map(|set| set.file_stem())
            .map(|stem| stem.to_string_lossy().into_owned())
            .collect();
        FolderFacts {
            sets,
            synced_by: dit_daemon::backfill::synced_by(folder).map(str::to_string),
        }
    }
}

/// The sets of `repo` that were pushed to the hub repo `binding` names, as sessions there, named for their main
/// files.
fn hub_sets(repo: &Repo, binding: &dit_core::RemoteBinding) -> Vec<HubSetRef> {
    let (Ok(pushed), Ok(files)) = (repo.pushed_sets_to(binding), repo.sets()) else {
        return Vec::new();
    };
    pushed
        .into_iter()
        .filter_map(|(set_id, pushed)| {
            let file = files.get(&set_id)?;
            Some(HubSetRef {
                instance: binding.instance.clone(),
                session_id: pushed.session_id,
                name: Path::new(file).file_stem()?.to_string_lossy().into_owned(),
            })
        })
        .collect()
}

#[cfg(test)]
mod repo_tests {
    use std::fs;
    use std::path::PathBuf;

    use dit_core::CommitKind;

    use super::*;

    const FIXTURES: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/dit/crates/dit-daw-ableton/fixtures/Contract Fixtures Project"
    );

    struct Project {
        _dir: tempfile::TempDir,
        repo: Repo,
        set_file: PathBuf,
        set_id: String,
        readout: RepoReadout,
    }

    impl Project {
        /// A repo whose one set holds `Empty Set.als`, recorded as its first save.
        fn new() -> Project {
            let dir = tempfile::tempdir().unwrap();
            let registry = dit_daws::registry();
            let folder = dir.path().join("Test Project");
            fs::create_dir(&folder).unwrap();
            let set_file = folder.join("Test.als");
            fs::copy(Path::new(FIXTURES).join("Empty Set.als"), &set_file).unwrap();
            let repo = Repo::init(&folder, registry.all()[0]).unwrap();
            repo.record_save(&set_file).unwrap();
            let set_id = repo.sets().unwrap().into_keys().next().unwrap();
            Project {
                readout: RepoReadout::new(registry),
                _dir: dir,
                repo,
                set_file,
                set_id,
            }
        }

        /// The set file replaced by `Arranged Set.als` and recorded.
        fn arrange(&self) {
            fs::copy(Path::new(FIXTURES).join("Arranged Set.als"), &self.set_file).unwrap();
            self.repo.record_save(&self.set_file).unwrap();
        }

        fn commit(&self, kind: CommitKind) {
            self.repo
                .commit(&self.set_id, "main", "a commit", "me", kind)
                .unwrap();
        }

        fn read(&self) -> SetReadout {
            self.readout
                .read(self.repo.root(), &self.set_id, "main")
                .unwrap()
        }
    }

    #[test]
    fn a_set_with_saves_and_no_commit_is_a_first_commit_with_nothing_to_compare() {
        let project = Project::new();

        let read = project.read();

        assert!(read.first_commit);
        assert_eq!(read.saves.len(), 1);
        assert!(read.saves[0].meta.is_some());
        assert_eq!(read.last_commit, None);
        assert_eq!(read.head_meta, None);
        assert_eq!(read.latest_meta, read.saves[0].meta);
        assert_eq!(read.clauses, initial_clauses());
        assert!(read.tracks_changed.is_empty());
        assert_eq!(read.session_id, None, "no hub has adopted it");
    }

    #[test]
    fn after_a_commit_the_saves_since_are_worded_against_the_head() {
        let project = Project::new();
        project.commit(CommitKind::User);
        let committed = project.read();
        assert!(!committed.first_commit);
        assert!(committed.saves.is_empty());
        assert!(
            committed.clauses.is_empty(),
            "nothing changed since the head"
        );
        assert_eq!(
            committed
                .last_commit
                .as_ref()
                .map(|head| (head.message.as_str(), head.push)),
            Some(("a commit", SavePush::Pending))
        );
        assert_eq!(committed.head_meta, committed.latest_meta);

        project.arrange();
        let read = project.read();

        assert_eq!(read.saves.len(), 1);
        assert_eq!(read.latest_meta, read.saves[0].meta);
        assert_ne!(read.head_meta, read.latest_meta);
        assert!(!read.clauses.is_empty(), "{read:?}");
        let log = project.repo.log(&project.set_id, "main").unwrap();
        let (head, latest) = (
            project.repo.read_save(&log[0]).unwrap(),
            project.repo.read_save(&log[1]).unwrap(),
        );
        assert_eq!(
            read.clauses,
            project.repo.clauses(&head, &latest).unwrap(),
            "the panel words the change as the cli's default message does"
        );

        // Asked again over the same pair, the answer is the one that was kept.
        assert_eq!(project.read(), read);
    }

    #[test]
    fn a_checkpoint_is_not_a_commit_of_the_users() {
        let project = Project::new();
        project.commit(CommitKind::Checkpoint);
        assert!(project.read().first_commit);

        project.arrange();
        project.commit(CommitKind::User);
        assert!(!project.read().first_commit);
    }

    #[test]
    fn a_set_pushed_to_the_hub_is_one_of_the_repos_hub_sets_by_its_file_stem() {
        let project = Project::new();
        assert_eq!(project.readout.repo(project.repo.root()).hub_sets, []);

        let binding = dit_core::RemoteBinding {
            instance: "https://hub.test".to_string(),
            repo: 3,
        };
        project.repo.bind_remote(&binding).unwrap();
        assert_eq!(
            project.readout.repo(project.repo.root()).hub_sets,
            [],
            "bound, but no set pushed yet"
        );

        project
            .repo
            .write_pushed(
                &project.set_id,
                &dit_core::repo::PushedSet {
                    instance: binding.instance.clone(),
                    repo_id: 3,
                    session_id: 812,
                    branches: Default::default(),
                },
            )
            .unwrap();

        assert_eq!(
            project.readout.repo(project.repo.root()).hub_sets,
            [HubSetRef {
                instance: "https://hub.test".to_string(),
                session_id: 812,
                name: "Test".to_string(),
            }]
        );
    }
}
