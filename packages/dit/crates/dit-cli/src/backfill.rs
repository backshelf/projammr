//! `dit backfill`: bringing the Live projects a producer already has into dit.
//!
//! With no folder it lists the project folders it finds. With folders it reads each into its `.dit/`, proposes where
//! its sets go on the hub, checks the hub has room, and runs the plan through a [`BackfillControl`]: the dit app's
//! when the app answers the cli, else a run here in the terminal. Both read the same state file, so running the same
//! folders again carries on where a stopped run left off, whichever of the two stopped it.
//!
//! The run's progress goes to stderr. A stderr that cannot be written to means the client hung up, and a hang-up is a
//! stop: the run pauses after the step it is in and its state file keeps its place.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use dit_core::remote::{PushError, Remote, SetTarget};
use dit_core::{Registry, RepoList};
use dit_daemon::backfill::propose::{self, Hub, TrackMatchPolicy};
use dit_daemon::backfill::{
    BackfillControl, BackfillError, Checked, Config, Control, Doubt, Driver, Event, FolderManifest,
    FolderPlan, FolderState, FolderStatus, MAX_CONCURRENCY, Plan, Recorder, RunLock, RunStatus,
    SetPlan, State, Summary, check, discard, find_projects, project_facts, storage,
};
use serde::{Deserialize, Serialize};

use crate::commands::CliError;
use crate::context::{Context, RemoteSource};
use crate::interrupt;
use crate::output::{counted, size, upload_progress};

fn error(message: impl ToString) -> CliError {
    CliError(message.to_string())
}

/// `repos.toml`, the list of repos the app tracks, beside the user config.
fn repos_path(source: &dyn RemoteSource) -> Result<PathBuf, CliError> {
    Ok(source
        .config_path()
        .map_err(error)?
        .with_file_name("repos.toml"))
}

/// The last part of a path: how a folder or a set file is named in a line.
fn name_of(path: &Path) -> String {
    path.file_name().map_or_else(
        || path.display().to_string(),
        |name| name.to_string_lossy().into_owned(),
    )
}

/// The project folders a search found; `--json` prints the array and nothing else.
#[derive(Serialize)]
#[serde(transparent)]
pub struct Listed {
    pub folders: Vec<Found>,
    /// The home folder, which text writes as `~`.
    #[serde(skip)]
    pub home: Option<PathBuf>,
}

/// A project folder and what it holds.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub path: String,
    pub sets: usize,
    pub bytes: u64,
    /// The time of the folder's newest save, milliseconds since the epoch.
    pub newest: Option<i64>,
    /// The folder is a repo already: on the list the app watches, or holding a `.dit/`.
    pub already: bool,
    /// The sync service the folder sits in, which can disturb files dit has open.
    pub synced_by: Option<String>,
}

/// The folders to search when none were named: each DAW's own list of project folders, and `~/Music`.
fn default_roots(registry: &Registry, home: Option<&Path>) -> Vec<PathBuf> {
    let Some(home) = home else {
        return Vec::new();
    };
    let mut roots: Vec<PathBuf> = registry
        .all()
        .iter()
        .flat_map(|daw| daw.project_roots(home).unwrap_or_default())
        .collect();
    roots.push(home.join("Music"));
    roots
}

