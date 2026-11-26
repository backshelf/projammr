//! The small mutable files of a repo: `sets.toml`, the per-set save logs and
//! the branch refs. Every write is a temp file renamed into place, so a reader
//! never sees half of one.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::layout::{LOGS_DIR, REFS_DIR};
use super::{Repo, RepoError, io_error};
use crate::store::ObjectId;

pub(super) const SETS_FILE: &str = "sets.toml";

/// The branch every set starts on; its working file is the set's own.
pub(crate) const MAIN_BRANCH: &str = "main";

/// The longest branch name, in characters.
const BRANCH_NAME_MAX: usize = 64;

/// Device names Windows reserves, whatever the extension or case. The
/// superscript digits count as port numbers too.
const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "COM¹", "COM²", "COM³", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8",
    "LPT9", "LPT¹", "LPT²", "LPT³",
];

/// `sets.toml`: the main file of each set, and the working files of its other
/// branches.
#[derive(Default, Serialize, Deserialize)]
pub(super) struct SetsFile {
    #[serde(default)]
    pub sets: BTreeMap<String, String>,
    /// Set id to branch name to file; `main` never appears here.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub branches: BTreeMap<String, BTreeMap<String, String>>,
}

impl SetsFile {
    /// The set and branch whose working file is `rel`, if any.
    pub fn resolve(&self, rel: &str) -> Option<(String, String)> {
        let main = self
            .sets
            .iter()
            .find_map(|(id, path)| (path == rel).then(|| (id.clone(), MAIN_BRANCH.to_string())));
        main.or_else(|| {
            self.branches.iter().find_map(|(id, files)| {
                files
                    .iter()
                    .find_map(|(name, path)| (path == rel).then(|| (id.clone(), name.clone())))
            })
        })
    }
}

/// Refuses a branch name that could not be a path component or a file name
/// suffix: 1 to 64 characters that are letters, digits, space, `-`, `_` or `.`,
/// not starting or ending with `.` or space, and not a Windows device name
/// (`CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`, and `COM`/`LPT`
/// with a superscript `¹`, `²` or `³`) in any case, with
/// or without an extension (`con.take`). `main` passes.
pub(super) fn check_branch_name(name: &str) -> Result<(), RepoError> {
    let edge = |c: char| c == '.' || c == ' ';
    let allowed = |c: char| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.');
    let fits = (1..=BRANCH_NAME_MAX).contains(&name.chars().count());
    let edges_ok = !name.starts_with(edge) && !name.ends_with(edge);
    let stem = name.split('.').next().unwrap_or_default().trim();
    let reserved = WINDOWS_RESERVED_NAMES
        .iter()
        .any(|device| stem.eq_ignore_ascii_case(device));
    if fits && edges_ok && !reserved && name.chars().all(allowed) {
        Ok(())
    } else {
        Err(RepoError::BadBranchName(name.to_string()))
    }
}

/// A set id is joined into paths, so it must be 1 to 64 ASCII letters and
/// digits (the ids `register_set` makes are 16 lowercase hex chars). This
/// keeps a hand-edited `sets.toml` or a caller's id from reaching outside
/// `.dit/`.
pub(super) fn check_set_id(id: &str) -> Result<(), RepoError> {
    if (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric()) {
        Ok(())
    } else {
        Err(RepoError::BadSetId(id.to_string()))
    }
}

/// Writes `bytes` to `path` through a temp file in the same directory.
pub(super) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), RepoError> {
    crate::atomic::write(path, bytes).map_err(io_error)
}

pub(super) fn read_optional(path: &Path) -> Result<Option<String>, RepoError> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io_error(error)),
    }
}

/// Writes `sets.toml` in the `.dit` directory `dit`.
pub(super) fn write_sets(dit: &Path, file: &SetsFile) -> Result<(), RepoError> {
    let text = toml::to_string(file).map_err(|e| RepoError::Io(format!("{SETS_FILE}: {e}")))?;
    atomic_write(&dit.join(SETS_FILE), text.as_bytes())
}

/// A candidate set id: 16 hex chars of SHA-256 over the set's relative file
/// name, the time in nanoseconds, the process id and a counter.
fn set_id_candidate(rel: &str, attempt: u32) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    let mut hasher = Sha256::new();
    hasher.update(rel.as_bytes());
    hasher.update(nanos.to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());
    if attempt > 0 {
        hasher.update(attempt.to_le_bytes());
    }
    hex::encode(&hasher.finalize()[..8])
}

impl Repo {
    /// Every set the repo knows: set id to file name, relative to the project
    /// folder with `/` separators.
    pub fn sets(&self) -> Result<BTreeMap<String, String>, RepoError> {
        Ok(self.read_sets()?.sets)
    }

