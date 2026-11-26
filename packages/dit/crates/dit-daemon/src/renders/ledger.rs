//! The renders ledger: `renders.json` beside the user config (`~/Library/Application Support/dit/renders.json` on
//! macOS). It holds every render dit has found and where it stands (held, proposed, uploading, added, over the size
//! limit, rejected), the fingerprints of the files the producer said "Not a bounce" to, and the folders they said
//! "Never here" to.
//!
//! The app and the cli both write it while the app runs, so every change goes through [`Ledger::update`], which holds
//! a lock file for the read, the change and the write, as `RepoList::update` does for `repos.toml`. The write is a
//! temp file renamed into place, so a reader sees the whole old file or the whole replacement. A file that does not
//! parse is an error, never an empty ledger: resetting it would forget every rejection.

use std::io;
use std::path::{Path, PathBuf};

use dit_core::remote::{RemoteError, UserConfig};
use serde::{Deserialize, Serialize};

use crate::jsonfile;

use super::rules::is_under;
use super::score::ReasonKinds;

const FILE: &str = "renders.json";

/// Where a render stands. Each state but [`ProposalState::Waiting`] and [`ProposalState::Rejected`] is one the
/// producer sees in the panel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProposalState {
    /// Found, and held until it has been still long enough to be proposed.
    Waiting,
    /// Ready for the producer to add as a version or to reject.
    Proposed,
    /// Being uploaded, or accepted by the hub.
    Uploading,
    /// Accepted by the producer, waiting for the hub to be reachable.
    QueuedOffline,
    /// A version of its track.
    Added,
    /// No file of it fits the producer's size limit.
    OverLimit,
    /// The producer said it is not a bounce.
    Rejected,
}

/// How far the work of adding a render got, so a crash resumes at the step it was in: nothing done (`asset_id` is
/// `None`), uploaded (`asset_id` is the hub's asset), accepted (the proposal's state is [`ProposalState::Added`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UploadProgress {
    /// The index in [`Proposal::files`] of the file chosen to upload.
    pub chosen: Option<usize>,
    /// The hub's asset for the chosen file, once it holds the bytes.
    pub asset_id: Option<i64>,
    /// Bytes of the chosen file sent so far.
    pub sent_bytes: u64,
    /// The size of the chosen file.
    pub total_bytes: u64,
}

/// One audio file of a proposal, as found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalFile {
    pub path: PathBuf,
    /// Its size in bytes.
    pub size: u64,
    /// Its modification time in milliseconds since the epoch.
    pub mtime_ms: i64,
    /// Its `probe::fingerprint`, once read. A rejection is remembered by it, so a file without one cannot be
    /// remembered across a rename.
    pub fingerprint: Option<String>,
}

/// A render: one bounce, in one or more formats, and what is to be done with it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Proposal {
    /// Allocated once from the ledger's counter and never reused.
    pub id: u64,
    /// The stem the files share.
    pub name: String,
    pub files: Vec<ProposalFile>,
    pub state: ProposalState,
    /// When dit first saw the render, in milliseconds since the epoch.
    pub first_seen_ms: i64,
    /// The hub's session it is proposed for.
    pub session_id: Option<i64>,
    /// The hub's track it becomes a version of.
    pub track_id: Option<i64>,
    /// The save the render was bounced from.
    pub bounced_from_save_id: Option<i64>,
    /// The confidence it is a version of the track, from `score::score`.
    pub score: Option<f64>,
    /// Why, as sentences for the panel.
    #[serde(default)]
    pub reasons: Vec<String>,
    /// The render's time minus the time of the save nearest it, in milliseconds (positive: after the save), from
    /// `score::score`; `None` when no save time was known.
    #[serde(default)]
    pub bounced_after_ms: Option<i64>,
    /// Which kinds of evidence the sentences in `reasons` are made of.
    #[serde(default)]
    pub reason_kinds: ReasonKinds,
    #[serde(default)]
    pub upload: UploadProgress,
    /// How many renders written within a minute of one another this one was proposed with (an export of stems),
    /// when it is one of a batch.
    #[serde(default)]
    pub batch: Option<usize>,
    /// A sentence for the panel about where the render stands that its state does not say: why it is not added
    /// yet, or what the hub answered.
    #[serde(default)]
    pub message: Option<String>,
}