/// Lists the project folders under `roots` (resolved against `cwd`), or under the default roots with none named:
/// newest save first, then by path.
pub fn list(cx: &mut Context, cwd: &Path, roots: &[PathBuf]) -> Result<Listed, CliError> {
    let repos = RepoList::load(&repos_path(cx.remote)?).map_err(error)?;
    let home = dirs::home_dir();
    let registry = dit_daws::registry();
    let roots: Vec<PathBuf> = if roots.is_empty() {
        default_roots(&registry, home.as_deref())
    } else {
        roots.iter().map(|root| cwd.join(root)).collect()
    };
    let mut searched = HashSet::new();
    let cancel = AtomicBool::new(false);
    let mut seen = HashSet::new();
    let mut facts = Vec::new();
    for root in roots {
        if !root.is_dir() || !searched.insert(root.clone()) {
            continue;
        }
        for daw in registry.all() {
            for folder in find_projects(&root, *daw, &cancel, &mut |_| {}) {
                let Ok(canonical) = folder.canonicalize() else {
                    continue;
                };
                if !seen.insert(canonical) {
                    continue;
                }
                match project_facts(&folder, *daw, &repos) {
                    Ok(found) => facts.push(found),
                    Err(error) => cx.say(format!("skipping {}: {error}", folder.display())),
                }
            }
        }
    }
    facts.sort_by(|a, b| b.newest.cmp(&a.newest).then_with(|| a.path.cmp(&b.path)));
    let folders = facts
        .into_iter()
        .map(|facts| Found {
            path: facts.path.display().to_string(),
            sets: facts.sets,
            bytes: facts.bytes,
            newest: facts.newest,
            already: facts.already,
            synced_by: facts.synced_by.map(str::to_string),
        })
        .collect();
    // The folders found are canonical paths, so the home they are shown relative to is too.
    let home = home.map(|home| home.canonicalize().unwrap_or(home));
    Ok(Listed { folders, home })
}

/// How a folder stands at the end of a run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Ending {
    Done,
    Failed,
    Paused,
    /// Not reached: the run stopped before its turn, or it was still going when the answer was read.
    Waiting,
}

/// Options controlling a `dit backfill <folder>...` run.
#[derive(Debug, Clone, Copy)]
pub struct RunOptions {
    pub project: Option<i64>,
    pub match_policy: TrackMatchPolicy,
    pub concurrency: usize,
}

impl Default for RunOptions {
    fn default() -> Self {
        RunOptions {
            project: None,
            match_policy: TrackMatchPolicy::default(),
            concurrency: 1,
        }
    }
}

/// A folder of the run and how it ended.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderOutcome {
    pub path: String,
    pub folder: String,
    pub state: Ending,
    /// What a folder that is done holds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sets: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saves: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_existing: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_ids: Option<Vec<i64>>,
    /// Why a folder that failed did.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl FolderOutcome {
    fn of(
        path: &Path,
        status: Option<&FolderStatus>,
        manifest: Option<&FolderManifest>,
        hub: Option<&Hub>,
        plan_folder: Option<&FolderPlan>,
    ) -> Self {
        let mut outcome = FolderOutcome {
            path: path.display().to_string(),
            folder: name_of(path),
            state: Ending::Waiting,
            sets: None,
            saves: None,
            bytes: None,
            repo_id: None,
            track_id: None,
            track_title: None,
            matched_existing: None,
            session_ids: None,
            error: None,
        };
        let Some(status) = status else {
            return outcome;
        };
        match &status.state {
            FolderState::Done => {
                let totals = status.totals.clone().unwrap_or_default();
                outcome.state = Ending::Done;
                outcome.sets = Some(totals.sets);
                outcome.saves = Some(totals.saves);
                outcome.bytes = Some(totals.bytes);
                if let Some(manifest) = manifest {
                    outcome.repo_id = Some(manifest.repo_id);
                    let resolved_track_id = manifest.track_id.or_else(|| {
                        let hub = hub?;
                        let folder = plan_folder?;
                        folder.sets.iter().find_map(|set| match set.target {
                            SetTarget::Session(sid) => hub
                                .sessions
                                .iter()
                                .find(|s| s.id == sid)
                                .and_then(|s| s.track_id),
                            SetTarget::Track(tid) => Some(tid),
                            SetTarget::NewTrack(_) => None,
                        })
                    });
                    let resolved_track_title = manifest.track_title.clone().or_else(|| {
                        let hub = hub?;
                        if let Some(tid) = resolved_track_id
                            && let Some(track) = hub.tracks.iter().find(|t| t.id == tid)
                        {
                            return Some(track.title.clone());
                        }
                        let folder = plan_folder?;
                        folder.sets.iter().find_map(|set| match set.target {
                            SetTarget::Session(sid) => hub
                                .sessions
                                .iter()
                                .find(|s| s.id == sid)
                                .and_then(|s| s.track_title.clone()),
                            _ => None,
                        })
                    });
                    outcome.track_id = resolved_track_id;
                    outcome.track_title = resolved_track_title;
                    outcome.matched_existing = Some(manifest.matched_existing);
                    outcome.session_ids = Some(manifest.session_ids.clone());
                }
            }
            FolderState::Failed(reason) => {
                outcome.state = Ending::Failed;
                outcome.error = Some(reason.clone());
            }
            FolderState::Paused => outcome.state = Ending::Paused,
            _ => {}
        }
        outcome
    }
}

