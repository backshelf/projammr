//! What Live's own files say about the set it has open: `Log.txt` for the documents it loaded and whether it is
//! running, `Indexer.txt` for the project it is looking at, `Library.cfg` for where the User Library is.
//!
//! The formats were read from a real Live 12.4.6 on macOS (`~/Library/Preferences/Ableton/Live 12.4.6/`): a log line
//! is `<local ISO time>: info: <text>`; a run begins with `info: Started: Live <version> Build: <id>` and ends with
//! `info: Live App: GlobalExit(): Start`; every document it opens is `info: Loading document "<absolute path>"`,
//! unescaped; Live also loads the templates and defaults of the User Library as documents, which are not sets.
//! `Indexer.txt` says `info: Configure: CurrentProject: '<project folder>' [Current Project]` a couple of seconds
//! after a load, and names a temporary project for a set that has not been saved.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use dit_core::LogState;

const STARTED: &str = "info: Started: Live ";
const EXIT: &str = "Live App: GlobalExit(): Start";
const LOADING: &str = "info: Loading document \"";
const CURRENT_PROJECT: &str = "Configure: CurrentProject: '";
/// How much of the end of a log is read first; doubled until the last run's start is in it.
const FIRST_CHUNK: u64 = 256 * 1024;

/// `<home>/Library/Preferences/Ableton`, where Live keeps a folder per version.
fn preferences(home: &Path) -> PathBuf {
    home.join("Library/Preferences/Ableton")
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Release {
    Beta(u32),
    Final,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct Version {
    numbers: Vec<u32>,
    release: Release,
}

/// The version in `Live 12.4.6` or `Live 13.0b26`, to compare versions numerically with betas before their release.
fn version_of(name: &str) -> Option<Version> {
    let rest = name.strip_prefix("Live ")?;
    let (core, release) = match rest.split_once('b') {
        Some((core, beta)) => (core, Release::Beta(beta.parse().ok()?)),
        None => (rest, Release::Final),
    };
    let mut numbers: Vec<u32> = core
        .split('.')
        .map(|part| part.parse().ok())
        .collect::<Option<_>>()?;
    if numbers.is_empty() {
        return None;
    }
    while numbers.len() > 1 && numbers.last() == Some(&0) {
        numbers.pop();
    }
    Some(Version { numbers, release })
}

/// The newest `Live <version>` preferences folder under `home`, if Live has ever run there.
pub(crate) fn live_folder(home: &Path) -> Option<PathBuf> {
    std::fs::read_dir(preferences(home))
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let version = version_of(entry.file_name().to_str()?)?;
            entry.path().is_dir().then(|| (version, entry.path()))
        })
        .max()
        .map(|(_, path)| path)
}

/// The User Library: `<ProjectPath>/User Library` from `Library.cfg`'s `UserLibrary`, which a producer may have
/// moved, else Live's default `~/Music/Ableton/User Library`.
pub(crate) fn user_library(home: &Path) -> PathBuf {
    let configured = live_folder(home)
        .and_then(|folder| std::fs::read_to_string(folder.join("Library.cfg")).ok())
        .and_then(|text| library_root(&text));
    configured
        .unwrap_or_else(|| home.join("Music/Ableton"))
        .join("User Library")
}

/// The `ProjectPath` inside the `UserLibrary` element of a `Library.cfg`.
fn library_root(cfg: &str) -> Option<PathBuf> {
    let user_library = &cfg[cfg.find("<UserLibrary>")?..];
    let user_library = &user_library[..user_library.find("</UserLibrary>")?];
    let value = &user_library
        [user_library.find("<ProjectPath Value=\"")? + "<ProjectPath Value=\"".len()..];
    let raw = &value[..value.find('"')?];
    Some(PathBuf::from(crate::parse::decode_entities(raw).as_ref()))
}

