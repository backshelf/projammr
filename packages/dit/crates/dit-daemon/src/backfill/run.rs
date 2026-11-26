//! What a backfill does to one folder, a step at a time and with no state file, thread or clock: Check reads a folder's
//! sets into its `.dit/` and totals what the hub would add; the pieces Start is made of (the totals of a finished
//! folder, how a hub's answer is met) sit beside it. [`super::driver`] strings them together.

use std::collections::HashSet;
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use dit_core::fingerprint::file_fingerprint;
use dit_core::remote::{PushError, Remote, RemoteError, object_sizes, sample_object_sizes};
use dit_core::{ObjectId, Registry, Repo, RepoError, Save};
use serde::{Deserialize, Serialize};

use super::state::Totals;

/// The branch a backfilled set lives on.
const MAIN: &str = "main";

/// The most objects one `storage-check` request may carry.
const STORAGE_CHUNK: usize = 10_000;

/// Who records the saves a backfill makes: the DAW modules that read the sets, the author the one commit of each set
/// is made by, and the machine name every save carries.
#[derive(Clone)]
pub struct Recorder {
    pub registry: Registry,
    pub author: String,
    pub machine: Arc<dyn Fn() -> String + Send + Sync>,
}

impl Recorder {
    /// The repo of `folder`, made first when the folder has none; making one that is there is a no-op.
    pub(crate) fn repo(&self, folder: &Path) -> Result<Repo, RepoError> {
        let daw = self
            .registry
            .for_project_folder(folder)
            .ok_or_else(|| RepoError::NotAProject(folder.to_path_buf()))?;
        let machine = self.machine.clone();
        Ok(Repo::init(folder, daw)?.with_machine(move || machine()))
    }
}

/// Why a set is in doubt after Check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Doubt {
    /// The set file, or one of its `Backup/` copies, is not a document the DAW module can read: it is stored whole
    /// and read again later.
    Unreadable,
    /// The set could not be recorded now (its file changed while it was read, or went away); it is left out.
    Unrecorded(String),
}

/// A set of a checked folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckedSet {
    pub file: PathBuf,
    /// The set's id in the folder's repo; `None` when it could not be recorded ([`Doubt::Unrecorded`]).
    pub set_id: Option<String>,
    /// The saves on the set's `main` branch now.
    pub saves: usize,
    /// The DAW's `Backup/` copies of the set.
    pub copies: usize,
    /// The match fingerprint ([`file_fingerprint`]) of the set file and of each copy, for matching against the
    /// hub's sessions. A file that could not be read has none.
    pub fingerprints: Vec<String>,
    pub doubt: Option<Doubt>,
}

/// What Check found in a folder, and left in its `.dit/`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Checked {
    /// The folder, canonical.
    pub path: PathBuf,
    /// Check made the folder's `.dit/`: [`discard`] may remove it.
    pub created_dit: bool,
    pub sets: Vec<CheckedSet>,
    /// Every object a push of the recorded sets uploads without samples, once each, with the bytes it takes on the
    /// wire.
    pub objects: Vec<(ObjectId, u64)>,
    /// The sample objects a push adds when samples go with it, with the bytes each takes.
    pub samples: Vec<(ObjectId, u64)>,
    /// The folder's repo already pushes samples, as the hub last said.
    pub pushes_samples: bool,
}

impl Checked {
    /// Every object a push of the folder uploads: the samples too when the repo pushes them or `instance_forces`
    /// says the instance makes every repo push them ([`instance_pushes_samples`]).
    pub fn objects_to_send(
        &self,
        instance_forces: bool,
    ) -> impl Iterator<Item = (ObjectId, u64)> + '_ {
        let samples: &[(ObjectId, u64)] = if self.pushes_samples || instance_forces {
            &self.samples
        } else {
            &[]
        };
        self.objects.iter().chain(samples).copied()
    }
}

/// Why Check stopped.
#[derive(Debug)]
pub enum CheckError {
    /// The cancel flag was set; what was recorded stays.
    Cancelled,
    Failed(String),
}

