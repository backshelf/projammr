//! The window list as a witness: whether the DAW is running (its windows exist, which needs no permission) and, with
//! Screen Recording granted, the title of its window, which names the set.
//!
//! The list comes from `CGWindowListCopyWindowInfo` with `kCGWindowListOptionAll`, on macOS only; elsewhere it is
//! empty, so nothing here claims a DAW runs or has a set open and the rest builds and tests on Linux.

use std::path::{Path, PathBuf};

use dit_core::{Daw, TitleHint};

/// One window: who owns it and what it is titled. The title is empty unless Screen Recording is granted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Window {
    pub owner: String,
    pub title: String,
}

#[cfg(target_os = "macos")]
pub fn windows() -> Vec<Window> {
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::string::CFString;
    use core_graphics::window::{
        copy_window_info, kCGNullWindowID, kCGWindowListOptionAll, kCGWindowName,
        kCGWindowOwnerName,
    };

    let Some(list) = copy_window_info(kCGWindowListOptionAll, kCGNullWindowID) else {
        return Vec::new();
    };
    // SAFETY: the keys are CoreGraphics' own constants, alive for the process.
    let (owner_key, title_key) = unsafe {
        (
            CFString::wrap_under_get_rule(kCGWindowOwnerName),
            CFString::wrap_under_get_rule(kCGWindowName),
        )
    };
    let text = |dict: &CFDictionary<CFString, CFType>, key: &CFString| {
        dict.find(key)
            .and_then(|value| value.downcast::<CFString>())
            .map(|text| text.to_string())
            .unwrap_or_default()
    };
    list.iter()
        .map(|item| {
            // SAFETY: each element of the list CoreGraphics returns is a window's info dictionary.
            let dict: CFDictionary<CFString, CFType> =
                unsafe { CFDictionary::wrap_under_get_rule(*item as CFDictionaryRef) };
            Window {
                owner: text(&dict, &owner_key),
                title: text(&dict, &title_key),
            }
        })
        .collect()
}

#[cfg(not(target_os = "macos"))]
pub fn windows() -> Vec<Window> {
    Vec::new()
}

/// Whether Screen Recording is granted, without asking. Titles of other apps' windows are empty without it.
#[cfg(target_os = "macos")]
pub fn screen_recording_granted() -> bool {
    core_graphics::access::ScreenCaptureAccess.preflight()
}

#[cfg(not(target_os = "macos"))]
pub fn screen_recording_granted() -> bool {
    false
}

/// Whether any window belongs to one of the DAW's application names.
pub fn is_running(windows: &[Window], daw: &dyn Daw) -> bool {
    windows
        .iter()
        .any(|window| daw.app_names().contains(&window.owner.as_str()))
}

/// What the DAW's windows say the open set is called. Two windows naming different sets say nothing: the title
/// cannot tell which one is the set.
pub fn hint(windows: &[Window], daw: &dyn Daw) -> Option<TitleHint> {
    let mut found: Option<TitleHint> = None;
    for window in windows {
        let Some(hint) = daw.title_hint(&window.owner, &window.title) else {
            continue;
        };
        match &found {
            Some(other) if *other != hint => return None,
            _ => found = Some(hint),
        }
    }
    found
}

/// The one set among `known` (set files in the repos dit tracks) whose file stem is the hint's. A stem two repos
/// share is ambiguous and names none.
pub fn resolve(hint: &TitleHint, known: &[PathBuf]) -> Option<PathBuf> {
    let mut matches = known.iter().filter(|path| {
        Path::new(path).file_stem().and_then(|stem| stem.to_str()) == Some(hint.set_stem.as_str())
    });
    match (matches.next(), matches.next()) {
        (Some(path), None) => Some(path.clone()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Daw;

    impl dit_core::Daw for Daw {
        fn id(&self) -> &'static str {
            "t"
        }
        fn display_name(&self) -> &'static str {
            "T"
        }
        fn set_extensions(&self) -> &'static [&'static str] {
            &["t"]
        }
        fn managed_subfolders(&self) -> &'static [&'static str] {
            &[]
        }
        fn is_project_folder(&self, _: &Path) -> bool {
            false
        }
        fn find_sets(&self, _: &Path) -> std::io::Result<Vec<PathBuf>> {
            Ok(vec![])
        }
        fn decode(&self, f: &[u8]) -> Result<Vec<u8>, dit_core::DawError> {
            Ok(f.to_vec())
        }
        fn encode(&self, d: &[u8]) -> Result<Vec<u8>, dit_core::DawError> {
            Ok(d.to_vec())
        }
        fn split(&self, _: &[u8]) -> Result<dit_core::tree::Tree, dit_core::DawError> {
            Err(dit_core::DawError::Unsupported)
        }
        fn mask(&self, t: &[u8], _: &mut Vec<String>) -> Vec<u8> {
            t.to_vec()
        }
        fn unmask(&self, t: &[u8], _: &[String]) -> Result<(Vec<u8>, usize), dit_core::DawError> {
            Ok((t.to_vec(), 0))
        }
        fn parse(&self, _: &[u8]) -> Result<dit_core::SetMeta, dit_core::DawError> {
            Err(dit_core::DawError::Unsupported)
        }
        fn list_backups(&self, _: &Path) -> std::io::Result<Vec<dit_core::Backup>> {
            Ok(vec![])
        }
        fn app_names(&self) -> &'static [&'static str] {
            &["Live"]
        }
        fn title_hint(&self, owner: &str, title: &str) -> Option<TitleHint> {
            (owner == "Live" && !title.is_empty()).then(|| TitleHint {
                set_stem: title.to_string(),
            })
        }
    }

    fn window(owner: &str, title: &str) -> Window {
        Window {
            owner: owner.into(),
            title: title.into(),
        }
    }

    #[test]
    fn the_daw_runs_when_a_window_belongs_to_it_title_or_not() {
        assert!(is_running(
            &[window("Finder", "x"), window("Live", "")],
            &Daw
        ));
        assert!(!is_running(&[window("Finder", "x")], &Daw));
        assert!(!is_running(&[], &Daw));
    }

    #[test]
    fn two_windows_naming_different_sets_name_none_and_the_same_set_twice_names_it() {
        let both = [window("Live", "A"), window("Live", "B")];
        assert_eq!(hint(&both, &Daw), None);
        let twice = [
            window("Live", "A"),
            window("Safari", "B"),
            window("Live", "A"),
        ];
        assert_eq!(
            hint(&twice, &Daw),
            Some(TitleHint {
                set_stem: "A".into()
            })
        );
        assert_eq!(hint(&[window("Live", "")], &Daw), None);
    }

    #[test]
    fn a_stem_resolves_to_the_one_known_set_that_has_it() {
        let known = [
            PathBuf::from("/a/Song Project/Song.als"),
            PathBuf::from("/b/Other Project/Other.als"),
        ];
        let song = TitleHint {
            set_stem: "Song".into(),
        };
        assert_eq!(resolve(&song, &known), Some(known[0].clone()));
        assert_eq!(
            resolve(
                &TitleHint {
                    set_stem: "Nope".into()
                },
                &known
            ),
            None
        );
        let shared = [known[0].clone(), PathBuf::from("/c/Song Project/Song.als")];
        assert_eq!(resolve(&song, &shared), None, "ambiguous");
    }

    #[test]
    fn the_window_list_can_be_read_where_there_is_one() {
        // On macOS this asks CoreGraphics; elsewhere it is empty. Neither may panic.
        let _ = windows();
        let _ = screen_recording_granted();
    }
}
