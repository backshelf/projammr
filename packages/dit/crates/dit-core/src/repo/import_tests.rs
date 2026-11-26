use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use super::tests::{read_saves, save_main_at, set_mtime, times, write_backup};
use super::*;
use crate::repo::test_support::*;

/// Writes `bytes` as `Backup/<name>`, last modified `seconds` after the epoch.
fn write_backup_bytes(repo: &Repo, name: &str, bytes: &[u8], seconds: u64) -> PathBuf {
    let path = repo.root().join("Backup").join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, bytes).unwrap();
    set_mtime(&path, Duration::from_secs(seconds));
    path
}

/// A file the test DAW cannot decode.
const UNDECODABLE: &[u8] = b"not a set";

/// A file the test DAW decodes and cannot split.
fn unsplittable() -> Vec<u8> {
    [MARKER, &[0xff, 0xfe]].concat()
}

fn distinct(times: &[i64]) -> bool {
    times.iter().collect::<HashSet<_>>().len() == times.len()
}

#[test]
fn a_backup_at_the_time_of_the_current_save_is_a_millisecond_after_it_and_before_it_in_the_log() {
    let (_root, repo) = repo();
    let (set, current) = save_main_at(&repo, &xml(1, 2, "now"), 5000);
    write_backup(&repo, "Song [a].tset", &xml(1, 2, "old"), 5000);

    let report = repo.import_backups(&set, "main").unwrap();

    let log = repo.log(&set, "main").unwrap();
    assert_eq!(log, [report.imported[0], current]);
    assert_eq!(times(&repo, &log), [5_000_001, 5_000_000]);
}

#[test]
fn backups_sharing_a_time_are_a_millisecond_apart_in_their_listed_order() {
    let (_root, repo) = repo();
    let (set, current) = save_main_at(&repo, &xml(1, 2, "now"), 9000);
    write_backup(&repo, "Song [a].tset", &xml(1, 2, "first"), 3000);
    write_backup(&repo, "Song [b].tset", &xml(1, 2, "second"), 3000);
    write_backup(&repo, "Song [c].tset", &xml(1, 2, "third"), 3000);

    let report = repo.import_backups(&set, "main").unwrap();

    assert_eq!(report.imported.len(), 3);
    let log = repo.log(&set, "main").unwrap();
    assert_eq!(
        log,
        [
            report.imported[0],
            report.imported[1],
            report.imported[2],
            current
        ]
    );
    assert_eq!(
        times(&repo, &log),
        [3_000_000, 3_000_001, 3_000_002, 9_000_000]
    );
}

#[test]
fn a_nudged_backup_clears_the_save_already_a_millisecond_later() {
    let (_root, repo) = repo();
    let (set, first) = save_main_at(&repo, &xml(1, 2, "b"), 3000);
    write_set(&set_path(&repo), &xml(1, 2, "c"));
    set_mtime(&set_path(&repo), Duration::from_millis(3_000_001));
    let second = repo.record_save(&set_path(&repo)).unwrap().unwrap();
    write_set(&set_path(&repo), &xml(1, 2, "d"));
    set_mtime(&set_path(&repo), Duration::from_secs(9000));
    let last = repo.record_save(&set_path(&repo)).unwrap().unwrap();
    write_backup(&repo, "Song [a].tset", &xml(7, 8, "tied"), 3000);

    let report = repo.import_backups(&set, "main").unwrap();

    let log = repo.log(&set, "main").unwrap();
    assert_eq!(report.imported.len(), 1);
    assert_eq!(log, [first, second, report.imported[0], last]);
    assert_eq!(
        times(&repo, &log),
        [3_000_000, 3_000_001, 3_000_002, 9_000_000]
    );
}

#[test]
fn an_undecodable_backup_is_stored_whole_and_the_rest_import() {
    let (_root, repo) = repo();
    let (set, current) = save_main_at(&repo, &xml(1, 2, "now"), 9000);
    write_backup_bytes(&repo, "Song [a].tset", UNDECODABLE, 1000);
    write_backup(&repo, "Song [b].tset", &xml(1, 2, "good"), 2000);

    let report = repo.import_backups(&set, "main").unwrap();

    assert!(report.skipped.is_empty(), "{report:?}");
    assert_eq!(report.imported.len(), 2);
    let saves = read_saves(&repo, &report.imported);
    assert!(saves[0].unreadable && saves[0].xml_hash.is_none() && saves[0].tree.is_none());
    assert_eq!(
        repo.store().read_leaf(&saves[0].raw.unwrap()).unwrap(),
        UNDECODABLE
    );
    assert_eq!(saves[0].file_updated_at, 1_000_000);
    assert!(!saves[1].unreadable);
    assert_eq!(
        repo.log(&set, "main").unwrap(),
        [report.imported[0], report.imported[1], current]
    );
}

