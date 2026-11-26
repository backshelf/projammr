//! Recording a save: what dit keeps each time a set's file changes.

use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::layout::DIT_DIR;
use super::refs::MAIN_BRANCH;
use super::samples::SampleCache;
use super::{Repo, RepoError, io_error};
use crate::daw::{DawError, mask_tree};
use crate::materialise::{MaterialiseError, materialise_xml};
use crate::meta::{SampleKind, SampleRef, SetMeta};
use crate::store::{
    Batch, LeafEntry, ObjectId, ObjectKind, ObjectRead, PartEntry, StoreError, TreeObject,
    encode_tree,
};

/// One recorded state of a set's file.
///
/// Most saves hold the set's document: `xml_hash`, `tree` and `side` are all present and `raw` is absent. A file
/// that is whole but that the DAW module cannot read is stored as it is on disk: `raw` names its bytes, `unreadable`
/// is set, and `xml_hash`, `tree`, `side` and `meta` are absent. Each is left out of the JSON when absent, so the id
/// of a save of either kind is the hash of exactly what it holds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Save {
    pub set_id: String,
    /// The branch whose working file this save records; `main` for the set's
    /// own file.
    pub branch: String,
    /// Hex SHA-256 of the set's XML document.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xml_hash: Option<String>,
    /// The Tree object holding the masked document.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tree: Option<ObjectId>,
    /// The Blob holding the side list as a JSON array of strings, which
    /// unmasks the tree.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side: Option<ObjectId>,
    /// The Blob or Chunked leaf holding the set file's bytes as they were on disk, for a save of a file no
    /// document could be read from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw: Option<ObjectId>,
    /// The file's modification time in milliseconds since the Unix epoch,
    /// floored. A save recorded because a sample changed or the set was parsed again, with the file itself as it
    /// was, is one millisecond after the save before it when the file's time is not later.
    pub file_updated_at: i64,
    pub machine: String,
    /// `None` when the document could not be parsed.
    pub meta: Option<SetMeta>,
    /// The tree and the sample bytes are the previous save's: only masked values changed.
    pub view_only: bool,
    /// The document could not be read in full: `raw` holds the file, or `meta` is `None`.
    pub unreadable: bool,
    /// The samples the set references, as `Daw::sample_refs` reads them with
    /// containment applied. Absent from saves of sets that reference none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub samples: Vec<SampleRef>,
}

impl Save {
    /// The tree and the side list that unmasks it; `None` for a save that holds the file's bytes whole.
    pub fn document(&self) -> Option<(&ObjectId, &ObjectId)> {
        self.tree.as_ref().zip(self.side.as_ref())
    }

    /// Whether `other` records the same state of the file: the same tree (or the same raw bytes) and, sample by
    /// sample, the same file bytes. Masked values and the file's time do not count.
    pub fn same_state(&self, other: &Save) -> bool {
        self.tree == other.tree
            && self.raw == other.raw
            && same_sample_bytes(&self.samples, &other.samples)
    }
}

/// Whether two saves' samples are the same files with the same bytes, in the same order.
fn same_sample_bytes(a: &[SampleRef], b: &[SampleRef]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b)
            .all(|(a, b)| a.relative == b.relative && a.object == b.object)
}

/// One state of a set's file, as `Repo::store_save` stores it.
pub(super) struct FileState<'a> {
    /// The file's XML document.
    pub(super) xml: &'a [u8],
    /// Hex SHA-256 of `xml`.
    pub(super) xml_hash: String,
    /// As `Save::file_updated_at`.
    pub(super) file_updated_at: i64,
}

/// Milliseconds since the Unix epoch, floored.
pub(super) fn epoch_millis(time: SystemTime) -> i64 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(after) => after.as_millis() as i64,
        Err(before) => -(before.duration().as_nanos().div_ceil(1_000_000) as i64),
    }
}

pub(super) fn json_error(error: serde_json::Error) -> StoreError {
    StoreError::Malformed(error.to_string())
}

