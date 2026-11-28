//! Folds what the daemon reports into the [`Snapshot`] the panel and the bar read.
//!
//! Everything that is a decision about what the panel shows lives here and runs without a window, a repo or a
//! clock: the repo is read through [`Readout`], which a test replaces. Each mutator ends in [`Reducer::derive`], so
//! the fields that are functions of the others (the saves' push dots, the push state, the bar's title) are never
//! stale.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::renders::shown_file;
use dit_core::{Clause, SetMeta, StructureTrack, TrackKind};
use dit_daemon::event::{DaemonEvent, OpenSetInfo, Origin};
use dit_daemon::queue::PushEvent;
use dit_daemon::script::{ScriptEvent, ScriptMessage, ScriptTrack};
use dit_daemon::{RenderEvent, RenderState};

use crate::snapshot::{
    AdoptOffer, Adopting, AdoptingSet, AdoptingState, Artwork, Auth, BackfillState, Connection,
    HeadCommit, HubProject, LastCommit, OpenSet, OpenTrack, PendingRestore, PushPhase,
    PushProgress, PushState, RenderCard, RenderSet, RepoRow, RestoreState, SavePush, SaveRow,
    ScriptPhase, Settings, Snapshot, TrackChoice, TrackProposal, UpdateState,
};

/// How many notices the panel keeps: the newest.
const NOTICES: usize = 5;

/// How many renders that were added during this run stay on the panel as cards.
const ADDED_SHOWN: usize = 3;

/// A render the producer turned down has no card.
fn is_gone(render: &RenderEvent) -> bool {
    render.state == RenderState::Rejected
}

/// What the open set's repo says about it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SetReadout {
    /// The saves since the set's last commit, newest first.
    pub saves: Vec<SaveRow>,
    pub last_commit: Option<HeadCommit>,
    /// Seconds in the set since the last commit.
    pub time_since_commit: Option<u64>,
    /// The set has no commit of the user's.
    pub first_commit: bool,
    /// The head commit's save's meta.
    pub head_meta: Option<SetMeta>,
    /// The newest save's meta, else the head's.
    pub latest_meta: Option<SetMeta>,
    /// The suggested message's parts, head to newest save.
    pub clauses: Vec<Clause>,
    /// The tracks whose content changed since the head.
    pub tracks_changed: Vec<String>,
    /// The hub session the set is, once a push has made it one on the instance the repo is bound to.
    pub session_id: Option<i64>,
}

/// What the hub knows of a set's session that the panel shows, read by the app.
#[derive(Debug, Clone, PartialEq)]
pub struct HubSet {
    /// The set file the facts are of.
    pub path: String,
    pub session_id: i64,
    pub project_id: i64,
    pub artwork: Option<Artwork>,
    /// The session already has a track.
    pub has_track: bool,
    /// The track the session is linked to, when assigned.
    pub track: Option<OpenTrack>,
    /// The hub's tracks the set may be, best first; read while the session has none.
    pub choices: Vec<TrackChoice>,
}

/// What the app asks the hub about the open set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HubTarget {
    pub path: String,
    pub session_id: i64,
    /// The set's name, and its folder's without ` Project`: what a track is matched to.
    pub set_name: String,
    pub folder_name: String,
}

/// A repo's hub repo: the instance it was bound on and its id there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HubRepo {
    pub instance: String,
    pub repo_id: i64,
}

/// A set of a repo that is a session on the hub.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HubSetRef {
    /// The instance the repo is bound to.
    pub instance: String,
    pub session_id: i64,
    pub name: String,
}

/// What a repo says of itself for the repo list.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RepoFacts {
    /// The newest commit of any set and branch.
    pub last_commit: Option<LastCommit>,
    /// Epoch milliseconds of the newest save or commit.
    pub last_active_at: Option<i64>,
    pub hub: Option<HubRepo>,
    /// The repo's sets that were pushed to its hub as sessions.
    pub hub_sets: Vec<HubSetRef>,
}

/// What the machine says of Live's script.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ScriptFacts {
    /// Live is installed on this computer.
    pub live_found: bool,
    /// The script is in Live's User Library.
    pub installed: bool,
    /// The folder it is installed in; `None` while it is not.
    pub path: Option<String>,
}

/// What the adopt offer says of a project folder.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FolderFacts {
    /// The names of the sets of the DAW the folder holds.
    pub sets: Vec<String>,
    /// The sync service the folder sits in.
    pub synced_by: Option<String>,
}

/// Reads a repo, and a folder that is not one yet.
pub trait Readout: Send + Sync {
    /// One branch of a set. `None` when the repo cannot be read now (moved, locked for good): the panel then shows
    /// nothing of it.
    fn read(&self, repo: &Path, set_id: &str, branch: &str) -> Option<SetReadout>;

    /// The `#rrggbb` of a DAW palette entry, for the tracks its script reports by index.
    fn track_colour(&self, _index: i64) -> Option<String> {
        None
    }

    /// The display name a saved set writes for a live device with `class_name` and `name`.
    fn device_display_name(&self, _class_name: &str, name: &str) -> String {
        name.to_string()
    }

    /// The repo as a row of the list shows it; nothing when it cannot be read.
    fn repo(&self, _repo: &Path) -> RepoFacts {
        RepoFacts::default()
    }

    /// The folder as the adopt offer describes it.
    fn folder(&self, _folder: &Path) -> FolderFacts {
        FolderFacts::default()
    }

    /// How long the audio file at `path` plays, in milliseconds; `None` when it cannot be read.
    fn duration_ms(&self, _file: &Path) -> Option<u64> {
        None
    }
}

/// The branch the panel is showing.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Focus {
    repo: PathBuf,
    set_id: String,
    branch: String,
}

/// Where one repo stands with the hub.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Wait {
    Wanted,
    Pushing,
    Waiting(String),
    Failed(String),
}

pub struct Reducer {
    snapshot: Snapshot,
    readout: Arc<dyn Readout>,
    focus: Option<Focus>,
    /// The open set's branch as the repo gave it, before the push overlay.
    read: SetReadout,
    /// Repos with something not yet on the hub. Empty without a hub.
    waits: BTreeMap<PathBuf, Wait>,
    /// A hub sign-in is held and its pushes are routed.
    hub: bool,
    script: ScriptFacts,
    /// The hub repo each tracked repo is bound to.
    hub_repos: BTreeMap<PathBuf, HubRepo>,
    /// The hub project each hub repo is in, by repo id: what turns a repo into a page of the web.
    repo_projects: BTreeMap<i64, i64>,
    /// The commit box's text for each set, by the set file's path.
    drafts: HashMap<String, String>,
    /// The tracks the script last said the open document has, and which document that was.
    live: Option<Vec<StructureTrack>>,
    script_document: Option<String>,
    /// The hub's word on one set's session, which the readout's session decides is still the open set's.
    hub_set: Option<HubSet>,
    /// The renders the engine has not rejected, as it last said them.
    renders: Vec<RenderEvent>,
    /// Renders that were added during this run, oldest first; only these (and the newest few) stay as cards.
    added: Vec<u64>,
    /// How long each audio file shown on a card plays, read once.
    durations: HashMap<PathBuf, Option<u64>>,
    /// The sets of each tracked repo that are sessions on the hub.
    repo_sets: BTreeMap<PathBuf, Vec<HubSetRef>>,
    /// The repo the panel just adopted, by the path the daemon tracks it under, while its sets' first saves land.
    adopting: Option<PathBuf>,
    /// The repos wanted by the hub since it was last caught up: what a push's progress counts.
    burst: BTreeSet<PathBuf>,
}

fn name_of(path: &Path) -> String {
    path.file_name().map_or_else(
        || path.display().to_string(),
        |name| name.to_string_lossy().into_owned(),
    )
}

fn stem_of(path: &Path) -> String {
    path.file_stem().map_or_else(
        || path.display().to_string(),
        |stem| stem.to_string_lossy().into_owned(),
    )
}

/// The title a new track for a set would have: the folder's name without ` Project`, the set's name when the folder
/// has none or is nothing but that word.
pub fn new_track_title(folder: Option<&str>, set_name: &str) -> String {
    folder
        .map(|folder| name_of(Path::new(folder)))
        .map(|name| {
            name.strip_suffix(" Project")
                .unwrap_or(&name)
                .trim()
                .to_string()
        })
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| set_name.to_string())
}

/// A track the script reported, as the structure a save's meta holds.
fn structure_track(track: &ScriptTrack, readout: &dyn Readout) -> StructureTrack {
    StructureTrack {
        kind: match track.kind.as_str() {
            "audio" => TrackKind::Audio,
            "midi" => TrackKind::Midi,
            "return" => TrackKind::Return,
            "group" => TrackKind::Group,
            "master" => TrackKind::Master,
            _ => TrackKind::Other,
        },
        name: track.name.clone(),
        devices: track
            .devices
            .iter()
            .map(|device| {
                readout
                    .device_display_name(device.class_name.as_deref().unwrap_or(""), &device.name)
            })
            .collect(),
        id: Some(track.id),
        group_id: track.group_id,
        color: track.color.and_then(|index| readout.track_colour(index)),
    }
}

impl Reducer {
    pub fn new(snapshot: Snapshot, readout: Arc<dyn Readout>) -> Reducer {
        let mut reducer = Reducer {
            script: ScriptFacts {
                live_found: snapshot.script.state != ScriptPhase::LiveNotFound,
                installed: matches!(
                    snapshot.script.state,
                    ScriptPhase::Installed | ScriptPhase::Connected
                ),
                path: snapshot.script.path.clone(),
            },
            snapshot,
            readout,
            focus: None,
            read: SetReadout::default(),
            waits: BTreeMap::new(),
            hub: false,
            hub_repos: BTreeMap::new(),
            repo_projects: BTreeMap::new(),
            drafts: HashMap::new(),
            live: None,
            script_document: None,
            hub_set: None,
            renders: Vec::new(),
            added: Vec::new(),
            durations: HashMap::new(),
            repo_sets: BTreeMap::new(),
            adopting: None,
            burst: BTreeSet::new(),
        };
        reducer.derive();
        reducer
    }

    pub fn snapshot(&self) -> &Snapshot {
        &self.snapshot
    }

