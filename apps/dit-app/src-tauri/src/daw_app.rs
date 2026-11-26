//! Opening a set file in its DAW: the installed app is found by the bundle identifiers the DAW module names
//! (`Daw::bundle_ids`, through `NSWorkspace`), and the file is opened with that app, not with whatever the system
//! has made the owner of the extension.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

use dit_core::{Daw, Registry};
use objc2_app_kit::NSWorkspace;
use objc2_foundation::NSString;

/// The installed application with the first of `bundle_ids` the system knows, as a path to its bundle.
fn installed_application(bundle_ids: &[&str]) -> Option<PathBuf> {
    let workspace = NSWorkspace::sharedWorkspace();
    bundle_ids.iter().find_map(|id| {
        let url = workspace.URLForApplicationWithBundleIdentifier(&NSString::from_str(id))?;
        Some(PathBuf::from(url.path()?.to_string()))
    })
}

/// Whether `daw`'s application is installed on this computer.
pub fn is_installed(daw: &dyn Daw) -> bool {
    installed_application(daw.bundle_ids()).is_some()
}

/// The arguments of `open` that open `file` with the application at `application`.
fn open_arguments(application: &Path, file: &Path) -> Vec<OsString> {
    vec![
        "-a".into(),
        application.as_os_str().to_owned(),
        file.as_os_str().to_owned(),
    ]
}

fn name_of(file: &Path) -> String {
    file.file_name().map_or_else(
        || file.display().to_string(),
        |name| name.to_string_lossy().into_owned(),
    )
}

/// Opens the set file in its DAW. An error is one line for the panel: the file is gone, no DAW of dit's owns that
/// kind of file, or the DAW is not installed ("Live wasn't found.").
pub fn open(registry: &Registry, file: &Path) -> Result<(), String> {
    open_with(registry, file, installed_application, |arguments| {
        Command::new("open")
            .args(arguments)
            .status()
            .map_err(|error| error.to_string())
            .and_then(|status| {
                status
                    .success()
                    .then_some(())
                    .ok_or_else(|| format!("open {status}"))
            })
    })
}

/// [`open`] with the system's two answers (where the app is, how `open` ran) given, so a test supplies them.
fn open_with(
    registry: &Registry,
    file: &Path,
    find: impl Fn(&[&str]) -> Option<PathBuf>,
    run: impl FnOnce(&[OsString]) -> Result<(), String>,
) -> Result<(), String> {
    let name = name_of(file);
    if !file.is_file() {
        return Err(format!("{name} isn't where dit last saw it."));
    }
    let daw = registry
        .for_file(file)
        .ok_or_else(|| format!("dit doesn't know which app opens {name}."))?;
    let application = find(daw.bundle_ids()).ok_or_else(|| {
        format!(
            "{} wasn't found. {name} is at {}.",
            daw.app_names()
                .first()
                .copied()
                .unwrap_or(daw.display_name()),
            file.display()
        )
    })?;
    run(&open_arguments(&application, file))
        .map_err(|error| format!("Couldn't open {name}: {error}"))
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;

    fn set_file(dir: &Path) -> PathBuf {
        let file = dir.join("science.als");
        std::fs::write(&file, "x").unwrap();
        file
    }

    #[test]
    fn a_missing_file_is_refused_in_words_before_anything_is_looked_for() {
        let error = open_with(
            &dit_daws::registry(),
            Path::new("/does/not/exist/Song.als"),
            |_| panic!("no lookup for a file that is not there"),
            |_| panic!("no open"),
        )
        .unwrap_err();
        assert_eq!(error, "Song.als isn't where dit last saw it.");
    }

    #[test]
    fn a_file_no_daw_owns_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("notes.txt");
        std::fs::write(&file, "x").unwrap();
        let error = open_with(&dit_daws::registry(), &file, |_| None, |_| Ok(())).unwrap_err();
        assert_eq!(error, "dit doesn't know which app opens notes.txt.");
    }

    #[test]
    fn the_app_is_looked_for_by_the_daws_bundle_identifier_and_opens_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = set_file(dir.path());
        let asked = RefCell::new(Vec::new());
        let ran = RefCell::new(Vec::new());

        open_with(
            &dit_daws::registry(),
            &file,
            |ids| {
                asked
                    .borrow_mut()
                    .extend(ids.iter().map(|id| id.to_string()));
                Some(PathBuf::from("/Applications/Ableton Live 12 Suite.app"))
            },
            |arguments| {
                ran.borrow_mut().extend(arguments.iter().cloned());
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(*asked.borrow(), ["com.ableton.live"]);
        assert_eq!(
            *ran.borrow(),
            [
                OsString::from("-a"),
                OsString::from("/Applications/Ableton Live 12 Suite.app"),
                file.into_os_string(),
            ]
        );
    }

    #[test]
    fn a_daw_that_is_not_installed_says_so_and_where_the_file_is() {
        let dir = tempfile::tempdir().unwrap();
        let file = set_file(dir.path());
        let error = open_with(
            &dit_daws::registry(),
            &file,
            |_| None,
            |_| panic!("nothing to open with"),
        )
        .unwrap_err();
        assert_eq!(
            error,
            format!("Live wasn't found. science.als is at {}.", file.display())
        );
    }

    #[test]
    fn a_failed_open_is_worded_with_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = set_file(dir.path());
        let error = open_with(
            &dit_daws::registry(),
            &file,
            |_| Some(PathBuf::from("/Applications/Live.app")),
            |_| Err("open exit status: 1".to_string()),
        )
        .unwrap_err();
        assert_eq!(error, "Couldn't open science.als: open exit status: 1");
    }
}
