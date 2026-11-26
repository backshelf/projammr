//! The control-surface script and where Live looks for it.

use std::path::Path;

use dit_core::ScriptKit;

use crate::openset;

/// The script's files, as shipped in `script/dit/`: the folder name is the name Live shows (`dit`).
const FILES: &[(&str, &str)] = &[
    ("__init__.py", include_str!("../script/dit/__init__.py")),
    ("protocol.py", include_str!("../script/dit/protocol.py")),
    ("tracks.py", include_str!("../script/dit/tracks.py")),
];

/// Written to `VERSION`; the script's own `SCRIPT_VERSION` is the same number.
const VERSION: &str = "1\n";

/// `<User Library>/Remote Scripts/dit`: the User Library as `Library.cfg` places it, found under `home`.
pub(crate) fn kit(home: &Path) -> ScriptKit {
    ScriptKit {
        folder: openset::user_library(home)
            .join("Remote Scripts")
            .join("dit"),
        files: FILES,
        version: VERSION,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_kit_installs_under_the_user_library_the_cfg_names() {
        let home = tempfile::tempdir().unwrap();
        let folder = home.path().join("Library/Preferences/Ableton/Live 12.4.6");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(
            folder.join("Library.cfg"),
            "<UserLibrary><ProjectPath Value=\"/elsewhere/Ableton\" /></UserLibrary>",
        )
        .unwrap();

        assert_eq!(
            kit(home.path()).folder,
            Path::new("/elsewhere/Ableton/User Library/Remote Scripts/dit")
        );
    }

    #[test]
    fn the_shipped_files_carry_the_wire_version_the_marker_names() {
        let protocol = FILES
            .iter()
            .find(|(name, _)| *name == "protocol.py")
            .unwrap()
            .1;
        assert!(protocol.contains(&format!("SCRIPT_VERSION = \"{}\"", VERSION.trim())));
        assert!(FILES.iter().all(|(_, content)| !content.is_empty()));
    }
}