    /// Takes in one thing the daemon reported.
    pub fn apply(&mut self, event: &DaemonEvent) {
        if let DaemonEvent::SaveRecorded {
            repo,
            file,
            origin: Origin::Adopt,
            ..
        } = event
        {
            self.adopt_saved(repo, file);
        }
        match event {
            DaemonEvent::SaveRecorded { repo, .. } => {
                self.touch(repo);
                self.want(repo);
                self.reread_if_open(repo);
            }
            DaemonEvent::Committed {
                repo,
                set_id,
                branch,
                ..
            } => {
                self.clear_draft_for(repo, set_id, branch);
                self.touch(repo);
                self.want(repo);
                self.reread_if_open(repo);
            }
            DaemonEvent::OpenSet(info) => self.open(info.as_ref()),
            DaemonEvent::LiveRunning(running) => self.snapshot.live = *running,
            DaemonEvent::Script(ScriptEvent::Connected { live, .. }) => {
                self.live = None;
                self.script_document = None;
                self.snapshot.script.live = Some(live.clone());
                self.show_script();
            }
            DaemonEvent::Script(ScriptEvent::Disconnected) => self.script_gone(),
            DaemonEvent::Script(ScriptEvent::Message(message)) => self.script_said(message),
            DaemonEvent::AdoptOffer { folder, set } => self.offer(folder, set),
            DaemonEvent::RepoTracked { repo } => self.tracked(repo),
            DaemonEvent::RepoUnreachable { repo, message } => {
                self.row(repo).unreachable = Some(message.clone());
                self.waits.remove(repo);
            }
            DaemonEvent::RepoBusy { repo } => self.row(repo).busy = true,
            DaemonEvent::GaveUp { file, .. } => self.notice(format!(
                "{} stayed unreadable, so dit left it. It is tried again when it changes.",
                name_of(file)
            )),
            DaemonEvent::RepoError { message, .. } => self.notice(message.clone()),
            DaemonEvent::Push(push) => self.pushed(push),
            DaemonEvent::SignedOut { host } => {
                let host = self
                    .snapshot
                    .auth
                    .host
                    .clone()
                    .unwrap_or_else(|| host.clone());
                self.snapshot.auth = Auth {
                    state: crate::snapshot::AuthState::Revoked,
                    host: Some(host),
                    pending: None,
                };
                self.snapshot.connection = Connection::Refused;
                self.waits.clear();
            }
            DaemonEvent::MachineRefused { message } => {
                self.snapshot.connection = Connection::Refused;
                self.snapshot.machine.refused = self.snapshot.machine.name.take();
                self.notice(message.clone());
            }
            DaemonEvent::Render(card) => self.render(card),
            DaemonEvent::RejectionsSynced | DaemonEvent::Launched | DaemonEvent::Adopted { .. } => {
            }
        }
        self.derive();
    }

    /// Reads the open set's repo again: what a commit made outside the daemon, or the passing of time, changed.
    pub fn refresh(&mut self) {
        self.reread_current();
        self.derive();
    }

    pub fn set_auth(&mut self, auth: Auth) {
        self.snapshot.auth = auth;
        self.derive();
    }

    /// Whether a hub sign-in is held, and the name this machine beats as. Without one nothing is pushed.
    pub fn set_hub(&mut self, machine: Option<String>) {
        self.hub = machine.is_some();
        self.snapshot.machine.name = machine;
        self.snapshot.machine.refused = None;
        self.snapshot.connection = if self.hub {
            Connection::Online
        } else {
            self.waits.clear();
            Connection::NoHub
        };
        self.derive();
    }

    /// What the machine says of Live's script: whether Live is installed and the script is, and where. The snapshot's
    /// script state follows, a connected script staying connected.
    pub fn set_script(&mut self, facts: ScriptFacts) {
        self.script = facts;
        self.show_script();
        self.derive();
    }

    /// Whether a newer release is on offer, and how far taking it is.
    pub fn set_update(&mut self, update: UpdateState) {
        self.snapshot.update = update;
    }

    /// How the backfill run stands, `None` with no run or once every folder is finished.
    pub fn set_backfill(&mut self, backfill: Option<BackfillState>) {
        self.snapshot.backfill = backfill;
    }

    pub fn set_screen_recording(&mut self, granted: bool) {
        self.snapshot.permissions.screen_recording = granted;
    }

    pub fn set_settings(&mut self, settings: Settings) {
        self.snapshot.settings = settings;
    }

    /// The restore link the panel shows, or none once it is let go (which also ends whatever the restore screen
    /// said).
    pub fn set_pending_restore(&mut self, restore: Option<PendingRestore>) {
        let same_commit = restore
            .as_ref()
            .zip(self.snapshot.pending_restore.as_ref())
            .is_some_and(|(new, held)| new.commit_id == held.commit_id);
        if !same_commit {
            self.snapshot.restore = RestoreState::Idle;
        }
        self.snapshot.pending_restore = restore;
    }

    /// What the hub said of the commit the restore link names, when that is still the commit shown.
    pub fn fill_pending_restore(&mut self, commit_id: i64, fill: impl FnOnce(&mut PendingRestore)) {
        if let Some(pending) = self
            .snapshot
            .pending_restore
            .as_mut()
            .filter(|pending| pending.commit_id == commit_id)
        {
            fill(pending);
        }
    }

    pub fn set_restore(&mut self, restore: RestoreState) {
        self.snapshot.restore = restore;
    }

    /// The renders the engine holds, as it says them now: what a hub just attached starts with, and none when the hub
    /// is gone. Renders added before this run began are not shown again.
    pub fn set_renders(&mut self, renders: Vec<RenderEvent>) {
        let kept: Vec<RenderEvent> = renders
            .into_iter()
            .filter(|card| {
                !is_gone(card)
                    && (card.state != RenderState::Added || self.added.contains(&card.id))
            })
            .collect();
        for card in &kept {
            self.learn_duration(card);
        }
        self.renders = kept;
        self.trim_added();
        self.derive();
    }

    /// One render changed: it joins the cards, takes its place among them, or leaves when it was rejected.
    fn render(&mut self, card: &RenderEvent) {
        let at = self.renders.iter().position(|held| held.id == card.id);
        if is_gone(card) {
            if let Some(at) = at {
                self.renders.remove(at);
            }
            return;
        }
        if card.state == RenderState::Added && !self.added.contains(&card.id) {
            self.added.push(card.id);
        }
        self.learn_duration(card);
        match at {
            Some(at) => self.renders[at] = card.clone(),
            None => self.renders.push(card.clone()),
        }
        self.trim_added();
    }

    /// Reads how long the file a card shows plays, once per file.
    fn learn_duration(&mut self, render: &RenderEvent) {
        if render.state == RenderState::Waiting {
            return;
        }
        let Some(file) = shown_file(render) else {
            return;
        };
        if !self.durations.contains_key(&file.path) {
            let duration = self.readout.duration_ms(&file.path);
            self.durations.insert(file.path.clone(), duration);
        }
    }

    /// Only the newest few added renders stay as cards.
    fn trim_added(&mut self) {
        let from = self.added.len().saturating_sub(ADDED_SHOWN);
        let newest: Vec<u64> = self.added[from..].to_vec();
        self.renders
            .retain(|card| card.state != RenderState::Added || newest.contains(&card.id));
    }

    /// The cards: each render with how long it plays, the set it matched and the other sets of its repo.
    fn derive_renders(&mut self) {
        let host = self.snapshot.auth.host.as_deref();
        let on_host = |set: &&HubSetRef| Some(set.instance.as_str()) == host;
        let cards: Vec<RenderCard> = self
            .renders
            .iter()
            .map(|render| {
                // The sets of the repo that holds the render's session; every repo's when none does.
                let home = render.session_id.and_then(|id| {
                    self.repo_sets
                        .values()
                        .find(|sets| sets.iter().any(|set| set.session_id == id && on_host(&set)))
                });
                let mut pool: Vec<&HubSetRef> = match home {
                    Some(sets) => sets.iter().filter(on_host).collect(),
                    None => self.repo_sets.values().flatten().filter(on_host).collect(),
                };
                pool.sort_by(|a, b| (&a.name, a.session_id).cmp(&(&b.name, b.session_id)));
                pool.dedup_by_key(|set| set.session_id);
                RenderCard {
                    render: render.clone(),
                    duration_ms: shown_file(render)
                        .and_then(|file| self.durations.get(&file.path).copied().flatten()),
                    set: render.session_id.and_then(|id| {
                        pool.iter()
                            .find(|set| set.session_id == id)
                            .map(|set| set.name.clone())
                    }),
                    other_sets: pool
                        .iter()
                        .filter(|set| Some(set.session_id) != render.session_id)
                        .map(|set| RenderSet {
                            session_id: set.session_id,
                            name: set.name.clone(),
                        })
                        .collect(),
                }
            })
            .collect();
        self.snapshot.renders = cards;
    }

    /// The hub projects an adopt offer may add its folder to, and the one chosen last, which stands only when it is
    /// still one of them. Nothing happens when the offer is for another folder by now.
    pub fn set_offer_projects(
        &mut self,
        folder: &Path,
        projects: Vec<HubProject>,
        last: Option<i64>,
    ) {
        let Some(offer) = self
            .snapshot
            .adopt_offer
            .as_mut()
            .filter(|offer| Path::new(&offer.folder) == folder)
        else {
            return;
        };
        offer.project_id = last.filter(|id| projects.iter().any(|project| project.id == *id));
        offer.projects = projects;
    }

    /// The hub project each hub repo is in, which gives the repo list its links to the web.
    pub fn set_repo_projects(&mut self, projects: BTreeMap<i64, i64>) {
        self.repo_projects = projects;
        self.derive();
    }

    /// Whether a repo is bound to a hub repo on this instance whose project is not known yet: a first push has bound
    /// it.
    pub fn needs_projects(&self) -> bool {
        let host = self.snapshot.auth.host.as_deref();
        self.hub_repos.values().any(|hub| {
            Some(hub.instance.as_str()) == host && !self.repo_projects.contains_key(&hub.repo_id)
        })
    }

    /// The adopt offer is answered (or its folder is tracked some other way).
    pub fn clear_adopt_offer(&mut self, folder: &Path) {
        if self
            .snapshot
            .adopt_offer
            .as_ref()
            .is_some_and(|offer| Path::new(&offer.folder) == folder)
        {
            self.snapshot.adopt_offer = None;
        }
    }

    pub fn notice(&mut self, text: String) {
        self.snapshot.notices.retain(|held| *held != text);
        self.snapshot.notices.push(text);
        let extra = self.snapshot.notices.len().saturating_sub(NOTICES);
        self.snapshot.notices.drain(..extra);
    }

    pub fn clear_notices(&mut self) {
        self.snapshot.notices.clear();
    }

    /// Keeps `text` as the commit box's text for the set file at `set`; an empty one lets the draft go.
    pub fn set_draft(&mut self, set: String, text: String) {
        if text.is_empty() {
            self.drafts.remove(&set);
        } else {
            self.drafts.insert(set, text);
        }
        self.show_draft();
    }

    /// Clears stored drafts for sets inside `folder` (a commit made via the cli over the socket).
    pub fn clear_drafts_in(&mut self, folder: &Path) {
        self.drafts
            .retain(|set, _| !Path::new(set).starts_with(folder));
        self.show_draft();
    }

    /// Clears the open set's draft when the daemon reports a commit on its branch.
    fn clear_draft_for(&mut self, repo: &Path, set_id: &str, branch: &str) {
        let matches_focus = self.focus.as_ref().is_some_and(|focus| {
            focus.repo == repo && focus.set_id == set_id && focus.branch == branch
        });
        if matches_focus && let Some(open) = &self.snapshot.open {
            self.drafts.remove(&open.path);
        }
    }

    /// What the app asks the hub about the open set; `None` while there is nothing to ask (no sign-in, or the set is
    /// not a session on the hub yet).
    pub fn hub_target(&self) -> Option<HubTarget> {
        let open = self.snapshot.open.as_ref().filter(|_| self.hub)?;
        Some(HubTarget {
            path: open.path.clone(),
            session_id: self.read.session_id?,
            set_name: open.name.clone(),
            folder_name: new_track_title(open.repo.as_deref(), &open.name),
        })
    }

    /// What the hub said of a set's session.
    pub fn set_hub_set(&mut self, set: HubSet) {
        self.hub_set = Some(set);
        self.derive();
    }

