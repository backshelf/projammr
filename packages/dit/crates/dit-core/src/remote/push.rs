//! Pushing a repo to its hub repo, and what a push would send.
//!
//! Per set and branch a push sends the saves the hub has not recorded (metadata only), then the commits it has not
//! recorded, oldest first, in runs: each run asks which of its saves' objects the repo lacks, uploads those in packs,
//! then records the run's commits. `.dit/refs/remote/<set id>.json` gains each step only after the hub has answered
//! it with a 2xx, and every step is idempotent on the hub, so a push that stops halfway leaves only work the next push
//! repeats.
//!
//! When the hub repo takes samples, a second phase follows a branch's commits: each commit's sample objects, oldest
//! commit first, under their own cursor (`PushedBranch::samples`). A commit is whole on the hub without its samples,
//! so a sample the hub refuses never undoes the commit. A refusal for the storage cap (a 413 coded `storage_limit`)
//! ends the push with [`PushError::StorageLimit`], after what the phase completed is recorded; any other refusal is
//! an ordinary error.
//!
//! The saves of a branch go with the time this machine had the set open, as spans under their own cursor
//! (`PushedBranch::segments_through`); the hub upserts them. After a branch's commits, the lineage phase sends each
//! commit's own Save and its Commit object, asked for with `missing` and uploaded like any object, then posts the
//! commit again naming them (`PushedBranch::lineage`). A cursor that is unset starts at the first commit, so a repo
//! pushed before the phase existed fills in on its next push.

use std::collections::{HashMap, HashSet};
use std::ops::ControlFlow;

use serde::Serialize;
use thiserror::Error;

use super::hub::{self, CommitItem, CommitSave, HubRepo, Project};
use super::machines::hub_name;
use super::pack::{LeafObjects, PackError, packs, save_objects_cached};
use super::{Instance, Remote, RemoteError};
use crate::repo::{
    HistoryEntry, MAIN_BRANCH, PushSamples, PushedBranch, PushedSet, RemoteBinding, Repo,
    RepoError, Segment,
};
use crate::store::{ObjectId, ObjectKind, StoreError};

/// What to push.
#[derive(Debug, Clone, Default)]
pub struct PushOptions {
    /// One set, by id; every set when `None`.
    pub set: Option<String>,
    /// The project an unbound repo is created in, by name; ignored once the repo is bound.
    pub project: Option<String>,
    /// Stop after the sets and commits: send no sample objects, whatever the hub repo's setting. What `dit commit`'s
    /// push does, so a slow or refused sample never holds a commit back.
    pub skip_samples: bool,
    /// Send only the saves, and the time spans beside them: no commits, no lineage and no samples, and no request
    /// that asks the hub about the repo. What the dit app sends after each save, so a save reaches the hub in
    /// seconds whatever else is waiting.
    pub saves_only: bool,
}

/// What a push sent.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushReport {
    /// The project and hub repo this push bound the repo to; absent when it was already bound.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bound: Option<Bound>,
    /// The branches the push sent saves or commits of, in push order.
    pub branches: Vec<BranchPush>,
}

/// The hub repo a first push created and bound the repo to.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bound {
    pub project: String,
    pub repo_id: i64,
}

/// What a push sent of one branch.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchPush {
    pub set_id: String,
    pub branch: String,
    pub saves: usize,
    pub commits: usize,
    /// Objects uploaded that are new to the hub: no repo on the instance held them.
    pub objects_stored: usize,
    /// Objects uploaded that the hub already held, for this repo or another one.
    pub objects_known: usize,
    /// Objects the hub linked to this repo without an upload, because a repo of a project the caller is in held them.
    pub objects_claimed: usize,
    /// Time spans sent: this machine's, of the branch's set. Never the reason a branch is listed in a report.
    #[serde(skip_serializing_if = "is_zero")]
    pub segments: usize,
    /// Commits whose own Save and Commit objects the lineage phase sent and linked.
    #[serde(skip_serializing_if = "is_zero")]
    pub lineage: usize,
    /// The sample phase; empty when the hub repo does not take samples or the push skipped them.
    #[serde(skip_serializing_if = "SamplesPush::is_empty")]
    pub samples: SamplesPush,
}

fn is_zero(count: &usize) -> bool {
    *count == 0
}

/// What the sample phase of one branch sent.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SamplesPush {
    /// Commits whose samples the hub now holds.
    pub commits: usize,
    /// Sample objects uploaded that are new to the hub.
    pub objects_stored: usize,
    /// Sample objects uploaded that the hub already held.
    pub objects_known: usize,
    /// Sample objects linked without an upload.
    pub objects_claimed: usize,
}

impl SamplesPush {
    fn is_empty(&self) -> bool {
        *self == SamplesPush::default()
    }
}

/// What the next push of one branch would send.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    pub set_id: String,
    pub branch: String,
    pub saves: usize,
    pub commits: usize,
    /// Commits whose sample objects the next push would send, when the hub repo is known to take samples.
    pub samples: usize,
}

