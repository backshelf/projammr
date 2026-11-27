//! `adopt_sets` against a scripted hub: which body each set's adoption sends, what the repo records, and what the
//! push that follows still has to do.

use serde_json::{Value, json};

use super::test_support::*;
use super::{PushError, PushOptions, RemoteError, SetAdoption, SetTarget, adopt_sets, push};
use crate::repo::test_support::*;
use crate::repo::{PushedSet, RemoteBinding, Repo};

const PROJECT: i64 = 4;
const REPO_ID: i64 = 3;

fn ok(body: Value) -> (u16, String) {
    (200, body.to_string())
}

fn created_repo() -> (u16, String) {
    (201, json!({ "id": REPO_ID, "sets": [] }).to_string())
}

fn adopted(set: &str, session: i64) -> (u16, String) {
    (
        201,
        json!({ "ditSetId": set, "sessionId": session }).to_string(),
    )
}

fn taken() -> (u16, String) {
    (
        409,
        json!({ "error": "Session already belongs to a repo set" }).to_string(),
    )
}

fn paths(server: &MockServer) -> Vec<String> {
    server
        .requests()
        .iter()
        .map(|request| format!("{} {}", request.method, request.path))
        .collect()
}

/// A second set in the repo, with one save; returns its id.
fn another_set(repo: &Repo, file: &str) -> String {
    let first = set_id(repo);
    let path = repo.root().join(file);
    write_set(&path, &xml(3, 4, "other"));
    repo.record_save(&path).unwrap();
    repo.sets()
        .unwrap()
        .into_keys()
        .find(|id| *id != first)
        .unwrap()
}

fn target(set: &str, target: SetTarget) -> (String, SetTarget) {
    (set.to_string(), target)
}

#[test]
fn a_set_adopted_into_a_session_is_pushed_onto_it_and_the_push_adopts_nothing() {
    let (_root, repo) = repo();
    let save = save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    let server = MockServer::start(vec![
        created_repo(),
        adopted(&set, 812),
        ok(json!({ "saved": 1 })),
    ]);

    let adoption = adopt_sets(
        &repo,
        &remote_to(&server),
        PROJECT,
        &[target(&set, SetTarget::Session(812))],
        false,
    )
    .unwrap();

    assert_eq!(adoption.repo_id, REPO_ID);
    assert_eq!(
        adoption.sets,
        [(set.clone(), SetAdoption::Adopted { session_id: 812 })]
    );
    assert_eq!(
        paths(&server),
        ["POST /api/projects/4/repos", "POST /api/repos/3/sets"]
    );
    let expected_root = repo.root().to_string_lossy().into_owned();
    let expected_file = repo.root().join("Song.tset").to_string_lossy().into_owned();
    assert_eq!(
        server.requests()[0].json(),
        json!({ "name": "Song Project", "localPath": expected_root })
    );
    assert_eq!(
        server.requests()[1].json(),
        json!({
            "ditSetId": set,
            "fileName": "Song.tset",
            "sessionId": 812,
            "localPath": expected_root,
            "localFilepath": expected_file
        })
    );
    assert_eq!(
        repo.remote_binding().unwrap(),
        Some(RemoteBinding {
            instance: server.url.clone(),
            repo: REPO_ID,
        })
    );
    assert_eq!(repo.pushed(&set).unwrap().unwrap().session_id, 812);

    let options = PushOptions {
        saves_only: true,
        ..Default::default()
    };
    let report = push(&repo, &remote_to(&server), &options).unwrap();

    assert_eq!(paths(&server)[2..], ["POST /api/repos/3/saves".to_string()]);
    assert_eq!(server.requests()[2].json()["ditSetId"], json!(set));
    assert_eq!(report.bound, None);
    assert_eq!(report.branches[0].saves, 1);
    assert_eq!(
        repo.pushed(&set).unwrap().unwrap().branches["main"].saves,
        [save]
    );
}

#[test]
fn a_track_target_and_the_quiet_flag_go_in_the_body() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    let server = MockServer::start(vec![created_repo(), adopted(&set, 31)]);

    adopt_sets(
        &repo,
        &remote_to(&server),
        PROJECT,
        &[target(&set, SetTarget::Track(9))],
        true,
    )
    .unwrap();

    assert_eq!(
        server.requests()[1].json(),
        json!({
            "ditSetId": set,
            "fileName": "Song.tset",
            "trackId": 9,
            "quiet": true,
            "localPath": repo.root().to_string_lossy(),
            "localFilepath": repo.root().join("Song.tset").to_string_lossy(),
        })
    );
}

