//! A fake DAW, a fake clock and repo builders for the daemon's tests.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::{Duration, UNIX_EPOCH};

use dit_core::tree::{Leaf, LeafKind, Part, PartKind, Tree};
use dit_core::{Backup, Daw, DawError, Registry, Repo, SampleKind, SampleRef, SetMeta};

use crate::Clock;

pub const MARKER: &[u8] = b"FAKE\n";

/// A DAW whose set file is a marker line then the document, read as one text leaf; `<sample kind="project" path=""
/// rel="Samples/k.wav"/>` lines are its sample references and `<broken/>` makes the document unparseable.
pub struct FakeDaw;

pub static FAKE: FakeDaw = FakeDaw;

impl Daw for FakeDaw {
    fn id(&self) -> &'static str {
        "fake"
    }
    fn display_name(&self) -> &'static str {
        "Fake"
    }
    fn set_extensions(&self) -> &'static [&'static str] {
        &["fset"]
    }
    fn managed_subfolders(&self) -> &'static [&'static str] {
        &["Samples", "Backup"]
    }
    fn is_project_folder(&self, dir: &Path) -> bool {
        dir.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(" Project"))
    }
    fn find_sets(&self, project: &Path) -> std::io::Result<Vec<PathBuf>> {
        let mut sets = Vec::new();
        for entry in fs::read_dir(project)? {
            let path = entry?.path();
            if path.extension().is_some_and(|ext| ext == "fset") && path.is_file() {
                sets.push(path);
            }
        }
        sets.sort();
        Ok(sets)
    }
    fn decode(&self, file: &[u8]) -> Result<Vec<u8>, DawError> {
        file.strip_prefix(MARKER)
            .map(<[u8]>::to_vec)
            .ok_or_else(|| DawError::Corrupt("missing marker".into()))
    }
    fn encode(&self, doc: &[u8]) -> Result<Vec<u8>, DawError> {
        Ok([MARKER, doc].concat())
    }
    fn split(&self, doc: &[u8]) -> Result<Tree, DawError> {
        std::str::from_utf8(doc).map_err(|_| DawError::Malformed("not utf-8".into()))?;
        Ok(Tree {
            parts: vec![Part {
                kind: PartKind::Gap,
                tag: None,
                id: None,
                leaves: vec![Leaf {
                    kind: LeafKind::Text,
                    tag: None,
                    bytes: doc.to_vec(),
                }],
            }],
        })
    }
    /// Moves every `id="<digits>"` value to the side list, as Live's volatile ids are.
    fn mask(&self, text: &[u8], side: &mut Vec<String>) -> Vec<u8> {
        let mut rest = std::str::from_utf8(text).unwrap();
        let mut out = String::new();
        while let Some(at) = rest.find("id=\"") {
            let (head, tail) = rest.split_at(at + 4);
            out.push_str(head);
            let digits = tail.bytes().take_while(|b| b.is_ascii_digit()).count();
            if digits > 0 && tail[digits..].starts_with('"') {
                side.push(tail[..digits].to_string());
                out.push('@');
                rest = &tail[digits..];
            } else {
                rest = tail;
            }
        }
        out.push_str(rest);
        out.into_bytes()
    }
    fn unmask(&self, text: &[u8], side: &[String]) -> Result<(Vec<u8>, usize), DawError> {
        let mut rest =
            std::str::from_utf8(text).map_err(|_| DawError::Malformed("not utf-8".into()))?;
        let (mut used, mut out) = (0, String::new());
        while let Some(at) = rest.find("id=\"@\"") {
            out.push_str(&rest[..at + 4]);
            out.push_str(
                side.get(used)
                    .ok_or_else(|| DawError::Malformed("side list too short".into()))?,
            );
            used += 1;
            rest = &rest[at + 5..];
        }
        out.push_str(rest);
        Ok((out.into_bytes(), used))
    }
    fn parse(&self, doc: &[u8]) -> Result<SetMeta, DawError> {
        if doc.windows(9).any(|w| w == b"<broken/>") {
            return Err(DawError::Malformed("broken".into()));
        }
        Ok(SetMeta::default())
    }
    fn sample_refs(&self, doc: &[u8]) -> Result<Vec<SampleRef>, DawError> {
        let text = String::from_utf8_lossy(doc);
        Ok(text
            .lines()
            .filter(|line| line.starts_with("<sample "))
            .filter_map(|line| {
                let at = line.find("rel=\"")? + 5;
                let rel = line[at..].split('"').next()?.to_string();
                Some(SampleRef {
                    path: rel.clone(),
                    kind: SampleKind::Project,
                    relative: Some(rel),
                    object: None,
                    size: None,
                })
            })
            .collect())
    }
    /// The files `Backup/<set name>-*.fset` beside the set, oldest first by modification time.
    fn list_backups(&self, set: &Path) -> std::io::Result<Vec<Backup>> {
        let (Some(folder), Some(stem)) = (set.parent(), set.file_stem()) else {
            return Ok(Vec::new());
        };
        let entries = match fs::read_dir(folder.join("Backup")) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        let prefix = format!("{}-", stem.to_string_lossy());
        let mut copies = Vec::new();
        for entry in entries {
            let path = entry?.path();
            let named = path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(&prefix) && name.ends_with(".fset"));
            if named {
                let saved_at = fs::metadata(&path)?.modified()?;
                copies.push(Backup { path, saved_at });
            }
        }
        copies.sort_by_key(|copy| copy.saved_at);
        Ok(copies)
    }
    fn project_roots(&self, home: &Path) -> std::io::Result<Vec<PathBuf>> {
        Ok(vec![home.join("Projects")])
    }
    fn app_names(&self) -> &'static [&'static str] {
        &["Fake"]
    }
}

pub fn registry() -> Registry {
    Registry::new(vec![&FAKE]).unwrap()
}

/// A clock the test sets.
#[derive(Clone, Default)]
pub struct FakeClock(pub Arc<AtomicI64>);

impl FakeClock {
    pub fn set(&self, ms: i64) {
        self.0.store(ms, Ordering::SeqCst);
    }
}

impl Clock for FakeClock {
    fn now_ms(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
}

/// A project folder `<temp>/<name> Project`, canonical, with a repo in it.
pub fn project(name: &str) -> (tempfile::TempDir, PathBuf, Repo) {
    let root = tempfile::tempdir().unwrap();
    let dir = root
        .path()
        .canonicalize()
        .unwrap()
        .join(format!("{name} Project"));
    fs::create_dir_all(&dir).unwrap();
    let repo = Repo::init(&dir, &FAKE).unwrap();
    (root, dir, repo)
}

/// Writes a set file with `body` and the modification time `mtime_ms`.
pub fn write_set(path: &Path, body: &str, mtime_ms: i64) {
    fs::write(path, [MARKER, body.as_bytes()].concat()).unwrap();
    set_mtime(path, mtime_ms);
}

pub fn set_mtime(path: &Path, mtime_ms: i64) {
    fs::File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(UNIX_EPOCH + Duration::from_millis(mtime_ms as u64))
        .unwrap();
}

/// A set document referencing `Samples/k.wav`.
pub fn with_sample(tail: &str) -> String {
    format!("<doc>\n<sample kind=\"project\" path=\"k\" rel=\"Samples/k.wav\"/>\n{tail}")
}