/// What a backfill brought in and how it ended.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Brought {
    pub folders: Vec<FolderOutcome>,
    /// What the folders that are done add up to.
    pub summary: Summary,
    /// The run stopped on request (or because the hub no longer accepts the sign-in) and the same command carries on.
    pub paused: bool,
    /// The line that fails the command after its result is shown: a stopped run, or folders that could not be
    /// brought in.
    #[serde(skip)]
    pub refusal: Option<String>,
}

/// Each folder of `plan` and how the run left it.
fn outcomes(
    plan: &[FolderPlan],
    status: Option<&RunStatus>,
    state: Option<&State>,
    hub: &Hub,
) -> Vec<FolderOutcome> {
    plan.iter()
        .map(|folder_plan| {
            let line = status.and_then(|status| {
                status
                    .folders
                    .iter()
                    .find(|folder| folder.path == folder_plan.path)
            });
            let manifest = state.and_then(|state| {
                state
                    .plan
                    .folders
                    .iter()
                    .zip(&state.folders)
                    .find(|(f, _)| f.path == folder_plan.path)
                    .and_then(|(_, run)| run.manifest.as_ref())
            });
            FolderOutcome::of(
                &folder_plan.path,
                line,
                manifest,
                Some(hub),
                Some(folder_plan),
            )
        })
        .collect()
}

/// Each argument as a folder of some DAW's, resolved against `cwd`, once each.
fn project_folders(
    cwd: &Path,
    arguments: &[PathBuf],
    registry: &Registry,
) -> Result<Vec<PathBuf>, CliError> {
    let mut folders: Vec<PathBuf> = Vec::new();
    for argument in arguments {
        let folder = cwd
            .join(argument)
            .canonicalize()
            .ok()
            .filter(|folder| registry.for_project_folder(folder).is_some())
            .ok_or_else(|| {
                CliError(format!(
                    "{} isn't a Live project folder.",
                    argument.display()
                ))
            })?;
        if !folders.contains(&folder) {
            folders.push(folder);
        }
    }
    Ok(folders)
}

/// The folders still to bring in: those not in dit already. A folder the stopped run in the state file still holds,
/// and that is not on the list of repos, is that run being resumed, and stays.
fn not_in_dit(
    cx: &mut Context,
    folders: Vec<PathBuf>,
    repos: &RepoList,
    held: &[PathBuf],
) -> Result<Vec<PathBuf>, CliError> {
    let mut left = Vec::new();
    for folder in folders {
        let listed = repos.repos.contains(&folder);
        let resuming = held.contains(&folder) && !listed;
        if (listed || folder.join(".dit").exists()) && !resuming {
            cx.say(format!("skipping {}: already in dit", name_of(&folder)));
        } else {
            left.push(folder);
        }
    }
    if left.is_empty() {
        return Err(error("Everything here is already in dit."));
    }
    Ok(left)
}

/// A project of the signed-in account.
#[derive(Deserialize)]
struct Mine {
    id: i64,
    name: String,
}

