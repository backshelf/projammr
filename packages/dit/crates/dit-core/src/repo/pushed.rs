//! What a push has recorded for each set: `.dit/refs/remote/<set id>.json`. A set with no file has not been adopted
//! by the hub repo yet.

use std::collections::BTreeMap;
use std::{fs, io};

use serde::{Deserialize, Serialize};

use super::layout::{PUSHED_DIR, RemoteBinding};
use super::refs::{atomic_write, check_set_id, read_optional};
use super::save::json_error;
use super::{Repo, RepoError, io_error};
use crate::store::ObjectId;

/// One set's state on the hub, as far as this repo's pushes have heard it confirmed.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushedSet {
    /// The instance's origin the set was adopted on, as `Instance::url` gives it. Empty in a file written without one.
    #[serde(default)]
    pub instance: String,
    /// The hub repo the set was adopted into. Zero in a file written without one.
    #[serde(default)]
    pub repo_id: i64,
    /// The hub session that adopted the set.
    pub session_id: i64,
    #[serde(default)]
    pub branches: BTreeMap<String, PushedBranch>,
}

/// One branch's state on the hub.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushedBranch {
    /// The newest commit the hub has recorded on the branch.
    pub commit: Option<ObjectId>,
    /// The saves the hub has recorded, by id: a branch's log can gain older saves (`import_backups`), so a position
    /// in it does not say what was pushed.
    #[serde(default)]
    pub saves: Vec<ObjectId>,
    /// The newest commit whose sample objects the hub holds, the second phase of a push: every commit of the branch
    /// up to and including it has had its samples sent. `None` until a push with samples on has sent any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub samples: Option<ObjectId>,
    /// The newest commit whose own Save and Commit objects the hub holds and has linked to the commit: every commit
    /// of the branch up to and including it has had its lineage sent. `None` until a push has sent any, so a repo
    /// pushed before lineage existed sends its whole history's on its next push.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lineage: Option<ObjectId>,
    /// The latest end, in milliseconds, of the time spans the hub has recorded for this machine. Spans that end
    /// after it are sent again, which extends the one still open.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segments_through: Option<i64>,
}

impl Repo {
    /// What pushes have recorded for a set; `None` until the hub repo has adopted it.
    pub fn pushed(&self, set_id: &str) -> Result<Option<PushedSet>, RepoError> {
        let Some(text) = read_optional(&self.pushed_path(set_id)?)? else {
            return Ok(None);
        };
        Ok(Some(serde_json::from_str(&text).map_err(json_error)?))
    }

    /// What pushes to `binding`'s hub repo have recorded for a set. A file written for another hub repo or instance,
    /// or without either, is absent: the set has not been adopted by this one.
    pub fn pushed_to(
        &self,
        set_id: &str,
        binding: &RemoteBinding,
    ) -> Result<Option<PushedSet>, RepoError> {
        Ok(self
            .pushed(set_id)?
            .filter(|pushed| pushed.repo_id == binding.repo && pushed.instance == binding.instance))
    }

    /// Replaces what pushes have recorded for a set.
    pub fn write_pushed(&self, set_id: &str, pushed: &PushedSet) -> Result<(), RepoError> {
        let _lock = self.lock()?;
        self.write_pushed_unlocked(set_id, pushed)
    }

    fn write_pushed_unlocked(&self, set_id: &str, pushed: &PushedSet) -> Result<(), RepoError> {
        let text = serde_json::to_vec_pretty(pushed).map_err(json_error)?;
        atomic_write(&self.pushed_path(set_id)?, &text)
    }

    /// Every set with a record of pushes to `binding`'s hub repo, by set id. A file written for another hub repo or
    /// instance is not among them.
    pub fn pushed_sets_to(
        &self,
        binding: &RemoteBinding,
    ) -> Result<Vec<(String, PushedSet)>, RepoError> {
        let entries = match fs::read_dir(self.dit_dir().join(PUSHED_DIR)) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(io_error(error)),
        };
        let mut sets = Vec::new();
        for entry in entries {
            let name = entry.map_err(io_error)?.file_name();
            let Some(set_id) = name
                .to_str()
                .and_then(|name| name.strip_suffix(".json"))
                .filter(|id| check_set_id(id).is_ok())
            else {
                continue;
            };
            if let Some(pushed) = self.pushed_to(set_id, binding)? {
                sets.push((set_id.to_string(), pushed));
            }
        }
        Ok(sets)
    }

    /// Gives every set file recorded for `from` (its hub repo, at its instance) the instance origin `instance`, each
    /// written atomically, and returns how many it rewrote. A file for another hub repo or instance, one already
    /// carrying `instance` among them, is left as it is. The directory is synced once the files are written, so a
    /// caller that writes something after this returns never has that outlive a file here. The caller holds the lock.
    pub(super) fn repoint_pushed_unlocked(
        &self,
        from: &RemoteBinding,
        instance: &str,
    ) -> Result<usize, RepoError> {
        let sets = self.pushed_sets_to(from)?;
        for (set_id, pushed) in &sets {
            let moved = PushedSet {
                instance: instance.to_string(),
                ..pushed.clone()
            };
            self.write_pushed_unlocked(set_id, &moved)?;
        }
        if !sets.is_empty() {
            crate::atomic::sync_dir(&self.dit_dir().join(PUSHED_DIR)).map_err(io_error)?;
        }
        Ok(sets.len())
    }

    fn pushed_path(&self, set_id: &str) -> Result<std::path::PathBuf, RepoError> {
        check_set_id(set_id)?;
        Ok(self
            .dit_dir()
            .join(PUSHED_DIR)
            .join(format!("{set_id}.json")))
    }
}