impl fmt::Display for CheckError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CheckError::Cancelled => f.write_str("Check was cancelled."),
            CheckError::Failed(message) => f.write_str(message),
        }
    }
}

impl From<RepoError> for CheckError {
    fn from(error: RepoError) -> Self {
        CheckError::Failed(error.to_string())
    }
}

/// Reads every set of the project folder `folder` into its `.dit/` (the folder becomes a repo if it is not one): each
/// set as it is now, then its `Backup/` copies before it in time order, with no commit and nothing sent. `progress`
/// hears `(sets read, sets)` before each set and once at the end; `cancel` is read between sets.
///
/// A set that cannot be recorded is in the result with its [`Doubt`] and the others go on. Everything recorded is
/// safe to record again, so a Check run twice (or a Check and then Start) does the work once.
pub fn check(
    recorder: &Recorder,
    folder: &Path,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u32, u32),
) -> Result<Checked, CheckError> {
    let path = folder
        .canonicalize()
        .map_err(|error| CheckError::Failed(format!("{}: {error}", folder.display())))?;
    let created_dit = !path.join(".dit").exists();
    let repo = recorder.repo(&path)?;
    let files = repo
        .daw()
        .find_sets(&path)
        .map_err(|error| CheckError::Failed(format!("{}: {error}", path.display())))?;
    let of = u32::try_from(files.len()).unwrap_or(u32::MAX);
    let mut sets = Vec::with_capacity(files.len());
    for (at, file) in files.into_iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err(CheckError::Cancelled);
        }
        progress(u32::try_from(at).unwrap_or(u32::MAX), of);
        sets.push(check_set(&repo, file)?);
    }
    progress(of, of);
    let recorded: Vec<&str> = sets
        .iter()
        .filter_map(|set| set.set_id.as_deref())
        .collect();
    let sizes = sizes_of(&repo, &recorded)?;
    let pushes_samples = repo
        .push_samples()?
        .is_some_and(|setting| setting.pushing());
    Ok(Checked {
        path,
        created_dit,
        sets,
        objects: sizes.objects,
        samples: sizes.samples,
        pushes_samples,
    })
}

fn check_set(repo: &Repo, file: PathBuf) -> Result<CheckedSet, CheckError> {
    let copies = repo
        .daw()
        .list_backups(&file)
        .map_err(|error| CheckError::Failed(format!("{}: {error}", file.display())))?;
    let fingerprints = std::iter::once(file.as_path())
        .chain(copies.iter().map(|copy| copy.path.as_path()))
        .filter_map(|path| file_fingerprint(path).ok())
        .collect();
    let outcome = match repo.record_history(&file) {
        Ok(outcome) => outcome,
        // Another process holds the repo: no set can be recorded until it lets go, so the whole Check stops.
        Err(error @ RepoError::Locked(_)) => return Err(error.into()),
        // The set is in doubt, not the folder: a file Live is writing right now reads whole in a moment.
        Err(error) => {
            return Ok(CheckedSet {
                file,
                set_id: None,
                saves: 0,
                copies: copies.len(),
                fingerprints,
                doubt: Some(Doubt::Unrecorded(error.to_string())),
            });
        }
    };
    let ids = repo.log(&outcome.set_id, &outcome.branch)?;
    let mut unreadable = false;
    for id in &ids {
        unreadable |= repo.read_save(id)?.unreadable;
    }
    Ok(CheckedSet {
        file,
        set_id: Some(outcome.set_id),
        saves: ids.len(),
        copies: copies.len(),
        fingerprints,
        doubt: unreadable.then_some(Doubt::Unreadable),
    })
}

/// What a push of the `main` branch of each of a folder's sets uploads, in two parts.
struct Sizes {
    /// The saves' own objects, once each across every set, and the Save object each set's head commit will be linked
    /// with. A commit's own object is not in the list: it does not exist until the commit is made, and takes a few
    /// hundred bytes.
    objects: Vec<(ObjectId, u64)>,
    /// The sample objects of each set's head save, the ones the push's sample phase sends when the hub repo takes
    /// samples.
    samples: Vec<(ObjectId, u64)>,
}