/// One thing the producer turned down, as the hub lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum Remembered {
    /// A file said "Not a bounce" to, by its fingerprint; `file_name` is the name it had when it was turned down,
    /// when that is still known.
    NotABounce {
        fingerprint: String,
        file_name: Option<String>,
    },
    /// A folder said "Never here" to, on this machine.
    NeverHere { folder: PathBuf },
}

impl Remembered {
    /// Whether `self` and `other` are the same thing turned down: a file by its fingerprint, whatever name it had,
    /// and a folder by its path.
    fn is(&self, other: &Remembered) -> bool {
        match (self, other) {
            (
                Remembered::NotABounce { fingerprint: a, .. },
                Remembered::NotABounce { fingerprint: b, .. },
            ) => a == b,
            (Remembered::NeverHere { folder: a }, Remembered::NeverHere { folder: b }) => a == b,
            _ => false,
        }
    }
}

/// A change to what is remembered that the hub has not been told of: the turn-down was made, or taken back, while
/// the hub was not reachable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Unsynced {
    pub remembered: Remembered,
    /// The turn-down was taken back.
    pub removed: bool,
}

/// Every render dit knows, what was rejected and where it is never to look.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Ledger {
    /// The id the next proposal gets. Allocation also steps over every id in use, so a hand-edited file cannot make
    /// two proposals share one.
    next_id: u64,
    pub proposals: Vec<Proposal>,
    /// The fingerprints of the files rejected as "Not a bounce".
    pub rejected: Vec<String>,
    /// Folders nothing is proposed from, as "Never here" said.
    pub never_here: Vec<PathBuf>,
    /// What changed in `rejected` and `never_here` since the hub last heard, oldest first. The hub is the record of
    /// both lists and these two are this machine's copy for the engine to read, so a change waits here until the
    /// hub has taken it.
    pub unsynced: Vec<Unsynced>,
    /// Whether this machine's own lists went up to the hub: the one move of what the app kept before the hub
    /// held it. Never reset, because the file cannot be.
    pub uploaded: bool,
}

impl Ledger {
    /// `renders.json` in the folder of the default user config.
    pub fn default_path() -> Result<PathBuf, RemoteError> {
        Ok(Self::beside(&UserConfig::default_path()?))
    }

    /// `renders.json` in the folder of the user config at `config`.
    pub fn beside(config: &Path) -> PathBuf {
        config.with_file_name(FILE)
    }

    /// The ledger at `path`; an empty one when there is no file yet. A file that does not parse is an
    /// `InvalidData` error naming the file, and is left as it is.
    pub fn load(path: &Path) -> io::Result<Self> {
        jsonfile::load(path)
    }

    /// Reads the ledger, lets `change` edit it and writes it back, all under the ledger's lock file, so two
    /// processes never lose each other's change. Returns what `change` returns. When the file cannot be read or
    /// parsed, `change` does not run and nothing is written.
    pub fn update<T>(path: &Path, change: impl FnOnce(&mut Ledger) -> T) -> io::Result<T> {
        jsonfile::update(path, change)
    }

    fn allocate_id(&mut self) -> u64 {
        let highest = self.proposals.iter().map(|proposal| proposal.id).max();
        let id = self
            .next_id
            .max(highest.map_or(1, |highest| highest.saturating_add(1)));
        self.next_id = id.saturating_add(1);
        id
    }

    /// Adds a render found at `first_seen_ms`, held ([`ProposalState::Waiting`]), and returns its id. The rest of the
    /// proposal (session, track, score, upload) is filled in through [`Ledger::by_id_mut`] as it becomes known.
    pub fn propose(
        &mut self,
        name: impl Into<String>,
        files: Vec<ProposalFile>,
        first_seen_ms: i64,
    ) -> u64 {
        let id = self.allocate_id();
        self.proposals.push(Proposal {
            id,
            name: name.into(),
            files,
            state: ProposalState::Waiting,
            first_seen_ms,
            session_id: None,
            track_id: None,
            bounced_from_save_id: None,
            score: None,
            reasons: Vec::new(),
            bounced_after_ms: None,
            reason_kinds: ReasonKinds::default(),
            upload: UploadProgress::default(),
            batch: None,
            message: None,
        });
        id
    }

