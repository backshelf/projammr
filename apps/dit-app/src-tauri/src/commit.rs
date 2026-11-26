//! A commit the panel makes: the cli's `dit commit` run in this process, so the message, its default and its
//! refusals are the cli's own.

use std::path::{Path, PathBuf};

use dit_cli::{Env, RemoteSource};
use dit_core::{Registry, Repo};
use dit_ipc::Run;

/// Commits the latest save of the set file at `set` and returns the repo's root. A blank `message` leaves the cli's
/// default, the summary of what changed. Nothing is pushed: the caller wants the push from the daemon.
pub fn commit(
    remote: &dyn RemoteSource,
    registry: &Registry,
    set: &str,
    message: &str,
) -> Result<PathBuf, String> {
    let path = Path::new(set);
    let repo = Repo::open(path, registry).map_err(|e| e.to_string())?;
    let file = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("{set} is not a set file."))?;
    let mut argv = vec!["commit".to_string(), "--no-push".to_string()];
    if !message.trim().is_empty() {
        argv.extend(["-m".to_string(), message.trim().to_string()]);
    }
    argv.push(file.to_string());
    run_cli(remote, repo.root(), argv)?;
    Ok(repo.root().to_path_buf())
}

/// The first push of the repo at `root`, which creates its hub repo in the project named `project`, as
/// `dit push --project <name>` does: the project a person picked for a folder they just began tracking.
pub fn push_to_project(
    remote: &dyn RemoteSource,
    root: &Path,
    project: &str,
) -> Result<(), String> {
    let argv = ["push", "--project", project].map(str::to_string).to_vec();
    run_cli(remote, root, argv)
}

/// Runs the cli with `argv` in `cwd`, in this process; the cli's own words when it refuses.
fn run_cli(remote: &dyn RemoteSource, cwd: &Path, argv: Vec<String>) -> Result<(), String> {
    let run = Run {
        cwd: cwd.to_path_buf(),
        env: Env::from_process(),
        argv,
    };
    let mut stderr = Vec::new();
    let done = dit_cli::handle(run, &mut stderr, remote, None, None);
    if done.code != 0 {
        return Err(done
            .refusal
            .unwrap_or_else(|| String::from_utf8_lossy(&stderr).trim().to_string()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::readout::RepoReadout;
    use crate::reducer::Readout;
    use crate::remote::AppRemote;

    const FIXTURES: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/dit/crates/dit-daw-ableton/fixtures/Contract Fixtures Project"
    );

    /// A repo of the DAW fixtures in a temp folder, with a user config beside it that names no instance.
    struct Project {
        dir: tempfile::TempDir,
        remote: AppRemote,
        registry: Registry,
    }

    impl Project {
        fn new() -> Project {
            let dir = tempfile::tempdir().unwrap();
            let project = dir.path().join("Test Project");
            fs::create_dir(&project).unwrap();
            for name in ["Empty Set.als", "Arranged Set.als"] {
                fs::copy(Path::new(FIXTURES).join(name), project.join(name)).unwrap();
            }
            let remote = AppRemote::new(dir.path().join("config.toml"));
            let registry = dit_daws::registry();
            let run = Run {
                cwd: project,
                env: Env::from_process(),
                argv: vec!["init".to_string()],
            };
            let done = dit_cli::handle(run, &mut Vec::new(), &remote, None, None);
            assert_eq!(done.code, 0, "{:?}", done.refusal);
            Project {
                dir,
                remote,
                registry,
            }
        }

        fn set(&self, name: &str) -> String {
            // The repo's root is canonical, so a path under a symlinked temp folder is made so too.
            let root = self.dir.path().join("Test Project").canonicalize().unwrap();
            root.join(name).display().to_string()
        }
    }

    #[test]
    fn a_commit_records_the_message_and_leaves_no_saves_since() {
        let project = Project::new();
        let set = project.set("Empty Set.als");

        let root = commit(&project.remote, &project.registry, &set, "  first take  ").unwrap();

        assert!(root.join(".dit").is_dir());
        let (repo, set_id) = {
            let repo = Repo::open(&root, &project.registry).unwrap();
            let id = repo
                .sets()
                .unwrap()
                .into_iter()
                .find(|(_, file)| file == "Empty Set.als")
                .unwrap()
                .0;
            (repo, id)
        };
        let head = repo.read_ref(&set_id, "main").unwrap().unwrap();
        assert_eq!(repo.read_commit(&head).unwrap().message, "first take");
    }

    #[test]
    fn a_blank_message_takes_the_clis_default_and_a_second_commit_with_no_change_is_refused() {
        let project = Project::new();
        let set = project.set("Empty Set.als");

        commit(&project.remote, &project.registry, &set, "").unwrap();
        let again = commit(&project.remote, &project.registry, &set, "twice").unwrap_err();

        assert!(again.starts_with("Nothing to commit"), "{again}");
    }

    #[test]
    fn a_file_outside_any_repo_is_refused_in_words() {
        let project = Project::new();
        let stray = project.dir.path().join("Stray.als");
        fs::write(&stray, b"x").unwrap();

        let error = commit(
            &project.remote,
            &project.registry,
            &stray.display().to_string(),
            "x",
        )
        .unwrap_err();

        assert!(error.contains("no .dit repository"), "{error}");
    }

    #[test]
    fn the_readout_counts_saves_since_the_last_commit_and_names_that_commit() {
        let project = Project::new();
        let set = project.set("Empty Set.als");
        let root = commit(&project.remote, &project.registry, &set, "first take").unwrap();
        let readout = RepoReadout::new(project.registry.clone());
        let repo = Repo::open(&root, &project.registry).unwrap();
        let set_id = repo
            .sets()
            .unwrap()
            .into_iter()
            .find(|(_, f)| f == "Empty Set.als")
            .unwrap()
            .0;

        let committed = readout.read(&root, &set_id, "main").unwrap();
        assert!(committed.saves.is_empty());
        assert_eq!(
            committed.last_commit.as_ref().unwrap().message,
            "first take"
        );

        fs::copy(
            Path::new(FIXTURES).join("Arranged Set.als"),
            project.set("Empty Set.als"),
        )
        .unwrap();
        repo.record_save(Path::new(&set)).unwrap();

        let changed = readout.read(&root, &set_id, "main").unwrap();
        assert_eq!(changed.saves.len(), 1);
        assert_eq!(changed.saves[0].file, "Empty Set.als");
        assert_eq!(changed.saves[0].push, crate::snapshot::SavePush::Pending);
        assert!(!changed.saves[0].unreadable);
        assert_eq!(changed.last_commit.unwrap().message, "first take");
    }
}
