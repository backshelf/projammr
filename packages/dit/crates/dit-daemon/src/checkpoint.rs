//! Checkpoints: the commits dit makes on its own so a long session does not become one unbroken stretch of saves.
//!
//! A branch gets one when it has gone ten saves, or two hours open, since its head commit; never before the set's
//! first user commit (that commit and its track proposal are the producer's). The message is the open time since
//! the last commit whichever rule fired, `checkpoint · 2h 14m`.

use dit_core::{CommitKind, ObjectId, Repo, RepoError, format_span};

/// Saves since the head commit that make a checkpoint due.
pub const SAVES: usize = 10;
/// Open time since the head commit that makes one due.
pub const OPEN_MS: i64 = 2 * 60 * 60 * 1000;
/// Who a checkpoint's commit is by.
pub const AUTHOR: &str = "dit";

pub fn due(saves_since_commit: usize, open_ms: i64) -> bool {
    saves_since_commit >= SAVES || open_ms >= OPEN_MS
}

pub fn message(open_ms: i64) -> String {
    format!("checkpoint \u{b7} {}", format_span(open_ms))
}

#[derive(Debug)]
pub enum Outcome {
    /// Nothing to do yet: no head commit, no saves, or neither rule fired.
    NotDue,
    /// Due, but not committable: the latest save is unreadable, or it is the head's state (ten view-only saves).
    /// The same latest save will not become committable by waiting.
    Declined,
    Committed {
        commit: ObjectId,
        message: String,
    },
    /// Another writer holds the repo; try again.
    Busy,
    Failed(RepoError),
}

/// Makes a checkpoint of `branch` if one is due.
pub fn run(repo: &Repo, set_id: &str, branch: &str) -> Outcome {
    match try_run(repo, set_id, branch) {
        Ok(outcome) => outcome,
        Err(RepoError::Locked(_)) => Outcome::Busy,
        Err(error) => Outcome::Failed(error),
    }
}