    /// The proposal with `id`.
    pub fn by_id(&self, id: u64) -> Option<&Proposal> {
        self.proposals.iter().find(|proposal| proposal.id == id)
    }

    /// The proposal with `id`, to edit.
    pub fn by_id_mut(&mut self, id: u64) -> Option<&mut Proposal> {
        self.proposals.iter_mut().find(|proposal| proposal.id == id)
    }

    /// Moves the proposal with `id` to `state`. False when there is no such proposal.
    pub fn set_state(&mut self, id: u64, state: ProposalState) -> bool {
        match self.by_id_mut(id) {
            Some(proposal) => {
                proposal.state = state;
                true
            }
            None => false,
        }
    }

    /// Rejects the proposal with `id` as "Not a bounce": its state becomes [`ProposalState::Rejected`] and the
    /// fingerprint of each of its files is remembered, so the same bytes are never proposed again under any name.
    /// A file with no fingerprint cannot be remembered. With `never_here`, the folder of each file is also added to
    /// the folders nothing is proposed from. False when there is no such proposal.
    pub fn reject(&mut self, id: u64, never_here: bool) -> bool {
        let Some(proposal) = self.proposals.iter_mut().find(|proposal| proposal.id == id) else {
            return false;
        };
        proposal.state = ProposalState::Rejected;
        let mut made = Vec::new();
        for file in &proposal.files {
            if let Some(fingerprint) = &file.fingerprint
                && !self.rejected.contains(fingerprint)
            {
                self.rejected.push(fingerprint.clone());
                made.push(Remembered::NotABounce {
                    fingerprint: fingerprint.clone(),
                    file_name: file
                        .path
                        .file_name()
                        .map(|name| name.to_string_lossy().into_owned()),
                });
            }
            if never_here
                && let Some(folder) = file.path.parent()
                && !self.never_here.iter().any(|held| is_under(folder, held))
            {
                self.never_here.push(folder.to_path_buf());
                made.push(Remembered::NeverHere {
                    folder: folder.to_path_buf(),
                });
            }
        }
        for remembered in made {
            self.note(remembered, false);
        }
        true
    }

    /// Takes "Not a bounce" back from the file with this fingerprint. False when it was not rejected.
    pub fn forget_rejected(&mut self, fingerprint: &str) -> bool {
        let before = self.rejected.len();
        self.rejected.retain(|held| held != fingerprint);
        let removed = self.rejected.len() != before;
        if removed {
            self.note(
                Remembered::NotABounce {
                    fingerprint: fingerprint.to_string(),
                    file_name: None,
                },
                true,
            );
        }
        removed
    }

    /// Takes "Never here" back from `folder`. False when it was not one.
    pub fn forget_never_here(&mut self, folder: &Path) -> bool {
        let before = self.never_here.len();
        self.never_here.retain(|held| held != folder);
        let removed = self.never_here.len() != before;
        if removed {
            self.note(
                Remembered::NeverHere {
                    folder: folder.to_path_buf(),
                },
                true,
            );
        }
        removed
    }

    /// Records that `remembered` was made (or taken back, with `removed`) and the hub has not heard. A change that
    /// undoes one still waiting cancels it: the hub never needs to hear of either.
    fn note(&mut self, remembered: Remembered, removed: bool) {
        if let Some(at) = self
            .unsynced
            .iter()
            .position(|held| held.remembered.is(&remembered) && held.removed != removed)
        {
            self.unsynced.remove(at);
        } else if !self
            .unsynced
            .iter()
            .any(|held| held.remembered.is(&remembered))
        {
            self.unsynced.push(Unsynced {
                remembered,
                removed,
            });
        }
    }

    /// Drops the changes in `told` from the ones waiting: the hub has them. A change made since stays.
    pub fn told(&mut self, told: &[Unsynced]) {
        self.unsynced.retain(|waiting| !told.contains(waiting));
    }