/// The project the folders go to: the one asked for, else the one the last backfill used, else the account's only
/// one.
fn choose_project(remote: &Remote, asked: Option<i64>, state_file: &Path) -> Result<i64, CliError> {
    let mine: Vec<Mine> = remote.get("/me/projects").map_err(error)?;
    let belongs = |id: i64| mine.iter().any(|project| project.id == id);
    if let Some(id) = asked {
        return if belongs(id) {
            Ok(id)
        } else {
            Err(CliError(format!("You're not in project {id}.")))
        };
    }
    // A project the account has left is not a default any more.
    let remembered = State::load(state_file)
        .ok()
        .and_then(|state| state.last_project())
        .filter(|id| belongs(*id));
    if let Some(id) = remembered {
        return Ok(id);
    }
    match mine.as_slice() {
        [] => Err(error(PushError::NoProjects {
            host: remote.client().instance().host().to_string(),
        })),
        [only] => Ok(only.id),
        several => Err(CliError(format!(
            "You're in several projects ({}). Run dit backfill --project <id>.",
            several
                .iter()
                .map(|project| format!("{} {}", project.name, project.id))
                .collect::<Vec<_>>()
                .join(", ")
        ))),
    }
}

/// Reads each folder into its `.dit/`, saying what it finds. A folder that cannot be read, or has no sets to bring in,
/// is skipped with a note (and loses the `.dit/` Check made).
fn check_all(cx: &mut Context, recorder: &Recorder, folders: Vec<PathBuf>) -> Vec<Checked> {
    let cancel = AtomicBool::new(false);
    let mut checked = Vec::new();
    for folder in folders {
        let name = name_of(&folder);
        let existed = folder.join(".dit").exists();
        let mut said = false;
        let result = check(recorder, &folder, &cancel, &mut |_, sets| {
            if !said {
                said = true;
                cx.say(format!(
                    "Reading {name} · {}",
                    counted(u64::from(sets), "set")
                ));
            }
        });
        cx.flush_notes();
        let found = match result {
            Ok(found) => found,
            Err(reason) => {
                if !existed {
                    let _ = discard(&folder);
                }
                cx.say(format!("skipping {name}: {reason}"));
                continue;
            }
        };
        for set in &found.sets {
            let file = name_of(&set.file);
            match &set.doubt {
                Some(Doubt::Unrecorded(reason)) => cx.say(format!(
                    "{file} couldn't be recorded: {reason}; it's left out."
                )),
                Some(Doubt::Unreadable) => {
                    cx.say(format!("{file} couldn't be read; it's stored as it is."));
                }
                None => {}
            }
        }
        if found.sets.iter().all(|set| set.set_id.is_none()) {
            if found.created_dit {
                let _ = discard(&found.path);
            }
            cx.say(format!("skipping {name}: it has no sets to bring in."));
        } else {
            checked.push(found);
        }
    }
    checked
}

/// Removes the `.dit/` of every folder Check made, for a run that did not begin.
fn undo(checked: &[Checked]) {
    for folder in checked.iter().filter(|folder| folder.created_dit) {
        let _ = discard(&folder.path);
    }
}

/// What the run is to do: each checked set to the target the hub's proposals give it, the folders newest first.
fn plan_of(
    cx: &mut Context,
    remote: &Remote,
    registry: &Registry,
    repos: &RepoList,
    project: i64,
    checked: &[Checked],
    match_policy: TrackMatchPolicy,
) -> Result<(Plan, Hub), CliError> {
    let hub: Hub = propose::read(remote, project).map_err(error)?;
    let proposer = propose::Proposer::with_policy(&hub, match_policy);
    let mut folders = Vec::with_capacity(checked.len());
    let mut taken = HashSet::new();
    for folder in checked {
        let recorded = folder.sets.iter().filter(|set| set.set_id.is_some());
        let mut sets = Vec::new();
        for (set, proposal) in recorded.zip(proposer.propose(folder, &mut taken)) {
            if let Some(matched) = &proposal.matched {
                cx.say(format!("{} matches '{}'", name_of(&set.file), matched.name));
            }
            sets.push(SetPlan {
                set_id: proposal.set_id,
                file: set.file.clone(),
                target: proposal.target,
            });
        }
        let newest = registry
            .for_project_folder(&folder.path)
            .and_then(|daw| project_facts(&folder.path, daw, repos).ok())
            .and_then(|facts| facts.newest);
        folders.push((
            newest,
            FolderPlan {
                path: folder.path.clone(),
                project_id: project,
                created_dit: folder.created_dit,
                sets,
            },
        ));
    }
    // `None` sorts below every time, so the folders with no save time come last.
    folders.sort_by_key(|folder| std::cmp::Reverse(folder.0));
    Ok((
        Plan {
            folders: folders.into_iter().map(|(_, folder)| folder).collect(),
        },
        hub,
    ))
}