#[test]
fn a_backup_that_decodes_but_does_not_split_is_stored_whole() {
    let (_root, repo) = repo();
    let (set, _) = save_main_at(&repo, &xml(1, 2, "now"), 9000);
    write_backup_bytes(&repo, "Song [a].tset", &unsplittable(), 1000);

    let report = repo.import_backups(&set, "main").unwrap();

    assert!(report.skipped.is_empty(), "{report:?}");
    let save = repo.read_save(&report.imported[0]).unwrap();
    assert!(save.unreadable && save.document().is_none());
    assert_eq!(
        repo.store().read_leaf(&save.raw.unwrap()).unwrap(),
        unsplittable()
    );
}

#[test]
fn importing_unreadable_copies_twice_records_nothing_the_second_time() {
    let (_root, repo) = repo();
    let (set, _) = save_main_at(&repo, &xml(1, 2, "now"), 9000);
    let a = write_backup_bytes(&repo, "Song [a].tset", UNDECODABLE, 1000);
    let b = write_backup_bytes(&repo, "Song [b].tset", &unsplittable(), 2000);
    repo.import_backups(&set, "main").unwrap();
    let log = repo.log(&set, "main").unwrap();

    let report = repo.import_backups(&set, "main").unwrap();

    assert!(report.imported.is_empty());
    assert_eq!(
        report.skipped,
        [
            (a, "already saved".to_string()),
            (b, "already saved".to_string())
        ]
    );
    assert_eq!(repo.log(&set, "main").unwrap(), log);
}

#[test]
fn identical_unreadable_copies_record_once() {
    let (_root, repo) = repo();
    let (set, _) = save_main_at(&repo, &xml(1, 2, "now"), 9000);
    write_backup_bytes(&repo, "Song [a].tset", UNDECODABLE, 1000);
    let dup = write_backup_bytes(&repo, "Song [b].tset", UNDECODABLE, 2000);

    let report = repo.import_backups(&set, "main").unwrap();

    assert_eq!(report.imported.len(), 1);
    assert_eq!(report.skipped, [(dup, "already saved".to_string())]);
}

#[test]
fn an_unreadable_copy_at_a_saves_time_is_nudged_too() {
    let (_root, repo) = repo();
    let (set, _) = save_main_at(&repo, &xml(1, 2, "now"), 5000);
    write_backup_bytes(&repo, "Song [a].tset", UNDECODABLE, 5000);

    let report = repo.import_backups(&set, "main").unwrap();

    let log = repo.log(&set, "main").unwrap();
    assert_eq!(report.imported.len(), 1);
    assert_eq!(times(&repo, &log), [5_000_001, 5_000_000]);
}

#[test]
fn record_history_records_the_current_file_then_the_copies_and_commits_nothing() {
    let (_root, repo) = repo();
    write_set(&set_path(&repo), &xml(1, 2, "now"));
    write_backup(&repo, "Song [a].tset", &xml(1, 2, "first"), 1000);
    write_backup(&repo, "Song [b].tset", &xml(1, 2, "second"), 2000);

    let outcome = repo.record_history(&set_path(&repo)).unwrap();

    let current = outcome.current.unwrap();
    assert_eq!(outcome.set_id, set_id(&repo));
    assert_eq!(outcome.imported.imported.len(), 2);
    assert_eq!(outcome.commit, None);
    assert_eq!(
        repo.log(&outcome.set_id, "main").unwrap(),
        [
            outcome.imported.imported[0],
            outcome.imported.imported[1],
            current
        ]
    );
    assert_eq!(repo.read_ref(&outcome.set_id, "main").unwrap(), None);
}

