use std::fs;
use std::path::Path;

use dit_core::{Daw, ObjectId, ObjectKind, ObjectRead, Repo, Save, Store, read_tree_object};
use dit_daw_ableton::Ableton;

use super::*;

const FIXTURE_PROJECT: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../dit-daw-ableton/fixtures/Contract Fixtures Project"
);
const SET: &str = "Arranged Set.als";

fn ableton() -> u32 {
    DAWS.all()
        .iter()
        .position(|daw| daw.id() == "ableton")
        .expect("the registry holds the ableton module") as u32
}

/// The fixture set's document, gunzipped the way the host does before `dit_parse`.
fn fixture_document() -> Vec<u8> {
    let file = fs::read(Path::new(FIXTURE_PROJECT).join(SET)).unwrap();
    Ableton.decode(&file).unwrap()
}

fn parse(daw: u32, xml: &[u8]) -> u32 {
    // SAFETY: `xml` is a live slice of `xml.len()` bytes.
    unsafe { dit_parse(daw, xml.as_ptr(), xml.len()) }
}

fn materialise(daw: u32, pack: &[u8], tree: &ObjectId, side: &ObjectId) -> u32 {
    // SAFETY: `pack` is a live slice of `pack.len()` bytes and each id is 32 live bytes.
    unsafe {
        dit_materialise(
            daw,
            pack.as_ptr(),
            pack.len(),
            tree.as_bytes().as_ptr(),
            side.as_bytes().as_ptr(),
        )
    }
}

/// A result's bytes, read through the pointer and length pair, then freed.
fn take(handle: u32) -> Vec<u8> {
    let (ptr, len) = (dit_result_ptr(handle), dit_result_len(handle));
    // SAFETY: the handle is live, so `ptr` addresses `len` bytes until it is freed.
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec();
    assert_eq!(dit_result_free(handle), 1);
    assert_eq!(dit_last_error(), 0);
    bytes
}

type Records = Vec<(ObjectId, ObjectKind, Vec<u8>)>;

fn encode_pack(records: &Records) -> Vec<u8> {
    let mut pack = Vec::new();
    for (id, kind, body) in records {
        pack.extend_from_slice(id.as_bytes());
        pack.push(kind.as_byte());
        pack.extend_from_slice(&(body.len() as u32).to_le_bytes());
        pack.extend_from_slice(body);
    }
    pack
}

/// Every object a save's tree and side list reach.
fn records_of(store: &Store, save: &Save) -> Records {
    let (tree, side) = save.document().expect("a saved document");
    let mut ids = vec![*tree, *side];
    for part in read_tree_object(store, tree).unwrap().parts {
        for leaf in part.leaves {
            ids.push(leaf.object);
            let (kind, body) = store.get(&leaf.object).unwrap();
            if kind == ObjectKind::Chunked {
                ids.extend(
                    body.chunks_exact(ID_LEN)
                        .map(|chunk| ObjectId::from_bytes(chunk.try_into().unwrap())),
                );
            }
        }
    }
    ids.into_iter()
        .map(|id| {
            let (kind, body) = store.get(&id).unwrap();
            (id, kind, body)
        })
        .collect()
}

/// The fixture recorded into a repo of its own copy of the project.
struct Recorded {
    _dir: tempfile::TempDir,
    save: Save,
    records: Records,
}

fn recorded() -> Recorded {
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path().join("Contract Fixtures Project");
    fs::create_dir(&project).unwrap();
    for entry in fs::read_dir(FIXTURE_PROJECT).unwrap() {
        let entry = entry.unwrap();
        fs::copy(entry.path(), project.join(entry.file_name())).unwrap();
    }
    let repo = Repo::init(&project, &Ableton).unwrap();
    let save = repo.record_save(&project.join(SET)).unwrap().unwrap();
    let save = repo.read_save(&save).unwrap();
    let records = records_of(repo.store(), &save);
    Recorded {
        _dir: dir,
        save,
        records,
    }
}