/// The file's bytes and modification time, read through one open file: its length and time before and after the
/// read are the same, so the time is the time of these bytes. A file that changed under the read is Live still
/// writing it, and is refused as one that is not whole.
fn read_whole(file: &Path) -> Result<(Vec<u8>, SystemTime), RepoError> {
    let mut handle = fs::File::open(file).map_err(io_error)?;
    let before = handle.metadata().map_err(io_error)?;
    let mut bytes = Vec::with_capacity(usize::try_from(before.len()).unwrap_or(0));
    handle.read_to_end(&mut bytes).map_err(io_error)?;
    let after = handle.metadata().map_err(io_error)?;
    let modified = before.modified().map_err(io_error)?;
    if before.len() != after.len()
        || after.len() != bytes.len() as u64
        || after.modified().map_err(io_error)? != modified
    {
        return Err(DawError::Corrupt("the file changed while it was being read".into()).into());
    }
    Ok((bytes, modified))
}

/// The samples of `samples` that hold bytes `latest` does not: a tracked file whose object is not the one `latest`
/// has for that path. One that cannot be read now is no change: a file that went away, or a drive that is not
/// mounted, says nothing about the sample.
fn changed_samples<'a>(latest: &Save, samples: &'a [SampleRef]) -> Vec<&'a SampleRef> {
    samples
        .iter()
        .filter(|sample| match (&sample.relative, &sample.object) {
            (Some(relative), Some(object)) => !latest.samples.iter().any(|held| {
                held.relative.as_ref() == Some(relative) && held.object.as_ref() == Some(object)
            }),
            _ => false,
        })
        .collect()
}

