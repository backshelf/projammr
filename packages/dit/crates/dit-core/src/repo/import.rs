//! Importing the DAW's own dated copies of a set as earlier saves, and bringing a whole set into dit in one call.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use super::save::{FileState, Save, epoch_millis};
use super::{CommitKind, Repo, RepoError, io_error};
use crate::store::ObjectId;

/// What one `Repo::import_backups` did.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ImportReport {
    /// The saves recorded, in time order.
    pub imported: Vec<ObjectId>,
    /// The backups left out, each with why: already saved, or the error text
    /// of a copy that could not be read.
    pub skipped: Vec<(PathBuf, String)>,
}

/// What `Repo::record_history` and `Repo::backfill_set` did to the branch a set file is the working file of.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SetOutcome {
    /// The set's id in the repo.
    pub set_id: String,
    /// The branch the set file is the working file of: `main` for a set's own file.
    pub branch: String,
    /// The save recorded from the set file as it is now, `None` when the branch's latest save already held it.
    pub current: Option<ObjectId>,
    /// The `Backup/` copies recorded before it.
    pub imported: ImportReport,
    /// The commit made, `None` when the branch already had a head commit (or the caller did not ask for one).
    pub commit: Option<ObjectId>,
}

/// The message of the one commit a set brought into dit gets.
pub const BROUGHT_IN: &str = "Brought into dit";

/// The reason given for a backup whose document is already a save of the
/// branch.
const ALREADY_SAVED: &str = "already saved";

impl Repo {
    /// Records the DAW's backups of a branch's working file as saves of that
    /// branch, oldest first, and returns what happened to each.
    ///
    /// A backup's time is its `saved_at`, moved a millisecond later while
    /// another save of the branch (or an earlier backup of this import) has
    /// it, so no two saves of a branch share a time (the hub refuses a second
    /// save at an occupied millisecond). Each new save id joins the branch's
    /// log immediately before the first entry whose save is later, but always
    /// before the log's last entry, which is the working file's
    /// newest state whatever the backups' mtimes say (a copied project can give
    /// them later ones). So "latest save" keeps meaning the working file and
    /// the live saves recorded afterwards still append. With an empty log the
    /// backups go in time order. A save's
    /// `view_only` is judged against the save before it in the log once it is
    /// placed; saves already recorded are never rewritten.
    ///
    /// A backup whose XML hash is already a save of the branch (or whose bytes
    /// already are, for one no document could be read from) is skipped and
    /// reported. A copy that cannot be decoded or split is stored whole, like
    /// any unreadable save, and a copy that cannot be read from the disk is
    /// skipped and reported. Every backup's objects go in one store batch,
    /// made durable before the log is written. A failure of the store or of
    /// the log is an error and leaves the log as it was.
    pub fn import_backups(&self, set_id: &str, branch: &str) -> Result<ImportReport, RepoError> {
        let _lock = self.lock()?;
        let log = self.log(set_id, branch)?;
        let rel = self
            .branch_file(set_id, branch)?
            .ok_or_else(|| RepoError::NotASet(PathBuf::from(format!("{set_id}/{branch}"))))?;
        let backups = self
            .daw
            .list_backups(&self.root.join(rel))
            .map_err(io_error)?;

        let mut entries = log
            .into_iter()
            .map(|id| self.read_save(&id).map(|save| (id, save)))
            .collect::<Result<Vec<_>, _>>()?;
        let mut known: HashSet<String> = entries
            .iter()
            .filter_map(|(_, save)| save.xml_hash.clone())
            .collect();
        let mut known_raw: HashSet<ObjectId> =
            entries.iter().filter_map(|(_, save)| save.raw).collect();
        let mut taken: HashSet<i64> = entries
            .iter()
            .map(|(_, save)| save.file_updated_at)
            .collect();
        let newest = entries.pop();

        let mut report = ImportReport::default();
        let mut batch = self.store.batch();
        let mut cache = self.load_sample_cache();
        for backup in backups {
            let skip = |why: String| (backup.path.clone(), why);
            let bytes = match fs::read(&backup.path) {
                Ok(bytes) => bytes,
                Err(error) => {
                    report.skipped.push(skip(error.to_string()));
                    continue;
                }
            };
            let document = match self.daw.decode(&bytes) {
                Ok(xml) => {
                    let xml_hash = hex::encode(Sha256::digest(&xml));
                    if !known.insert(xml_hash.clone()) {
                        report.skipped.push(skip(ALREADY_SAVED.to_string()));
                        continue;
                    }
                    Some((xml, xml_hash))
                }
                Err(_) => None,
            };

            // A copy that shares a time with a save is a millisecond after it, and goes after it in the log.
            let mut saved_at = epoch_millis(backup.saved_at);
            while taken.contains(&saved_at) {
                saved_at += 1;
            }
            let at = entries
                .iter()
                .position(|(_, save)| save.file_updated_at > saved_at)
                .unwrap_or(entries.len());
            let previous: Option<&Save> = at.checked_sub(1).map(|before| &entries[before].1);
            let mut stored = None;
            if let Some((xml, xml_hash)) = document {
                let state = FileState {
                    xml: &xml,
                    xml_hash,
                    file_updated_at: saved_at,
                };
                match self.store_save(&mut batch, &mut cache, set_id, branch, state, previous) {
                    Ok(save) => stored = Some(save),
                    // Whole, but not a document the DAW module can split: kept as it is.
                    Err(RepoError::Daw(_)) => {}
                    Err(error) => return Err(error),
                }
            }
            let (id, save) = match stored {
                Some(stored) => stored,
                None => {
                    let raw = batch.put_leaf(&bytes)?;
                    if !known_raw.insert(raw) {
                        report.skipped.push(skip(ALREADY_SAVED.to_string()));
                        continue;
                    }
                    self.store_raw(&mut batch, set_id, branch, raw, saved_at)?
                }
            };
            taken.insert(saved_at);
            entries.insert(at, (id, save));
            report.imported.push(id);
        }

        batch.finish()?;
        self.save_sample_cache(&cache)?;
        if !report.imported.is_empty() {
            entries.extend(newest);
            let log: Vec<ObjectId> = entries.iter().map(|(id, _)| *id).collect();
            self.write_log(set_id, branch, &log)?;
        }
        Ok(report)
    }

