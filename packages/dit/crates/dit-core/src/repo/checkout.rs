//! Writing a commit out as a new branch file.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use super::refs::{MAIN_BRANCH, check_branch_name, write_sets};
use super::{Repo, RepoError, Save, io_error};
use crate::store::ObjectId;

/// `<main file stem> @<branch>.<main file extension>` beside the main file
/// named `main_rel`, relative to the project folder with `/` separators.
fn branch_file_name(main_rel: &str, branch: &str) -> String {
    let (dir, file) = main_rel.rsplit_once('/').unwrap_or(("", main_rel));
    let file = Path::new(file);
    let stem = file
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or_default();
    let name = match file.extension().and_then(|ext| ext.to_str()) {
        Some(ext) => format!("{stem} @{branch}.{ext}"),
        None => format!("{stem} @{branch}"),
    };
    if dir.is_empty() {
        name
    } else {
        format!("{dir}/{name}")
    }
}

impl Repo {
    /// The bytes of the set file as it was when `save` was recorded: the file's own bytes for a save that holds
    /// it whole, else the document encoded again.
    pub fn materialise(&self, save: &Save) -> Result<Vec<u8>, RepoError> {
        match &save.raw {
            Some(raw) => Ok(self.store.read_leaf(raw)?),
            None => Ok(self.daw.encode(&self.materialise_xml(save)?)?),
        }
    }

    /// `wanted` when it can be a new branch of the set `set_id` (no branch of that name, and no file in the way),
    /// else the first of `wanted-2`, `wanted-3`, ... that can.
    pub fn free_branch_name(&self, set_id: &str, wanted: &str) -> Result<String, RepoError> {
        check_branch_name(wanted)?;
        let sets = self.read_sets()?;
        let main_rel = sets
            .sets
            .get(set_id)
            .ok_or_else(|| RepoError::NotASet(PathBuf::from(set_id)))?;
        let taken: Vec<String> = sets
            .branches
            .get(set_id)
            .into_iter()
            .flat_map(|branches| branches.keys().map(|name| name.to_lowercase()))
            .collect();
        let free = |name: &str| {
            let folded = name.to_lowercase();
            folded != MAIN_BRANCH
                && !taken.contains(&folded)
                && !self.root.join(branch_file_name(main_rel, name)).exists()
        };
        // `fix-2` is asked for again: the next is `fix-3`, not `fix-2-2`.
        let stem = match wanted.rsplit_once('-') {
            Some((stem, count))
                if !count.is_empty() && count.bytes().all(|b| b.is_ascii_digit()) =>
            {
                stem
            }
            _ => wanted,
        };
        std::iter::once(wanted.to_string())
            .chain((2..).map(|n| format!("{stem}-{n}")))
            .find(|name| free(name))
            .ok_or_else(|| RepoError::BadBranchName(wanted.to_string()))
    }

    /// Writes a commit's save as the working file of a new branch `name`,
    /// beside the set's main file, and points the branch at the commit. The
    /// file is created exclusively, so nothing Live wrote is ever overwritten.
    /// No save is recorded: the next `record_save` of the new file does.
    pub fn checkout_new_branch(
        &self,
        commit_id: &ObjectId,
        name: &str,
    ) -> Result<PathBuf, RepoError> {
        let _lock = self.lock()?;
        check_branch_name(name)?;
        // Refs and logs are files named after the branch, and macOS and
        // Windows compare file names without case: `Main` would be `main`.
        let folded = name.to_lowercase();
        if folded == MAIN_BRANCH {
            return Err(RepoError::BadBranchName(name.to_string()));
        }
        let commit = self.read_commit(commit_id)?;
        let mut sets = self.read_sets()?;
        let main_rel = sets
            .sets
            .get(&commit.set_id)
            .ok_or_else(|| RepoError::NotASet(PathBuf::from(&commit.set_id)))?;
        let branches = sets.branches.entry(commit.set_id.clone()).or_default();
        if let Some(existing) = branches.keys().find(|key| key.to_lowercase() == folded) {
            return Err(RepoError::BranchExists(existing.clone()));
        }

        let rel = branch_file_name(main_rel, name);
        let path = self.root.join(&rel);
        let bytes = self.materialise(&self.read_save(&commit.save)?)?;
        write_new_file(&path, &bytes)?;

        // The ref first: a ref with no `[branches]` entry is never read, so a
        // failure after it leaves nothing that blocks a retry.
        branches.insert(name.to_string(), rel);
        let recorded = self
            .write_ref_unlocked(&commit.set_id, name, commit_id)
            .and_then(|()| write_sets(&self.dit_dir(), &sets));
        if let Err(error) = recorded {
            let _ = fs::remove_file(&path);
            return Err(error);
        }
        Ok(path)
    }
}

/// Writes `bytes` to a file that must not exist yet. A half-written file is
/// removed again.
fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), RepoError> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| match error.kind() {
            io::ErrorKind::AlreadyExists => RepoError::BranchFileExists(path.to_path_buf()),
            _ => io_error(error),
        })?;
    let written = file.write_all(bytes).and_then(|()| file.sync_all());
    if let Err(error) = written {
        let _ = fs::remove_file(path);
        return Err(io_error(error));
    }
    Ok(())
}
