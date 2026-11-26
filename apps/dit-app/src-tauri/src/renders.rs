//! What the app adds to the render engine's cards: the lists settings shows (what is never looked in, what the
//! producer turned down), the text of a card's notification, and which file of a render the panel plays and times.
//!
//! The decisions are the daemon's (`dit_daemon::renders`); everything here is reading its ledger and wording it.

use std::path::Path;

use dit_core::Registry;
use dit_daemon::renders::RenderFile;
use dit_daemon::renders::ledger::{Ledger, ProposalState};
use dit_daemon::{RenderEvent, RenderState};

use crate::snapshot::RememberedFile;

/// The folders and files the render watcher never offers from, by exact name, as `renders::rules` holds them
/// (`EXCLUDED_NAMES` is private to the daemon: a test here asks the daemon's own rule about each name, so a name
/// that stops being excluded fails there). The names of a DAW's managed subfolders join them, from the DAW.
const BUILT_IN_NAMES: &[&str] = &[
    "Library",
    "Application Support",
    "node_modules",
    "Trash",
    "Ableton",
];

/// The kinds of name the rule excludes as a class, worded for the settings list.
const BUILT_IN_KINDS: &[&str] = &[
    "Names starting with a dot (.git, .Trash, .DS_Store)",
    "Stems (stem, stems and stemz folders and files)",
    "iCloud, Dropbox and temporary files (.icloud, .dropbox, .tmp, ~)",
];

/// What the render watcher never looks in, whatever the producer says: the built-in names, the DAWs' own project
/// subfolders and the kinds of name excluded as a class.
pub fn built_in_excluded(registry: &Registry) -> Vec<String> {
    let mut names: Vec<String> = BUILT_IN_NAMES.iter().map(|name| name.to_string()).collect();
    for folder in registry
        .all()
        .iter()
        .flat_map(|daw| daw.managed_subfolders())
    {
        if !names.iter().any(|held| held.eq_ignore_ascii_case(folder)) {
            names.push(folder.to_string());
        }
    }
    names.extend(BUILT_IN_KINDS.iter().map(|kind| kind.to_string()));
    names
}

fn file_name(path: &Path) -> Option<String> {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
}

/// What the ledger remembers the producer said no to: the files marked "Not a bounce" and the folders marked "Never
/// here". A file is remembered by its fingerprint alone, so it is named only while the ledger still holds the render
/// it was rejected from. A ledger that cannot be read lists nothing.
pub fn remembered(ledger_path: &Path) -> (Vec<RememberedFile>, Vec<String>) {
    let Ok(ledger) = Ledger::load(ledger_path) else {
        return Default::default();
    };
    let rejected_files = ledger
        .rejected
        .iter()
        .map(|fingerprint| {
            let file = ledger
                .proposals
                .iter()
                .filter(|proposal| proposal.state == ProposalState::Rejected)
                .flat_map(|proposal| &proposal.files)
                .find(|file| file.fingerprint.as_deref() == Some(fingerprint));
            RememberedFile {
                fingerprint: fingerprint.clone(),
                name: file.and_then(|file| file_name(&file.path)),
                folder: file
                    .and_then(|file| file.path.parent())
                    .map(|folder| folder.display().to_string()),
            }
        })
        .collect();
    let never_here = ledger
        .never_here
        .iter()
        .map(|folder| folder.display().to_string())
        .collect();
    (rejected_files, never_here)
}

/// The file of a render that is, or would be, uploaded: the one chosen, else the largest.
pub fn shown_file(render: &RenderEvent) -> Option<&RenderFile> {
    render
        .uploaded_file
        .and_then(|index| render.files.get(index))
        .or_else(|| render.files.iter().max_by_key(|file| file.size))
}

/// `3:42`, or `1:02:03` from an hour.
pub fn clock(duration_ms: u64) -> String {
    let seconds = duration_ms / 1000;
    let (hours, minutes, seconds) = (seconds / 3600, seconds / 60 % 60, seconds % 60);
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes}:{seconds:02}")
    }
}