    /// Records one set of the project, with its `Backup/` copies, as the first saves of its `main` branch: the set
    /// file as it is now ([`Repo::record_save`]), then the copies before it in time order
    /// ([`Repo::import_backups`]). Both steps skip what is already saved, so a call on a set recorded before, or
    /// half-recorded by a call that was cut short, records only what is missing.
    ///
    /// A set file that is not whole (it does not decode as a document, or changed while it was read) is
    /// `record_save`'s error and nothing of the set is recorded.
    pub fn record_history(&self, set_path: &Path) -> Result<SetOutcome, RepoError> {
        let current = self.record_save(set_path)?;
        let (_, rel) = self.locate_set(set_path)?;
        let (set_id, branch) = self
            .read_sets()?
            .resolve(&rel)
            .ok_or_else(|| RepoError::NotASet(set_path.to_path_buf()))?;
        let imported = self.import_backups(&set_id, &branch)?;
        Ok(SetOutcome {
            set_id,
            branch,
            current,
            imported,
            commit: None,
        })
    }

    /// [`Repo::record_history`], then the one commit that brings the set into dit: [`BROUGHT_IN`] at the branch's
    /// newest state, made only when the branch has no head commit. A set that has a commit (this call's earlier
    /// run, or the producer's own) gets none, whatever saves it has since.
    pub fn backfill_set(&self, set_path: &Path, author: &str) -> Result<SetOutcome, RepoError> {
        let mut outcome = self.record_history(set_path)?;
        if self.read_ref(&outcome.set_id, &outcome.branch)?.is_none() {
            outcome.commit = Some(self.commit(
                &outcome.set_id,
                &outcome.branch,
                BROUGHT_IN,
                author,
                CommitKind::User,
            )?);
        }
        Ok(outcome)
    }
}
