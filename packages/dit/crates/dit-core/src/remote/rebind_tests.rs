//! `rebind` against a scripted instance: the repo starts bound to an old origin no test contacts, and the scripted
//! instance stands at the address it moved to.

use serde_json::json;

use super::test_support::*;
use super::{PushOptions, RebindError, Rebound, Remote, RemoteError, push, rebind};
use crate::repo::test_support::*;
use crate::repo::{PushedBranch, PushedSet, RemoteBinding, Repo, RepoError};

const OLD: &str = "http://old.example";
const REPO_ID: i64 = 3;

/// A set id with no set behind it, for a push record a rebind reads by its file alone.
const OTHER_SET: &str = "00000000000000ab";

/// A repo with one committed set, bound to `REPO_ID` at `OLD` with the set pushed in full; returns its set id.
fn pushed_at_old() -> (tempfile::TempDir, Repo, String) {
    let (root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    let commit = user_commit(&repo, &set, "main", "first idea");
    repo.bind_remote(&binding(OLD)).unwrap();
    repo.write_pushed(
        &set,
        &PushedSet {
            instance: OLD.to_string(),
            repo_id: REPO_ID,
            session_id: 11,
            branches: [(
                "main".to_string(),
                PushedBranch {
                    commit: Some(commit),
                    saves: repo.log(&set, "main").unwrap(),
                    lineage: Some(commit),
                    ..Default::default()
                },
            )]
            .into(),
        },
    )
    .unwrap();
    (root, repo, set)
}

fn binding(instance: &str) -> RemoteBinding {
    RemoteBinding {
        instance: instance.to_string(),
        repo: REPO_ID,
    }
}

/// A push record of `REPO_ID` at `instance` with nothing pushed.
fn record(instance: &str, repo_id: i64) -> PushedSet {
    PushedSet {
        instance: instance.to_string(),
        repo_id,
        session_id: 21,
        branches: Default::default(),
    }
}

/// The hub repo as the instance answers it, adopting each of `sets` (set id, session id).
fn repo_answer(sets: &[(&str, i64)]) -> (u16, String) {
    let sets: Vec<_> = sets
        .iter()
        .map(|(id, session)| json!({ "ditSetId": id, "sessionId": session }))
        .collect();
    (
        200,
        json!({
            "id": REPO_ID,
            "projectId": 1,
            "name": "Song Project",
            "sets": sets,
            "pushSamples": false,
            "pushSamplesForced": false,
        })
        .to_string(),
    )
}

fn never_opened() -> Result<Remote, RemoteError> {
    panic!("the remote is not opened")
}

#[test]
fn a_rebind_moves_the_config_and_the_set_records_and_the_next_push_goes_to_the_new_origin() {
    let (_root, repo, set) = pushed_at_old();
    let server = MockServer::start(vec![
        repo_answer(&[(&set, 11)]),
        repo_answer(&[(&set, 11)]),
        (200, json!({ "saved": 1 }).to_string()),
    ]);

    let rebound = rebind(&repo, &server.url, || Ok(remote_to(&server))).unwrap();

    assert_eq!(
        rebound,
        Rebound {
            from: OLD.to_string(),
            to: server.url.clone(),
            sets: 1,
        }
    );
    assert_eq!(repo.remote_binding().unwrap(), Some(binding(&server.url)));
    let moved = repo.pushed(&set).unwrap().unwrap();
    assert_eq!(moved.instance, server.url);
    assert_eq!((moved.repo_id, moved.session_id), (REPO_ID, 11));

    let file = set_path(&repo);
    write_set(&file, &xml(1, 3, "second"));
    repo.record_save(&file).unwrap();
    let report = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap();

    let paths: Vec<String> = server
        .requests()
        .iter()
        .map(|request| format!("{} {}", request.method, request.path))
        .collect();
    assert_eq!(
        paths,
        [
            "GET /api/repos/3",
            "GET /api/repos/3",
            "POST /api/repos/3/saves"
        ]
    );
    assert_eq!(report.bound, None);
    assert_eq!(
        (report.branches[0].saves, report.branches[0].commits),
        (1, 0)
    );
}

#[test]
fn an_instance_that_does_not_show_the_repo_refuses_with_nothing_written() {
    for status in [403, 404] {
        let (_root, repo, set) = pushed_at_old();
        let before = repo.pushed(&set).unwrap();
        let server = MockServer::start(vec![(status, json!({ "error": "Not found" }).to_string())]);

        let error = rebind(&repo, &server.url, || Ok(remote_to(&server))).unwrap_err();

        assert_eq!(
            error.to_string(),
            format!(
                "{} has no repo 3; this repo stays bound to {OLD}.",
                server.url
            )
        );
        assert_eq!(repo.remote_binding().unwrap(), Some(binding(OLD)));
        assert_eq!(repo.pushed(&set).unwrap(), before);
    }
}

#[test]
fn a_repo_that_does_not_list_every_pushed_set_under_its_session_refuses_with_nothing_written() {
    let other = record(OLD, REPO_ID);
    type Listed = fn(&str) -> Vec<(&str, i64)>;
    let cases: [(Listed, &str); 2] = [
        (|_| vec![(OTHER_SET, 21)], "a pushed set is missing"),
        (
            |set| vec![(set, 12), (OTHER_SET, 21)],
            "a set under another session",
        ),
    ];
    for (listed, why) in cases {
        let (_root, repo, set) = pushed_at_old();
        repo.write_pushed(OTHER_SET, &other).unwrap();
        let listed = listed(&set);
        let before = (repo.pushed(&set).unwrap(), repo.pushed(OTHER_SET).unwrap());
        let server = MockServer::start(vec![repo_answer(&listed)]);

        let error = rebind(&repo, &server.url, || Ok(remote_to(&server))).unwrap_err();

        assert_eq!(
            error.to_string(),
            format!(
                "{}'s repo 3 does not hold this repo's sets; this repo stays bound to {OLD}.",
                server.url
            ),
            "{why}"
        );
        assert_eq!(repo.remote_binding().unwrap(), Some(binding(OLD)), "{why}");
        assert_eq!(
            (repo.pushed(&set).unwrap(), repo.pushed(OTHER_SET).unwrap()),
            before,
            "{why}"
        );
    }
}

#[test]
fn a_repo_that_lists_every_pushed_set_under_its_session_rebinds() {
    let (_root, repo, set) = pushed_at_old();
    repo.write_pushed(OTHER_SET, &record(OLD, REPO_ID)).unwrap();
    let server = MockServer::start(vec![repo_answer(&[(&set, 11), (OTHER_SET, 21), ("ff", 5)])]);

    let rebound = rebind(&repo, &server.url, || Ok(remote_to(&server))).unwrap();

    assert_eq!(rebound.sets, 2);
    assert_eq!(repo.remote_binding().unwrap(), Some(binding(&server.url)));
}

#[test]
fn any_other_refusal_passes_through_with_nothing_written() {
    let (_root, repo, set) = pushed_at_old();
    let server = MockServer::start(vec![(500, json!({ "error": "boom" }).to_string())]);

    let error = rebind(&repo, &server.url, || Ok(remote_to(&server))).unwrap_err();

    assert!(
        matches!(
            error,
            RebindError::Remote(RemoteError::Refused { status: 500, .. })
        ),
        "{error:?}"
    );
    assert_eq!(repo.remote_binding().unwrap(), Some(binding(OLD)));
    assert_eq!(repo.pushed(&set).unwrap().unwrap().instance, OLD);
}

#[test]
fn a_url_dit_is_not_signed_in_to_is_refused_before_any_request() {
    let (_root, repo, set) = pushed_at_old();
    let server = MockServer::start(vec![]);

    let error = rebind(&repo, "https://hub.example.com/projects", || {
        Ok(remote_to(&server))
    })
    .unwrap_err();

    assert_eq!(
        error.to_string(),
        format!(
            "This repo would push to https://hub.example.com; dit is signed in to {}. Run dit login https://hub.example.com.",
            server.url
        )
    );
    assert_eq!(server.requests().len(), 0);
    assert_eq!(repo.remote_binding().unwrap(), Some(binding(OLD)));
    assert_eq!(repo.pushed(&set).unwrap().unwrap().instance, OLD);
}

#[test]
fn the_origin_the_repo_is_bound_to_needs_no_sign_in_and_writes_nothing() {
    let (_root, repo, set) = pushed_at_old();
    let before = repo.pushed(&set).unwrap();

    let rebound = rebind(&repo, "HTTP://Old.Example/some/page", never_opened).unwrap();

    assert_eq!(
        rebound,
        Rebound {
            from: OLD.to_string(),
            to: OLD.to_string(),
            sets: 0,
        }
    );
    assert_eq!(repo.remote_binding().unwrap(), Some(binding(OLD)));
    assert_eq!(repo.pushed(&set).unwrap(), before);
}

#[test]
fn an_unbound_repo_has_nothing_to_move() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));

    let error = rebind(&repo, "https://hub.example.com", never_opened).unwrap_err();

    assert!(matches!(error, RebindError::NotBound), "{error:?}");
    assert_eq!(repo.remote_binding().unwrap(), None);
}

