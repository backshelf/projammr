//! What the app asks the hub that the daemon does not: the account's projects (for an adopt offer's picker and for the
//! repo list's links to the web) and the first push that puts a folder just adopted into the project chosen for it.

use std::collections::BTreeMap;

use serde::Deserialize;

use super::*;
use crate::snapshot::HubProject;

/// A hub repo, as far as the app reads it.
#[derive(Deserialize)]
struct HubRepoRow {
    id: i64,
}

impl Core {
    /// The projects the signed-in account belongs to.
    fn hub_projects(&self) -> Result<Vec<HubProject>, String> {
        let remote = self.remote.open().map_err(|error| error.to_string())?;
        remote
            .get("/me/projects")
            .map_err(|error| error.to_string())
    }

    /// Which project each hub repo of the account is in, by repo id.
    fn hub_repo_projects(&self) -> Result<BTreeMap<i64, i64>, String> {
        let remote = self.remote.open().map_err(|error| error.to_string())?;
        let mut projects = BTreeMap::new();
        for project in self.hub_projects()? {
            let repos: Vec<HubRepoRow> = remote
                .get(&format!("/projects/{}/repos", project.id))
                .map_err(|error| error.to_string())?;
            projects.extend(repos.into_iter().map(|repo| (repo.id, project.id)));
        }
        Ok(projects)
    }

    /// Reads the projects of the account on a thread of its own and gives them to the adopt offer for `folder`,
    /// with the project last chosen. A hub that cannot be reached leaves the offer without a picker.
    pub(super) fn offer_projects(self: &Arc<Self>, folder: PathBuf) {
        let core = self.clone();
        thread::spawn(move || {
            let Ok(projects) = core.hub_projects() else {
                return;
            };
            let last = AppState::load(&core.paths.state).last_project;
            core.with_reducer(|reducer| reducer.set_offer_projects(&folder, projects, last));
        });
    }

    /// Learns, on a thread of its own, which project each hub repo is in, which gives the repo list its links. One
    /// reading at a time: a request while another runs is dropped, and the next push asks again.
    pub(super) fn learn_repo_projects(self: &Arc<Self>) {
        if self.learning.swap(true, Ordering::SeqCst) {
            return;
        }
        let core = self.clone();
        thread::spawn(move || {
            let read = core.hub_repo_projects();
            core.learning.store(false, Ordering::SeqCst);
            if let Ok(projects) = read {
                core.with_reducer(|reducer| reducer.set_repo_projects(projects));
            }
        });
    }

    /// The panel's `adopt`: the daemon makes `folder` a repo and tracks it. With a hub project chosen, the folder's
    /// first push then goes into that project; without one the repo is only kept here until a push names a project.
    pub fn adopt(self: &Arc<Self>, folder: PathBuf, project_id: Option<i64>) -> Result<(), String> {
        let project = match project_id {
            Some(id) => Some(
                self.snapshot()
                    .adopt_offer
                    .and_then(|offer| offer.projects.into_iter().find(|project| project.id == id))
                    .ok_or("That project isn't one of yours any more.")?,
            ),
            None => None,
        };
        // The daemon tracks the folder by its canonical path.
        let key = folder.canonicalize().unwrap_or_else(|_| folder.clone());
        self.with_reducer(|reducer| reducer.begin_adopting(&folder, key.clone()));
        let adopted = folder.clone();
        let told = self.tell(move |running| {
            running.send(Input::Adopt(adopted));
        });
        if let Err(error) = told {
            self.with_reducer(|reducer| reducer.finish_adopting(&key));
            return Err(error);
        }
        if let Some(project) = project {
            lock(&self.binds).insert(key, project.name);
            let _ = AppState::update(&self.paths.state, |state| {
                state.last_project = Some(project.id);
            });
        }
        self.with_reducer(|reducer| reducer.clear_adopt_offer(&folder));
        Ok(())
    }

    /// The panel's `track_folder`, the menu's "Track a folder…": the adopt offer for `folder`, a folder told "Not now"
    /// included (adopting it forgets the decline). A folder that already holds a repo of dit's own (made with `dit
    /// init`) is tracked as it is, with no offer to make.
    pub fn track_folder(self: &Arc<Self>, folder: PathBuf) -> Result<(), String> {
        match plan_folder(&self.registry, &self.paths.repos, &folder)? {
            FolderPlan::Offer { folder, set } => {
                self.with_reducer(|reducer| reducer.offer(&folder, &set));
                self.offer_projects(folder);
                Ok(())
            }
            FolderPlan::Track(folder) => {
                RepoList::update(&self.paths.repos, |list| list.add(&folder))
                    .map_err(|e| e.to_string())?;
                self.tell(move |running| running.send(Input::AddRepo(folder)))
            }
        }
    }

    /// A repo is tracked now. When it is a folder the panel just adopted into a project, its first push goes there.
    pub(super) fn bind_if_chosen(self: &Arc<Self>, repo: &Path) {
        let Some(project) = lock(&self.binds).remove(repo) else {
            return;
        };
        let (core, root) = (self.clone(), repo.to_path_buf());
        thread::spawn(move || {
            match commit::push_to_project(&core.remote, &root, &project) {
                Ok(()) => core.learn_repo_projects(),
                Err(error) => core.with_reducer(|reducer| {
                    reducer.notice(format!("dit couldn't add the folder to {project}: {error}"));
                }),
            }
            core.refresh();
        });
    }
}

