//! Finding the project folders a backfill could bring in, and reading what each one holds.

use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use dit_core::{Daw, RepoList};

use crate::renders::rules::is_excluded_name;

/// The project folders of `daw` under `root` at any depth, each handed to `on_found` as the walk finds it, then
/// all of them sorted. A project folder is a result and is not searched inside, so a ` Project` folder nested in
/// another is never offered. Hidden folders, the names no project is looked for under (the render rules'
/// [`is_excluded_name`] list, the DAW's managed subfolders) and the folders of a symlink loop are not entered;
/// `root` itself is searched whatever its name, and is a result when it is a project folder. A symlink to a
/// folder is followed once: the folder it reaches is searched under the first path the walk met it by.
///
/// The folder `Ableton` is searched although the render rules exclude it: Live's own libraries live there, but so
/// do projects.
///
/// `cancel` is read before each folder is entered; once set, the folders found so far are returned.
pub fn find_projects(
    root: &Path,
    daw: &dyn Daw,
    cancel: &AtomicBool,
    on_found: &mut dyn FnMut(&Path),
) -> Vec<PathBuf> {
    let managed: Vec<String> = daw
        .managed_subfolders()
        .iter()
        .map(|name| name.to_lowercase())
        .collect();
    let mut found = Vec::new();
    let mut seen = HashSet::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        // A folder reached twice, by a symlink or by a loop of them, is searched the first time.
        let Ok(canonical) = dir.canonicalize() else {
            continue;
        };
        if !seen.insert(canonical) {
            continue;
        }
        if daw.is_project_folder(&dir) {
            on_found(&dir);
            found.push(dir);
            continue;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if skipped(name, &managed) {
                continue;
            }
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            }
        }
    }
    found.sort();
    found
}

fn skipped(name: &str, managed: &[String]) -> bool {
    let lower = name.to_lowercase();
    (lower != "ableton" && is_excluded_name(name)) || managed.contains(&lower)
}

/// What a project folder holds, as the backfill's list shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectFacts {
    pub path: PathBuf,
    /// The DAW's sets directly in the folder.
    pub sets: usize,
    /// The apparent size of everything in the folder, bytes; dit's own `.dit/` is not counted.
    pub bytes: u64,
    /// The latest modification time over the sets and their dated copies, milliseconds since the epoch; `None`
    /// with no set.
    pub newest: Option<i64>,
    /// The folder is a repo already: on the list of repos the app watches, or holding a `.dit/`.
    pub already: bool,
    /// The sync service the folder sits in, which can disturb files dit has open ([`synced_by`]).
    pub synced_by: Option<&'static str>,
}

/// Reads `folder`, a project folder of `daw`. `listed` is the list of repos the app watches. A folder that cannot
/// be listed is the error; a file inside it that cannot be read counts for nothing.
pub fn project_facts(folder: &Path, daw: &dyn Daw, listed: &RepoList) -> io::Result<ProjectFacts> {
    let canonical = folder.canonicalize()?;
    let sets = daw.find_sets(&canonical)?;
    let newest = sets
        .iter()
        .flat_map(|set| {
            let copies = daw.list_backups(set).unwrap_or_default();
            copies
                .into_iter()
                .map(|copy| Some(copy.saved_at))
                .chain([fs::metadata(set).and_then(|meta| meta.modified()).ok()])
        })
        .flatten()
        .max()
        .and_then(millis);
    Ok(ProjectFacts {
        sets: sets.len(),
        bytes: size_of(&canonical),
        newest,
        already: listed.repos.contains(&canonical) || canonical.join(".dit").is_dir(),
        synced_by: synced_by(&canonical),
        path: canonical,
    })
}

fn millis(time: SystemTime) -> Option<i64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|since| i64::try_from(since.as_millis()).ok())
}

