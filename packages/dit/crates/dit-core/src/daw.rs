//! The interface a DAW module implements, and the registry that finds one.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use thiserror::Error;

use crate::meta::{SampleRef, SetMeta};
use crate::openset::{LogState, ScriptKit, TitleHint};
use crate::tree::{LeafKind, Tree};

/// A dated copy of a set the DAW keeps for itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Backup {
    pub path: PathBuf,
    pub saved_at: SystemTime,
}

/// Why a DAW module could not do what it was asked. Holds only strings so a
/// caller across the wasm boundary can map it to a code.
#[derive(Debug, Clone, PartialEq, Error)]
pub enum DawError {
    #[error("corrupt set file: {0}")]
    Corrupt(String),
    #[error("malformed set document: {0}")]
    Malformed(String),
    #[error("not supported by this DAW module")]
    Unsupported,
}

/// One DAW's knowledge of its own files: where its projects and sets live,
/// how a set file becomes a document, how the document splits into a tree,
/// and what `SetMeta` it describes.
pub trait Daw: Send + Sync {
    /// The module's stable lowercase id, e.g. `"ableton"`.
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    /// Set file extensions without the dot, e.g. `["als"]`.
    fn set_extensions(&self) -> &'static [&'static str];
    /// Folders inside a project the DAW owns and dit leaves alone.
    fn managed_subfolders(&self) -> &'static [&'static str];
    fn is_project_folder(&self, dir: &Path) -> bool;
    fn find_sets(&self, project: &Path) -> std::io::Result<Vec<PathBuf>>;
    /// File bytes to document.
    fn decode(&self, file: &[u8]) -> Result<Vec<u8>, DawError>;
    /// Document to file bytes.
    fn encode(&self, doc: &[u8]) -> Result<Vec<u8>, DawError>;
    fn split(&self, doc: &[u8]) -> Result<Tree, DawError>;
    /// Replaces volatile values in one Text leaf with placeholders, pushing
    /// each original onto `side`.
    fn mask(&self, text: &[u8], side: &mut Vec<String>) -> Vec<u8>;
    /// Puts back the values `mask` took out of one Text leaf, taking them in
    /// order from the front of `side`, and returns the restored text with the
    /// number of values it used. Running out of values is `Malformed`; values
    /// left over belong to later leaves. Callers go through `unmask_tree`.
    fn unmask(&self, text: &[u8], side: &[String]) -> Result<(Vec<u8>, usize), DawError>;
    fn parse(&self, doc: &[u8]) -> Result<SetMeta, DawError>;
    /// Every sample the document references, once per distinct path, in
    /// document order and uncapped. `relative` is the project-relative path the
    /// set spells, unchecked; `object` and `size` are left `None`.
    fn sample_refs(&self, _doc: &[u8]) -> Result<Vec<SampleRef>, DawError> {
        Ok(Vec::new())
    }
    fn list_backups(&self, set: &Path) -> std::io::Result<Vec<Backup>>;

    /// The names the DAW's windows are owned by, e.g. `["Live"]`: how a window list says the DAW is running.
    fn app_names(&self) -> &'static [&'static str] {
        &[]
    }
    /// The macOS bundle identifiers of the DAW's app, e.g. `["com.ableton.live"]`: how the dit app finds the
    /// installed DAW (`NSWorkspace`) to open a set file with it, instead of whatever app owns the extension.
    fn bundle_ids(&self) -> &'static [&'static str] {
        &[]
    }
    /// The colour of the DAW's palette entry `index` as `#rrggbb`, the way a saved set's track metas carry it: how the
    /// dit app colours the live tracks the DAW's script reports (by palette index) as the saved ones. A DAW with no
    /// such palette, or an index outside it, names none.
    fn track_colour(&self, _index: i64) -> Option<&'static str> {
        None
    }
    /// What the DAW's own log under `home` (the user's home folder) says: whether it is running and the set it
    /// loaded last. A DAW that keeps no such log is not running and has no set.
    fn log_open_set(&self, _home: &Path) -> std::io::Result<LogState> {
        Ok(LogState::default())
    }
    /// The set a window titled `title`, owned by `owner`, names; `None` for a title that names none.
    fn title_hint(&self, _owner: &str, _title: &str) -> Option<TitleHint> {
        None
    }
    /// The script that makes the DAW report what it has open, where the DAW under `home` looks for it; `None` for a
    /// DAW with no such script.
    fn script_kit(&self, _home: &Path) -> Option<ScriptKit> {
        None
    }
    /// The folders under `home` the DAW's user keeps projects in, as the DAW's own settings list them; empty for a
    /// DAW that lists none. The app searches them for repos that existed before it ran.
    fn project_roots(&self, _home: &Path) -> std::io::Result<Vec<PathBuf>> {
        Ok(Vec::new())
    }
    /// Whether the DAW's last run had the script switched on, from its log; `None` when the log cannot say.
    fn script_enabled(&self, _home: &Path) -> std::io::Result<Option<bool>> {
        Ok(None)
    }
}

