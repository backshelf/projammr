//! What a push uploads: the objects a save needs, and the packs they travel in.
//!
//! A pack is a run of records, `id (32 raw bytes) ‖ kind byte ‖ frame length (u32 LE) ‖ frame`, where the frame is
//! the object's file in the store unchanged (zstd level 3 of `kind byte ‖ body`). The instance decompresses each
//! frame and checks its first byte against the record's kind and its SHA-256 against the id.

use std::collections::hash_map::Entry;
use std::collections::{HashMap, HashSet};
use std::io::{self, Read};

use thiserror::Error;

use crate::repo::Save;
use crate::store::{
    ObjectId, ObjectKind, ObjectRead, Store, StoreError, decode_chunked, read_tree_object,
};

/// The most bytes one object's frame may take. The instance refuses a larger one.
pub const MAX_OBJECT_BYTES: usize = 64 * 1024 * 1024;

/// The most bytes a pack grows to before the next record starts another, whatever the instance's upload limit allows:
/// a smaller pack is a shorter wait for the instance's answer and less to send again after a failure. A record larger
/// than this still goes, alone in its pack.
pub const PACK_TARGET_BYTES: usize = 32 * 1024 * 1024;

/// The id, the kind byte and the frame's length.
const HEADER_BYTES: usize = 32 + 1 + 4;

/// Which limit an object was over.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackLimit {
    /// The most one object may take, compressed (the frame) or decompressed.
    ObjectLimit,
    /// The instance's upload limit, which a record, header included, must fit.
    UploadLimit,
}

/// Where in the repo an object was listed from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Place {
    pub set_id: String,
    pub save: ObjectId,
}

