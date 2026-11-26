//! Finding repos at launch: the DAW's own list of project folders searched for `.dit/` folders that existed before
//! the app ran.

use std::fs;
use std::path::{Path, PathBuf};

/// How far below a root a repo is looked for: `Ableton/<collection>/<project>/` is two, one more is slack.
pub const DEPTH: usize = 3;

fn skipped(name: &str, managed: &[&str]) -> bool {
    name.starts_with('.') || managed.contains(&name) || name == "node_modules"
}

/// The project folders at most [`DEPTH`] levels under `root` that hold `.dit/config.toml`. A folder that is a
/// repo is not searched inside; hidden folders and the DAW's managed subfolders (`managed`) never are.
pub fn find_repos(root: &Path, managed: &[&str]) -> Vec<PathBuf> {
    let mut found = Vec::new();
    search(root, DEPTH, managed, &mut found);
    found.sort();
    found
}

fn search(dir: &Path, depth: usize, managed: &[&str], found: &mut Vec<PathBuf>) {
    if dir.join(".dit").join("config.toml").is_file() {
        found.push(dir.to_path_buf());
        return;
    }
    if depth == 0 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if skipped(name, managed) || !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        search(&entry.path(), depth - 1, managed, found);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(path: &Path) {
        fs::create_dir_all(path.join(".dit")).unwrap();
        fs::write(path.join(".dit/config.toml"), "daw = \"fake\"\n").unwrap();
    }

    #[test]
    fn repos_are_found_to_depth_three_and_not_inside_each_other() {
        let root = tempfile::tempdir().unwrap();
        let base = root.path();
        repo(&base.join("30 covers/yes Project"));
        repo(&base.join("a Project"));
        repo(&base.join("x/y/z Project"));
        repo(&base.join("x/y/z/too deep Project"));
        repo(&base.join("a Project/Samples/nested Project"));
        repo(&base.join(".hidden/h Project"));
        fs::create_dir_all(base.join("plain/folder")).unwrap();

        let found: Vec<_> = find_repos(base, &["Samples"])
            .into_iter()
            .map(|path| path.strip_prefix(base).unwrap().display().to_string())
            .collect();

        assert_eq!(
            found,
            ["30 covers/yes Project", "a Project", "x/y/z Project"]
        );
    }

    #[test]
    fn a_missing_root_finds_nothing() {
        assert!(find_repos(Path::new("/does/not/exist"), &[]).is_empty());
    }
}
