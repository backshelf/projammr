//! The render engine: what becomes of an audio file that appears under the producer's home folder, as a state machine
//! fed filesystem events and the time, the way [`crate::Daemon`] is, so a test drives it with a clock in its hand.
//!
//! A file is followed from its first event: it is [`Settle`]d (its size and mtime hold for 5 s), then held for
//! [`HOLD_MS`] from the moment it became stable, so a second format of the same bounce and the next stem of an export
//! have time to arrive. A render (the files of one folder with one stem) is decided when all its files are due.
//! Renders written within a minute of one another, three or more, are a batch and are decided together.
//!
//! Deciding a render fingerprints and probes its files, drops what the producer said "Not a bounce" to (by
//! fingerprint, so a rename or a move does not matter) or "Never here" to, picks the file to upload (the largest
//! that fits `max_upload_mb`), scores the render against the tracks of the sets dit knows and offers it as a
//! proposal when the score is high enough. Every change is written to the ledger at once and reported as a card,
//! [`Output::Card`].
//!
//! The engine does no uploading and never decides one: a proposal is uploaded only once the producer accepts it. It
//! says which proposals to upload again ([`Output::Upload`], for the ones an accept had started, and the ones a
//! retry is due for) and is told how each attempt ended ([`Engine::upload_ended`]), which is how it schedules a retry
//! after the hub could not be reached.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::UNIX_EPOCH;

use crate::beat::retry_delay_ms;
use crate::fswatch::FsEvent;
use crate::settle::{Probe, Rule, Settle, Verdict};

use super::driver::{OVER_LIMIT_MESSAGE, UploadEnd};
use super::event::RenderEvent;
use super::ledger::{Ledger, Proposal, ProposalFile, ProposalState, UploadProgress};
use super::probe::{Probe as Header, fingerprint, probe};
use super::rules::{
    Candidate, Choice, Exclusions, Render, batches, due_after_hold, group_pairs, is_audio_path,
    upload_choice,
};
use super::score::{
    Evidence, MIN_RENDER_MS, NAMES_A_TRACK, Place, Score, place_of, score, timing_of,
    title_similarity,
};

/// How many sets a render is scored against with the hub's track titles, best name first: each costs a request the
/// first time.
const TITLED_SETS: usize = 5;

/// What the engine needs to know about how to behave.
#[derive(Debug, Clone)]
pub struct EngineConfig {
    /// The ledger file.
    pub ledger_path: PathBuf,
    /// The folder watched: the names above it are the producer's choice, so only what is below it is excluded.
    pub home: PathBuf,
    /// The largest file to upload, in MiB; 0 for no limit.
    pub max_upload_mb: u64,
    /// The folders a DAW exports to, which speak for a render in them.
    pub export_dirs: Vec<PathBuf>,
}

/// A set the hub holds a session for: what a render is scored against.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetRef {
    pub session_id: i64,
    /// The set file.
    pub set_path: PathBuf,
    /// The folder of the set's project, when its DAW makes one.
    pub project_folder: Option<PathBuf>,
    /// When the set was saved, in milliseconds since the epoch.
    pub save_times_ms: Vec<i64>,
}

impl SetRef {
    /// The names a render of the set might carry, besides its track's title: the set's file name and its project
    /// folder's.
    fn names(&self) -> Vec<String> {
        let stem = self
            .set_path
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned());
        let folder = self
            .project_folder
            .as_deref()
            .and_then(Path::file_name)
            .map(|name| name.to_string_lossy().into_owned());
        stem.into_iter().chain(folder).collect()
    }
}

/// What the engine asks of the world about the sets a render may belong to.
pub trait Catalogue: Send + Sync {
    /// Every set the hub holds a session for.
    fn sets(&self) -> Vec<SetRef>;
    /// The title of the track of a session, when it has one and the hub can be asked.
    fn track_title(&self, session_id: i64) -> Option<String>;
}

/// What the engine asks its caller to do.
#[derive(Debug, Clone, PartialEq)]
pub enum Output {
    /// A render changed: tell the panel.
    Card(Box<RenderEvent>),
    /// Upload this proposal now.
    Upload(u64),
    /// The hub no longer accepts the sign-in: report it, and no upload is asked for until [`Engine::resume`].
    SignedOut { host: String },
    /// The ledger could not be read or written.
    Error(String),
}

/// A render's files share a folder and, without regard to case, a stem.
type Key = (PathBuf, String);

fn key_of(path: &Path) -> Key {
    (
        path.parent().map(Path::to_path_buf).unwrap_or_default(),
        path.file_stem()
            .map(|stem| stem.to_string_lossy().to_lowercase())
            .unwrap_or_default(),
    )
}

/// A file's size and modification time in milliseconds, or `None` when it is not a file that can be read.
fn stat(path: &Path) -> Option<(u64, i64)> {
    let meta = std::fs::metadata(path).ok().filter(|meta| meta.is_file())?;
    let mtime = meta.modified().ok().map_or(0, |modified| {
        modified
            .duration_since(UNIX_EPOCH)
            .map_or(0, |since| since.as_millis() as i64)
    });
    Some((meta.len(), mtime))
}

/// A file being followed.
struct Tracked {
    size: u64,
    mtime_ms: i64,
    /// Present until the file has held still.
    settle: Option<Settle>,
    /// When the file became stable.
    stable_at: Option<i64>,
}

/// A proposal waiting for the hub to be reachable.
struct Retry {
    at: i64,
    failures: u32,
}

pub struct Engine {
    cfg: EngineConfig,
    catalogue: Box<dyn Catalogue>,
    exclusions: Arc<RwLock<Exclusions>>,
    files: BTreeMap<PathBuf, Tracked>,
    /// Renders whose files changed since the ledger was brought up to date.
    dirty: BTreeSet<Key>,
    retries: BTreeMap<u64, Retry>,
    paused: bool,
}

impl Engine {
    /// An engine with nothing followed. `exclusions` is shared with the watcher's filter, so a folder the producer
    /// says "Never here" to stops being offered files at once.
    pub fn new(
        cfg: EngineConfig,
        catalogue: Box<dyn Catalogue>,
        exclusions: Arc<RwLock<Exclusions>>,
    ) -> Self {
        Engine {
            cfg,
            catalogue,
            exclusions,
            files: BTreeMap::new(),
            dirty: BTreeSet::new(),
            retries: BTreeMap::new(),
            paused: false,
        }
    }

    /// Changes the size limit for renders judged from now on, in MiB; 0 for no limit. A proposal already made keeps
    /// the choice it was made with.
    pub fn set_max_upload_mb(&mut self, max_upload_mb: u64) {
        self.cfg.max_upload_mb = max_upload_mb;
    }

    fn excluded(&self, path: &Path) -> bool {
        !is_audio_path(path)
            || self
                .exclusions
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .excludes_watched(&self.cfg.home, path)
    }

