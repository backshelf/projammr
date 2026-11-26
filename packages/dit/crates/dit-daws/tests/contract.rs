//! The checks every registered DAW module passes just by being registered, run against the fixtures it ships in
//! `crates/dit-daw-<id>/fixtures/`. One function per check; each loops over the registry and names the DAW, and the
//! fixture where there is one, in every assertion message.

mod common;

use std::fs;
use std::path::{Path, PathBuf};

use common::catch;
use dit_core::{Daw, join, mask_tree, unmask_tree};
use dit_daws::registry;

/// A fixture is a template a contributor can read, so it stays small.
const MAX_FIXTURE_BYTES: u64 = 200 * 1024;

fn valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    let starts_well = chars
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    starts_well
        && id.len() <= 32
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn fixtures_dir(daw: &dyn Daw) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(format!("dit-daw-{}", daw.id()))
        .join("fixtures")
}

/// The one subfolder of the DAW's fixtures folder that the DAW accepts as a project folder.
fn fixture_project(daw: &dyn Daw) -> PathBuf {
    let dir = fixtures_dir(daw);
    let expected = format!(
        "{}: expected a project folder inside {}",
        daw.id(),
        dir.display()
    );
    let entries = fs::read_dir(&dir).unwrap_or_else(|error| panic!("{expected} ({error})"));
    entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| daw.is_project_folder(path))
        .unwrap_or_else(|| panic!("{expected}"))
}

fn fixture_sets(daw: &dyn Daw) -> Vec<PathBuf> {
    let project = fixture_project(daw);
    let sets = sets_in(daw, &project);
    assert!(
        !sets.is_empty(),
        "{}: find_sets found no sets in {}",
        daw.id(),
        project.display()
    );
    sets
}

fn sets_in(daw: &dyn Daw, project: &Path) -> Vec<PathBuf> {
    daw.find_sets(project)
        .unwrap_or_else(|error| panic!("{}: find_sets on {}: {error}", daw.id(), project.display()))
}

fn label(daw: &dyn Daw, fixture: &Path) -> String {
    format!(
        "{} on {}",
        daw.id(),
        fixture.file_name().unwrap_or_default().to_string_lossy()
    )
}

fn read(daw: &dyn Daw, fixture: &Path) -> Vec<u8> {
    fs::read(fixture).unwrap_or_else(|error| panic!("{}: reading: {error}", label(daw, fixture)))
}

/// A fixture's decoded document.
fn document(daw: &dyn Daw, fixture: &Path) -> Vec<u8> {
    let file = read(daw, fixture);
    must(&label(daw, fixture), "decode", || daw.decode(&file))
        .unwrap_or_else(|error| panic!("{}: decode failed: {error}", label(daw, fixture)))
}

/// Runs a module call, reporting a panic as one that names the DAW and the call.
fn must<T>(label: &str, call: &str, run: impl FnOnce() -> T) -> T {
    catch(run).unwrap_or_else(|message| panic!("{label}: {call} panicked: {message}"))
}

/// A folder holding a copy of every top-level file of `project`, named like it.
fn copy_project(project: &Path, into: &Path) -> PathBuf {
    let copy = into.join(project.file_name().expect("a project folder has a name"));
    fs::create_dir(&copy).expect("create the project copy");
    for entry in fs::read_dir(project).expect("read the fixture project") {
        let path = entry.expect("read a fixture entry").path();
        if path.is_file() {
            fs::copy(
                &path,
                copy.join(path.file_name().expect("a file has a name")),
            )
            .expect("copy a fixture");
        }
    }
    copy
}

fn garbage() -> Vec<u8> {
    (0..64u8)
        .map(|i| i.wrapping_mul(37).wrapping_add(151))
        .collect()
}

#[test]
fn declares_an_identity_the_server_will_accept() {
    for daw in registry().all() {
        let id = daw.id();
        assert!(
            valid_id(id),
            "{id}: id must match ^[a-z0-9][a-z0-9-]{{0,31}}$"
        );
        assert!(
            !daw.display_name().trim().is_empty(),
            "{id}: display name is empty"
        );
        assert!(
            !daw.set_extensions().is_empty(),
            "{id}: declares no set extension"
        );
        for extension in daw.set_extensions() {
            assert!(
                !extension.is_empty()
                    && !extension.contains('.')
                    && *extension == extension.to_lowercase(),
                "{id}: extension `{extension}` must be lowercase without a dot"
            );
        }
    }
}