    /// The adopt offer for a folder the producer chose to track, whichever of its sets is `set`.
    pub fn offer(&mut self, folder: &Path, set: &Path) {
        let facts = self.readout.folder(folder);
        self.snapshot.adopt_offer = Some(AdoptOffer {
            folder: folder.display().to_string(),
            set: set.display().to_string(),
            name: name_of(folder),
            set_count: facts.sets.len(),
            synced_by: facts.synced_by,
            projects: Vec::new(),
            project_id: None,
        });
    }

    /// The producer adopted `folder`, which the daemon tracks as `tracked`: its sets are listed as saving until each
    /// first save lands, and the list ends when every set has landed or [`Reducer::finish_adopting`] says the daemon
    /// is done with the folder.
    pub fn begin_adopting(&mut self, folder: &Path, tracked: PathBuf) {
        let sets: Vec<AdoptingSet> = self
            .readout
            .folder(folder)
            .sets
            .into_iter()
            .map(|name| AdoptingSet {
                name,
                state: AdoptingState::Saving,
            })
            .collect();
        self.adopting = Some(tracked);
        self.snapshot.adopting = Some(Adopting {
            folder: folder.display().to_string(),
            name: name_of(folder),
            set_count: sets.len(),
            sets,
        });
    }

    /// The daemon has recorded what it will of the folder tracked as `tracked`: the list of its sets goes, whichever
    /// have not landed (a set still being written is the watcher's, and records when it settles).
    pub fn finish_adopting(&mut self, tracked: &Path) {
        if self.adopting.as_deref() == Some(tracked) {
            self.adopting = None;
            self.snapshot.adopting = None;
        }
    }

    /// The first save of the set file `file` of an adopted repo landed.
    fn adopt_saved(&mut self, repo: &Path, file: &str) {
        if self.adopting.as_deref() != Some(repo) {
            return;
        }
        let Some(adopting) = &mut self.snapshot.adopting else {
            return;
        };
        let name = stem_of(Path::new(file));
        let waiting = adopting
            .sets
            .iter()
            .position(|set| set.name == name && set.state == AdoptingState::Saving);
        match waiting {
            Some(at) => adopting.sets[at].state = AdoptingState::Saved,
            None if !adopting.sets.iter().any(|set| set.name == name) => {
                adopting.sets.push(AdoptingSet {
                    name,
                    state: AdoptingState::Saved,
                });
            }
            None => {}
        }
        let landed = adopting
            .sets
            .iter()
            .filter(|set| set.state == AdoptingState::Saved)
            .count();
        if landed >= adopting.set_count {
            self.adopting = None;
            self.snapshot.adopting = None;
        }
    }

    /// What the script said of the open document's tracks.
    fn script_said(&mut self, message: &ScriptMessage) {
        match message {
            ScriptMessage::Tracks { tracks } => {
                self.live = Some(
                    tracks
                        .iter()
                        .map(|track| structure_track(track, self.readout.as_ref()))
                        .collect(),
                );
            }
            ScriptMessage::Document { path, .. } => {
                if self.script_document != *path {
                    self.live = None;
                    self.script_document = path.clone();
                }
            }
            ScriptMessage::Closed => {
                self.live = None;
                self.script_document = None;
            }
            ScriptMessage::Song { .. } | ScriptMessage::Transport { .. } => {}
        }
    }

    fn script_gone(&mut self) {
        self.live = None;
        self.script_document = None;
        self.snapshot.script.live = None;
        self.show_script();
    }

    /// The script's state, from what the machine says of it and whether it has said hello.
    fn show_script(&mut self) {
        let state = if self.snapshot.script.live.is_some() {
            ScriptPhase::Connected
        } else if !self.script.live_found {
            ScriptPhase::LiveNotFound
        } else if self.script.installed {
            ScriptPhase::Installed
        } else {
            ScriptPhase::NotInstalled
        };
        self.snapshot.script.state = state;
        self.snapshot.script.path = self.script.path.clone();
    }

    fn open(&mut self, info: Option<&OpenSetInfo>) {
        self.focus = info.and_then(|info| {
            Some(Focus {
                repo: info.repo.clone()?,
                set_id: info.set_id.clone()?,
                branch: info.branch.clone()?,
            })
        });
        self.snapshot.open = info.map(|info| OpenSet {
            path: info.path.display().to_string(),
            name: stem_of(&info.path),
            repo: info.repo.as_ref().map(|repo| repo.display().to_string()),
            branch: info.branch.clone(),
            signal: info.signal.into(),
            web_path: None,
            track: None,
        });
        if let Some(offer) = &self.snapshot.adopt_offer {
            let still_inside = info.is_some_and(|info| info.path.starts_with(&offer.folder));
            if !still_inside {
                self.snapshot.adopt_offer = None;
            }
        }
        self.reread();
    }

    /// What the hub says of the open set's session, when it is the one the facts are of and a sign-in is held.
    fn derive_hub_set(&mut self) {
        let open = self.snapshot.open.as_ref();
        let hub_set = self
            .hub_set
            .as_ref()
            .filter(|set| self.hub && open.is_some_and(|open| open.path == set.path))
            .filter(|set| self.read.session_id == Some(set.session_id));
        let proposal = hub_set
            .filter(|set| !set.has_track)
            .zip(open)
            .map(|(set, open)| TrackProposal {
                choices: set.choices.clone(),
                new_track: new_track_title(open.repo.as_deref(), &open.name),
            });
        self.snapshot.artwork = hub_set.and_then(|set| set.artwork.clone());
        self.snapshot.track_proposal = proposal;
        let track = hub_set.and_then(|set| set.track.clone());
        let web_path = hub_set.map(|set| match &set.track {
            Some(track) => format!("/project/{}/track/{}", set.project_id, track.id),
            None => format!("/project/{}/session/{}", set.project_id, set.session_id),
        });
        self.snapshot.live_tracks = self
            .live
            .clone()
            .filter(|_| open.is_some_and(|open| open.signal == crate::snapshot::Signal::Script));
        if let Some(open) = &mut self.snapshot.open {
            open.web_path = web_path;
            open.track = track;
        }
    }

    fn tracked(&mut self, repo: &Path) {
        self.row(repo).unreachable = None;
        self.reread_repo(repo);
        self.clear_adopt_offer(repo);
        self.want(repo);
        self.reread_if_open(repo);
    }

    /// The repo's row, added first when it is new.
    fn row(&mut self, repo: &Path) -> &mut RepoRow {
        let path = repo.display().to_string();
        let at = match self.snapshot.repos.iter().position(|row| row.path == path) {
            Some(at) => at,
            None => {
                self.snapshot.repos.push(RepoRow {
                    path,
                    name: name_of(repo),
                    unreachable: None,
                    busy: false,
                    last_commit: None,
                    last_active_at: None,
                    web_path: None,
                });
                self.snapshot.repos.len() - 1
            }
        };
        &mut self.snapshot.repos[at]
    }

    /// Reads the repo's own facts (its newest commit and activity, the hub repo it is bound to) into its row.
    fn reread_repo(&mut self, repo: &Path) {
        let facts = self.readout.repo(repo);
        self.repo_sets
            .insert(repo.to_path_buf(), facts.hub_sets.clone());
        let row = self.row(repo);
        row.last_commit = facts.last_commit;
        row.last_active_at = facts.last_active_at;
        match facts.hub {
            Some(hub) => self.hub_repos.insert(repo.to_path_buf(), hub),
            None => self.hub_repos.remove(repo),
        };
    }

    /// Moves the repo to the head of the list, which reads recent first, and says it is not waiting on a lock.
    fn touch(&mut self, repo: &Path) {
        self.row(repo).busy = false;
        self.reread_repo(repo);
        let path = repo.display().to_string();
        if let Some(at) = self.snapshot.repos.iter().position(|row| row.path == path) {
            let row = self.snapshot.repos.remove(at);
            self.snapshot.repos.insert(0, row);
        }
    }

    fn want(&mut self, repo: &Path) {
        if self.hub {
            self.waits.entry(repo.to_path_buf()).or_insert(Wait::Wanted);
            self.burst.insert(repo.to_path_buf());
        }
    }

    fn pushed(&mut self, event: &PushEvent) {
        if !self.hub {
            return;
        }
        match event {
            PushEvent::Started { repo, .. } => {
                self.waits.insert(repo.clone(), Wait::Pushing);
                self.burst.insert(repo.clone());
                self.snapshot.connection = Connection::Online;
            }
            PushEvent::Pushed { repo, .. } => {
                self.waits.remove(repo);
                self.snapshot.connection = Connection::Online;
                // The push may have bound the repo to a hub repo.
                self.reread_repo(repo);
                self.reread_if_open(repo);
            }
            PushEvent::Waiting { repo, message, .. } => {
                self.waits
                    .insert(repo.clone(), Wait::Waiting(message.clone()));
                self.snapshot.connection = Connection::Offline;
            }
            PushEvent::Failed { repo, message, .. } => {
                self.waits
                    .insert(repo.clone(), Wait::Failed(message.clone()));
                self.snapshot.connection = Connection::Refused;
            }
        }
    }

    fn reread_if_open(&mut self, repo: &Path) {
        if self.focus.as_ref().is_some_and(|focus| focus.repo == repo) {
            self.reread_current();
        }
    }

    /// Re-reads the currently open set and drops its draft if a commit landed outside the panel (head commit moved or
    /// pending saves cleared).
    fn reread_current(&mut self) {
        let had_saves = !self.read.saves.is_empty();
        let prev_commit = self
            .read
            .last_commit
            .as_ref()
            .map(|head| (head.at, head.message.clone()));
        self.reread();
        let next_commit = self
            .read
            .last_commit
            .as_ref()
            .map(|head| (head.at, head.message.clone()));
        let committed_externally = (had_saves && self.read.saves.is_empty())
            || (next_commit.is_some() && next_commit != prev_commit);
        if committed_externally && let Some(open) = &self.snapshot.open {
            self.drafts.remove(&open.path);
        }
    }

    fn reread(&mut self) {
        self.read = self
            .focus
            .as_ref()
            .and_then(|focus| self.readout.read(&focus.repo, &focus.set_id, &focus.branch))
            .unwrap_or_default();
    }

    /// The commit box's text for the open set.
    fn show_draft(&mut self) {
        self.snapshot.draft = self
            .snapshot
            .open
            .as_ref()
            .and_then(|open| self.drafts.get(&open.path))
            .cloned()
            .unwrap_or_default();
    }

