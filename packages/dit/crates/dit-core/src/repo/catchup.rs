//! Finding what changed while nothing was watching: which set files a save is owed for, without decoding the ones
//! that are as they were, and which set was saved last.

use std::fs;
use std::path::{Path, PathBuf};

use super::save::epoch_millis;
use super::{Repo, RepoError, io_error};
use crate::store::ObjectId;

/// A set file `catch_up` tried to record, and what recording it came to: the new save's id, `None` for a file
/// that turned out to be as recorded, or why it could not be recorded.
pub type CaughtUp = (PathBuf, Result<Option<ObjectId>, RepoError>);
impl Repo {
    /// Whether recording `set_path` might give a save, judged from the file's time and its samples' sizes and times
    /// alone, so a repo of unchanged sets costs a few `stat`s and no decoding. True for a set with no save yet, a
    /// latest save that holds an unreadable file or could not be parsed (a newer release may read it), a file whose
    /// time is not the latest save's, and a sample whose size or time is not what was last read.
    ///
    /// A save recorded for a sample alone has a time later than the file's, so its set reads as stale until the
    /// file next changes; recording it again returns `None` and costs one decode.
    pub fn stale(&self, set_path: &Path) -> Result<bool, RepoError> {
        let (file, rel) = self.locate_set(set_path)?;
        let modified = fs::metadata(&file)
            .and_then(|meta| meta.modified())
            .map_err(io_error)?;
        let Some((set_id, branch)) = self.read_sets()?.resolve(&rel) else {
            return Ok(true);
        };
        let Some(latest) = self.log(&set_id, &branch)?.pop() else {
            return Ok(true);
        };
        let latest = self.read_save(&latest)?;
        if latest.unreadable || epoch_millis(modified) != latest.file_updated_at {
            return Ok(true);
        }
        Ok(self.samples_drifted(&self.load_sample_cache(), &latest.samples))
    }

    /// Records the sets of the project that are stale, as a launch does for the saves made while nothing was
    /// watching: each stale file `find_sets` lists, with what recording it came to. The states between several saves
    /// made meanwhile are not recovered, only the last. A file that is not stale is not listed.
    pub fn catch_up(&self) -> Result<Vec<CaughtUp>, RepoError> {
        let mut caught = Vec::new();
        for path in self.daw.find_sets(&self.root).map_err(io_error)? {
            let recorded = match self.stale(&path) {
                Ok(false) => continue,
                Ok(true) => self.record_save(&path),
                Err(error) => Err(error),
            };
            caught.push((path, recorded));
        }
        Ok(caught)
    }

    /// The set and branch a set file is the working file of, when the repo knows it: `None` for a file it has not
    /// registered yet, or one outside the project.
    pub fn working_file(&self, set_path: &Path) -> Result<Option<(String, String)>, RepoError> {
        let (_, rel) = self.locate_set(set_path)?;
        Ok(self.read_sets()?.resolve(&rel))
    }

    /// The working file saved last, by the files' times: its set, its branch and the time of its latest save. `None`
    /// when no file has a save. Reads each log's last entry, not every save.
    pub fn newest_save_at(&self) -> Result<Option<(String, String, i64)>, RepoError> {
        let mut newest: Option<(String, String, i64)> = None;
        for set_id in self.sets()?.into_keys() {
            let branches =
                std::iter::once("main".to_string()).chain(self.branch_files(&set_id)?.into_keys());
            for branch in branches {
                let Some(latest) = self.log(&set_id, &branch)?.pop() else {
                    continue;
                };
                let at = self.read_save(&latest)?.file_updated_at;
                if newest
                    .as_ref()
                    .is_none_or(|(_, _, newest_at)| at > *newest_at)
                {
                    newest = Some((set_id.clone(), branch, at));
                }
            }
        }
        Ok(newest)
    }
}
