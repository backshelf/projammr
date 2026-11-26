//! Object ids and the byte formats of the stored objects. Compiles without
//! the `store` feature so the wasm build can compute and verify ids and read
//! trees.
//!
//! An object is a kind and a body; its id is the SHA-256 of the kind byte
//! followed by the body. All integers in bodies are little-endian.
//!
//! ```text
//! tree body   = u8 version (= 1) ‖ u32 part_count ‖ part*
//! part        = u8 kind (0 Gap, 1 Track, 2 Section) ‖ opt_str tag ‖ opt_str id ‖ u32 leaf_count ‖ leaf*
//! leaf        = u8 kind (0 Text, 1 Blob) ‖ opt_str tag ‖ [u8; 32] object id
//! opt_str     = u8 0  |  u8 1 ‖ u32 byte_len ‖ UTF-8 bytes
//! chunked body = the chunk ids, 32 bytes each, in order
//! ```

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::tree::{Leaf, LeafKind, Part, PartKind, Tree};

const TREE_VERSION: u8 = 1;
const ID_LEN: usize = 32;

/// What an object's body means.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ObjectKind {
    /// A leaf's bytes, or one chunk of a large leaf.
    Blob = 1,
    /// A large leaf: the ids of the Blob chunks it is cut into.
    Chunked = 2,
    Tree = 3,
    Save = 4,
    Commit = 5,
}

impl ObjectKind {
    pub fn from_byte(byte: u8) -> Option<Self> {
        match byte {
            1 => Some(Self::Blob),
            2 => Some(Self::Chunked),
            3 => Some(Self::Tree),
            4 => Some(Self::Save),
            5 => Some(Self::Commit),
            _ => None,
        }
    }

    pub fn as_byte(self) -> u8 {
        self as u8
    }
}

/// The SHA-256 of `kind byte ‖ body`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ObjectId([u8; ID_LEN]);

impl ObjectId {
    pub fn of(kind: ObjectKind, body: &[u8]) -> Self {
        let mut hasher = Sha256::new();
        hasher.update([kind.as_byte()]);
        hasher.update(body);
        Self(hasher.finalize().into())
    }

    pub fn from_bytes(bytes: [u8; ID_LEN]) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; ID_LEN] {
        &self.0
    }
}

impl fmt::Display for ObjectId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&hex::encode(self.0))
    }
}

impl FromStr for ObjectId {
    type Err = StoreError;

    fn from_str(s: &str) -> Result<Self, StoreError> {
        let mut bytes = [0u8; ID_LEN];
        hex::decode_to_slice(s, &mut bytes)
            .map_err(|e| StoreError::Malformed(format!("object id {s:?}: {e}")))?;
        Ok(Self(bytes))
    }
}

impl Serialize for ObjectId {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for ObjectId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        text.parse().map_err(serde::de::Error::custom)
    }
}

/// Why an object could not be stored, read or decoded. Holds only strings and
/// ids so a caller across the wasm boundary can map it to a code.
#[derive(Debug, Clone, PartialEq, Error)]
pub enum StoreError {
    #[error("object store i/o: {0}")]
    Io(String),
    #[error("object {0} is not in the store")]
    Missing(ObjectId),
    #[error("object {0} does not hash to its name")]
    Corrupt(ObjectId),
    #[error("malformed object: {0}")]
    Malformed(String),
}

/// Anything objects can be read from: the filesystem store, or an in-memory
/// pack. An implementation returns only content that hashes to `id`.
pub trait ObjectRead {
    fn get(&self, id: &ObjectId) -> Result<(ObjectKind, Vec<u8>), StoreError>;
}