fn materialise_recorded(records: &Records, save: &Save) -> u32 {
    materialise_pack(ableton(), &encode_pack(records), save)
}

/// `materialise` of `save`'s tree and side list from `pack`.
fn materialise_pack(daw: u32, pack: &[u8], save: &Save) -> u32 {
    let (tree, side) = save.document().expect("a saved document");
    materialise(daw, pack, tree, side)
}

#[test]
fn parse_returns_the_set_meta_json_the_module_produces() {
    let xml = fixture_document();
    let handle = parse(ableton(), &xml);
    assert_ne!(handle, 0);
    let expected = serde_json::to_vec(&Ableton.parse(&xml).unwrap()).unwrap();
    assert_eq!(take(handle), expected);
}

#[test]
fn parse_of_a_document_the_module_rejects_is_error_malformed() {
    assert_eq!(parse(ableton(), b"not a set"), 0);
    assert_eq!(dit_last_error(), ErrorCode::Malformed as u32);
}

#[test]
fn materialise_of_a_stored_save_returns_the_original_document() {
    let Recorded { save, records, .. } = recorded();
    let handle = materialise_recorded(&records, &save);
    assert_ne!(handle, 0);
    assert_eq!(take(handle), fixture_document());
}

#[test]
fn a_truncated_pack_is_error_corrupt() {
    let Recorded { save, records, .. } = recorded();
    let pack = encode_pack(&records);
    for keep in [pack.len() - 1, pack.len() - 40, 20, 1] {
        assert_eq!(materialise_pack(ableton(), &pack[..keep], &save), 0);
        assert_eq!(dit_last_error(), ErrorCode::Corrupt as u32, "kept {keep}");
    }
}

#[test]
fn a_record_whose_body_was_altered_is_error_corrupt() {
    let Recorded {
        save, mut records, ..
    } = recorded();
    let last = records.last_mut().unwrap();
    last.2.push(b'!');
    assert_eq!(materialise_recorded(&records, &save), 0);
    assert_eq!(dit_last_error(), ErrorCode::Corrupt as u32);
}

#[test]
fn a_record_of_an_unknown_kind_is_error_corrupt() {
    let Recorded { save, records, .. } = recorded();
    let mut pack = encode_pack(&records);
    pack[ID_LEN] = 0;
    assert_eq!(materialise_pack(ableton(), &pack, &save), 0);
    assert_eq!(dit_last_error(), ErrorCode::Corrupt as u32);
}

#[test]
fn an_object_missing_from_the_pack_is_error_corrupt() {
    let Recorded {
        save, mut records, ..
    } = recorded();
    records.retain(|(id, _, _)| Some(id) != save.side.as_ref());
    assert_eq!(materialise_recorded(&records, &save), 0);
    assert_eq!(dit_last_error(), ErrorCode::Corrupt as u32);
}

#[test]
fn a_repeated_record_is_read_once() {
    let Recorded {
        save, mut records, ..
    } = recorded();
    records.push(records[0].clone());
    assert_ne!(materialise_recorded(&records, &save), 0);
}

#[test]
fn an_unknown_daw_index_is_error_bad_argument() {
    let Recorded { save, records, .. } = recorded();
    let unknown = DAWS.all().len() as u32;
    assert_eq!(parse(unknown, &fixture_document()), 0);
    assert_eq!(dit_last_error(), ErrorCode::BadArgument as u32);
    assert_eq!(materialise_pack(unknown, &encode_pack(&records), &save), 0);
    assert_eq!(dit_last_error(), ErrorCode::BadArgument as u32);
}

