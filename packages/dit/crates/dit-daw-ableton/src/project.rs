//! Recognising a Live project folder and finding the sets in it.

use std::ffi::OsStr;
use std::io;
use std::path::{Path, PathBuf};

const PROJECT_FOLDER_SUFFIX: &str = " project";

/// Live wraps a project in a folder named "<title> Project".
pub(crate) fn is_project_folder(dir: &Path) -> bool {
    dir.is_dir()
        && dir
            .file_name()
            .and_then(OsStr::to_str)
            .is_some_and(|name| name.to_lowercase().ends_with(PROJECT_FOLDER_SUFFIX))
}

/// The `.als` files directly inside `project`, sorted by path. `Backup/` copies are not sets, so
/// nothing below the top level counts, and neither does a hidden file (macOS writes `._<name>.als`
/// metadata files on some drives).
pub(crate) fn find_sets(project: &Path) -> io::Result<Vec<PathBuf>> {
    let mut sets = Vec::new();
    for entry in std::fs::read_dir(project)? {
        let entry = entry?;
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let path = entry.path();
        let is_set = path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("als"));
        if is_set && path.is_file() {
            sets.push(path);
        }
    }
    sets.sort();
    Ok(sets)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_directory_named_project_is_a_project_folder_in_any_case() {
        for name in ["Song Project", "song project", "SONG PROJECT"] {
            let root = tempfile::tempdir().unwrap();
            let dir = root.path().join(name);
            std::fs::create_dir(&dir).unwrap();
            assert!(is_project_folder(&dir), "{name}");
        }
    }

    #[test]
    fn other_names_and_plain_files_are_not_project_folders() {
        let root = tempfile::tempdir().unwrap();
        let other = root.path().join("Song");
        std::fs::create_dir(&other).unwrap();
        let file = root.path().join("Song Project");
        std::fs::write(&file, b"").unwrap();
        assert!(!is_project_folder(&other));
        assert!(!is_project_folder(&file));
        assert!(!is_project_folder(&root.path().join("Missing Project")));
    }

    #[test]
    fn find_sets_returns_sorted_als_files_directly_inside_the_project() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path();
        for name in ["b.als", "A.ALS", "notes.txt", "c.als.bak", "._b.als"] {
            std::fs::write(project.join(name), b"").unwrap();
        }
        std::fs::create_dir(project.join("Backup")).unwrap();
        std::fs::write(project.join("Backup").join("old.als"), b"").unwrap();
        std::fs::create_dir(project.join("folder.als")).unwrap();

        let sets = find_sets(project).unwrap();
        assert_eq!(sets, [project.join("A.ALS"), project.join("b.als")]);
    }

    #[test]
    fn find_sets_errors_on_a_missing_folder() {
        let root = tempfile::tempdir().unwrap();
        assert!(find_sets(&root.path().join("Gone Project")).is_err());
    }
}