/// A leaf's bytes: a Blob's body, or a Chunked object's chunks joined.
pub fn read_leaf(objects: &impl ObjectRead, id: &ObjectId) -> Result<Vec<u8>, StoreError> {
    let (kind, body) = objects.get(id)?;
    match kind {
        ObjectKind::Blob => Ok(body),
        ObjectKind::Chunked => {
            let mut bytes = Vec::new();
            for chunk in decode_chunked(&body)? {
                match objects.get(&chunk)? {
                    (ObjectKind::Blob, chunk_body) => bytes.extend(chunk_body),
                    (other, _) => {
                        return Err(StoreError::Malformed(format!(
                            "chunk {chunk} of {id} is a {other:?}, not a Blob"
                        )));
                    }
                }
            }
            Ok(bytes)
        }
        other => Err(StoreError::Malformed(format!(
            "object {id} is a {other:?}, not a leaf"
        ))),
    }
}

/// A stored Tree object decoded, its leaves left as object ids.
pub fn read_tree_object(
    objects: &impl ObjectRead,
    id: &ObjectId,
) -> Result<TreeObject, StoreError> {
    match objects.get(id)? {
        (ObjectKind::Tree, body) => decode_tree(&body),
        (other, _) => Err(StoreError::Malformed(format!(
            "object {id} is a {other:?}, not a Tree"
        ))),
    }
}

/// A stored Tree object read back into a `Tree`, every leaf's bytes read
/// with `read_leaf`. Joining it gives the document the tree was stored from.
pub fn read_tree(objects: &impl ObjectRead, id: &ObjectId) -> Result<Tree, StoreError> {
    let parts = read_tree_object(objects, id)?
        .parts
        .into_iter()
        .map(|part| {
            let leaves = part
                .leaves
                .into_iter()
                .map(|leaf| {
                    Ok(Leaf {
                        kind: leaf.kind,
                        tag: leaf.tag,
                        bytes: read_leaf(objects, &leaf.object)?,
                    })
                })
                .collect::<Result<Vec<_>, StoreError>>()?;
            Ok(Part {
                kind: part.kind,
                tag: part.tag,
                id: part.id,
                leaves,
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;
    Ok(Tree { parts })
}

pub fn encode_chunked(chunks: &[ObjectId]) -> Vec<u8> {
    chunks.iter().flat_map(|id| id.0).collect()
}

pub fn decode_chunked(body: &[u8]) -> Result<Vec<ObjectId>, StoreError> {
    let (ids, rest) = body.as_chunks::<ID_LEN>();
    if !rest.is_empty() {
        return Err(StoreError::Malformed(format!(
            "chunked body of {} bytes is not a multiple of {ID_LEN}",
            body.len()
        )));
    }
    Ok(ids.iter().copied().map(ObjectId).collect())
}

/// A leaf as a tree records it: its kind and tag, and where its bytes are.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LeafEntry {
    pub kind: LeafKind,
    pub tag: Option<String>,
    pub object: ObjectId,
}

/// A part as a tree records it, with its leaves stored as objects.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PartEntry {
    pub kind: PartKind,
    pub tag: Option<String>,
    pub id: Option<String>,
    pub leaves: Vec<LeafEntry>,
}

/// The body of a Tree object: a `Tree` whose leaves are object ids.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TreeObject {
    pub parts: Vec<PartEntry>,
}

pub fn encode_tree(tree: &TreeObject) -> Vec<u8> {
    let mut out = vec![TREE_VERSION];
    put_len(&mut out, tree.parts.len());
    for part in &tree.parts {
        encode_part(part, &mut out);
    }
    out
}

/// Appends one part as a tree records it: kind, tag, id, then each leaf's kind,
/// tag and object id. A tree is its version byte, its part count and these.
pub fn encode_part(part: &PartEntry, out: &mut Vec<u8>) {
    out.push(match part.kind {
        PartKind::Gap => 0,
        PartKind::Track => 1,
        PartKind::Section => 2,
    });
    put_opt_str(out, part.tag.as_deref());
    put_opt_str(out, part.id.as_deref());
    put_len(out, part.leaves.len());
    for leaf in &part.leaves {
        out.push(match leaf.kind {
            LeafKind::Text => 0,
            LeafKind::Blob => 1,
        });
        put_opt_str(out, leaf.tag.as_deref());
        out.extend_from_slice(&leaf.object.0);
    }
}

pub fn decode_tree(body: &[u8]) -> Result<TreeObject, StoreError> {
    let mut reader = Reader { rest: body };
    let version = reader.u8()?;
    if version != TREE_VERSION {
        return Err(malformed(format!("unknown tree version {version}")));
    }
    let part_count = reader.u32()?;
    let mut parts = Vec::new();
    for _ in 0..part_count {
        let kind = match reader.u8()? {
            0 => PartKind::Gap,
            1 => PartKind::Track,
            2 => PartKind::Section,
            other => return Err(malformed(format!("unknown part kind {other}"))),
        };
        let tag = reader.opt_str()?;
        let id = reader.opt_str()?;
        let leaf_count = reader.u32()?;
        let mut leaves = Vec::new();
        for _ in 0..leaf_count {
            let kind = match reader.u8()? {
                0 => LeafKind::Text,
                1 => LeafKind::Blob,
                other => return Err(malformed(format!("unknown leaf kind {other}"))),
            };
            let tag = reader.opt_str()?;
            let object = ObjectId(reader.take(ID_LEN)?.try_into().expect("took ID_LEN bytes"));
            leaves.push(LeafEntry { kind, tag, object });
        }
        parts.push(PartEntry {
            kind,
            tag,
            id,
            leaves,
        });
    }
    if !reader.rest.is_empty() {
        return Err(malformed(format!(
            "{} trailing bytes after the tree",
            reader.rest.len()
        )));
    }
    Ok(TreeObject { parts })
}

fn malformed(message: String) -> StoreError {
    StoreError::Malformed(message)
}

fn put_len(out: &mut Vec<u8>, len: usize) {
    let len = u32::try_from(len).expect("a tree holds fewer than 2^32 entries");
    out.extend_from_slice(&len.to_le_bytes());
}

fn put_opt_str(out: &mut Vec<u8>, value: Option<&str>) {
    match value {
        None => out.push(0),
        Some(text) => {
            out.push(1);
            put_len(out, text.len());
            out.extend_from_slice(text.as_bytes());
        }
    }
}

/// A cursor over a tree body that fails cleanly at the end of the input.
struct Reader<'a> {
    rest: &'a [u8],
}