/// Why a pack could not be written.
#[derive(Debug, Clone, PartialEq, Error)]
pub enum PackError {
    #[error(transparent)]
    Store(#[from] StoreError),
    /// An object that cannot go in any pack: its frame, or what it decompresses to, is over the instance's object
    /// limit, or its record alone is over the pack limit. `bytes` is the size that was compared to `limit`; `exact` is
    /// false when counting stopped at `limit` and the object's real size is only known to be past it.
    #[error("{}", too_big(.id, *.which, *.bytes, *.exact, *.limit, .place))]
    TooBig {
        id: ObjectId,
        which: PackLimit,
        bytes: usize,
        exact: bool,
        limit: usize,
        /// The save and set the object was listed from, when the caller knows them.
        place: Option<Place>,
    },
}

impl PackError {
    /// The same error naming where the object was listed from; any other error is unchanged.
    pub fn at(self, set_id: &str, save: ObjectId) -> Self {
        match self {
            PackError::TooBig {
                id,
                which,
                bytes,
                exact,
                limit,
                ..
            } => PackError::TooBig {
                id,
                which,
                bytes,
                exact,
                limit,
                place: Some(Place {
                    set_id: set_id.to_string(),
                    save,
                }),
            },
            other => other,
        }
    }
}

fn too_big(
    id: &ObjectId,
    which: PackLimit,
    bytes: usize,
    exact: bool,
    limit: usize,
    place: &Option<Place>,
) -> String {
    let cause = match which {
        PackLimit::ObjectLimit => "the most one object may take",
        PackLimit::UploadLimit => "this instance's upload limit, which its admin can raise",
    };
    let place = match place {
        Some(Place { set_id, save }) => format!(" It is in save {save} of set {set_id}."),
        None => String::new(),
    };
    let size = if exact {
        format!("{bytes} bytes, over")
    } else {
        "over".to_string()
    };
    format!("Object {id} is {size} the {limit}-byte limit ({cause}); it cannot be pushed.{place}")
}

/// The objects a push of `save` uploads, deduplicated, in the order first seen: its Tree, its side Blob, then the
/// objects each leaf of the tree names, in tree order. A leaf stored as a Chunked object contributes that object and
/// then each of its chunk Blobs. The Save and its Commit are not objects the instance stores, so they are not here.
pub fn save_objects(
    store: &impl ObjectRead,
    save: &Save,
) -> Result<Vec<(ObjectId, ObjectKind)>, StoreError> {
    save_objects_cached(store, save, &mut LeafObjects::default())
}

/// What each leaf object a push has met contributes to a save's objects, by the leaf's id: saves of one set share
/// most of their leaves, and a leaf's object list is read (decompressed and hashed) once per push, not once per save.
#[derive(Default)]
pub(super) struct LeafObjects(HashMap<ObjectId, Vec<(ObjectId, ObjectKind)>>);

impl LeafObjects {
    pub(super) fn of(
        &mut self,
        store: &impl ObjectRead,
        leaf: ObjectId,
    ) -> Result<&[(ObjectId, ObjectKind)], StoreError> {
        match self.0.entry(leaf) {
            Entry::Occupied(entry) => Ok(entry.into_mut()),
            Entry::Vacant(entry) => {
                let (kind, body) = store.get(&leaf)?;
                let objects = match kind {
                    ObjectKind::Blob => vec![(leaf, kind)],
                    ObjectKind::Chunked => std::iter::once(Ok((leaf, kind)))
                        .chain(
                            decode_chunked(&body)?
                                .into_iter()
                                .map(|chunk| Ok((chunk, ObjectKind::Blob))),
                        )
                        .collect::<Result<_, StoreError>>()?,
                    other => {
                        return Err(StoreError::Malformed(format!(
                            "leaf {leaf} is a {other:?}, not a Blob or Chunked object"
                        )));
                    }
                };
                Ok(entry.insert(objects))
            }
        }
    }
}

/// `save_objects` reading each leaf through `leaves`, which a push keeps across its saves.
pub(super) fn save_objects_cached(
    store: &impl ObjectRead,
    save: &Save,
    leaves: &mut LeafObjects,
) -> Result<Vec<(ObjectId, ObjectKind)>, StoreError> {
    let mut seen = HashSet::new();
    let mut objects = Vec::new();
    let mut add = |id: ObjectId, kind: ObjectKind| {
        if seen.insert(id) {
            objects.push((id, kind));
        }
    };
    if let Some((tree, side)) = save.document() {
        add(*tree, ObjectKind::Tree);
        add(*side, ObjectKind::Blob);
        for part in read_tree_object(store, tree)?.parts {
            for leaf in part.leaves {
                for &(id, kind) in leaves.of(store, leaf.object)? {
                    add(id, kind);
                }
            }
        }
    }
    if let Some(raw) = save.raw {
        for &(id, kind) in leaves.of(store, raw)? {
            add(id, kind);
        }
    }
    Ok(objects)
}

/// Every object a push of `saves` uploads, each once across all the saves, in the order first seen, with the size in
/// bytes of its frame in the store: what a pack carries for it, without the record's header. Each leaf is read once
/// however many of the saves name it, as in a push.
pub fn object_sizes(store: &Store, saves: &[Save]) -> Result<Vec<(ObjectId, u64)>, StoreError> {
    let mut leaves = LeafObjects::default();
    let mut seen = HashSet::new();
    let mut sizes = Vec::new();
    for save in saves {
        for (id, _) in save_objects_cached(store, save, &mut leaves)? {
            if seen.insert(id) {
                sizes.push((id, store.frame_len(&id)?));
            }
        }
    }
    Ok(sizes)
}

/// The objects a push's sample phase uploads for `saves`, each once, in the order first seen, with the size in bytes of
/// its frame in the store: the objects of the leaves the saves' samples name, which [`object_sizes`] leaves out.
pub fn sample_object_sizes(
    store: &Store,
    saves: &[Save],
) -> Result<Vec<(ObjectId, u64)>, StoreError> {
    let mut leaves = LeafObjects::default();
    let mut seen = HashSet::new();
    let mut sizes = Vec::new();
    for leaf in saves
        .iter()
        .flat_map(|save| &save.samples)
        .filter_map(|sample| sample.object)
    {
        for &(id, _) in leaves.of(store, leaf)? {
            if seen.insert(id) {
                sizes.push((id, store.frame_len(&id)?));
            }
        }
    }
    Ok(sizes)
}

/// The packs `objects` make, one at a time so a push never holds more than one in memory. Records are added in order
/// while the pack stays within the smaller of `max_bytes` and `PACK_TARGET_BYTES`; the next record starts the next
/// pack. A record larger than that goes alone in its pack, as long as it is within `max_bytes`.
///
/// `max_bytes` is the instance's upload limit (`GET /api/uploads/limits`). A pack over it would be refused, or cut
/// short by the instance's proxy, which is why packs are split under it. An object whose record alone is over
/// `max_bytes`, or whose frame or decompressed content is over `MAX_OBJECT_BYTES`, is a `PackError::TooBig` and ends
/// the iteration.
pub fn packs<'a>(
    store: &'a Store,
    objects: &'a [(ObjectId, ObjectKind)],
    max_bytes: usize,
) -> impl Iterator<Item = Result<Vec<u8>, PackError>> + 'a {
    Packs {
        store,
        objects: objects.iter(),
        max_bytes,
        carried: None,
        failed: false,
    }
}

