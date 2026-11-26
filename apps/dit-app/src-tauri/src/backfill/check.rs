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
    project_storage: Vec<ProjectStorage>,
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
            inner.project_storage.clear();
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
            inner.project_storage.clear();
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
        let projects: Vec<i64> = asked.iter().map(&project_of).collect();
        let mut hubs: HashMap<i64, Hub> = HashMap::new();
        for &project in &projects {
            if let std::collections::hash_map::Entry::Vacant(slot) = hubs.entry(project) {
                slot.insert(propose::read(&remote, project).map_err(line)?);
            }
        }
        let assigned = assign_targets(&asked, &projects, &hubs);
        let forces_samples = instance_pushes_samples(&remote).map_err(line)?;
        let by_project = objects_by_project(&asked, &assigned, forces_samples);
        let mut project_storage = Vec::with_capacity(by_project.len());
        for (project, objects) in &by_project {
            let room = storage(&remote, *project, objects).map_err(line)?;
            project_storage.push(ProjectStorage {
                bytes: room.bytes,
                remaining: room.remaining,
            });
        }
        let total = summarise_storage(&project_storage);
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
            project_storage,
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
    /// proposed again. Serialised through `project_lock` so two rapid project changes never overwrite each other.
    pub fn set_project(&self, folder: &str, project: i64) -> Result<(), String> {
        let _serial = lock(&self.project_lock);
        let path = PathBuf::from(folder);
        let epoch = self.update(|inner| {
            if inner.step != view::Step::Check {
                return Err("Projects are chosen when the folders are checked.".to_string());
            }
            if inner.asking {
                return Err("The hub is still being asked. Try again in a moment.".to_string());
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
        inner.project_storage = self.project_storage.clone();
        for assigned in &self.assigned {
            if let Some(entry) = entry_mut(inner, &assigned.folder) {
                entry.project = Some(assigned.project);
                entry.targets = assigned.targets.iter().cloned().collect();
            }
        }
    }
}

/// Proposes targets for every folder in `asked`, applying valid saved corrections while guaranteeing no hub session is
/// claimed by more than one set across all folders.
fn assign_targets(asked: &[Asked], projects: &[i64], hubs: &HashMap<i64, Hub>) -> Vec<Assigned> {
    let mut taken = HashSet::new();
    let accepted: Vec<HashMap<PathBuf, SetTarget>> = asked
        .iter()
        .zip(projects)
        .map(|(item, &project)| {
            let hub = &hubs[&project];
            let mut kept = HashMap::new();
            for set in &item.checked.sets {
                if set.set_id.is_none() {
                    continue;
                }
                let Some(target) = item.corrections.get(&set.file) else {
                    continue;
                };
                if !is_offered(target, hub) {
                    continue;
                }
                if let SetTarget::Session(id) = target
                    && !taken.insert(*id)
                {
                    continue;
                }
                kept.insert(set.file.clone(), target.clone());
            }
            kept
        })
        .collect();

    asked
        .iter()
        .zip(projects)
        .zip(accepted)
        .map(|((item, &project), kept)| {
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
                    let target = kept.get(&file).cloned().unwrap_or(proposal.target);
                    Some((file, target))
                })
                .collect();
            Assigned {
                folder: item.folder.clone(),
                project,
                targets,
            }
        })
        .collect()
}

/// Groups the objects to upload by target project in run order, deduplicating shared object hashes across projects so
/// each unique object is counted once for the first project that uploads it.
fn objects_by_project(
    asked: &[Asked],
    assigned: &[Assigned],
    forces_samples: bool,
) -> Vec<(i64, Vec<(ObjectId, u64)>)> {
    let mut order: Vec<i64> = Vec::new();
    let mut by_project: HashMap<i64, Vec<(ObjectId, u64)>> = HashMap::new();
    let mut seen: HashSet<ObjectId> = HashSet::new();
    for (item, assigned) in asked.iter().zip(assigned) {
        if !by_project.contains_key(&assigned.project) {
            order.push(assigned.project);
        }
        let bucket = by_project.entry(assigned.project).or_default();
        for (id, size) in item.checked.objects_to_send(forces_samples) {
            if seen.insert(id) {
                bucket.push((id, size));
            }
        }
    }
    order
        .into_iter()
        .map(|project| (project, by_project.remove(&project).unwrap_or_default()))
        .collect()
}