/// Why a push stopped. Each message is the one line the cli prints.
#[derive(Debug, Error)]
pub enum PushError {
    #[error("This repo pushes to {bound}; dit is signed in to {signed_in}. Run dit login {bound}.")]
    OtherInstance { bound: String, signed_in: String },
    /// The instance the repo is bound to answers with a redirect. Signing in at `moved_to` does not move the
    /// binding on its own; `rebind` does. `moved_to` is the origin of the redirect's location, when that is an
    /// instance address.
    #[error("This repo pushes to {bound}, which redirects {}", redirect_advice(.moved_to))]
    BoundRedirected {
        bound: String,
        moved_to: Option<String>,
    },
    #[error("You're in several projects ({}). Run dit push --project <name>.", .0.join(", "))]
    SeveralProjects(Vec<String>),
    #[error("You have no projects on {host}.")]
    NoProjects { host: String },
    #[error("No project named {name} on {host}.")]
    NoSuchProject { name: String, host: String },
    #[error("This repo has no set {0}.")]
    NoSuchSet(String),
    #[error("This repo has not been pushed yet. Run dit push first.")]
    NotBound,
    /// A branch checked out from a commit of `fork`, which cannot be pushed before it: `fork` is not a branch of the
    /// set any more, or it was itself checked out from `branch`.
    #[error(
        "Can't push branch {branch}: it was checked out from branch {fork}, which can't be pushed before it."
    )]
    UnpushableFork { branch: String, fork: String },
    #[error("Can't reach {host}. Saved here; dit push when it's back.")]
    Unreachable { host: String },
    #[error("{host} took too long to answer. Saved here; dit push to try again.")]
    TimedOut { host: String },
    /// A sample pack the hub refused as over a storage cap. The push stopped there with `message`, the hub's own
    /// words; `report` is what it sent before: the commits are on the hub, the refused commit's samples and every
    /// later commit's stay pending.
    #[error("{message}")]
    StorageLimit {
        message: String,
        report: Box<PushReport>,
    },
    #[error(transparent)]
    Remote(RemoteError),
    #[error(transparent)]
    Repo(#[from] RepoError),
    #[error(transparent)]
    Pack(#[from] PackError),
    /// The observer of the push asked it to stop. What the hub confirmed before stays recorded, and a pack that
    /// reached it stays there.
    #[error("The push was stopped.")]
    Stopped,
}

impl From<RemoteError> for PushError {
    fn from(error: RemoteError) -> Self {
        match error {
            RemoteError::Unreachable { host, .. } => PushError::Unreachable { host },
            RemoteError::TimedOut { host } => PushError::TimedOut { host },
            other => PushError::Remote(other),
        }
    }
}

impl From<StoreError> for PushError {
    fn from(error: StoreError) -> Self {
        PushError::Repo(error.into())
    }
}

/// How a push splits its requests.
pub(super) struct Batching {
    /// Saves per `POST /saves`: a save's metadata can be large, and the hub caps a JSON body.
    pub(super) saves: usize,
    /// Object ids a run of commits may list before the next commit starts a new run; a run holds at least one
    /// commit whatever it lists.
    pub(super) run_objects: usize,
}

const BATCHING: Batching = Batching {
    saves: 200,
    run_objects: 100_000,
};

/// The message the hub's commit refusal starts with when the repo lacks objects a commit lists.
const OBJECTS_NOT_HELD: &str = "Objects not held by this repo";

/// The `code` of the hub's 413 for an upload over a storage cap.
const STORAGE_LIMIT_CODE: &str = "storage_limit";

/// What a push reports to its observer, which can stop it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PushProgress {
    /// The push is about to start a step: a chunk of saves, a run of commits, a lineage batch or a pack.
    Between,
    /// A pack of `bytes` bytes reached the hub and the hub stored it.
    Uploaded { bytes: u64 },
}

/// Pushes the repo's sets, or the one `options.set` names, to its hub repo. An unbound repo is first bound to a new
/// repo in the project `options.project` names, or the user's only project. Stops at the first error; what the hub
/// confirmed before it stays recorded.
pub fn push(repo: &Repo, remote: &Remote, options: &PushOptions) -> Result<PushReport, PushError> {
    push_observed(repo, remote, options, &mut |_| ControlFlow::Continue(()))
}

/// [`push`], telling `observer` before each step and after each pack the hub stored. An observer that returns
/// `ControlFlow::Break` ends the push at once with [`PushError::Stopped`]; what the hub confirmed up to then stays
/// recorded, exactly as for any other early error.
pub fn push_observed(
    repo: &Repo,
    remote: &Remote,
    options: &PushOptions,
    observer: &mut dyn FnMut(PushProgress) -> ControlFlow<()>,
) -> Result<PushReport, PushError> {
    push_observed_batched(repo, remote, options, &BATCHING, observer)
}

/// [`push`] with its requests split by `batching` and an observer that never stops it.
#[cfg(test)]
pub(super) fn push_batched(
    repo: &Repo,
    remote: &Remote,
    options: &PushOptions,
    batching: &Batching,
) -> Result<PushReport, PushError> {
    push_observed_batched(repo, remote, options, batching, &mut |_| {
        ControlFlow::Continue(())
    })
}