impl Repo {
    /// Records the set file's current state, or returns `None` when it equals its branch's latest save: the same
    /// XML and, for each tracked sample, the same bytes. The file is the main file of a set, the working file of one
    /// of its branches, or else a new set on `main`.
    ///
    /// A file that is not whole (it does not decode, or changed while it was read) is an error and nothing is
    /// stored, so the caller may retry. A whole file that no document can be read from is stored as its bytes and
    /// marked `unreadable`; the next call that can read it records the document, since the latest save's XML is
    /// then different.
    ///
    /// With the XML unchanged, a sample under `Samples/` whose bytes changed (its size or time says so, and the read
    /// confirms it), or a set the DAW module can now parse that the latest save could not, records a save of its
    /// own. Its time is the latest of the file's and the changed samples' modification times, or one millisecond
    /// after the latest save's when that is not later, so the log stays in time order and no two saves of a branch
    /// share a time. A sample copied with its time kept (`cp -p`, `rsync --times`) and the same size is not seen.
    ///
    /// The document is split, each text leaf is masked with one side list
    /// threaded through the whole tree, every leaf and the tree are stored,
    /// then the side list and the save, all in one store batch; only once the
    /// batch is durable does the save's id join the log.
    pub fn record_save(&self, set_path: &Path) -> Result<Option<ObjectId>, RepoError> {
        let _lock = self.lock()?;
        let (file, rel) = self.locate_set(set_path)?;
        let (bytes, modified) = read_whole(&file)?;
        let mut file_updated_at = epoch_millis(modified);

        let xml = match self.daw.decode(&bytes) {
            Ok(xml) => Some(xml),
            Err(error @ DawError::Corrupt(_)) => return Err(error.into()),
            Err(_) => None,
        };
        let xml_hash = xml.as_deref().map(|xml| hex::encode(Sha256::digest(xml)));

        let mut sets = self.read_sets()?;
        let known = sets.resolve(&rel);
        let latest = match &known {
            Some((id, branch)) => self
                .log(id, branch)?
                .last()
                .map(|id| self.read_save(id))
                .transpose()?,
            None => None,
        };
        let mut batch = self.store.batch();
        let mut cache = self.load_sample_cache();
        if let (Some(xml), Some(hash), Some(latest)) = (&xml, &xml_hash, &latest)
            && latest.xml_hash.as_ref() == Some(hash)
        {
            let samples = self.tracked_samples(&mut batch, &mut cache, xml);
            let changed = changed_samples(latest, &samples);
            let reparsed = latest.unreadable && self.daw.parse(xml).is_ok();
            if changed.is_empty() && !reparsed {
                // Everything read is what the latest save holds, so its objects are durable already.
                self.save_sample_cache(&cache)?;
                return Ok(None);
            }
            file_updated_at = changed
                .iter()
                .filter_map(|sample| self.sample_modified(sample))
                .fold(file_updated_at, i64::max);
            if file_updated_at <= latest.file_updated_at {
                file_updated_at = latest.file_updated_at + 1;
            }
        } else if let (Some((id, branch)), Some(latest)) = (&known, &latest)
            && file_updated_at <= latest.file_updated_at
        {
            let occupied: std::collections::HashSet<i64> = self
                .saves(id, branch)?
                .into_iter()
                .map(|save| save.file_updated_at)
                .collect();
            while occupied.contains(&file_updated_at) {
                file_updated_at += 1;
            }
        }

        let (set_id, branch) = match known {
            Some(known) => known,
            None => (self.register_set(&mut sets, &rel)?, MAIN_BRANCH.to_string()),
        };
        let document = match (&xml, xml_hash) {
            (Some(xml), Some(xml_hash)) => {
                let state = FileState {
                    xml,
                    xml_hash,
                    file_updated_at,
                };
                match self.store_save(
                    &mut batch,
                    &mut cache,
                    &set_id,
                    &branch,
                    state,
                    latest.as_ref(),
                ) {
                    // Whole, but not a document the DAW module can split: kept as it is.
                    Err(RepoError::Daw(_)) => None,
                    stored => Some(stored?),
                }
            }
            _ => None,
        };
        let (save_id, save) = match document {
            Some(stored) => stored,
            None => {
                let held = match latest.as_ref().and_then(|save| save.raw.as_ref()) {
                    Some(raw) => Some(self.store.read_leaf(raw)?),
                    None => None,
                };
                if held.as_deref() == Some(bytes.as_slice()) {
                    return Ok(None);
                }
                let raw = batch.put_leaf(&bytes)?;
                self.store_raw(&mut batch, &set_id, &branch, raw, file_updated_at)?
            }
        };
        batch.finish()?;
        self.save_sample_cache(&cache)?;
        self.append_log(&save.set_id, &save.branch, &save_id)?;
        Ok(Some(save_id))
    }

    /// Stores a file no document could be read from as a save holding its bytes, which are `raw` in `batch`, into
    /// `batch`; see [`Repo::store_save`] for what the caller does after.
    pub(super) fn store_raw(
        &self,
        batch: &mut Batch<'_>,
        set_id: &str,
        branch: &str,
        raw: ObjectId,
        file_updated_at: i64,
    ) -> Result<(ObjectId, Save), RepoError> {
        let save = Save {
            set_id: set_id.to_string(),
            branch: branch.to_string(),
            xml_hash: None,
            tree: None,
            side: None,
            raw: Some(raw),
            file_updated_at,
            machine: (self.machine)(),
            meta: None,
            view_only: false,
            unreadable: true,
            samples: Vec::new(),
        };
        let save_id = batch.put(
            ObjectKind::Save,
            &serde_json::to_vec(&save).map_err(json_error)?,
        )?;
        Ok((save_id, save))
    }

    /// The modification time of a tracked sample's file, in milliseconds.
    fn sample_modified(&self, sample: &SampleRef) -> Option<i64> {
        let relative = sample.relative.as_deref()?;
        fs::metadata(self.root.join(relative))
            .and_then(|meta| meta.modified())
            .ok()
            .map(epoch_millis)
    }