impl<'a> Reader<'a> {
    fn take(&mut self, len: usize) -> Result<&'a [u8], StoreError> {
        if self.rest.len() < len {
            return Err(malformed("tree body is truncated".into()));
        }
        let (taken, rest) = self.rest.split_at(len);
        self.rest = rest;
        Ok(taken)
    }

    fn u8(&mut self) -> Result<u8, StoreError> {
        Ok(self.take(1)?[0])
    }

    fn u32(&mut self) -> Result<u32, StoreError> {
        let bytes = self.take(4)?.try_into().expect("took 4 bytes");
        Ok(u32::from_le_bytes(bytes))
    }

    fn opt_str(&mut self) -> Result<Option<String>, StoreError> {
        match self.u8()? {
            0 => Ok(None),
            1 => {
                let len = self.u32()? as usize;
                let text = std::str::from_utf8(self.take(len)?)
                    .map_err(|e| malformed(format!("tree string is not UTF-8: {e}")))?;
                Ok(Some(text.to_owned()))
            }
            other => Err(malformed(format!("unknown string marker {other}"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(n: u8) -> ObjectId {
        ObjectId::of(ObjectKind::Blob, &[n])
    }

    fn sample_tree() -> TreeObject {
        TreeObject {
            parts: vec![
                PartEntry {
                    kind: PartKind::Gap,
                    tag: None,
                    id: None,
                    leaves: vec![LeafEntry {
                        kind: LeafKind::Text,
                        tag: None,
                        object: id(1),
                    }],
                },
                PartEntry {
                    kind: PartKind::Track,
                    tag: Some("MidiTrack".into()),
                    id: Some("3".into()),
                    leaves: vec![
                        LeafEntry {
                            kind: LeafKind::Text,
                            tag: Some("head".into()),
                            object: id(2),
                        },
                        LeafEntry {
                            kind: LeafKind::Blob,
                            tag: None,
                            object: id(3),
                        },
                    ],
                },
                PartEntry {
                    kind: PartKind::Section,
                    tag: Some("é".into()),
                    id: None,
                    leaves: vec![],
                },
            ],
        }
    }

    #[test]
    fn object_id_hashes_the_kind_byte_then_the_body() {
        let mut hasher = Sha256::new();
        hasher.update([1u8, b'h', b'i']);
        let expected: [u8; 32] = hasher.finalize().into();
        assert_eq!(ObjectId::of(ObjectKind::Blob, b"hi").as_bytes(), &expected);
        assert_ne!(
            ObjectId::of(ObjectKind::Blob, b"hi"),
            ObjectId::of(ObjectKind::Chunked, b"hi")
        );
    }

    #[test]
    fn object_id_of_an_empty_blob_is_the_known_sha256() {
        assert_eq!(
            ObjectId::of(ObjectKind::Blob, b"").to_string(),
            "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a"
        );
    }

    #[test]
    fn object_id_round_trips_through_hex_and_serde() {
        let original = id(9);
        let text = original.to_string();
        assert_eq!(text.len(), 64);
        assert_eq!(text, text.to_lowercase());
        assert_eq!(text.parse::<ObjectId>().unwrap(), original);
        let json = serde_json::to_string(&original).unwrap();
        assert_eq!(json, format!("\"{text}\""));
        assert_eq!(serde_json::from_str::<ObjectId>(&json).unwrap(), original);
    }

    #[test]
    fn object_id_rejects_bad_hex() {
        assert!("zz".parse::<ObjectId>().is_err());
        assert!("abcd".parse::<ObjectId>().is_err());
        assert!(serde_json::from_str::<ObjectId>("\"nope\"").is_err());
    }

    #[test]
    fn object_kind_bytes_round_trip() {
        for kind in [
            ObjectKind::Blob,
            ObjectKind::Chunked,
            ObjectKind::Tree,
            ObjectKind::Save,
            ObjectKind::Commit,
        ] {
            assert_eq!(ObjectKind::from_byte(kind.as_byte()), Some(kind));
        }
        assert_eq!(ObjectKind::from_byte(0), None);
        assert_eq!(ObjectKind::from_byte(6), None);
    }

    #[test]
    fn tree_round_trips_and_is_deterministic() {
        let tree = sample_tree();
        let body = encode_tree(&tree);
        assert_eq!(body, encode_tree(&tree));
        assert_eq!(decode_tree(&body).unwrap(), tree);
        assert_eq!(
            decode_tree(&encode_tree(&TreeObject::default())).unwrap(),
            TreeObject::default()
        );
    }

    #[test]
    fn tree_body_layout_is_fixed() {
        let tree = TreeObject {
            parts: vec![PartEntry {
                kind: PartKind::Track,
                tag: Some("a".into()),
                id: None,
                leaves: vec![LeafEntry {
                    kind: LeafKind::Blob,
                    tag: None,
                    object: ObjectId::from_bytes([7; 32]),
                }],
            }],
        };
        let mut expected = vec![1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, b'a', 0, 1, 0, 0, 0, 1, 0];
        expected.extend([7u8; 32]);
        assert_eq!(encode_tree(&tree), expected);
    }

    #[test]
    fn decode_tree_rejects_unknown_version_and_kinds() {
        let mut body = encode_tree(&sample_tree());
        body[0] = 2;
        assert!(matches!(decode_tree(&body), Err(StoreError::Malformed(_))));

        let mut body = encode_tree(&sample_tree());
        body[5] = 9; // first part's kind
        assert!(matches!(decode_tree(&body), Err(StoreError::Malformed(_))));

        // first leaf's kind: version, part_count, part kind, two absent strings, leaf_count
        let mut body = encode_tree(&sample_tree());
        body[1 + 4 + 1 + 1 + 1 + 4] = 9;
        assert!(matches!(decode_tree(&body), Err(StoreError::Malformed(_))));
    }

    #[test]
    fn decode_tree_rejects_truncation_at_every_length() {
        let body = encode_tree(&sample_tree());
        for len in 0..body.len() {
            assert!(
                matches!(decode_tree(&body[..len]), Err(StoreError::Malformed(_))),
                "a body cut to {len} bytes decoded"
            );
        }
    }

    #[test]
    fn decode_tree_rejects_trailing_bytes() {
        let mut body = encode_tree(&sample_tree());
        body.push(0);
        assert!(matches!(decode_tree(&body), Err(StoreError::Malformed(_))));
    }

    #[test]
    fn decode_tree_rejects_a_string_that_is_not_utf8() {
        // version, one part, Gap, tag of one invalid byte
        let body = [1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0xff];
        assert!(matches!(decode_tree(&body), Err(StoreError::Malformed(_))));
    }

    #[test]
    fn decode_tree_survives_a_huge_declared_count_without_allocating_it() {
        let body = [1, 0xff, 0xff, 0xff, 0xff];
        assert!(matches!(decode_tree(&body), Err(StoreError::Malformed(_))));
    }

    #[test]
    fn chunked_body_is_the_ids_concatenated() {
        let ids = vec![id(1), id(2), id(3)];
        let body = encode_chunked(&ids);
        assert_eq!(body.len(), 96);
        assert_eq!(decode_chunked(&body).unwrap(), ids);
        assert!(decode_chunked(&[]).unwrap().is_empty());
        assert!(matches!(
            decode_chunked(&body[..95]),
            Err(StoreError::Malformed(_))
        ));
    }

    struct Pack(Vec<(ObjectId, ObjectKind, Vec<u8>)>);

    impl ObjectRead for Pack {
        fn get(&self, id: &ObjectId) -> Result<(ObjectKind, Vec<u8>), StoreError> {
            self.0
                .iter()
                .find(|(found, ..)| found == id)
                .map(|(_, kind, body)| (*kind, body.clone()))
                .ok_or(StoreError::Missing(*id))
        }
    }

    fn pack_of(objects: &[(ObjectKind, &[u8])]) -> Pack {
        Pack(
            objects
                .iter()
                .map(|(kind, body)| (ObjectId::of(*kind, body), *kind, body.to_vec()))
                .collect(),
        )
    }

    #[test]
    fn read_leaf_returns_a_blob_body() {
        let pack = pack_of(&[(ObjectKind::Blob, b"abc")]);
        let blob = ObjectId::of(ObjectKind::Blob, b"abc");
        assert_eq!(read_leaf(&pack, &blob).unwrap(), b"abc");
    }

    #[test]
    fn read_leaf_joins_the_chunks_of_a_chunked_object() {
        let a = ObjectId::of(ObjectKind::Blob, b"ab");
        let b = ObjectId::of(ObjectKind::Blob, b"cd");
        let chunked = encode_chunked(&[a, b, a]);
        let pack = pack_of(&[
            (ObjectKind::Blob, b"ab"),
            (ObjectKind::Blob, b"cd"),
            (ObjectKind::Chunked, &chunked),
        ]);
        let id = ObjectId::of(ObjectKind::Chunked, &chunked);
        assert_eq!(read_leaf(&pack, &id).unwrap(), b"abcdab");
    }

    #[test]
    fn read_leaf_rejects_a_non_leaf_and_a_missing_chunk() {
        let tree = encode_tree(&TreeObject::default());
        let missing = encode_chunked(&[id(1)]);
        let pack = pack_of(&[(ObjectKind::Tree, &tree), (ObjectKind::Chunked, &missing)]);
        let tree_id = ObjectId::of(ObjectKind::Tree, &tree);
        assert!(matches!(
            read_leaf(&pack, &tree_id),
            Err(StoreError::Malformed(_))
        ));
        let chunked_id = ObjectId::of(ObjectKind::Chunked, &missing);
        assert_eq!(
            read_leaf(&pack, &chunked_id),
            Err(StoreError::Missing(id(1)))
        );
    }
}