#[test]
fn backfilling_a_set_commits_its_newest_state_once() {
    let (_root, repo) = repo();
    write_set(&set_path(&repo), &xml(1, 2, "now"));
    write_backup(&repo, "Song [a].tset", &xml(1, 2, "first"), 1000);
    write_backup(&repo, "Song [b].tset", &xml(1, 2, "second"), 2000);

    let outcome = repo.backfill_set(&set_path(&repo), "Ada").unwrap();

    let commit = repo.read_commit(&outcome.commit.unwrap()).unwrap();
    assert_eq!(commit.message, BROUGHT_IN);
    assert_eq!(commit.author, "Ada");
    assert_eq!(commit.kind, CommitKind::User);
    assert_eq!(Some(commit.save), outcome.current);
    assert_eq!(commit.parent, None);
    assert_eq!(
        repo.read_ref(&outcome.set_id, "main").unwrap(),
        outcome.commit
    );
    let history = repo.history(&outcome.set_id, "main").unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].saves.len(), 3);
}

#[test]
fn backfilling_a_set_again_records_and_commits_nothing_new() {
    let (_root, repo) = repo();
    write_set(&set_path(&repo), &xml(1, 2, "now"));
    write_backup(&repo, "Song [a].tset", &xml(1, 2, "first"), 1000);
    write_backup_bytes(&repo, "Song [b].tset", UNDECODABLE, 2000);
    let first = repo.backfill_set(&set_path(&repo), "Ada").unwrap();
    let log = repo.log(&first.set_id, "main").unwrap();
    let head = repo.read_ref(&first.set_id, "main").unwrap();

    let again = repo.backfill_set(&set_path(&repo), "Ada").unwrap();

    assert_eq!(again.set_id, first.set_id);
    assert_eq!(again.current, None);
    assert!(again.imported.imported.is_empty());
    assert_eq!(again.commit, None);
    assert_eq!(repo.log(&first.set_id, "main").unwrap(), log);
    assert_eq!(repo.read_ref(&first.set_id, "main").unwrap(), head);
}

#[test]
fn a_set_with_a_commit_gets_none_and_still_takes_its_missing_copies() {
    let (_root, repo) = repo();
    let (set, current) = save_main_at(&repo, &xml(1, 2, "now"), 9000);
    let producers = user_commit(&repo, &set, "main", "Mine");
    write_backup(&repo, "Song [a].tset", &xml(1, 2, "first"), 1000);

    let outcome = repo.backfill_set(&set_path(&repo), "Ada").unwrap();

    assert_eq!(outcome.current, None);
    assert_eq!(outcome.imported.imported.len(), 1);
    assert_eq!(outcome.commit, None);
    assert_eq!(repo.read_ref(&set, "main").unwrap(), Some(producers));
    assert_eq!(
        repo.log(&set, "main").unwrap(),
        [outcome.imported.imported[0], current]
    );
}

#[test]
fn a_set_the_watcher_recorded_without_a_commit_gets_the_one_commit() {
    let (_root, repo) = repo();
    let (set, current) = save_main_at(&repo, &xml(1, 2, "now"), 9000);

    let outcome = repo.backfill_set(&set_path(&repo), "Ada").unwrap();

    assert_eq!(outcome.current, None);
    let commit = repo.read_commit(&outcome.commit.unwrap()).unwrap();
    assert_eq!(commit.save, current);
    assert_eq!(repo.read_ref(&set, "main").unwrap(), outcome.commit);
}

#[test]
fn a_set_file_that_is_not_whole_records_nothing_of_the_set() {
    let (_root, repo) = repo();
    fs::write(set_path(&repo), UNDECODABLE).unwrap();
    write_backup(&repo, "Song [a].tset", &xml(1, 2, "first"), 1000);

    let error = repo.backfill_set(&set_path(&repo), "Ada").unwrap_err();

    assert!(matches!(error, RepoError::Daw(_)), "{error:?}");
    assert!(repo.sets().unwrap().is_empty());
}

#[test]
fn every_save_of_a_backfilled_set_has_its_own_time() {
    let (_root, repo) = repo();
    write_set(&set_path(&repo), &xml(1, 2, "now"));
    set_mtime(&set_path(&repo), Duration::from_secs(3000));
    for name in ["a", "b", "c", "d"] {
        write_backup(
            &repo,
            &format!("Song [{name}].tset"),
            &xml(1, 2, name),
            3000,
        );
    }
    write_backup_bytes(&repo, "Song [e].tset", UNDECODABLE, 3000);

    let outcome = repo.record_history(&set_path(&repo)).unwrap();

    let log = repo.log(&outcome.set_id, "main").unwrap();
    assert_eq!(log.len(), 6);
    assert!(distinct(&times(&repo, &log)));
}
