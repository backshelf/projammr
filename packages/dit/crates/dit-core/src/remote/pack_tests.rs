use std::cell::RefCell;
use std::collections::HashMap;

use sha2::{Digest, Sha256};
use tempfile::TempDir;

use super::pack::{
    LeafObjects, MAX_OBJECT_BYTES, PACK_TARGET_BYTES, PackError, PackLimit, Place, object_sizes,
    packs, save_objects, save_objects_cached,
};
use crate::repo::Save;
use crate::store::{
    LEAF_INLINE_MAX, LeafEntry, ObjectId, ObjectKind, ObjectRead, PartEntry, Store, StoreError,
    TreeObject, decode_chunked, encode_tree,
};
use crate::tree::{LeafKind, PartKind};

const HEADER: usize = 32 + 1 + 4;

fn store() -> (TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("objects")).unwrap();
    (dir, store)
}

fn noise(len: usize, seed: u32) -> Vec<u8> {
    let mut x = seed;
    (0..len)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            (x >> 24) as u8
        })
        .collect()
}

fn save(tree: ObjectId, side: ObjectId) -> Save {
    Save {
        set_id: "set".to_string(),
        branch: "main".to_string(),
        xml_hash: Some("0".repeat(64)),
        tree: Some(tree),
        side: Some(side),
        raw: None,
        file_updated_at: 0,
        machine: "Studio".to_string(),
        meta: None,
        view_only: false,
        unreadable: false,
        samples: Vec::new(),
    }
}

fn part(leaves: &[ObjectId]) -> PartEntry {
    PartEntry {
        kind: PartKind::Track,
        tag: None,
        id: None,
        leaves: leaves
            .iter()
            .map(|object| LeafEntry {
                kind: LeafKind::Blob,
                tag: None,
                object: *object,
            })
            .collect(),
    }
}

fn put_tree(store: &Store, parts: Vec<PartEntry>) -> ObjectId {
    store
        .put(ObjectKind::Tree, &encode_tree(&TreeObject { parts }))
        .unwrap()
}

/// A save over two parts: a small leaf and a large (Chunked) leaf, then the small leaf again.
struct Fixture {
    _dir: TempDir,
    store: Store,
    save: Save,
    small: ObjectId,
    large: ObjectId,
    chunks: Vec<ObjectId>,
    tree: ObjectId,
    side: ObjectId,
}

fn fixture() -> Fixture {
    let (dir, store) = store();
    let small = store.put_leaf(b"a small leaf").unwrap();
    let large = store
        .put_leaf(&noise(LEAF_INLINE_MAX * 3, 0x1234_5678))
        .unwrap();
    let (kind, body) = store.get(&large).unwrap();
    assert_eq!(kind, ObjectKind::Chunked);
    let chunks = decode_chunked(&body).unwrap();
    assert!(chunks.len() > 1);
    let tree = put_tree(&store, vec![part(&[small, large]), part(&[small])]);
    let side = store.put(ObjectKind::Blob, b"[\"side\"]").unwrap();
    let save = save(tree, side);
    Fixture {
        _dir: dir,
        store,
        save,
        small,
        large,
        chunks,
        tree,
        side,
    }
}

/// A pack's records parsed back, checked the way the instance checks them.
fn parse(pack: &[u8], store: &Store) -> Vec<(ObjectId, ObjectKind)> {
    let mut records = Vec::new();
    let mut rest = pack;
    while !rest.is_empty() {
        let id = ObjectId::from_bytes(rest[..32].try_into().unwrap());
        let kind = ObjectKind::from_byte(rest[32]).unwrap();
        let length = u32::from_le_bytes(rest[33..37].try_into().unwrap()) as usize;
        let frame = &rest[HEADER..HEADER + length];
        let content = zstd::decode_all(frame).unwrap();
        assert_eq!(content[0], kind.as_byte(), "frame starts with the kind");
        assert_eq!(
            Sha256::digest(&content).as_slice(),
            id.as_bytes(),
            "frame hashes to the id"
        );
        assert_eq!(frame, store.raw(&id).unwrap(), "frame is the stored file");
        records.push((id, kind));
        rest = &rest[HEADER + length..];
    }
    records
}