    /// Takes up what the ledger says is unfinished, as after the app started: renders still held are followed
    /// again, an upload that was under way continues and one that waited for the hub is retried.
    pub fn start(&mut self, now: i64) -> Vec<Output> {
        let ledger = match Ledger::load(&self.cfg.ledger_path) {
            Ok(ledger) => ledger,
            Err(error) => return vec![Output::Error(error.to_string())],
        };
        let mut out = Vec::new();
        let mut gone = Vec::new();
        for proposal in &ledger.proposals {
            match proposal.state {
                ProposalState::Waiting => {
                    let mut any = false;
                    for file in &proposal.files {
                        if let Some((size, mtime)) = stat(&file.path) {
                            self.arm(&file.path, size, mtime, now);
                            any = true;
                        }
                    }
                    if !any {
                        gone.push(proposal.id);
                    }
                }
                ProposalState::Uploading => out.push(Output::Upload(proposal.id)),
                ProposalState::QueuedOffline => {
                    self.retries.insert(
                        proposal.id,
                        Retry {
                            at: now,
                            failures: 0,
                        },
                    );
                }
                _ => {}
            }
        }
        if !gone.is_empty() {
            out.extend(self.remove(&gone));
        }
        out
    }

    /// Follows `path` from a new event at `now`.
    fn arm(&mut self, path: &Path, size: u64, mtime_ms: i64, now: i64) {
        let mut settle = Settle::new(Rule::Stable, now);
        settle.observe(size, mtime_ms);
        self.files.insert(
            path.to_path_buf(),
            Tracked {
                size,
                mtime_ms,
                settle: Some(settle),
                stable_at: None,
            },
        );
        self.dirty.insert(key_of(path));
    }

    /// A path changed at `now`. Audio files the exclusions allow are followed; a path that is gone is forgotten.
    pub fn fs_event(&mut self, event: FsEvent, now: i64) {
        if self.excluded(&event.path) {
            return;
        }
        let Some((size, mtime_ms)) = stat(&event.path) else {
            if self.files.remove(&event.path).is_some() {
                self.dirty.insert(key_of(&event.path));
            }
            return;
        };
        match self.files.get_mut(&event.path) {
            None => self.arm(&event.path, size, mtime_ms, now),
            Some(tracked) => {
                // A file that already held still and has not changed is not made to hold still again.
                if tracked.stable_at.is_some()
                    && (tracked.size, tracked.mtime_ms) == (size, mtime_ms)
                {
                    return;
                }
                tracked.size = size;
                tracked.mtime_ms = mtime_ms;
                tracked.stable_at = None;
                match &mut tracked.settle {
                    Some(settle) => {
                        settle.event(now);
                        settle.observe(size, mtime_ms);
                    }
                    None => {
                        let mut settle = Settle::new(Rule::Stable, now);
                        settle.observe(size, mtime_ms);
                        tracked.settle = Some(settle);
                    }
                }
                self.dirty.insert(key_of(&event.path));
            }
        }
    }

    /// Time passed: settle the files that are due, bring the ledger up to date, decide the renders whose hold is
    /// over and retry the uploads that waited for the hub.
    pub fn tick(&mut self, now: i64) -> Vec<Output> {
        self.settle(now);
        let mut out = self.sync_waiting(now);
        out.extend(self.decide_due(now));
        out.extend(self.due_retries(now));
        out
    }

    /// Looks at each file whose check is due.
    fn settle(&mut self, now: i64) {
        let due: Vec<PathBuf> = self
            .files
            .iter()
            .filter(|(_, tracked)| {
                tracked
                    .settle
                    .as_ref()
                    .is_some_and(|settle| settle.due(now))
            })
            .map(|(path, _)| path.clone())
            .collect();
        for path in due {
            let looked = stat(&path);
            let Some(tracked) = self.files.get_mut(&path) else {
                continue;
            };
            let Some(settle) = tracked.settle.as_mut() else {
                continue;
            };
            let probe = looked.map_or(Probe::Gone, |(size, mtime)| Probe::Stat { size, mtime });
            match settle.check(now, || probe) {
                Verdict::Ready => {
                    if let Some((size, mtime)) = looked {
                        tracked.size = size;
                        tracked.mtime_ms = mtime;
                    }
                    tracked.settle = None;
                    tracked.stable_at = Some(now);
                    self.dirty.insert(key_of(&path));
                }
                Verdict::Gone => {
                    self.files.remove(&path);
                    self.dirty.insert(key_of(&path));
                }
                Verdict::Wait | Verdict::GaveUp => {}
            }
        }
    }

    /// The files followed that belong to `key`, as candidates.
    fn candidates_of(&self, key: &Key) -> Vec<Candidate> {
        self.files
            .range(key.0.clone()..)
            .take_while(|(path, _)| path.starts_with(&key.0))
            .filter(|(path, _)| &key_of(path) == key)
            .map(|(path, tracked)| Candidate {
                path: path.clone(),
                size: tracked.size,
                mtime_ms: tracked.mtime_ms,
            })
            .collect()
    }

    /// Whether `render` has a name or a place or a time that ties it to some set: a file with none is not worth a
    /// card.
    fn relates(&self, render: &Render, sets: &[SetRef]) -> bool {
        render_relates(render, sets, &self.cfg.export_dirs)
    }