    /// Recomputes what is a function of the rest.
    fn derive(&mut self) {
        let pushing_here = self
            .focus
            .as_ref()
            .is_some_and(|focus| self.waits.get(&focus.repo) == Some(&Wait::Pushing));
        let overlay = |push: SavePush| match push {
            SavePush::Pending if pushing_here => SavePush::Pushing,
            other => other,
        };
        self.snapshot.saves = self
            .read
            .saves
            .iter()
            .map(|row| SaveRow {
                push: overlay(row.push),
                ..row.clone()
            })
            .collect();
        self.snapshot.last_commit = self.read.last_commit.as_ref().map(|head| HeadCommit {
            push: overlay(head.push),
            ..head.clone()
        });
        self.snapshot.time_since_commit = self.read.time_since_commit;
        self.snapshot.first_commit = self.read.first_commit;
        self.snapshot.head_meta = self.read.head_meta.clone();
        self.snapshot.latest_meta = self.read.latest_meta.clone();
        self.snapshot.clauses = self.read.clauses.clone();
        self.snapshot.tracks_changed = self.read.tracks_changed.clone();
        self.show_draft();
        self.derive_hub_set();

        let host = self.snapshot.auth.host.as_deref();
        for row in &mut self.snapshot.repos {
            row.web_path = self
                .hub_repos
                .get(Path::new(&row.path))
                .filter(|hub| Some(hub.instance.as_str()) == host)
                .and_then(|hub| {
                    let project = self.repo_projects.get(&hub.repo_id)?;
                    Some(format!("/project/{project}/repo/{}", hub.repo_id))
                });
        }

        let first = |pick: fn(&Wait) -> Option<&str>| {
            self.waits
                .values()
                .find_map(|wait| pick(wait).map(str::to_string))
        };
        let (state, message) = if self.waits.values().any(|wait| *wait == Wait::Pushing) {
            (PushPhase::Pushing, None)
        } else if let Some(message) = first(|wait| match wait {
            Wait::Waiting(message) => Some(message),
            _ => None,
        }) {
            (PushPhase::Waiting, Some(message))
        } else if let Some(message) = first(|wait| match wait {
            Wait::Failed(message) => Some(message),
            _ => None,
        }) {
            (PushPhase::Failed, Some(message))
        } else {
            (PushPhase::Idle, None)
        };
        // A burst ends when no repo is waiting to go or going; its repos that finished, or stopped for a reason of
        // their own, are the arc's done.
        let unfinished = self
            .waits
            .values()
            .filter(|wait| matches!(wait, Wait::Wanted | Wait::Pushing))
            .count();
        if unfinished == 0 {
            self.burst.clear();
        }
        let progress = (state == PushPhase::Pushing).then(|| PushProgress {
            done: self.burst.len().saturating_sub(unfinished),
            total: self.burst.len(),
        });
        self.snapshot.push = PushState {
            state,
            pending: self.waits.len(),
            message,
            progress,
        };

        self.derive_renders();
        self.snapshot.bar_title = self.snapshot.title();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use dit_core::{CommitKind, ObjectId, ObjectKind, Signal};
    use dit_daemon::event::Origin;
    use dit_daemon::queue::Phase;

    use super::*;
    use crate::snapshot::{AuthState, Permissions, ScriptState};

    /// A repo that answers with whatever the test last set: the set's readout, the repo's facts, the folder's.
    #[derive(Default)]
    struct Fake(
        Mutex<SetReadout>,
        Mutex<RepoFacts>,
        Mutex<FolderFacts>,
        /// How long each audio file plays, and how many times a length was asked for.
        Mutex<(HashMap<PathBuf, u64>, usize)>,
    );

    impl Readout for Fake {
        fn track_colour(&self, index: i64) -> Option<String> {
            (index == 3).then(|| "#ff94a6".to_string())
        }

        fn read(&self, _: &Path, _: &str, _: &str) -> Option<SetReadout> {
            Some(self.0.lock().unwrap().clone())
        }

        fn repo(&self, _: &Path) -> RepoFacts {
            self.1.lock().unwrap().clone()
        }

        fn folder(&self, _: &Path) -> FolderFacts {
            self.2.lock().unwrap().clone()
        }

        fn duration_ms(&self, file: &Path) -> Option<u64> {
            let mut lengths = self.3.lock().unwrap();
            lengths.1 += 1;
            lengths.0.get(file).copied()
        }
    }

    fn settings() -> Settings {
        Settings {
            shortcut: None,
            shortcut_error: None,
            max_upload_mb: 0,
            watch_roots: Vec::new(),
            excluded: Vec::new(),
            autostart: false,
            machine_name: "Studio".to_string(),
            cli_installed: None,
            built_in_excluded: Vec::new(),
            rejected_files: Vec::new(),
            never_here_folders: Vec::new(),
            home: "/Users/me".to_string(),
            app_version: "1.0.0".to_string(),
        }
    }

    fn save(id: &str, push: SavePush) -> SaveRow {
        SaveRow {
            id: id.to_string(),
            at: 1,
            file: "science123.als".to_string(),
            unreadable: false,
            push,
            meta: None,
        }
    }

    fn reducer_with(fake: &Arc<Fake>) -> Reducer {
        let mut snapshot = Snapshot::empty(settings());
        snapshot.auth.state = AuthState::SignedIn;
        snapshot.live = true;
        snapshot.permissions = Permissions {
            screen_recording: true,
        };
        let mut reducer = Reducer::new(snapshot, fake.clone());
        reducer.set_hub(Some("Studio".to_string()));
        reducer
    }

    fn repo() -> PathBuf {
        PathBuf::from("/Music/science Project")
    }

    fn open_info() -> OpenSetInfo {
        OpenSetInfo {
            path: repo().join("science123.als"),
            signal: Signal::Script,
            repo: Some(repo()),
            set_id: Some("a1b2c3d4".to_string()),
            branch: Some("main".to_string()),
        }
    }

    fn recorded() -> DaemonEvent {
        recorded_in(repo())
    }

    fn recorded_in(repo: PathBuf) -> DaemonEvent {
        DaemonEvent::SaveRecorded {
            repo,
            set_id: "a1b2c3d4".to_string(),
            branch: "main".to_string(),
            file: "science123.als".to_string(),
            save: ObjectId::of(ObjectKind::Save, b"x"),
            at: 1,
            unreadable: false,
            origin: Origin::Watch,
        }
    }

    fn push(event: PushEvent) -> DaemonEvent {
        DaemonEvent::Push(event)
    }

    #[test]
    fn opening_a_set_reads_its_repo_and_names_it_in_the_bar() {
        let fake = Arc::new(Fake::default());
        *fake.0.lock().unwrap() = SetReadout {
            saves: vec![save("b", SavePush::Pending), save("a", SavePush::Pushed)],
            last_commit: Some(head("added strings", SavePush::Pushed)),
            time_since_commit: Some(8040),
            ..SetReadout::default()
        };
        let mut reducer = reducer_with(&fake);

        reducer.apply(&DaemonEvent::OpenSet(Some(open_info())));

        let snapshot = reducer.snapshot();
        assert_eq!(snapshot.bar_title, "science123 \u{25cf} 2");
        assert_eq!(
            snapshot.open,
            Some(OpenSet {
                path: "/Music/science Project/science123.als".to_string(),
                name: "science123".to_string(),
                repo: Some("/Music/science Project".to_string()),
                branch: Some("main".to_string()),
                signal: crate::snapshot::Signal::Script,
                web_path: None,
                track: None,
            })
        );
        assert_eq!(
            snapshot.last_commit.as_ref().unwrap().message,
            "added strings"
        );
        assert_eq!(snapshot.time_since_commit, Some(8040));

        reducer.apply(&DaemonEvent::OpenSet(None));
        assert_eq!(reducer.snapshot().bar_title, "");
        assert!(reducer.snapshot().saves.is_empty());
        assert_eq!(reducer.snapshot().last_commit, None);
    }

    #[test]
    fn a_set_in_no_repo_is_named_but_has_nothing_to_read() {
        let fake = Arc::new(Fake::default());
        *fake.0.lock().unwrap() = SetReadout {
            saves: vec![save("b", SavePush::Pending)],
            ..SetReadout::default()
        };
        let mut reducer = reducer_with(&fake);

        reducer.apply(&DaemonEvent::OpenSet(Some(OpenSetInfo {
            repo: None,
            set_id: None,
            branch: None,
            ..open_info()
        })));

        assert_eq!(reducer.snapshot().bar_title, "science123");
        assert!(reducer.snapshot().saves.is_empty());
    }

    #[test]
    fn a_recorded_save_rereads_the_open_set_and_wants_a_push() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        reducer.apply(&DaemonEvent::OpenSet(Some(open_info())));
        assert_eq!(reducer.snapshot().bar_title, "science123");

        *fake.0.lock().unwrap() = SetReadout {
            saves: vec![save("a", SavePush::Pending)],
            ..SetReadout::default()
        };
        reducer.apply(&recorded());

        let snapshot = reducer.snapshot();
        assert_eq!(snapshot.bar_title, "science123 \u{25cf} 1");
        assert_eq!(snapshot.push.pending, 1);
        assert_eq!(snapshot.push.state, PushPhase::Idle);
    }

    #[test]
    fn a_save_in_another_repo_is_not_read_into_the_open_set() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        reducer.apply(&DaemonEvent::OpenSet(Some(open_info())));
        *fake.0.lock().unwrap() = SetReadout {
            saves: vec![save("a", SavePush::Pending)],
            ..SetReadout::default()
        };

        reducer.apply(&recorded_in(PathBuf::from("/Music/other")));

