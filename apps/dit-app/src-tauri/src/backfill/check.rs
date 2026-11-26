//! Check: reading the ticked folders' sets into their `.dit/`, asking the hub where each set could go and what the
//! folders would add to storage, and the changes the person makes to the proposals.

use std::collections::HashSet;

use dit_core::ObjectId;
use dit_daemon::backfill::propose::{self, Hub};
use dit_daemon::backfill::run::instance_pushes_samples;
use dit_daemon::backfill::{CheckError, FolderPlan, SetPlan, check as read_folder, storage};
use serde::Deserialize;

use super::*;

/// A project of the account.
#[derive(Deserialize)]
struct Mine {
    id: i64,
    name: String,
    role: String,
}

impl Mine {
    /// Whether the account may put sessions into the project: the hub's storage check and every write need an
    /// editor.
    fn can_edit(&self) -> bool {
        matches!(self.role.as_str(), "owner" | "admin" | "editor")
    }
}

/// What the hub answered Check, to be taken into the entries together once it is all in.
struct Assessed {
    projects: Vec<view::Project>,
    hubs: HashMap<i64, Hub>,
    assigned: Vec<Assigned>,
    storage: view::Storage,
}

/// Where one folder goes, with where each of its sets goes in the order of the sets.
struct Assigned {
    folder: PathBuf,
    project: i64,
    targets: Vec<(PathBuf, SetTarget)>,
}

/// What Check needs of an entry while the hub is asked, which the entries' lock is not held for.
struct Asked {
    folder: PathBuf,
    checked: Checked,
    project: Option<i64>,
    corrections: HashMap<PathBuf, SetTarget>,
}

impl Backfill {
    /// Next: reads the sets of `folders` and asks the hub. A folder Check already read is not read again; a Check
    /// asked again for the same folders is "Try again" for a hub that did not answer.
    pub fn check(self: &Arc<Self>, folders: Vec<String>) -> Result<(), String> {
        let _step = lock(&self.transition);
        let wanted: Vec<PathBuf> = folders.iter().map(PathBuf::from).collect();
        let dropped = self.update(|inner| -> Result<Vec<PathBuf>, String> {
            if !matches!(inner.step, view::Step::Find | view::Step::Check) {
                return Err("A run is going. Pause it first.".to_string());
            }
            if wanted.is_empty() {
                return Err("Tick at least one folder.".to_string());
            }
            let mut chosen = Vec::with_capacity(wanted.len());
            for path in &wanted {
                let facts = inner
                    .found
                    .iter()
                    .find(|facts| &facts.path == path)
                    .ok_or_else(|| "dit doesn't know that folder.".to_string())?;
                if facts.already {
                    return Err(format!("{} is in dit already.", view::name_of(&facts.path)));
                }
                chosen.push(facts.clone());
            }
            // Newest first, the order the run takes the folders in.
            chosen.sort_by(|a, b| b.newest.cmp(&a.newest).then_with(|| a.path.cmp(&b.path)));
            inner.check_cancel.store(true, Ordering::Relaxed);
            inner.check_cancel = Arc::new(AtomicBool::new(false));
            inner.epoch += 1;
            inner.asking = false;
            inner.storage = None;
            inner.hub_error = None;
            inner.step = view::Step::Check;
            let mut old = std::mem::take(&mut inner.entries);
            inner.entries = chosen
                .into_iter()
                .map(
                    |facts| match old.iter().position(|e| e.facts.path == facts.path) {
                        Some(at) => {
                            let mut entry = old.swap_remove(at);
                            entry.facts = facts;
                            entry
                        }
                        None => Entry {
                            facts,
                            created: false,
                            outcome: Outcome::Pending,
                            project: None,
                            targets: HashMap::new(),
                        },
                    },
                )
                .collect();
            for entry in &mut inner.entries {
                if !matches!(entry.outcome, Outcome::Checked(_)) {
                    entry.outcome = Outcome::Pending;
                }
            }
            Ok(old
                .into_iter()
                .filter(|entry| entry.created)
                .map(|entry| entry.facts.path)
                .collect())
        })?;
        self.remove(dropped);
        let (epoch, cancel, order) = {
            let inner = lock(&self.inner);
            let order: Vec<PathBuf> = inner
                .entries
                .iter()
                .filter(|entry| matches!(entry.outcome, Outcome::Pending))
                .map(|entry| entry.facts.path.clone())
                .collect();
            (inner.epoch, inner.check_cancel.clone(), order)
        };
        let backfill = self.clone();
        let handle = thread::spawn(move || backfill.read_folders(&order, epoch, &cancel));
        *lock(&self.checker) = Some(handle);
        Ok(())
    }