fn push_observed_batched(
    repo: &Repo,
    remote: &Remote,
    options: &PushOptions,
    batching: &Batching,
    observer: &mut dyn FnMut(PushProgress) -> ControlFlow<()>,
) -> Result<PushReport, PushError> {
    let binding = repo.remote_binding()?;
    let Some(binding) = binding else {
        return push_sets(repo, remote, options, batching, observer, None);
    };
    let bound = signed_in_to(remote, &binding)?;
    push_sets(repo, remote, options, batching, observer, Some(binding)).map_err(|error| match error
    {
        PushError::Remote(RemoteError::Redirected { location, .. }) => PushError::BoundRedirected {
            bound: bound.url().to_string(),
            moved_to: Instance::parse(&location)
                .ok()
                .map(|instance| instance.url().to_string()),
        },
        other => other,
    })
}

/// The instance `binding` names, when the remote is signed in to it.
pub(super) fn signed_in_to(
    remote: &Remote,
    binding: &RemoteBinding,
) -> Result<Instance, PushError> {
    let bound = Instance::parse(&binding.instance)?;
    let signed_in = remote.client().instance();
    if bound != *signed_in {
        return Err(PushError::OtherInstance {
            bound: bound.url().to_string(),
            signed_in: signed_in.url().to_string(),
        });
    }
    Ok(bound)
}

/// Sets the bound hub repo's push-samples switch to `on` and caches the answer, the hub's whole setting, in the
/// repo's config. The hub is the record: nothing is cached until it has answered 2xx. An unbound repo is refused
/// before `open_remote` is called, so no credential store is touched for it; a remote signed in to another instance
/// and a user who cannot edit the repo are refused too.
pub fn set_push_samples(
    repo: &Repo,
    open_remote: impl FnOnce() -> Result<Remote, RemoteError>,
    on: bool,
) -> Result<PushSamples, PushError> {
    let binding = repo.remote_binding()?.ok_or(PushError::NotBound)?;
    let remote = open_remote()?;
    signed_in_to(&remote, &binding)?;
    let setting = hub::set_push_samples(&remote, binding.repo, on)?.push_samples();
    repo.cache_push_samples(setting)?;
    Ok(setting)
}

/// Whether a push of `repo` sends sample objects: the hub's answer for the hub repo it is bound to, cached in the
/// repo's config. An unbound repo is refused.
pub fn pushes_samples(repo: &Repo, remote: &Remote) -> Result<bool, PushError> {
    let binding = repo.remote_binding()?.ok_or(PushError::NotBound)?;
    signed_in_to(remote, &binding)?;
    let setting = hub::repo(remote, binding.repo)?.push_samples();
    repo.cache_push_samples(setting)?;
    Ok(setting.pushing())
}

/// How the rest of a [`PushError::BoundRedirected`] message goes: the commands that follow the instance when the
/// redirect names an address to follow, and no commands when it does not.
fn redirect_advice(moved_to: &Option<String>) -> String {
    match moved_to {
        Some(origin) => format!(
            "to {origin}. If the instance moved, run dit login {origin}, then dit remote set {origin}."
        ),
        None => "elsewhere.".to_string(),
    }
}

/// Pushes to the repo's hub repo, `binding`, or first binds it when there is none.
fn push_sets(
    repo: &Repo,
    remote: &Remote,
    options: &PushOptions,
    batching: &Batching,
    observer: &mut dyn FnMut(PushProgress) -> ControlFlow<()>,
    binding: Option<RemoteBinding>,
) -> Result<PushReport, PushError> {
    let sets = repo.sets()?;
    let set_ids: Vec<&String> = match &options.set {
        Some(id) => vec![
            sets.get_key_value(id)
                .ok_or_else(|| PushError::NoSuchSet(id.clone()))?
                .0,
        ],
        None => sets.keys().collect(),
    };

    // Before any request: a branch that cannot be pushed refuses the push while nothing is changed on the hub.
    let orders = set_ids
        .into_iter()
        .map(|set_id| Ok((set_id, branch_order(repo, set_id)?)))
        .collect::<Result<Vec<_>, PushError>>()?;

    let mut report = PushReport::default();
    let binding = match binding {
        Some(binding) => binding,
        None => {
            let (bound, binding) = bind(repo, remote, options.project.as_deref())?;
            report.bound = Some(bound);
            binding
        }
    };
    let hub = HubRepo {
        remote,
        id: binding.repo,
    };
    let send_samples = if options.saves_only {
        false
    } else {
        let setting = hub::repo(remote, binding.repo)?.push_samples();
        repo.cache_push_samples(setting)?;
        setting.pushing() && !options.skip_samples
    };
    let mut shared = Shared::new(observer);
    for (set_id, branches) in orders {
        let mut pushed = match repo.pushed_to(set_id, &binding)? {
            Some(pushed) => pushed,
            None => adopt(repo, &hub, &binding, set_id, &sets[set_id])?,
        };
        for branch in branches {
            let mut push = BranchPush {
                set_id: set_id.clone(),
                branch,
                saves: 0,
                commits: 0,
                objects_stored: 0,
                objects_known: 0,
                objects_claimed: 0,
                segments: 0,
                lineage: 0,
                samples: SamplesPush::default(),
            };
            let history = push_branch(
                repo,
                &hub,
                &mut pushed,
                &mut push,
                batching,
                &mut shared,
                options.saves_only,
            )?;
            if !options.saves_only {
                push_lineage(
                    repo,
                    &hub,
                    &mut pushed,
                    &mut push,
                    &history,
                    batching,
                    &mut shared,
                )?;
            }
            let refusal = if send_samples {
                push_samples(
                    repo,
                    &hub,
                    &mut pushed,
                    &mut push,
                    &history,
                    batching,
                    &mut shared,
                )?
            } else {
                None
            };
            if push.saves > 0 || push.commits > 0 || push.lineage > 0 || !push.samples.is_empty() {
                report.branches.push(push);
            }
            if let Some(message) = refusal {
                return Err(PushError::StorageLimit {
                    message,
                    report: Box::new(report),
                });
            }
        }
    }
    Ok(report)
}