    /// The working files of a set's branches other than `main`: branch name to
    /// file name, relative to the project folder with `/` separators.
    pub fn branch_files(&self, set_id: &str) -> Result<BTreeMap<String, String>, RepoError> {
        Ok(self
            .read_sets()?
            .branches
            .remove(set_id)
            .unwrap_or_default())
    }

    /// `sets.toml` as it is now, empty when the file is missing.
    pub(super) fn read_sets(&self) -> Result<SetsFile, RepoError> {
        let path = self.dit_dir().join(SETS_FILE);
        let Some(text) = read_optional(&path)? else {
            return Ok(SetsFile::default());
        };
        toml::from_str(&text).map_err(|e| RepoError::Io(format!("{SETS_FILE}: {e}")))
    }

    /// Gives the set at `rel` a fresh id and records it in `sets.toml`.
    pub(super) fn register_set(&self, file: &mut SetsFile, rel: &str) -> Result<String, RepoError> {
        let id = (0..)
            .map(|attempt| set_id_candidate(rel, attempt))
            .find(|id| !file.sets.contains_key(id))
            .expect("an unbounded range yields an unused id");
        file.sets.insert(id.clone(), rel.to_string());
        write_sets(&self.dit_dir(), file)?;
        Ok(id)
    }

    /// The path of a branch's save log.
    fn log_path(&self, set_id: &str, branch: &str) -> Result<PathBuf, RepoError> {
        check_set_id(set_id)?;
        check_branch_name(branch)?;
        Ok(self.dit_dir().join(LOGS_DIR).join(set_id).join(branch))
    }

    /// The save ids of a branch in recording order.
    pub fn log(&self, set_id: &str, branch: &str) -> Result<Vec<ObjectId>, RepoError> {
        let path = self.log_path(set_id, branch)?;
        let Some(text) = read_optional(&path)? else {
            return Ok(Vec::new());
        };
        text.lines()
            .filter(|line| !line.is_empty())
            .map(|line| line.parse().map_err(RepoError::Store))
            .collect()
    }

    /// Appends a save id to a branch's log: read it all, add the line, write it
    /// back.
    pub(super) fn append_log(
        &self,
        set_id: &str,
        branch: &str,
        save: &ObjectId,
    ) -> Result<(), RepoError> {
        let path = self.log_path(set_id, branch)?;
        let mut text = read_optional(&path)?.unwrap_or_default();
        text.push_str(&format!("{save}\n"));
        atomic_write(&path, text.as_bytes())
    }

    /// Replaces a branch's log with `saves`, in one temp-then-rename write.
    pub(super) fn write_log(
        &self,
        set_id: &str,
        branch: &str,
        saves: &[ObjectId],
    ) -> Result<(), RepoError> {
        let path = self.log_path(set_id, branch)?;
        let text: String = saves.iter().map(|save| format!("{save}\n")).collect();
        atomic_write(&path, text.as_bytes())
    }

    /// The working file of a branch, relative to the project folder with `/`
    /// separators, if `sets.toml` knows the branch.
    pub(super) fn branch_file(
        &self,
        set_id: &str,
        branch: &str,
    ) -> Result<Option<String>, RepoError> {
        let mut sets = self.read_sets()?;
        Ok(if branch == MAIN_BRANCH {
            sets.sets.remove(set_id)
        } else {
            sets.branches
                .remove(set_id)
                .and_then(|mut files| files.remove(branch))
        })
    }

    /// The commit a branch of a set points at, if the branch exists.
    pub fn read_ref(&self, set_id: &str, branch: &str) -> Result<Option<ObjectId>, RepoError> {
        check_set_id(set_id)?;
        check_branch_name(branch)?;
        let path = self.dit_dir().join(REFS_DIR).join(set_id).join(branch);
        let Some(text) = read_optional(&path)? else {
            return Ok(None);
        };
        Ok(Some(text.trim().parse()?))
    }

    /// Points a branch of a set at a commit.
    pub fn write_ref(
        &self,
        set_id: &str,
        branch: &str,
        commit: &ObjectId,
    ) -> Result<(), RepoError> {
        let _lock = self.lock()?;
        self.write_ref_unlocked(set_id, branch, commit)
    }

    /// `write_ref` for a caller that already holds the repo's lock.
    pub(super) fn write_ref_unlocked(
        &self,
        set_id: &str,
        branch: &str,
        commit: &ObjectId,
    ) -> Result<(), RepoError> {
        check_set_id(set_id)?;
        check_branch_name(branch)?;
        let path = self.dit_dir().join(REFS_DIR).join(set_id).join(branch);
        atomic_write(&path, format!("{commit}\n").as_bytes())
    }
}