    /// Makes the lists the engine reads what the hub lists: the files turned down on any of the user's machines
    /// and this machine's folders, less what was taken back and plus what was turned down since the hub last
    /// heard, which are still waiting to be sent.
    pub fn adopt_hub(&mut self, rejected: Vec<String>, never_here: Vec<PathBuf>) {
        let mut files = Vec::with_capacity(rejected.len());
        let mut folders = Vec::with_capacity(never_here.len());
        for fingerprint in rejected {
            let taken_back = self.unsynced.iter().any(|waiting| {
                waiting.removed
                    && matches!(&waiting.remembered, Remembered::NotABounce { fingerprint: held, .. } if *held == fingerprint)
            });
            if !taken_back && !files.contains(&fingerprint) {
                files.push(fingerprint);
            }
        }
        for folder in never_here {
            let taken_back = self.unsynced.iter().any(|waiting| {
                waiting.removed
                    && matches!(&waiting.remembered, Remembered::NeverHere { folder: held } if *held == folder)
            });
            if !taken_back && !folders.contains(&folder) {
                folders.push(folder);
            }
        }
        for waiting in self.unsynced.iter().filter(|waiting| !waiting.removed) {
            match &waiting.remembered {
                Remembered::NotABounce { fingerprint, .. } if !files.contains(fingerprint) => {
                    files.push(fingerprint.clone());
                }
                Remembered::NeverHere { folder } if !folders.contains(folder) => {
                    folders.push(folder.clone());
                }
                _ => {}
            }
        }
        self.rejected = files;
        self.never_here = folders;
    }

    /// Whether a file with this fingerprint was rejected.
    pub fn is_rejected(&self, fingerprint: &str) -> bool {
        self.rejected.iter().any(|held| held == fingerprint)
    }

    /// Whether `path` is in a folder, at any depth, the producer said "Never here" to.
    pub fn is_never_here(&self, path: &Path) -> bool {
        self.never_here.iter().any(|folder| is_under(path, folder))
    }