struct Packs<'a> {
    store: &'a Store,
    objects: std::slice::Iter<'a, (ObjectId, ObjectKind)>,
    max_bytes: usize,
    /// A record read but not fitting the pack just closed, which opens the next one.
    carried: Option<Vec<u8>>,
    failed: bool,
}

/// One object's record, or `TooBig` when it cannot fit any pack.
fn record(
    store: &Store,
    id: &ObjectId,
    kind: ObjectKind,
    max_bytes: usize,
) -> Result<Vec<u8>, PackError> {
    let frame = store.raw(id)?;
    let over_object_limit = |bytes: usize, exact: bool| PackError::TooBig {
        id: *id,
        which: PackLimit::ObjectLimit,
        bytes,
        exact,
        limit: MAX_OBJECT_BYTES,
        place: None,
    };
    if frame.len() > MAX_OBJECT_BYTES {
        return Err(over_object_limit(frame.len(), true));
    }
    let (content, exact) = decompressed_size(id, &frame)?;
    if content > MAX_OBJECT_BYTES {
        return Err(over_object_limit(content, exact));
    }
    let bytes = HEADER_BYTES + frame.len();
    if bytes > max_bytes {
        return Err(PackError::TooBig {
            id: *id,
            which: PackLimit::UploadLimit,
            bytes,
            exact: true,
            limit: max_bytes,
            place: None,
        });
    }
    let mut record = Vec::with_capacity(bytes);
    record.extend_from_slice(id.as_bytes());
    record.push(kind.as_byte());
    record.extend_from_slice(&(frame.len() as u32).to_le_bytes());
    record.extend_from_slice(&frame);
    Ok(record)
}

/// What `frame` decompresses to, in bytes, and whether that is the real size: the size its header declares, else counted
/// by decoding, which stops one byte past `MAX_OBJECT_BYTES` so a frame that expands without end is never held or
/// decoded whole. A count that stopped there is only known to be past `MAX_OBJECT_BYTES`.
fn decompressed_size(id: &ObjectId, frame: &[u8]) -> Result<(usize, bool), PackError> {
    let corrupt = || PackError::Store(StoreError::Corrupt(*id));
    if let Some(declared) = zstd::zstd_safe::get_frame_content_size(frame).map_err(|_| corrupt())? {
        return Ok((usize::try_from(declared).unwrap_or(usize::MAX), true));
    }
    let decoder = zstd::stream::read::Decoder::new(frame).map_err(|_| corrupt())?;
    let counted = io::copy(
        &mut decoder.take(MAX_OBJECT_BYTES as u64 + 1),
        &mut io::sink(),
    )
    .map_err(|_| corrupt())? as usize;
    Ok((counted, counted <= MAX_OBJECT_BYTES))
}

impl Iterator for Packs<'_> {
    type Item = Result<Vec<u8>, PackError>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.failed {
            return None;
        }
        let mut pack = self.carried.take().unwrap_or_default();
        for (id, kind) in self.objects.by_ref() {
            let record = match record(self.store, id, *kind, self.max_bytes) {
                Ok(record) => record,
                Err(error) => {
                    self.failed = true;
                    return Some(Err(error));
                }
            };
            if !pack.is_empty() && pack.len() + record.len() > self.max_bytes.min(PACK_TARGET_BYTES)
            {
                self.carried = Some(record);
                return Some(Ok(pack));
            }
            pack.extend_from_slice(&record);
        }
        (!pack.is_empty()).then_some(Ok(pack))
    }
}