#[test]
fn declares_managed_subfolders_and_a_project_folder_rule() {
    let root = tempfile::tempdir().unwrap();
    for daw in registry().all() {
        let id = daw.id();
        assert!(
            !daw.managed_subfolders().is_empty(),
            "{id}: declares no managed subfolders"
        );
        for subfolder in daw.managed_subfolders() {
            assert!(
                !subfolder.trim().is_empty(),
                "{id}: a managed subfolder name is empty"
            );
        }
        assert!(
            !daw.is_project_folder(root.path()),
            "{id}: accepts a plain temp folder as a project folder"
        );
    }
}

#[test]
fn ships_a_fixture_project_with_small_sets() {
    for daw in registry().all() {
        for set in fixture_sets(*daw) {
            let size = fs::metadata(&set).unwrap().len();
            assert!(
                size <= MAX_FIXTURE_BYTES,
                "{}: is {size} bytes, over the {MAX_FIXTURE_BYTES} limit for a fixture",
                label(*daw, &set)
            );
        }
    }
}

#[test]
fn finds_only_files_with_its_own_extensions() {
    let registry = registry();
    for daw in registry.all() {
        let id = daw.id();
        let project = fixture_project(*daw);
        let expected = fixture_sets(*daw);
        let root = tempfile::tempdir().unwrap();
        let copy = copy_project(&project, root.path());
        for foreign in ["notes.txt", "bounce.wav", "song", "._hidden.als"] {
            fs::write(copy.join(foreign), b"").unwrap();
        }
        let backup = copy.join(daw.managed_subfolders()[0]);
        fs::create_dir(&backup).unwrap();
        fs::write(backup.join("nested.als"), b"").unwrap();

        let found = sets_in(*daw, &copy);
        for set in &found {
            let claimed = registry.for_file(set).map(|owner| owner.id());
            assert_eq!(
                claimed,
                Some(id),
                "{id}: found `{}`, which is not one of its own extensions",
                set.display()
            );
        }
        let names = |paths: &[PathBuf]| -> Vec<_> {
            paths
                .iter()
                .map(|path| path.file_name().unwrap().to_owned())
                .collect()
        };
        assert_eq!(
            names(&found),
            names(&expected),
            "{id}: find_sets on a copy of the fixture project with foreign files added"
        );
    }
}

#[test]
fn splits_and_joins_every_fixture_exactly() {
    for daw in registry().all() {
        for set in fixture_sets(*daw) {
            let label = label(*daw, &set);
            let doc = document(*daw, &set);
            let tree = must(&label, "split", || daw.split(&doc))
                .unwrap_or_else(|error| panic!("{label}: split failed: {error}"));
            assert!(
                join(&tree) == doc,
                "{label}: join(split(doc)) differs from doc"
            );
        }
    }
}

#[test]
fn masks_and_unmasks_every_fixture_exactly() {
    for daw in registry().all() {
        for set in fixture_sets(*daw) {
            let label = label(*daw, &set);
            let doc = document(*daw, &set);
            let tree = must(&label, "split", || daw.split(&doc))
                .unwrap_or_else(|error| panic!("{label}: split failed: {error}"));
            let (masked, side) = must(&label, "mask", || mask_tree(*daw, &tree));
            let restored = must(&label, "unmask", || unmask_tree(*daw, &masked, &side))
                .unwrap_or_else(|error| panic!("{label}: unmask failed: {error}"));
            assert!(
                restored == doc,
                "{label}: unmask_tree(mask_tree(tree)) differs from doc"
            );
        }
    }
}

#[test]
fn parses_every_fixture() {
    for daw in registry().all() {
        for set in fixture_sets(*daw) {
            let label = label(*daw, &set);
            let doc = document(*daw, &set);
            must(&label, "parse", || daw.parse(&doc))
                .unwrap_or_else(|error| panic!("{label}: parse failed: {error}"));
        }
    }
}

