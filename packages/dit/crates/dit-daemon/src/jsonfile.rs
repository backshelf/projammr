//! A JSON object kept in a file that the app and the cli both write while the app runs (the renders ledger, the
//! backfill's state).
//!
//! Every change goes through [`update`], which holds a lock file beside the data file for the read, the change and
//! the write, as `RepoList::update` does for `repos.toml`. The write is a temp file renamed into place, so a reader
//! sees the whole old file or the whole replacement. A file that does not parse is an error, never an empty value:
//! resetting it would forget what it held.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use serde::de::DeserializeOwned;

fn invalid(path: &Path, reason: impl std::fmt::Display) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        format!("{}: {reason}", path.display()),
    )
}

/// Distinguishes the temp files of writers in one process.
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Writes `bytes` to `path` through a temp file in the same folder, so a reader never sees half of them.
fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let folder = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "a state file's path has a folder",
        )
    })?;
    let stem = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    let temp = folder.join(format!(
        ".{stem}-{}-{}.tmp",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let written = File::create_new(&temp)
        .and_then(|mut file| {
            file.write_all(bytes)?;
            file.sync_all()
        })
        .and_then(|()| fs::rename(&temp, path));
    if written.is_err() {
        let _ = fs::remove_file(&temp);
    }
    written
}

/// The value at `path`; the default when there is no file yet. A file that does not parse is an `InvalidData`
/// error naming the file, and is left as it is.
pub(crate) fn load<T: DeserializeOwned + Default>(path: &Path) -> io::Result<T> {
    match fs::read(path) {
        // serde would read a JSON array as the fields of a struct, in order; the file is always an object.
        Ok(bytes) if bytes.trim_ascii_start().first() != Some(&b'{') => {
            Err(invalid(path, "not a JSON object"))
        }
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| invalid(path, error)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(T::default()),
        Err(error) => Err(error),
    }
}

/// Reads the value at `path`, lets `change` edit it and writes it back, all under the lock file beside it (the same
/// name with the extension `lock`), so two processes never lose each other's change. Returns what `change` returns.
/// When the file cannot be read or parsed, `change` does not run and nothing is written.
pub(crate) fn update<T, R>(path: &Path, change: impl FnOnce(&mut T) -> R) -> io::Result<R>
where
    T: DeserializeOwned + Default + Serialize,
{
    let folder = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "a state file's path has a folder",
        )
    })?;
    fs::create_dir_all(folder)?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(path.with_extension("lock"))?;
    lock.lock()?;
    let mut value = load::<T>(path)?;
    let out = change(&mut value);
    let text = serde_json::to_vec_pretty(&value).map_err(|error| invalid(path, error))?;
    write_atomic(path, &text)?;
    Ok(out)
}