    /// Brings the ledger's held renders up to date with the files that settled or went: a render with a stable file
    /// that relates to a set gets a proposal in [`ProposalState::Waiting`]; one whose files are all gone loses it.
    fn sync_waiting(&mut self, now: i64) -> Vec<Output> {
        if self.dirty.is_empty() {
            return Vec::new();
        }
        let keys: Vec<Key> = std::mem::take(&mut self.dirty).into_iter().collect();
        let sets = self.catalogue.sets();
        let mut plans: Vec<(Key, Vec<Candidate>, bool)> = Vec::new();
        for key in keys {
            let all = self.candidates_of(&key);
            let stable: Vec<Candidate> = all
                .iter()
                .filter(|file| {
                    self.files
                        .get(&file.path)
                        .is_some_and(|tracked| tracked.stable_at.is_some())
                })
                .cloned()
                .collect();
            let relates = group_pairs(&stable)
                .first()
                .is_some_and(|render| self.relates(render, &sets));
            plans.push((key, stable, relates));
        }
        let changed = Ledger::update(&self.cfg.ledger_path, |ledger| {
            let mut changed: Vec<Proposal> = Vec::new();
            let mut forgotten: Vec<Key> = Vec::new();
            for (key, stable, relates) in &plans {
                let waiting = ledger.proposals.iter().position(|proposal| {
                    proposal.state == ProposalState::Waiting
                        && proposal
                            .files
                            .first()
                            .map(|file| key_of(&file.path))
                            .as_ref()
                            == Some(key)
                });
                let files: Vec<ProposalFile> = stable
                    .iter()
                    .map(|file| ProposalFile {
                        path: file.path.clone(),
                        size: file.size,
                        mtime_ms: file.mtime_ms,
                        fingerprint: None,
                    })
                    .collect();
                if let Some(at) = waiting {
                    if files.is_empty() && !self.has_files(key) {
                        let mut gone = ledger.proposals.remove(at);
                        gone.state = ProposalState::Rejected;
                        changed.push(gone);
                    } else if !files.is_empty() && !same_files(&ledger.proposals[at].files, &files)
                    {
                        ledger.proposals[at].files = files;
                        changed.push(ledger.proposals[at].clone());
                    }
                    continue;
                }
                if files.is_empty() {
                    continue;
                }
                if !relates {
                    forgotten.push(key.clone());
                    continue;
                }
                // The newest proposal of these files that is no longer held.
                let earlier = ledger
                    .proposals
                    .iter()
                    .filter(|proposal| {
                        proposal
                            .files
                            .first()
                            .map(|file| key_of(&file.path))
                            .as_ref()
                            == Some(key)
                    })
                    .max_by_key(|proposal| proposal.id)
                    .map(|proposal| {
                        (
                            proposal.id,
                            proposal.state,
                            same_files(&proposal.files, &files),
                        )
                    });
                match earlier {
                    Some((_, _, true)) => forgotten.push(key.clone()),
                    Some((id, ProposalState::Proposed | ProposalState::OverLimit, false)) => {
                        let proposal = ledger.by_id_mut(id).expect("found above");
                        proposal.files = files;
                        proposal.state = ProposalState::Waiting;
                        proposal.first_seen_ms = now;
                        proposal.session_id = None;
                        proposal.track_id = None;
                        proposal.score = None;
                        proposal.reasons = Vec::new();
                        proposal.bounced_after_ms = None;
                        proposal.reason_kinds = Default::default();
                        proposal.upload = UploadProgress::default();
                        proposal.batch = None;
                        proposal.message = None;
                        changed.push(proposal.clone());
                    }
                    _ => {
                        let name = stable
                            .first()
                            .and_then(|file| file.path.file_stem())
                            .map(|stem| stem.to_string_lossy().into_owned())
                            .unwrap_or_default();
                        let id = ledger.propose(name, files, now);
                        changed.push(ledger.by_id(id).expect("just proposed").clone());
                    }
                }
            }
            (changed, forgotten)
        });
        match changed {
            Ok((changed, forgotten)) => {
                for key in forgotten {
                    self.forget(&key);
                }
                changed
                    .iter()
                    .map(|proposal| Output::Card(Box::new(RenderEvent::of(proposal))))
                    .collect()
            }
            Err(error) => vec![Output::Error(error.to_string())],
        }
    }

    fn has_files(&self, key: &Key) -> bool {
        !self.candidates_of(key).is_empty()
    }

    /// Stops following the files of `key`.
    fn forget(&mut self, key: &Key) {
        for file in self.candidates_of(key) {
            self.files.remove(&file.path);
        }
    }

    /// Drops the held proposals `ids` from the ledger and tells the panel they are gone.
    fn remove(&mut self, ids: &[u64]) -> Vec<Output> {
        let removed = Ledger::update(&self.cfg.ledger_path, |ledger| {
            let mut removed = Vec::new();
            ledger.proposals.retain(|proposal| {
                let drop = ids.contains(&proposal.id);
                if drop {
                    let mut gone = proposal.clone();
                    gone.state = ProposalState::Rejected;
                    removed.push(gone);
                }
                !drop
            });
            removed
        });
        match removed {
            Ok(removed) => removed
                .iter()
                .map(|proposal| Output::Card(Box::new(RenderEvent::of(proposal))))
                .collect(),
            Err(error) => vec![Output::Error(error.to_string())],
        }
    }

    /// Decides the renders whose files are all stable and held long enough, whole batches together.
    fn decide_due(&mut self, now: i64) -> Vec<Output> {
        if self.files.is_empty() {
            return Vec::new();
        }
        let everything: Vec<Candidate> = self
            .files
            .iter()
            .map(|(path, tracked)| Candidate {
                path: path.clone(),
                size: tracked.size,
                mtime_ms: tracked.mtime_ms,
            })
            .collect();
        let renders = group_pairs(&everything);
        let due: Vec<bool> = renders
            .iter()
            .map(|render| {
                render.files.iter().all(|file| {
                    self.files
                        .get(&file.path)
                        .and_then(|tracked| tracked.stable_at)
                        .is_some_and(|at| due_after_hold(at, now))
                })
            })
            .collect();
        let mut batch_of: Vec<Option<usize>> = vec![None; renders.len()];
        let mut ready: Vec<usize> = Vec::new();
        for batch in batches(&renders) {
            for index in &batch {
                batch_of[*index] = Some(batch.len());
            }
            if batch.iter().all(|index| due[*index]) {
                ready.extend(batch);
            }
        }
        ready.extend((0..renders.len()).filter(|index| batch_of[*index].is_none() && due[*index]));
        ready.sort_unstable();

        let mut out = Vec::new();
        for index in ready {
            let render = &renders[index];
            out.extend(self.decide(render, batch_of[index]));
            for file in &render.files {
                self.files.remove(&file.path);
            }
        }
        out
    }

    /// Decides one render whose hold is over: puts it in a state, or drops it.
    fn decide(&self, render: &Render, batch: Option<usize>) -> Vec<Output> {
        let Some(first) = render.files.first() else {
            return Vec::new();
        };
        let key = key_of(&first.path);
        let ledger = match Ledger::load(&self.cfg.ledger_path) {
            Ok(ledger) => ledger,
            Err(error) => return vec![Output::Error(error.to_string())],
        };
        let Some(id) = ledger
            .proposals
            .iter()
            .find(|proposal| {
                proposal.state == ProposalState::Waiting
                    && proposal
                        .files
                        .first()
                        .map(|file| key_of(&file.path))
                        .as_ref()
                        == Some(&key)
            })
            .map(|proposal| proposal.id)
        else {
            return Vec::new();
        };

        let mut kept: Vec<(Candidate, Option<String>)> = Vec::new();
        for file in &render.files {
            let Some((size, mtime_ms)) = stat(&file.path) else {
                continue;
            };
            let print = fingerprint(&file.path).ok();
            let known = print.as_deref().is_some_and(|print| {
                ledger.is_rejected(print)
                    || ledger.proposals.iter().any(|other| {
                        other.id != id
                            && !matches!(
                                other.state,
                                ProposalState::Waiting | ProposalState::Rejected
                            )
                            && other
                                .files
                                .iter()
                                .any(|held| held.fingerprint.as_deref() == Some(print))
                    })
            });
            if known || ledger.is_never_here(&file.path) {
                continue;
            }
            kept.push((
                Candidate {
                    path: file.path.clone(),
                    size,
                    mtime_ms,
                },
                print,
            ));
        }

        let verdict = if kept.is_empty() {
            None
        } else {
            let whole = Render {
                name: render.name.clone(),
                files: kept.iter().map(|(file, _)| file.clone()).collect(),
            };
            self.judge(&whole)
        };
        let max_upload_mb = self.cfg.max_upload_mb;
        let applied = Ledger::update(&self.cfg.ledger_path, |ledger| {
            let at = ledger
                .proposals
                .iter()
                .position(|proposal| proposal.id == id)?;
            if ledger.proposals[at].state != ProposalState::Waiting {
                // Somebody (`dit renders reject`, an accept) took the proposal while it was being judged.
                return None;
            }
            let Some(verdict) = verdict else {
                let mut gone = ledger.proposals.remove(at);
                gone.state = ProposalState::Rejected;
                return Some(gone);
            };
            let proposal = &mut ledger.proposals[at];
            proposal.files = kept
                .iter()
                .map(|(file, print)| ProposalFile {
                    path: file.path.clone(),
                    size: file.size,
                    mtime_ms: file.mtime_ms,
                    fingerprint: print.clone(),
                })
                .collect();
            let whole = Render {
                name: proposal.name.clone(),
                files: proposal
                    .files
                    .iter()
                    .map(|file| Candidate {
                        path: file.path.clone(),
                        size: file.size,
                        mtime_ms: file.mtime_ms,
                    })
                    .collect(),
            };
            let choice = upload_choice(&whole, max_upload_mb);
            proposal.session_id = Some(verdict.session_id);
            proposal.score = Some(verdict.score.value);
            proposal.reasons = verdict.score.reasons.clone();
            proposal.bounced_after_ms = verdict.score.bounced_after_ms;
            proposal.reason_kinds = verdict.score.reason_kinds;
            proposal.batch = batch;
            proposal.upload = UploadProgress::default();
            match choice {
                Choice::Upload(index) => {
                    proposal.upload.chosen = Some(index);
                    proposal.upload.total_bytes = proposal.files[index].size;
                    proposal.state = ProposalState::Proposed;
                    proposal.message = None;
                }
                Choice::OverLimit => {
                    proposal.state = ProposalState::OverLimit;
                    proposal.message = Some(OVER_LIMIT_MESSAGE.to_string());
                }
            }
            Some(proposal.clone())
        });
        match applied {
            Ok(Some(proposal)) => vec![Output::Card(Box::new(RenderEvent::of(&proposal)))],
            Ok(None) => Vec::new(),
            Err(error) => vec![Output::Error(error.to_string())],
        }
    }