fn try_run(repo: &Repo, set_id: &str, branch: &str) -> Result<Outcome, RepoError> {
    if repo.read_ref(set_id, branch)?.is_none() {
        return Ok(Outcome::NotDue);
    }
    let Some(latest) = repo.log(set_id, branch)?.pop() else {
        return Ok(Outcome::NotDue);
    };
    let saves = repo.saves_since_commit(set_id, branch)?;
    let open_ms = repo.time_since_commit(set_id, branch)?;
    if !due(saves, open_ms) {
        return Ok(Outcome::NotDue);
    }
    if repo.read_save(&latest)?.unreadable || !repo.working_changed(set_id, branch)? {
        return Ok(Outcome::Declined);
    }
    let message = message(open_ms);
    match repo.commit(set_id, branch, &message, AUTHOR, CommitKind::Checkpoint) {
        Ok(commit) => Ok(Outcome::Committed { commit, message }),
        Err(RepoError::NothingToCommit { .. }) => Ok(Outcome::Declined),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use dit_core::{Segment, Source};

    use super::*;
    use crate::test_support::*;

    #[test]
    fn ten_saves_or_two_hours_make_one_due() {
        assert!(!due(9, OPEN_MS - 1));
        assert!(due(10, 0));
        assert!(due(0, OPEN_MS));
    }

    #[test]
    fn the_message_is_the_open_time() {
        assert_eq!(message(134 * 60_000), "checkpoint \u{b7} 2h 14m");
        assert_eq!(message(0), "checkpoint \u{b7} <1m");
    }

    /// A repo whose set has one user commit, then `saves` more saves a minute apart. With `view_only` every
    /// document differs only by an `id="n"` the DAW masks, so no save changes the tree.
    fn after_commit(
        saves: usize,
        view_only: bool,
    ) -> (tempfile::TempDir, std::path::PathBuf, Repo, String) {
        let (root, dir, repo) = project("Song");
        let path = dir.join("Song.fset");
        let body = |n: usize| {
            if view_only {
                format!("<x id=\"{n}\"/>")
            } else {
                format!("v{n}")
            }
        };
        write_set(&path, &body(0), 1_000_000);
        repo.record_save(&path).unwrap();
        let set = repo.sets().unwrap().into_keys().next().unwrap();
        repo.commit(&set, "main", "first", "ada", CommitKind::User)
            .unwrap();
        for n in 1..=saves {
            write_set(&path, &body(n), 1_000_000 + n as i64 * 60_000);
            repo.record_save(&path).unwrap();
        }
        (root, path, repo, set)
    }

    #[test]
    fn a_set_with_no_user_commit_yet_gets_none() {
        let (_root, dir, repo) = project("Song");
        let path = dir.join("Song.fset");
        for n in 0..12 {
            write_set(&path, &format!("v{n}"), 1_000_000 + n * 60_000);
            repo.record_save(&path).unwrap();
        }
        let set = repo.sets().unwrap().into_keys().next().unwrap();
        assert!(matches!(run(&repo, &set, "main"), Outcome::NotDue));
        assert!(repo.read_ref(&set, "main").unwrap().is_none());
    }

    #[test]
    fn nine_saves_are_not_due_and_the_tenth_commits_a_checkpoint_named_for_the_open_time() {
        let (_root, path, repo, set) = after_commit(9, false);
        assert!(matches!(run(&repo, &set, "main"), Outcome::NotDue));
        // 3 hours open after the head's save, written the way the tracker does.
        repo.upsert_segment(
            &set,
            "main",
            &Segment {
                start: 1_000_000,
                end: 1_000_000 + 134 * 60_000,
                source: Source::Script,
            },
        )
        .unwrap();
        write_set(&path, "v10", 1_000_000 + 10 * 60_000);
        repo.record_save(&path).unwrap();

        let Outcome::Committed { commit, message } = run(&repo, &set, "main") else {
            panic!("a checkpoint was due");
        };

        assert_eq!(message, "checkpoint \u{b7} 2h 14m");
        let made = repo.read_commit(&commit).unwrap();
        assert_eq!(
            (made.kind, made.author.as_str()),
            (CommitKind::Checkpoint, "dit")
        );
        assert_eq!(repo.saves_since_commit(&set, "main").unwrap(), 0);
        // The two hours still count after the head's save, but there is nothing new to commit.
        assert!(matches!(run(&repo, &set, "main"), Outcome::Declined));
    }

    #[test]
    fn two_hours_open_make_one_due_without_ten_saves() {
        let (_root, _path, repo, set) = after_commit(1, false);
        repo.upsert_segment(
            &set,
            "main",
            &Segment {
                start: 1_000_000 + 60_000,
                end: 1_000_000 + 60_000 + OPEN_MS,
                source: Source::Script,
            },
        )
        .unwrap();
        assert!(matches!(
            run(&repo, &set, "main"),
            Outcome::Committed { .. }
        ));
    }

    #[test]
    fn ten_view_only_saves_are_due_but_declined_without_an_error() {
        let (_root, _path, repo, set) = after_commit(10, true);
        assert_eq!(repo.saves_since_commit(&set, "main").unwrap(), 10);
        assert!(!repo.working_changed(&set, "main").unwrap());

        assert!(matches!(run(&repo, &set, "main"), Outcome::Declined));
        assert!(
            matches!(run(&repo, &set, "main"), Outcome::Declined),
            "and again: still no error"
        );
    }

    #[test]
    fn an_unreadable_latest_save_is_declined() {
        let (_root, path, repo, set) = after_commit(0, false);
        for n in 1..=10 {
            write_set(&path, &format!("<broken/> v{n}"), 1_000_000 + n * 60_000);
            repo.record_save(&path).unwrap();
        }
        assert!(
            repo.read_save(&repo.log(&set, "main").unwrap().pop().unwrap())
                .unwrap()
                .unreadable
        );
        assert!(matches!(run(&repo, &set, "main"), Outcome::Declined));
    }
}