#[test]
fn a_new_track_is_made_first_and_sets_sent_to_the_same_new_track_share_it() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    let first = set_id(&repo);
    let second = another_set(&repo, "Other.tset");
    let server = MockServer::start(vec![
        created_repo(),
        (201, json!({ "id": 21 }).to_string()),
        adopted(&first, 31),
        adopted(&second, 32),
    ]);

    let adoption = adopt_sets(
        &repo,
        &remote_to(&server),
        PROJECT,
        &[
            target(&first, SetTarget::NewTrack("Song".into())),
            target(&second, SetTarget::NewTrack("Song".into())),
        ],
        false,
    )
    .unwrap();

    assert_eq!(
        paths(&server),
        [
            "POST /api/projects/4/repos",
            "POST /api/tracks",
            "POST /api/repos/3/sets",
            "POST /api/repos/3/sets",
        ]
    );
    assert_eq!(
        server.requests()[1].json(),
        json!({ "projectId": PROJECT, "title": "Song" })
    );
    assert_eq!(server.requests()[2].json()["trackId"], json!(21));
    assert_eq!(server.requests()[3].json()["trackId"], json!(21));
    assert_eq!(
        adoption.sets,
        [
            (first, SetAdoption::Adopted { session_id: 31 }),
            (second, SetAdoption::Adopted { session_id: 32 }),
        ]
    );
}

#[test]
fn a_taken_session_is_that_sets_refusal_and_the_other_sets_are_adopted() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    let first = set_id(&repo);
    let second = another_set(&repo, "Other.tset");
    let server = MockServer::start(vec![created_repo(), taken(), adopted(&second, 813)]);

    let adoption = adopt_sets(
        &repo,
        &remote_to(&server),
        PROJECT,
        &[
            target(&first, SetTarget::Session(812)),
            target(&second, SetTarget::Session(813)),
        ],
        false,
    )
    .unwrap();

    assert_eq!(
        adoption.sets,
        [
            (
                first.clone(),
                SetAdoption::Taken {
                    message: "Session already belongs to a repo set".into()
                }
            ),
            (second.clone(), SetAdoption::Adopted { session_id: 813 }),
        ]
    );
    assert_eq!(repo.pushed(&first).unwrap(), None);
    assert_eq!(repo.pushed(&second).unwrap().unwrap().session_id, 813);
}

#[test]
fn a_run_that_goes_again_asks_the_hub_about_the_sets_it_has_not_adopted() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    let first = set_id(&repo);
    let second = another_set(&repo, "Other.tset");
    let server = MockServer::start(vec![
        created_repo(),
        adopted(&first, 812),
        (500, json!({ "error": "Boom" }).to_string()),
        adopted(&second, 813),
    ]);
    let targets = [
        target(&first, SetTarget::Session(812)),
        target(&second, SetTarget::Session(813)),
    ];

    let error = adopt_sets(&repo, &remote_to(&server), PROJECT, &targets, false).unwrap_err();

    assert!(matches!(
        error,
        PushError::Remote(RemoteError::Refused { status: 500, .. })
    ));
    assert_eq!(repo.pushed(&first).unwrap().unwrap().session_id, 812);
    assert_eq!(repo.pushed(&second).unwrap(), None);

    let adoption = adopt_sets(&repo, &remote_to(&server), PROJECT, &targets, false).unwrap();

    // The repo is bound, so no repo is made again, and the adopted set is not asked about.
    assert_eq!(paths(&server)[3..], ["POST /api/repos/3/sets".to_string()]);
    assert_eq!(
        adoption.sets,
        [
            (first, SetAdoption::Adopted { session_id: 812 }),
            (second, SetAdoption::Adopted { session_id: 813 }),
        ]
    );
}

#[test]
fn a_set_the_repo_does_not_have_is_refused_before_any_request() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    let server = MockServer::start(vec![]);

    let error = adopt_sets(
        &repo,
        &remote_to(&server),
        PROJECT,
        &[target("no-such-set", SetTarget::Session(1))],
        false,
    )
    .unwrap_err();

    assert!(matches!(error, PushError::NoSuchSet(id) if id == "no-such-set"));
    assert!(server.requests().is_empty());
    assert_eq!(repo.remote_binding().unwrap(), None);
}

#[test]
fn a_repo_bound_to_another_instance_is_refused_before_any_request() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    repo.bind_remote(&RemoteBinding {
        instance: "https://elsewhere.example.com".into(),
        repo: 9,
    })
    .unwrap();
    let server = MockServer::start(vec![]);

    let error = adopt_sets(
        &repo,
        &remote_to(&server),
        PROJECT,
        &[target(&set, SetTarget::Session(1))],
        false,
    )
    .unwrap_err();

    assert!(matches!(error, PushError::OtherInstance { .. }));
    assert!(server.requests().is_empty());
}

#[test]
fn a_set_adopted_by_a_push_already_is_left_alone() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    let server = MockServer::start(vec![]);
    repo.bind_remote(&RemoteBinding {
        instance: server.url.clone(),
        repo: REPO_ID,
    })
    .unwrap();
    repo.write_pushed(
        &set,
        &PushedSet {
            instance: server.url.clone(),
            repo_id: REPO_ID,
            session_id: 11,
            branches: Default::default(),
        },
    )
    .unwrap();

    let adoption = adopt_sets(
        &repo,
        &remote_to(&server),
        PROJECT,
        &[target(&set, SetTarget::Session(812))],
        false,
    )
    .unwrap();

    assert_eq!(
        adoption.sets,
        [(set, SetAdoption::Adopted { session_id: 11 })]
    );
    assert!(server.requests().is_empty());
}
