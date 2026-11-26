//! Tracking the bytes of the samples under `Samples/`: each file a save's references name is read once through the
//! streaming chunker into Blob or Chunked leaves, and `(path, size, mtime)` remembers the answer in `.dit/` so the
//! next save of a large folder only stats it.

use std::collections::BTreeMap;
use std::fs::{self, File};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::refs::atomic_write;
use super::{Repo, RepoError};
use crate::meta::{SampleKind, SampleRef};
use crate::store::{Batch, ObjectId};

const CACHE_FILE: &str = "samples.json";
/// A first read of a file this big says so on stderr: a folder of them takes minutes.
const PROGRESS_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Entry {
    size: u64,
    /// Modification time in nanoseconds since the Unix epoch.
    mtime: u64,
    object: ObjectId,
}

/// What `.dit/samples.json` holds: the leaf id of each project-relative file at the size and mtime it was read at. A
/// cache, so one that is missing or unreadable is an empty one. Entries go in only for objects a finished batch makes
/// durable: callers `Repo::save_sample_cache` after `Batch::finish`.
#[derive(Debug, Default, Serialize, Deserialize)]
pub(super) struct SampleCache {
    files: BTreeMap<String, Entry>,
    #[serde(skip)]
    dirty: bool,
}

impl SampleCache {
    /// What the cache holds for `relative` when the file has the size and modification time it was read at.
    fn current(&self, relative: &str, meta: &fs::Metadata) -> Option<&Entry> {
        let mtime = meta.modified().ok().and_then(mtime_nanos)?;
        self.files
            .get(relative)
            .filter(|entry| entry.size == meta.len() && entry.mtime == mtime)
    }
}

fn mtime_nanos(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|since| u64::try_from(since.as_nanos()).ok())
}

impl Repo {
    pub(super) fn load_sample_cache(&self) -> SampleCache {
        fs::read(self.dit_dir().join(CACHE_FILE))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    /// Writes the cache when this run changed it; call once the batch the cache's new entries came from is finished.
    pub(super) fn save_sample_cache(&self, cache: &SampleCache) -> Result<(), RepoError> {
        if !cache.dirty {
            return Ok(());
        }
        let bytes = serde_json::to_vec(cache).map_err(super::save::json_error)?;
        atomic_write(&self.dit_dir().join(CACHE_FILE), &bytes)
    }

    /// Fills `object` and `size` of every `Project` ref that has a `relative` path under `Samples/` and a file at it,
    /// reading a file only when the cache does not know its `(path, size, mtime)`. A file that is missing, is not a
    /// file, or cannot be read leaves its ref as it was, `None` throughout; a file that exists and cannot be read
    /// says so on stderr.
    pub(super) fn track_samples(
        &self,
        batch: &mut Batch<'_>,
        cache: &mut SampleCache,
        refs: &mut [SampleRef],
    ) {
        for sample in refs {
            if sample.kind != SampleKind::Project {
                continue;
            }
            let Some(relative) = sample.relative.clone() else {
                continue;
            };
            if let Some((object, size)) = self.track_file(batch, cache, &relative) {
                sample.object = Some(object);
                sample.size = Some(size);
            }
        }
    }

    fn track_file(
        &self,
        batch: &mut Batch<'_>,
        cache: &mut SampleCache,
        relative: &str,
    ) -> Option<(ObjectId, u64)> {
        let path = self.root.join(relative);
        let meta = match fs::metadata(&path) {
            Ok(meta) if meta.is_file() => meta,
            Ok(_) => return None,
            Err(error) => return unreadable(relative, &error),
        };
        let mtime = meta.modified().ok().and_then(mtime_nanos);
        if let Some(entry) = cache.current(relative, &meta) {
            return Some((entry.object, entry.size));
        }

        if meta.len() >= PROGRESS_BYTES {
            eprintln!(
                "dit: reading {relative} ({} MiB)",
                meta.len() / (1024 * 1024)
            );
        }
        let file = match File::open(&path) {
            Ok(file) => file,
            Err(error) => return unreadable(relative, &error),
        };
        let (object, read) = match batch.put_reader(&file) {
            Ok(read) => read,
            Err(error) => {
                say_unreadable(relative, &error);
                return None;
            }
        };
        // A file that changed under the read is not remembered: the next save reads it again.
        let after = file.metadata().ok().and_then(|meta| meta.modified().ok());
        if let (Some(before), Some(after)) = (mtime, after.and_then(mtime_nanos))
            && before == after
            && read == meta.len()
        {
            cache.files.insert(
                relative.to_string(),
                Entry {
                    size: read,
                    mtime: before,
                    object,
                },
            );
            cache.dirty = true;
        }
        Some((object, read))
    }
}

impl Repo {
    /// Whether any file a save's samples name is not the one the cache read: its size or modification time differs
    /// from what the cache holds, or the cache holds nothing for it. A file that is gone is not a change here.
    pub(super) fn samples_drifted(&self, cache: &SampleCache, samples: &[SampleRef]) -> bool {
        samples.iter().any(|sample| {
            let (Some(relative), Some(_)) = (&sample.relative, &sample.object) else {
                return false;
            };
            match fs::metadata(self.root.join(relative)) {
                Ok(meta) if meta.is_file() => cache.current(relative, &meta).is_none(),
                _ => false,
            }
        })
    }
}

/// A sample that could not be reached: no object. A file that is not there stays quiet, being a reference to
/// something moved or deleted; any other failure says why on stderr, beside the progress line.
fn unreadable<T>(relative: &str, error: &std::io::Error) -> Option<T> {
    if error.kind() != std::io::ErrorKind::NotFound {
        say_unreadable(relative, error);
    }
    None
}

fn say_unreadable(relative: &str, error: &dyn std::fmt::Display) {
    eprintln!("dit: could not read {relative}: {error}");
}
