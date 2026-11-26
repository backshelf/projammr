//! The rules of the restore screen that are not about threads: the branch name `restore` is asked for (refused the
//! way the core refuses it), the name the field starts with, the file the restore will write and the repo it is
//! written into.

use std::path::PathBuf;

pub use dit_core::branch_file_name;
use dit_core::remote::Instance;
use dit_core::{Registry, Repo, RepoError};

/// `name` when a branch can be called that, else the core's own refusal line (`RepoError::BadBranchName`).
///
/// Delegates to `dit_core::check_branch_name` and also refuses `main` in any case (matching `checkout_new_branch`).
pub fn check_branch_name(name: &str) -> Result<(), String> {
    if name.eq_ignore_ascii_case("main") {
        return Err(RepoError::BadBranchName(name.to_string()).to_string());
    }
    dit_core::check_branch_name(name).map_err(|error| error.to_string())
}

/// The name the branch field starts with: `restore-` and the commit's first seven hex digits.
pub fn default_branch(hash: &str) -> String {
    format!("restore-{}", hash.chars().take(7).collect::<String>())
}

/// Where a commit's set lives on this computer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Home {
    /// The project folder.
    pub repo: PathBuf,
    /// The set's main file, relative to it.
    pub main_rel: String,
}

impl Home {
    /// The name, without folders, of the file a restore as branch `branch` writes.
    pub fn file_for(&self, branch: &str) -> String {
        let relative = branch_file_name(&self.main_rel, branch);
        relative.rsplit('/').next().unwrap_or(&relative).to_string()
    }
}