        assert!(reducer.snapshot().saves.is_empty());
        assert_eq!(
            reducer.snapshot().repos[0].path,
            "/Music/other",
            "the repo with the newest save heads the list"
        );
    }

    #[test]
    fn the_push_follows_the_queues_events_and_marks_the_open_sets_saves() {
        let fake = Arc::new(Fake::default());
        *fake.0.lock().unwrap() = SetReadout {
            saves: vec![save("b", SavePush::Pending), save("a", SavePush::Pushed)],
            ..SetReadout::default()
        };
        let mut reducer = reducer_with(&fake);
        reducer.apply(&DaemonEvent::OpenSet(Some(open_info())));
        reducer.apply(&recorded());

        reducer.apply(&push(PushEvent::Started {
            repo: repo(),
            phase: Phase::Saves,
        }));
        let snapshot = reducer.snapshot();
        assert_eq!(snapshot.push.state, PushPhase::Pushing);
        assert_eq!(
            snapshot.bar_title, "science123 \u{25cf} 2",
            "the arc shows the push, not a glyph in the title"
        );
        assert_eq!(
            snapshot.push.progress,
            Some(PushProgress { done: 0, total: 1 })
        );
        assert!(snapshot.label().ends_with(", pushing"));
        assert_eq!(snapshot.saves[0].push, SavePush::Pushing);
        assert_eq!(snapshot.saves[1].push, SavePush::Pushed);

        reducer.apply(&push(PushEvent::Waiting {
            repo: repo(),
            message: "The hub is unreachable.".to_string(),
            retry_in_ms: 5000,
        }));
        let snapshot = reducer.snapshot();
        assert_eq!(snapshot.push.state, PushPhase::Waiting);
        assert_eq!(
            snapshot.push.message.as_deref(),
            Some("The hub is unreachable.")
        );
        assert_eq!(snapshot.connection, Connection::Offline);
        assert_eq!(snapshot.saves[0].push, SavePush::Pending);

        reducer.apply(&push(PushEvent::Failed {
            repo: repo(),
            message: "Over the storage limit.".to_string(),
            storage_limit: true,
        }));
        assert_eq!(reducer.snapshot().push.state, PushPhase::Failed);
        assert_eq!(reducer.snapshot().connection, Connection::Refused);

        *fake.0.lock().unwrap() = SetReadout {
            saves: vec![save("b", SavePush::Pushed), save("a", SavePush::Pushed)],
            ..SetReadout::default()
        };
        reducer.apply(&push(PushEvent::Pushed {
            repo: repo(),
            report: Default::default(),
        }));
        let snapshot = reducer.snapshot();
        assert_eq!(
            snapshot.push,
            PushState {
                state: PushPhase::Idle,
                pending: 0,
                message: None,
                progress: None,
            }
        );
        assert_eq!(snapshot.connection, Connection::Online);
        assert!(
            snapshot
                .saves
                .iter()
                .all(|row| row.push == SavePush::Pushed)
        );
    }

    #[test]
    fn without_a_hub_nothing_is_pending_and_the_connection_says_so() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        reducer.set_hub(None);

        reducer.apply(&recorded());
        reducer.apply(&push(PushEvent::Started {
            repo: repo(),
            phase: Phase::Saves,
        }));

        let snapshot = reducer.snapshot();
        assert_eq!(snapshot.connection, Connection::NoHub);
        assert_eq!(snapshot.push.pending, 0);
        assert_eq!(snapshot.push.state, PushPhase::Idle);
        assert_eq!(snapshot.machine.name, None);
    }

    #[test]
    fn a_refused_sign_in_revokes_and_stops_waiting_on_the_hub() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        reducer.set_auth(Auth {
            state: AuthState::SignedIn,
            host: Some("https://projammr.example".to_string()),
            pending: None,
        });
        reducer.apply(&recorded());

        reducer.apply(&DaemonEvent::SignedOut {
            host: "projammr.example".to_string(),
        });

        let snapshot = reducer.snapshot();
        assert_eq!(snapshot.auth.state, AuthState::Revoked);
        assert_eq!(
            snapshot.auth.host.as_deref(),
            Some("https://projammr.example")
        );
        assert_eq!(snapshot.connection, Connection::Refused);
        assert_eq!(snapshot.push.pending, 0);
        assert_eq!(
            snapshot.bar_title, "",
            "a revoked machine shows the icon alone"
        );
    }

    #[test]
    fn a_refused_machine_name_is_a_notice_and_unnames_the_machine() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);

        reducer.apply(&DaemonEvent::MachineRefused {
            message: "Another of your machines is called Studio.".to_string(),
        });

        assert_eq!(reducer.snapshot().machine.name, None);
        assert_eq!(
            reducer.snapshot().machine.refused.as_deref(),
            Some("Studio")
        );
        assert_eq!(reducer.snapshot().connection, Connection::Refused);

        reducer.set_hub(Some("Studio 2".to_string()));
        assert_eq!(reducer.snapshot().machine.refused, None, "named again");
        assert_eq!(
            reducer.snapshot().notices,
            ["Another of your machines is called Studio."]
        );
    }

    #[test]
    fn notices_repeat_once_and_the_newest_are_kept() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        for n in 0..7 {
            reducer.notice(format!("n{n}"));
        }
        reducer.notice("n6".to_string());

        assert_eq!(reducer.snapshot().notices, ["n2", "n3", "n4", "n5", "n6"]);
    }

    #[test]
    fn repos_come_in_as_tracked_and_leave_the_unreachable_state_when_found() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);

        reducer.apply(&DaemonEvent::RepoUnreachable {
            repo: PathBuf::from("/Volumes/Gone/other Project"),
            message: "No such file or directory".to_string(),
        });
        reducer.apply(&DaemonEvent::RepoTracked { repo: repo() });
        reducer.apply(&DaemonEvent::RepoBusy { repo: repo() });

        let rows = &reducer.snapshot().repos;
        assert_eq!(rows[0].name, "other Project");
        assert_eq!(
            rows[0].unreachable.as_deref(),
            Some("No such file or directory")
        );
        assert_eq!(rows[1].name, "science Project");
        assert!(rows[1].busy);

        reducer.apply(&DaemonEvent::RepoTracked {
            repo: PathBuf::from("/Volumes/Gone/other Project"),
        });
        assert_eq!(reducer.snapshot().repos[0].unreachable, None);
        assert_eq!(reducer.snapshot().repos.len(), 2);

        reducer.apply(&recorded());
        assert_eq!(reducer.snapshot().repos[0].name, "science Project");
        assert!(
            !reducer.snapshot().repos[0].busy,
            "a save recorded says the lock is free"
        );
    }

    #[test]
    fn an_adopt_offer_stands_until_its_folder_is_tracked_or_the_set_moves_away() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        *fake.2.lock().unwrap() = FolderFacts {
            sets: (1..=8).map(|n| format!("set {n}")).collect(),
            synced_by: Some("Dropbox".to_string()),
        };
        let offer = DaemonEvent::AdoptOffer {
            folder: PathBuf::from("/Music/new Project"),
            set: PathBuf::from("/Music/new Project/new.als"),
        };

        reducer.apply(&offer);
        assert_eq!(
            reducer.snapshot().adopt_offer,
            Some(AdoptOffer {
                folder: "/Music/new Project".to_string(),
                set: "/Music/new Project/new.als".to_string(),
                name: "new Project".to_string(),
                set_count: 8,
                synced_by: Some("Dropbox".to_string()),
                projects: Vec::new(),
                project_id: None,
            })
        );
        reducer.apply(&DaemonEvent::RepoTracked {
            repo: PathBuf::from("/Music/new Project"),
        });
        assert_eq!(reducer.snapshot().adopt_offer, None);

        reducer.apply(&offer);
        reducer.apply(&DaemonEvent::OpenSet(Some(open_info())));
        assert_eq!(reducer.snapshot().adopt_offer, None, "another set is open");

        reducer.apply(&offer);
        reducer.clear_adopt_offer(Path::new("/Music/new Project"));
        assert_eq!(reducer.snapshot().adopt_offer, None);
    }

    fn project(id: i64, name: &str) -> HubProject {
        HubProject {
            id,
            name: name.to_string(),
        }
    }

    #[test]
    fn the_projects_of_the_account_join_the_offer_and_the_last_one_chosen_stands_while_it_exists() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        let folder = Path::new("/Music/new Project");
        reducer.apply(&DaemonEvent::AdoptOffer {
            folder: folder.to_path_buf(),
            set: folder.join("new.als"),
        });

        reducer.set_offer_projects(folder, vec![project(4, "Album"), project(7, "EP")], Some(7));
        let offer = reducer.snapshot().adopt_offer.clone().unwrap();
        assert_eq!(offer.projects, [project(4, "Album"), project(7, "EP")]);
        assert_eq!(offer.project_id, Some(7));

        reducer.set_offer_projects(folder, vec![project(4, "Album")], Some(7));
        assert_eq!(
            reducer.snapshot().adopt_offer.as_ref().unwrap().project_id,
            None,
            "the project last chosen is gone"
        );

        reducer.set_offer_projects(
            Path::new("/Music/another Project"),
            vec![project(9, "Other")],
            Some(9),
        );
        assert_eq!(
            reducer.snapshot().adopt_offer.as_ref().unwrap().projects,
            [project(4, "Album")],
            "an offer for another folder is not this one's"
        );

        reducer.clear_adopt_offer(folder);
        reducer.set_offer_projects(folder, vec![project(4, "Album")], None);
        assert_eq!(reducer.snapshot().adopt_offer, None);
    }

    #[test]
    fn a_repo_row_carries_its_newest_commit_and_activity_and_a_link_once_its_project_is_known() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        reducer.set_auth(Auth {
            state: AuthState::SignedIn,
            host: Some("https://projammr.example".to_string()),
            pending: None,
        });
        reducer.apply(&DaemonEvent::RepoTracked { repo: repo() });
        assert_eq!(reducer.snapshot().repos[0].last_commit, None);
        assert_eq!(reducer.snapshot().repos[0].web_path, None);

        *fake.1.lock().unwrap() = RepoFacts {
            last_commit: Some(LastCommit {
                message: "added strings".to_string(),
                at: 5,
            }),
            last_active_at: Some(8),
            hub: Some(HubRepo {
                instance: "https://projammr.example".to_string(),
                repo_id: 3,
            }),
            hub_sets: Vec::new(),
        };
        reducer.apply(&recorded());
        let row = reducer.snapshot().repos[0].clone();
        assert_eq!(row.last_commit.unwrap().message, "added strings");
        assert_eq!(row.last_active_at, Some(8));
        assert_eq!(row.web_path, None, "its project is not known yet");
        assert!(reducer.needs_projects());

        reducer.set_repo_projects(BTreeMap::from([(3, 11)]));
        assert_eq!(
            reducer.snapshot().repos[0].web_path.as_deref(),
            Some("/project/11/repo/3")
        );
        assert!(!reducer.needs_projects());
    }

    #[test]
    fn a_repo_bound_on_another_instance_has_no_link_and_asks_for_no_projects() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        reducer.set_auth(Auth {
            state: AuthState::SignedIn,
            host: Some("https://projammr.example".to_string()),
            pending: None,
        });
        *fake.1.lock().unwrap() = RepoFacts {
            hub: Some(HubRepo {
                instance: "https://other.example".to_string(),
                repo_id: 3,
            }),
            ..RepoFacts::default()
        };
        reducer.apply(&DaemonEvent::RepoTracked { repo: repo() });
        reducer.set_repo_projects(BTreeMap::from([(3, 11)]));

        assert_eq!(reducer.snapshot().repos[0].web_path, None);
        assert!(!reducer.needs_projects());
    }

    #[test]
    fn a_restore_link_waits_in_the_snapshot_until_it_is_let_go() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        assert_eq!(reducer.snapshot().pending_restore, None);

        reducer.set_pending_restore(Some(PendingRestore::link(41)));
        assert_eq!(
            reducer.snapshot().pending_restore,
            Some(PendingRestore::link(41))
        );
        reducer.set_pending_restore(None);
        assert_eq!(reducer.snapshot().pending_restore, None);
    }

    fn live_is_installed_with_its_script_at(path: &str) -> ScriptFacts {
        ScriptFacts {
            live_found: true,
            installed: true,
            path: Some(path.to_string()),
        }
    }

    #[test]
    fn the_script_connects_and_goes_back_to_what_is_installed() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        let folder = "/Music/Ableton/User Library/Remote Scripts/dit";
        reducer.set_script(live_is_installed_with_its_script_at(folder));
        assert_eq!(reducer.snapshot().script.state, ScriptPhase::Installed);

        reducer.apply(&DaemonEvent::Script(ScriptEvent::Connected {
            live: "12.4.6".to_string(),
            script: "1".to_string(),
        }));
        assert_eq!(
            reducer.snapshot().script,
            ScriptState {
                state: ScriptPhase::Connected,
                live: Some("12.4.6".to_string()),
                path: Some(folder.to_string()),
            }
        );

        reducer.apply(&DaemonEvent::Script(ScriptEvent::Disconnected));
        assert_eq!(
            reducer.snapshot().script,
            ScriptState {
                state: ScriptPhase::Installed,
                live: None,
                path: Some(folder.to_string()),
            }
        );

        reducer.set_script(ScriptFacts {
            live_found: true,
            installed: false,
            path: None,
        });
        assert_eq!(
            reducer.snapshot().script,
            ScriptState {
                state: ScriptPhase::NotInstalled,
                live: None,
                path: None,
            }
        );
    }

    #[test]
    fn a_connected_script_stays_connected_when_the_machines_facts_are_read_again() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        reducer.apply(&DaemonEvent::Script(ScriptEvent::Connected {
            live: "12.4.6".to_string(),
            script: "1".to_string(),
        }));

        reducer.set_script(live_is_installed_with_its_script_at("/Scripts/dit"));

        assert_eq!(reducer.snapshot().script.state, ScriptPhase::Connected);
        assert_eq!(reducer.snapshot().script.live.as_deref(), Some("12.4.6"));
        assert_eq!(
            reducer.snapshot().script.path.as_deref(),
            Some("/Scripts/dit")
        );
    }

    #[test]
    fn with_no_live_the_script_has_nowhere_to_go() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);

        reducer.set_script(ScriptFacts {
            live_found: false,
            installed: false,
            path: None,
        });

        assert_eq!(
            reducer.snapshot().script,
            ScriptState {
                state: ScriptPhase::LiveNotFound,
                live: None,
                path: None,
            }
        );
        // Live found again, with the script left in place from before.
        reducer.set_script(live_is_installed_with_its_script_at("/Scripts/dit"));
        assert_eq!(reducer.snapshot().script.state, ScriptPhase::Installed);
    }

    #[test]
    fn a_checkpoint_commit_wants_a_push_and_rereads_the_set() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        reducer.apply(&DaemonEvent::OpenSet(Some(open_info())));
        *fake.0.lock().unwrap() = SetReadout {
            last_commit: Some(head("Checkpoint", SavePush::Pending)),
            ..SetReadout::default()
        };

        reducer.apply(&DaemonEvent::Committed {
            repo: repo(),
            set_id: "a1b2c3d4".to_string(),
            branch: "main".to_string(),
            commit: ObjectId::of(ObjectKind::Commit, b"c"),
            kind: CommitKind::Checkpoint,
            message: "Checkpoint".to_string(),
        });

        assert_eq!(
            reducer.snapshot().last_commit.as_ref().unwrap().message,
            "Checkpoint"
        );
        assert_eq!(reducer.snapshot().push.pending, 1);
    }

    #[test]
    fn the_bar_goes_quiet_when_live_stops() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        reducer.apply(&DaemonEvent::OpenSet(Some(open_info())));
        assert_eq!(reducer.snapshot().bar_title, "science123");

        reducer.apply(&DaemonEvent::LiveRunning(false));
        assert_eq!(reducer.snapshot().bar_title, "");
        assert!(!reducer.snapshot().live);
    }

    fn head(message: &str, push: SavePush) -> HeadCommit {
        HeadCommit {
            message: message.to_string(),
            at: 5,
            push,
        }
    }

    fn meta_with(tracks: &[(&str, &[&str])]) -> SetMeta {
        SetMeta {
            structure: Some(dit_core::SetStructure {
                tracks: tracks
                    .iter()
                    .map(|(name, devices)| StructureTrack {
                        kind: TrackKind::Midi,
                        name: name.to_string(),
                        devices: devices.iter().map(|device| device.to_string()).collect(),
                        id: None,
                        group_id: None,
                        color: None,
                    })
                    .collect(),
                clips: None,
                scenes: None,
                plugins: None,
                truncated: None,
            }),
            ..SetMeta::default()
        }
    }

    #[test]
    fn the_readouts_changes_since_the_head_reach_the_snapshot_with_the_head_commits_push_dot() {
        let fake = Arc::new(Fake::default());
        let before = meta_with(&[("Bass", &["Operator"])]);
        let after = meta_with(&[("Bass", &["Operator", "EQ Eight"])]);
        *fake.0.lock().unwrap() = SetReadout {
            saves: vec![SaveRow {
                meta: Some(after.clone()),
                ..save("b", SavePush::Pending)
            }],
            last_commit: Some(head("added strings", SavePush::Pending)),
            head_meta: Some(before.clone()),
            latest_meta: Some(after.clone()),
            clauses: vec![Clause {
                kind: dit_core::ClauseKind::Devices,
                text: "+EQ Eight on Bass".to_string(),
            }],
            tracks_changed: vec!["Bass".to_string()],
            ..SetReadout::default()
        };
        let mut reducer = reducer_with(&fake);
        reducer.apply(&DaemonEvent::OpenSet(Some(open_info())));

        let snapshot = reducer.snapshot();
        assert_eq!(snapshot.head_meta, Some(before));
        assert_eq!(snapshot.latest_meta, Some(after.clone()));
        assert_eq!(snapshot.saves[0].meta, Some(after));
        assert_eq!(snapshot.clauses[0].text, "+EQ Eight on Bass");
        assert_eq!(snapshot.tracks_changed, ["Bass"]);
        assert!(!snapshot.first_commit);
        assert_eq!(
            snapshot.last_commit.as_ref().unwrap().push,
            SavePush::Pending
        );

        // A push in flight marks what waits for it, the commit included.
        reducer.apply(&push(PushEvent::Started {
            repo: repo(),
            phase: Phase::Commits,
        }));
        let snapshot = reducer.snapshot();
        assert_eq!(snapshot.saves[0].push, SavePush::Pushing);
        assert_eq!(
            snapshot.last_commit.as_ref().unwrap().push,
            SavePush::Pushing
        );
    }

    fn track(id: i64, name: &str, group_id: Option<i64>) -> ScriptTrack {
        ScriptTrack {
            id,
            name: name.to_string(),
            color: Some(3),
            kind: "midi".to_string(),
            group_id,
            devices: vec![dit_daemon::script::ScriptDevice {
                name: "EQ Eight".to_string(),
                kind: "live".to_string(),
                class_name: Some("Eq8".to_string()),
            }],
        }
    }

    fn script(message: ScriptMessage) -> DaemonEvent {
        DaemonEvent::Script(ScriptEvent::Message(message))
    }

    #[test]
    fn the_scripts_tracks_are_live_tracks_while_the_script_names_the_open_set() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        reducer.apply(&DaemonEvent::OpenSet(Some(open_info())));
        assert_eq!(reducer.snapshot().live_tracks, None);

        reducer.apply(&script(ScriptMessage::Tracks {
            tracks: vec![track(7, "Bass", Some(3))],
        }));
        let live = reducer.snapshot().live_tracks.clone().unwrap();
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].name, "Bass");
        assert_eq!(live[0].devices, ["EQ Eight"]);
        assert_eq!(live[0].id, Some(7));
        assert_eq!(live[0].group_id, Some(3));
        assert_eq!(live[0].kind, TrackKind::Midi);
        assert_eq!(
            live[0].color.as_deref(),
            Some("#ff94a6"),
            "the palette's colour"
        );

        // The same document said again keeps them; another document, or none, lets them go.
        let said = |path: Option<&str>| {
            script(ScriptMessage::Document {
                path: path.map(str::to_string),
                at: 1,
            })
        };
        reducer.apply(&said(Some("/Music/science Project/science123.als")));
        assert!(reducer.snapshot().live_tracks.is_none(), "a first document");
        reducer.apply(&script(ScriptMessage::Tracks {
            tracks: vec![track(7, "Bass", None)],
        }));
        reducer.apply(&said(Some("/Music/science Project/science123.als")));
        assert!(reducer.snapshot().live_tracks.is_some());
        reducer.apply(&said(Some("/Music/other Project/other.als")));
        assert!(reducer.snapshot().live_tracks.is_none());

        reducer.apply(&script(ScriptMessage::Tracks {
            tracks: vec![track(1, "Kick", None)],
        }));
        reducer.apply(&script(ScriptMessage::Closed));
        assert!(reducer.snapshot().live_tracks.is_none());
    }

    #[test]
    fn live_tracks_are_not_shown_for_a_set_the_script_did_not_name() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        reducer.apply(&DaemonEvent::OpenSet(Some(OpenSetInfo {
            signal: Signal::Title,
            ..open_info()
        })));
        reducer.apply(&script(ScriptMessage::Tracks {
            tracks: vec![track(7, "Bass", None)],
        }));
        assert_eq!(reducer.snapshot().live_tracks, None);

        reducer.apply(&DaemonEvent::OpenSet(Some(open_info())));
        assert!(reducer.snapshot().live_tracks.is_some());
        reducer.apply(&DaemonEvent::Script(ScriptEvent::Disconnected));
        assert_eq!(reducer.snapshot().live_tracks, None);
    }

    #[test]
    fn a_draft_is_kept_for_its_set_until_it_is_emptied() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        let path = "/Music/science Project/science123.als".to_string();
        reducer.set_draft(path.clone(), "tightened the kick".to_string());
        assert_eq!(reducer.snapshot().draft, "", "no set is open yet");

        reducer.apply(&DaemonEvent::OpenSet(Some(open_info())));
        assert_eq!(reducer.snapshot().draft, "tightened the kick");

        reducer.set_draft(path.clone(), "tightened the kick, more air".to_string());
        assert_eq!(reducer.snapshot().draft, "tightened the kick, more air");
        reducer.set_draft(
            "/Music/other Project/other.als".to_string(),
            "x".to_string(),
        );
        assert_eq!(reducer.snapshot().draft, "tightened the kick, more air");

        reducer.set_draft(path, String::new());
        assert_eq!(reducer.snapshot().draft, "");
    }

    #[test]
    fn an_external_commit_clears_the_open_sets_draft() {
        let fake = Arc::new(Fake::default());
        *fake.0.lock().unwrap() = SetReadout {
            saves: vec![save("s1", SavePush::Pending)],
            last_commit: Some(head("earlier", SavePush::Pushed)),
            ..SetReadout::default()
        };
        let mut reducer = reducer_with(&fake);
        let path = "/Music/science Project/science123.als".to_string();
        reducer.apply(&DaemonEvent::OpenSet(Some(open_info())));
        reducer.set_draft(path.clone(), "stale draft".to_string());
        assert_eq!(reducer.snapshot().draft, "stale draft");

        // External CLI commit advances the head commit and clears pending saves.
        *fake.0.lock().unwrap() = SetReadout {
            saves: Vec::new(),
            last_commit: Some(head("cli commit", SavePush::Pending)),
            ..SetReadout::default()
        };
        reducer.refresh();
        assert_eq!(reducer.snapshot().draft, "");

        // A daemon commit event also clears the open set's draft.
        reducer.set_draft(path.clone(), "another draft".to_string());
        reducer.apply(&DaemonEvent::Committed {
            repo: repo(),
            set_id: "a1b2c3d4".to_string(),
            branch: "main".to_string(),
            commit: ObjectId::of(ObjectKind::Commit, b"c"),
            kind: CommitKind::Checkpoint,
            message: "checkpoint".to_string(),
        });
        assert_eq!(reducer.snapshot().draft, "");

        // Clearing drafts by repo folder removes drafts for non-open sets in that folder too.
        reducer.set_draft(path, "in repo".to_string());
        reducer.clear_drafts_in(&repo());
        assert_eq!(reducer.snapshot().draft, "");
    }

    fn session(id: i64, has_track: bool, choices: &[(&str, &str)]) -> HubSet {
        HubSet {
            path: "/Music/science Project/science123.als".to_string(),
            session_id: id,
            project_id: 4,
            artwork: Some(Artwork {
                asset_path: "images/cover.webp".to_string(),
                accent_hue: Some(262.5),
                accent_chroma: None,
            }),
            has_track,
            track: has_track.then(|| OpenTrack {
                id: 12,
                title: "science".to_string(),
            }),
            choices: choices
                .iter()
                .map(|(label, track)| TrackChoice {
                    label: label.to_string(),
                    track: track.to_string(),
                })
                .collect(),
        }
    }

    fn opened_session(first_commit: bool) -> (Arc<Fake>, Reducer) {
        let fake = Arc::new(Fake::default());
        *fake.0.lock().unwrap() = SetReadout {
            first_commit,
            session_id: Some(812),
            ..SetReadout::default()
        };
        let mut reducer = reducer_with(&fake);
        reducer.apply(&DaemonEvent::OpenSet(Some(open_info())));
        (fake, reducer)
    }

    #[test]
    fn what_the_hub_says_of_the_session_gives_the_set_its_cover_and_its_page() {
        let (_, mut reducer) = opened_session(false);
        assert_eq!(reducer.snapshot().artwork, None);
        assert_eq!(reducer.snapshot().open.as_ref().unwrap().web_path, None);
        assert_eq!(reducer.snapshot().open.as_ref().unwrap().track, None);
        assert_eq!(
            reducer.hub_target().map(|target| target.session_id),
            Some(812)
        );

        reducer.set_hub_set(session(812, true, &[]));

        let snapshot = reducer.snapshot();
        assert_eq!(
            snapshot.artwork.as_ref().unwrap().asset_path,
            "images/cover.webp"
        );
        assert_eq!(
            snapshot.open.as_ref().unwrap().web_path.as_deref(),
            Some("/project/4/track/12")
        );
        assert_eq!(
            snapshot.open.as_ref().unwrap().track,
            Some(OpenTrack {
                id: 12,
                title: "science".to_string()
            })
        );
        assert_eq!(snapshot.track_proposal, None, "the session has a track");
    }

    #[test]
    fn a_session_without_a_track_proposes_one_even_after_the_first_commit() {
        let (fake, mut reducer) = opened_session(true);
        reducer.set_hub_set(session(812, false, &[("science", "12"), ("Canopy", "31")]));

        let proposal = reducer.snapshot().track_proposal.clone().unwrap();
        assert_eq!(proposal.new_track, "science");
        assert_eq!(proposal.choices.len(), 2);
        assert_eq!(proposal.choices[0].track, "12");
        assert_eq!(
            reducer
                .snapshot()
                .open
                .as_ref()
                .unwrap()
                .web_path
                .as_deref(),
            Some("/project/4/session/812")
        );

        // The first commit is made: track assignment remains reachable until the session has a track.
        *fake.0.lock().unwrap() = SetReadout {
            first_commit: false,
            session_id: Some(812),
            ..SetReadout::default()
        };
        reducer.refresh();
        assert!(reducer.snapshot().track_proposal.is_some());

        reducer.set_hub_set(session(812, true, &[]));
        assert_eq!(reducer.snapshot().track_proposal, None);
    }

    #[test]
    fn facts_of_another_session_or_another_set_or_without_a_sign_in_show_nothing() {
        let (_, mut reducer) = opened_session(true);
        reducer.set_hub_set(session(900, false, &[]));
        assert_eq!(reducer.snapshot().artwork, None);
        assert_eq!(reducer.snapshot().track_proposal, None);

        reducer.set_hub_set(HubSet {
            path: "/Music/other Project/other.als".to_string(),
            ..session(812, false, &[])
        });
        assert_eq!(reducer.snapshot().track_proposal, None);

        reducer.set_hub_set(session(812, false, &[]));
        assert!(reducer.snapshot().track_proposal.is_some());
        reducer.set_hub(None);
        assert_eq!(reducer.snapshot().track_proposal, None);
        assert_eq!(reducer.snapshot().artwork, None);
        assert_eq!(reducer.hub_target(), None);
    }

    #[test]
    fn a_set_the_hub_has_not_adopted_has_nothing_to_ask() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        reducer.apply(&DaemonEvent::OpenSet(Some(open_info())));
        assert_eq!(reducer.hub_target(), None);
    }

    #[test]
    fn a_new_track_is_titled_by_the_folder_without_project_or_by_the_set() {
        assert_eq!(
            new_track_title(Some("/Music/science Project"), "science123"),
            "science"
        );
        assert_eq!(
            new_track_title(Some("/Music/Canopy"), "canopy v2"),
            "Canopy"
        );
        assert_eq!(
            new_track_title(Some("/Music/ Project"), "science123"),
            "science123"
        );
        assert_eq!(new_track_title(None, "science123"), "science123");
    }

    #[test]
    fn a_folder_chosen_to_track_becomes_the_adopt_offer() {
        let fake = Arc::new(Fake::default());
        *fake.2.lock().unwrap() = FolderFacts {
            sets: vec!["old".to_string(), "old 2".to_string(), "old 3".to_string()],
            synced_by: Some("Dropbox".to_string()),
        };
        let mut reducer = reducer_with(&fake);

        reducer.offer(
            Path::new("/Music/old Project"),
            Path::new("/Music/old Project/old.als"),
        );

        let offer = reducer.snapshot().adopt_offer.clone().unwrap();
        assert_eq!(offer.name, "old Project");
        assert_eq!(offer.set, "/Music/old Project/old.als");
        assert_eq!(offer.set_count, 3);
        assert_eq!(offer.synced_by.as_deref(), Some("Dropbox"));
        assert_eq!(offer.projects, []);
    }

    fn adopt_save(repo: &Path, file: &str) -> DaemonEvent {
        DaemonEvent::SaveRecorded {
            repo: repo.to_path_buf(),
            set_id: "a1b2c3d4".to_string(),
            branch: "main".to_string(),
            file: file.to_string(),
            save: ObjectId::of(ObjectKind::Save, file.as_bytes()),
            at: 1,
            unreadable: false,
            origin: Origin::Adopt,
        }
    }

    fn adopting_three_sets() -> (Reducer, PathBuf) {
        let fake = Arc::new(Fake::default());
        *fake.2.lock().unwrap() = FolderFacts {
            sets: vec![
                "new".to_string(),
                "new 2".to_string(),
                "new remix".to_string(),
            ],
            synced_by: None,
        };
        let mut reducer = reducer_with(&fake);
        let tracked = PathBuf::from("/private/Music/new Project");
        reducer.begin_adopting(Path::new("/Music/new Project"), tracked.clone());
        (reducer, tracked)
    }

    fn states(reducer: &Reducer) -> Vec<(String, AdoptingState)> {
        reducer
            .snapshot()
            .adopting
            .as_ref()
            .unwrap()
            .sets
            .iter()
            .map(|set| (set.name.clone(), set.state))
            .collect()
    }

    #[test]
    fn an_adopted_folder_lists_its_sets_as_saving_until_each_first_save_lands() {
        let (mut reducer, tracked) = adopting_three_sets();
        let adopting = reducer.snapshot().adopting.clone().unwrap();
        assert_eq!(adopting.folder, "/Music/new Project");
        assert_eq!(adopting.name, "new Project");
        assert_eq!(adopting.set_count, 3);
        assert!(
            states(&reducer)
                .iter()
                .all(|(_, s)| *s == AdoptingState::Saving)
        );

        reducer.apply(&adopt_save(&tracked, "new 2.als"));
        assert_eq!(
            states(&reducer),
            [
                ("new".to_string(), AdoptingState::Saving),
                ("new 2".to_string(), AdoptingState::Saved),
                ("new remix".to_string(), AdoptingState::Saving),
            ]
        );

        reducer.apply(&adopt_save(&tracked, "new.als"));
        reducer.apply(&adopt_save(&tracked, "new remix.als"));
        assert_eq!(
            reducer.snapshot().adopting,
            None,
            "the list goes when every set has landed"
        );
    }

    #[test]
    fn saves_of_other_repos_and_other_origins_do_not_move_the_adopting_list() {
        let (mut reducer, tracked) = adopting_three_sets();

        reducer.apply(&adopt_save(Path::new("/Music/other Project"), "new.als"));
        reducer.apply(&recorded_in(tracked.clone()));

        assert!(
            states(&reducer)
                .iter()
                .all(|(_, s)| *s == AdoptingState::Saving)
        );
    }

    #[test]
    fn a_set_the_listing_did_not_know_is_added_as_saved_and_a_repeat_is_not_counted_twice() {
        let (mut reducer, tracked) = adopting_three_sets();

        reducer.apply(&adopt_save(&tracked, "found later.als"));
        reducer.apply(&adopt_save(&tracked, "found later.als"));

        let states = states(&reducer);
        assert_eq!(states.len(), 4);
        assert_eq!(
            states.last(),
            Some(&("found later".to_string(), AdoptingState::Saved))
        );
        assert!(reducer.snapshot().adopting.is_some());
    }

    #[test]
    fn the_daemon_being_done_ends_the_list_whatever_has_not_landed() {
        let (mut reducer, tracked) = adopting_three_sets();
        reducer.apply(&adopt_save(&tracked, "new.als"));

        reducer.finish_adopting(Path::new("/some/other/folder"));
        assert!(reducer.snapshot().adopting.is_some());
        reducer.finish_adopting(&tracked);

        assert_eq!(reducer.snapshot().adopting, None);
        // Late saves of that folder change nothing.
        reducer.apply(&adopt_save(&tracked, "new 2.als"));
        assert_eq!(reducer.snapshot().adopting, None);
    }

    fn repo_at(path: &str) -> PathBuf {
        PathBuf::from(path)
    }

    fn started(repo: &Path) -> DaemonEvent {
        push(PushEvent::Started {
            repo: repo.to_path_buf(),
            phase: Phase::Saves,
        })
    }

    fn finished(repo: &Path) -> DaemonEvent {
        push(PushEvent::Pushed {
            repo: repo.to_path_buf(),
            report: Default::default(),
        })
    }

    #[test]
    fn push_progress_counts_the_repos_of_a_burst_that_have_finished() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        let (a, b) = (repo_at("/Music/a"), repo_at("/Music/b"));
        assert_eq!(reducer.snapshot().push.progress, None);

        reducer.apply(&recorded_in(a.clone()));
        reducer.apply(&recorded_in(b.clone()));
        assert_eq!(
            reducer.snapshot().push.progress,
            None,
            "nothing is pushing while the repos wait their turn"
        );

        reducer.apply(&started(&a));
        assert_eq!(
            reducer.snapshot().push.progress,
            Some(PushProgress { done: 0, total: 2 })
        );
        reducer.apply(&finished(&a));
        reducer.apply(&started(&b));
        assert_eq!(
            reducer.snapshot().push.progress,
            Some(PushProgress { done: 1, total: 2 })
        );

        reducer.apply(&finished(&b));
        assert_eq!(reducer.snapshot().push.progress, None);
        // The next burst starts again from nothing.
        reducer.apply(&recorded_in(a.clone()));
        reducer.apply(&started(&a));
        assert_eq!(
            reducer.snapshot().push.progress,
            Some(PushProgress { done: 0, total: 1 })
        );
    }

    #[test]
    fn a_repo_that_stops_for_a_reason_of_its_own_counts_as_done_for_the_arc() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        let (a, b) = (repo_at("/Music/a"), repo_at("/Music/b"));
        reducer.apply(&recorded_in(a.clone()));
        reducer.apply(&recorded_in(b.clone()));
        reducer.apply(&started(&a));
        reducer.apply(&push(PushEvent::Failed {
            repo: a.clone(),
            message: "Over the storage limit.".to_string(),
            storage_limit: true,
        }));
        reducer.apply(&started(&b));

        assert_eq!(
            reducer.snapshot().push.progress,
            Some(PushProgress { done: 1, total: 2 })
        );
    }

    #[test]
    fn a_render_card_carries_what_the_daemon_says_of_why_it_was_offered() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        let mut card = render(1, RenderState::Proposed, &[("/Music/x.wav", 10)]);
        card.bounced_after_ms = Some(240_000);
        card.reason_kinds = dit_daemon::renders::score::ReasonKinds {
            named: true,
            in_folder: false,
            near_save: true,
        };

        reducer.apply(&DaemonEvent::Render(card.clone()));

        let shown = &reducer.snapshot().renders[0];
        assert_eq!(shown.render.bounced_after_ms, Some(240_000));
        assert_eq!(shown.render.reason_kinds, card.reason_kinds);
    }

    fn render(id: u64, state: RenderState, files: &[(&str, u64)]) -> RenderEvent {
        RenderEvent {
            id,
            name: "science123 v4".to_string(),
            state,
            files: files
                .iter()
                .map(|(path, size)| dit_daemon::renders::RenderFile {
                    path: PathBuf::from(path),
                    size: *size,
                })
                .collect(),
            batch: None,
            uploaded_file: None,
            pair_note: None,
            progress: None,
            score: Some(0.8),
            reasons: vec!["Named like \u{201c}science123\u{201d}".to_string()],
            bounced_after_ms: None,
            reason_kinds: Default::default(),
            session_id: Some(812),
            message: None,
        }
    }

    fn wav(id: u64, state: RenderState) -> RenderEvent {
        render(id, state, &[("/Music/out/science123 v4.wav", 40)])
    }

    fn cards(reducer: &Reducer) -> Vec<(u64, RenderState)> {
        reducer
            .snapshot()
            .renders
            .iter()
            .map(|card| (card.render.id, card.render.state))
            .collect()
    }

    #[test]
    fn a_render_takes_its_place_by_id_through_every_state() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        assert!(reducer.snapshot().renders.is_empty());

        let states = [
            RenderState::Waiting,
            RenderState::Proposed,
            RenderState::Uploading,
            RenderState::QueuedOffline,
            RenderState::OverLimit,
            RenderState::Added,
        ];
        for state in states {
            let mut event = wav(7, state);
            if state == RenderState::Uploading {
                event.progress = Some(dit_daemon::renders::RenderProgress {
                    sent: 10,
                    total: 40,
                });
            }
            reducer.apply(&DaemonEvent::Render(event));
            assert_eq!(cards(&reducer), [(7, state)], "{state:?}");
        }
        // The card carries what the daemon said of it, flattened.
        let card = &reducer.snapshot().renders[0];
        assert_eq!(
            card.render.reasons,
            ["Named like \u{201c}science123\u{201d}"]
        );

        reducer.apply(&DaemonEvent::Render(wav(8, RenderState::Proposed)));
        assert_eq!(
            cards(&reducer),
            [(7, RenderState::Added), (8, RenderState::Proposed)],
            "a new render joins after the ones there are"
        );
    }

    #[test]
    fn a_rejected_render_has_no_card() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        reducer.apply(&DaemonEvent::Render(wav(1, RenderState::Proposed)));
        reducer.apply(&DaemonEvent::Render(wav(2, RenderState::Proposed)));

        reducer.apply(&DaemonEvent::Render(wav(1, RenderState::Rejected)));

        assert_eq!(cards(&reducer), [(2, RenderState::Proposed)]);
        reducer.apply(&DaemonEvent::Render(wav(9, RenderState::Rejected)));
        assert_eq!(cards(&reducer), [(2, RenderState::Proposed)]);
    }

    #[test]
    fn renders_added_before_this_run_are_not_cards_and_those_added_during_it_are_the_newest_three()
    {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        reducer.set_renders(vec![
            wav(1, RenderState::Added),
            wav(2, RenderState::Proposed),
            wav(3, RenderState::Rejected),
            wav(4, RenderState::Waiting),
        ]);
        assert_eq!(
            cards(&reducer),
            [(2, RenderState::Proposed), (4, RenderState::Waiting)]
        );

        for id in [10, 11, 12, 13] {
            reducer.apply(&DaemonEvent::Render(wav(id, RenderState::Added)));
        }
        assert_eq!(
            cards(&reducer),
            [
                (2, RenderState::Proposed),
                (4, RenderState::Waiting),
                (11, RenderState::Added),
                (12, RenderState::Added),
                (13, RenderState::Added),
            ]
        );
        // The engine's whole list again (a hub attached again): what was added this run is still shown.
        reducer.set_renders(vec![
            wav(1, RenderState::Added),
            wav(12, RenderState::Added),
            wav(13, RenderState::Added),
        ]);
        assert_eq!(
            cards(&reducer),
            [(12, RenderState::Added), (13, RenderState::Added)]
        );
        reducer.set_renders(Vec::new());
        assert!(reducer.snapshot().renders.is_empty());
    }

    #[test]
    fn the_bar_shows_the_note_for_renders_that_wait_for_a_decision_and_for_no_others() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        reducer.apply(&DaemonEvent::OpenSet(Some(open_info())));
        assert!(!reducer.snapshot().bar_title.contains('\u{266a}'));

        reducer.apply(&DaemonEvent::Render(wav(1, RenderState::Waiting)));
        assert!(!reducer.snapshot().bar_title.contains('\u{266a}'), "held");
        reducer.apply(&DaemonEvent::Render(wav(1, RenderState::Proposed)));
        assert!(
            reducer.snapshot().bar_title.contains('\u{266a}'),
            "proposed"
        );
        reducer.apply(&DaemonEvent::Render(wav(1, RenderState::Uploading)));
        assert!(!reducer.snapshot().bar_title.contains('\u{266a}'), "taken");
        reducer.apply(&DaemonEvent::Render(wav(1, RenderState::OverLimit)));
        assert!(
            reducer.snapshot().bar_title.contains('\u{266a}'),
            "over limit"
        );
    }

    fn hub_set(instance: &str, session_id: i64, name: &str) -> HubSetRef {
        HubSetRef {
            instance: instance.to_string(),
            session_id,
            name: name.to_string(),
        }
    }

    #[test]
    fn a_card_names_its_set_and_offers_the_other_sets_of_its_repo_on_this_instance() {
        const HUB: &str = "https://projammr.example";
        let fake = Arc::new(Fake::default());
        *fake.1.lock().unwrap() = RepoFacts {
            hub_sets: vec![
                hub_set(HUB, 813, "remix"),
                hub_set(HUB, 812, "science123"),
                hub_set("https://other.example", 900, "elsewhere"),
            ],
            ..RepoFacts::default()
        };
        let mut reducer = reducer_with(&fake);
        reducer.set_auth(Auth {
            state: AuthState::SignedIn,
            host: Some(HUB.to_string()),
            pending: None,
        });
        reducer.apply(&DaemonEvent::RepoTracked { repo: repo() });
        let sets = |reducer: &Reducer| {
            let card = &reducer.snapshot().renders[0];
            (
                card.set.clone(),
                card.other_sets
                    .iter()
                    .map(|set| (set.session_id, set.name.clone()))
                    .collect::<Vec<_>>(),
            )
        };

        reducer.apply(&DaemonEvent::Render(wav(1, RenderState::Proposed)));
        assert_eq!(
            sets(&reducer),
            (
                Some("science123".to_string()),
                vec![(813, "remix".to_string())]
            )
        );

        // A render with no session of its own can be added to any set of the account's repos.
        let mut unmatched = wav(1, RenderState::Proposed);
        unmatched.session_id = None;
        reducer.apply(&DaemonEvent::Render(unmatched));
        assert_eq!(
            sets(&reducer),
            (
                None,
                vec![(813, "remix".to_string()), (812, "science123".to_string())]
            )
        );

        // A session that is not one of this repo's does not name itself either.
        let mut stranger = wav(1, RenderState::Proposed);
        stranger.session_id = Some(999);
        reducer.apply(&DaemonEvent::Render(stranger));
        assert_eq!(sets(&reducer).0, None);
    }

    #[test]
    fn a_cards_length_is_read_once_for_the_file_it_shows_and_not_while_held() {
        let fake = Arc::new(Fake::default());
        fake.3
            .lock()
            .unwrap()
            .0
            .insert(PathBuf::from("/Music/out/Mix.wav"), 222_000);
        let mut reducer = reducer_with(&fake);
        let pair = render(
            3,
            RenderState::Waiting,
            &[("/Music/out/Mix.mp3", 10), ("/Music/out/Mix.wav", 90)],
        );

        reducer.apply(&DaemonEvent::Render(pair.clone()));
        assert_eq!(fake.3.lock().unwrap().1, 0, "held renders are not read");
        assert_eq!(reducer.snapshot().renders[0].duration_ms, None);

        let mut proposed = pair.clone();
        proposed.state = RenderState::Proposed;
        reducer.apply(&DaemonEvent::Render(proposed.clone()));
        assert_eq!(reducer.snapshot().renders[0].duration_ms, Some(222_000));
        proposed.state = RenderState::Uploading;
        proposed.uploaded_file = Some(1);
        reducer.apply(&DaemonEvent::Render(proposed));
        assert_eq!(fake.3.lock().unwrap().1, 1, "the same file is read once");
        assert_eq!(reducer.snapshot().renders[0].duration_ms, Some(222_000));
    }

    #[test]
    fn restore_state_follows_the_link_it_belongs_to() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        assert_eq!(reducer.snapshot().restore, RestoreState::Idle);

        reducer.set_pending_restore(Some(PendingRestore::link(41)));
        reducer.set_restore(RestoreState::Fetching { objects: 3 });
        // The same link arriving again leaves a restore in progress as it is.
        reducer.set_pending_restore(Some(PendingRestore::link(41)));
        assert_eq!(
            reducer.snapshot().restore,
            RestoreState::Fetching { objects: 3 }
        );
        // Another commit is another restore.
        reducer.set_pending_restore(Some(PendingRestore::link(42)));
        assert_eq!(reducer.snapshot().restore, RestoreState::Idle);

        reducer.set_restore(RestoreState::Failed {
            message: "no".to_string(),
            suggestion: None,
            existing: None,
        });
        reducer.set_pending_restore(None);
        assert_eq!(reducer.snapshot().restore, RestoreState::Idle);
        assert_eq!(reducer.snapshot().pending_restore, None);
    }

    #[test]
    fn what_the_hub_says_of_a_commit_fills_only_the_restore_it_was_asked_for() {
        let fake = Arc::new(Fake::default());
        let mut reducer = reducer_with(&fake);
        reducer.set_pending_restore(Some(PendingRestore::link(41)));

        reducer.fill_pending_restore(40, |pending| pending.problem = Some("stale".to_string()));
        assert_eq!(
            reducer.snapshot().pending_restore,
            Some(PendingRestore::link(41))
        );

        reducer.fill_pending_restore(41, |pending| {
            pending.message = Some("added strings".to_string());
            pending.set = Some("science123".to_string());
            pending.branch = Some("restore-a1b2c3d".to_string());
        });
        let pending = reducer.snapshot().pending_restore.clone().unwrap();
        assert_eq!(pending.message.as_deref(), Some("added strings"));
        assert_eq!(pending.branch.as_deref(), Some("restore-a1b2c3d"));
        assert_eq!(pending.problem, None);

        reducer.set_pending_restore(None);
        reducer.fill_pending_restore(41, |pending| pending.problem = Some("late".to_string()));
        assert_eq!(reducer.snapshot().pending_restore, None);
    }
}
