//! Commits: a save the producer named, kept linear on each branch.

use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use super::save::{epoch_millis, json_error};
use super::{Repo, RepoError, Save};
use crate::store::{ObjectId, ObjectKind, ObjectRead, StoreError};

/// Who made a commit: the producer, or dit on its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommitKind {
    User,
    Checkpoint,
}

/// A save with a message and an author, on one branch of a set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub set_id: String,
    pub branch: String,
    pub save: ObjectId,
    /// The branch head this commit was made on top of; `None` for the first
    /// commit of a lineage.
    pub parent: Option<ObjectId>,
    pub message: String,
    pub author: String,
    pub kind: CommitKind,
    /// Milliseconds since the Unix epoch.
    pub at: i64,
}

/// A commit with the saves it gathers, as `history` lists them.
#[derive(Debug, Clone, PartialEq)]
pub struct HistoryEntry {
    pub id: ObjectId,
    pub commit: Commit,
    /// The saves recorded since the parent commit's save, up to the commit's
    /// own, in log order, each with its id.
    pub saves: Vec<(ObjectId, Save)>,
}

impl Repo {
    /// Names the latest save of a branch, moves the branch to the new commit
    /// and returns its id. Refused with `NothingToCommit` when the branch head
    /// already names a save in the same state (the same tree and the same
    /// sample bytes); a branch without a head takes its first commit whatever
    /// the save is.
    pub fn commit(
        &self,
        set_id: &str,
        branch: &str,
        message: &str,
        author: &str,
        kind: CommitKind,
    ) -> Result<ObjectId, RepoError> {
        let _lock = self.lock()?;
        let latest_id = self
            .log(set_id, branch)?
            .pop()
            .ok_or_else(|| RepoError::NoSaves(format!("{set_id} on {branch}")))?;
        let latest = self.read_save(&latest_id)?;

        let head = self.read_ref(set_id, branch)?;
        if let Some(head_id) = &head {
            let head_commit = self.read_commit(head_id)?;
            if self.read_save(&head_commit.save)?.same_state(&latest) {
                return Err(RepoError::NothingToCommit {
                    since: head_commit.message,
                });
            }
        }

        let commit = Commit {
            set_id: set_id.to_string(),
            branch: branch.to_string(),
            save: latest_id,
            parent: head,
            message: message.to_string(),
            author: author.to_string(),
            kind,
            at: epoch_millis(SystemTime::now()),
        };
        let id = self.store.put(
            ObjectKind::Commit,
            &serde_json::to_vec(&commit).map_err(json_error)?,
        )?;
        self.write_ref_unlocked(set_id, branch, &id)?;
        Ok(id)
    }

    /// How many saves of a branch were recorded after the one its head commit names: all of them with no head, or
    /// when the head's save is in another branch's log.
    pub fn saves_since_commit(&self, set_id: &str, branch: &str) -> Result<usize, RepoError> {
        let log = self.log(set_id, branch)?;
        let Some(head) = self.read_ref(set_id, branch)? else {
            return Ok(log.len());
        };
        let head_save = self.read_commit(&head)?.save;
        Ok(log
            .iter()
            .position(|id| *id == head_save)
            .map_or(log.len(), |at| log.len() - at - 1))
    }

    /// Whether a commit would be accepted now: the branch's latest save is in a different state from the head
    /// commit's save, or there is a save and no head. `false` with no save.
    pub fn working_changed(&self, set_id: &str, branch: &str) -> Result<bool, RepoError> {
        let Some(latest) = self.log(set_id, branch)?.pop() else {
            return Ok(false);
        };
        let Some(head) = self.read_ref(set_id, branch)? else {
            return Ok(true);
        };
        let head_save = self.read_commit(&head)?.save;
        Ok(!self
            .read_save(&latest)?
            .same_state(&self.read_save(&head_save)?))
    }

    /// Reads a stored Commit object.
    pub fn read_commit(&self, id: &ObjectId) -> Result<Commit, RepoError> {
        match self.store.get(id)? {
            (ObjectKind::Commit, body) => Ok(serde_json::from_slice(&body).map_err(json_error)?),
            (other, _) => Err(StoreError::Malformed(format!(
                "object {id} is a {other:?}, not a Commit"
            ))
            .into()),
        }
    }

    /// The commits reachable from a branch head, newest first, each with the
    /// saves of its own branch's log after its parent's save up to its own. A
    /// walk from a branch crosses into the commits it was checked out from.
    /// A commit whose save is in no log here (one restored from the hub) has that save alone.
    pub fn history(&self, set_id: &str, branch: &str) -> Result<Vec<HistoryEntry>, RepoError> {
        let mut entries = Vec::new();
        let mut current = self
            .read_ref(set_id, branch)?
            .map(|id| self.read_commit(&id).map(|commit| (id, commit)))
            .transpose()?;
        while let Some((id, commit)) = current {
            let parent = commit
                .parent
                .map(|id| self.read_commit(&id).map(|commit| (id, commit)))
                .transpose()?;
            let log = self.log(&commit.set_id, &commit.branch)?;
            let saves = match log.iter().position(|save| *save == commit.save) {
                Some(end) => {
                    let start = parent
                        .as_ref()
                        .and_then(|(_, parent)| log.iter().position(|save| *save == parent.save))
                        .map_or(0, |at| (at + 1).min(end + 1));
                    log[start..=end]
                        .iter()
                        .map(|save| self.read_save(save).map(|read| (*save, read)))
                        .collect::<Result<Vec<_>, _>>()?
                }
                // A commit that came from the hub (`restore`): its save was never in a log here, so it stands on
                // its own save.
                None => vec![(commit.save, self.read_save(&commit.save)?)],
            };
            entries.push(HistoryEntry { id, commit, saves });
            current = parent;
        }
        Ok(entries)
    }
}