    /// Reads each folder in turn, then asks the hub; stops quietly when Check was dropped meanwhile.
    fn read_folders(&self, order: &[PathBuf], epoch: u64, cancel: &AtomicBool) {
        for folder in order {
            if cancel.load(Ordering::Relaxed) {
                return;
            }
            let existed = folder.join(".dit").exists();
            let current = self.update_if(epoch, |inner| {
                if let Some(entry) = entry_mut(inner, folder) {
                    entry.created |= !existed;
                    entry.outcome = Outcome::Reading { read: 0, of: 0 };
                }
            });
            if !current {
                return;
            }
            let result = read_folder(&self.recorder, folder, cancel, &mut |read, of| {
                self.update_if(epoch, |inner| {
                    if let Some(entry) = entry_mut(inner, folder) {
                        entry.outcome = Outcome::Reading { read, of };
                    }
                });
            });
            let outcome = match result {
                Ok(checked) => Outcome::Checked(checked),
                Err(CheckError::Cancelled) => return,
                Err(CheckError::Failed(message)) => Outcome::Failed(message),
            };
            self.update_if(epoch, |inner| {
                if let Some(entry) = entry_mut(inner, folder) {
                    entry.outcome = outcome;
                }
            });
        }
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        self.ask_hub(epoch);
    }

    /// Asks the hub for the account's projects, each folder's project's sessions and tracks, and what the folders
    /// would add to storage, and takes the proposals into the entries. A hub that does not answer leaves the line
    /// that says so, and Start off.
    fn ask_hub(&self, epoch: u64) {
        self.update_if(epoch, |inner| {
            inner.asking = true;
            inner.hub_error = None;
            inner.storage = None;
        });
        let result = self.read_hub(epoch, None);
        self.update_if(epoch, |inner| {
            inner.asking = false;
            match result {
                Ok(Some(assessed)) => assessed.apply(inner),
                Ok(None) => {}
                Err(line) => inner.hub_error = Some(line),
            }
        });
    }

