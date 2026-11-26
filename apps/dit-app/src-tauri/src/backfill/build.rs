//! The window's view of the state: what each step lists on the left and what the chosen folder shows on the right.

use dit_core::RepoList;
use dit_daemon::backfill::{Doubt, ProjectFacts, project_facts};

use super::check::ready;
use super::view::{
    Chosen, Folder, FolderDoubt, FolderView, Match, Run, Session, Set, SetDoubt, SetDoubtKind,
    Step, Totalled, Track, display, name_of,
};
use super::*;

/// The whole of what the window shows now.
pub(super) fn build(backfill: &Backfill, inner: &mut Inner) -> View {
    let folders = rows(backfill, inner);
    // The window keeps a folder on the right whenever it lists any: the one chosen if it is still listed.
    let chosen_path = inner
        .chosen
        .clone()
        .filter(|path| folders.iter().any(|row| Path::new(&row.path) == path))
        .or_else(|| folders.first().map(|row| PathBuf::from(&row.path)));
    let chosen = chosen_path.map(|path| chosen(backfill, inner, &path));
    let run = inner.run.as_ref().map(Run::from);
    let summary = inner
        .run
        .as_ref()
        .map(|run| Totalled::from(run.summary()))
        .filter(|summary| summary.projects > 0);
    View {
        step: inner.step,
        host: inner.host.clone(),
        roots: inner.roots.iter().map(|root| display(root)).collect(),
        searching: inner.searching,
        folders,
        chosen,
        projects: inner.projects.clone(),
        storage: inner.storage,
        hub_error: inner.hub_error.clone(),
        can_start: ready(inner).is_ok(),
        run,
        summary,
        sessions_path: sessions_path(inner),
        error: inner.error.clone(),
    }
}

/// The list on the left: what Find found, what Check read, or the run's folders.
fn rows(backfill: &Backfill, inner: &mut Inner) -> Vec<Folder> {
    match inner.step {
        Step::Find => {
            let mut found: Vec<&ProjectFacts> = inner.found.iter().collect();
            found.sort_by(|a, b| b.newest.cmp(&a.newest).then_with(|| a.path.cmp(&b.path)));
            found
                .into_iter()
                .map(|facts| folder(facts, FolderView::Idle, None, facts.already))
                .collect()
        }
        Step::Check => inner
            .entries
            .iter()
            .map(|entry| {
                let state = match &entry.outcome {
                    Outcome::Pending => FolderView::Idle,
                    Outcome::Reading { read, of } => FolderView::Reading {
                        read: *read,
                        of: *of,
                    },
                    Outcome::Checked(_) => FolderView::Checked,
                    Outcome::Failed(reason) => FolderView::Failed {
                        reason: reason.clone(),
                    },
                };
                folder(&entry.facts, state, doubt_of(entry), false)
            })
            .collect(),
        Step::BringIn | Step::Done => {
            let planned: Vec<(PathBuf, FolderView)> = inner
                .run
                .iter()
                .flat_map(|run| &run.folders)
                .map(|folder| (folder.path.clone(), FolderView::from(&folder.state)))
                .collect();
            planned
                .into_iter()
                .map(|(path, state)| {
                    let facts = facts_of(backfill, inner, &path);
                    let doubt = inner
                        .entries
                        .iter()
                        .find(|entry| entry.facts.path == path)
                        .and_then(doubt_of);
                    folder(&facts, state, doubt, false)
                })
                .collect()
        }
    }
}

fn folder(
    facts: &ProjectFacts,
    state: FolderView,
    doubt: Option<FolderDoubt>,
    already: bool,
) -> Folder {
    Folder {
        path: display(&facts.path),
        name: name_of(&facts.path),
        title: dit_daemon::backfill::propose::track_name(&facts.path),
        sets: facts.sets,
        bytes: facts.bytes,
        newest: facts.newest,
        already,
        state,
        doubt,
    }
}

/// What Check found doubtful in a folder it has read: nothing, for a folder it has not.
fn doubt_of(entry: &Entry) -> Option<FolderDoubt> {
    let checked = entry.checked()?;
    let count = |wanted: fn(&Doubt) -> bool| {
        let sets = checked
            .sets
            .iter()
            .filter(|set| set.doubt.as_ref().is_some_and(wanted))
            .count();
        u32::try_from(sets).unwrap_or(u32::MAX)
    };
    let doubt = FolderDoubt {
        unreadable: count(|doubt| matches!(doubt, Doubt::Unreadable)),
        unrecorded: count(|doubt| matches!(doubt, Doubt::Unrecorded(_))),
        synced_by: entry.facts.synced_by.map(str::to_string),
    };
    (doubt.unreadable > 0 || doubt.unrecorded > 0 || doubt.synced_by.is_some()).then_some(doubt)
}

/// The facts of a run's folder: what Find or Check read of it, else read now (a run resumed after the app
/// restarted), else what a folder that is gone has.
fn facts_of(backfill: &Backfill, inner: &mut Inner, path: &Path) -> ProjectFacts {
    let known = inner
        .found
        .iter()
        .chain(inner.entries.iter().map(|entry| &entry.facts))
        .chain(inner.facts.get(path))
        .find(|facts| facts.path == path);
    if let Some(facts) = known {
        return facts.clone();
    }
    let read = backfill
        .registry
        .for_project_folder(path)
        .and_then(|daw| project_facts(path, daw, &RepoList::default()).ok())
        .map(|facts| ProjectFacts {
            already: false,
            ..facts
        });
    let facts = read.unwrap_or_else(|| ProjectFacts {
        path: path.to_path_buf(),
        sets: 0,
        bytes: 0,
        newest: None,
        already: false,
        synced_by: None,
    });
    inner.facts.insert(path.to_path_buf(), facts.clone());
    facts
}