#[test]
fn a_saves_objects_are_its_tree_side_and_every_leaf_object_once_in_order() {
    let f = fixture();

    let objects = save_objects(&f.store, &f.save).unwrap();

    let mut expected = vec![
        (f.tree, ObjectKind::Tree),
        (f.side, ObjectKind::Blob),
        (f.small, ObjectKind::Blob),
        (f.large, ObjectKind::Chunked),
    ];
    expected.extend(f.chunks.iter().map(|chunk| (*chunk, ObjectKind::Blob)));
    assert_eq!(objects, expected);
}

#[test]
fn the_sample_objects_of_saves_are_every_sample_leaf_object_once_and_not_the_saves_own() {
    let f = fixture();
    let sample = |object| crate::meta::SampleRef {
        path: "kick.wav".to_string(),
        kind: crate::meta::SampleKind::Project,
        relative: None,
        object,
        size: None,
    };
    let mut sampled = f.save.clone();
    sampled.samples = vec![sample(Some(f.large)), sample(Some(f.large)), sample(None)];

    let sizes = super::pack::sample_object_sizes(&f.store, &[sampled.clone(), sampled]).unwrap();

    let mut expected = vec![f.large];
    expected.extend(&f.chunks);
    let listed: Vec<_> = sizes.iter().map(|(id, _)| *id).collect();
    assert_eq!(listed, expected);
    for (id, size) in &sizes {
        assert_eq!(*size, f.store.frame_len(id).unwrap());
    }
    assert!(
        super::pack::sample_object_sizes(&f.store, std::slice::from_ref(&f.save))
            .unwrap()
            .is_empty()
    );
}

#[test]
fn a_leaf_named_twice_is_listed_once() {
    let (_dir, store) = store();
    let large = store.put_leaf(&noise(LEAF_INLINE_MAX * 2, 7)).unwrap();
    let tree = put_tree(&store, vec![part(&[large, large])]);
    let side = store.put(ObjectKind::Blob, b"[]").unwrap();

    let objects = save_objects(&store, &save(tree, side)).unwrap();

    let unique: std::collections::HashSet<_> = objects.iter().map(|(id, _)| *id).collect();
    assert_eq!(unique.len(), objects.len());
}

#[test]
fn a_leaf_that_is_neither_a_blob_nor_chunked_is_malformed() {
    let (_dir, store) = store();
    let stray = put_tree(&store, vec![]);
    let tree = put_tree(&store, vec![part(&[stray])]);
    let side = store.put(ObjectKind::Blob, b"[]").unwrap();

    let error = save_objects(&store, &save(tree, side)).unwrap_err();

    assert!(matches!(error, StoreError::Malformed(_)));
}

#[test]
fn a_missing_leaf_object_is_reported_missing() {
    let (_dir, store) = store();
    let absent = ObjectId::of(ObjectKind::Blob, b"never stored");
    let tree = put_tree(&store, vec![part(&[absent])]);
    let side = store.put(ObjectKind::Blob, b"[]").unwrap();

    assert_eq!(
        save_objects(&store, &save(tree, side)),
        Err(StoreError::Missing(absent))
    );
}

#[test]
fn one_big_limit_makes_one_pack_of_verified_records() {
    let f = fixture();
    let objects = save_objects(&f.store, &f.save).unwrap();

    let packs: Vec<_> = packs(&f.store, &objects, usize::MAX)
        .collect::<Result<_, _>>()
        .unwrap();

    assert_eq!(packs.len(), 1);
    assert_eq!(parse(&packs[0], &f.store), objects);
}

#[test]
fn a_small_limit_splits_packs_under_it_with_every_record_once_in_order() {
    let f = fixture();
    let objects = save_objects(&f.store, &f.save).unwrap();
    let biggest = objects
        .iter()
        .map(|(id, _)| HEADER + f.store.raw(id).unwrap().len())
        .max()
        .unwrap();
    let limit = biggest + 100;

    let packs: Vec<_> = packs(&f.store, &objects, limit)
        .collect::<Result<_, _>>()
        .unwrap();

    assert!(packs.len() > 1);
    assert!(packs.iter().all(|pack| pack.len() <= limit));
    let records: Vec<_> = packs
        .iter()
        .flat_map(|pack| parse(pack, &f.store))
        .collect();
    assert_eq!(records, objects);
}