/// What the next push would send, per branch, from local state alone: of the set `set` names, or of every set. On an
/// unbound repo, and for a set the bound hub repo has not adopted, everything is pending.
pub fn pending(repo: &Repo, set: Option<&str>) -> Result<Vec<Pending>, RepoError> {
    let binding = repo.remote_binding()?;
    let sampling = repo
        .push_samples()?
        .is_some_and(|setting| setting.pushing());
    let mut pending = Vec::new();
    for set_id in repo.sets()?.into_keys() {
        if set.is_some_and(|set| set != set_id) {
            continue;
        }
        let pushed = match &binding {
            Some(binding) => repo.pushed_to(&set_id, binding)?.unwrap_or_default(),
            None => PushedSet::default(),
        };
        let branches = repo.branch_files(&set_id)?.into_keys();
        for branch in std::iter::once(MAIN_BRANCH.to_string()).chain(branches) {
            let state = pushed.branches.get(&branch);
            let recorded = state.and_then(|state| state.commit);
            let sent: HashSet<&ObjectId> = state.iter().flat_map(|state| &state.saves).collect();
            let history = repo.history(&set_id, &branch)?;
            let log = repo.log(&set_id, &branch)?;
            let saves = log.iter().filter(|id| !sent.contains(id)).count();
            let commits = pending_commits(&history, &branch, recorded).len();
            let samples = if sampling {
                pending_commits(&history, &branch, state.and_then(|state| state.samples))
                    .into_iter()
                    .filter(|entry| !sample_leaves(entry).is_empty())
                    .count()
            } else {
                0
            };
            if saves > 0 || commits > 0 || samples > 0 {
                pending.push(Pending {
                    set_id: set_id.clone(),
                    branch,
                    saves,
                    commits,
                    samples,
                });
            }
        }
    }
    Ok(pending)
}

/// Creates the hub repo for an unbound repo, named after its folder, in the chosen project, and binds the repo to it.
fn bind(
    repo: &Repo,
    remote: &Remote,
    project: Option<&str>,
) -> Result<(Bound, RemoteBinding), PushError> {
    let project = choose_project(
        hub::projects(remote)?,
        project,
        remote.client().instance().host(),
    )?;
    let binding = bind_project(repo, remote, project.id)?;
    let bound = Bound {
        project: project.name,
        repo_id: binding.repo,
    };
    Ok((bound, binding))
}

/// Creates the hub repo for an unbound repo, named after its folder, in the project `project_id`, and binds the repo
/// to it.
pub(super) fn bind_project(
    repo: &Repo,
    remote: &Remote,
    project_id: i64,
) -> Result<RemoteBinding, PushError> {
    let name = repo
        .root()
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let repo_id = hub::create_repo(remote, project_id, &name)?;
    let binding = RemoteBinding {
        instance: remote.client().instance().url().to_string(),
        repo: repo_id,
    };
    repo.bind_remote(&binding)?;
    Ok(binding)
}

/// The project named `name`, exactly or else ignoring case; without a name, the user's only project.
fn choose_project(
    projects: Vec<Project>,
    name: Option<&str>,
    host: &str,
) -> Result<Project, PushError> {
    if projects.is_empty() {
        return Err(PushError::NoProjects {
            host: host.to_string(),
        });
    }
    let Some(name) = name else {
        return match <[Project; 1]>::try_from(projects) {
            Ok([only]) => Ok(only),
            Err(projects) => Err(PushError::SeveralProjects(
                projects.into_iter().map(|project| project.name).collect(),
            )),
        };
    };
    let folded = name.to_lowercase();
    let at = projects
        .iter()
        .position(|project| project.name == name)
        .or_else(|| {
            projects
                .iter()
                .position(|project| project.name.to_lowercase() == folded)
        });
    match at {
        Some(at) => Ok(projects.into_iter().nth(at).expect("a found position")),
        None => Err(PushError::NoSuchProject {
            name: name.to_string(),
            host: host.to_string(),
        }),
    }
}

/// Adopts a set into the hub repo `binding` names and records its session, with nothing pushed yet.
fn adopt(
    repo: &Repo,
    hub: &HubRepo,
    binding: &RemoteBinding,
    set_id: &str,
    main_rel: &str,
) -> Result<PushedSet, PushError> {
    let file_name = main_rel.rsplit('/').next().unwrap_or(main_rel);
    let pushed = PushedSet {
        instance: binding.instance.clone(),
        repo_id: binding.repo,
        session_id: hub.adopt_set(set_id, file_name)?,
        branches: Default::default(),
    };
    repo.write_pushed(set_id, &pushed)?;
    Ok(pushed)
}