/// What "Track a folder…" does with a folder.
#[derive(Debug, PartialEq, Eq)]
enum FolderPlan {
    /// Offer to track it, with `set` as the set the offer names.
    Offer { folder: PathBuf, set: PathBuf },
    /// It already holds a repo of dit's own that the list does not know: track it as it is.
    Track(PathBuf),
}

/// What to do with `folder`, or the line saying why nothing: it must be a project folder of a DAW dit knows, with a
/// set in it, that the repo list does not hold yet. A declined folder is as good as any other.
fn plan_folder(
    registry: &Registry,
    repos_file: &Path,
    folder: &Path,
) -> Result<FolderPlan, String> {
    let folder = folder
        .canonicalize()
        .map_err(|_| format!("{} isn't a folder dit can read.", folder.display()))?;
    let name = folder.file_name().map_or_else(
        || folder.display().to_string(),
        |name| name.to_string_lossy().into_owned(),
    );
    let daw = registry
        .for_project_folder(&folder)
        .ok_or_else(|| format!("{name} isn't a project folder of a DAW dit knows."))?;
    let listed = RepoList::load(repos_file).map_err(|e| e.to_string())?;
    if listed.repos.contains(&folder) {
        return Err(format!("dit already tracks {name}."));
    }
    if folder.join(".dit").is_dir() {
        return Ok(FolderPlan::Track(folder));
    }
    let set = daw
        .find_sets(&folder)
        .map_err(|e| e.to_string())?
        .into_iter()
        .next()
        .ok_or_else(|| format!("{name} has no sets to track yet."))?;
    Ok(FolderPlan::Offer { folder, set })
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURES: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/dit/crates/dit-daw-ableton/fixtures/Contract Fixtures Project"
    );

    /// A project folder with one set in it, in a temp dir that also holds the repo list.
    fn project(dir: &Path, name: &str, with_set: bool) -> PathBuf {
        let folder = dir.join(name);
        std::fs::create_dir(&folder).unwrap();
        if with_set {
            std::fs::copy(
                Path::new(FIXTURES).join("Empty Set.als"),
                folder.join("Empty Set.als"),
            )
            .unwrap();
        }
        folder.canonicalize().unwrap()
    }

    #[test]
    fn a_project_folder_with_a_set_is_offered_by_that_set() {
        let dir = tempfile::tempdir().unwrap();
        let folder = project(dir.path(), "old Project", true);

        let plan = plan_folder(
            &dit_daws::registry(),
            &dir.path().join("repos.toml"),
            &folder,
        );

        assert_eq!(
            plan,
            Ok(FolderPlan::Offer {
                set: folder.join("Empty Set.als"),
                folder,
            })
        );
    }

    #[test]
    fn a_folder_that_was_told_not_now_is_offered_again() {
        let dir = tempfile::tempdir().unwrap();
        let folder = project(dir.path(), "old Project", true);
        let repos = dir.path().join("repos.toml");
        RepoList::update(&repos, |list| list.decline(&folder)).unwrap();

        let plan = plan_folder(&dit_daws::registry(), &repos, &folder);

        assert!(matches!(plan, Ok(FolderPlan::Offer { .. })), "{plan:?}");
    }

    #[test]
    fn a_folder_dit_tracks_already_says_so() {
        let dir = tempfile::tempdir().unwrap();
        let folder = project(dir.path(), "old Project", true);
        let repos = dir.path().join("repos.toml");
        RepoList::update(&repos, |list| list.add(&folder)).unwrap();

        assert_eq!(
            plan_folder(&dit_daws::registry(), &repos, &folder),
            Err("dit already tracks old Project.".to_string())
        );
    }

    #[test]
    fn a_repo_made_with_dit_init_is_tracked_as_it_is() {
        let dir = tempfile::tempdir().unwrap();
        let folder = project(dir.path(), "old Project", true);
        std::fs::create_dir(folder.join(".dit")).unwrap();

        assert_eq!(
            plan_folder(
                &dit_daws::registry(),
                &dir.path().join("repos.toml"),
                &folder
            ),
            Ok(FolderPlan::Track(folder))
        );
    }

    #[test]
    fn a_folder_that_is_no_project_or_has_no_sets_or_is_missing_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let repos = dir.path().join("repos.toml");
        let registry = dit_daws::registry();

        let plain = dir.path().join("Music");
        std::fs::create_dir(&plain).unwrap();
        assert_eq!(
            plan_folder(&registry, &repos, &plain),
            Err("Music isn't a project folder of a DAW dit knows.".to_string())
        );
        let empty = project(dir.path(), "empty Project", false);
        assert_eq!(
            plan_folder(&registry, &repos, &empty),
            Err("empty Project has no sets to track yet.".to_string())
        );
        let gone = dir.path().join("gone Project");
        assert!(
            plan_folder(&registry, &repos, &gone)
                .unwrap_err()
                .ends_with("isn't a folder dit can read.")
        );
    }
}
