//! The repos the dit app watches: `repos.toml` beside the user config (`~/Library/Application Support/dit/repos.toml`
//! on macOS). The cli's `dit init` adds the repo it makes; the app reads the list at launch, catches each repo up and
//! watches it, and adds the folders a producer adopts or declines.
//!
//! Two processes read-modify-write the file, so every change goes through [`RepoList::update`], which holds a lock
//! file for the read, the change and the write.

use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::remote::{RemoteError, UserConfig};

const FILE: &str = "repos.toml";

/// Folders dit tracks and folders the producer told it not to.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepoList {
    /// The project folders with a `.dit/` the app watches.
    #[serde(default)]
    pub repos: Vec<PathBuf>,
    /// Project folders the producer declined to track: the adopt offer is not made for them again.
    #[serde(default)]
    pub declined: Vec<PathBuf>,
    /// Whether the DAW's own folder list has been searched for repos that existed before the app ran.
    #[serde(default)]
    pub bootstrapped: bool,
}

fn error(path: &Path, reason: impl std::fmt::Display) -> RemoteError {
    RemoteError::Config {
        path: path.display().to_string(),
        reason: reason.to_string(),
    }
}

impl RepoList {
    /// `repos.toml` in the folder of the default user config.
    pub fn default_path() -> Result<PathBuf, RemoteError> {
        let config = UserConfig::default_path()?;
        Ok(config.with_file_name(FILE))
    }

    /// The list at `path`; an empty one when there is no file yet.
    pub fn load(path: &Path) -> Result<Self, RemoteError> {
        match fs::read_to_string(path) {
            Ok(text) => toml::from_str(&text).map_err(|e| error(path, e)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(error(path, e)),
        }
    }

    /// Reads the list, lets `change` edit it and writes it back, all under the list's lock file, so two processes
    /// never lose each other's change. Returns what `change` returns.
    pub fn update<T>(
        path: &Path,
        change: impl FnOnce(&mut RepoList) -> T,
    ) -> Result<T, RemoteError> {
        let folder = path.parent().ok_or_else(|| error(path, "no folder"))?;
        fs::create_dir_all(folder).map_err(|e| error(path, e))?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(path.with_extension("lock"))
            .map_err(|e| error(path, e))?;
        lock.lock().map_err(|e| error(path, e))?;
        let mut list = Self::load(path)?;
        let out = change(&mut list);
        let text = toml::to_string(&list).map_err(|e| error(path, e))?;
        crate::atomic::write(path, text.as_bytes()).map_err(|e| error(path, e))?;
        Ok(out)
    }

    /// Adds a repo, and forgets any decline of its folder. False when it was there.
    pub fn add(&mut self, repo: &Path) -> bool {
        self.declined.retain(|folder| folder != repo);
        if self.repos.iter().any(|held| held == repo) {
            return false;
        }
        self.repos.push(repo.to_path_buf());
        true
    }

    /// Records that `folder` is not to be offered for tracking again.
    pub fn decline(&mut self, folder: &Path) {
        if !self.is_declined(folder) {
            self.declined.push(folder.to_path_buf());
        }
    }

    pub fn is_declined(&self, folder: &Path) -> bool {
        self.declined.iter().any(|held| held == folder)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_file_is_an_empty_list_and_an_update_creates_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("dit/repos.toml");
        assert_eq!(RepoList::load(&path).unwrap(), RepoList::default());

        let added = RepoList::update(&path, |list| list.add(Path::new("/p/A Project"))).unwrap();

        assert!(added);
        let list = RepoList::load(&path).unwrap();
        assert_eq!(list.repos, [PathBuf::from("/p/A Project")]);
        assert!(!list.bootstrapped);
    }

    #[test]
    fn adding_twice_keeps_one_and_adding_a_declined_folder_undeclines_it() {
        let mut list = RepoList::default();
        list.decline(Path::new("/p/A Project"));
        list.decline(Path::new("/p/A Project"));
        assert_eq!(list.declined.len(), 1);

        assert!(list.add(Path::new("/p/A Project")));
        assert!(!list.add(Path::new("/p/A Project")));

        assert_eq!(list.repos.len(), 1);
        assert!(!list.is_declined(Path::new("/p/A Project")));
    }

    #[test]
    fn two_threads_updating_the_list_lose_neither_change() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("repos.toml");
        let threads: Vec<_> = (0..8)
            .map(|n| {
                let path = path.clone();
                std::thread::spawn(move || {
                    RepoList::update(&path, |list| {
                        list.add(Path::new(&format!("/p/{n} Project")))
                    })
                    .unwrap();
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        assert_eq!(RepoList::load(&path).unwrap().repos.len(), 8);
    }

    #[test]
    fn a_file_that_is_not_toml_is_a_config_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("repos.toml");
        fs::write(&path, "repos = [").unwrap();
        assert!(matches!(
            RepoList::load(&path),
            Err(RemoteError::Config { .. })
        ));
    }
}