/// The set's branches in push order: `main`, then the others in `sets.toml` order, except that a branch checked out
/// from another branch's commit waits until that branch has gone, so its first commit's parent is on the hub first.
fn branch_order(repo: &Repo, set_id: &str) -> Result<Vec<String>, PushError> {
    let others = repo.branch_files(set_id)?;
    let mut waiting = Vec::new();
    for branch in others.keys() {
        let fork = fork_of(repo, set_id, branch)?;
        if let Some(fork) = &fork
            && fork != MAIN_BRANCH
            && !others.contains_key(fork)
        {
            return Err(PushError::UnpushableFork {
                branch: branch.clone(),
                fork: fork.clone(),
            });
        }
        waiting.push((branch.clone(), fork));
    }

    let mut order = vec![MAIN_BRANCH.to_string()];
    while !waiting.is_empty() {
        let ready = waiting.iter().position(|(_, fork)| {
            fork.as_ref()
                .is_none_or(|fork| order.iter().any(|done| done == fork))
        });
        let Some(ready) = ready else {
            let (branch, fork) = waiting.swap_remove(0);
            return Err(PushError::UnpushableFork {
                branch,
                fork: fork.expect("a waiting branch has a fork"),
            });
        };
        order.push(waiting.remove(ready).0);
    }
    Ok(order)
}

/// The branch whose commit `branch` was checked out from: the branch of the first commit back from its head that is
/// not on `branch`. `None` for a branch whose lineage never leaves it.
fn fork_of(repo: &Repo, set_id: &str, branch: &str) -> Result<Option<String>, RepoError> {
    let mut current = repo.read_ref(set_id, branch)?;
    while let Some(id) = current {
        let commit = repo.read_commit(&id)?;
        if commit.branch != branch {
            return Ok(Some(commit.branch));
        }
        current = commit.parent;
    }
    Ok(None)
}

/// The commits of `history` the hub has not recorded on `branch`, oldest first: from the head back to the recorded
/// commit, stopping at the first commit of another branch, which goes with its own branch.
fn pending_commits<'h>(
    history: &'h [HistoryEntry],
    branch: &str,
    recorded: Option<ObjectId>,
) -> Vec<&'h HistoryEntry> {
    let mut pending = history
        .iter()
        .take_while(|entry| Some(entry.id) != recorded && entry.commit.branch == branch)
        .collect::<Vec<_>>();
    pending.reverse();
    pending
}

type Objects = Vec<(ObjectId, ObjectKind)>;

/// Commits cut into requests by the object ids they list: the commit items, and how many ids they list, repeats
/// included, which is what a request body carries.
#[derive(Default)]
struct CommitBatch {
    items: Vec<CommitItem>,
    listed: usize,
}

impl CommitBatch {
    /// Whether a commit listing `listed` ids joins without the batch passing `limit` ids. A batch holds at least one
    /// commit whatever it lists.
    fn fits(&self, listed: usize, limit: usize) -> bool {
        self.items.is_empty() || self.listed + listed <= limit
    }

    fn add(&mut self, item: CommitItem, listed: usize) {
        self.listed += listed;
        self.items.push(item);
    }
}

/// A run of commits sent together, with the objects their saves list, deduplicated, in the order first listed.
#[derive(Default)]
struct Run {
    commits: CommitBatch,
    objects: Objects,
    seen: HashSet<ObjectId>,
    /// The first save of the run that lists each object.
    origins: HashMap<ObjectId, ObjectId>,
}

impl Run {
    /// `error` naming the save of the run its object was listed from, when it is an object that cannot be pushed.
    fn locate(&self, set_id: &str, error: PackError) -> PackError {
        let save = match &error {
            PackError::TooBig { id, .. } => self.origins.get(id).copied(),
            _ => None,
        };
        match save {
            Some(save) => error.at(set_id, save),
            None => error,
        }
    }

    fn add(&mut self, item: CommitItem, objects: Objects) {
        for save in &item.saves {
            for object in &save.objects {
                self.origins.entry(*object).or_insert(save.hash);
            }
        }
        self.commits.add(item, objects.len());
        for (id, kind) in objects {
            if self.seen.insert(id) {
                self.objects.push((id, kind));
            }
        }
    }
}