/// The folders `Library.cfg`'s `UserFolderInfoList` names: the places the producer keeps projects and samples.
pub(crate) fn user_folders(cfg: &str) -> Vec<PathBuf> {
    let Some(start) = cfg.find("<UserFolderInfoList>") else {
        return Vec::new();
    };
    let list = &cfg[start..];
    let list = &list[..list.find("</UserFolderInfoList>").unwrap_or(list.len())];
    list.split("<UserFolderInfo ")
        .skip(1)
        .filter_map(|entry| {
            let at = entry.find(" Path=\"")? + " Path=\"".len();
            let end = entry[at..].find('"')?;
            let raw = &entry[at..at + end];
            Some(PathBuf::from(crate::parse::decode_entities(raw).as_ref()))
        })
        .collect()
}

pub(crate) fn project_roots(home: &Path) -> io::Result<Vec<PathBuf>> {
    let Some(folder) = live_folder(home) else {
        return Ok(Vec::new());
    };
    match std::fs::read_to_string(folder.join("Library.cfg")) {
        Ok(cfg) => Ok(user_folders(&cfg)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error),
    }
}

/// The end of `path` from the start of the last run in it: the tail is read in doubling chunks until a `Started:`
/// line is in it (or the whole file is), so a log of megabytes costs what its last run does.
pub(crate) fn last_run(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    let mut chunk = FIRST_CHUNK;
    loop {
        let from = len.saturating_sub(chunk);
        file.seek(SeekFrom::Start(from))?;
        let mut bytes = Vec::new();
        (&mut file).take(len - from).read_to_end(&mut bytes)?;
        let text = String::from_utf8_lossy(&bytes);
        if let Some(at) = text.rfind(STARTED) {
            let line = text[..at].rfind('\n').map_or(0, |newline| newline + 1);
            return Ok(text[line..].to_string());
        }
        if from == 0 {
            return Ok(text.into_owned());
        }
        chunk *= 2;
    }
}

/// The end of `path`, whatever it holds.
fn tail(path: &Path, bytes: u64) -> io::Result<String> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    file.seek(SeekFrom::Start(len.saturating_sub(bytes)))?;
    let mut out = Vec::new();
    file.read_to_end(&mut out)?;
    Ok(String::from_utf8_lossy(&out).into_owned())
}

fn stamp(line: &str) -> &str {
    line.split(' ').next().unwrap_or("")
}

/// What the last run of a log says. `run` is the log from its `Started:` line; `indexer` is any tail of
/// `Indexer.txt`; `library` is the User Library, whose templates and defaults Live loads as documents.
///
/// A load of a template is a new unsaved set, so the set is none; a load of any other file of the library, or of
/// something inside an app bundle, is Live's own and says nothing. When `Indexer.txt` names a project after the last
/// load that is not the set's folder, Live has moved on (to a temporary project, say) and the set is none too.
pub(crate) fn parse_log(run: &str, indexer: &str, library: &Path) -> LogState {
    let mut state = LogState::default();
    let mut loaded_at = "";
    let mut started = false;
    for line in run.lines() {
        if line.contains(STARTED) {
            started = true;
            state = LogState {
                running: true,
                set: None,
            };
        } else if line.contains(EXIT) {
            state.running = false;
        } else if let Some(at) = line.find(LOADING) {
            let rest = &line[at + LOADING.len()..];
            let Some(end) = rest.rfind('"') else { continue };
            let path = PathBuf::from(&rest[..end]);
            if path.starts_with(library.join("Templates")) {
                state.set = None;
            } else if path.starts_with(library) || rest[..end].contains(".app/") {
                continue;
            } else {
                state.set = Some(path);
                loaded_at = stamp(line);
            }
        }
    }
    if !started {
        return LogState::default();
    }
    let current = indexer.lines().rev().find_map(|line| {
        let at = line.find(CURRENT_PROJECT)? + CURRENT_PROJECT.len();
        let end = line[at..].find('\'')?;
        Some((stamp(line), PathBuf::from(&line[at..at + end])))
    });
    if let (Some(set), Some((at, project))) = (&state.set, current)
        && at > loaded_at
        && set.parent() != Some(project.as_path())
    {
        state.set = None;
    }
    state
}