/// Masks every Text leaf of `tree` in part and leaf order with one side list
/// threaded through them; Blob leaves are never masked.
pub fn mask_tree(daw: &dyn Daw, tree: &Tree) -> (Tree, Vec<String>) {
    let mut side = Vec::new();
    let mut masked = tree.clone();
    for leaf in masked.parts.iter_mut().flat_map(|part| &mut part.leaves) {
        if leaf.kind == LeafKind::Text {
            leaf.bytes = daw.mask(&leaf.bytes, &mut side);
        }
    }
    (masked, side)
}

/// The document a `mask_tree`d tree came from: each Text leaf unmasked on
/// its own, exactly as it was masked, with Blob leaves passed through, then
/// joined. A side list with values left over is `Malformed`.
pub fn unmask_tree(daw: &dyn Daw, tree: &Tree, side: &[String]) -> Result<Vec<u8>, DawError> {
    let mut doc = Vec::new();
    let mut used = 0;
    for leaf in tree.parts.iter().flat_map(|part| &part.leaves) {
        match leaf.kind {
            LeafKind::Text => {
                let (text, taken) = daw.unmask(&leaf.bytes, &side[used..])?;
                doc.extend_from_slice(&text);
                used += taken;
            }
            LeafKind::Blob => doc.extend_from_slice(&leaf.bytes),
        }
    }
    if used != side.len() {
        return Err(DawError::Malformed(format!(
            "the side list holds {} values but the tree masked {used}",
            side.len()
        )));
    }
    Ok(doc)
}

/// Why a `Registry` could not be built.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum RegistryError {
    #[error("duplicate DAW id `{0}`")]
    DuplicateId(String),
    #[error("duplicate set extension `{0}`")]
    DuplicateExtension(String),
}

/// The DAW modules a build knows about.
#[derive(Clone)]
pub struct Registry {
    daws: Vec<&'static dyn Daw>,
}

impl Registry {
    /// Refuses two modules with the same id, or the same extension compared
    /// lowercase.
    pub fn new(daws: Vec<&'static dyn Daw>) -> Result<Self, RegistryError> {
        let mut ids: Vec<&str> = Vec::new();
        let mut extensions: Vec<String> = Vec::new();
        for daw in &daws {
            if ids.contains(&daw.id()) {
                return Err(RegistryError::DuplicateId(daw.id().to_string()));
            }
            ids.push(daw.id());
            for ext in daw.set_extensions() {
                let ext = ext.to_lowercase();
                if extensions.contains(&ext) {
                    return Err(RegistryError::DuplicateExtension(ext));
                }
                extensions.push(ext);
            }
        }
        Ok(Self { daws })
    }

    pub fn all(&self) -> &[&'static dyn Daw] {
        &self.daws
    }