/// Pushes one branch's pending saves and time spans, then its pending commits run by run, recording each step the hub
/// confirms; with `saves_only` it stops after the spans. Returns the branch's history as it was read before the push
/// (empty for `saves_only`), which the lineage and sample phases go through.
fn push_branch(
    repo: &Repo,
    hub: &HubRepo,
    pushed: &mut PushedSet,
    push: &mut BranchPush,
    batching: &Batching,
    shared: &mut Shared<'_>,
    saves_only: bool,
) -> Result<Vec<HistoryEntry>, PushError> {
    let (set_id, branch) = (push.set_id.as_str(), push.branch.as_str());
    // History before the log: every save a commit in this history covers is then in the log read after it. Read the
    // other way round, a save and commit recorded in between would reach the hub as a commit of an unsent save.
    let history = if saves_only {
        Vec::new()
    } else {
        repo.history(set_id, branch)?
    };
    let log = repo.log(set_id, branch)?;
    let state = pushed.branches.entry(branch.to_string()).or_default();
    let recorded = state.commit;
    let sent: HashSet<ObjectId> = state.saves.iter().copied().collect();
    let unsent: Vec<ObjectId> = log.into_iter().filter(|id| !sent.contains(id)).collect();

    for chunk in unsent.chunks(batching.saves.max(1)) {
        shared.notify(PushProgress::Between)?;
        let saves = chunk
            .iter()
            .map(|id| repo.read_save(id).map(|save| (*id, save)))
            .collect::<Result<Vec<_>, _>>()?;
        hub.push_saves(set_id, branch, &saves)?;
        branch_state(pushed, branch).saves.extend_from_slice(chunk);
        repo.write_pushed(set_id, pushed)?;
        push.saves += chunk.len();
    }

    push.segments += push_segments(repo, hub, pushed, set_id, branch)?;
    if saves_only {
        return Ok(history);
    }

    let mut run = Run::default();
    for entry in pending_commits(&history, branch, recorded) {
        let (item, objects) = commit_item(repo, entry, &mut shared.leaves)?;
        if !run.commits.fits(objects.len(), batching.run_objects) {
            send_run(repo, hub, pushed, push, &std::mem::take(&mut run), shared)?;
        }
        run.add(item, objects);
    }
    if !run.commits.items.is_empty() {
        send_run(repo, hub, pushed, push, &run, shared)?;
    }
    Ok(history)
}

/// The most time spans one `POST /segments` carries.
const SEGMENTS_PER_POST: usize = 500;

/// Sends the spans of the branch's set that end after `PushedBranch::segments_through`, then moves it, and returns how
/// many it sent. Only once the hub holds a save of the branch, so the branch exists there.
fn push_segments(
    repo: &Repo,
    hub: &HubRepo,
    pushed: &mut PushedSet,
    set_id: &str,
    branch: &str,
) -> Result<usize, PushError> {
    let state = branch_state(pushed, branch);
    if state.saves.is_empty() {
        return Ok(0);
    }
    let through = state.segments_through;
    let spans: Vec<Segment> = repo
        .segments(set_id, branch)?
        .into_iter()
        .filter(|span| through.is_none_or(|through| span.end > through))
        .collect();
    let machine = hub_name(hub.remote.client().machine());
    let mut sent = 0;
    for chunk in spans.chunks(SEGMENTS_PER_POST) {
        hub.push_segments(set_id, branch, machine, chunk)?;
        let newest = chunk.iter().map(|span| span.end).max();
        let state = branch_state(pushed, branch);
        state.segments_through = state.segments_through.max(newest);
        repo.write_pushed(set_id, pushed)?;
        sent += chunk.len();
    }
    Ok(sent)
}

/// The commit's own Save and its Commit object: what the hub links to the commit as its lineage.
fn lineage_of(entry: &HistoryEntry) -> [(ObjectId, ObjectKind); 2] {
    [
        (entry.commit.save, ObjectKind::Save),
        (entry.id, ObjectKind::Commit),
    ]
}

/// Commits of the lineage phase waiting to be posted, with the two objects each names.
#[derive(Default)]
struct LineageBatch {
    commits: CommitBatch,
    objects: Objects,
    last: Option<ObjectId>,
}

impl LineageBatch {
    /// Asks which of the batch's objects the repo lacks, uploads those in packs, posts the commits again naming them,
    /// then moves the cursor past the batch. A failed step leaves the cursor, and the next push redoes the batch.
    fn flush(
        &mut self,
        repo: &Repo,
        hub: &HubRepo,
        pushed: &mut PushedSet,
        push: &mut BranchPush,
        shared: &mut Shared<'_>,
    ) -> Result<(), PushError> {
        let batch = std::mem::take(self);
        let Some(last) = batch.last else {
            return Ok(());
        };
        shared.notify(PushProgress::Between)?;
        let ids = batch.objects.iter().map(|(id, _)| *id).collect::<Vec<_>>();
        let missing: HashSet<ObjectId> = hub.missing(&ids)?.missing.into_iter().collect();
        let wanted = batch
            .objects
            .iter()
            .filter(|(id, _)| missing.contains(id))
            .copied()
            .collect::<Vec<_>>();
        if !wanted.is_empty() {
            let max_bytes = shared.upload_limit(hub)?;
            for pack in packs(repo.store(), &wanted, max_bytes) {
                let pack = pack?;
                shared.notify(PushProgress::Between)?;
                hub.push_pack(&pack)?;
                shared.notify(PushProgress::Uploaded {
                    bytes: pack.len() as u64,
                })?;
            }
        }
        hub.push_commits(&push.set_id, &push.branch, &batch.commits.items)?;
        branch_state(pushed, &push.branch).lineage = Some(last);
        repo.write_pushed(&push.set_id, pushed)?;
        push.lineage += batch.commits.items.len();
        Ok(())
    }
}