#[test]
fn a_record_that_alone_is_over_the_limit_is_too_big() {
    let f = fixture();
    let objects = save_objects(&f.store, &f.save).unwrap();
    let limit = HEADER + f.store.raw(&f.side).unwrap().len();
    let mut results = packs(&f.store, &objects, limit);

    let error = results
        .find_map(Result::err)
        .expect("a chunk is over the limit");

    let PackError::TooBig {
        bytes, limit: over, ..
    } = &error
    else {
        panic!("expected TooBig, got {error:?}");
    };
    assert!(*bytes > limit);
    assert_eq!(*over, limit);
    assert!(error.to_string().contains(&limit.to_string()));
    assert!(error.to_string().contains("admin can raise"));
    assert!(results.next().is_none(), "the iteration ends at the error");
}

#[test]
fn a_missing_object_is_a_store_error() {
    let (_dir, store) = store();
    let absent = ObjectId::of(ObjectKind::Blob, b"never stored");
    let objects = [(absent, ObjectKind::Blob)];

    let error = packs(&store, &objects, usize::MAX)
        .next()
        .unwrap()
        .unwrap_err();

    assert_eq!(error, PackError::Store(StoreError::Missing(absent)));
}

#[test]
fn an_object_over_the_instance_object_limit_is_too_big_and_names_it() {
    let (_dir, store) = store();
    // Incompressible, so the stored frame is itself over the limit.
    let id = store
        .put(ObjectKind::Blob, &noise(MAX_OBJECT_BYTES + 1024, 99))
        .unwrap();
    let objects = [(id, ObjectKind::Blob)];

    let error = packs(&store, &objects, usize::MAX)
        .next()
        .unwrap()
        .unwrap_err();

    assert!(matches!(
        error,
        PackError::TooBig {
            limit: MAX_OBJECT_BYTES,
            ..
        }
    ));
    assert!(error.to_string().contains(&MAX_OBJECT_BYTES.to_string()));
}

/// Writes `frame` as the stored file of a fresh id, which need not hash to it: a pack only measures a frame.
fn plant(dir: &TempDir, store: &Store, name: &[u8], frame: &[u8]) -> ObjectId {
    let id = ObjectId::of(ObjectKind::Blob, name);
    let hex = id.to_string();
    let shard = dir.path().join("objects").join(&hex[..2]);
    std::fs::create_dir_all(&shard).unwrap();
    std::fs::write(shard.join(&hex), frame).unwrap();
    assert_eq!(store.raw(&id).unwrap(), frame);
    id
}

fn first_error(store: &Store, id: ObjectId, max_bytes: usize) -> PackError {
    let objects = [(id, ObjectKind::Blob)];
    packs(store, &objects, max_bytes)
        .next()
        .unwrap()
        .unwrap_err()
}

#[test]
fn an_object_whose_record_is_over_the_upload_limit_says_it_is_the_upload_limit() {
    let (_dir, store) = store();
    let id = store.put(ObjectKind::Blob, b"a small object").unwrap();
    let record = HEADER + store.raw(&id).unwrap().len();

    let error = first_error(&store, id, record - 1);

    assert_eq!(
        error,
        PackError::TooBig {
            id,
            which: PackLimit::UploadLimit,
            bytes: record,
            exact: true,
            limit: record - 1,
            place: None,
        }
    );
    let message = error.to_string();
    assert!(message.contains(&id.to_string()));
    assert!(message.contains(&format!("{record} bytes")));
    assert!(message.contains("admin can raise"));
    assert!(!message.contains("It is in save"));
}

#[test]
fn an_object_over_the_object_limit_says_it_is_the_object_limit_not_the_upload_limit() {
    let (_dir, store) = store();
    let id = store
        .put(ObjectKind::Blob, &noise(MAX_OBJECT_BYTES + 1024, 5))
        .unwrap();
    let frame = store.raw(&id).unwrap().len();

    let error = first_error(&store, id, usize::MAX);

    assert_eq!(
        error,
        PackError::TooBig {
            id,
            which: PackLimit::ObjectLimit,
            bytes: frame,
            exact: true,
            limit: MAX_OBJECT_BYTES,
            place: None,
        }
    );
    let message = error.to_string();
    assert!(message.contains("the most one object may take"));
    assert!(!message.contains("admin can raise"));
}

