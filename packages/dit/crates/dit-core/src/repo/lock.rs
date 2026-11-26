//! The repo's writer lock: one advisory lock on `.dit/lock` that every public
//! mutator holds from before its first read to after its last write, so two
//! processes never interleave a read-modify-write of `sets.toml`, a log or a
//! ref.
//!
//! The lock is `flock`-style and held per open file description, so it
//! conflicts with itself inside one process too: a mutator that holds it must
//! reach only unlocked internals, never another public mutator.

use std::fs::{File, OpenOptions, TryLockError};
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

use super::{Repo, RepoError, io_error};

const LOCK_FILE: &str = "lock";

/// How long a writer waits for the lock before giving up with
/// `RepoError::Locked`.
pub(super) const LOCK_TIMEOUT: Duration = Duration::from_secs(10);

/// How long a waiting writer sleeps between attempts.
const LOCK_POLL: Duration = Duration::from_millis(20);

/// Holds the writer lock until it is dropped.
#[must_use = "the lock is released when the guard is dropped"]
pub(super) struct RepoLock {
    _file: File,
}

/// Takes the lock of the `.dit` directory `dit`, polling until `wait` has
/// passed.
pub(super) fn acquire(dit: &Path, wait: Duration) -> Result<RepoLock, RepoError> {
    let path = dit.join(LOCK_FILE);
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)
        .map_err(io_error)?;
    let deadline = Instant::now() + wait;
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(RepoLock { _file: file }),
            Err(TryLockError::Error(error)) => return Err(io_error(error)),
            Err(TryLockError::WouldBlock) => {
                if Instant::now() >= deadline {
                    return Err(RepoError::Locked(path));
                }
                thread::sleep(LOCK_POLL);
            }
        }
    }
}

impl Repo {
    /// Takes the writer lock, waiting up to the repo's lock timeout.
    pub(super) fn lock(&self) -> Result<RepoLock, RepoError> {
        acquire(&self.dit_dir(), self.lock_wait)
    }

    /// Shortens (or lengthens) how long this repo's writers wait for the lock before `RepoError::Locked`.
    pub fn with_lock_wait(mut self, wait: Duration) -> Self {
        self.lock_wait = wait;
        self
    }
}