    pub fn by_id(&self, id: &str) -> Option<&'static dyn Daw> {
        self.daws.iter().copied().find(|daw| daw.id() == id)
    }

    /// The module whose set extension the file carries, ignoring case.
    pub fn for_file(&self, file: &Path) -> Option<&'static dyn Daw> {
        let ext = file.extension()?.to_str()?.to_lowercase();
        self.daws.iter().copied().find(|daw| {
            daw.set_extensions()
                .iter()
                .any(|candidate| candidate.to_lowercase() == ext)
        })
    }

    /// The first module that recognises `dir` as one of its projects.
    pub fn for_project_folder(&self, dir: &Path) -> Option<&'static dyn Daw> {
        self.daws
            .iter()
            .copied()
            .find(|daw| daw.is_project_folder(dir))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fake {
        id: &'static str,
        extensions: &'static [&'static str],
        project_marker: &'static str,
    }

    impl Daw for Fake {
        fn id(&self) -> &'static str {
            self.id
        }
        fn display_name(&self) -> &'static str {
            "Fake"
        }
        fn set_extensions(&self) -> &'static [&'static str] {
            self.extensions
        }
        fn managed_subfolders(&self) -> &'static [&'static str] {
            &[]
        }
        fn is_project_folder(&self, dir: &Path) -> bool {
            dir.ends_with(self.project_marker)
        }
        fn find_sets(&self, _: &Path) -> std::io::Result<Vec<PathBuf>> {
            Ok(vec![])
        }
        fn decode(&self, _: &[u8]) -> Result<Vec<u8>, DawError> {
            Err(DawError::Unsupported)
        }
        fn encode(&self, _: &[u8]) -> Result<Vec<u8>, DawError> {
            Err(DawError::Unsupported)
        }
        fn split(&self, _: &[u8]) -> Result<Tree, DawError> {
            Err(DawError::Unsupported)
        }
        fn mask(&self, text: &[u8], _: &mut Vec<String>) -> Vec<u8> {
            text.to_vec()
        }
        fn unmask(&self, _: &[u8], _: &[String]) -> Result<(Vec<u8>, usize), DawError> {
            Err(DawError::Unsupported)
        }
        fn parse(&self, _: &[u8]) -> Result<SetMeta, DawError> {
            Err(DawError::Unsupported)
        }
        fn list_backups(&self, _: &Path) -> std::io::Result<Vec<Backup>> {
            Ok(vec![])
        }
    }

    static ALPHA: Fake = Fake {
        id: "alpha",
        extensions: &["als"],
        project_marker: "Alpha Project",
    };
    static BETA: Fake = Fake {
        id: "beta",
        extensions: &["rpp", "rpp-bak"],
        project_marker: "Beta Project",
    };
    static ALPHA_AGAIN: Fake = Fake {
        id: "alpha",
        extensions: &["xyz"],
        project_marker: "",
    };
    static SHOUTY: Fake = Fake {
        id: "shouty",
        extensions: &["ALS"],
        project_marker: "",
    };

    fn registry() -> Registry {
        Registry::new(vec![&ALPHA, &BETA]).unwrap()
    }

    #[test]
    fn finds_a_daw_by_id() {
        assert_eq!(registry().by_id("beta").unwrap().id(), "beta");
        assert!(registry().by_id("gamma").is_none());
    }

    #[test]
    fn finds_a_daw_by_extension_ignoring_case() {
        let registry = registry();
        assert_eq!(
            registry.for_file(Path::new("a/Set.ALS")).unwrap().id(),
            "alpha"
        );
        assert_eq!(
            registry.for_file(Path::new("song.rpp")).unwrap().id(),
            "beta"
        );
        assert!(registry.for_file(Path::new("song.wav")).is_none());
        assert!(registry.for_file(Path::new("noextension")).is_none());
    }

    #[test]
    fn finds_a_daw_by_project_folder() {
        let registry = registry();
        let found = registry.for_project_folder(Path::new("/music/Beta Project"));
        assert_eq!(found.unwrap().id(), "beta");
        assert!(
            registry
                .for_project_folder(Path::new("/music/other"))
                .is_none()
        );
    }

    #[test]
    fn refuses_a_duplicate_id() {
        let err = Registry::new(vec![&ALPHA, &ALPHA_AGAIN]).err().unwrap();
        assert_eq!(err, RegistryError::DuplicateId("alpha".into()));
    }

    #[test]
    fn refuses_a_duplicate_extension_compared_lowercase() {
        let err = Registry::new(vec![&ALPHA, &SHOUTY]).err().unwrap();
        assert_eq!(err, RegistryError::DuplicateExtension("als".into()));
    }
}
