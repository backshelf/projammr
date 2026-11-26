//! The repository: a DAW project folder with `.dit/` inside it, the saves
//! recorded there each time a set's file changes, and the commits that name
//! them.
//!
//! ```text
//! .dit/
//!   config.toml        daw = "<DAW id>"
//!                      [remote] instance = "<origin>", repo = <hub repo id>   once a push has bound the repo
//!   sets.toml          [sets] <set id> = "<main file, relative to the project, `/` separated>"
//!                      [branches.<set id>] <branch> = "<branch file, likewise>"
//!   lock               the writer lock every mutating call holds
//!   objects/           the object store
//!   logs/<set id>/<branch>        save ids, one hex id per line, in recording order
//!   refs/sets/<set id>/<branch>   a commit id
//!   refs/remote/<set id>.json     what pushes have recorded for the set (`PushedSet`)
//!   time/<set id>/<branch>        the spans the set was open, a JSON object a line, sorted by start
//! ```

mod catchup;
mod checkout;
mod commit;
mod import;
mod layout;
mod lock;
mod pushed;
mod refs;
mod samples;
mod save;
mod time;

use std::path::PathBuf;
use std::time::Duration;

use thiserror::Error;

use crate::daw::{Daw, DawError};
use crate::store::{Store, StoreError};

pub use commit::{Commit, CommitKind, HistoryEntry};
pub use import::{BROUGHT_IN, ImportReport, SetOutcome};
pub use layout::{PushSamples, RemoteBinding};
pub use pushed::{PushedBranch, PushedSet};
pub(crate) use refs::MAIN_BRANCH;
pub use save::Save;
pub use time::{Segment, Source, format_span};

/// Why a repo could not be opened, read or written to. Holds strings and paths
/// only, like `StoreError` and `DawError`.
#[derive(Debug, Clone, PartialEq, Error)]
pub enum RepoError {
    #[error("repo i/o: {0}")]
    Io(String),
    #[error("{0} is not a project folder of this DAW")]
    NotAProject(PathBuf),
    #[error("no .dit repository at or above {0}")]
    NotARepo(PathBuf),
    #[error("the repo's DAW `{0}` is not registered")]
    UnknownDaw(String),
    #[error("{0} is not a set file inside this repo")]
    NotASet(PathBuf),
    #[error("no saves recorded for {0} yet")]
    NoSaves(String),
    #[error("Nothing to commit since '{since}'.")]
    NothingToCommit { since: String },
    #[error("This save holds the set file as it was written, with no document to read from it.")]
    NoDocument,
    #[error("a time segment cannot end ({end}) before it starts ({start})")]
    BadSegment { start: i64, end: i64 },
    #[error("`{0}` is not a usable branch name")]
    BadBranchName(String),
    #[error("`{0}` is not a set id")]
    BadSetId(String),
    #[error("a branch named `{0}` already exists")]
    BranchExists(String),
    #[error("{0} already exists")]
    BranchFileExists(PathBuf),
    #[error(
        "another dit command is writing to this repo ({}); wait for it to finish and try again",
        .0.display()
    )]
    Locked(PathBuf),
    #[error("the repo's [remote] changed while dit was moving it; run the command again")]
    RemoteChanged,
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Daw(#[from] DawError),
}

/// An open repo: its project folder, the DAW that reads its sets and its
/// object store.
pub struct Repo {
    /// The project folder, canonical.
    root: PathBuf,
    daw: &'static dyn Daw,
    store: Store,
    /// How long a writer waits for the repo's lock.
    lock_wait: Duration,
    /// Gives the machine name this repo's saves are recorded under, when one is recorded.
    machine: MachineName,
}

/// Looks up a machine name; asked once for each save recorded.
type MachineName = Box<dyn Fn() -> String + Send + Sync>;

impl Repo {
    /// Records this repo's saves under the name `machine` gives, asked when a save is recorded and never otherwise,
    /// in place of the name [`crate::machine::name`] gives with nothing configured.
    pub fn with_machine(mut self, machine: impl Fn() -> String + Send + Sync + 'static) -> Self {
        self.machine = Box::new(machine);
        self
    }

    fn default_machine() -> MachineName {
        Box::new(|| crate::machine::name(None))
    }

    /// The project folder.
    pub fn root(&self) -> &std::path::Path {
        &self.root
    }

    /// The DAW that reads this repo's sets.
    pub fn daw(&self) -> &'static dyn Daw {
        self.daw
    }

    /// The repo's object store.
    pub fn store(&self) -> &Store {
        &self.store
    }
}

fn io_error(error: std::io::Error) -> RepoError {
    RepoError::Io(error.to_string())
}

#[cfg(test)]
mod import_tests;
#[cfg(test)]
pub(crate) mod test_support;
#[cfg(test)]
mod tests;