/// The first of `repos` bound to the hub repo `hub_repo` on `instance` that has the set `set_id`: where a restore of
/// one of its commits goes, as the core's `restore` finds it.
pub fn locate(
    repos: &[PathBuf],
    registry: &Registry,
    instance: &Instance,
    hub_repo: i64,
    set_id: &str,
) -> Option<Home> {
    repos.iter().find_map(|path| {
        let repo = Repo::open(path, registry).ok()?;
        let binding = repo.remote_binding().ok()??;
        let bound = Instance::parse(&binding.instance).ok()?;
        if binding.repo != hub_repo || bound != *instance {
            return None;
        }
        let main_rel = repo.sets().ok()?.get(set_id)?.clone();
        Some(Home {
            repo: repo.root().to_path_buf(),
            main_rel,
        })
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use dit_core::{CommitKind, RemoteBinding};

    use super::*;

    #[test]
    fn a_name_is_refused_with_the_cores_own_line() {
        assert_eq!(
            check_branch_name("a/b").unwrap_err(),
            "`a/b` is not a usable branch name"
        );
        assert_eq!(check_branch_name("restore-a1b2c3d"), Ok(()));
        assert_eq!(check_branch_name("big drop v2.1"), Ok(()));
    }

    #[test]
    fn main_is_not_a_branch_to_make_in_any_case() {
        for name in ["main", "Main", "MAIN"] {
            assert_eq!(
                check_branch_name(name).unwrap_err(),
                format!("`{name}` is not a usable branch name")
            );
        }
        assert_eq!(check_branch_name("maintain"), Ok(()));
    }

    #[test]
    fn length_edges_and_device_names_are_refused() {
        let refused = [
            "",
            " ",
            ".hidden",
            "trailing.",
            " lead",
            "trail ",
            "con",
            "CON.take",
            "lpt3",
            "COM¹",
            "back\\slash",
            "tab\tname",
            "emoji🎵",
            &"x".repeat(65),
        ];
        for name in refused {
            assert!(check_branch_name(name).is_err(), "{name:?}");
        }
        assert_eq!(check_branch_name(&"x".repeat(64)), Ok(()));
        assert_eq!(check_branch_name("console"), Ok(()));
        assert_eq!(check_branch_name("über_mix"), Ok(()));
    }

    const FIXTURES: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/dit/crates/dit-daw-ableton/fixtures/Contract Fixtures Project"
    );

    /// A repo of one fixture set, bound to hub repo 3 on `instance`.
    fn bound_project(parent: &Path, name: &str, instance: &str, registry: &Registry) -> Repo {
        let project = parent.join(name);
        fs::create_dir_all(&project).unwrap();
        fs::copy(
            Path::new(FIXTURES).join("Empty Set.als"),
            project.join("Empty Set.als"),
        )
        .unwrap();
        let repo = Repo::init(&project, registry.all()[0]).unwrap();
        repo.record_save(&project.join("Empty Set.als")).unwrap();
        repo.bind_remote(&RemoteBinding {
            instance: instance.to_string(),
            repo: 3,
        })
        .unwrap();
        repo
    }

    #[test]
    fn the_check_agrees_with_what_the_core_does_with_each_name() {
        let registry = dit_daws::registry();
        let dir = tempfile::tempdir().unwrap();
        let repo = bound_project(dir.path(), "One Project", "https://hub.test", &registry);
        let set_id = repo.sets().unwrap().into_keys().next().unwrap();
        let table = [
            "restore-a1b2c3d",
            "fix",
            "fix-2",
            "a b",
            "a.b",
            "über",
            "a/b",
            "a\\b",
            "..",
            ".x",
            "x.",
            " x",
            "x ",
            "",
            "con",
            "NUL.txt",
            "com1",
            "LPT\u{b2}",
            "a:b",
            "emoji🎵",
            &"y".repeat(64),
            &"y".repeat(65),
        ];
        for name in table {
            let core_refuses = matches!(
                repo.free_branch_name(&set_id, name),
                Err(RepoError::BadBranchName(_))
            );
            assert_eq!(
                check_branch_name(name).is_err(),
                core_refuses,
                "{name:?}: ours and the core's disagree"
            );
        }
    }

    #[test]
    fn the_field_starts_with_restore_and_seven_hex_digits() {
        assert_eq!(default_branch("a1b2c3d4e5f6"), "restore-a1b2c3d");
        assert_eq!(default_branch("abc"), "restore-abc");
    }

    #[test]
    fn the_file_is_the_main_files_stem_the_branch_and_its_extension() {
        assert_eq!(
            branch_file_name("science123.als", "restore-a1b2"),
            "science123 @restore-a1b2.als"
        );
        assert_eq!(
            branch_file_name("takes/science123.als", "fix"),
            "takes/science123 @fix.als"
        );
        assert_eq!(branch_file_name("song", "fix"), "song @fix");
        let home = Home {
            repo: PathBuf::from("/p"),
            main_rel: "takes/science123.als".to_string(),
        };
        assert_eq!(home.file_for("fix"), "science123 @fix.als");
    }

    #[test]
    fn the_name_the_screen_shows_is_the_file_the_core_writes() {
        let registry = dit_daws::registry();
        let dir = tempfile::tempdir().unwrap();
        let repo = bound_project(dir.path(), "One Project", "https://hub.test", &registry);
        let set_id = repo.sets().unwrap().into_keys().next().unwrap();
        let commit = repo
            .commit(&set_id, "main", "first", "me", CommitKind::User)
            .unwrap();
        let written = repo.checkout_new_branch(&commit, "restore-a1b2").unwrap();
        let home = locate(
            &[dir.path().join("Gone Project"), repo.root().to_path_buf()],
            &registry,
            &Instance::parse("https://hub.test").unwrap(),
            3,
            &set_id,
        )
        .expect("the repo is bound there");
        assert_eq!(
            written.file_name().unwrap().to_string_lossy(),
            home.file_for("restore-a1b2")
        );
    }

    #[test]
    fn a_repo_is_found_only_for_its_own_hub_repo_instance_and_set() {
        let registry = dit_daws::registry();
        let dir = tempfile::tempdir().unwrap();
        let repo = bound_project(dir.path(), "One Project", "https://hub.test", &registry);
        let set_id = repo.sets().unwrap().into_keys().next().unwrap();
        let repos = [repo.root().to_path_buf()];
        let here = Instance::parse("https://hub.test").unwrap();
        let there = Instance::parse("https://other.test").unwrap();

        assert!(locate(&repos, &registry, &here, 3, &set_id).is_some());
        assert!(locate(&repos, &registry, &here, 4, &set_id).is_none());
        assert!(locate(&repos, &registry, &there, 3, &set_id).is_none());
        assert!(locate(&repos, &registry, &here, 3, "nosuchset").is_none());
        assert!(locate(&[], &registry, &here, 3, &set_id).is_none());
    }
}