    /// The session a render most likely belongs to and how sure that is, or `None` when it is not worth offering.
    fn judge(&self, render: &Render) -> Option<Best> {
        let sets = self.catalogue.sets();
        judge_render(
            render,
            &sets,
            &self.cfg.export_dirs,
            self.cfg.max_upload_mb,
            super::score::ASK_CONFIDENCE,
            &mut |session_id| self.catalogue.track_title(session_id),
        )
    }

    /// An upload attempt ended. `Offline` is retried after the beat's backoff; a refused sign-in pauses every
    /// upload until [`Engine::resume`].
    pub fn upload_ended(&mut self, id: u64, end: &UploadEnd, now: i64) -> Vec<Output> {
        match end {
            UploadEnd::Offline { .. } => {
                let failures = self.retries.get(&id).map_or(0, |retry| retry.failures) + 1;
                self.retries.insert(
                    id,
                    Retry {
                        at: now + retry_delay_ms(failures),
                        failures,
                    },
                );
                Vec::new()
            }
            UploadEnd::SignedOut { host } => {
                self.retries.insert(
                    id,
                    Retry {
                        at: now,
                        failures: 0,
                    },
                );
                let first = !self.paused;
                self.paused = true;
                if first {
                    vec![Output::SignedOut { host: host.clone() }]
                } else {
                    Vec::new()
                }
            }
            UploadEnd::Added
            | UploadEnd::NoTrack
            | UploadEnd::Refused { .. }
            | UploadEnd::Failed { .. } => {
                self.retries.remove(&id);
                Vec::new()
            }
        }
    }

    /// The producer signed in again: the uploads that waited go at once.
    pub fn resume(&mut self, now: i64) {
        self.paused = false;
        for retry in self.retries.values_mut() {
            retry.at = retry.at.min(now);
        }
    }

    fn due_retries(&mut self, now: i64) -> Vec<Output> {
        if self.paused {
            return Vec::new();
        }
        let due: Vec<u64> = self
            .retries
            .iter()
            .filter(|(_, retry)| retry.at <= now)
            .map(|(id, _)| *id)
            .collect();
        for id in &due {
            // Kept with its failures until the attempt ends, which schedules the next one or forgets it.
            if let Some(retry) = self.retries.get_mut(id) {
                retry.at = i64::MAX;
            }
        }
        due.into_iter().map(Output::Upload).collect()
    }

    /// How many files are being followed.
    pub fn following(&self) -> usize {
        self.files.len()
    }
}

/// The best session for a render.
pub struct Best {
    pub session_id: i64,
    pub score: Score,
}

fn place_for_set(dir: &Path, set: &SetRef, export_dirs: &[PathBuf]) -> Place {
    place_of(
        dir,
        set.set_path.parent().unwrap_or(Path::new("")),
        set.project_folder.as_deref(),
        export_dirs,
    )
}

/// Whether `render` has a name, place, or timing tying it to any set in `sets`.
pub(crate) fn render_relates(render: &Render, sets: &[SetRef], export_dirs: &[PathBuf]) -> bool {
    let Some(dir) = render.files.first().and_then(|file| file.path.parent()) else {
        return false;
    };
    let mtime = render.mtime_ms();
    sets.iter().any(|set| {
        place_for_set(dir, set, export_dirs) != Place::Elsewhere
            || set
                .names()
                .iter()
                .any(|name| title_similarity(&render.name, name) >= NAMES_A_TRACK)
            || timing_of(mtime, &set.save_times_ms) >= 0.5
    })
}

/// Scores `render` against `sets` using the render engine's rules, returning the best session whose score reaches
/// `min_confidence` and passes eligibility (`is_offered` when using the default threshold, or `eligible && value >=
/// min_confidence`).
pub fn judge_render(
    render: &Render,
    sets: &[SetRef],
    export_dirs: &[PathBuf],
    max_upload_mb: u64,
    min_confidence: f64,
    track_title: &mut dyn FnMut(i64) -> Option<String>,
) -> Option<Best> {
    let dir = render.files.first()?.path.parent()?;
    let largest = render
        .files
        .iter()
        .max_by_key(|file| file.size)
        .map(|file| file.path.as_path())?;
    let chosen = match upload_choice(render, max_upload_mb) {
        Choice::Upload(index) => render.files[index].path.as_path(),
        Choice::OverLimit => largest,
    };
    let header: Header = probe(chosen);
    let mtime_ms = render.mtime_ms();

    let evaluate = |set: &SetRef, title: Option<&str>| {
        let own = set.names();
        let names: Vec<&str> = title
            .into_iter()
            .chain(own.iter().map(String::as_str))
            .collect();
        score(&Evidence {
            file_stem: &render.name,
            names: &names,
            mtime_ms,
            save_times_ms: &set.save_times_ms,
            place: place_for_set(dir, set, export_dirs),
            duration_ms: header.duration_ms,
            format: header.format.as_deref(),
            min_render_ms: MIN_RENDER_MS,
            version: None,
        })
    };

    let mut related: Vec<(&SetRef, f64)> = sets
        .iter()
        .filter(|set| render_relates(render, std::slice::from_ref(*set), export_dirs))
        .map(|set| (set, evaluate(set, None).value))
        .collect();
    related.sort_by(|a, b| {
        b.1.total_cmp(&a.1)
            .then(a.0.session_id.cmp(&b.0.session_id))
    });
    related.truncate(TITLED_SETS);

    let mut best: Option<Best> = None;
    for (set, _) in related {
        let title = track_title(set.session_id);
        let found = evaluate(set, title.as_deref());
        if best
            .as_ref()
            .is_none_or(|best| found.value > best.score.value)
        {
            best = Some(Best {
                session_id: set.session_id,
                score: found,
            });
        }
    }
    best.filter(|best| best.score.value > 0.0 && best.score.value >= min_confidence)
}