#[test]
fn a_too_big_error_names_the_save_and_set_it_was_listed_from() {
    let (_dir, store) = store();
    let id = store.put(ObjectKind::Blob, b"a small object").unwrap();
    let from = ObjectId::of(ObjectKind::Blob, b"the save");

    let error = first_error(&store, id, 1).at("set-9", from);

    let PackError::TooBig { place, .. } = &error else {
        panic!("expected TooBig, got {error:?}");
    };
    assert_eq!(
        place,
        &Some(Place {
            set_id: "set-9".to_string(),
            save: from,
        })
    );
    assert!(
        error
            .to_string()
            .ends_with(&format!("It is in save {from} of set set-9."))
    );
}

#[test]
fn naming_where_an_error_came_from_leaves_other_errors_alone() {
    let absent = ObjectId::of(ObjectKind::Blob, b"never stored");
    let error = PackError::Store(StoreError::Missing(absent));

    let located = error
        .clone()
        .at("set-9", ObjectId::of(ObjectKind::Blob, b"the save"));

    assert_eq!(located, error);
}

#[test]
fn a_frame_declaring_a_size_over_the_object_limit_is_refused_by_its_declared_size() {
    let (dir, store) = store();
    let content = vec![0u8; MAX_OBJECT_BYTES * 2];
    let frame = zstd::bulk::Compressor::new(3)
        .unwrap()
        .compress(&content)
        .unwrap();
    assert_eq!(
        zstd::zstd_safe::get_frame_content_size(&frame).unwrap(),
        Some(content.len() as u64),
        "the frame declares its size"
    );
    let id = plant(&dir, &store, b"declared", &frame);

    let error = first_error(&store, id, usize::MAX);

    assert_eq!(
        error,
        PackError::TooBig {
            id,
            which: PackLimit::ObjectLimit,
            bytes: MAX_OBJECT_BYTES * 2,
            exact: true,
            limit: MAX_OBJECT_BYTES,
            place: None,
        }
    );
    assert!(
        error
            .to_string()
            .contains(&format!("is {} bytes, over", MAX_OBJECT_BYTES * 2))
    );
}

#[test]
fn a_frame_declaring_no_size_that_decodes_past_the_object_limit_is_refused_by_counting() {
    let (dir, store) = store();
    let frame = zstd::encode_all(&vec![0u8; MAX_OBJECT_BYTES * 2][..], 3).unwrap();
    assert!(frame.len() < MAX_OBJECT_BYTES, "the frame itself is small");
    assert_eq!(
        zstd::zstd_safe::get_frame_content_size(&frame).unwrap(),
        None,
        "the frame declares no size"
    );
    let id = plant(&dir, &store, b"undeclared", &frame);

    let error = first_error(&store, id, usize::MAX);

    assert_eq!(
        error,
        PackError::TooBig {
            id,
            which: PackLimit::ObjectLimit,
            bytes: MAX_OBJECT_BYTES + 1,
            exact: false,
            limit: MAX_OBJECT_BYTES,
            place: None,
        }
    );
    assert!(error.to_string().starts_with(&format!(
        "Object {id} is over the {MAX_OBJECT_BYTES}-byte limit"
    )));
}

#[test]
fn an_object_the_store_writes_declares_its_size_so_a_push_need_not_decode_it() {
    let (_dir, store) = store();
    let body = b"a small object".repeat(100);
    let id = store.put(ObjectKind::Blob, &body).unwrap();

    let frame = store.raw(&id).unwrap();

    assert_eq!(
        zstd::zstd_safe::get_frame_content_size(&frame).unwrap(),
        Some(body.len() as u64 + 1),
        "the kind byte and the body"
    );
}

#[test]
fn a_frame_that_is_not_zstd_is_a_corrupt_object() {
    let (dir, store) = store();
    let id = plant(&dir, &store, b"garbage", b"not a zstd frame at all");

    let error = first_error(&store, id, usize::MAX);

    assert_eq!(error, PackError::Store(StoreError::Corrupt(id)));
}

#[test]
fn packs_close_at_the_target_size_even_when_the_upload_limit_allows_more() {
    let (_dir, store) = store();
    let mib = 1024 * 1024;
    let objects: Vec<_> = (0..3)
        .map(|seed| {
            let id = store
                .put(ObjectKind::Blob, &noise(20 * mib, 40 + seed))
                .unwrap();
            (id, ObjectKind::Blob)
        })
        .collect();

    let packs: Vec<_> = packs(&store, &objects, usize::MAX)
        .collect::<Result<_, _>>()
        .unwrap();

    assert_eq!(packs.len(), 3, "no two 20 MiB records fit one pack");
    assert!(packs.iter().all(|pack| pack.len() <= PACK_TARGET_BYTES));
    let records: Vec<_> = packs.iter().flat_map(|pack| parse(pack, &store)).collect();
    assert_eq!(records, objects);
}