/// Says what the folders will add to the hub's storage, or refuses when there is not the room.
fn check_room(
    cx: &mut Context,
    remote: &Remote,
    project: i64,
    checked: &[Checked],
) -> Result<(), CliError> {
    let instance_forces =
        dit_daemon::backfill::run::instance_pushes_samples(remote).map_err(error)?;
    let objects: Vec<_> = checked
        .iter()
        .flat_map(|folder| folder.objects_to_send(instance_forces))
        .collect();
    let room = storage(remote, project, &objects).map_err(error)?;
    match room.remaining {
        Some(left) if room.bytes > left => Err(CliError(format!(
            "These folders need {} and you have {} left. Run it again with fewer folders.",
            size(room.bytes),
            size(left)
        ))),
        Some(left) => {
            cx.say(format!(
                "Needs {} of your {} left.",
                size(room.bytes),
                size(left)
            ));
            Ok(())
        }
        None => {
            cx.say(format!(
                "Needs {}. No storage limit on this instance.",
                size(room.bytes)
            ));
            Ok(())
        }
    }
}

/// Words the progress of a run for stderr: a line when a folder starts, when its commits begin and end, when its
/// upload passes each tenth, when it waits for the hub and when it fails. What happens on every event is not said
/// every time.
#[derive(Default)]
struct Narrator {
    folders: HashMap<PathBuf, Seen>,
}

/// What has been said of a folder.
#[derive(Default)]
struct Seen {
    reading: bool,
    /// The sets committed when the folder's commits began: a resumed folder starts part of the way.
    began_at: Option<u32>,
    said_first: bool,
    said_last: bool,
    /// The tenth of the upload last said.
    tenth: Option<u128>,
    waiting: bool,
}

impl Narrator {
    fn lines(&mut self, event: &Event) -> Vec<String> {
        let Event::Folder { path, state } = event else {
            return Vec::new();
        };
        let name = name_of(path);
        let seen = self.folders.entry(path.clone()).or_default();
        let was_waiting = std::mem::replace(
            &mut seen.waiting,
            matches!(state, FolderState::WaitingForHub),
        );
        let mut lines = Vec::new();
        match state {
            FolderState::Committing { done, of } => {
                if !std::mem::replace(&mut seen.reading, true) {
                    lines.push(format!("{name}: reading sets"));
                }
                let began = *seen.began_at.get_or_insert(*done);
                let line = format!(
                    "{name}: committing {done} of {}",
                    counted(u64::from(*of), "set")
                );
                if done == of {
                    if !std::mem::replace(&mut seen.said_last, true) {
                        seen.said_first = true;
                        lines.push(line);
                    }
                } else if *done > began && !std::mem::replace(&mut seen.said_first, true) {
                    lines.push(line);
                }
            }
            FolderState::Uploading { sent, of } if *of > 0 => {
                let tenth = u128::from(*sent.min(of)) * 10 / u128::from(*of);
                if seen.tenth.is_none_or(|said| tenth > said) {
                    seen.tenth = Some(tenth);
                    lines.push(format!("{name}: uploading {}", upload_progress(*sent, *of)));
                }
            }
            FolderState::WaitingForHub if !was_waiting => {
                lines.push(format!("{name}: waiting for the hub"));
            }
            FolderState::Failed(reason) => lines.push(format!("{name}: failed: {reason}")),
            _ => {}
        }
        lines
    }
}