fn sizes_of(repo: &Repo, set_ids: &[&str]) -> Result<Sizes, RepoError> {
    let mut saves: Vec<Save> = Vec::new();
    let mut head_saves: Vec<Save> = Vec::with_capacity(set_ids.len());
    let mut heads = Vec::with_capacity(set_ids.len());
    for set_id in set_ids {
        let ids = repo.log(set_id, MAIN)?;
        for id in &ids {
            saves.push(repo.read_save(id)?);
        }
        if let Some(head) = ids.last() {
            heads.push(*head);
            head_saves.push(repo.read_save(head)?);
        }
    }
    let mut objects = object_sizes(repo.store(), &saves)?;
    for head in heads {
        objects.push((head, repo.store().frame_len(&head)?));
    }
    let samples = sample_object_sizes(repo.store(), &head_saves)?;
    Ok(Sizes { objects, samples })
}

/// The objects a push of the `main` branch of each of `set_ids` uploads, each with the bytes it takes on the wire:
/// the saves' own, and their samples when `samples` is set (the hub repo takes them).
pub fn objects_of(
    repo: &Repo,
    set_ids: &[&str],
    samples: bool,
) -> Result<Vec<(ObjectId, u64)>, RepoError> {
    let sizes = sizes_of(repo, set_ids)?;
    let mut objects = sizes.objects;
    if samples {
        objects.extend(sizes.samples);
    }
    Ok(objects)
}

/// Whether the instance pushes samples for every repo, which a repo not made yet then does too.
pub fn instance_pushes_samples(remote: &Remote) -> Result<bool, RemoteError> {
    Ok(crate::renders::upload::limits(remote)?.push_samples_everywhere)
}

/// Removes the `.dit/` of `folder`, which Check made and no push has touched: going back from Check, or closing the
/// window on it. The sets, `Backup/` and `Samples/` are never touched. A folder with no `.dit/` is not an error.
pub fn discard(folder: &Path) -> io::Result<()> {
    match fs::remove_dir_all(folder.join(".dit")) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

/// What the hub would add to storage for some objects.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Storage {
    /// The bytes of the objects no repo of the caller's projects holds, counted once each.
    pub bytes: u64,
    /// How many objects add nothing because a repo holds them.
    pub held: u64,
    /// The room the project and the caller have left; `None` when neither has a cap.
    pub remaining: Option<u64>,
}

/// Asks the hub what `objects` would add to the storage of the project `project_id`, as many requests as it takes.
/// An object listed twice counts once. Nothing is linked or stored on the hub.
pub fn storage(
    remote: &Remote,
    project_id: i64,
    objects: &[(ObjectId, u64)],
) -> Result<Storage, RemoteError> {
    #[derive(Serialize)]
    struct Item {
        hash: ObjectId,
        size: u64,
    }
    #[derive(Serialize)]
    struct Body<'a> {
        objects: &'a [Item],
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Answer {
        bytes: u64,
        held: u64,
        remaining_bytes: Option<u64>,
    }
    let mut seen = HashSet::with_capacity(objects.len());
    let distinct: Vec<Item> = objects
        .iter()
        .filter(|(id, _)| seen.insert(*id))
        .map(|(hash, size)| Item {
            hash: *hash,
            size: *size,
        })
        .collect();
    let mut total = Storage {
        bytes: 0,
        held: 0,
        remaining: None,
    };
    let path = format!("/projects/{project_id}/repos/storage-check");
    // An empty list still asks once, for the room left.
    let chunks: Vec<&[Item]> = if distinct.is_empty() {
        vec![&[]]
    } else {
        distinct.chunks(STORAGE_CHUNK).collect()
    };
    for objects in chunks {
        let answer: Answer = remote.post(&path, &Body { objects })?;
        total.bytes += answer.bytes;
        total.held += answer.held;
        total.remaining = answer.remaining_bytes;
    }
    Ok(total)
}