#[test]
fn a_record_over_the_target_size_goes_alone_in_its_pack() {
    let (_dir, store) = store();
    let mib = 1024 * 1024;
    let big = store
        .put(ObjectKind::Blob, &noise(PACK_TARGET_BYTES + mib, 77))
        .unwrap();
    let small = store.put(ObjectKind::Blob, b"after the big one").unwrap();
    let objects = [
        (small, ObjectKind::Blob),
        (big, ObjectKind::Blob),
        (small, ObjectKind::Blob),
    ];

    let packs: Vec<_> = packs(&store, &objects, usize::MAX)
        .collect::<Result<_, _>>()
        .unwrap();

    let records: Vec<Vec<_>> = packs.iter().map(|pack| parse(pack, &store)).collect();
    assert_eq!(
        records,
        [
            vec![(small, ObjectKind::Blob)],
            vec![(big, ObjectKind::Blob)],
            vec![(small, ObjectKind::Blob)],
        ]
    );
    assert!(packs[1].len() > PACK_TARGET_BYTES);
}

/// An object source that counts how often each object is read.
struct Counting<'a> {
    store: &'a Store,
    gets: RefCell<HashMap<ObjectId, usize>>,
}

impl ObjectRead for Counting<'_> {
    fn get(&self, id: &ObjectId) -> Result<(ObjectKind, Vec<u8>), StoreError> {
        *self.gets.borrow_mut().entry(*id).or_default() += 1;
        self.store.get(id)
    }
}

#[test]
fn a_leaf_is_read_once_however_many_saves_name_it() {
    let f = fixture();
    let source = Counting {
        store: &f.store,
        gets: RefCell::default(),
    };
    let mut leaves = LeafObjects::default();

    let first = save_objects_cached(&source, &f.save, &mut leaves).unwrap();
    let second = save_objects_cached(&source, &f.save, &mut leaves).unwrap();

    assert_eq!(first, save_objects(&f.store, &f.save).unwrap());
    assert_eq!(second, first);
    let gets = source.gets.borrow();
    assert_eq!(gets[&f.small], 1, "named in two parts of two saves");
    assert_eq!(gets[&f.large], 1);
    assert_eq!(gets[&f.tree], 2, "the tree is read for each save");
    assert!(
        f.chunks.iter().all(|chunk| !gets.contains_key(chunk)),
        "a Chunked leaf lists its chunks without reading them"
    );
}

#[test]
fn object_sizes_lists_each_object_once_across_saves_with_its_frame_length() {
    let f = fixture();
    let extra = f
        .store
        .put_leaf(b"a leaf only the second save has")
        .unwrap();
    let tree = put_tree(&f.store, vec![part(&[f.small, extra])]);
    let side = f.store.put(ObjectKind::Blob, b"[\"other side\"]").unwrap();
    let second = save(tree, side);

    let sizes = object_sizes(&f.store, &[f.save.clone(), second.clone()]).unwrap();

    let mut expected = save_objects(&f.store, &f.save).unwrap();
    for (id, kind) in save_objects(&f.store, &second).unwrap() {
        if !expected.iter().any(|(seen, _)| *seen == id) {
            expected.push((id, kind));
        }
    }
    assert_eq!(
        sizes.iter().map(|(id, _)| *id).collect::<Vec<_>>(),
        expected.iter().map(|(id, _)| *id).collect::<Vec<_>>()
    );
    assert!(sizes.iter().any(|(id, _)| *id == extra));
    assert_eq!(
        sizes.iter().filter(|(id, _)| *id == f.small).count(),
        1,
        "the shared leaf is listed once"
    );
    for (id, size) in sizes {
        assert_eq!(size, f.store.raw(&id).unwrap().len() as u64);
    }
}

#[test]
fn frame_len_of_a_missing_object_is_missing() {
    let (_dir, store) = store();
    let id = ObjectId::from_bytes([7; 32]);

    assert!(matches!(store.frame_len(&id), Err(StoreError::Missing(missing)) if missing == id));
}

#[test]
fn no_objects_make_no_packs() {
    let (_dir, store) = store();

    assert_eq!(packs(&store, &[], 1024).count(), 0);
}