    /// The refs `xml` makes with containment applied, each tracked file read into `batch` or found in `cache`.
    fn tracked_samples(
        &self,
        batch: &mut Batch<'_>,
        cache: &mut SampleCache,
        xml: &[u8],
    ) -> Vec<SampleRef> {
        let mut samples = self.contain_samples(self.daw.sample_refs(xml).unwrap_or_default());
        self.track_samples(batch, cache, &mut samples);
        samples
    }

    /// Stores one state of a file as a save of `branch` into `batch` without
    /// touching its log: the document is split, each text leaf masked with one
    /// side list threaded through the whole tree, every leaf, the tree and the
    /// side list put, then the Save. The caller finishes the batch before any
    /// log names the save. `previous` is the save just before it in time, whose
    /// tree decides `view_only`. The files the save's `Samples/` references name are read into `batch`, and
    /// `cache` remembers them; the caller saves the cache once the batch is finished.
    pub(super) fn store_save(
        &self,
        batch: &mut Batch<'_>,
        cache: &mut SampleCache,
        set_id: &str,
        branch: &str,
        state: FileState<'_>,
        previous: Option<&Save>,
    ) -> Result<(ObjectId, Save), RepoError> {
        let FileState {
            xml,
            xml_hash,
            file_updated_at,
        } = state;
        let (tree, side) = mask_tree(self.daw, &self.daw.split(xml)?);
        let mut parts = Vec::with_capacity(tree.parts.len());
        for part in &tree.parts {
            let mut leaves = Vec::with_capacity(part.leaves.len());
            for leaf in &part.leaves {
                leaves.push(LeafEntry {
                    kind: leaf.kind,
                    tag: leaf.tag.clone(),
                    object: batch.put_leaf(&leaf.bytes)?,
                });
            }
            parts.push(PartEntry {
                kind: part.kind,
                tag: part.tag.clone(),
                id: part.id.clone(),
                leaves,
            });
        }
        let tree_id = batch.put(ObjectKind::Tree, &encode_tree(&TreeObject { parts }))?;
        let side_id = batch.put(
            ObjectKind::Blob,
            &serde_json::to_vec(&side).map_err(json_error)?,
        )?;

        let (meta, unreadable) = match self.daw.parse(xml) {
            Ok(meta) => (Some(meta), false),
            Err(_) => (None, true),
        };
        let samples = self.tracked_samples(batch, cache, xml);
        let save = Save {
            set_id: set_id.to_string(),
            branch: branch.to_string(),
            xml_hash: Some(xml_hash),
            tree: Some(tree_id),
            side: Some(side_id),
            raw: None,
            file_updated_at,
            machine: (self.machine)(),
            meta,
            view_only: previous.is_some_and(|save| {
                save.tree == Some(tree_id) && same_sample_bytes(&save.samples, &samples)
            }),
            unreadable,
            samples,
        };
        let save_id = batch.put(
            ObjectKind::Save,
            &serde_json::to_vec(&save).map_err(json_error)?,
        )?;
        Ok((save_id, save))
    }

    /// Applies containment to the refs a set makes: a `Project` ref whose
    /// relative path is absolute, climbs with `..`, or resolves outside
    /// `<root>/Samples` once symlinks are followed is `Outside` and loses its
    /// relative path; one that stays in the project but not under `Samples/`
    /// is kept as `Project` without a relative path.
    fn contain_samples(&self, refs: Vec<SampleRef>) -> Vec<SampleRef> {
        let samples = self.root.join(SAMPLES_DIR);
        refs.into_iter()
            .map(|mut sample| {
                if sample.kind != SampleKind::Project {
                    sample.relative = None;
                    return sample;
                }
                match sample
                    .relative
                    .as_deref()
                    .map(|rel| contained(&samples, rel))
                {
                    Some(Containment::Inside) => {}
                    Some(Containment::Escapes) => {
                        sample.kind = SampleKind::Outside;
                        sample.relative = None;
                    }
                    Some(Containment::NotSamples) | None => sample.relative = None,
                }
                sample
            })
            .collect()
    }