/// What a folder's brought-in sets add up to: the saves on their `main` branches, the time of the oldest, and the
/// `bytes` sent for them.
pub fn totals(repo: &Repo, set_ids: &[&str], bytes: u64) -> Result<Totals, RepoError> {
    let mut totals = Totals {
        bytes,
        sets: u32::try_from(set_ids.len()).unwrap_or(u32::MAX),
        ..Totals::default()
    };
    for set_id in set_ids {
        let ids = repo.log(set_id, MAIN)?;
        totals.saves += ids.len() as u64;
        for id in &ids {
            let at = repo.read_save(id)?.file_updated_at;
            totals.first_save = Some(totals.first_save.map_or(at, |first| first.min(at)));
        }
    }
    Ok(totals)
}

/// What stopped a step that talks to the hub, sorted by what the run does about it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Trouble {
    /// The hub cannot be reached or is busy: wait and try again.
    Retry,
    /// The hub, or the folder, refused for a reason waiting will not mend, in words the producer reads.
    Refused(String),
    /// The hub no longer accepts the sign-in: nothing more goes until the producer signs in again.
    SignedOut(String),
    /// The step was stopped by the run's own observer: the run is pausing.
    Stopped,
}

/// Sorts a failed step by what to do about it. The hub being away, busy or rate-limiting is waited out; a refusal the
/// hub means (the storage cap, a repo the account cannot write to) fails the folder in the hub's words.
pub fn trouble(error: PushError, host: &str) -> Trouble {
    let refused = |message: &str| {
        Trouble::Refused(format!(
            "{host} refused the push: {}.",
            message.trim_end_matches('.')
        ))
    };
    match error {
        PushError::Stopped => Trouble::Stopped,
        PushError::Unreachable { .. } | PushError::TimedOut { .. } => Trouble::Retry,
        PushError::Remote(RemoteError::SignedOut { host }) => Trouble::SignedOut(host),
        PushError::Remote(RemoteError::Unexpected { .. }) => Trouble::Retry,
        PushError::Remote(RemoteError::Refused {
            status, message, ..
        }) => {
            if status == 408 || status == 429 || status >= 500 {
                Trouble::Retry
            } else {
                refused(&message)
            }
        }
        PushError::StorageLimit { message, .. } => refused(&message),
        other => Trouble::Refused(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn refused(status: u16, message: &str) -> PushError {
        PushError::Remote(RemoteError::Refused {
            host: "hub".into(),
            status,
            code: None,
            details: None,
            message: message.into(),
        })
    }

    #[test]
    fn a_hub_that_is_away_or_busy_is_waited_for() {
        for error in [
            PushError::Unreachable { host: "hub".into() },
            PushError::TimedOut { host: "hub".into() },
            refused(503, "down"),
            refused(429, "slow down"),
            refused(408, "late"),
        ] {
            assert_eq!(trouble(error, "hub"), Trouble::Retry);
        }
    }

    #[test]
    fn a_refusal_the_hub_means_fails_the_folder_in_its_words() {
        assert_eq!(
            trouble(
                refused(413, "Storage is full: 5 GB of 5 GB."),
                "hub.example"
            ),
            Trouble::Refused("hub.example refused the push: Storage is full: 5 GB of 5 GB.".into())
        );
        assert_eq!(
            trouble(refused(403, "You can't write here"), "hub.example"),
            Trouble::Refused("hub.example refused the push: You can't write here.".into())
        );
    }

    #[test]
    fn a_sign_in_the_hub_refuses_and_a_stopped_push_are_their_own_troubles() {
        assert_eq!(
            trouble(
                PushError::Remote(RemoteError::SignedOut { host: "hub".into() }),
                "x"
            ),
            Trouble::SignedOut("hub".into())
        );
        assert_eq!(trouble(PushError::Stopped, "hub"), Trouble::Stopped);
    }
}