    /// The name a file turned down as "Not a bounce" has in a proposal, when one still lists it.
    pub fn file_name_of(&self, fingerprint: &str) -> Option<String> {
        self.proposals
            .iter()
            .flat_map(|proposal| &proposal.files)
            .find(|file| file.fingerprint.as_deref() == Some(fingerprint))
            .and_then(|file| file.path.file_name())
            .map(|name| name.to_string_lossy().into_owned())
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::fs;
    use std::thread;

    use tempfile::TempDir;

    use super::*;
    use crate::renders::probe::fingerprint;

    fn file(path: &str, fingerprint: Option<&str>) -> ProposalFile {
        ProposalFile {
            path: PathBuf::from(path),
            size: 1_000,
            mtime_ms: 1_700_000_000_000,
            fingerprint: fingerprint.map(str::to_owned),
        }
    }

    fn path_in(dir: &TempDir) -> PathBuf {
        dir.path().join("dit").join("renders.json")
    }

    #[test]
    fn a_ledger_that_is_not_there_is_empty() {
        let dir = TempDir::new().unwrap();
        assert_eq!(Ledger::load(&path_in(&dir)).unwrap(), Ledger::default());
    }

    #[test]
    fn a_ledger_round_trips_through_update_and_load() {
        let dir = TempDir::new().unwrap();
        let path = path_in(&dir);
        let id = Ledger::update(&path, |ledger| {
            let id = ledger.propose(
                "Mix",
                vec![
                    file("/m/Mix.wav", Some("dit:1:aa")),
                    file("/m/Mix.mp3", None),
                ],
                42,
            );
            let proposal = ledger.by_id_mut(id).unwrap();
            proposal.state = ProposalState::Proposed;
            proposal.session_id = Some(7);
            proposal.track_id = Some(9);
            proposal.bounced_from_save_id = Some(11);
            proposal.score = Some(0.8);
            proposal.reasons = vec!["Named like “Canopy”".into()];
            proposal.upload = UploadProgress {
                chosen: Some(0),
                asset_id: Some(13),
                sent_bytes: 500,
                total_bytes: 1_000,
            };
            ledger.rejected.push("dit:2:bb".into());
            ledger.never_here.push(PathBuf::from("/m/Samples"));
            id
        })
        .unwrap();

        let loaded = Ledger::load(&path).unwrap();
        assert_eq!(loaded.by_id(id).unwrap().name, "Mix");
        assert_eq!(loaded.by_id(id).unwrap().upload.asset_id, Some(13));
        assert_eq!(loaded.rejected, ["dit:2:bb"]);
        assert_eq!(loaded.never_here, [PathBuf::from("/m/Samples")]);
        assert_eq!(
            Ledger::update(&path, |ledger| ledger.clone()).unwrap(),
            loaded
        );
    }

    #[test]
    fn the_file_is_camel_case_json_with_kebab_case_states() {
        let dir = TempDir::new().unwrap();
        let path = path_in(&dir);
        Ledger::update(&path, |ledger| {
            let id = ledger.propose("Mix", vec![file("/m/Mix.wav", Some("dit:1:aa"))], 42);
            ledger.set_state(id, ProposalState::QueuedOffline);
            ledger.never_here.push(PathBuf::from("/m/x"));
        })
        .unwrap();

        let json: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(json["nextId"], 2);
        assert_eq!(json["neverHere"][0], "/m/x");
        let proposal = &json["proposals"][0];
        assert_eq!(proposal["id"], 1);
        assert_eq!(proposal["firstSeenMs"], 42);
        assert_eq!(proposal["state"], "queued-offline");
        assert_eq!(proposal["files"][0]["mtimeMs"], 1_700_000_000_000_i64);
        assert_eq!(proposal["files"][0]["fingerprint"], "dit:1:aa");
        assert_eq!(proposal["upload"]["sentBytes"], 0);
        assert_eq!(proposal["bouncedFromSaveId"], serde_json::Value::Null);
    }

    #[test]
    fn every_state_has_its_name() {
        let names = [
            (ProposalState::Waiting, "waiting"),
            (ProposalState::Proposed, "proposed"),
            (ProposalState::Uploading, "uploading"),
            (ProposalState::QueuedOffline, "queued-offline"),
            (ProposalState::Added, "added"),
            (ProposalState::OverLimit, "over-limit"),
            (ProposalState::Rejected, "rejected"),
        ];
        for (state, name) in names {
            assert_eq!(
                serde_json::to_string(&state).unwrap(),
                format!("\"{name}\"")
            );
            assert_eq!(
                serde_json::from_str::<ProposalState>(&format!("\"{name}\"")).unwrap(),
                state
            );
        }
    }

    #[test]
    fn upload_progress_survives_a_restart_at_each_step() {
        let dir = TempDir::new().unwrap();
        let path = path_in(&dir);
        let id = Ledger::update(&path, |ledger| {
            let id = ledger.propose("Mix", vec![file("/m/Mix.wav", None)], 1);
            ledger.set_state(id, ProposalState::Uploading);
            ledger.by_id_mut(id).unwrap().upload.chosen = Some(0);
            id
        })
        .unwrap();
        let nothing_sent = Ledger::load(&path).unwrap();
        assert_eq!(nothing_sent.by_id(id).unwrap().upload.asset_id, None);

        Ledger::update(&path, |ledger| {
            ledger.by_id_mut(id).unwrap().upload.asset_id = Some(77);
        })
        .unwrap();
        let uploaded = Ledger::load(&path).unwrap();
        assert_eq!(uploaded.by_id(id).unwrap().upload.chosen, Some(0));
        assert_eq!(uploaded.by_id(id).unwrap().upload.asset_id, Some(77));
        assert_eq!(uploaded.by_id(id).unwrap().state, ProposalState::Uploading);
    }

    #[test]
    fn ids_are_unique_stable_and_continue_after_a_reload() {
        let dir = TempDir::new().unwrap();
        let path = path_in(&dir);
        let first = Ledger::update(&path, |ledger| {
            (
                ledger.propose("A", vec![file("/m/A.wav", None)], 1),
                ledger.propose("B", vec![file("/m/B.wav", None)], 2),
            )
        })
        .unwrap();
        assert_eq!(first, (1, 2));

        Ledger::update(&path, |ledger| {
            ledger.set_state(1, ProposalState::Added);
            ledger.reject(2, false);
        })
        .unwrap();
        let third = Ledger::update(&path, |ledger| {
            ledger.propose("C", vec![file("/m/C.wav", None)], 3)
        })
        .unwrap();
        assert_eq!(third, 3);

        let loaded = Ledger::load(&path).unwrap();
        let names: Vec<(u64, &str)> = loaded
            .proposals
            .iter()
            .map(|proposal| (proposal.id, proposal.name.as_str()))
            .collect();
        assert_eq!(names, [(1, "A"), (2, "B"), (3, "C")]);
    }

    #[test]
    fn an_id_is_not_reused_after_its_proposal_is_dropped() {
        let mut ledger = Ledger::default();
        let first = ledger.propose("A", vec![], 1);
        let second = ledger.propose("B", vec![], 2);
        ledger.proposals.retain(|proposal| proposal.id != second);
        assert_eq!(first, 1);
        assert_eq!(ledger.propose("C", vec![], 3), 3);
    }

    #[test]
    fn allocation_steps_over_ids_a_hand_edited_file_left_behind_the_counter() {
        let dir = TempDir::new().unwrap();
        let path = path_in(&dir);
        let mut ledger = Ledger::default();
        ledger.propose("A", vec![], 1);
        ledger.propose("B", vec![], 2);
        ledger.next_id = 1;
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, serde_json::to_vec(&ledger).unwrap()).unwrap();
        let id = Ledger::update(&path, |ledger| ledger.propose("C", vec![], 3)).unwrap();
        assert_eq!(id, 3);
    }