/// Brings `folders` (resolved against `cwd`) into the project on the hub: checks them, takes the hub's proposals for
/// where their sets go, and runs the plan, through the app's run when it answered the cli and here when not.
pub fn run(
    cx: &mut Context,
    cwd: &Path,
    folders: &[PathBuf],
    options: RunOptions,
) -> Result<Brought, CliError> {
    if options.concurrency == 0 || options.concurrency > MAX_CONCURRENCY {
        return Err(CliError(format!(
            "--concurrency must be between 1 and {MAX_CONCURRENCY}."
        )));
    }
    if let TrackMatchPolicy::Fuzzy(threshold) = options.match_policy
        && (!(0.0..=1.0).contains(&threshold) || threshold.is_nan())
    {
        return Err(CliError(
            "--match-threshold must be between 0 and 1.".to_string(),
        ));
    }
    let source = cx.remote;
    let remote = source.open().map_err(error)?;
    let registry = dit_daws::registry();
    let wanted = project_folders(cwd, folders, &registry)?;
    let config = source.config_path().map_err(error)?;
    let state_file = State::beside(&config);
    let repos_file = repos_path(source)?;
    let recorder = Recorder {
        registry: registry.clone(),
        author: cx.author(),
        machine: Arc::new(cx.saving_machine()),
    };

    let local;
    let control: &dyn BackfillControl = match cx.backfill {
        Some(app) => app,
        None => {
            let mut driver_config =
                Config::new(recorder.clone(), state_file.clone(), repos_file.clone());
            driver_config.concurrency = options.concurrency;
            local = Control {
                driver: Driver::new(driver_config),
                remote: move || source.open(),
            };
            &local
        }
    };

    let repos = RepoList::load(&repos_file).map_err(error)?;
    let held: Vec<PathBuf> = control
        .status()
        .map_err(error)?
        .map(|status| {
            status
                .folders
                .into_iter()
                .map(|folder| folder.path)
                .collect()
        })
        .unwrap_or_default();
    let wanted = not_in_dit(cx, wanted, &repos, &held)?;
    let project = choose_project(&remote, options.project, &state_file)?;

    // Acquire the backfill run lock before `check_all` creates `.dit/` in any folder,
    // so a concurrent backfill run fails fast without mutating disk state. Release it
    // immediately before `control.start` hands ownership to the driver.
    let pre_lock = RunLock::take(&state_file)
        .map_err(error)?
        .ok_or_else(|| error(BackfillError::Busy))?;

    let checked = check_all(cx, &recorder, wanted);
    if checked.is_empty() {
        return Err(error(BackfillError::Nothing));
    }
    let (plan, hub) = plan_of(
        cx,
        &remote,
        &registry,
        &repos,
        project,
        &checked,
        options.match_policy,
    )
    .and_then(|(plan, hub)| check_room(cx, &remote, project, &checked).map(|()| (plan, hub)))
    .inspect_err(|_| undo(&checked))?;
    drop(pre_lock);

    let planned_folders = plan.folders.clone();
    let mut narrator = Narrator::default();
    let mut hung_up = false;
    // Only install a process-wide SIGINT handler when running directly in the CLI process;
    // over IPC (`cx.backfill.is_some()`), the command executes inside the running dit app.
    let catch_sigint = cx.backfill.is_none();
    let catching = catch_sigint.then(interrupt::Catching::start);
    let finished = AtomicBool::new(false);
    let ended = std::thread::scope(|scope| {
        if catch_sigint {
            scope.spawn(|| interrupt::watch(control, &finished));
        }
        let ended = control.start_with_concurrency(plan, options.concurrency, &mut |event| {
            if hung_up {
                return;
            }
            for line in narrator.lines(&event) {
                if !cx.tell(line) {
                    hung_up = true;
                    control.pause();
                    return;
                }
            }
        });
        finished.store(true, Ordering::SeqCst);
        ended
    });
    drop(catching);

    let (paused, stopped) = match ended {
        Ok(_) => (false, None),
        Err(stop @ (BackfillError::Paused | BackfillError::SignedOut { .. })) => {
            (true, Some(stop.to_string()))
        }
        Err(other) => {
            if matches!(
                other,
                BackfillError::Busy | BackfillError::Remote(_) | BackfillError::Nothing
            ) {
                undo(&checked);
            }
            return Err(error(other));
        }
    };
    let status = control.status().map_err(error)?;
    let persisted = State::load(&state_file).ok();
    let folders = outcomes(&planned_folders, status.as_ref(), persisted.as_ref(), &hub);
    let failed = folders
        .iter()
        .filter(|folder| folder.state == Ending::Failed)
        .count();
    let refusal = stopped.or_else(|| {
        (failed > 0).then(|| {
            format!(
                "{} could not be brought in.",
                counted(failed as u64, "folder")
            )
        })
    });
    Ok(Brought {
        folders,
        summary: status.map(|status| status.summary()).unwrap_or_default(),
        paused,
        refusal,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str, state: FolderState) -> Event {
        Event::Folder {
            path: PathBuf::from(format!("/music/{name}")),
            state,
        }
    }

    fn said(narrator: &mut Narrator, events: Vec<Event>) -> Vec<String> {
        events
            .iter()
            .flat_map(|event| narrator.lines(event))
            .collect()
    }

    #[test]
    fn a_folder_says_when_it_starts_and_its_first_and_last_commit() {
        let events = (0..=8)
            .map(|done| folder("A Project", FolderState::Committing { done, of: 8 }))
            .collect();

        assert_eq!(
            said(&mut Narrator::default(), events),
            [
                "A Project: reading sets",
                "A Project: committing 1 of 8 sets",
                "A Project: committing 8 of 8 sets",
            ]
        );
    }

    #[test]
    fn a_folder_of_one_set_says_its_commit_once() {
        let events = vec![
            folder("A Project", FolderState::Committing { done: 0, of: 1 }),
            folder("A Project", FolderState::Committing { done: 1, of: 1 }),
        ];

        assert_eq!(
            said(&mut Narrator::default(), events),
            [
                "A Project: reading sets",
                "A Project: committing 1 of 1 set"
            ]
        );
    }

    #[test]
    fn an_upload_says_each_tenth_once() {
        let events = (0..=40)
            .map(|step| FolderState::Uploading {
                sent: step * 2_500,
                of: 100_000,
            })
            .map(|state| folder("A Project", state))
            .collect();

        let lines = said(&mut Narrator::default(), events);

        assert_eq!(lines.len(), 11);
        assert_eq!(lines[0], "A Project: uploading 0.0 of 97.7 KB");
        assert_eq!(lines[10], "A Project: uploading 97.7 of 97.7 KB");
    }

    #[test]
    fn a_wait_for_the_hub_is_said_once_until_the_folder_moves_again() {
        let events = vec![
            folder("A Project", FolderState::WaitingForHub),
            folder("A Project", FolderState::WaitingForHub),
            folder("A Project", FolderState::Uploading { sent: 0, of: 10 }),
            folder("A Project", FolderState::WaitingForHub),
        ];

        let lines = said(&mut Narrator::default(), events);

        assert_eq!(
            lines
                .iter()
                .filter(|line| line.ends_with("waiting for the hub"))
                .count(),
            2
        );
    }

    #[test]
    fn a_failure_is_said_with_its_reason_and_a_pause_says_nothing() {
        let events = vec![
            folder("A Project", FolderState::Failed("the hub said no".into())),
            Event::Paused,
        ];

        assert_eq!(
            said(&mut Narrator::default(), events),
            ["A Project: failed: the hub said no"]
        );
    }
}
