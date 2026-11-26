//! A test DAW and the helpers that build repos with it, for the repo's tests and for anything else whose tests need
//! real repos with saves and commits.

use std::fs;
use std::path::{Path, PathBuf};

use super::{CommitKind, Repo};
use crate::daw::{Backup, Daw, DawError, Registry};
use crate::meta::{SampleKind, SampleRef, SetMeta};
use crate::store::ObjectId;
use crate::tree::{Leaf, LeafKind, Part, PartKind, Tree};

pub(crate) const MARKER: &[u8] = b"TEST\n";

/// A DAW whose set file is a marker line then the document. The document is
/// split into a head and a tail of text leaves and, from `<blob>` on, one Blob
/// leaf. Masking moves every `id="<digits>"` value to the side list.
pub(crate) struct TestDaw {
    id: &'static str,
    extensions: &'static [&'static str],
}

pub(crate) static TEST_DAW: TestDaw = TestDaw {
    id: "test",
    extensions: &["tset"],
};
pub(crate) static OTHER_DAW: TestDaw = TestDaw {
    id: "other",
    extensions: &["oth"],
};

fn malformed(text: &str) -> DawError {
    DawError::Malformed(text.to_string())
}

impl Daw for TestDaw {
    fn id(&self) -> &'static str {
        self.id
    }
    fn display_name(&self) -> &'static str {
        "Test"
    }
    fn set_extensions(&self) -> &'static [&'static str] {
        self.extensions
    }
    fn managed_subfolders(&self) -> &'static [&'static str] {
        &[]
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
            let known = path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| self.extensions.contains(&ext));
            if known && path.is_file() {
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
        let text = std::str::from_utf8(doc).map_err(|_| malformed("not utf-8"))?;
        let (text, blob) = match text.find("<blob>") {
            Some(at) => text.split_at(at),
            None => (text, ""),
        };
        let (head, rest) = text.split_at(text.find('\n').map_or(text.len(), |at| at + 1));
        let leaf = |kind, bytes: &str| Leaf {
            kind,
            tag: None,
            bytes: bytes.as_bytes().to_vec(),
        };
        Ok(Tree {
            parts: vec![
                Part {
                    kind: PartKind::Gap,
                    tag: None,
                    id: None,
                    leaves: vec![leaf(LeafKind::Text, head)],
                },
                Part {
                    kind: PartKind::Track,
                    tag: Some("Track".into()),
                    id: Some("1".into()),
                    leaves: vec![leaf(LeafKind::Text, rest), leaf(LeafKind::Blob, blob)],
                },
            ],
        })
    }
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
        let mut rest = std::str::from_utf8(text).map_err(|_| malformed("not utf-8"))?;
        let mut used = 0;
        let mut out = String::new();
        while let Some(at) = rest.find("id=\"@\"") {
            out.push_str(&rest[..at + 4]);
            out.push_str(
                side.get(used)
                    .ok_or_else(|| malformed("side list too short"))?,
            );
            used += 1;
            rest = &rest[at + 5..];
        }
        out.push_str(rest);
        Ok((out.into_bytes(), used))
    }
    fn parse(&self, doc: &[u8]) -> Result<SetMeta, DawError> {
        if doc.windows(9).any(|window| window == b"<broken/>") {
            return Err(malformed("broken"));
        }
        Ok(SetMeta::default())
    }
    /// One ref for each `<sample kind="project|outside|library" path="…" rel="…"/>`
    /// line of the document; `rel` is optional.
    fn sample_refs(&self, doc: &[u8]) -> Result<Vec<SampleRef>, DawError> {
        let text = std::str::from_utf8(doc).map_err(|_| malformed("not utf-8"))?;
        let attr = |line: &str, name: &str| {
            let start = line.find(&format!("{name}=\""))? + name.len() + 2;
            line[start..].split('"').next().map(str::to_string)
        };
        Ok(text
            .lines()
            .filter(|line| line.starts_with("<sample "))
            .map(|line| SampleRef {
                path: attr(line, "path").unwrap(),
                kind: match attr(line, "kind").as_deref() {
                    Some("project") => SampleKind::Project,
                    Some("library") => SampleKind::Library,
                    _ => SampleKind::Outside,
                },
                relative: attr(line, "rel"),
                object: None,
                size: None,
            })
            .collect())
    }
    /// The files of `Backup/` beside the set named `<stem> [<anything>].tset`,
    /// oldest mtime first, ties by path.
    fn list_backups(&self, set: &Path) -> std::io::Result<Vec<Backup>> {
        let dir = set.parent().unwrap().join("Backup");
        let Ok(entries) = fs::read_dir(dir) else {
            return Ok(vec![]);
        };
        let prefix = format!("{} [", set.file_stem().unwrap().to_str().unwrap());
        let mut backups = Vec::new();
        for entry in entries {
            let path = entry?.path();
            let name = path.file_name().unwrap().to_str().unwrap();
            if name.starts_with(&prefix) && name.ends_with("].tset") {
                let saved_at = fs::metadata(&path)?.modified()?;
                backups.push(Backup { path, saved_at });
            }
        }
        backups.sort_by(|a, b| (a.saved_at, &a.path).cmp(&(b.saved_at, &b.path)));
        Ok(backups)
    }
}

pub(crate) fn registry() -> Registry {
    Registry::new(vec![&TEST_DAW]).unwrap()
}

pub(crate) fn project(root: &Path) -> PathBuf {
    let dir = root.join("Song Project");
    fs::create_dir_all(&dir).unwrap();
    dir
}

pub(crate) fn repo() -> (tempfile::TempDir, Repo) {
    let root = tempfile::tempdir().unwrap();
    let repo = Repo::init(&project(root.path()), &TEST_DAW).unwrap();
    (root, repo)
}

/// A document whose two track ids and blob are the arguments.
pub(crate) fn xml(first: u32, second: u32, blob: &str) -> String {
    format!(
        "<doc>\n<track id=\"{first}\" name=\"a\"/>\n<track id=\"{second}\" name=\"b\"/>\n<blob>{blob}"
    )
}

pub(crate) fn write_set(path: &Path, xml: &str) {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).unwrap();
    }
    fs::write(path, [MARKER, xml.as_bytes()].concat()).unwrap();
}

pub(crate) fn set_path(repo: &Repo) -> PathBuf {
    repo.root().join("Song.tset")
}

pub(crate) fn set_id(repo: &Repo) -> String {
    let sets = repo.sets().unwrap();
    assert_eq!(sets.len(), 1);
    sets.into_keys().next().unwrap()
}

/// Writes `document` to the set's main file and records it.
pub(crate) fn save_main(repo: &Repo, document: &str) -> ObjectId {
    write_set(&set_path(repo), document);
    repo.record_save(&set_path(repo)).unwrap().unwrap()
}

pub(crate) fn user_commit(repo: &Repo, set: &str, branch: &str, message: &str) -> ObjectId {
    repo.commit(set, branch, message, "Ada", CommitKind::User)
        .unwrap()
}