/// The folder on the right: its sets, with where each goes once Check has read it, and the pickers' items.
fn chosen(backfill: &Backfill, inner: &mut Inner, path: &Path) -> Chosen {
    let read_by_check = inner
        .entries
        .iter()
        .any(|entry| entry.facts.path == path && entry.checked().is_some());
    // Taken before anything of `inner` is borrowed: listing reads the folder once and keeps it.
    let listed = if read_by_check {
        Vec::new()
    } else {
        backfill.sets_of(inner, path)
    };
    let entry = inner.entries.iter().find(|entry| entry.facts.path == path);
    let planned = inner
        .plan
        .as_ref()
        .and_then(|plan| plan.folders.iter().find(|folder| folder.path == path));
    let project = entry
        .and_then(|entry| entry.project)
        .or_else(|| planned.map(|folder| folder.project_id));
    let hub = project.and_then(|project| inner.hubs.get(&project));
    let tracks = hub
        .map(|hub| {
            hub.tracks
                .iter()
                .map(|track| Track {
                    id: track.id,
                    title: track.title.clone(),
                })
                .collect()
        })
        .unwrap_or_default();
    let sessions = hub
        .map(|hub| {
            hub.sessions
                .iter()
                .map(|session| Session {
                    id: session.id,
                    name: session.name.clone(),
                    track_id: session.track_id,
                    track_title: session.track_title.clone(),
                    taken_by: taken_by(inner, session.id),
                })
                .collect()
        })
        .unwrap_or_default();
    let matched = |target: &SetTarget| match (target, hub) {
        (SetTarget::Session(id), Some(hub)) => hub
            .sessions
            .iter()
            .find(|session| session.id == *id)
            .map(|session| Match {
                session_id: session.id,
                name: session.name.clone(),
                track_id: session.track_id,
                track_title: session.track_title.clone(),
            }),
        _ => None,
    };
    let read = entry.and_then(|entry| {
        entry.checked().map(|checked| {
            checked
                .sets
                .iter()
                .map(|set| {
                    let target = entry.targets.get(&set.file);
                    Set {
                        file: display(&set.file),
                        name: stem(&set.file),
                        set_id: set.set_id.clone(),
                        copies: set.copies,
                        saves: set.set_id.as_ref().map(|_| set.saves),
                        doubt: set.doubt.as_ref().map(|doubt| match doubt {
                            Doubt::Unreadable => SetDoubt {
                                kind: SetDoubtKind::Unreadable,
                                message: None,
                            },
                            Doubt::Unrecorded(message) => SetDoubt {
                                kind: SetDoubtKind::Unrecorded,
                                message: Some(message.clone()),
                            },
                        }),
                        target: target.map(Target::from),
                        matched: target.and_then(matched),
                    }
                })
                .collect::<Vec<_>>()
        })
    });
    let sets = match read {
        Some(sets) => sets,
        None => {
            let targets: HashMap<PathBuf, SetTarget> = planned
                .into_iter()
                .flat_map(|folder| &folder.sets)
                .map(|set| (set.file.clone(), set.target.clone()))
                .collect();
            let ids: HashMap<PathBuf, String> = planned
                .into_iter()
                .flat_map(|folder| &folder.sets)
                .map(|set| (set.file.clone(), set.set_id.clone()))
                .collect();
            listed
                .into_iter()
                .map(|facts| Set {
                    file: display(&facts.file),
                    name: stem(&facts.file),
                    set_id: ids.get(&facts.file).cloned(),
                    copies: facts.copies,
                    saves: None,
                    doubt: None,
                    target: targets.get(&facts.file).map(Target::from),
                    matched: targets.get(&facts.file).and_then(matched),
                })
                .collect()
        }
    };
    Chosen {
        folder: display(path),
        name: name_of(path),
        project,
        tracks,
        sessions,
        new_track: dit_daemon::backfill::propose::track_name(path),
        sets,
    }
}

/// The set file that is matched to the session `id` now, if one is.
fn taken_by(inner: &Inner, id: i64) -> Option<String> {
    inner.entries.iter().find_map(|entry| {
        entry
            .targets
            .iter()
            .find(|(_, target)| **target == SetTarget::Session(id))
            .map(|(file, _)| display(file))
    })
}

fn stem(file: &Path) -> String {
    file.file_stem()
        .map_or_else(|| display(file), |stem| stem.to_string_lossy().into_owned())
}

/// Where on the instance the sessions not in dit are listed: in the project of the first folder brought in.
fn sessions_path(inner: &Inner) -> Option<String> {
    let run = inner.run.as_ref()?;
    let plan = inner.plan.as_ref()?;
    let done = run
        .folders
        .iter()
        .find(|folder| folder.state == FolderState::Done)?;
    let project = plan
        .folders
        .iter()
        .find(|folder| folder.path == done.path)?
        .project_id;
    Some(format!("/project/{project}/session/all?inDit=false"))
}