/// The lineage phase: each commit of the branch after `PushedBranch::lineage`, oldest first, has its own Save and
/// Commit object asked for, uploaded when the hub lacks them, and the commit posted again naming them. The commits
/// are on the hub already: the commit phase ran first.
fn push_lineage(
    repo: &Repo,
    hub: &HubRepo,
    pushed: &mut PushedSet,
    push: &mut BranchPush,
    history: &[HistoryEntry],
    batching: &Batching,
    shared: &mut Shared<'_>,
) -> Result<(), PushError> {
    let cursor = branch_state(pushed, &push.branch).lineage;
    let mut batch = LineageBatch::default();
    for entry in pending_commits(history, &push.branch, cursor) {
        let (mut item, listed) = commit_item(repo, entry, &mut shared.leaves)?;
        let lineage = lineage_of(entry);
        item.lineage_objects = lineage.iter().map(|(id, _)| *id).collect();
        if !batch.commits.fits(listed.len(), batching.run_objects) {
            batch.flush(repo, hub, pushed, push, shared)?;
        }
        batch.commits.add(item, listed.len());
        batch.objects.extend(lineage);
        batch.last = Some(entry.id);
    }
    batch.flush(repo, hub, pushed, push, shared)
}

/// The leaf ids of the samples the commit's own save references, listed once, in reference order. The commit's other
/// covered saves are not asked: a commit stands for the state of its own save.
fn sample_leaves(entry: &HistoryEntry) -> Vec<ObjectId> {
    let own = entry
        .saves
        .iter()
        .find(|(id, _)| *id == entry.commit.save)
        .map(|(_, save)| save);
    let mut seen = HashSet::new();
    own.into_iter()
        .flat_map(|save| &save.samples)
        .filter_map(|sample| sample.object)
        .filter(|object| seen.insert(*object))
        .collect()
}

/// The second phase: each commit of the branch after `PushedBranch::samples`, oldest first, has its sample objects
/// asked for (`missing`, which may link some without an upload), the rest uploaded in packs, then the cursor moved
/// past it, after re-posting the commit so the hub links the samples that landed. A pack the hub refuses as over its
/// storage cap ends the phase: the commits whose samples were complete are re-posted and passed, the commit being
/// sent stays pending, and the hub's message is returned. Any other failure is an error.
fn push_samples(
    repo: &Repo,
    hub: &HubRepo,
    pushed: &mut PushedSet,
    push: &mut BranchPush,
    history: &[HistoryEntry],
    batching: &Batching,
    shared: &mut Shared<'_>,
) -> Result<Option<String>, PushError> {
    let cursor = branch_state(pushed, &push.branch).samples;
    let mut batch = SampleBatch::default();
    for entry in pending_commits(history, &push.branch, cursor) {
        let mut objects = Objects::new();
        let mut seen = HashSet::new();
        for leaf in sample_leaves(entry) {
            for &(id, kind) in shared.leaves.of(repo.store(), leaf)? {
                if seen.insert(id) {
                    objects.push((id, kind));
                }
            }
        }
        if !objects.is_empty() {
            let ids = objects.iter().map(|(id, _)| *id).collect::<Vec<_>>();
            let held = hub.missing(&ids)?;
            push.samples.objects_claimed += held.claimed.len();
            let missing: HashSet<ObjectId> = held.missing.into_iter().collect();
            let wanted = objects
                .iter()
                .filter(|(id, _)| missing.contains(id))
                .copied()
                .collect::<Vec<_>>();
            if !wanted.is_empty() {
                let max_bytes = shared.upload_limit(hub)?;
                for pack in packs(repo.store(), &wanted, max_bytes) {
                    let pack = pack?;
                    shared.notify(PushProgress::Between)?;
                    match hub.push_pack(&pack) {
                        Ok(stored) => {
                            push.samples.objects_stored += stored.stored;
                            push.samples.objects_known += stored.known;
                            shared.notify(PushProgress::Uploaded {
                                bytes: pack.len() as u64,
                            })?;
                        }
                        Err(RemoteError::Refused {
                            status: 413,
                            code: Some(code),
                            message,
                            ..
                        }) if code == STORAGE_LIMIT_CODE => {
                            // The commits before this one have their samples; they still get their replay.
                            batch.flush(repo, hub, pushed, push)?;
                            return Ok(Some(message));
                        }
                        Err(error) => return Err(error.into()),
                    }
                }
            }
            let (item, listed) = commit_item(repo, entry, &mut shared.leaves)?;
            if !batch.commits.fits(listed.len(), batching.run_objects) {
                batch.flush(repo, hub, pushed, push)?;
            }
            batch.commits.add(item, listed.len());
            batch.sampled += 1;
        }
        batch.last = Some(entry.id);
    }
    batch.flush(repo, hub, pushed, push)?;
    Ok(None)
}

/// The commits whose samples are on the hub and are waiting to be posted again, with the newest commit passed (one
/// with no sample object included) the cursor moves to once the post succeeds.
#[derive(Default)]
struct SampleBatch {
    commits: CommitBatch,
    /// The commits of the batch that have sample objects.
    sampled: usize,
    last: Option<ObjectId>,
}

impl SampleBatch {
    /// Posts the batch's commits again, so the hub links the samples that landed, then moves the cursor past the
    /// batch. A failed post leaves the cursor, and the next push redoes the batch.
    fn flush(
        &mut self,
        repo: &Repo,
        hub: &HubRepo,
        pushed: &mut PushedSet,
        push: &mut BranchPush,
    ) -> Result<(), PushError> {
        let batch = std::mem::take(self);
        let Some(last) = batch.last else {
            return Ok(());
        };
        if !batch.commits.items.is_empty() {
            hub.push_commits(&push.set_id, &push.branch, &batch.commits.items)?;
        }
        branch_state(pushed, &push.branch).samples = Some(last);
        repo.write_pushed(&push.set_id, pushed)?;
        push.samples.commits += batch.sampled;
        Ok(())
    }
}

