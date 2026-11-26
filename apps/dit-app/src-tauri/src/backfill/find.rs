//! Find: the roots the person chose and the project folders found under them, listed as the walk finds them.

use dit_core::RepoList;
use dit_daemon::backfill::{find_projects, project_facts};

use super::*;

impl Backfill {
    /// Replaces the roots to search and searches again.
    pub fn set_roots(self: &Arc<Self>, roots: Vec<String>) -> Result<(), String> {
        let mut wanted: Vec<PathBuf> = Vec::new();
        for root in roots {
            let path = PathBuf::from(root.trim());
            if !path.is_dir() {
                return Err(format!("{} isn't a folder dit can read.", path.display()));
            }
            if !wanted.contains(&path) {
                wanted.push(path);
            }
        }
        self.on_find(|inner| inner.roots = wanted)?;
        self.search();
        Ok(())
    }

    /// Runs `change` when the window is on Find: the roots are not the person's to change on any other step.
    fn on_find(&self, change: impl FnOnce(&mut Inner)) -> Result<(), String> {
        self.update(|inner| {
            if inner.step != view::Step::Find {
                return Err("Go back to Find to change the folders.".to_string());
            }
            change(inner);
            Ok(())
        })
    }

    /// Shows the sets of `folder` on the right.
    pub fn choose(&self, folder: &str) -> Result<(), String> {
        let path = PathBuf::from(folder);
        self.update(|inner| {
            if !inner.knows(&path) {
                return Err("dit doesn't know that folder.".to_string());
            }
            inner.chosen = Some(path);
            Ok(())
        })
    }

    /// Starts a walk under the roots, stopping the one before it, and clears what the last one found.
    fn search(self: &Arc<Self>) {
        let (cancel, epoch, roots) = self.update(|inner| {
            inner.find_cancel.store(true, Ordering::Relaxed);
            let cancel = Arc::new(AtomicBool::new(false));
            inner.find_cancel = cancel.clone();
            inner.find_epoch += 1;
            inner.found.clear();
            inner.set_lists.clear();
            inner.searching = !inner.roots.is_empty();
            (cancel, inner.find_epoch, inner.roots.clone())
        });
        if roots.is_empty() {
            return;
        }
        let backfill = self.clone();
        thread::spawn(move || backfill.walk(&roots, &cancel, epoch));
    }

    /// Walks `roots` for project folders of every DAW dit knows, listing each with its facts as it is found.
    fn walk(&self, roots: &[PathBuf], cancel: &AtomicBool, epoch: u64) {
        let listed = RepoList::load(&self.repos_file).unwrap_or_default();
        for daw in self.registry.all() {
            for root in roots {
                find_projects(root, *daw, cancel, &mut |folder| {
                    let Ok(facts) = project_facts(folder, *daw, &listed) else {
                        return;
                    };
                    self.update(|inner| {
                        let known = inner.found.iter().any(|found| found.path == facts.path);
                        if inner.find_epoch == epoch && !known {
                            inner.found.push(facts);
                        }
                    });
                });
            }
        }
        self.update(|inner| {
            if inner.find_epoch == epoch {
                inner.searching = false;
            }
        });
    }

    /// The facts of a run folder read from disk outside the state lock, or empty facts when the folder is gone.
    pub(super) fn read_project_facts(&self, path: &Path) -> ProjectFacts {
        self.registry
            .for_project_folder(path)
            .and_then(|daw| project_facts(path, daw, &RepoList::default()).ok())
            .map(|facts| ProjectFacts {
                already: false,
                ..facts
            })
            .unwrap_or_else(|| ProjectFacts {
                path: path.to_path_buf(),
                sets: 0,
                bytes: 0,
                newest: None,
                already: false,
                synced_by: None,
            })
    }

    /// The sets of `folder` with their `Backup/` copy counts, read from disk outside the state lock.
    pub(super) fn read_set_lists(&self, folder: &Path) -> Vec<SetFacts> {
        self.registry
            .for_project_folder(folder)
            .map(|daw| {
                daw.find_sets(folder)
                    .unwrap_or_default()
                    .into_iter()
                    .map(|file| SetFacts {
                        copies: daw.list_backups(&file).map_or(0, |copies| copies.len()),
                        file,
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}
