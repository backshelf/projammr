//! What dit knows about the set a DAW has open, and the script it installs into the DAW to hear it first-hand.
//! Plain types and std only, so the wasm build compiles them; the watching that fills them in is the app's.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// What told dit a set was open, best first: a `Signal` that compares less is the better witness.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Signal {
    /// The control-surface script inside the DAW: its open and close, and the transport.
    Script,
    /// The DAW's own log of the documents it loaded.
    Log,
    /// The title of the DAW's window.
    Title,
    /// Nothing but saves: the set saved last.
    Saves,
}

impl Signal {
    /// Every signal, best first.
    pub const ALL: [Signal; 4] = [Signal::Script, Signal::Log, Signal::Title, Signal::Saves];

    /// Whether `self` is a better witness than `other`.
    pub fn outranks(self, other: Signal) -> bool {
        self < other
    }
}

/// The set a DAW has open, and which signal said so.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenSet {
    pub path: PathBuf,
    pub signal: Signal,
    /// Milliseconds since the epoch when the signal said it.
    pub at: i64,
}

/// What a DAW's log says: whether the DAW is running (in the log's last run) and the set it loaded last.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LogState {
    pub running: bool,
    /// The last set loaded that is a real project file: not a template or a default the DAW loads for itself, and
    /// not one another log says was replaced.
    pub set: Option<PathBuf>,
}

/// What a window title says of the set: its name, with the DAW's decoration removed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TitleHint {
    pub set_stem: String,
}

/// The script a DAW can be given to report what it has open: its files, where they go and which version they are.
#[derive(Debug, Clone)]
pub struct ScriptKit {
    /// The folder the DAW looks in for the script; its name is the script's.
    pub folder: PathBuf,
    /// `(file name, content)`.
    pub files: &'static [(&'static str, &'static str)],
    /// Written to `VERSION` beside the files, so a later release can tell what is installed.
    pub version: &'static str,
}

/// Where an installed script stands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KitStatus {
    pub installed: bool,
    /// The `VERSION` found, if any.
    pub version: Option<String>,
    /// Installed and the version this release carries, with every file as shipped.
    pub current: bool,
}

const VERSION_FILE: &str = "VERSION";

fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let temp = path.with_extension("dit-tmp");
    fs::write(&temp, bytes)?;
    fs::rename(&temp, path).inspect_err(|_| {
        let _ = fs::remove_file(&temp);
    })
}

impl ScriptKit {
    /// Writes every file and the `VERSION` marker into the folder, each through a temp file and a rename, creating
    /// the folder. A file already as shipped is left alone, so running it twice changes nothing. The port file the
    /// app writes there is never touched. Returns how many files were written.
    pub fn install(&self) -> io::Result<usize> {
        fs::create_dir_all(&self.folder)?;
        let mut written = 0;
        let files = self
            .files
            .iter()
            .copied()
            .chain([(VERSION_FILE, self.version)]);
        for (name, content) in files {
            let path = self.folder.join(name);
            if fs::read_to_string(&path).is_ok_and(|held| held == content) {
                continue;
            }
            write_atomic(&path, content.as_bytes())?;
            written += 1;
        }
        Ok(written)
    }

    pub fn status(&self) -> KitStatus {
        let version = fs::read_to_string(self.folder.join(VERSION_FILE))
            .ok()
            .map(|text| text.trim().to_string());
        let current = version.as_deref() == Some(self.version.trim())
            && self.files.iter().all(|(name, content)| {
                fs::read_to_string(self.folder.join(name)).is_ok_and(|held| held == *content)
            });
        KitStatus {
            installed: version.is_some(),
            version,
            current,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILES: &[(&str, &str)] = &[("__init__.py", "a = 1\n"), ("protocol.py", "b = 2\n")];

    fn kit(folder: &Path) -> ScriptKit {
        ScriptKit {
            folder: folder.to_path_buf(),
            files: FILES,
            version: "3",
        }
    }

    #[test]
    fn signals_rank_script_first() {
        assert!(Signal::Script.outranks(Signal::Log));
        assert!(Signal::Title.outranks(Signal::Saves));
        assert!(!Signal::Saves.outranks(Signal::Saves));
    }

    #[test]
    fn install_writes_the_files_and_the_marker_and_a_second_run_writes_nothing() {
        let root = tempfile::tempdir().unwrap();
        let kit = kit(&root.path().join("Remote Scripts/dit"));
        assert!(!kit.status().installed);

        assert_eq!(kit.install().unwrap(), 3);
        assert_eq!(kit.install().unwrap(), 0);

        let status = kit.status();
        assert!(status.installed && status.current);
        assert_eq!(status.version.as_deref(), Some("3"));
    }

    #[test]
    fn an_older_version_or_an_edited_file_is_not_current_and_install_repairs_it() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("dit");
        let kit = kit(&folder);
        kit.install().unwrap();
        fs::write(folder.join("protocol.py"), "edited").unwrap();
        fs::write(folder.join("port"), "1234\nnonce").unwrap();
        assert!(kit.status().installed && !kit.status().current);

        assert_eq!(kit.install().unwrap(), 1);

        assert!(kit.status().current);
        assert_eq!(
            fs::read_to_string(folder.join("port")).unwrap(),
            "1234\nnonce",
            "the app's port file is left alone"
        );
    }
}