#[test]
fn decodes_what_it_encodes_for_every_fixture() {
    for daw in registry().all() {
        for set in fixture_sets(*daw) {
            let label = label(*daw, &set);
            let doc = document(*daw, &set);
            let file = must(&label, "encode", || daw.encode(&doc))
                .unwrap_or_else(|error| panic!("{label}: encode failed: {error}"));
            let back = must(&label, "decode", || daw.decode(&file)).unwrap_or_else(|error| {
                panic!("{label}: decode of its own encode failed: {error}")
            });
            assert!(back == doc, "{label}: decode(encode(doc)) differs from doc");
        }
    }
}

// Garbage decode and split are checked for a panic only: a module may pass unrecognised bytes through as a plain
// document (Ableton reads a set that is plain XML), and a document with no markup has nothing to split wrongly.

#[test]
fn decode_rejects_empty_and_truncated_files_and_survives_garbage() {
    for daw in registry().all() {
        for set in fixture_sets(*daw) {
            let label = label(*daw, &set);
            let file = read(*daw, &set);
            let empty = must(&label, "decode", || daw.decode(&[]));
            assert!(empty.is_err(), "{label}: decode accepted an empty file");
            let half = must(&label, "decode", || daw.decode(&file[..file.len() / 2]));
            assert!(
                half.is_err(),
                "{label}: decode accepted the first half of the file"
            );
            let _ = must(&label, "decode", || daw.decode(&garbage()));
        }
    }
}

#[test]
fn split_rejects_a_truncated_document_and_survives_empty_and_garbage() {
    for daw in registry().all() {
        for set in fixture_sets(*daw) {
            let label = label(*daw, &set);
            let doc = document(*daw, &set);
            let half = must(&label, "split", || daw.split(&doc[..doc.len() / 2]));
            assert!(
                half.is_err(),
                "{label}: split accepted the first half of the document"
            );
            let _ = must(&label, "split", || daw.split(&[]));
            let _ = must(&label, "split", || daw.split(&garbage()));
        }
    }
}

#[test]
fn parse_rejects_empty_truncated_and_garbage_documents() {
    for daw in registry().all() {
        for set in fixture_sets(*daw) {
            let label = label(*daw, &set);
            let doc = document(*daw, &set);
            let inputs = [
                ("an empty document", Vec::new()),
                (
                    "the first half of the document",
                    doc[..doc.len() / 2].to_vec(),
                ),
                ("64 bytes of garbage", garbage()),
            ];
            for (what, input) in inputs {
                let parsed = must(&label, "parse", || daw.parse(&input));
                assert!(parsed.is_err(), "{label}: parse accepted {what}");
            }
        }
    }
}

#[test]
fn lists_no_backups_for_a_project_without_a_backup_folder() {
    for daw in registry().all() {
        let root = tempfile::tempdir().unwrap();
        let copy = copy_project(&fixture_project(*daw), root.path());
        for set in sets_in(*daw, &copy) {
            let label = label(*daw, &set);
            let backups = must(&label, "list_backups", || daw.list_backups(&set))
                .unwrap_or_else(|error| panic!("{label}: list_backups failed: {error}"));
            assert!(
                backups.is_empty(),
                "{label}: list_backups found {} backups in a project with none",
                backups.len()
            );
        }
    }
}

#[test]
fn reads_the_samples_a_fixture_references_without_panicking() {
    for daw in registry().all() {
        for set in fixture_sets(*daw) {
            let doc = document(*daw, &set);
            let name = label(*daw, &set);
            let refs = must(&name, "sample_refs", || daw.sample_refs(&doc))
                .unwrap_or_else(|error| panic!("{name}: sample_refs failed: {error}"));
            let meta = daw
                .parse(&doc)
                .unwrap_or_else(|error| panic!("{name}: parse failed: {error}"));
            let paths: Vec<&str> = refs.iter().map(|sample| sample.path.as_str()).collect();
            let mut distinct = paths.clone();
            distinct.sort_unstable();
            distinct.dedup();
            assert_eq!(distinct.len(), paths.len(), "{name}: a path listed twice");
            assert_eq!(
                paths,
                meta.sample_paths.unwrap_or_default(),
                "{name}: sample_refs and meta.samplePaths disagree on a small set"
            );
            for sample in &refs {
                assert!(
                    sample.object.is_none() && sample.size.is_none(),
                    "{name}: a module never fills a ref's object or size"
                );
            }
        }
    }
}
