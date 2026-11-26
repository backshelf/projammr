//! What the app remembers of its own first runs, beside the user config: what it has already offered the person, so a
//! choice they undid stays undone. Not a setting: the config is the cli's file too, and this is only the app's.

use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppState {
    /// Start at login was switched on once, after the first sign-in. Never again: a person who turned it off keeps
    /// it off.
    pub autostart_offered: bool,
    /// The Screen Recording prompt was shown once, on the first signed-in run. The OS never prompts twice.
    pub screen_recording_asked: bool,
    /// Live's script was installed once, after the first sign-in. Never again by itself: a person who removed it
    /// keeps it removed, and settings' "Reinstall" brings it back.
    pub script_offered: bool,
    /// The hub project the last tracked folder was added to: the adopt offer's picker starts on it.
    pub last_project: Option<i64>,
}

impl AppState {
    /// The state at `path`; the empty one when there is no file or it cannot be read (a first run again at worst).
    pub fn load(path: &Path) -> AppState {
        fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    /// Reads the state, lets `change` edit it and writes it back, whole and in place.
    pub fn update<T>(path: &Path, change: impl FnOnce(&mut AppState) -> T) -> io::Result<T> {
        let mut state = AppState::load(path);
        let out = change(&mut state);
        if let Some(folder) = path.parent() {
            fs::create_dir_all(folder)?;
        }
        let staged = path.with_extension("json.tmp");
        fs::write(&staged, serde_json::to_vec_pretty(&state)?)?;
        fs::rename(&staged, path)?;
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_file_is_a_first_run() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            AppState::load(&dir.path().join("app-state.json")),
            AppState::default()
        );
    }

    #[test]
    fn an_update_is_kept_and_leaves_the_other_flag_as_it_was() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sub/app-state.json");

        AppState::update(&path, |state| state.autostart_offered = true).unwrap();
        AppState::update(&path, |state| state.screen_recording_asked = true).unwrap();

        assert_eq!(
            AppState::load(&path),
            AppState {
                autostart_offered: true,
                screen_recording_asked: true,
                script_offered: false,
                last_project: None,
            }
        );
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn a_file_that_cannot_be_read_is_a_first_run() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app-state.json");
        fs::write(&path, "{ not json").unwrap();
        assert_eq!(AppState::load(&path), AppState::default());
    }
}