    #[test]
    fn threads_updating_at_once_lose_nothing() {
        let dir = TempDir::new().unwrap();
        let path = path_in(&dir);
        const THREADS: usize = 8;
        const EACH: usize = 20;
        thread::scope(|scope| {
            for thread in 0..THREADS {
                let path = &path;
                scope.spawn(move || {
                    for n in 0..EACH {
                        Ledger::update(path, |ledger| {
                            let name = format!("t{thread}-{n}");
                            let fingerprint = format!("dit:{thread}:{n}");
                            let id = ledger.propose(
                                name.clone(),
                                vec![file(&format!("/m/{name}.wav"), Some(&fingerprint))],
                                0,
                            );
                            if n % 2 == 0 {
                                ledger.reject(id, false);
                            }
                        })
                        .unwrap();
                    }
                });
            }
        });

        let loaded = Ledger::load(&path).unwrap();
        assert_eq!(loaded.proposals.len(), THREADS * EACH);
        let ids: BTreeSet<u64> = loaded
            .proposals
            .iter()
            .map(|proposal| proposal.id)
            .collect();
        assert_eq!(ids, (1..=(THREADS * EACH) as u64).collect());
        assert_eq!(loaded.rejected.len(), THREADS * EACH / 2);
    }

    #[test]
    fn a_rejection_survives_a_rename_because_it_is_by_content() {
        let dir = TempDir::new().unwrap();
        let path = path_in(&dir);
        let original = dir.path().join("Mix.wav");
        fs::write(&original, vec![7u8; 300_000]).unwrap();
        let print = fingerprint(&original).unwrap();

        Ledger::update(&path, |ledger| {
            let id = ledger.propose(
                "Mix",
                vec![ProposalFile {
                    path: original.clone(),
                    size: 300_000,
                    mtime_ms: 1,
                    fingerprint: Some(print.clone()),
                }],
                1,
            );
            assert!(ledger.reject(id, false));
        })
        .unwrap();

        let renamed = dir.path().join("Totally different name.wav");
        fs::rename(&original, &renamed).unwrap();
        let ledger = Ledger::load(&path).unwrap();
        assert!(ledger.is_rejected(&fingerprint(&renamed).unwrap()));

        let other = dir.path().join("Other.wav");
        fs::write(&other, vec![8u8; 300_000]).unwrap();
        assert!(!ledger.is_rejected(&fingerprint(&other).unwrap()));
    }

    #[test]
    fn rejecting_remembers_every_file_of_the_render_once() {
        let mut ledger = Ledger::default();
        let id = ledger.propose(
            "Mix",
            vec![
                file("/m/Mix.wav", Some("dit:1:aa")),
                file("/m/Mix.mp3", Some("dit:2:bb")),
                file("/m/Mix.flac", None),
            ],
            1,
        );
        assert!(ledger.reject(id, false));
        assert!(ledger.reject(id, false));
        assert_eq!(ledger.rejected, ["dit:1:aa", "dit:2:bb"]);
        assert_eq!(ledger.by_id(id).unwrap().state, ProposalState::Rejected);
        assert!(ledger.never_here.is_empty());
    }