    /// The hub's answers for every checked folder; `None` when Check was dropped meanwhile. With `moved`, that folder
    /// goes into the project named and is proposed again from nothing: its corrections were for another project.
    fn read_hub(
        &self,
        epoch: u64,
        moved: Option<(&Path, i64)>,
    ) -> Result<Option<Assessed>, String> {
        let line = |error: RemoteError| self.hub_line(&error);
        let remote = self.host.remote().map_err(line)?;
        let mut mine: Vec<Mine> = remote.get("/me/projects").map_err(line)?;
        mine.retain(Mine::can_edit);
        if mine.is_empty() {
            let host = self.host.host().unwrap_or_else(|| "the hub".to_string());
            return Err(format!(
                "You're not an editor of a project on {host} yet. Make one there, or ask for edit access, then try again."
            ));
        }
        let asked: Vec<Asked> = {
            let inner = lock(&self.inner);
            if inner.epoch != epoch {
                return Ok(None);
            }
            inner
                .entries
                .iter()
                .filter_map(|entry| {
                    let checked = entry.checked()?.clone();
                    let correction = inner.corrections.get(&entry.facts.path);
                    let forced = moved.filter(|(folder, _)| *folder == entry.facts.path);
                    Some(Asked {
                        folder: entry.facts.path.clone(),
                        checked,
                        project: forced
                            .map(|(_, project)| project)
                            .or_else(|| correction.and_then(|c| c.project))
                            .or(entry.project),
                        corrections: if forced.is_some() {
                            HashMap::new()
                        } else {
                            correction.map(|c| c.targets.clone()).unwrap_or_default()
                        },
                    })
                })
                .collect()
        };
        let default = self
            .engine
            .last_project()
            .map_err(|error| error.to_string())?
            .filter(|id| mine.iter().any(|project| project.id == *id))
            .unwrap_or(mine[0].id);
        let project_of = |asked: &Asked| {
            asked
                .project
                .filter(|id| mine.iter().any(|project| project.id == *id))
                .unwrap_or(default)
        };
        let mut hubs: HashMap<i64, Hub> = HashMap::new();
        for item in &asked {
            let project = project_of(item);
            if let std::collections::hash_map::Entry::Vacant(slot) = hubs.entry(project) {
                slot.insert(propose::read(&remote, project).map_err(line)?);
            }
        }
        let mut taken = HashSet::new();
        let assigned: Vec<Assigned> = asked
            .iter()
            .map(|item| {
                let project = project_of(item);
                let hub = &hubs[&project];
                let targets = propose::propose(hub, &item.checked, &mut taken)
                    .into_iter()
                    .filter_map(|proposal| {
                        let file = item
                            .checked
                            .sets
                            .iter()
                            .find(|set| set.set_id.as_deref() == Some(proposal.set_id.as_str()))?
                            .file
                            .clone();
                        let target = item
                            .corrections
                            .get(&file)
                            .filter(|target| is_offered(target, hub))
                            .cloned()
                            .unwrap_or(proposal.target);
                        Some((file, target))
                    })
                    .collect();
                Assigned {
                    folder: item.folder.clone(),
                    project,
                    targets,
                }
            })
            .collect();
        let forces_samples = instance_pushes_samples(&remote).map_err(line)?;
        let mut objects: HashMap<i64, Vec<(ObjectId, u64)>> = HashMap::new();
        for (item, assigned) in asked.iter().zip(&assigned) {
            objects
                .entry(assigned.project)
                .or_default()
                .extend(item.checked.objects_to_send(forces_samples));
        }
        let mut total = view::Storage {
            bytes: 0,
            remaining: None,
        };
        for (project, objects) in &objects {
            let room = storage(&remote, *project, objects).map_err(line)?;
            total.bytes += room.bytes;
            total.remaining = match (total.remaining, room.remaining) {
                (Some(a), Some(b)) => Some(a.min(b)),
                (a, b) => a.or(b),
            };
        }
        Ok(Some(Assessed {
            projects: mine
                .into_iter()
                .map(|project| view::Project {
                    id: project.id,
                    name: project.name,
                })
                .collect(),
            hubs,
            assigned,
            storage: total,
        }))
    }

    /// The line that says why the hub could not be asked.
    fn hub_line(&self, error: &RemoteError) -> String {
        match error {
            RemoteError::Unreachable { host, .. } | RemoteError::TimedOut { host } => {
                format!("Can't reach {host} to check your sessions.")
            }
            other => other.to_string(),
        }
    }

    /// Moves a folder into another project: that project's sessions and tracks are read and the folder's sets
    /// proposed again.
    pub fn set_project(&self, folder: &str, project: i64) -> Result<(), String> {
        let path = PathBuf::from(folder);
        let epoch = self.update(|inner| {
            if inner.step != view::Step::Check {
                return Err("Projects are chosen when the folders are checked.".to_string());
            }
            if !inner.projects.iter().any(|mine| mine.id == project) {
                return Err("That project isn't one of yours.".to_string());
            }
            if !inner
                .entries
                .iter()
                .any(|entry| entry.facts.path == path && entry.checked().is_some())
            {
                return Err("That folder hasn't been read.".to_string());
            }
            inner.asking = true;
            Ok(inner.epoch)
        })?;
        let result = self.read_hub(epoch, Some((&path, project)));
        self.update_if(epoch, |inner| {
            inner.asking = false;
            if let Ok(Some(assessed)) = &result {
                inner.corrections.insert(
                    path.clone(),
                    Correction {
                        project: Some(project),
                        targets: HashMap::new(),
                    },
                );
                assessed.apply(inner);
            }
        });
        result.map(|_| ())
    }