    /// The saves of a branch ordered by file time, then machine, for readers.
    /// The log holds them in recording order.
    pub fn saves(&self, set_id: &str, branch: &str) -> Result<Vec<Save>, RepoError> {
        let mut saves = self
            .log(set_id, branch)?
            .iter()
            .map(|id| self.read_save(id))
            .collect::<Result<Vec<_>, _>>()?;
        saves.sort_by(|a, b| (a.file_updated_at, &a.machine).cmp(&(b.file_updated_at, &b.machine)));
        Ok(saves)
    }

    /// Reads a stored Save object.
    pub fn read_save(&self, id: &ObjectId) -> Result<Save, RepoError> {
        match self.store.get(id)? {
            (ObjectKind::Save, body) => Ok(serde_json::from_slice(&body).map_err(json_error)?),
            (other, _) => {
                Err(StoreError::Malformed(format!("object {id} is a {other:?}, not a Save")).into())
            }
        }
    }

    /// The set file's XML document as it was when `save` was recorded, byte
    /// for byte, through `dit_core::materialise_xml` (each Text leaf unmasked
    /// as it was masked, then the leaves joined). A save that holds the file whole has no document:
    /// `RepoError::NoDocument`.
    pub fn materialise_xml(&self, save: &Save) -> Result<Vec<u8>, RepoError> {
        let (tree, side) = save.document().ok_or(RepoError::NoDocument)?;
        materialise_xml(&self.store, self.daw, tree, side).map_err(|error| match error {
            MaterialiseError::Store(error) => RepoError::Store(error),
            MaterialiseError::Daw(error) => RepoError::Daw(error),
        })
    }

    /// The canonical `set_path` and its name relative to the project folder
    /// with `/` separators, if it is a file of this DAW's inside the repo and
    /// outside `.dit/`.
    pub(super) fn locate_set(&self, set_path: &Path) -> Result<(PathBuf, String), RepoError> {
        let not_a_set = || RepoError::NotASet(set_path.to_path_buf());
        let file = set_path.canonicalize().map_err(io_error)?;
        let rel = file.strip_prefix(&self.root).map_err(|_| not_a_set())?;
        let extension = file
            .extension()
            .and_then(|ext| ext.to_str())
            .map(str::to_lowercase)
            .ok_or_else(not_a_set)?;
        let known = self
            .daw
            .set_extensions()
            .iter()
            .any(|candidate| candidate.to_lowercase() == extension);
        if !file.is_file() || !known || rel.starts_with(DIT_DIR) {
            return Err(not_a_set());
        }
        let rel = rel
            .components()
            .map(|part| part.as_os_str().to_str())
            .collect::<Option<Vec<_>>>()
            .map(|parts| parts.join("/"))
            .ok_or_else(not_a_set)?;
        Ok((file, rel))
    }
}

/// The folder dit tracks sample bytes in, inside the project folder.
pub(super) const SAMPLES_DIR: &str = "Samples";

#[derive(Debug, PartialEq, Eq)]
enum Containment {
    /// Under `Samples/`.
    Inside,
    /// Absolute, climbs with `..`, or resolves outside the project.
    Escapes,
    /// Within the project but not under `Samples/`.
    NotSamples,
}

/// Where the relative path `rel` a set spells falls, against the project's
/// `samples` folder. Lexical first; then, when the file exists, canonical, so a
/// symlink out of the project is caught.
fn contained(samples: &Path, rel: &str) -> Containment {
    let rel = rel.replace('\\', "/");
    let path = Path::new(&rel);
    let climbs = path
        .components()
        .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir));
    if path.is_absolute() || rel.starts_with('/') || climbs {
        return Containment::Escapes;
    }
    let Some(root) = samples.parent() else {
        return Containment::Escapes;
    };
    let full = root.join(path);
    if !full.starts_with(samples) {
        return Containment::NotSamples;
    }
    match (fs::canonicalize(&full), fs::canonicalize(samples)) {
        (Ok(file), Ok(folder)) if !file.starts_with(&folder) => Containment::Escapes,
        _ => Containment::Inside,
    }
}