    #[test]
    fn rejecting_an_unknown_render_changes_nothing() {
        let mut ledger = Ledger::default();
        ledger.propose("Mix", vec![file("/m/Mix.wav", Some("dit:1:aa"))], 1);
        let before = ledger.clone();
        assert!(!ledger.reject(99, true));
        assert!(!ledger.set_state(99, ProposalState::Added));
        assert_eq!(ledger, before);
        assert!(ledger.by_id(99).is_none());
    }

    #[test]
    fn never_here_excludes_the_folder_and_what_is_below_it() {
        let mut ledger = Ledger::default();
        let id = ledger.propose(
            "Mix",
            vec![
                file("/m/Canopy Project/Bounces/Mix.wav", Some("dit:1:aa")),
                file("/m/Canopy Project/Bounces/Mix.mp3", Some("dit:2:bb")),
            ],
            1,
        );
        assert!(ledger.reject(id, true));
        assert_eq!(
            ledger.never_here,
            [PathBuf::from("/m/Canopy Project/Bounces")]
        );
        assert!(ledger.is_never_here(Path::new("/m/Canopy Project/Bounces/Other.wav")));
        assert!(ledger.is_never_here(Path::new("/m/canopy project/BOUNCES/deep/Other.wav")));
        assert!(!ledger.is_never_here(Path::new("/m/Canopy Project/Mix.wav")));
        assert!(!ledger.is_never_here(Path::new("/m/Canopy Project/Bounces 2/Mix.wav")));
    }

    #[test]
    fn never_here_adds_no_folder_already_covered() {
        let mut ledger = Ledger::default();
        ledger.never_here.push(PathBuf::from("/m"));
        let id = ledger.propose("Mix", vec![file("/m/Bounces/Mix.wav", None)], 1);
        ledger.reject(id, true);
        assert_eq!(ledger.never_here, [PathBuf::from("/m")]);
    }

    #[test]
    fn a_corrupt_file_is_an_error_and_is_left_alone() {
        let dir = TempDir::new().unwrap();
        let path = path_in(&dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let junk = b"{ \"proposals\": [ {\"id\": 1, ";
        fs::write(&path, junk).unwrap();

        let loaded = Ledger::load(&path).unwrap_err();
        assert_eq!(loaded.kind(), io::ErrorKind::InvalidData);
        assert!(loaded.to_string().contains("renders.json"), "{loaded}");

        let mut ran = false;
        let updated = Ledger::update(&path, |_| ran = true).unwrap_err();
        assert_eq!(updated.kind(), io::ErrorKind::InvalidData);
        assert!(
            !ran,
            "the change must not run on a ledger that did not load"
        );
        assert_eq!(fs::read(&path).unwrap(), junk, "the file is not reset");
    }

    #[test]
    fn a_file_of_the_wrong_shape_is_an_error_too() {
        let dir = TempDir::new().unwrap();
        let path = path_in(&dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        for text in ["[]", "\"x\"", "{\"proposals\": 3}", ""] {
            fs::write(&path, text).unwrap();
            assert_eq!(
                Ledger::load(&path).unwrap_err().kind(),
                io::ErrorKind::InvalidData,
                "{text:?}"
            );
        }
    }

    #[test]
    fn a_file_missing_optional_parts_still_loads() {
        let dir = TempDir::new().unwrap();
        let path = path_in(&dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{}").unwrap();
        assert_eq!(Ledger::load(&path).unwrap(), Ledger::default());
    }

    #[test]
    fn update_creates_the_folder_and_returns_what_the_change_returns() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("a").join("b").join("renders.json");
        let answer = Ledger::update(&path, |_| 42).unwrap();
        assert_eq!(answer, 42);
        assert!(path.is_file());
    }

    #[test]
    fn a_write_leaves_no_temp_file_behind() {
        let dir = TempDir::new().unwrap();
        let path = path_in(&dir);
        Ledger::update(&path, |ledger| {
            ledger.propose("Mix", vec![], 1);
        })
        .unwrap();
        let leftovers: Vec<String> = fs::read_dir(path.parent().unwrap())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
    }

    #[test]
    fn the_default_path_is_beside_the_user_config() {
        if let Ok(path) = Ledger::default_path() {
            assert_eq!(path.file_name().unwrap(), "renders.json");
            assert_eq!(path.parent(), UserConfig::default_path().unwrap().parent());
        }
    }
}