/// What a push keeps across its branches: the instance's upload limit, fetched once and only when something is
/// missing, the leaf objects each save lists, and the observer the push reports to.
struct Shared<'o> {
    limit: Option<usize>,
    leaves: LeafObjects,
    observer: &'o mut dyn FnMut(PushProgress) -> ControlFlow<()>,
}

impl<'o> Shared<'o> {
    fn new(observer: &'o mut dyn FnMut(PushProgress) -> ControlFlow<()>) -> Self {
        Shared {
            limit: None,
            leaves: LeafObjects::default(),
            observer,
        }
    }

    /// Tells the observer `progress`; its `Break` ends the push with [`PushError::Stopped`].
    fn notify(&mut self, progress: PushProgress) -> Result<(), PushError> {
        match (self.observer)(progress) {
            ControlFlow::Continue(()) => Ok(()),
            ControlFlow::Break(()) => Err(PushError::Stopped),
        }
    }

    /// The instance's upload limit, asked of the hub the first time it is needed.
    fn upload_limit(&mut self, hub: &HubRepo) -> Result<usize, PushError> {
        match self.limit {
            Some(max_bytes) => Ok(max_bytes),
            None => Ok(*self.limit.insert(hub::upload_limit(hub.remote)?)),
        }
    }
}

/// The commit as the hub takes it, and every object id its saves list, in the order listed, repeats included.
fn commit_item(
    repo: &Repo,
    entry: &HistoryEntry,
    leaves: &mut LeafObjects,
) -> Result<(CommitItem, Objects), PushError> {
    let commit = &entry.commit;
    let mut objects = Vec::new();
    let mut saves = Vec::with_capacity(entry.saves.len());
    let mut machine = None;
    for (id, save) in &entry.saves {
        if *id == commit.save {
            machine = Some(save.machine.clone());
        }
        let listed = save_objects_cached(repo.store(), save, leaves)?;
        saves.push(CommitSave {
            hash: *id,
            objects: listed.iter().map(|(id, _)| *id).collect(),
        });
        objects.extend(listed);
    }
    let machine_name = match machine {
        Some(machine) => machine,
        None => repo.read_save(&commit.save)?.machine,
    };
    let item = CommitItem {
        hash: entry.id,
        save_hash: commit.save,
        parent_hash: commit.parent,
        message: commit.message.clone(),
        kind: commit.kind,
        committed_at: commit.at,
        machine_name,
        saves,
        sample_objects: sample_leaves(entry),
        lineage_objects: Vec::new(),
    };
    Ok((item, objects))
}

/// Sends one run: the objects the hub repo lacks, in packs, then the commits; records the run's last commit once the
/// hub has it. When the hub refuses the commits for objects the repo does not hold, the run asks for the missing
/// objects, uploads them and sends the commits once more, then gives up with the hub's message.
fn send_run(
    repo: &Repo,
    hub: &HubRepo,
    pushed: &mut PushedSet,
    push: &mut BranchPush,
    run: &Run,
    shared: &mut Shared<'_>,
) -> Result<(), PushError> {
    shared.notify(PushProgress::Between)?;
    let mut asked_again = false;
    loop {
        let ids = run.objects.iter().map(|(id, _)| *id).collect::<Vec<_>>();
        let held = hub.missing(&ids)?;
        push.objects_claimed += held.claimed.len();
        let missing: HashSet<ObjectId> = held.missing.into_iter().collect();
        let wanted = run
            .objects
            .iter()
            .filter(|(id, _)| missing.contains(id))
            .copied()
            .collect::<Vec<_>>();
        if !wanted.is_empty() {
            let max_bytes = shared.upload_limit(hub)?;
            for pack in packs(repo.store(), &wanted, max_bytes) {
                let pack = pack.map_err(|error| run.locate(&push.set_id, error))?;
                shared.notify(PushProgress::Between)?;
                let stored = hub.push_pack(&pack)?;
                push.objects_stored += stored.stored;
                push.objects_known += stored.known;
                shared.notify(PushProgress::Uploaded {
                    bytes: pack.len() as u64,
                })?;
            }
        }
        match hub.push_commits(&push.set_id, &push.branch, &run.commits.items) {
            Ok(()) => break,
            Err(RemoteError::Refused {
                status: 409,
                message,
                ..
            }) if !asked_again && message.starts_with(OBJECTS_NOT_HELD) => asked_again = true,
            Err(error) => return Err(error.into()),
        }
    }
    let last = run.commits.items.last().expect("a run holds a commit").hash;
    branch_state(pushed, &push.branch).commit = Some(last);
    repo.write_pushed(&push.set_id, pushed)?;
    push.commits += run.commits.items.len();
    Ok(())
}

fn branch_state<'p>(pushed: &'p mut PushedSet, branch: &str) -> &'p mut PushedBranch {
    pushed.branches.entry(branch.to_string()).or_default()
}