    /// Changes where one set of `folder` goes. A session is matched to at most one set.
    pub fn set_target(&self, folder: &str, file: &str, target: &Target) -> Result<(), String> {
        let (folder, file) = (PathBuf::from(folder), PathBuf::from(file));
        let target = match SetTarget::from(target) {
            SetTarget::NewTrack(name) if name.trim().is_empty() => {
                return Err("Name the new track.".to_string());
            }
            SetTarget::NewTrack(name) => SetTarget::NewTrack(name.trim().to_string()),
            other => other,
        };
        self.update(|inner| {
            if inner.step != view::Step::Check {
                return Err("Sets are matched when the folders are checked.".to_string());
            }
            if inner.asking {
                return Err("The hub is still being asked. Try again in a moment.".to_string());
            }
            let entry = inner
                .entries
                .iter()
                .find(|entry| entry.facts.path == folder)
                .ok_or("dit doesn't know that folder.")?;
            let recorded = entry.checked().is_some_and(|checked| {
                checked
                    .sets
                    .iter()
                    .any(|set| set.file == file && set.set_id.is_some())
            });
            if !recorded {
                return Err("dit couldn't read that set, so it can't be placed.".to_string());
            }
            let hub = entry.project.and_then(|project| inner.hubs.get(&project));
            match &target {
                SetTarget::Session(id) => {
                    if !hub.is_some_and(|hub| hub.sessions.iter().any(|s| s.id == *id)) {
                        return Err("That session isn't free to match any more.".to_string());
                    }
                    let taken = inner.entries.iter().any(|other| {
                        other.targets.iter().any(|(other_file, other_target)| {
                            other_target == &target
                                && !(other.facts.path == folder && other_file == &file)
                        })
                    });
                    if taken {
                        return Err("That session is matched to another set already.".to_string());
                    }
                }
                SetTarget::Track(id) => {
                    if !hub.is_some_and(|hub| hub.tracks.iter().any(|t| t.id == *id)) {
                        return Err("That track isn't in the project.".to_string());
                    }
                }
                SetTarget::NewTrack(_) => {}
            }
            if let Some(entry) = entry_mut(inner, &folder) {
                entry.targets.insert(file.clone(), target.clone());
            }
            inner
                .corrections
                .entry(folder.clone())
                .or_default()
                .targets
                .insert(file.clone(), target.clone());
            Ok(())
        })
    }
}

impl Assessed {
    /// Takes the answers into the entries and the window's lists.
    fn apply(&self, inner: &mut Inner) {
        inner.projects = self.projects.clone();
        inner.hubs.extend(self.hubs.clone());
        inner.storage = Some(self.storage);
        for assigned in &self.assigned {
            if let Some(entry) = entry_mut(inner, &assigned.folder) {
                entry.project = Some(assigned.project);
                entry.targets = assigned.targets.iter().cloned().collect();
            }
        }
    }
}

fn entry_mut<'a>(inner: &'a mut Inner, folder: &Path) -> Option<&'a mut Entry> {
    inner
        .entries
        .iter_mut()
        .find(|entry| entry.facts.path == folder)
}

/// Whether the hub still offers what `target` names: a session no repo holds, a track of the project.
fn is_offered(target: &SetTarget, hub: &Hub) -> bool {
    match target {
        SetTarget::Session(id) => hub.sessions.iter().any(|session| session.id == *id),
        SetTarget::Track(id) => hub.tracks.iter().any(|track| track.id == *id),
        SetTarget::NewTrack(_) => true,
    }
}