/// The bytes of the files under `folder`, not following symlinks and leaving out the top-level `.dit/`.
fn size_of(folder: &Path) -> u64 {
    let mut total = 0;
    let mut pending = vec![folder.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                if dir != folder || entry.file_name() != ".dit" {
                    pending.push(entry.path());
                }
            } else if let Ok(meta) = entry.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

/// The sync service a path sits in, going by where each keeps its folder on a Mac: iCloud Drive under
/// `~/Library/Mobile Documents`, the other providers' folders under `~/Library/CloudStorage/<Provider>[-account]`,
/// and an older folder named for the service (`~/Dropbox`).
pub fn synced_by(path: &Path) -> Option<&'static str> {
    const CLOUD: [(&str, &str); 4] = [
        ("Dropbox", "Dropbox"),
        ("GoogleDrive", "Google Drive"),
        ("OneDrive", "OneDrive"),
        ("Box", "Box"),
    ];
    let parts: Vec<&str> = path
        .components()
        .filter_map(|part| part.as_os_str().to_str())
        .collect();
    if parts
        .windows(2)
        .any(|pair| pair == ["Library", "Mobile Documents"])
    {
        return Some("iCloud Drive");
    }
    if let Some(at) = parts
        .windows(2)
        .position(|pair| pair == ["Library", "CloudStorage"])
    {
        let provider = parts.get(at + 2)?;
        return CLOUD
            .iter()
            .find(|(prefix, _)| provider.starts_with(prefix))
            .map(|(_, name)| *name);
    }
    parts.iter().find_map(|part| match *part {
        "Dropbox" => Some("Dropbox"),
        "iCloud Drive" => Some("iCloud Drive"),
        "Google Drive" => Some("Google Drive"),
        "OneDrive" => Some("OneDrive"),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use std::os::unix::fs::symlink;
    use std::time::Duration;

    use dit_daw_ableton::Ableton;

    use super::*;

    fn project(path: &Path) {
        fs::create_dir_all(path).unwrap();
        fs::write(path.join("Song.als"), b"set").unwrap();
    }

    fn set_mtime(path: &Path, seconds: u64) {
        fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(UNIX_EPOCH + Duration::from_secs(seconds))
            .unwrap();
    }

    fn find(root: &Path) -> Vec<String> {
        find_with(root, &AtomicBool::new(false), &mut |_| {})
            .into_iter()
            .map(|path| {
                path.strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect()
    }

    fn find_with(
        root: &Path,
        cancel: &AtomicBool,
        on_found: &mut dyn FnMut(&Path),
    ) -> Vec<PathBuf> {
        find_projects(root, &Ableton, cancel, on_found)
    }

    #[test]
    fn projects_are_found_at_any_depth_and_not_inside_each_other() {
        let root = tempfile::tempdir().unwrap();
        let base = root.path();
        project(&base.join("a Project"));
        project(&base.join("covers/yes Project"));
        project(&base.join("x/y/z/w/v/u/deep Project"));
        project(&base.join("a Project/Samples/nested Project"));
        project(&base.join("a Project/inner/other Project"));
        fs::create_dir_all(base.join("plain/folder")).unwrap();

        assert_eq!(
            find(base),
            [
                "a Project",
                "covers/yes Project",
                "x/y/z/w/v/u/deep Project"
            ]
        );
    }

    #[test]
    fn excluded_and_hidden_folders_are_not_searched() {
        let root = tempfile::tempdir().unwrap();
        let base = root.path();
        project(&base.join("kept/ok Project"));
        project(&base.join(".hidden/h Project"));
        project(&base.join("Library/Application Support/l Project"));
        project(&base.join("node_modules/n Project"));
        project(&base.join(".Trash/t Project"));
        project(&base.join("Trash/t Project"));
        project(&base.join("Mix Stems/s Project"));
        project(&base.join("Backup/b Project"));
        project(&base.join("Samples/m Project"));

        assert_eq!(find(base), ["kept/ok Project"]);
    }

    #[test]
    fn a_folder_named_ableton_is_searched() {
        let root = tempfile::tempdir().unwrap();
        project(&root.path().join("Ableton/Projects/in Project"));

        assert_eq!(find(root.path()), ["Ableton/Projects/in Project"]);
    }

    #[test]
    fn a_root_inside_an_excluded_name_is_searched_and_a_project_root_is_itself_found() {
        let root = tempfile::tempdir().unwrap();
        let library = root.path().join("Library/Music");
        project(&library.join("a Project"));
        let inside = library.join("a Project");

        let found = find_with(&library, &AtomicBool::new(false), &mut |_| {});
        assert_eq!(found, std::slice::from_ref(&inside));
        let found = find_with(&inside, &AtomicBool::new(false), &mut |_| {});
        assert_eq!(found, [inside]);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_loop_ends_and_a_project_is_found_once() {
        let root = tempfile::tempdir().unwrap();
        let base = root.path();
        project(&base.join("one/a Project"));
        symlink(base, base.join("one/loop")).unwrap();
        symlink(base.join("one"), base.join("two")).unwrap();
        symlink(base.join("one/a Project"), base.join("again Project")).unwrap();

        let found = find(base);

        assert_eq!(found.len(), 1, "{found:?}");
        assert!(found[0].ends_with("a Project") || found[0].ends_with("again Project"));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_folder_is_followed() {
        let root = tempfile::tempdir().unwrap();
        let drive = tempfile::tempdir().unwrap();
        project(&drive.path().join("far Project"));
        symlink(drive.path(), root.path().join("External")).unwrap();

        assert_eq!(find(root.path()), ["External/far Project"]);
    }

    #[test]
    fn found_projects_stream_to_the_callback_and_cancel_stops_the_walk() {
        let root = tempfile::tempdir().unwrap();
        for name in ["a", "b", "c", "d"] {
            project(&root.path().join(format!("{name}/{name} Project")));
        }
        let cancel = AtomicBool::new(false);
        let mut heard = Vec::new();

        let found = find_with(root.path(), &cancel, &mut |path| {
            heard.push(path.to_path_buf());
            cancel.store(true, Ordering::Relaxed);
        });

        assert_eq!(heard.len(), 1);
        assert_eq!(found, heard);
    }

    #[test]
    fn a_walk_cancelled_before_it_starts_finds_nothing() {
        let root = tempfile::tempdir().unwrap();
        project(&root.path().join("a Project"));

        let found = find_with(root.path(), &AtomicBool::new(true), &mut |_| {});

        assert!(found.is_empty());
    }

    #[test]
    fn a_missing_root_finds_nothing() {
        let cancel = AtomicBool::new(false);
        assert!(find_with(Path::new("/does/not/exist"), &cancel, &mut |_| {}).is_empty());
    }

    #[test]
    fn facts_count_sets_size_and_the_newest_save_over_sets_and_copies() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("a Project");
        fs::create_dir_all(folder.join("Backup")).unwrap();
        fs::create_dir_all(folder.join("Samples")).unwrap();
        fs::write(folder.join("Song.als"), vec![0; 100]).unwrap();
        fs::write(folder.join("Other.als"), vec![0; 50]).unwrap();
        fs::write(
            folder.join("Backup/Song [2020-01-02 030405].als"),
            vec![0; 10],
        )
        .unwrap();
        fs::write(folder.join("Samples/k.wav"), vec![0; 1000]).unwrap();
        fs::write(folder.join("notes.txt"), b"hello").unwrap();
        set_mtime(&folder.join("Song.als"), 1_000);
        set_mtime(&folder.join("Other.als"), 2_000);
        set_mtime(&folder.join("Backup/Song [2020-01-02 030405].als"), 9_000);

        let facts = project_facts(&folder, &Ableton, &RepoList::default()).unwrap();

        assert_eq!(facts.sets, 2);
        assert_eq!(facts.bytes, 100 + 50 + 10 + 1000 + 5);
        assert_eq!(facts.newest, Some(9_000_000));
        assert!(!facts.already);
        assert_eq!(facts.synced_by, None);
        assert_eq!(facts.path, folder.canonicalize().unwrap());
    }

    #[test]
    fn the_newest_save_is_a_set_when_no_copy_is_newer() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("a Project");
        fs::create_dir_all(folder.join("Backup")).unwrap();
        fs::write(folder.join("Song.als"), b"x").unwrap();
        fs::write(folder.join("Backup/Song [2020-01-02 030405].als"), b"x").unwrap();
        set_mtime(&folder.join("Song.als"), 7_000);
        set_mtime(&folder.join("Backup/Song [2020-01-02 030405].als"), 3_000);

        let facts = project_facts(&folder, &Ableton, &RepoList::default()).unwrap();

        assert_eq!(facts.newest, Some(7_000_000));
    }

    #[test]
    fn a_folder_with_no_set_has_no_newest_save() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("a Project");
        fs::create_dir_all(&folder).unwrap();

        let facts = project_facts(&folder, &Ableton, &RepoList::default()).unwrap();

        assert_eq!((facts.sets, facts.newest), (0, None));
    }

    #[test]
    fn a_folder_on_the_repo_list_or_holding_a_dit_folder_is_already_in_dit() {
        let root = tempfile::tempdir().unwrap();
        let listed = root.path().join("listed Project");
        let with_dit = root.path().join("with Project");
        let neither = root.path().join("neither Project");
        for folder in [&listed, &with_dit, &neither] {
            project(folder);
        }
        fs::create_dir_all(with_dit.join(".dit")).unwrap();
        fs::write(with_dit.join(".dit/config.toml"), vec![0; 500]).unwrap();
        let list = RepoList {
            repos: vec![listed.canonicalize().unwrap()],
            ..RepoList::default()
        };

        let already = |folder: &Path| project_facts(folder, &Ableton, &list).unwrap().already;

        assert!(already(&listed));
        assert!(already(&with_dit));
        assert!(!already(&neither));
        assert_eq!(
            project_facts(&with_dit, &Ableton, &list).unwrap().bytes,
            3,
            "dit's own folder is not the project's size"
        );
    }

    #[test]
    fn a_folder_that_is_not_there_is_an_error() {
        let list = RepoList::default();
        assert!(project_facts(Path::new("/does/not/exist"), &Ableton, &list).is_err());
    }

    #[test]
    fn a_folder_in_a_sync_service_is_named_for_it() {
        for (path, service) in [
            ("/Users/me/Dropbox/Music/song Project", "Dropbox"),
            (
                "/Users/me/Library/CloudStorage/Dropbox/song Project",
                "Dropbox",
            ),
            (
                "/Users/me/Library/CloudStorage/GoogleDrive-me@x.com/My Drive/p",
                "Google Drive",
            ),
            (
                "/Users/me/Library/CloudStorage/OneDrive-Personal/p",
                "OneDrive",
            ),
            ("/Users/me/Library/CloudStorage/Box-Box/p", "Box"),
            (
                "/Users/me/Library/Mobile Documents/com~apple~CloudDocs/p",
                "iCloud Drive",
            ),
            ("/Users/me/iCloud Drive/p", "iCloud Drive"),
        ] {
            assert_eq!(synced_by(Path::new(path)), Some(service), "{path}");
        }
    }

    #[test]
    fn a_folder_that_only_has_the_word_in_its_name_is_not() {
        for path in [
            "/Users/me/Music/song Project",
            "/Users/me/Music/Dropbox backup Project",
            "/Users/me/Library/CloudStorage/SomethingElse/p",
            "/Users/me/Library/CloudStorage",
        ] {
            assert_eq!(synced_by(Path::new(path)), None, "{path}");
        }
    }
}