/// Summarises per-project storage checks for the window. Each project's own new bytes are compared against its own
/// remaining quota; an overflowing project surfaces its own bytes and room left so the footer matches `canStart`.
fn summarise_storage(per_project: &[ProjectStorage]) -> view::Storage {
    let overflow = per_project
        .iter()
        .filter_map(|room| {
            let left = room.remaining?;
            (room.bytes > left).then_some((room.bytes - left, room))
        })
        .max_by_key(|(deficit, _)| *deficit)
        .map(|(_, room)| room);
    if let Some(room) = overflow {
        return view::Storage {
            bytes: room.bytes,
            remaining: room.remaining,
        };
    }
    let bytes = per_project
        .iter()
        .fold(0u64, |sum, room| sum.saturating_add(room.bytes));
    let remaining =
        if per_project.is_empty() || per_project.iter().any(|room| room.remaining.is_none()) {
            None
        } else {
            Some(
                per_project
                    .iter()
                    .filter_map(|room| room.remaining)
                    .fold(0u64, u64::saturating_add),
            )
        };
    view::Storage { bytes, remaining }
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
    let over_quota = if inner.project_storage.is_empty() {
        storage.remaining.is_some_and(|left| storage.bytes > left)
    } else {
        inner
            .project_storage
            .iter()
            .any(|room| room.remaining.is_some_and(|left| room.bytes > left))
    };
    if over_quota {
        return Err("The folders need more storage than is left. Untick some.".to_string());
    }
    let mut sessions = HashSet::new();
    for entry in &inner.entries {
        if entry.checked().is_none() {
            continue;
        }
        for target in entry.targets.values() {
            if let SetTarget::Session(id) = target
                && !sessions.insert(*id)
            {
                return Err("Two sets are matched to the same session.".to_string());
            }
        }
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

#[cfg(test)]
mod tests {
    use dit_core::{ObjectId, ObjectKind};
    use dit_daemon::backfill::propose::Candidate;
    use dit_daemon::backfill::run::CheckedSet;

    use super::*;

    fn obj(seed: &[u8]) -> ObjectId {
        ObjectId::of(ObjectKind::Blob, seed)
    }

    fn checked_set(id: &str, file: &str) -> CheckedSet {
        CheckedSet {
            file: PathBuf::from(file),
            set_id: Some(id.to_string()),
            saves: 1,
            copies: 0,
            fingerprints: Vec::new(),
            doubt: None,
        }
    }

    fn asked_folder(
        folder: &str,
        sets: Vec<CheckedSet>,
        objects: Vec<(ObjectId, u64)>,
        corrections: HashMap<PathBuf, SetTarget>,
    ) -> Asked {
        Asked {
            folder: PathBuf::from(folder),
            checked: Checked {
                path: PathBuf::from(folder),
                created_dit: true,
                sets,
                objects,
                samples: Vec::new(),
                pushes_samples: false,
            },
            project: Some(4),
            corrections,
        }
    }

    #[test]
    fn reapplying_saved_corrections_never_lets_two_sets_claim_the_same_session() {
        let mut hubs = HashMap::new();
        hubs.insert(
            4,
            Hub {
                sessions: vec![Candidate {
                    id: 812,
                    name: "science123".to_string(),
                    track_id: None,
                    track_title: None,
                    local_filepath: Some("/m/b Project/b.als".to_string()),
                    fingerprints: Vec::new(),
                    last_save_at: None,
                }],
                tracks: Vec::new(),
            },
        );
        // Folder A's saved correction claims session 812, which Folder B would also auto-match (or claim).
        let mut corr_a = HashMap::new();
        corr_a.insert(PathBuf::from("/m/a Project/a.als"), SetTarget::Session(812));
        let mut corr_b = HashMap::new();
        corr_b.insert(PathBuf::from("/m/b Project/b.als"), SetTarget::Session(812));

        let asked = vec![
            asked_folder(
                "/m/a Project",
                vec![checked_set("s1", "/m/a Project/a.als")],
                Vec::new(),
                corr_a,
            ),
            asked_folder(
                "/m/b Project",
                vec![checked_set("s2", "/m/b Project/b.als")],
                Vec::new(),
                corr_b,
            ),
        ];

        let assigned = assign_targets(&asked, &[4, 4], &hubs);
        let session_claims: Vec<i64> = assigned
            .iter()
            .flat_map(|item| item.targets.iter())
            .filter_map(|(_, target)| match target {
                SetTarget::Session(id) => Some(*id),
                _ => None,
            })
            .collect();
        assert_eq!(session_claims, [812]);
        assert_eq!(assigned[0].targets[0].1, SetTarget::Session(812));
        assert_ne!(assigned[1].targets[0].1, SetTarget::Session(812));
    }

    #[test]
    fn multi_project_objects_deduplicate_shared_hashes_across_projects() {
        let shared = obj(b"shared");
        let only_a = obj(b"only-a");
        let only_b = obj(b"only-b");
        let asked = vec![
            asked_folder(
                "/m/a Project",
                Vec::new(),
                vec![(only_a, 100), (shared, 200)],
                HashMap::new(),
            ),
            asked_folder(
                "/m/b Project",
                Vec::new(),
                vec![(shared, 200), (only_b, 300)],
                HashMap::new(),
            ),
        ];
        let assigned = vec![
            Assigned {
                folder: PathBuf::from("/m/a Project"),
                project: 4,
                targets: Vec::new(),
            },
            Assigned {
                folder: PathBuf::from("/m/b Project"),
                project: 9,
                targets: Vec::new(),
            },
        ];

        let grouped = objects_by_project(&asked, &assigned, false);
        assert_eq!(
            grouped,
            vec![
                (4, vec![(only_a, 100), (shared, 200)]),
                (9, vec![(only_b, 300)]),
            ]
        );
    }

    #[test]
    fn multi_project_storage_compares_each_project_against_its_own_remaining_quota() {
        // Two projects each fitting their own 600-byte cap must not fail just because 400 + 400 > min(600, 600).
        let both_fit = vec![
            ProjectStorage {
                bytes: 400,
                remaining: Some(600),
            },
            ProjectStorage {
                bytes: 400,
                remaining: Some(600),
            },
        ];
        assert_eq!(
            summarise_storage(&both_fit),
            view::Storage {
                bytes: 800,
                remaining: Some(1200),
            }
        );

        // One project exceeding its own cap surfaces that deficit even when the other has plenty of room.
        let one_over = vec![
            ProjectStorage {
                bytes: 100,
                remaining: Some(1000),
            },
            ProjectStorage {
                bytes: 600,
                remaining: Some(500),
            },
        ];
        assert_eq!(
            summarise_storage(&one_over),
            view::Storage {
                bytes: 600,
                remaining: Some(500),
            }
        );
    }
}