/// The notification for a render that is ready to be added: "New bounce: science123 v4.wav" and what the panel's
/// card leads with, the set it matched and how long it plays.
pub fn announcement(
    render: &RenderEvent,
    set: Option<&str>,
    duration_ms: Option<u64>,
) -> (String, String) {
    let name = shown_file(render)
        .and_then(|file| file_name(&file.path))
        .unwrap_or_else(|| render.name.clone());
    let parts: Vec<String> = [set.map(str::to_string), duration_ms.map(clock)]
        .into_iter()
        .flatten()
        .collect();
    let body = if parts.is_empty() {
        "Open dit to add it as a version.".to_string()
    } else {
        parts.join(" · ")
    };
    (format!("New bounce: {name}"), body)
}

/// Whether a card asks for a notification: it is proposed (ready to be added). Rendering held, taken, added or over
/// the limit does not.
pub fn asks_to_notify(render: &RenderEvent) -> bool {
    render.state == RenderState::Proposed
}

/// The ids of the renders already announced, so a card that changes (its progress, a re-proposal) never notifies
/// twice, and the ones found before this run began never do.
#[derive(Debug, Default)]
pub struct Announced {
    seen: std::collections::HashSet<u64>,
}

impl Announced {
    /// Marks the renders there already were (the ledger's, at launch or when the hub is attached) as announced.
    pub fn seed(&mut self, renders: &[RenderEvent]) {
        self.seen.extend(renders.iter().map(|render| render.id));
    }