pub(crate) fn log_open_set(home: &Path) -> io::Result<LogState> {
    let Some(folder) = live_folder(home) else {
        return Ok(LogState::default());
    };
    let run = match last_run(&folder.join("Log.txt")) {
        Ok(run) => run,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(LogState::default()),
        Err(error) => return Err(error),
    };
    let indexer = tail(&folder.join("Indexer.txt"), FIRST_CHUNK).unwrap_or_default();
    Ok(parse_log(&run, &indexer, &user_library(home)))
}

/// Whether the last run's script slots list `dit` as a control surface. Live prints every slot on each document
/// load (`MidiRemoteScript 3 [Control Surface="None" ...]`); the last group of them is what is on now. `None` when
/// the last run printed none.
pub(crate) fn script_enabled(home: &Path) -> io::Result<Option<bool>> {
    let Some(folder) = live_folder(home) else {
        return Ok(None);
    };
    let run = match last_run(&folder.join("Log.txt")) {
        Ok(run) => run,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    Ok(slots_enabled(&run))
}

fn slots_enabled(run: &str) -> Option<bool> {
    let mut seen = Vec::new();
    let mut surfaces = Vec::new();
    for line in run.lines().rev() {
        let Some(at) = line.find("MidiRemoteScript ") else {
            continue;
        };
        let rest = &line[at + "MidiRemoteScript ".len()..];
        let slot = rest.split(' ').next().unwrap_or("");
        if seen.contains(&slot) {
            break;
        }
        seen.push(slot);
        if let Some(name) = rest.split("Control Surface=\"").nth(1) {
            surfaces.push(name.split('"').next().unwrap_or("").to_string());
        }
    }
    (!seen.is_empty()).then(|| surfaces.iter().any(|name| name == "dit"))
}

/// What a window title names: the set's file name without `.als`, the decoration Live adds removed. Live's title on
/// macOS is not documented; this takes what is plausible (`Song`, `Song.als`, `Song*`, `Song [Song Project]`,
/// `Song - Ableton Live 12 Suite`) and answers none for a title that is only the application's name.
pub(crate) fn title_stem(title: &str) -> Option<String> {
    let mut name = title.trim();
    if let Some(at) = name.find(" - Ableton Live") {
        name = &name[..at];
    }
    if let Some(at) = name.rfind(" [") {
        name = &name[..at];
    }
    let name = name.trim().trim_end_matches('*').trim();
    let name = name.strip_suffix(".als").unwrap_or(name).trim();
    let bare = ["", "Live", "Ableton Live", "Untitled"];
    (!bare.contains(&name) && !name.starts_with("Ableton Live ")).then(|| name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIBRARY: &str = "/Users/me/Music/Ableton/User Library";

    /// Lines as Live 12.4.6 wrote them, with the home folder and project names replaced.
    const RUN: &str = "\
2026-10-19T15:23:05.844156: info: Started: Live 12.4.6 Build: 2026-09-10_0de5c8fa9a
2026-10-19T15:55:17.212842: info: Loading document \"/Users/me/Documents/Ableton/30 covers/roses Project/roses.als\"
2026-10-19T15:57:22.720616: info: Loading document \"/Users/me/Music/Ableton/User Library/Templates/Default sr3 postreset.als\"
2026-10-19T15:57:26.007381: info: Loading document \"/Users/me/Music/Ableton/User Library/Defaults/Creating Tracks/MIDI Track/Default MIDI Track.als\"
2026-10-19T17:33:45.095817: info: Default App: Command-line arguments: 
  Document locations:
    file:///Users/me/Documents/Ableton/30%20covers/yes%20crj%20Project/yes%20crj.als
2026-10-19T17:33:45.735145: info: Loading document \"/Users/me/Documents/Ableton/30 covers/yes crj Project/yes crj.als\"
";

    const INDEXER: &str = "\
2026-10-19T16:54:07.442301: info: Configure: CurrentProject: '/Users/me/Documents/Ableton/30 covers/other Project' [Current Project]
2026-10-19T17:33:47.876186: info: Configure: CurrentProject: '/Users/me/Documents/Ableton/30 covers/yes crj Project' [Current Project]
";

    fn state(run: &str, indexer: &str) -> LogState {
        parse_log(run, indexer, Path::new(LIBRARY))
    }

    fn set(path: &str) -> Option<PathBuf> {
        Some(PathBuf::from(path))
    }

    #[test]
    fn the_last_real_load_is_the_open_set() {
        let state = state(RUN, INDEXER);
        assert!(state.running);
        assert_eq!(
            state.set,
            set("/Users/me/Documents/Ableton/30 covers/yes crj Project/yes crj.als")
        );
    }

    #[test]
    fn a_template_load_after_the_set_is_a_new_unsaved_set_and_default_track_loads_say_nothing() {
        let run = RUN.lines().take(4).collect::<Vec<_>>().join("\n");
        assert_eq!(
            state(&run, "").set,
            None,
            "the template came after roses.als"
        );
        let defaults_only = RUN
            .lines()
            .enumerate()
            .filter(|(at, _)| matches!(at, 0 | 1 | 3))
            .map(|(_, line)| line)
            .collect::<Vec<_>>()
            .join("\n");
        assert_eq!(
            state(&defaults_only, "").set,
            set("/Users/me/Documents/Ableton/30 covers/roses Project/roses.als")
        );
    }

    #[test]
    fn indexer_naming_another_project_after_the_load_means_live_moved_on() {
        let temp = format!(
            "{INDEXER}2026-10-19T17:50:18.049360: info: Configure: CurrentProject: '/Users/me/Music/Ableton/Live Recordings/2026-10-19 175017 Temp Project' [Current Project]\n"
        );
        assert_eq!(state(RUN, &temp).set, None);
        // An older indexer line for another project does not count.
        let older = "2026-10-19T16:54:07.442301: info: Configure: CurrentProject: '/x/Other Project' [Current Project]\n";
        assert!(state(RUN, older).set.is_some());
    }

    #[test]
    fn global_exit_ends_the_run_and_no_started_line_is_not_running() {
        let ended =
            format!("{RUN}2026-10-20T12:24:08.375621: info: Live App: GlobalExit(): Start\n");
        let state = state(&ended, INDEXER);
        assert!(!state.running);
        assert!(state.set.is_some());
        assert_eq!(
            super::parse_log("", "", Path::new(LIBRARY)),
            LogState::default()
        );
    }

    #[test]
    fn last_run_reads_from_the_last_started_line_in_a_big_log() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Log.txt");
        let old = "2026-10-17T16:24:20.761721: info: Started: Live 12.4.6 Build: x\nold line\n";
        let filler = "2026-10-18T00:00:00.000000: info: MemoryUsage: V: 505 GB\n".repeat(20_000);
        std::fs::write(&path, format!("{old}{filler}{RUN}")).unwrap();

        let run = last_run(&path).unwrap();

        assert!(run.starts_with("2026-10-19T15:23:05.844156: info: Started:"));
        assert!(!run.contains("old line"));
        assert!(state(&run, INDEXER).set.is_some());
    }

    #[test]
    fn the_user_library_is_where_library_cfg_says_else_the_default() {
        let cfg = "<UserLibrary>\n<LibraryProject Id=\"0\">\n<ProjectPath Value=\"/Volumes/Samples/Ableton\" />\n</LibraryProject>\n</UserLibrary>\n<UserFolderInfoList><UserFolderInfo Path=\"/Users/me/Documents\" /></UserFolderInfoList>";
        assert_eq!(
            library_root(cfg),
            Some(PathBuf::from("/Volumes/Samples/Ableton"))
        );
        assert_eq!(library_root("<Ableton/>"), None);

        let home = tempfile::tempdir().unwrap();
        assert_eq!(
            user_library(home.path()),
            home.path().join("Music/Ableton/User Library")
        );
        let folder = home.path().join("Library/Preferences/Ableton/Live 12.4.6");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::create_dir_all(home.path().join("Library/Preferences/Ableton/Live 9.7.7"))
            .unwrap();
        std::fs::write(folder.join("Library.cfg"), cfg).unwrap();
        assert_eq!(live_folder(home.path()), Some(folder));
        assert_eq!(
            user_library(home.path()),
            PathBuf::from("/Volumes/Samples/Ableton/User Library")
        );

        let beta = home.path().join("Library/Preferences/Ableton/Live 13.0b26");
        std::fs::create_dir_all(&beta).unwrap();
        assert_eq!(live_folder(home.path()), Some(beta));
    }

    #[test]
    fn the_user_folder_list_is_read_from_library_cfg() {
        let cfg = "<UserFolderInfoList>\n<UserFolderInfo Id=\"613\" Path=\"/Users/me/Documents/Ableton\" DisplayName=\"Ableton\" IconName=\"\" />\n<UserFolderInfo Id=\"616\" Path=\"/Users/me/Downloads\" DisplayName=\"Downloads\" />\n</UserFolderInfoList><Other><UserFolderInfo Path=\"/ignored\"/></Other>";
        assert_eq!(
            user_folders(cfg),
            [
                PathBuf::from("/Users/me/Documents/Ableton"),
                PathBuf::from("/Users/me/Downloads")
            ]
        );
        assert!(user_folders("<Ableton/>").is_empty());
    }

    #[test]
    fn versions_compare_as_numbers() {
        assert!(version_of("Live 12.4.6") > version_of("Live 9.7.7"));
        assert!(version_of("Live 12.10.0") > version_of("Live 12.9.9"));
        assert!(version_of("Live 13.0b26") > version_of("Live 12.4.6"));
        assert!(version_of("Live 13.0b26") > version_of("Live 13.0b2"));
        assert!(version_of("Live 13.0") > version_of("Live 13.0b26"));
        assert!(version_of("Live 13.0.0") > version_of("Live 13.0b26"));
        assert!(version_of("Live 13.0.1b1") > version_of("Live 13.0.0"));
        assert!(version_of("Live 13.0.1") > version_of("Live 13.0.1b1"));
        assert_eq!(version_of("Crash"), None);
        assert_eq!(version_of("Live 13.0b"), None);
        assert_eq!(version_of("Live 13.0b1.2"), None);
        assert_eq!(version_of("Live 13.b1"), None);
    }

    #[test]
    fn the_script_is_enabled_when_the_last_group_of_slots_lists_it() {
        let off = "\
  MidiRemoteScript 0 [Control Surface=\"None\" Input=\"None\" Output=\"None\"]
  MidiRemoteScript 1 [Control Surface=\"Komplete_Kontrol_S_Mk2\" Input=\"None\" Output=\"None\"]
  MidiRemoteScript 2 [Control Surface=\"None\" Input=\"None\" Output=\"None\"]
";
        let on = off.replace("Komplete_Kontrol_S_Mk2", "dit");
        assert_eq!(slots_enabled(off), Some(false));
        assert_eq!(slots_enabled(&on), Some(true));
        assert_eq!(
            slots_enabled(&format!("{on}later line\n{off}")),
            Some(false),
            "the last group counts"
        );
        assert_eq!(slots_enabled("nothing"), None);
    }

    #[test]
    fn library_cfg_paths_unescape_xml_entities() {
        let cfg = "<UserLibrary><ProjectPath Value=\"/Volumes/R&amp;B/Ableton&#32;Lib\" /></UserLibrary>\
<UserFolderInfoList><UserFolderInfo Id=\"1\" Path=\"/Users/me/Drum &amp; Bass/Sets\" /></UserFolderInfoList>";
        assert_eq!(
            library_root(cfg),
            Some(PathBuf::from("/Volumes/R&B/Ableton Lib"))
        );
        assert_eq!(
            user_folders(cfg),
            [PathBuf::from("/Users/me/Drum & Bass/Sets")]
        );
    }

    #[test]
    fn titles_lose_their_decoration() {
        for title in [
            "yes crj",
            "yes crj.als",
            "yes crj*",
            "yes crj [yes crj Project]",
            "yes crj - Ableton Live 12 Suite",
        ] {
            assert_eq!(title_stem(title).as_deref(), Some("yes crj"), "{title}");
        }
        assert_eq!(
            title_stem("Song [WIP] [Song Project] - Ableton Live 12 Suite").as_deref(),
            Some("Song [WIP]")
        );
        for title in ["", "Live", "Ableton Live 12 Suite", "  "] {
            assert_eq!(title_stem(title), None, "{title}");
        }
    }
}