/// Whether two lists of files are the same files, as found: paths, sizes and times.
fn same_files(held: &[ProposalFile], found: &[ProposalFile]) -> bool {
    held.len() == found.len()
        && held.iter().all(|file| {
            found.iter().any(|other| {
                other.path == file.path
                    && other.size == file.size
                    && other.mtime_ms == file.mtime_ms
            })
        })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::fs::{self, File};
    use std::time::Duration;

    use tempfile::TempDir;

    use super::super::driver;
    use super::super::ledger::ProposalState::*;
    use super::*;

    const S: i64 = 1_000;
    const MIB: usize = 1024 * 1024;

    struct Fake {
        sets: Vec<SetRef>,
        titles: HashMap<i64, String>,
    }

    impl Catalogue for Fake {
        fn sets(&self) -> Vec<SetRef> {
            self.sets.clone()
        }

        fn track_title(&self, session_id: i64) -> Option<String> {
            self.titles.get(&session_id).cloned()
        }
    }

    /// An engine over a temp home with a project folder `Canopy Project` holding the set of session 5.
    struct Rig {
        _dir: TempDir,
        home: PathBuf,
        ledger: PathBuf,
        sets: Vec<SetRef>,
        titles: HashMap<i64, String>,
        exclusions: Arc<RwLock<Exclusions>>,
        engine: Engine,
        max_upload_mb: u64,
        outputs: Vec<Output>,
    }

    fn managed() -> Exclusions {
        Exclusions::new(&["Samples", "Backup"], &[])
    }

    impl Rig {
        fn new() -> Self {
            Self::with(0, Vec::new())
        }

        /// `save_times_ms` are the times session 5's set was saved.
        fn with(max_upload_mb: u64, save_times_ms: Vec<i64>) -> Self {
            let dir = tempfile::tempdir().unwrap();
            let home = dir.path().join("home");
            let project = home.join("Canopy Project");
            fs::create_dir_all(project.join("Bounces")).unwrap();
            let sets = vec![SetRef {
                session_id: 5,
                set_path: project.join("Canopy.als"),
                project_folder: Some(project),
                save_times_ms,
            }];
            let titles = HashMap::from([(5, "Canopy".to_string())]);
            let exclusions = Arc::new(RwLock::new(managed()));
            let ledger = dir.path().join("renders.json");
            let mut rig = Rig {
                engine: Engine::new(
                    EngineConfig {
                        ledger_path: ledger.clone(),
                        home: home.clone(),
                        max_upload_mb,
                        export_dirs: Vec::new(),
                    },
                    Box::new(Fake {
                        sets: sets.clone(),
                        titles: titles.clone(),
                    }),
                    exclusions.clone(),
                ),
                _dir: dir,
                home,
                ledger,
                sets,
                titles,
                exclusions,
                max_upload_mb,
                outputs: Vec::new(),
            };
            rig.outputs.clear();
            rig
        }

        /// The engine as it is after the app is quit and started again: nothing followed, the ledger kept.
        fn restart(&mut self, now: i64) {
            self.engine = Engine::new(
                EngineConfig {
                    ledger_path: self.ledger.clone(),
                    home: self.home.clone(),
                    max_upload_mb: self.max_upload_mb,
                    export_dirs: Vec::new(),
                },
                Box::new(Fake {
                    sets: self.sets.clone(),
                    titles: self.titles.clone(),
                }),
                self.exclusions.clone(),
            );
            let started = self.engine.start(now);
            self.outputs.extend(started);
        }

        fn project(&self) -> PathBuf {
            self.home.join("Canopy Project")
        }

        /// Writes `len` bytes that depend on the path, so no two files share a fingerprint, with `mtime_ms`.
        fn audio(&self, path: &Path, len: usize, mtime_ms: u64) {
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let mut state = path
                .to_string_lossy()
                .bytes()
                .fold(0x9E37_79B9_7F4A_7C15_u64, |acc, byte| {
                    acc.rotate_left(5) ^ u64::from(byte)
                })
                | 1;
            let bytes: Vec<u8> = (0..len)
                .map(|_| {
                    state ^= state << 13;
                    state ^= state >> 7;
                    state ^= state << 17;
                    (state >> 24) as u8
                })
                .collect();
            fs::write(path, bytes).unwrap();
            File::options()
                .write(true)
                .open(path)
                .unwrap()
                .set_modified(UNIX_EPOCH + Duration::from_millis(mtime_ms))
                .unwrap();
        }

        /// A bounce in the project's `Bounces` folder, written and heard at `now`.
        fn bounce(&mut self, name: &str, len: usize, mtime_ms: u64, now: i64) -> PathBuf {
            let path = self.project().join("Bounces").join(name);
            self.audio(&path, len, mtime_ms);
            self.touch(&path, now);
            path
        }

        fn touch(&mut self, path: &Path, now: i64) {
            self.engine.fs_event(
                FsEvent {
                    path: path.to_path_buf(),
                    removed: false,
                },
                now,
            );
        }

        fn tick(&mut self, now: i64) {
            let out = self.engine.tick(now);
            self.outputs.extend(out);
        }

        fn ledger(&self) -> Ledger {
            Ledger::load(&self.ledger).unwrap()
        }

        fn proposals(&self) -> Vec<Proposal> {
            self.ledger().proposals
        }

        fn states(&self) -> Vec<ProposalState> {
            self.proposals()
                .iter()
                .map(|proposal| proposal.state)
                .collect()
        }

        fn cards(&self) -> Vec<&RenderEvent> {
            self.outputs
                .iter()
                .filter_map(|output| match output {
                    Output::Card(card) => Some(&**card),
                    _ => None,
                })
                .collect()
        }

        fn uploads(&self) -> Vec<u64> {
            self.outputs
                .iter()
                .filter_map(|output| match output {
                    Output::Upload(id) => Some(*id),
                    _ => None,
                })
                .collect()
        }
    }

    #[test]
    fn a_file_is_proposed_sixty_seconds_after_it_became_stable_and_not_before() {
        let mut rig = Rig::new();
        rig.bounce("Canopy v3.wav", 4_000, 1_000_000, 0);

        rig.tick(4_999);
        assert!(
            rig.proposals().is_empty(),
            "not stable yet: its size and time have not held for 5 s"
        );

        rig.tick(5 * S);
        assert_eq!(rig.states(), [Waiting], "stable at 5 s, held");

        rig.tick(5 * S + 59 * S);
        assert_eq!(rig.states(), [Waiting], "59 s after it became stable");

        rig.tick(5 * S + 60 * S);
        assert_eq!(rig.states(), [Proposed], "60 s after it became stable");
        let proposed = &rig.proposals()[0];
        assert_eq!(proposed.session_id, Some(5));
        assert!(proposed.score.unwrap() >= 0.75, "{:?}", proposed.score);
        assert_eq!(proposed.upload.chosen, Some(0));
        assert!(
            proposed.files[0]
                .fingerprint
                .as_deref()
                .unwrap()
                .starts_with("dit:4000:")
        );
    }

    #[test]
    fn a_file_still_being_written_is_not_followed_to_a_proposal() {
        let mut rig = Rig::new();
        let path = rig.bounce("Canopy v3.wav", 4_000, 1_000_000, 0);
        rig.audio(&path, 9_000, 1_003_000);
        rig.touch(&path, 3 * S);

        rig.tick(5 * S);
        assert!(
            rig.proposals().is_empty(),
            "it grew at 3 s, so it is looked at again at 8 s"
        );
        rig.tick(8 * S);
        assert_eq!(rig.states(), [Waiting]);
        assert_eq!(rig.proposals()[0].files[0].size, 9_000);
    }

    #[test]
    fn a_file_deleted_before_it_is_stable_is_forgotten() {
        let mut rig = Rig::new();
        let path = rig.bounce("Canopy v3.wav", 4_000, 1_000_000, 0);
        fs::remove_file(&path).unwrap();

        rig.tick(5 * S);

        assert!(rig.proposals().is_empty());
        assert_eq!(rig.engine.following(), 0);
    }

    #[test]
    fn two_formats_of_one_bounce_are_one_proposal_naming_the_file_that_goes_up() {
        let mut rig = Rig::new();
        rig.bounce("Canopy v3.wav", 6_000, 1_000_000, 0);
        rig.bounce("Canopy v3.mp3", 2_000, 1_000_000, 0);

        rig.tick(5 * S);
        rig.tick(65 * S);

        let proposals = rig.proposals();
        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0].files.len(), 2);
        assert_eq!(proposals[0].upload.chosen, Some(1), "the larger, the wav");
        let card = rig.cards().last().copied().unwrap().clone();
        assert_eq!(
            card.pair_note.as_deref(),
            Some("Canopy v3.mp3 + Canopy v3.wav: will upload Canopy v3.wav")
        );
        assert_eq!(card.uploaded_file, Some(1));
    }

    #[test]
    fn a_second_format_arriving_later_restarts_the_hold_of_the_pair() {
        let mut rig = Rig::new();
        rig.bounce("Canopy v3.wav", 6_000, 1_000_000, 0);
        rig.tick(5 * S);
        rig.bounce("Canopy v3.mp3", 2_000, 1_000_000, 20 * S);
        rig.tick(25 * S);
        assert_eq!(
            rig.proposals()[0].files.len(),
            2,
            "the waiting proposal took the second format"
        );

        rig.tick(65 * S);
        assert_eq!(rig.states(), [Waiting], "the mp3 has been stable for 40 s");

        rig.tick(85 * S);
        assert_eq!(rig.states(), [Proposed]);
        assert_eq!(rig.proposals().len(), 1);
    }

    #[test]
    fn three_renders_written_within_a_minute_of_each_other_are_a_batch() {
        let mut rig = Rig::new();
        for (name, mtime) in [
            ("Canopy a.wav", 1_000_000),
            ("Canopy b.wav", 1_030_000),
            ("Canopy c.wav", 1_060_000),
            ("Canopy d.wav", 9_000_000),
        ] {
            rig.bounce(name, 3_000, mtime, 0);
        }
        rig.tick(5 * S);
        rig.tick(65 * S);

        let proposals = rig.proposals();
        let batches: Vec<(String, Option<usize>)> = proposals
            .iter()
            .map(|proposal| (proposal.name.clone(), proposal.batch))
            .collect();
        assert_eq!(
            batches,
            [
                ("Canopy a".to_string(), Some(3)),
                ("Canopy b".to_string(), Some(3)),
                ("Canopy c".to_string(), Some(3)),
                ("Canopy d".to_string(), None),
            ]
        );
        assert!(
            proposals
                .iter()
                .all(|proposal| proposal.state == Proposed && proposal.files.len() == 1)
        );
        let cards: Vec<_> = rig
            .cards()
            .into_iter()
            .filter(|card| card.state == Proposed)
            .collect();
        assert_eq!(cards.iter().filter(|card| card.batch == Some(3)).count(), 3);
    }

    #[test]
    fn two_renders_are_not_a_batch() {
        let mut rig = Rig::new();
        rig.bounce("Canopy a.wav", 3_000, 1_000_000, 0);
        rig.bounce("Canopy b.wav", 3_000, 1_030_000, 0);
        rig.tick(5 * S);
        rig.tick(65 * S);
        assert!(
            rig.proposals()
                .iter()
                .all(|proposal| proposal.batch.is_none())
        );
        assert_eq!(rig.proposals().len(), 2);
    }

    #[test]
    fn a_batch_waits_for_its_slowest_member() {
        let mut rig = Rig::new();
        rig.bounce("Canopy a.wav", 3_000, 1_000_000, 0);
        rig.bounce("Canopy b.wav", 3_000, 1_030_000, 0);
        rig.bounce("Canopy c.wav", 3_000, 1_060_000, 30 * S);
        rig.tick(5 * S);
        rig.tick(35 * S);
        rig.tick(65 * S);
        assert_eq!(
            rig.states()
                .iter()
                .filter(|state| **state == Waiting)
                .count(),
            3,
            "a and b are due but c is not"
        );
        rig.tick(95 * S);
        assert!(
            rig.proposals()
                .iter()
                .all(|proposal| proposal.state == Proposed && proposal.batch == Some(3))
        );
    }

    #[test]
    fn stems_managed_folders_and_never_here_folders_are_not_followed() {
        let mut rig = Rig::new();
        let project = rig.project();
        let never = rig.home.join("Archive");
        *rig.exclusions.write().unwrap() =
            Exclusions::new(&["Samples", "Backup"], std::slice::from_ref(&never));
        let paths = [
            project.join("Stems").join("Kick.wav"),
            project.join("Bounces").join("Canopy stems.wav"),
            project.join("Bounces").join("Canopy_stem_02.wav"),
            project.join("Samples").join("Recorded").join("Canopy.wav"),
            project.join("Backup").join("Canopy.wav"),
            project.join(".git").join("Canopy.wav"),
            rig.home.join("Library").join("Canopy.wav"),
            rig.home.join("node_modules").join("Canopy.wav"),
            never.join("Canopy.wav"),
            project.join("Bounces").join("Canopy notes.txt"),
        ];
        for path in &paths {
            rig.audio(path, 3_000, 1_000_000);
            rig.touch(path, 0);
        }
        assert_eq!(rig.engine.following(), 0);

        // Names above the watched folder are the producer's: a home inside a folder called `Library` still works.
        let kept = rig.project().join("Bounces").join("Canopy v3.wav");
        rig.audio(&kept, 3_000, 1_000_000);
        rig.touch(&kept, 0);
        assert_eq!(rig.engine.following(), 1);
    }

    #[test]
    fn the_largest_file_that_fits_the_limit_goes_up_and_the_pair_says_so() {
        let mut rig = Rig::with(2, Vec::new());
        rig.bounce("Canopy v3.wav", 3 * MIB, 1_000_000, 0);
        rig.bounce("Canopy v3.mp3", MIB, 1_000_000, 0);
        rig.tick(5 * S);
        rig.tick(65 * S);

        let proposal = &rig.proposals()[0];
        assert_eq!(proposal.state, Proposed);
        assert_eq!(
            proposal.upload.chosen,
            Some(0),
            "the mp3: the wav is over 2 MiB"
        );
        let card = rig.cards().last().copied().unwrap().clone();
        assert_eq!(
            card.pair_note.as_deref(),
            Some("Canopy v3.mp3 + Canopy v3.wav: will upload Canopy v3.mp3")
        );
    }

    #[test]
    fn a_render_none_of_whose_files_fits_the_limit_is_over_the_limit() {
        let mut rig = Rig::with(1, Vec::new());
        rig.bounce("Canopy v3.wav", 3 * MIB, 1_000_000, 0);
        rig.bounce("Canopy v3.mp3", 2 * MIB, 1_000_000, 0);
        rig.tick(5 * S);
        rig.tick(65 * S);

        let proposal = &rig.proposals()[0];
        assert_eq!(proposal.state, OverLimit);
        assert_eq!(proposal.message.as_deref(), Some("Over your size limit"));
        assert_eq!(proposal.upload.chosen, None);
        assert!(
            rig.uploads().is_empty(),
            "never uploaded, whatever the score"
        );
        let card = rig.cards().last().copied().unwrap().clone();
        assert_eq!(card.state, OverLimit);
        assert_eq!(
            card.pair_note.as_deref(),
            Some("Canopy v3.mp3 + Canopy v3.wav: none fits the size limit")
        );
    }

    #[test]
    fn a_limit_changed_while_a_render_is_held_judges_it_by_the_new_one() {
        let mut rig = Rig::with(1, Vec::new());
        rig.bounce("Canopy v3.wav", 3 * MIB, 1_000_000, 0);
        rig.tick(5 * S);

        rig.engine.set_max_upload_mb(0);
        rig.tick(65 * S);

        assert_eq!(rig.states(), [Proposed]);
    }

    #[test]
    fn no_limit_is_a_limit_of_zero() {
        let mut rig = Rig::with(0, Vec::new());
        rig.bounce("Canopy v3.wav", 3 * MIB, 1_000_000, 0);
        rig.tick(5 * S);
        rig.tick(65 * S);
        assert_eq!(rig.states(), [Proposed]);
    }

    #[test]
    fn a_sure_render_is_only_proposed_and_never_uploaded_unasked() {
        let mut rig = Rig::with(0, Vec::new());
        rig.bounce("Canopy v3.wav", 4_000, 1_000_000, 0);
        rig.tick(5 * S);
        rig.tick(65 * S);

        let proposal = &rig.proposals()[0];
        assert!(proposal.score.unwrap() > 0.75, "{:?}", proposal.score);
        assert_eq!(rig.states(), [Proposed]);
        assert!(rig.uploads().is_empty(), "nothing goes up unaccepted");
        let states: Vec<_> = rig.cards().iter().map(|card| card.state).collect();
        assert_eq!(states, [Waiting, Proposed]);
    }

    #[test]
    fn a_plausible_render_is_asked_about_and_never_uploaded_unasked() {
        // A generic name beside no project, made six hours after a save: worth asking, not a sure thing.
        let mtime = 100_000_000_u64;
        let mut rig = Rig::with(0, vec![mtime as i64 - 6 * 3_600_000]);
        let path = rig.home.join("Music").join("Bounce 1.wav");
        rig.audio(&path, 4_000, mtime);
        rig.touch(&path, 0);
        rig.tick(5 * S);
        rig.tick(65 * S);

        let proposal = &rig.proposals()[0];
        assert_eq!(proposal.state, Proposed);
        let score = proposal.score.unwrap();
        assert!((0.45..0.75).contains(&score), "{score}");
        assert!(rig.uploads().is_empty(), "asked, not taken");
    }

    #[test]
    fn the_tracks_title_names_a_render_the_set_does_not() {
        let mut rig = Rig::new();
        rig.titles.insert(5, "Nightfall".to_string());
        rig.restart(0);
        rig.bounce("Nightfall.wav", 4_000, 1_000_000, 0);
        rig.tick(5 * S);
        rig.tick(65 * S);
        let proposal = &rig.proposals()[0];
        assert_eq!(proposal.state, Proposed);
        assert!(
            proposal
                .reasons
                .iter()
                .any(|reason| reason.contains("Nightfall")),
            "{:?}",
            proposal.reasons
        );
        assert!(proposal.reason_kinds.named, "{:?}", proposal.reason_kinds);
        // The ledger keeps what the card shows: a card of it says the same.
        let card = RenderEvent::of(proposal);
        assert_eq!(card.reason_kinds, proposal.reason_kinds);
        assert_eq!(card.bounced_after_ms, proposal.bounced_after_ms);
    }

    #[test]
    fn a_render_named_for_another_song_is_dropped_without_a_trace_in_the_ledger() {
        let mut rig = Rig::new();
        rig.bounce("Completely Different Song.wav", 4_000, 1_000_000, 0);
        rig.tick(5 * S);
        assert_eq!(rig.states(), [Waiting], "in the project's folder, so held");
        rig.tick(65 * S);
        assert!(rig.proposals().is_empty());
        assert_eq!(
            rig.cards().last().unwrap().state,
            Rejected,
            "the card is told to go"
        );
    }

    #[test]
    fn audio_with_no_tie_to_any_set_never_enters_the_ledger() {
        let mut rig = Rig::new();
        let path = rig.home.join("Downloads").join("Fat Kick 07.wav");
        rig.audio(&path, 4_000, 1_000_000);
        rig.touch(&path, 0);
        rig.tick(5 * S);
        assert!(rig.proposals().is_empty());
        assert_eq!(rig.engine.following(), 0);
        assert!(rig.cards().is_empty());
    }

    #[test]
    fn not_a_bounce_survives_a_rename_a_move_and_a_restart() {
        let mut rig = Rig::new();
        let path = rig.bounce("Canopy v3.wav", 4_000, 1_000_000, 0);
        rig.tick(5 * S);
        rig.tick(65 * S);
        let id = rig.proposals()[0].id;
        driver::reject(&rig.ledger, id, false).unwrap();

        rig.restart(70 * S);
        let moved = rig.project().join("Old").join("Canopy final.wav");
        fs::create_dir_all(moved.parent().unwrap()).unwrap();
        fs::rename(&path, &moved).unwrap();
        rig.touch(&moved, 70 * S);
        rig.tick(75 * S);
        assert_eq!(rig.states(), [Rejected, Waiting], "followed, held");
        rig.tick(135 * S);

        assert_eq!(
            rig.states(),
            [Rejected],
            "the same bytes are never proposed again"
        );
        assert_eq!(rig.cards().last().unwrap().state, Rejected);
        assert!(rig.uploads().is_empty());
    }

    #[test]
    fn never_here_stops_a_folder_being_followed_and_survives_a_restart() {
        let mut rig = Rig::new();
        rig.bounce("Canopy v3.wav", 4_000, 1_000_000, 0);
        rig.tick(5 * S);
        rig.tick(65 * S);
        let id = rig.proposals()[0].id;
        driver::reject(&rig.ledger, id, true).unwrap();
        let never = rig.ledger().never_here;
        assert_eq!(never, [rig.project().join("Bounces")]);

        // What the app does when it is told: the filter takes the folder at once.
        *rig.exclusions.write().unwrap() = Exclusions::new(&["Samples", "Backup"], &never);
        rig.bounce("Canopy v4.wav", 4_000, 1_000_000, 70 * S);
        assert_eq!(rig.engine.following(), 0);

        // Started again, the engine's filter is built from the ledger by the service; a file that reaches the
        // engine anyway is dropped when it is decided.
        rig.restart(80 * S);
        let path = rig.project().join("Bounces").join("Canopy v5.wav");
        rig.audio(&path, 4_000, 1_000_000);
        *rig.exclusions.write().unwrap() = managed();
        rig.touch(&path, 80 * S);
        rig.tick(85 * S);
        rig.tick(145 * S);
        assert_eq!(rig.states(), [Rejected]);
    }

    #[test]
    fn a_copy_of_a_render_already_added_is_not_proposed_again() {
        let mut rig = Rig::new();
        let path = rig.bounce("Canopy v3.wav", 4_000, 1_000_000, 0);
        rig.tick(5 * S);
        rig.tick(65 * S);
        Ledger::update(&rig.ledger, |ledger| ledger.proposals[0].state = Added).unwrap();

        let copy = rig.project().join("Bounces").join("Canopy v3 copy.wav");
        fs::copy(&path, &copy).unwrap();
        rig.touch(&copy, 70 * S);
        rig.tick(75 * S);
        rig.tick(135 * S);

        assert_eq!(rig.states(), [Added]);
    }

    #[test]
    fn a_render_overwritten_after_it_was_proposed_is_held_again() {
        let mut rig = Rig::new();
        let path = rig.bounce("Canopy v3.wav", 4_000, 1_000_000, 0);
        rig.tick(5 * S);
        rig.tick(65 * S);
        let id = rig.proposals()[0].id;

        rig.audio(&path, 5_000, 2_000_000);
        rig.touch(&path, 100 * S);
        rig.tick(105 * S);

        let proposals = rig.proposals();
        assert_eq!(proposals.len(), 1, "the same proposal, not a second");
        assert_eq!((proposals[0].id, proposals[0].state), (id, Waiting));
        assert_eq!(proposals[0].files[0].size, 5_000);
        assert_eq!(proposals[0].score, None);
    }

    #[test]
    fn a_restart_follows_the_held_renders_again() {
        let mut rig = Rig::new();
        rig.bounce("Canopy v3.wav", 4_000, 1_000_000, 0);
        rig.tick(5 * S);
        assert_eq!(rig.states(), [Waiting]);

        rig.restart(100 * S);
        assert_eq!(rig.engine.following(), 1);
        rig.tick(105 * S);
        assert_eq!(rig.states(), [Waiting]);
        rig.tick(165 * S);
        assert_eq!(
            rig.states(),
            [Proposed],
            "held again from the restart, with the same proposal"
        );
        assert_eq!(rig.proposals().len(), 1);
    }

    #[test]
    fn a_held_render_whose_files_are_gone_after_a_restart_is_dropped() {
        let mut rig = Rig::new();
        let path = rig.bounce("Canopy v3.wav", 4_000, 1_000_000, 0);
        rig.tick(5 * S);
        fs::remove_file(path).unwrap();

        rig.restart(100 * S);

        assert!(rig.proposals().is_empty());
        assert_eq!(rig.cards().last().unwrap().state, Rejected);
    }

    #[test]
    fn a_restart_continues_an_upload_and_retries_one_that_waited_for_the_hub() {
        let mut rig = Rig::new();
        Ledger::update(&rig.ledger, |ledger| {
            for state in [Uploading, QueuedOffline, Proposed, Added] {
                let id = ledger.propose("x", Vec::new(), 0);
                ledger.by_id_mut(id).unwrap().state = state;
            }
        })
        .unwrap();

        rig.restart(10 * S);
        assert_eq!(rig.uploads(), [1], "the upload that was under way");
        rig.tick(10 * S);
        assert_eq!(
            rig.uploads(),
            [1, 2],
            "the one queued for the hub, at the first tick"
        );
    }

    #[test]
    fn an_upload_that_could_not_reach_the_hub_is_retried_with_the_beats_backoff() {
        let mut rig = Rig::new();
        let offline = UploadEnd::Offline {
            message: "away".into(),
        };

        rig.engine.upload_ended(7, &offline, 100 * S);
        rig.tick(104_999);
        assert!(rig.uploads().is_empty());
        rig.tick(105 * S);
        assert_eq!(rig.uploads(), [7], "5 s after the first failure");

        // The retry is out; it fails too, and the wait doubles.
        rig.engine.upload_ended(7, &offline, 106 * S);
        rig.tick(115_999);
        assert_eq!(rig.uploads(), [7]);
        rig.tick(116 * S);
        assert_eq!(rig.uploads(), [7, 7], "10 s after the second");

        // It went through: nothing more.
        rig.engine.upload_ended(7, &UploadEnd::Added, 117 * S);
        rig.tick(500 * S);
        assert_eq!(rig.uploads(), [7, 7]);
    }

    #[test]
    fn a_refused_sign_in_pauses_uploads_until_the_producer_signs_in_again() {
        let mut rig = Rig::new();
        let signed_out = UploadEnd::SignedOut {
            host: "hub.example".into(),
        };

        let first = rig.engine.upload_ended(3, &signed_out, 10 * S);
        let second = rig.engine.upload_ended(4, &signed_out, 10 * S);
        assert_eq!(
            first,
            [Output::SignedOut {
                host: "hub.example".into()
            }]
        );
        assert!(second.is_empty(), "told once");

        rig.tick(1_000 * S);
        assert!(rig.uploads().is_empty(), "paused");

        rig.engine.resume(2_000 * S);
        rig.tick(2_000 * S);
        let mut uploads = rig.uploads();
        uploads.sort_unstable();
        assert_eq!(uploads, [3, 4]);
    }

    #[test]
    fn an_unreadable_ledger_is_an_error_output_and_nothing_is_lost() {
        let mut rig = Rig::new();
        rig.bounce("Canopy v3.wav", 4_000, 1_000_000, 0);
        fs::write(&rig.ledger, "[not a ledger").unwrap();
        rig.tick(5 * S);
        assert!(
            matches!(rig.outputs.last(), Some(Output::Error(_))),
            "{:?}",
            rig.outputs
        );
        assert_eq!(fs::read_to_string(&rig.ledger).unwrap(), "[not a ledger");
    }
}
