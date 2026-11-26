//! Runs the round trips over every set file a folder of real projects holds, when `DIT_FIXTURE_SETS` names one.
//! Read-only: files are only opened for reading. A set that will not decode (one Live is mid-write on is normal) or
//! does not parse is counted, not failed; a set that decodes but does not split, or whose join or unmask is inexact,
//! fails the test, because every set Live wrote must round-trip. The gzip re-encode
//! comparison ignores byte 9, the OS byte of the machine that saved the set, and is only ever counted.

mod common;

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use common::catch;
use dit_core::{Daw, join, mask_tree, unmask_tree};
use dit_daws::registry;

const VARIABLE: &str = "DIT_FIXTURE_SETS";
const GZIP_OS_BYTE: usize = 9;

/// Every regular file under `dir`, following no symlinks.
fn walk(dir: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            walk(&entry.path(), files);
        } else if kind.is_file() {
            files.push(entry.path());
        }
    }
}

fn equal_but_os_byte(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b)
            .enumerate()
            .all(|(index, (x, y))| index == GZIP_OS_BYTE || x == y)
}

#[derive(Default)]
struct Counts {
    sets: usize,
    decode_failures: usize,
    split_failures: usize,
    exact_joins: usize,
    exact_unmasks: usize,
    parse_failures: usize,
    exact_reencodes: usize,
    inexact: Vec<String>,
}

/// Runs every round trip on one file, recording what it finds in `counts`.
fn sweep_file(daw: &dyn Daw, path: &Path, counts: &mut Counts) {
    counts.sets += 1;
    let shown = path.display().to_string();
    let Ok(file) = fs::read(path) else {
        counts.decode_failures += 1;
        return;
    };
    // A set Live is mid-write on may not decode or parse; a panic is a bug.
    let doc = match catch(|| daw.decode(&file)) {
        Ok(Ok(doc)) => doc,
        Ok(Err(_)) => {
            counts.decode_failures += 1;
            return;
        }
        Err(panic) => {
            counts.decode_failures += 1;
            counts
                .inexact
                .push(format!("{shown}: decode panicked: {panic}"));
            return;
        }
    };

    match catch(|| daw.split(&doc)) {
        Ok(Ok(tree)) => {
            if join(&tree) == doc {
                counts.exact_joins += 1;
            } else {
                counts
                    .inexact
                    .push(format!("{shown}: join differs from the document"));
            }
            let unmasked = catch(|| {
                let (masked, side) = mask_tree(daw, &tree);
                unmask_tree(daw, &masked, &side)
            });
            if matches!(unmasked, Ok(Ok(ref restored)) if *restored == doc) {
                counts.exact_unmasks += 1;
            } else {
                counts
                    .inexact
                    .push(format!("{shown}: unmask differs from the document"));
            }
        }
        _ => {
            counts.split_failures += 1;
            counts
                .inexact
                .push(format!("{shown}: decodes but does not split"));
        }
    }

    match catch(|| daw.parse(&doc)) {
        Ok(Ok(_)) => {}
        Ok(Err(_)) => counts.parse_failures += 1,
        Err(panic) => {
            counts.parse_failures += 1;
            counts
                .inexact
                .push(format!("{shown}: parse panicked: {panic}"));
        }
    }
    if let Ok(Ok(encoded)) = catch(|| daw.encode(&doc))
        && equal_but_os_byte(&encoded, &file)
    {
        counts.exact_reencodes += 1;
    }
}

#[test]
fn sweeps_a_folder_of_real_sets() {
    let Some(root) = std::env::var_os(VARIABLE) else {
        println!("sweep skipped: {VARIABLE} is not set");
        return;
    };
    let registry = registry();
    let mut files = Vec::new();
    walk(Path::new(&root), &mut files);
    files.sort();

    let mut per_daw: BTreeMap<&str, Counts> = BTreeMap::new();
    for daw in registry.all() {
        per_daw.insert(daw.id(), Counts::default());
    }
    for file in &files {
        if let Some(daw) = registry.for_file(file) {
            sweep_file(daw, file, per_daw.get_mut(daw.id()).expect("registered"));
        }
    }

    let mut inexact = Vec::new();
    for (id, counts) in &per_daw {
        println!(
            "{id}: {} sets, {} decode failures, {} split failures, {} exact joins, {} exact unmasks, \
             {} parse failures, {} byte-exact re-encodes (byte {GZIP_OS_BYTE} ignored)",
            counts.sets,
            counts.decode_failures,
            counts.split_failures,
            counts.exact_joins,
            counts.exact_unmasks,
            counts.parse_failures,
            counts.exact_reencodes,
        );
        inexact.extend(counts.inexact.iter().cloned());
    }
    assert!(
        inexact.is_empty(),
        "inexact round trips:\n{}",
        inexact.join("\n")
    );
}