    /// Whether `render` is the first time its id asks for a notification.
    pub fn first(&mut self, render: &RenderEvent) -> bool {
        asks_to_notify(render) && self.seen.insert(render.id)
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use dit_daemon::renders::ledger::ProposalFile;
    use dit_daemon::renders::rules::Exclusions;

    use super::*;

    fn render(id: u64, state: RenderState, files: &[(&str, u64)]) -> RenderEvent {
        RenderEvent {
            id,
            name: "science123 v4".to_string(),
            state,
            files: files
                .iter()
                .map(|(path, size)| RenderFile {
                    path: PathBuf::from(path),
                    size: *size,
                })
                .collect(),
            batch: None,
            uploaded_file: None,
            pair_note: None,
            progress: None,
            score: Some(0.8),
            reasons: Vec::new(),
            bounced_after_ms: None,
            reason_kinds: Default::default(),
            session_id: Some(812),
            message: None,
        }
    }

    #[test]
    fn every_built_in_name_is_one_the_daemons_own_rule_excludes() {
        let registry = dit_daws::registry();
        let managed: Vec<&str> = registry
            .all()
            .iter()
            .flat_map(|daw| daw.managed_subfolders().iter().copied())
            .collect();
        let exclusions = Exclusions::new(&managed, &[]);
        let listed = built_in_excluded(&registry);
        for name in BUILT_IN_NAMES {
            assert!(
                exclusions.excludes(&Path::new("/Users/me/Music").join(name)),
                "{name} is not excluded by the daemon"
            );
        }
        assert_eq!(
            listed.len(),
            listed
                .iter()
                .map(|name| name.to_lowercase())
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            "a name is listed once: {listed:?}"
        );
        assert!(listed.iter().any(|name| name == "Backup"));
        assert!(listed.iter().any(|name| name == "Samples"));
        assert!(listed.iter().any(|name| name.starts_with("Stems")));
    }

    #[test]
    fn the_file_shown_is_the_one_uploaded_else_the_largest() {
        let mut pair = render(
            1,
            RenderState::Proposed,
            &[("/b/Mix.mp3", 10), ("/b/Mix.wav", 90)],
        );
        assert_eq!(shown_file(&pair).unwrap().path, Path::new("/b/Mix.wav"));
        pair.uploaded_file = Some(0);
        assert_eq!(shown_file(&pair).unwrap().path, Path::new("/b/Mix.mp3"));
        pair.files.clear();
        assert!(shown_file(&pair).is_none());
    }

    #[test]
    fn a_length_reads_as_minutes_and_seconds_and_hours_from_an_hour() {
        assert_eq!(clock(0), "0:00");
        assert_eq!(clock(222_900), "3:42");
        assert_eq!(clock(3_723_000), "1:02:03");
    }

    #[test]
    fn the_notification_names_the_file_the_set_and_the_length() {
        let card = render(7, RenderState::Proposed, &[("/b/science123 v4.wav", 40)]);
        assert_eq!(
            announcement(&card, Some("science123"), Some(222_000)),
            (
                "New bounce: science123 v4.wav".to_string(),
                "science123 · 3:42".to_string()
            )
        );
        assert_eq!(
            announcement(&card, None, None).1,
            "Open dit to add it as a version."
        );
        let bare = render(8, RenderState::Proposed, &[]);
        assert_eq!(
            announcement(&bare, None, Some(61_000)).0,
            "New bounce: science123 v4"
        );
    }

    #[test]
    fn a_render_notifies_once_when_it_is_first_proposed() {
        let mut announced = Announced::default();
        let held = render(1, RenderState::Waiting, &[("/b/a.wav", 1)]);
        let proposed = render(1, RenderState::Proposed, &[("/b/a.wav", 1)]);
        assert!(!announced.first(&held), "held renders do not ask");
        assert!(announced.first(&proposed));
        assert!(!announced.first(&proposed), "the same card again");
        let uploading = render(1, RenderState::Uploading, &[("/b/a.wav", 1)]);
        assert!(!announced.first(&uploading));
        assert!(
            !announced.first(&proposed),
            "a render that comes back to proposed is the same render"
        );
        assert!(announced.first(&render(2, RenderState::Proposed, &[("/b/b.wav", 1)])));
    }

    #[test]
    fn the_renders_there_were_before_the_run_never_notify() {
        let mut announced = Announced::default();
        let before = render(3, RenderState::Proposed, &[("/b/a.wav", 1)]);
        announced.seed(std::slice::from_ref(&before));
        assert!(!announced.first(&before));
        assert!(announced.first(&render(4, RenderState::Proposed, &[("/b/b.wav", 1)])));
    }

    fn proposal_file(path: &str, fingerprint: Option<&str>) -> ProposalFile {
        ProposalFile {
            path: PathBuf::from(path),
            size: 1,
            mtime_ms: 0,
            fingerprint: fingerprint.map(str::to_string),
        }
    }

    fn proposal(ledger: &mut Ledger, state: ProposalState, file: ProposalFile) -> u64 {
        let id = ledger.propose("x", vec![file], 0);
        ledger.set_state(id, state);
        id
    }

    #[test]
    fn the_ledger_lists_what_was_turned_down_with_names_where_it_still_knows_them() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("renders.json");
        Ledger::update(&path, |ledger| {
            proposal(
                ledger,
                ProposalState::Proposed,
                proposal_file("/Music/out/a.wav", Some("dit:1:aa")),
            );
            let rejected = proposal(
                ledger,
                ProposalState::Proposed,
                proposal_file("/Music/out/b.wav", Some("dit:2:bb")),
            );
            ledger.reject(rejected, true);
            // A fingerprint the ledger holds with no render left to name it.
            ledger.rejected.push("dit:3:cc".to_string());
        })
        .unwrap();

        let (files, folders) = remembered(&path);

        assert_eq!(
            files,
            [
                RememberedFile {
                    fingerprint: "dit:2:bb".to_string(),
                    name: Some("b.wav".to_string()),
                    folder: Some("/Music/out".to_string()),
                },
                RememberedFile {
                    fingerprint: "dit:3:cc".to_string(),
                    name: None,
                    folder: None,
                },
            ]
        );
        assert_eq!(folders, ["/Music/out"]);
    }

    #[test]
    fn a_ledger_that_is_missing_or_unreadable_lists_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            remembered(&dir.path().join("none.json")),
            Default::default()
        );
        let broken = dir.path().join("broken.json");
        std::fs::write(&broken, "not json").unwrap();
        assert_eq!(remembered(&broken), Default::default());
    }
}