#[test]
fn records_for_another_hub_repo_or_instance_are_left_alone() {
    let (_root, repo, set) = pushed_at_old();
    let other_repo = record(OLD, REPO_ID + 1);
    repo.write_pushed(OTHER_SET, &other_repo).unwrap();
    let third_set = "00000000000000cd";
    let other_instance = record("http://elsewhere.example", REPO_ID);
    repo.write_pushed(third_set, &other_instance).unwrap();
    let server = MockServer::start(vec![repo_answer(&[(&set, 11)])]);

    let rebound = rebind(&repo, &server.url, || Ok(remote_to(&server))).unwrap();

    assert_eq!(rebound.sets, 1);
    assert_eq!(repo.pushed(&set).unwrap().unwrap().instance, server.url);
    assert_eq!(repo.pushed(OTHER_SET).unwrap(), Some(other_repo));
    assert_eq!(repo.pushed(third_set).unwrap(), Some(other_instance));
}

#[test]
fn a_rebind_that_stopped_before_the_config_is_finished_by_running_it_again() {
    let (_root, repo, set) = pushed_at_old();
    let server = MockServer::start(vec![repo_answer(&[(&set, 11)])]);
    let already_moved = record(&server.url, REPO_ID);
    repo.write_pushed(OTHER_SET, &already_moved).unwrap();

    let rebound = rebind(&repo, &server.url, || Ok(remote_to(&server))).unwrap();

    assert_eq!(rebound.sets, 1);
    assert_eq!(repo.remote_binding().unwrap(), Some(binding(&server.url)));
    assert_eq!(repo.pushed(&set).unwrap().unwrap().instance, server.url);
    assert_eq!(repo.pushed(OTHER_SET).unwrap(), Some(already_moved));
}

#[test]
fn a_binding_that_changed_since_it_was_checked_is_refused_with_nothing_written() {
    let (_root, repo, set) = pushed_at_old();

    let error = repo
        .rebind_remote(&binding("http://checked.example"), "http://new.example")
        .unwrap_err();

    assert_eq!(error, RepoError::RemoteChanged);
    assert_eq!(repo.remote_binding().unwrap(), Some(binding(OLD)));
    assert_eq!(repo.pushed(&set).unwrap().unwrap().instance, OLD);
}