/// Where a set that has no session of its own goes: the daemon's answer for a folder's new sessions, given the
/// `targets` its other sets go to and the project's `hub` (empty when the project is not read yet).
fn folder_track<'a>(
    hub: Option<&Hub>,
    folder: &Path,
    targets: impl IntoIterator<Item = &'a SetTarget>,
) -> SetTarget {
    let empty = Hub::default();
    let hub = hub.unwrap_or(&empty);
    let matched = targets.into_iter().filter_map(|target| match target {
        SetTarget::Session(id) => hub.sessions.iter().find(|s| s.id == *id)?.track_id,
        SetTarget::Track(id) => Some(*id),
        SetTarget::NewTrack(_) => None,
    });
    propose::new_session_track(&hub.tracks, folder, matched)
}

/// Puts a new session in place of each session of `folder`'s sets the hub no longer lists as free (another run took
/// it): what "Try again" proposes.
pub(super) fn free_sessions(folder: &mut FolderPlan, hub: &Hub) {
    let others: Vec<SetTarget> = folder.sets.iter().map(|set| set.target.clone()).collect();
    let path = folder.path.clone();
    for set in &mut folder.sets {
        if let SetTarget::Session(id) = set.target
            && !hub.sessions.iter().any(|session| session.id == id)
        {
            set.target = folder_track(Some(hub), &path, &others);
        }
    }
}

/// Whether Start may be pressed, or the line that says why not.
pub(super) fn ready(inner: &Inner) -> Result<(), String> {
    if inner.step != view::Step::Check {
        return Err("There is nothing to start.".to_string());
    }
    if inner
        .entries
        .iter()
        .any(|entry| matches!(entry.outcome, Outcome::Pending | Outcome::Reading { .. }))
    {
        return Err("dit is still reading the sets.".to_string());
    }
    if inner.asking {
        return Err("dit is still asking the hub.".to_string());
    }
    if let Some(line) = &inner.hub_error {
        return Err(line.clone());
    }
    let Some(storage) = inner.storage else {
        return Err("dit hasn't checked the storage yet.".to_string());
    };
    if storage.remaining.is_some_and(|left| storage.bytes > left) {
        return Err("The folders need more storage than is left. Untick some.".to_string());
    }
    let any_set = inner.entries.iter().any(|entry| {
        entry.project.is_some()
            && entry
                .checked()
                .is_some_and(|checked| checked.sets.iter().any(|set| set.set_id.is_some()))
    });
    if !any_set {
        return Err("There are no sets to bring in.".to_string());
    }
    Ok(())
}

/// What Start presses: the checked folders as the run's plan, newest first, each set going where the window says;
/// and the folders Check made a `.dit/` in that are left out because none of their sets could be recorded.
pub(super) fn plan_of(inner: &Inner) -> Result<(Plan, Vec<PathBuf>), String> {
    ready(inner)?;
    let mut folders = Vec::new();
    let mut left_out = Vec::new();
    for entry in &inner.entries {
        let planned = entry
            .project
            .zip(entry.checked())
            .and_then(|(project, checked)| {
                let sets: Vec<SetPlan> = checked
                    .sets
                    .iter()
                    .filter_map(|set| {
                        let set_id = set.set_id.clone()?;
                        let target = entry.targets.get(&set.file).cloned().unwrap_or_else(|| {
                            folder_track(
                                entry.project.and_then(|project| inner.hubs.get(&project)),
                                &checked.path,
                                entry.targets.values(),
                            )
                        });
                        Some(SetPlan {
                            set_id,
                            file: set.file.clone(),
                            target,
                        })
                    })
                    .collect();
                (!sets.is_empty()).then(|| FolderPlan {
                    path: checked.path.clone(),
                    project_id: project,
                    created_dit: entry.created,
                    sets,
                })
            });
        match planned {
            Some(folder) => folders.push(folder),
            None if entry.created => left_out.push(entry.facts.path.clone()),
            None => {}
        }
    }
    Ok((Plan { folders }, left_out))
}
