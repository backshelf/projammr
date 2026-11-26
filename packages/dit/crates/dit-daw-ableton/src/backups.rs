//! The dated copies of a set Live keeps in the project's `Backup/` folder.

use std::fs;
use std::io;
use std::path::Path;
use std::sync::LazyLock;

use dit_core::Backup;
use regex::Regex;

/// Live names a backup `<Set name> [YYYY-MM-DD HHMMSS].als`: the hour, minute
/// and second are one unseparated block, unlike the date.
static BACKUP_NAME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(.*) \[[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{6}\]\.(?i-u:als)$")
        .expect("the backup name pattern is valid")
});

/// The backups of `set` itself, oldest first, from the `Backup/` folder beside
/// it; a missing folder is an empty list.
///
/// A `Backup/` folder holds every set's copies side by side, so a copy is kept
/// only when the set name in its file name is exactly the set file's stem.
/// The time is the file's mtime and never the stamp in the name: the stamp is
/// the moment Live replaced the copy, not the moment the copy was saved.
/// Ties in time are ordered by path.
pub(crate) fn list_backups(set: &Path) -> io::Result<Vec<Backup>> {
    let dir = set.parent().unwrap_or(Path::new("")).join("Backup");
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let stem = set.file_stem().and_then(|stem| stem.to_str());

    let mut backups = Vec::new();
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let name = entry.file_name();
        let Some(set_name) = name
            .to_str()
            .and_then(|name| BACKUP_NAME.captures(name))
            .map(|captures| captures[1].to_string())
        else {
            continue;
        };
        if Some(set_name.as_str()) != stem {
            continue;
        }
        let path = entry.path();
        let Ok(saved_at) = fs::metadata(&path).and_then(|meta| meta.modified()) else {
            continue;
        };
        backups.push(Backup { path, saved_at });
    }
    backups.sort_by(|a, b| (a.saved_at, &a.path).cmp(&(b.saved_at, &b.path)));
    Ok(backups)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use super::*;

    fn at(seconds: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(seconds)
    }

    /// A project folder holding an empty `Backup/`.
    fn project() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("Backup")).unwrap();
        dir
    }

    /// Writes `Backup/<name>` last modified at `seconds` after the epoch.
    fn backup(dir: &Path, name: &str, seconds: u64) -> PathBuf {
        let path = dir.join("Backup").join(name);
        fs::write(&path, "x").unwrap();
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(at(seconds))
            .unwrap();
        path
    }

    #[test]
    fn a_missing_backup_folder_is_an_empty_list() {
        let dir = tempfile::tempdir().unwrap();

        assert_eq!(list_backups(&dir.path().join("Missing.als")).unwrap(), []);
    }

    #[test]
    fn a_backup_of_the_set_is_listed_with_its_path() {
        let dir = project();
        let path = backup(dir.path(), "Song A [2026-03-05 143022].als", 100);

        let backups = list_backups(&dir.path().join("Song A.als")).unwrap();

        assert_eq!(
            backups,
            [Backup {
                path,
                saved_at: at(100)
            }]
        );
    }

    #[test]
    fn a_set_name_that_itself_has_brackets_is_kept() {
        let dir = project();
        let path = backup(dir.path(), "Song [Remix] [2026-01-01 000000].als", 100);

        let backups = list_backups(&dir.path().join("Song [Remix].als")).unwrap();

        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].path, path);
    }

    #[test]
    fn a_non_ascii_set_name_is_kept() {
        let dir = project();
        let path = backup(dir.path(), "Café [2026-01-02 030405].als", 100);

        let backups = list_backups(&dir.path().join("Café.als")).unwrap();

        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].path, path);
    }

    #[test]
    fn another_sets_backups_are_ignored() {
        let dir = project();
        backup(dir.path(), "Song A 2 [2026-03-05 143022].als", 100);
        backup(dir.path(), "Other [2026-03-05 143022].als", 100);
        let own = backup(dir.path(), "Song A [2026-03-05 143022].als", 100);

        let backups = list_backups(&dir.path().join("Song A.als")).unwrap();

        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].path, own);
    }

    #[test]
    fn the_set_name_must_match_exactly_including_case() {
        let dir = project();
        backup(dir.path(), "song a [2026-03-05 143022].als", 100);

        assert_eq!(list_backups(&dir.path().join("Song A.als")).unwrap(), []);
    }

    #[test]
    fn the_time_is_the_mtime_and_not_the_stamp_in_the_name() {
        let dir = project();
        let old_stamp = backup(dir.path(), "Song A [2020-01-01 000000].als", 5000);
        let new_stamp = backup(dir.path(), "Song A [2026-06-15 090000].als", 1000);

        let backups = list_backups(&dir.path().join("Song A.als")).unwrap();

        let listed: Vec<_> = backups.iter().map(|b| (&b.path, b.saved_at)).collect();
        assert_eq!(
            listed,
            [(&new_stamp, at(1000)), (&old_stamp, at(5000))],
            "oldest mtime first, whatever the names say"
        );
    }

    #[test]
    fn backups_with_the_same_time_are_ordered_by_path() {
        let dir = project();
        let b = backup(dir.path(), "Song A [2026-01-02 000000].als", 100);
        let a = backup(dir.path(), "Song A [2026-01-01 000000].als", 100);

        let backups = list_backups(&dir.path().join("Song A.als")).unwrap();

        let paths: Vec<_> = backups.into_iter().map(|b| b.path).collect();
        assert_eq!(paths, [a, b]);
    }

    #[test]
    fn files_that_do_not_match_the_backup_name_are_ignored() {
        let dir = project();
        backup(dir.path(), "notes.txt", 100);
        backup(dir.path(), "Song A.als", 100);
        backup(dir.path(), "Song A [2026-03-05 14:30:22].als", 100);
        backup(dir.path(), "Song A [2026-03-05 143022].als.bak", 100);

        assert_eq!(list_backups(&dir.path().join("Song A.als")).unwrap(), []);
    }

    #[test]
    fn the_name_and_extension_match_ignoring_case() {
        let dir = project();
        let path = backup(dir.path(), "Song A [2026-03-05 143022].ALS", 100);

        let backups = list_backups(&dir.path().join("Song A.als")).unwrap();

        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].path, path);
    }

    #[test]
    fn a_folder_that_looks_like_a_backup_is_skipped() {
        let dir = project();
        fs::create_dir(
            dir.path()
                .join("Backup")
                .join("Song A [2026-03-05 143022].als"),
        )
        .unwrap();

        assert_eq!(list_backups(&dir.path().join("Song A.als")).unwrap(), []);
    }

    #[test]
    fn backups_in_a_subfolder_of_backup_are_not_listed() {
        let dir = project();
        let nested = dir.path().join("Backup").join("Old");
        fs::create_dir(&nested).unwrap();
        fs::write(nested.join("Song A [2026-03-05 143022].als"), "x").unwrap();

        assert_eq!(list_backups(&dir.path().join("Song A.als")).unwrap(), []);
    }
}