#[test]
fn a_null_pointer_with_a_length_is_error_bad_argument() {
    let id = ObjectId::of(ObjectKind::Blob, b"");
    // SAFETY: every null pointer is refused before it is read.
    unsafe {
        assert_eq!(dit_parse(ableton(), std::ptr::null(), 8), 0);
        assert_eq!(dit_last_error(), ErrorCode::BadArgument as u32);
        let ptr = id.as_bytes().as_ptr();
        assert_eq!(dit_materialise(ableton(), ptr, 0, std::ptr::null(), ptr), 0);
        assert_eq!(dit_last_error(), ErrorCode::BadArgument as u32);
        assert_eq!(dit_materialise(ableton(), ptr, 0, ptr, std::ptr::null()), 0);
        assert_eq!(dit_last_error(), ErrorCode::BadArgument as u32);
        assert_eq!(dit_materialise(ableton(), std::ptr::null(), 8, ptr, ptr), 0);
        assert_eq!(dit_last_error(), ErrorCode::BadArgument as u32);
    }
}

#[test]
fn a_null_pointer_with_no_length_is_empty_input() {
    let id = ObjectId::of(ObjectKind::Blob, b"");
    let ptr = id.as_bytes().as_ptr();
    // SAFETY: a null pointer with length 0 is never read.
    unsafe {
        assert_eq!(dit_parse(ableton(), std::ptr::null(), 0), 0);
        assert_eq!(dit_last_error(), ErrorCode::Malformed as u32);
        assert_eq!(dit_materialise(ableton(), std::ptr::null(), 0, ptr, ptr), 0);
        assert_eq!(dit_last_error(), ErrorCode::Corrupt as u32);
    }
}

#[test]
fn an_unknown_or_freed_handle_is_error_bad_argument() {
    let handle = parse(ableton(), &fixture_document());
    assert_eq!(dit_result_free(handle), 1);
    for unknown in [handle, 0] {
        assert!(dit_result_ptr(unknown).is_null());
        assert_eq!(dit_last_error(), ErrorCode::BadArgument as u32);
        assert_eq!(dit_result_len(unknown), 0);
        assert_eq!(dit_last_error(), ErrorCode::BadArgument as u32);
        assert_eq!(dit_result_free(unknown), 0);
        assert_eq!(dit_last_error(), ErrorCode::BadArgument as u32);
    }
}

#[test]
fn handles_are_never_zero_and_never_shared() {
    let xml = fixture_document();
    let (first, second) = (parse(ableton(), &xml), parse(ableton(), &xml));
    assert!(first != 0 && second != 0 && first != second);
    assert_eq!(dit_result_free(first), 1);
    assert_eq!(take(second), take(parse(ableton(), &xml)));
}

#[test]
fn alloc_hands_out_memory_the_host_can_fill_and_free() {
    let ptr = dit_alloc(64);
    assert!(!ptr.is_null());
    assert_eq!(dit_last_error(), 0);
    // SAFETY: `ptr` addresses 64 bytes `dit_alloc` reserved, and is freed once with the same size.
    unsafe {
        ptr.write_bytes(7, 64);
        assert_eq!(*ptr.add(63), 7);
        dit_free(ptr, 64);
    }
    assert_eq!(dit_last_error(), 0);
}

#[test]
fn alloc_of_nothing_or_of_more_than_memory_is_error_bad_argument() {
    assert!(dit_alloc(0).is_null());
    assert_eq!(dit_last_error(), ErrorCode::BadArgument as u32);
    assert!(dit_alloc(usize::MAX).is_null());
    assert_eq!(dit_last_error(), ErrorCode::BadArgument as u32);
}

#[test]
fn daw_and_store_errors_map_to_their_codes() {
    assert_eq!(
        ErrorCode::from(DawError::Malformed(String::new())),
        ErrorCode::Malformed
    );
    assert_eq!(
        ErrorCode::from(DawError::Corrupt(String::new())),
        ErrorCode::Corrupt
    );
    assert_eq!(
        ErrorCode::from(DawError::Unsupported),
        ErrorCode::Unsupported
    );
    assert_eq!(
        ErrorCode::from(StoreError::Malformed(String::new())),
        ErrorCode::Corrupt
    );
    assert_eq!(dit_abi_version(), ABI_VERSION);
}
