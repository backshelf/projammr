//! `push` and `pending` against a scripted hub. A push's requests come in a fixed order, so each test scripts the
//! hub's answers in that order and works out the objects it expects from the repo itself.

use std::collections::HashSet;
use std::ops::ControlFlow;

use serde_json::{Value, json};

use super::pack::{packs, save_objects};
use super::push::{Batching, push_batched};
use super::test_support::*;
use super::{
    Bound, BranchPush, Client, Instance, Pending, PushError, PushOptions, PushProgress, PushReport,
    Remote, RemoteError, Token, pending, push, push_observed,
};
use crate::repo::test_support::*;
use crate::repo::{PushedBranch, PushedSet, RemoteBinding, Repo, Segment, Source};
use crate::store::{ObjectId, ObjectKind};

const REPO_ID: i64 = 3;

fn ok(body: Value) -> (u16, String) {
    (200, body.to_string())
}

fn refused(status: u16, message: &str) -> (u16, String) {
    (status, json!({ "error": message }).to_string())
}

fn hexes(ids: &[ObjectId]) -> Vec<String> {
    ids.iter().map(ObjectId::to_string).collect()
}

fn ids_of(objects: &[(ObjectId, ObjectKind)]) -> Vec<ObjectId> {
    objects.iter().map(|(id, _)| *id).collect()
}

/// The objects `saves` list, deduplicated, in the order a push gathers them.
fn objects_of(repo: &Repo, saves: &[ObjectId]) -> Vec<(ObjectId, ObjectKind)> {
    let mut seen = HashSet::new();
    let mut objects = Vec::new();
    for id in saves {
        let save = repo.read_save(id).unwrap();
        for (id, kind) in save_objects(repo.store(), &save).unwrap() {
            if seen.insert(id) {
                objects.push((id, kind));
            }
        }
    }
    objects
}

/// `objects` less any that `held` lists.
fn without(
    objects: &[(ObjectId, ObjectKind)],
    held: &[(ObjectId, ObjectKind)],
) -> Vec<(ObjectId, ObjectKind)> {
    objects
        .iter()
        .filter(|object| !held.contains(object))
        .copied()
        .collect()
}

fn repo_state() -> (u16, String) {
    repo_state_with(false, false)
}

fn repo_state_with(enabled: bool, forced: bool) -> (u16, String) {
    ok(json!({
        "id": REPO_ID,
        "sets": [],
        "pushSamples": enabled,
        "pushSamplesForced": forced,
    }))
}

fn missing(objects: &[(ObjectId, ObjectKind)]) -> (u16, String) {
    ok(json!({ "missing": hexes(&ids_of(objects)) }))
}

fn limits(max_bytes: usize) -> (u16, String) {
    ok(json!({ "maxBytes": max_bytes, "audioTypes": [], "imageTypes": [] }))
}

/// The ids a lineage batch of `commits` asks the hub about: each commit's own save, then the commit.
fn lineage_ids(repo: &Repo, commits: &[ObjectId]) -> Vec<ObjectId> {
    commits
        .iter()
        .flat_map(|commit| [repo.read_commit(commit).unwrap().save, *commit])
        .collect()
}

/// The kind byte of each record of `pack`, by id: `id (32) ‖ kind (1) ‖ frame length (u32 LE) ‖ frame`.
fn record_kinds(pack: &[u8]) -> Vec<(ObjectId, u8)> {
    let mut kinds = Vec::new();
    let mut rest = pack;
    while !rest.is_empty() {
        let id = ObjectId::from_bytes(rest[..32].try_into().unwrap());
        let length = u32::from_le_bytes(rest[33..37].try_into().unwrap()) as usize;
        kinds.push((id, rest[32]));
        rest = &rest[37 + length..];
    }
    kinds
}

/// The packs a push of `objects` sends under `max_bytes`.
fn packs_of(repo: &Repo, objects: &[(ObjectId, ObjectKind)], max_bytes: usize) -> Vec<Vec<u8>> {
    packs(repo.store(), objects, max_bytes)
        .collect::<Result<_, _>>()
        .unwrap()
}

/// Binds the repo to `server` as `REPO_ID`, as if a push to it had bound it.
fn bind_to(repo: &Repo, server: &MockServer) {
    bind_to_repo(repo, server, REPO_ID);
}

/// Binds the repo to the hub repo `id` on `server`.
fn bind_to_repo(repo: &Repo, server: &MockServer, id: i64) {
    repo.bind_remote(&RemoteBinding {
        instance: server.url.clone(),
        repo: id,
    })
    .unwrap();
}

/// Binds the repo to `server` with the set adopted and nothing of it pushed.
fn adopted(repo: &Repo, server: &MockServer, set: &str) {
    bind_to(repo, server);
    repo.write_pushed(
        set,
        &PushedSet {
            instance: server.url.clone(),
            repo_id: REPO_ID,
            session_id: 11,
            branches: Default::default(),
        },
    )
    .unwrap();
}

fn path(server: &MockServer, at: usize) -> String {
    server.requests()[at].path.clone()
}

fn body(server: &MockServer, at: usize) -> Value {
    server.requests()[at].json()
}

fn paths(server: &MockServer) -> Vec<String> {
    server
        .requests()
        .iter()
        .map(|request| format!("{} {}", request.method, request.path))
        .collect()
}

fn projects(names: &[&str]) -> (u16, String) {
    let projects = names
        .iter()
        .enumerate()
        .map(|(at, name)| json!({ "id": at + 1, "name": name, "trackCount": 0 }))
        .collect::<Vec<_>>();
    ok(json!(projects))
}

fn for_project(project: &str) -> PushOptions {
    PushOptions {
        project: Some(project.to_string()),
        ..Default::default()
    }
}

#[test]
fn a_first_push_binds_the_repo_and_sends_the_saves_objects_and_commit() {
    let (_root, repo) = repo();
    let save = save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    let commit = user_commit(&repo, &set, "main", "first idea");
    let objects = objects_of(&repo, &[save]);
    let max_bytes = 1 << 20;
    let pack = packs_of(&repo, &objects, max_bytes);
    assert_eq!(pack.len(), 1);
    let server = MockServer::start(vec![
        projects(&["Album"]),
        (201, json!({ "id": REPO_ID, "sets": [] }).to_string()),
        repo_state(),
        (201, json!({ "ditSetId": set, "sessionId": 11 }).to_string()),
        ok(json!({ "saved": 1 })),
        missing(&objects),
        limits(max_bytes),
        ok(json!({ "stored": objects.len(), "known": 0 })),
        ok(json!({ "inserted": 1 })),
        missing(&[]),
        ok(json!({ "inserted": 1 })),
    ]);

    let report = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap();

    assert_eq!(
        paths(&server),
        [
            "GET /api/me/projects",
            "POST /api/projects/1/repos",
            "GET /api/repos/3",
            "POST /api/repos/3/sets",
            "POST /api/repos/3/saves",
            "POST /api/repos/3/objects/missing",
            "GET /api/uploads/limits",
            "POST /api/repos/3/objects",
            "POST /api/repos/3/commits",
            "POST /api/repos/3/objects/missing",
            "POST /api/repos/3/commits",
        ]
    );
    assert_eq!(
        body(&server, 1),
        json!({
            "name": "Song Project",
            "localPath": repo.root().to_string_lossy(),
        })
    );
    assert_eq!(
        body(&server, 3),
        json!({
            "ditSetId": set,
            "fileName": "Song.tset",
            "localPath": repo.root().to_string_lossy(),
            "localFilepath": repo.root().join("Song.tset").to_string_lossy(),
        })
    );
    let recorded = repo.read_save(&save).unwrap();
    let saves = body(&server, 4);
    assert_eq!(saves["ditSetId"], json!(set));
    assert_eq!(saves["branch"], json!("main"));
    assert_eq!(saves["localPath"], json!(repo.root().to_string_lossy()));
    assert_eq!(
        saves["localFilepath"],
        json!(repo.root().join("Song.tset").to_string_lossy())
    );
    assert_eq!(
        saves["saves"],
        json!([{
            "hash": save.to_string(),
            "xmlHash": recorded.xml_hash,
            "tree": recorded.tree.unwrap().to_string(),
            "side": recorded.side.unwrap().to_string(),
            "fileUpdatedAt": recorded.file_updated_at,
            "machineName": recorded.machine,
            "meta": saves["saves"][0]["meta"],
            "viewOnly": false,
            "unreadable": false,
            "samples": [],
        }])
    );
    assert_eq!(
        body(&server, 5),
        json!({ "hashes": hexes(&ids_of(&objects)) })
    );
    {
        let requests = server.requests();
        assert_eq!(
            requests[7].header("content-type"),
            Some("application/octet-stream")
        );
        assert_eq!(requests[7].body, pack[0]);
    }
    let made = repo.read_commit(&commit).unwrap();
    assert_eq!(
        body(&server, 8),
        json!({
            "ditSetId": set,
            "branch": "main",
            "commits": [{
                "hash": commit.to_string(),
                "saveHash": save.to_string(),
                "parentHash": null,
                "message": "first idea",
                "kind": "user",
                "committedAt": made.at,
                "machineName": recorded.machine,
                "saves": [{ "hash": save.to_string(), "objects": hexes(&ids_of(&objects)) }],
                "sampleObjects": [],
            }],
        })
    );
    let lineage = lineage_ids(&repo, &[commit]);
    assert_eq!(body(&server, 9), json!({ "hashes": hexes(&lineage) }));
    let reposted = body(&server, 10);
    assert_eq!(reposted["commits"].as_array().unwrap().len(), 1);
    assert_eq!(reposted["commits"][0]["hash"], json!(commit.to_string()));
    assert_eq!(
        reposted["commits"][0]["lineageObjects"],
        json!(hexes(&lineage))
    );

    assert_eq!(
        report,
        PushReport {
            bound: Some(Bound {
                project: "Album".into(),
                repo_id: REPO_ID,
            }),
            branches: vec![BranchPush {
                set_id: set.clone(),
                branch: "main".into(),
                saves: 1,
                commits: 1,
                objects_stored: objects.len(),
                objects_known: 0,
                objects_claimed: 0,
                segments: 0,
                lineage: 1,
                samples: Default::default(),
            }],
        }
    );
    assert_eq!(
        repo.remote_binding().unwrap(),
        Some(RemoteBinding {
            instance: server.url.clone(),
            repo: REPO_ID,
        })
    );
    assert_eq!(
        repo.pushed(&set).unwrap(),
        Some(PushedSet {
            instance: server.url.clone(),
            repo_id: REPO_ID,
            session_id: 11,
            branches: [(
                "main".to_string(),
                PushedBranch {
                    commit: Some(commit),
                    saves: vec![save],
                    lineage: Some(commit),
                    ..Default::default()
                },
            )]
            .into(),
        })
    );
    assert_eq!(pending(&repo, None).unwrap(), []);
}

#[test]
fn a_save_sends_its_meta_with_exactly_the_keys_the_hub_takes() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    let server = MockServer::start(vec![repo_state(), ok(json!({ "saved": 1 }))]);
    adopted(&repo, &server, &set);

    push(&repo, &remote_to(&server), &PushOptions::default()).unwrap();

    let meta = &body(&server, 1)["saves"][0]["meta"];
    let mut keys = meta
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    keys.sort();
    assert_eq!(
        keys,
        [
            "dawVersion",
            "rootNote",
            "samplePaths",
            "scale",
            "scenesCount",
            "structure",
            "tempo",
            "timeSignature",
            "tracksCount",
        ]
    );
}

#[test]
fn a_second_push_sends_only_the_new_saves_and_the_objects_the_hub_lacks() {
    let (_root, repo) = repo();
    let first = save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    let parent = user_commit(&repo, &set, "main", "first idea");
    let first_objects = objects_of(&repo, &[first]);
    let max_bytes = 1 << 20;
    let first_hub = MockServer::start(vec![
        projects(&["Album"]),
        ok(json!({ "id": REPO_ID })),
        repo_state(),
        ok(json!({ "ditSetId": set, "sessionId": 11 })),
        ok(json!({ "saved": 1 })),
        missing(&first_objects),
        limits(max_bytes),
        ok(json!({ "stored": first_objects.len(), "known": 0 })),
        ok(json!({ "inserted": 1 })),
        missing(&[]),
        ok(json!({ "inserted": 1 })),
    ]);
    push(&repo, &remote_to(&first_hub), &PushOptions::default()).unwrap();

    let between = save_main(&repo, &xml(1, 2, "second"));
    let latest = save_main(&repo, &xml(1, 2, "third"));
    let commit = user_commit(&repo, &set, "main", "second idea");
    let listed = objects_of(&repo, &[between, latest]);
    let lacking = without(&listed, &first_objects);
    assert!(!lacking.is_empty() && lacking.len() < listed.len());
    let pack = packs_of(&repo, &lacking, max_bytes);
    let server = MockServer::start(vec![
        repo_state(),
        ok(json!({ "saved": 2 })),
        missing(&lacking),
        limits(max_bytes),
        ok(json!({ "stored": lacking.len(), "known": 0 })),
        ok(json!({ "inserted": 1 })),
        missing(&[]),
        ok(json!({ "inserted": 1 })),
    ]);
    // The same instance, met at a new port.
    bind_to(&repo, &server);
    let mut pushed = repo.pushed(&set).unwrap().unwrap();
    pushed.instance = server.url.clone();
    repo.write_pushed(&set, &pushed).unwrap();

    let report = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap();

    assert_eq!(
        paths(&server),
        [
            "GET /api/repos/3",
            "POST /api/repos/3/saves",
            "POST /api/repos/3/objects/missing",
            "GET /api/uploads/limits",
            "POST /api/repos/3/objects",
            "POST /api/repos/3/commits",
            "POST /api/repos/3/objects/missing",
            "POST /api/repos/3/commits",
        ]
    );
    let saves = body(&server, 1)["saves"]
        .as_array()
        .unwrap()
        .iter()
        .map(|save| save["hash"].clone())
        .collect::<Vec<_>>();
    assert_eq!(
        saves,
        [json!(between.to_string()), json!(latest.to_string())]
    );
    assert_eq!(
        body(&server, 2),
        json!({ "hashes": hexes(&ids_of(&listed)) })
    );
    assert_eq!(server.requests()[4].body, pack.concat());
    let commits = &body(&server, 5)["commits"];
    assert_eq!(commits.as_array().unwrap().len(), 1);
    assert_eq!(commits[0]["hash"], json!(commit.to_string()));
    assert_eq!(commits[0]["parentHash"], json!(parent.to_string()));
    assert_eq!(
        commits[0]["saves"]
            .as_array()
            .unwrap()
            .iter()
            .map(|save| save["hash"].clone())
            .collect::<Vec<_>>(),
        [json!(between.to_string()), json!(latest.to_string())]
    );
    assert_eq!(report.bound, None);
    assert_eq!(report.branches[0].saves, 2);
    assert_eq!(report.branches[0].commits, 1);
    assert_eq!(report.branches[0].lineage, 1);
    assert_eq!(
        body(&server, 6),
        json!({ "hashes": hexes(&lineage_ids(&repo, &[commit])) })
    );
    assert_eq!(body(&server, 7)["commits"].as_array().unwrap().len(), 1);
    assert_eq!(
        repo.pushed(&set).unwrap().unwrap().branches["main"],
        PushedBranch {
            commit: Some(commit),
            saves: vec![first, between, latest],
            lineage: Some(commit),
            ..Default::default()
        }
    );
}

#[test]
fn a_cap_refusal_on_a_pack_keeps_the_saves_sent_and_leaves_the_commit_pending() {
    let (_root, repo) = repo();
    let save = save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    user_commit(&repo, &set, "main", "first idea");
    let objects = objects_of(&repo, &[save]);
    let message = "This instance is out of storage. Ask its admin for more.";
    let server = MockServer::start(vec![
        repo_state(),
        ok(json!({ "saved": 1 })),
        missing(&objects),
        limits(1 << 20),
        (
            413,
            json!({ "error": message, "code": "storage_limit" }).to_string(),
        ),
    ]);
    adopted(&repo, &server, &set);

    let error = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap_err();

    assert_eq!(error.to_string(), message);
    assert_eq!(server.requests().len(), 5);
    assert_eq!(
        repo.pushed(&set).unwrap().unwrap().branches["main"],
        PushedBranch {
            commit: None,
            saves: vec![save],
            ..Default::default()
        }
    );
    assert_eq!(
        pending(&repo, None).unwrap(),
        [Pending {
            set_id: set,
            branch: "main".into(),
            saves: 0,
            commits: 1,
            samples: 0,
        }]
    );
}

#[test]
fn an_unreachable_hub_stops_the_push_with_nothing_recorded() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    user_commit(&repo, &set, "main", "first idea");
    // A port nothing listens on any more.
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let remote = Remote::new(
        Client::new(
            Instance::parse(&format!("http://127.0.0.1:{port}")).unwrap(),
            "Studio iMac".to_string(),
        ),
        Token::new(TOKEN.to_string()),
    );

    let error = push(&repo, &remote, &PushOptions::default()).unwrap_err();

    assert_eq!(
        error.to_string(),
        format!("Can't reach 127.0.0.1:{port}. Saved here; dit push when it's back.")
    );
    assert_eq!(repo.remote_binding().unwrap(), None);
    assert_eq!(repo.pushed(&set).unwrap(), None);
}

#[test]
fn a_hub_that_stops_answering_a_push_says_the_work_is_kept_where_a_plain_timeout_does_not() {
    let timed_out = || RemoteError::TimedOut {
        host: "hub.example".to_string(),
    };

    assert_eq!(
        PushError::from(timed_out()).to_string(),
        "hub.example took too long to answer. Saved here; dit push to try again."
    );
    assert_eq!(
        timed_out().to_string(),
        "hub.example took too long to answer."
    );
}

#[test]
fn a_checked_out_branch_goes_up_after_main_with_its_fork_as_the_first_parent() {
    let (_root, repo) = repo();
    let save = save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    let fork = user_commit(&repo, &set, "main", "first idea");
    let file = repo.checkout_new_branch(&fork, "idea").unwrap();
    write_set(&file, &xml(1, 2, "elsewhere"));
    let idea_save = repo.record_save(&file).unwrap().unwrap();
    let idea = user_commit(&repo, &set, "idea", "try it");
    let main_objects = objects_of(&repo, &[save]);
    let idea_objects = without(&objects_of(&repo, &[idea_save]), &main_objects);
    let server = MockServer::start(vec![
        repo_state(),
        ok(json!({ "saved": 1 })),
        missing(&main_objects),
        limits(1 << 20),
        ok(json!({ "stored": main_objects.len(), "known": 0 })),
        ok(json!({ "inserted": 1 })),
        missing(&[]),
        ok(json!({ "inserted": 1 })),
        ok(json!({ "saved": 1 })),
        missing(&idea_objects),
        ok(json!({ "stored": idea_objects.len(), "known": 0 })),
        ok(json!({ "inserted": 1 })),
        missing(&[]),
        ok(json!({ "inserted": 1 })),
    ]);
    adopted(&repo, &server, &set);

    let report = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap();

    assert_eq!(server.requests().len(), 14);
    assert_eq!(path(&server, 5), "/api/repos/3/commits");
    assert_eq!(body(&server, 5)["branch"], json!("main"));
    let commits = body(&server, 11);
    assert_eq!(commits["branch"], json!("idea"));
    assert_eq!(commits["commits"][0]["hash"], json!(idea.to_string()));
    assert_eq!(commits["commits"][0]["parentHash"], json!(fork.to_string()));
    assert_eq!(
        report
            .branches
            .iter()
            .map(|branch| branch.branch.as_str())
            .collect::<Vec<_>>(),
        ["main", "idea"]
    );
    let pushed = repo.pushed(&set).unwrap().unwrap();
    assert_eq!(pushed.branches["idea"].commit, Some(idea));
    assert_eq!(pushed.branches["main"].commit, Some(fork));
    assert_eq!(pushed.branches["main"].lineage, Some(fork));
    assert_eq!(pushed.branches["idea"].lineage, Some(idea));
}

#[test]
fn a_branch_checked_out_from_another_branch_waits_for_it_whatever_their_names() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    let root = user_commit(&repo, &set, "main", "first idea");
    let later_file = repo.checkout_new_branch(&root, "later").unwrap();
    write_set(&later_file, &xml(1, 2, "later"));
    repo.record_save(&later_file).unwrap();
    let later = user_commit(&repo, &set, "later", "on later");
    let early_file = repo.checkout_new_branch(&later, "early").unwrap();
    write_set(&early_file, &xml(1, 2, "early"));
    repo.record_save(&early_file).unwrap();
    let early = user_commit(&repo, &set, "early", "on early");
    let branch_push = || {
        [
            ok(json!({ "saved": 1 })),
            ok(json!({ "missing": [] })),
            ok(json!({ "inserted": 1 })),
            ok(json!({ "missing": [] })),
            ok(json!({ "inserted": 1 })),
        ]
    };
    let server = MockServer::start(
        std::iter::once(repo_state())
            .chain(branch_push().into_iter().cycle().take(15))
            .collect(),
    );
    adopted(&repo, &server, &set);

    push(&repo, &remote_to(&server), &PushOptions::default()).unwrap();

    let commits = [3, 8, 13].map(|at| body(&server, at));
    assert_eq!(
        commits.each_ref().map(|body| body["branch"].clone()),
        [json!("main"), json!("later"), json!("early")]
    );
    assert_eq!(commits[2]["commits"][0]["hash"], json!(early.to_string()));
    assert_eq!(
        commits[2]["commits"][0]["parentHash"],
        json!(later.to_string())
    );
}

#[test]
fn a_branch_checked_out_from_a_branch_the_set_no_longer_lists_is_refused_before_any_request() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    let root = user_commit(&repo, &set, "main", "first idea");
    let later_file = repo.checkout_new_branch(&root, "later").unwrap();
    write_set(&later_file, &xml(1, 2, "later"));
    repo.record_save(&later_file).unwrap();
    let later = user_commit(&repo, &set, "later", "on later");
    repo.checkout_new_branch(&later, "early").unwrap();
    let sets_file = repo.root().join(".dit").join("sets.toml");
    let listed = std::fs::read_to_string(&sets_file).unwrap();
    let unlisted = listed
        .lines()
        .filter(|line| !line.starts_with("later "))
        .collect::<Vec<_>>()
        .join("\n");
    assert_ne!(listed.trim_end(), unlisted);
    std::fs::write(&sets_file, unlisted).unwrap();
    let server = MockServer::start(vec![]);
    adopted(&repo, &server, &set);

    let error = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap_err();

    assert_eq!(
        error.to_string(),
        "Can't push branch early: it was checked out from branch later, which can't be pushed before it."
    );
    assert_eq!(server.requests().len(), 0);
}

#[test]
fn a_refusal_for_objects_not_held_asks_again_once_then_gives_up() {
    let (_root, repo) = repo();
    let save = save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    user_commit(&repo, &set, "main", "first idea");
    let objects = objects_of(&repo, &[save]);
    let message = "Objects not held by this repo: abc";
    let stored = ok(json!({ "stored": objects.len(), "known": 0 }));
    let server = MockServer::start(vec![
        repo_state(),
        ok(json!({ "saved": 1 })),
        missing(&objects),
        limits(1 << 20),
        stored.clone(),
        refused(409, message),
        missing(&objects),
        stored,
        refused(409, message),
    ]);
    adopted(&repo, &server, &set);

    let error = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap_err();

    assert_eq!(error.to_string(), message);
    assert_eq!(
        paths(&server)[5..],
        [
            "POST /api/repos/3/commits",
            "POST /api/repos/3/objects/missing",
            "POST /api/repos/3/objects",
            "POST /api/repos/3/commits",
        ]
    );
    assert_eq!(
        repo.pushed(&set).unwrap().unwrap().branches["main"].commit,
        None
    );
}

#[test]
fn a_refusal_for_objects_not_held_then_a_success_records_the_commit() {
    let (_root, repo) = repo();
    let save = save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    let commit = user_commit(&repo, &set, "main", "first idea");
    let objects = objects_of(&repo, &[save]);
    let server = MockServer::start(vec![
        repo_state(),
        ok(json!({ "saved": 1 })),
        missing(&objects),
        limits(1 << 20),
        ok(json!({ "stored": objects.len(), "known": 0 })),
        refused(409, "Objects not held by this repo: abc"),
        missing(&objects[..1]),
        ok(json!({ "stored": 0, "known": 1 })),
        ok(json!({ "inserted": 1 })),
        missing(&[]),
        ok(json!({ "inserted": 1 })),
    ]);
    adopted(&repo, &server, &set);

    let report = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap();

    assert_eq!(server.requests().len(), 11);
    assert_eq!(report.branches[0].objects_stored, objects.len());
    assert_eq!(report.branches[0].objects_known, 1);
    assert_eq!(
        repo.pushed(&set).unwrap().unwrap().branches["main"].commit,
        Some(commit)
    );
}

#[test]
fn a_small_upload_limit_splits_the_objects_into_several_packs() {
    let (_root, repo) = repo();
    let save = save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    user_commit(&repo, &set, "main", "first idea");
    let objects = objects_of(&repo, &[save]);
    let max_bytes = objects
        .iter()
        .map(|(id, _)| 32 + 1 + 4 + repo.store().raw(id).unwrap().len())
        .max()
        .unwrap();
    let sent = packs_of(&repo, &objects, max_bytes);
    assert!(sent.len() > 1);
    let mut replies = vec![
        repo_state(),
        ok(json!({ "saved": 1 })),
        missing(&objects),
        limits(max_bytes),
    ];
    replies.extend(sent.iter().map(|_| ok(json!({ "stored": 1, "known": 0 }))));
    replies.push(ok(json!({ "inserted": 1 })));
    replies.extend([missing(&[]), ok(json!({ "inserted": 1 }))]);
    let server = MockServer::start(replies);
    adopted(&repo, &server, &set);

    let report = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap();

    let requests = server.requests();
    let uploaded = requests
        .iter()
        .filter(|request| request.path == "/api/repos/3/objects")
        .map(|request| request.body.clone())
        .collect::<Vec<_>>();
    assert_eq!(uploaded, sent);
    assert_eq!(report.branches[0].objects_stored, sent.len());
}

type Objects = Vec<(ObjectId, ObjectKind)>;

/// Saves one document and commits it, under an upload limit that splits its objects into several packs: the set
/// id, the save, the objects, the limit and the packs a push sends.
fn several_packs(repo: &Repo) -> (String, ObjectId, Objects, usize, Vec<Vec<u8>>) {
    let save = save_main(repo, &xml(1, 2, "first"));
    let set = set_id(repo);
    user_commit(repo, &set, "main", "first idea");
    let objects = objects_of(repo, &[save]);
    let max_bytes = objects
        .iter()
        .map(|(id, _)| 32 + 1 + 4 + repo.store().raw(id).unwrap().len())
        .max()
        .unwrap();
    let sent = packs_of(repo, &objects, max_bytes);
    assert!(sent.len() > 1);
    (set, save, objects, max_bytes, sent)
}

#[test]
fn an_observer_is_told_each_pack_the_hub_stored_after_a_step_begins() {
    let (_root, repo) = repo();
    let (set, _save, objects, max_bytes, sent) = several_packs(&repo);
    let mut replies = vec![
        repo_state(),
        ok(json!({ "saved": 1 })),
        missing(&objects),
        limits(max_bytes),
    ];
    replies.extend(sent.iter().map(|_| ok(json!({ "stored": 1, "known": 0 }))));
    replies.push(ok(json!({ "inserted": 1 })));
    replies.extend([missing(&[]), ok(json!({ "inserted": 1 }))]);
    let server = MockServer::start(replies);
    adopted(&repo, &server, &set);
    let mut events = Vec::new();

    push_observed(
        &repo,
        &remote_to(&server),
        &PushOptions::default(),
        &mut |progress| {
            events.push(progress);
            ControlFlow::Continue(())
        },
    )
    .unwrap();

    let received: Vec<u64> = server
        .requests()
        .iter()
        .filter(|request| request.path == "/api/repos/3/objects")
        .map(|request| request.body.len() as u64)
        .collect();
    let lengths: Vec<u64> = sent.iter().map(|pack| pack.len() as u64).collect();
    assert_eq!(received, lengths);
    let uploaded: Vec<u64> = events
        .iter()
        .filter_map(|event| match event {
            PushProgress::Uploaded { bytes } => Some(*bytes),
            PushProgress::Between => None,
        })
        .collect();
    assert_eq!(uploaded, lengths);
    for (at, event) in events.iter().enumerate() {
        if matches!(event, PushProgress::Uploaded { .. }) {
            assert_eq!(events[at - 1], PushProgress::Between, "events: {events:?}");
        }
    }
    assert_eq!(events[0], PushProgress::Between);
}

#[test]
fn an_observer_that_stops_after_a_pack_leaves_it_on_the_hub_and_the_next_push_sends_the_rest() {
    let (_root, repo) = repo();
    let (set, save, objects, max_bytes, sent) = several_packs(&repo);
    let first: HashSet<ObjectId> = record_kinds(&sent[0])
        .into_iter()
        .map(|(id, _)| id)
        .collect();
    let rest: Vec<_> = objects
        .iter()
        .filter(|(id, _)| !first.contains(id))
        .copied()
        .collect();
    let resent = packs_of(&repo, &rest, max_bytes);
    let mut replies = vec![
        repo_state(),
        ok(json!({ "saved": 1 })),
        missing(&objects),
        limits(max_bytes),
        ok(json!({ "stored": first.len(), "known": 0 })),
        repo_state(),
        missing(&rest),
        limits(max_bytes),
    ];
    replies.extend(
        resent
            .iter()
            .map(|pack| ok(json!({ "stored": record_kinds(pack).len(), "known": 0 }))),
    );
    replies.push(ok(json!({ "inserted": 1 })));
    replies.extend([missing(&[]), ok(json!({ "inserted": 1 }))]);
    let server = MockServer::start(replies);
    adopted(&repo, &server, &set);
    let remote = remote_to(&server);

    let error =
        push_observed(
            &repo,
            &remote,
            &PushOptions::default(),
            &mut |progress| match progress {
                PushProgress::Uploaded { .. } => ControlFlow::Break(()),
                PushProgress::Between => ControlFlow::Continue(()),
            },
        )
        .unwrap_err();

    assert!(matches!(error, PushError::Stopped), "{error:?}");
    assert_eq!(error.to_string(), "The push was stopped.");
    assert_eq!(server.requests().len(), 5);
    assert_eq!(path(&server, 4), "/api/repos/3/objects");
    assert_eq!(server.requests()[4].body, sent[0]);
    assert_eq!(
        repo.pushed(&set).unwrap().unwrap().branches["main"],
        PushedBranch {
            commit: None,
            saves: vec![save],
            ..Default::default()
        }
    );

    let report = push(&repo, &remote, &PushOptions::default()).unwrap();

    assert_eq!(path(&server, 6), "/api/repos/3/objects/missing");
    assert_eq!(
        body(&server, 6),
        json!({ "hashes": hexes(&ids_of(&objects)) })
    );
    let uploaded: Vec<Vec<u8>> = server
        .requests()
        .iter()
        .skip(5)
        .filter(|request| request.path == "/api/repos/3/objects")
        .map(|request| request.body.clone())
        .collect();
    assert_eq!(uploaded, resent);
    assert_eq!(
        report.branches[0].objects_stored,
        objects.len() - first.len()
    );
    assert_eq!(pending(&repo, None).unwrap(), []);
}

#[test]
fn an_observer_that_stops_at_the_first_step_sends_nothing() {
    let (_root, repo) = repo();
    let (set, _save, _objects, _max_bytes, _sent) = several_packs(&repo);
    let server = MockServer::start(vec![]);
    adopted(&repo, &server, &set);
    let options = PushOptions {
        saves_only: true,
        ..Default::default()
    };

    let error = push_observed(&repo, &remote_to(&server), &options, &mut |_| {
        ControlFlow::Break(())
    })
    .unwrap_err();

    assert!(matches!(error, PushError::Stopped), "{error:?}");
    assert!(server.requests().is_empty());
    assert_eq!(
        repo.pushed(&set).unwrap().unwrap().branches.get("main"),
        None
    );
}

#[test]
fn an_object_over_the_upload_limit_fails_the_push_naming_its_save_and_set() {
    let (_root, repo) = repo();
    let save = save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    user_commit(&repo, &set, "main", "first idea");
    let objects = objects_of(&repo, &[save]);
    let server = MockServer::start(vec![
        repo_state(),
        ok(json!({ "saved": 1 })),
        missing(&objects),
        limits(1),
    ]);
    adopted(&repo, &server, &set);

    let error = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap_err();

    let message = error.to_string();
    assert!(message.contains("over the 1-byte limit"), "{message}");
    assert!(message.contains("admin can raise"), "{message}");
    assert!(
        message.ends_with(&format!("It is in save {save} of set {set}.")),
        "{message}"
    );
    assert!(
        !paths(&server).contains(&"POST /api/repos/3/objects".to_string()),
        "nothing was uploaded"
    );
}

#[test]
fn a_long_history_goes_up_in_runs_each_recorded_once_the_hub_has_it() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    let first = user_commit(&repo, &set, "main", "first idea");
    save_main(&repo, &xml(1, 2, "second"));
    let second = user_commit(&repo, &set, "main", "second idea");
    let server = MockServer::start(vec![
        repo_state(),
        ok(json!({ "saved": 2 })),
        ok(json!({ "missing": [] })),
        ok(json!({ "inserted": 1 })),
        ok(json!({ "missing": [] })),
        refused(409, "Commit is not a fast-forward of main"),
    ]);
    adopted(&repo, &server, &set);
    let batching = Batching {
        saves: 200,
        run_objects: 1,
    };

    let error = push_batched(
        &repo,
        &remote_to(&server),
        &PushOptions::default(),
        &batching,
    )
    .unwrap_err();

    assert_eq!(error.to_string(), "Commit is not a fast-forward of main");
    let runs = [3, 5].map(|at| body(&server, at)["commits"].clone());
    assert_eq!(runs[0].as_array().unwrap().len(), 1);
    assert_eq!(runs[0][0]["hash"], json!(first.to_string()));
    assert_eq!(runs[1][0]["hash"], json!(second.to_string()));
    assert_eq!(
        repo.pushed(&set).unwrap().unwrap().branches["main"].commit,
        Some(first)
    );
}

#[test]
fn saves_go_up_in_chunks_each_recorded_once_the_hub_has_it() {
    let (_root, repo) = repo();
    let saves = ["a", "b", "c"].map(|blob| save_main(&repo, &xml(1, 2, blob)));
    let set = set_id(&repo);
    let server = MockServer::start(vec![
        repo_state(),
        ok(json!({ "saved": 2 })),
        refused(503, "The hub is busy."),
    ]);
    adopted(&repo, &server, &set);
    let batching = Batching {
        saves: 2,
        run_objects: 100_000,
    };

    let error = push_batched(
        &repo,
        &remote_to(&server),
        &PushOptions::default(),
        &batching,
    )
    .unwrap_err();

    assert_eq!(error.to_string(), "The hub is busy.");
    assert_eq!(body(&server, 1)["saves"].as_array().unwrap().len(), 2);
    assert_eq!(body(&server, 2)["saves"].as_array().unwrap().len(), 1);
    assert_eq!(
        repo.pushed(&set).unwrap().unwrap().branches["main"].saves,
        saves[..2]
    );
}

#[test]
fn a_repo_bound_to_another_instance_is_refused_before_any_request() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    repo.bind_remote(&RemoteBinding {
        instance: "https://hub.example.com".into(),
        repo: REPO_ID,
    })
    .unwrap();
    let server = MockServer::start(vec![]);

    let error = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap_err();

    assert_eq!(
        error.to_string(),
        format!(
            "This repo pushes to https://hub.example.com; dit is signed in to {}. Run dit login https://hub.example.com.",
            server.url
        )
    );
    assert_eq!(server.requests().len(), 0);
}

#[test]
fn a_repo_bound_to_the_http_address_of_an_instance_signed_in_at_https_names_both_schemes() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    repo.bind_remote(&RemoteBinding {
        instance: "http://hub.example.com".into(),
        repo: REPO_ID,
    })
    .unwrap();
    let remote = Remote::new(
        Client::new(
            Instance::parse("https://hub.example.com").unwrap(),
            "Studio iMac".to_string(),
        ),
        Token::new(TOKEN.to_string()),
    );

    let error = push(&repo, &remote, &PushOptions::default()).unwrap_err();

    assert_eq!(
        error.to_string(),
        "This repo pushes to http://hub.example.com; dit is signed in to https://hub.example.com. Run dit login http://hub.example.com."
    );
}

#[test]
fn a_bound_instance_that_redirects_names_the_commands_that_move_the_repo() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    let server = MockServer::start_with([(
        301,
        Some("https://hub.example.com/api/repos/3/sessions".to_string()),
        String::new(),
    )]);
    bind_to(&repo, &server);

    let error = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap_err();

    assert_eq!(
        error.to_string(),
        format!(
            "This repo pushes to {}, which redirects to https://hub.example.com. If the instance moved, run dit login https://hub.example.com, then dit remote set https://hub.example.com.",
            server.url
        )
    );
}

#[test]
fn a_bound_instance_that_redirects_to_no_instance_address_names_no_commands() {
    for location in [Some("/login"), None] {
        let (_root, repo) = repo();
        save_main(&repo, &xml(1, 2, "first"));
        let server = MockServer::start_with([(301, location.map(String::from), String::new())]);
        bind_to(&repo, &server);

        let error = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap_err();

        assert_eq!(
            error.to_string(),
            format!(
                "This repo pushes to {}, which redirects elsewhere.",
                server.url
            ),
            "{location:?}"
        );
    }
}

#[test]
fn a_set_the_repo_does_not_have_is_refused_before_any_request() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    let server = MockServer::start(vec![]);
    let options = PushOptions {
        set: Some("nope".into()),
        ..Default::default()
    };

    let error = push(&repo, &remote_to(&server), &options).unwrap_err();

    assert_eq!(error.to_string(), "This repo has no set nope.");
    assert_eq!(server.requests().len(), 0);
}

#[test]
fn a_first_push_without_a_project_needs_exactly_one() {
    for (names, message) in [
        (
            &["Album", "EP"][..],
            "You're in several projects (Album, EP). Run dit push --project <name>.",
        ),
        (&[][..], "You have no projects on {host}."),
    ] {
        let (_root, repo) = repo();
        let server = MockServer::start(vec![projects(names)]);

        let error = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap_err();

        assert_eq!(error.to_string(), message.replace("{host}", server.host()));
        assert_eq!(repo.remote_binding().unwrap(), None);
    }
}

#[test]
fn a_first_push_names_its_project_exactly_or_else_ignoring_case() {
    for (name, id, chosen) in [("Album", 2, "Album"), ("ALBUM", 1, "album")] {
        let (_root, repo) = repo();
        let server = MockServer::start(vec![
            projects(&["album", "Album", "EP"]),
            ok(json!({ "id": REPO_ID })),
            repo_state(),
        ]);

        let report = push(&repo, &remote_to(&server), &for_project(name)).unwrap();

        assert_eq!(path(&server, 1), format!("/api/projects/{id}/repos"));
        assert_eq!(
            report,
            PushReport {
                bound: Some(Bound {
                    project: chosen.into(),
                    repo_id: REPO_ID,
                }),
                branches: vec![],
            }
        );
        assert!(repo.remote_binding().unwrap().is_some());
    }
}

#[test]
fn a_first_push_naming_no_project_of_the_user_is_refused() {
    let (_root, repo) = repo();
    let server = MockServer::start(vec![projects(&["Album"])]);

    let error = push(&repo, &remote_to(&server), &for_project("Single")).unwrap_err();

    assert_eq!(
        error.to_string(),
        format!("No project named Single on {}.", server.host())
    );
    assert_eq!(repo.remote_binding().unwrap(), None);
}

#[test]
fn an_unbound_repo_has_every_save_and_commit_pending() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    save_main(&repo, &xml(1, 2, "second"));
    let set = set_id(&repo);
    let commit = user_commit(&repo, &set, "main", "first idea");
    let file = repo.checkout_new_branch(&commit, "idea").unwrap();
    write_set(&file, &xml(1, 2, "elsewhere"));
    repo.record_save(&file).unwrap();
    // State left by a push under an earlier binding is not this repo's.
    repo.write_pushed(
        &set,
        &PushedSet {
            session_id: 1,
            branches: [(
                "main".to_string(),
                PushedBranch {
                    commit: Some(commit),
                    saves: repo.log(&set, "main").unwrap(),
                    ..Default::default()
                },
            )]
            .into(),
            ..Default::default()
        },
    )
    .unwrap();

    assert_eq!(
        pending(&repo, None).unwrap(),
        [
            Pending {
                set_id: set.clone(),
                branch: "main".into(),
                saves: 2,
                commits: 1,
                samples: 0,
            },
            Pending {
                set_id: set,
                branch: "idea".into(),
                saves: 1,
                commits: 0,
                samples: 0,
            },
        ]
    );
}

/// A second set in the repo, with one save and one commit on `main`; returns its id.
fn second_set(repo: &Repo) -> String {
    let first = set_id(repo);
    let file = repo.root().join("Other.tset");
    write_set(&file, &xml(3, 4, "other"));
    repo.record_save(&file).unwrap();
    let id = repo
        .sets()
        .unwrap()
        .into_keys()
        .find(|id| *id != first)
        .unwrap();
    user_commit(repo, &id, "main", "other idea");
    id
}

/// Records each of `sets` as pushed in full to the hub repo at `server`.
fn pushed_in_full(repo: &Repo, server: &MockServer, sets: &[&str]) {
    bind_to(repo, server);
    for set in sets {
        let history = repo.history(set, "main").unwrap();
        repo.write_pushed(
            set,
            &PushedSet {
                instance: server.url.clone(),
                repo_id: REPO_ID,
                session_id: 11,
                branches: [(
                    "main".to_string(),
                    PushedBranch {
                        commit: Some(history[0].id),
                        saves: repo.log(set, "main").unwrap(),
                        lineage: Some(history[0].id),
                        ..Default::default()
                    },
                )]
                .into(),
            },
        )
        .unwrap();
    }
}

/// Takes `[remote]` out of `.dit/config.toml`, the one way to rebind a repo.
fn unbind(repo: &Repo) {
    let config = repo.root().join(".dit/config.toml");
    let text = std::fs::read_to_string(&config).unwrap();
    let unbound = text.split("[remote]").next().unwrap();
    std::fs::write(&config, unbound).unwrap();
    assert_eq!(repo.remote_binding().unwrap(), None);
}

#[test]
fn a_set_the_first_push_to_a_new_hub_repo_did_not_adopt_is_adopted_by_the_next() {
    let (_root, repo) = repo();
    let save_a = save_main(&repo, &xml(1, 2, "first"));
    let set_a = set_id(&repo);
    user_commit(&repo, &set_a, "main", "first idea");
    let set_b = second_set(&repo);
    let save_b = repo.log(&set_b, "main").unwrap()[0];
    let old_hub = MockServer::start(vec![]);
    pushed_in_full(&repo, &old_hub, &[&set_a, &set_b]);
    unbind(&repo);
    assert_eq!(pending(&repo, None).unwrap().len(), 2);

    let objects_a = objects_of(&repo, &[save_a]);
    let max_bytes = 1 << 20;
    let objects_b = objects_of(&repo, &[save_b]);
    let new_hub = MockServer::start(vec![
        projects(&["Album"]),
        ok(json!({ "id": REPO_ID + 1 })),
        repo_state(),
        ok(json!({ "ditSetId": set_a, "sessionId": 21 })),
        ok(json!({ "saved": 1 })),
        missing(&objects_a),
        limits(max_bytes),
        ok(json!({ "stored": objects_a.len(), "known": 0 })),
        ok(json!({ "inserted": 1 })),
        missing(&[]),
        ok(json!({ "inserted": 1 })),
        repo_state_with(false, false),
        ok(json!({ "ditSetId": set_b, "sessionId": 22 })),
        ok(json!({ "saved": 1 })),
        missing(&objects_b),
        limits(max_bytes),
        ok(json!({ "stored": objects_b.len(), "known": 0 })),
        ok(json!({ "inserted": 1 })),
        missing(&[]),
        ok(json!({ "inserted": 1 })),
    ]);
    let only_a = PushOptions {
        set: Some(set_a.clone()),
        ..Default::default()
    };

    push(&repo, &remote_to(&new_hub), &only_a).unwrap();

    let waiting = |set: &str| Pending {
        set_id: set.to_string(),
        branch: "main".into(),
        saves: 1,
        commits: 1,
        samples: 0,
    };
    assert_eq!(pending(&repo, None).unwrap(), [waiting(&set_b)]);
    assert_eq!(pending(&repo, Some(&set_a)).unwrap(), []);
    assert_eq!(pending(&repo, Some(&set_b)).unwrap(), [waiting(&set_b)]);

    let report = push(&repo, &remote_to(&new_hub), &PushOptions::default()).unwrap();

    assert_eq!(
        paths(&new_hub)[11..],
        [
            "GET /api/repos/4",
            "POST /api/repos/4/sets",
            "POST /api/repos/4/saves",
            "POST /api/repos/4/objects/missing",
            "GET /api/uploads/limits",
            "POST /api/repos/4/objects",
            "POST /api/repos/4/commits",
            "POST /api/repos/4/objects/missing",
            "POST /api/repos/4/commits",
        ]
    );
    assert_eq!(report.bound, None);
    assert_eq!(report.branches.len(), 1);
    assert_eq!(report.branches[0].set_id, set_b);
    assert_eq!(
        (report.branches[0].saves, report.branches[0].commits),
        (1, 1)
    );
    assert_eq!(pending(&repo, None).unwrap(), []);
    assert_eq!(repo.pushed(&set_b).unwrap().unwrap().repo_id, REPO_ID + 1);
}

#[test]
fn a_push_failing_after_a_rebind_leaves_every_set_pending() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    let set_a = set_id(&repo);
    user_commit(&repo, &set_a, "main", "first idea");
    let set_b = second_set(&repo);
    let old_hub = MockServer::start(vec![]);
    pushed_in_full(&repo, &old_hub, &[&set_a, &set_b]);
    unbind(&repo);
    let new_hub = MockServer::start(vec![
        projects(&["Album"]),
        ok(json!({ "id": REPO_ID + 1 })),
        repo_state(),
        refused(500, "boom"),
    ]);

    push(&repo, &remote_to(&new_hub), &PushOptions::default()).unwrap_err();

    assert_eq!(
        repo.remote_binding().unwrap().map(|binding| binding.repo),
        Some(REPO_ID + 1)
    );
    let waiting = pending(&repo, None).unwrap();
    assert_eq!(waiting.len(), 2, "{waiting:?}");
}

#[test]
fn pending_for_one_set_counts_only_that_set() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    let set_a = set_id(&repo);
    user_commit(&repo, &set_a, "main", "first idea");
    let set_b = second_set(&repo);

    let only_b = pending(&repo, Some(&set_b)).unwrap();

    assert_eq!(only_b.len(), 1);
    assert_eq!(only_b[0].set_id, set_b);
    assert_eq!(pending(&repo, None).unwrap().len(), 2);
    assert_eq!(pending(&repo, Some("nothing")).unwrap(), []);
}

#[test]
fn the_report_leaves_out_bound_when_the_push_did_not_bind() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    user_commit(&repo, &set, "main", "first idea");
    let server = MockServer::start(vec![repo_state()]);
    pushed_in_full(&repo, &server, &[&set]);

    let report = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap();

    let json = serde_json::to_value(&report).unwrap();
    assert_eq!(json, json!({ "branches": [] }));
}

#[test]
fn the_report_carries_the_stored_and_known_counts_the_hub_answers_a_pack_with() {
    let (_root, repo) = repo();
    let save = save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    user_commit(&repo, &set, "main", "first idea");
    let objects = objects_of(&repo, &[save]);
    let server = MockServer::start(vec![
        repo_state(),
        ok(json!({ "saved": 1 })),
        missing(&objects),
        limits(1 << 20),
        ok(json!({ "stored": 0, "known": objects.len() })),
        ok(json!({ "inserted": 1 })),
        missing(&[]),
        ok(json!({ "inserted": 1 })),
    ]);
    adopted(&repo, &server, &set);

    let report = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap();

    assert_eq!(report.branches[0].objects_stored, 0);
    assert_eq!(report.branches[0].objects_known, objects.len());
}

#[test]
fn a_save_with_sample_refs_sends_them_with_null_objects_and_sizes() {
    let (_root, repo) = repo();
    let doc = "<doc>\n<sample kind=\"project\" path=\"/p/Samples/k.wav\" rel=\"Samples/k.wav\"/>\n<sample kind=\"library\" path=\"/lib/s.wav\"/>\n<blob>b";
    let save = save_main(&repo, doc);
    let set = set_id(&repo);
    user_commit(&repo, &set, "main", "with samples");
    let objects = objects_of(&repo, &[save]);
    let max_bytes = 1 << 20;
    let server = MockServer::start(vec![
        projects(&["Album"]),
        (201, json!({ "id": REPO_ID, "sets": [] }).to_string()),
        repo_state(),
        (201, json!({ "ditSetId": set, "sessionId": 11 }).to_string()),
        ok(json!({ "saved": 1 })),
        missing(&objects),
        limits(max_bytes),
        ok(json!({ "stored": objects.len(), "known": 0 })),
        ok(json!({ "inserted": 1 })),
        missing(&[]),
        ok(json!({ "inserted": 1 })),
    ]);

    push(&repo, &remote_to(&server), &for_project("Album")).unwrap();

    assert_eq!(
        body(&server, 4)["saves"][0]["samples"],
        json!([
            { "path": "/p/Samples/k.wav", "kind": "project", "relative": "Samples/k.wav", "object": null, "size": null },
            { "path": "/lib/s.wav", "kind": "library", "object": null, "size": null },
        ])
    );
}

mod samples {
    use super::*;
    use crate::remote::pack::LeafObjects;
    use crate::remote::set_push_samples;
    use crate::repo::PushSamples;

    const SAMPLE_DOC: &str = "<doc>\n<sample kind=\"project\" path=\"/p/Samples/k.wav\" rel=\"Samples/k.wav\"/>\n<blob>b";

    /// A repo whose one set references `Samples/k.wav` holding `bytes`, committed, with the set adopted.
    struct Sampled {
        _root: tempfile::TempDir,
        repo: Repo,
        set: String,
        commit: ObjectId,
        /// The objects the set's save uploads.
        set_objects: Vec<(ObjectId, ObjectKind)>,
        /// The sample leaf, and every object it is made of.
        leaf: ObjectId,
        sample_objects: Vec<(ObjectId, ObjectKind)>,
    }

    fn sampled(bytes: &[u8]) -> Sampled {
        let (root, repo) = repo();
        let sample = repo.root().join("Samples/k.wav");
        std::fs::create_dir_all(sample.parent().unwrap()).unwrap();
        std::fs::write(&sample, bytes).unwrap();
        let save = save_main(&repo, SAMPLE_DOC);
        let set = set_id(&repo);
        let commit = user_commit(&repo, &set, "main", "with a sample");
        let leaf = repo.read_save(&save).unwrap().samples[0].object.unwrap();
        let sample_objects = LeafObjects::default()
            .of(repo.store(), leaf)
            .unwrap()
            .to_vec();
        let set_objects = objects_of(&repo, &[save]);
        Sampled {
            _root: root,
            repo,
            set,
            commit,
            set_objects,
            leaf,
            sample_objects,
        }
    }

    fn held(
        missing: &[(ObjectId, ObjectKind)],
        claimed: &[(ObjectId, ObjectKind)],
    ) -> (u16, String) {
        ok(json!({
            "missing": hexes(&ids_of(missing)),
            "claimed": hexes(&ids_of(claimed)),
        }))
    }

    /// The replies of a push of the commit's saves, the commit and its lineage, after the repo state.
    fn phase_one(s: &Sampled, max_bytes: usize) -> Vec<(u16, String)> {
        vec![
            ok(json!({ "saved": 1 })),
            missing(&s.set_objects),
            limits(max_bytes),
            ok(json!({ "stored": s.set_objects.len(), "known": 0 })),
            ok(json!({ "inserted": 1 })),
            missing(&[]),
            ok(json!({ "inserted": 1 })),
        ]
    }

    fn script(
        state: (u16, String),
        phase_one: Vec<(u16, String)>,
        rest: Vec<(u16, String)>,
    ) -> MockServer {
        MockServer::start(
            std::iter::once(state)
                .chain(phase_one)
                .chain(rest)
                .collect::<Vec<_>>(),
        )
    }

    #[test]
    fn a_commit_lists_its_sample_leaves_once_whether_or_not_samples_are_pushed() {
        let s = sampled(b"kick");
        let server = script(repo_state(), phase_one(&s, 1 << 20), vec![]);
        adopted(&s.repo, &server, &s.set);

        let report = push(&s.repo, &remote_to(&server), &PushOptions::default()).unwrap();

        assert_eq!(
            body(&server, 5)["commits"][0]["sampleObjects"],
            json!([s.leaf.to_string()])
        );
        assert_eq!(paths(&server).len(), 8);
        assert_eq!(report.branches[0].samples, Default::default());
        assert_eq!(
            s.repo.push_samples().unwrap(),
            Some(PushSamples {
                enabled: false,
                forced: false
            })
        );
        assert_eq!(pending(&s.repo, None).unwrap(), []);
    }

    #[test]
    fn with_samples_on_the_samples_go_up_after_the_commit_under_their_own_cursor() {
        let s = sampled(b"kick");
        let pack = packs_of(&s.repo, &s.sample_objects, 1 << 20).concat();
        let server = script(
            repo_state_with(true, false),
            phase_one(&s, 1 << 20),
            vec![
                held(&s.sample_objects, &[]),
                ok(json!({ "stored": s.sample_objects.len(), "known": 0 })),
                ok(json!({ "inserted": 1 })),
            ],
        );
        adopted(&s.repo, &server, &s.set);

        let report = push(&s.repo, &remote_to(&server), &PushOptions::default()).unwrap();

        assert_eq!(
            paths(&server)[5..],
            [
                "POST /api/repos/3/commits",
                "POST /api/repos/3/objects/missing",
                "POST /api/repos/3/commits",
                "POST /api/repos/3/objects/missing",
                "POST /api/repos/3/objects",
                "POST /api/repos/3/commits",
            ]
        );
        assert_eq!(
            body(&server, 8),
            json!({ "hashes": hexes(&ids_of(&s.sample_objects)) })
        );
        assert_eq!(server.requests()[9].body, pack);
        let samples = &report.branches[0].samples;
        assert_eq!(
            (
                samples.commits,
                samples.objects_stored,
                samples.objects_claimed
            ),
            (1, s.sample_objects.len(), 0)
        );
        let state = s.repo.pushed(&s.set).unwrap().unwrap().branches["main"].clone();
        assert_eq!(
            (state.commit, state.samples),
            (Some(s.commit), Some(s.commit))
        );
        assert_eq!(pending(&s.repo, None).unwrap(), []);
    }

    #[test]
    fn a_large_sample_goes_up_as_its_chunked_leaf_and_every_chunk() {
        let s = sampled(&blob_bytes(700 * 1024));
        assert!(s.sample_objects.len() > 2);
        assert_eq!(s.sample_objects[0], (s.leaf, ObjectKind::Chunked));
        let server = script(
            repo_state_with(true, false),
            phase_one(&s, 1 << 20),
            vec![
                held(&s.sample_objects, &[]),
                ok(json!({ "stored": s.sample_objects.len(), "known": 0 })),
                ok(json!({ "inserted": 1 })),
            ],
        );
        adopted(&s.repo, &server, &s.set);

        let report = push(&s.repo, &remote_to(&server), &PushOptions::default()).unwrap();

        assert_eq!(
            body(&server, 8),
            json!({ "hashes": hexes(&ids_of(&s.sample_objects)) })
        );
        assert_eq!(report.branches[0].samples.commits, 1);
        assert_eq!(
            report.branches[0].samples.objects_stored,
            s.sample_objects.len()
        );
    }

    fn blob_bytes(len: usize) -> Vec<u8> {
        let mut x = 0x9e37_79b9u32;
        (0..len)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                (x >> 24) as u8
            })
            .collect()
    }

    #[test]
    fn samples_the_hub_links_without_an_upload_are_counted_claimed_not_uploaded() {
        let s = sampled(b"kick");
        let server = script(
            repo_state_with(true, false),
            phase_one(&s, 1 << 20),
            vec![held(&[], &s.sample_objects), ok(json!({ "inserted": 1 }))],
        );
        adopted(&s.repo, &server, &s.set);

        let report = push(&s.repo, &remote_to(&server), &PushOptions::default()).unwrap();

        assert_eq!(paths(&server).len(), 10);
        let samples = &report.branches[0].samples;
        assert_eq!(
            (
                samples.commits,
                samples.objects_stored,
                samples.objects_known,
                samples.objects_claimed
            ),
            (1, 0, 0, s.sample_objects.len())
        );
        assert_eq!(
            s.repo.pushed(&s.set).unwrap().unwrap().branches["main"].samples,
            Some(s.commit)
        );
    }

    fn cap_refusal(message: &str) -> (u16, String) {
        (
            413,
            json!({ "error": message, "code": "storage_limit" }).to_string(),
        )
    }

    #[test]
    fn a_cap_refused_sample_leaves_the_commit_pushed_and_fails_the_push_with_the_hubs_message() {
        let s = sampled(b"kick");
        let message = "This instance is out of storage. Ask its admin for more.";
        let server = script(
            repo_state_with(true, false),
            phase_one(&s, 1 << 20),
            vec![held(&s.sample_objects, &[]), cap_refusal(message)],
        );
        adopted(&s.repo, &server, &s.set);

        let error = push(&s.repo, &remote_to(&server), &PushOptions::default()).unwrap_err();

        assert_eq!(error.to_string(), message);
        let PushError::StorageLimit { report, .. } = &error else {
            panic!("{error:?}");
        };
        assert_eq!(report.branches[0].commits, 1);
        assert_eq!(report.branches[0].samples.commits, 0);
        let state = s.repo.pushed(&s.set).unwrap().unwrap().branches["main"].clone();
        assert_eq!((state.commit, state.samples), (Some(s.commit), None));
        assert_eq!(
            pending(&s.repo, None).unwrap(),
            [Pending {
                set_id: s.set.clone(),
                branch: "main".into(),
                saves: 0,
                commits: 0,
                samples: 1,
            }]
        );
    }

    #[test]
    fn a_413_that_is_not_the_storage_cap_is_an_ordinary_error() {
        for body in [
            json!({ "error": "Pack is too large", "code": "pack_too_large" }),
            json!({ "error": "Request body too large" }),
        ] {
            let s = sampled(b"kick");
            let server = script(
                repo_state_with(true, false),
                phase_one(&s, 1 << 20),
                vec![held(&s.sample_objects, &[]), (413, body.to_string())],
            );
            adopted(&s.repo, &server, &s.set);

            let error = push(&s.repo, &remote_to(&server), &PushOptions::default()).unwrap_err();

            assert!(
                matches!(
                    error,
                    PushError::Remote(RemoteError::Refused { status: 413, .. })
                ),
                "{error:?}"
            );
            let state = s.repo.pushed(&s.set).unwrap().unwrap().branches["main"].clone();
            assert_eq!((state.commit, state.samples), (Some(s.commit), None));
        }
    }

    #[test]
    fn turning_samples_on_later_sends_the_samples_of_commits_already_pushed() {
        let s = sampled(b"kick");
        let off = script(repo_state(), phase_one(&s, 1 << 20), vec![]);
        adopted(&s.repo, &off, &s.set);
        push(&s.repo, &remote_to(&off), &PushOptions::default()).unwrap();
        assert_eq!(pending(&s.repo, None).unwrap(), []);

        let on = MockServer::start(vec![
            repo_state_with(true, false),
            held(&s.sample_objects, &[]),
            limits(1 << 20),
            ok(json!({ "stored": s.sample_objects.len(), "known": 0 })),
            ok(json!({ "inserted": 1 })),
        ]);
        s.repo
            .bind_remote(&RemoteBinding {
                instance: on.url.clone(),
                repo: REPO_ID,
            })
            .unwrap();
        let mut pushed = s.repo.pushed(&s.set).unwrap().unwrap();
        pushed.instance = on.url.clone();
        s.repo.write_pushed(&s.set, &pushed).unwrap();

        let report = push(&s.repo, &remote_to(&on), &PushOptions::default()).unwrap();

        assert_eq!(
            paths(&on),
            [
                "GET /api/repos/3",
                "POST /api/repos/3/objects/missing",
                "GET /api/uploads/limits",
                "POST /api/repos/3/objects",
                "POST /api/repos/3/commits"
            ]
        );
        assert_eq!(
            (report.branches[0].saves, report.branches[0].commits),
            (0, 0)
        );
        assert_eq!(report.branches[0].samples.commits, 1);
        assert_eq!(
            s.repo.pushed(&s.set).unwrap().unwrap().branches["main"].samples,
            Some(s.commit)
        );
    }

    #[test]
    fn an_instance_that_forces_samples_sends_them_with_the_switch_off() {
        let s = sampled(b"kick");
        let server = script(
            repo_state_with(false, true),
            phase_one(&s, 1 << 20),
            vec![
                held(&s.sample_objects, &[]),
                ok(json!({ "stored": s.sample_objects.len(), "known": 0 })),
                ok(json!({ "inserted": 1 })),
            ],
        );
        adopted(&s.repo, &server, &s.set);

        let report = push(&s.repo, &remote_to(&server), &PushOptions::default()).unwrap();

        assert_eq!(report.branches[0].samples.commits, 1);
        assert_eq!(
            s.repo.push_samples().unwrap(),
            Some(PushSamples {
                enabled: false,
                forced: true
            })
        );
    }

    #[test]
    fn a_push_that_skips_samples_sends_the_set_and_leaves_the_samples_pending() {
        let s = sampled(b"kick");
        let server = script(repo_state_with(true, false), phase_one(&s, 1 << 20), vec![]);
        adopted(&s.repo, &server, &s.set);
        let options = PushOptions {
            skip_samples: true,
            ..PushOptions::default()
        };

        let report = push(&s.repo, &remote_to(&server), &options).unwrap();

        assert_eq!(paths(&server).len(), 8);
        assert_eq!(report.branches[0].samples, Default::default());
        assert_eq!(pending(&s.repo, None).unwrap()[0].samples, 1);
    }

    #[test]
    fn a_commit_with_no_tracked_sample_has_no_samples_pending() {
        let (_root, repo) = repo();
        save_main(&repo, &xml(1, 2, "plain"));
        let set = set_id(&repo);
        user_commit(&repo, &set, "main", "plain");
        repo.cache_push_samples(PushSamples {
            enabled: true,
            forced: false,
        })
        .unwrap();

        assert_eq!(pending(&repo, None).unwrap()[0].samples, 0);
    }

    #[test]
    fn setting_push_samples_patches_the_hub_and_caches_its_answer() {
        let s = sampled(b"kick");
        let server = MockServer::start(vec![ok(json!({
            "id": REPO_ID, "sets": [], "pushSamples": true, "pushSamplesForced": true,
        }))]);
        bind_to(&s.repo, &server);

        let setting = set_push_samples(&s.repo, || Ok(remote_to(&server)), true).unwrap();

        assert_eq!(
            setting,
            PushSamples {
                enabled: true,
                forced: true
            }
        );
        assert_eq!(s.repo.push_samples().unwrap(), Some(setting));
        assert_eq!(paths(&server), ["PATCH /api/repos/3"]);
        assert_eq!(body(&server, 0), json!({ "pushSamples": true }));
    }

    #[test]
    fn a_refused_setting_caches_nothing_and_an_unbound_repo_is_refused_before_a_remote_opens() {
        let s = sampled(b"kick");
        let server = MockServer::start(vec![refused(403, "You need editor access.")]);
        let unbound = set_push_samples(
            &s.repo,
            || -> Result<Remote, RemoteError> { panic!("opened a remote for an unbound repo") },
            true,
        );
        assert!(matches!(unbound, Err(PushError::NotBound)));
        assert_eq!(server.requests().len(), 0);
        bind_to(&s.repo, &server);

        let error = set_push_samples(&s.repo, || Ok(remote_to(&server)), true).unwrap_err();

        assert_eq!(error.to_string(), "You need editor access.");
        assert_eq!(s.repo.push_samples().unwrap(), None);
    }

    #[test]
    fn the_cache_sits_beside_the_binding_and_does_not_change_it() {
        let s = sampled(b"kick");
        let server = MockServer::start(vec![]);
        bind_to(&s.repo, &server);
        s.repo
            .cache_push_samples(PushSamples {
                enabled: true,
                forced: false,
            })
            .unwrap();

        assert_eq!(
            s.repo.remote_binding().unwrap(),
            Some(RemoteBinding {
                instance: server.url.clone(),
                repo: REPO_ID
            })
        );
        let text = std::fs::read_to_string(s.repo.root().join(".dit/config.toml")).unwrap();
        assert!(text.contains("[push_samples]"), "{text}");
    }

    #[test]
    fn the_commit_is_posted_again_after_its_samples_land_and_a_failure_keeps_the_cursor() {
        let s = sampled(b"kick");
        let server = script(
            repo_state_with(true, false),
            phase_one(&s, 1 << 20),
            vec![
                held(&s.sample_objects, &[]),
                ok(json!({ "stored": s.sample_objects.len(), "known": 0 })),
                (503, json!({ "error": "down" }).to_string()),
            ],
        );
        adopted(&s.repo, &server, &s.set);

        let error = push(&s.repo, &remote_to(&server), &PushOptions::default());

        assert!(error.is_err());
        let first = body(&server, 5);
        assert_eq!(body(&server, 10)["commits"], first["commits"]);
        assert_eq!(body(&server, 10)["branch"], first["branch"]);
        let state = s.repo.pushed(&s.set).unwrap().unwrap().branches["main"].clone();
        assert_eq!((state.commit, state.samples), (Some(s.commit), None));
    }

    #[test]
    fn a_backfill_reposts_its_commits_in_batches_and_a_failed_batch_keeps_its_commits_pending() {
        let s = sampled(b"kick");
        let off = script(repo_state(), phase_one(&s, 1 << 20), vec![]);
        adopted(&s.repo, &off, &s.set);
        push(&s.repo, &remote_to(&off), &PushOptions::default()).unwrap();
        let second = second_commit(&s);

        let on = MockServer::start(
            second
                .phase_one()
                .into_iter()
                .chain([
                    held(&s.sample_objects, &[]),
                    ok(json!({ "stored": s.sample_objects.len(), "known": 0 })),
                    held(&second.sample_objects, &[]),
                    ok(json!({ "stored": second.sample_objects.len(), "known": 0 })),
                    (503, json!({ "error": "down" }).to_string()),
                ])
                .collect(),
        );
        rebind_pushed(&s, &on);

        assert!(push(&s.repo, &remote_to(&on), &PushOptions::default()).is_err());

        let paths = paths(&on);
        assert_eq!(paths.iter().filter(|p| p.ends_with("/commits")).count(), 3);
        let batch = body(&on, 12);
        assert_eq!(batch["commits"].as_array().unwrap().len(), 2);
        assert_eq!(
            batch["commits"][1]["hash"],
            json!(second.commit.to_string())
        );
        let state = s.repo.pushed(&s.set).unwrap().unwrap().branches["main"].clone();
        assert_eq!((state.commit, state.samples), (Some(second.commit), None));
    }

    #[test]
    fn a_cap_refusal_after_a_completed_commit_replays_it_and_moves_the_cursor_to_it() {
        let s = sampled(b"kick");
        let off = script(repo_state(), phase_one(&s, 1 << 20), vec![]);
        adopted(&s.repo, &off, &s.set);
        push(&s.repo, &remote_to(&off), &PushOptions::default()).unwrap();
        let second = second_commit(&s);
        let message = "This instance is out of storage.";
        let on = MockServer::start(
            second
                .phase_one()
                .into_iter()
                .chain([
                    held(&s.sample_objects, &[]),
                    ok(json!({ "stored": s.sample_objects.len(), "known": 0 })),
                    held(&second.sample_objects, &[]),
                    cap_refusal(message),
                    ok(json!({ "inserted": 1 })),
                ])
                .collect(),
        );
        rebind_pushed(&s, &on);

        let error = push(&s.repo, &remote_to(&on), &PushOptions::default()).unwrap_err();

        let PushError::StorageLimit { report, .. } = &error else {
            panic!("{error:?}");
        };
        assert_eq!(report.branches[0].samples.commits, 1);
        let replay = body(&on, 12);
        assert_eq!(replay["commits"].as_array().unwrap().len(), 1);
        assert_eq!(replay["commits"][0]["hash"], json!(s.commit.to_string()));
        let state = s.repo.pushed(&s.set).unwrap().unwrap().branches["main"].clone();
        assert_eq!(
            (state.commit, state.samples),
            (Some(second.commit), Some(s.commit))
        );
    }

    /// A second commit of the `sampled` repo with a sample of its own.
    struct Second {
        commit: ObjectId,
        sample_objects: Vec<(ObjectId, ObjectKind)>,
        /// The set's objects this commit adds.
        new_set: Vec<(ObjectId, ObjectKind)>,
    }

    impl Second {
        /// The replies of a push of the second commit's save and the commit, after the repo state.
        fn phase_one(&self) -> Vec<(u16, String)> {
            vec![
                repo_state_with(true, false),
                ok(json!({ "saved": 1 })),
                missing(&self.new_set),
                limits(1 << 20),
                ok(json!({ "stored": self.new_set.len(), "known": 0 })),
                ok(json!({ "inserted": 1 })),
                missing(&[]),
                ok(json!({ "inserted": 1 })),
            ]
        }
    }

    fn second_commit(s: &Sampled) -> Second {
        std::fs::write(s.repo.root().join("Samples/k.wav"), b"kick two").unwrap();
        let save = save_main(&s.repo, &SAMPLE_DOC.replace("<blob>b", "<blob>c"));
        let commit = user_commit(&s.repo, &s.set, "main", "second");
        let leaf = s.repo.read_save(&save).unwrap().samples[0].object.unwrap();
        let sample_objects = LeafObjects::default()
            .of(s.repo.store(), leaf)
            .unwrap()
            .to_vec();
        let new_set = without(&objects_of(&s.repo, &[save]), &s.set_objects);
        Second {
            commit,
            sample_objects,
            new_set,
        }
    }

    /// Points the repo and its pushed record at `server`, keeping what was pushed.
    fn rebind_pushed(s: &Sampled, server: &MockServer) {
        s.repo
            .bind_remote(&RemoteBinding {
                instance: server.url.clone(),
                repo: REPO_ID,
            })
            .unwrap();
        let mut pushed = s.repo.pushed(&s.set).unwrap().unwrap();
        pushed.instance = server.url.clone();
        s.repo.write_pushed(&s.set, &pushed).unwrap();
    }

    #[test]
    fn a_commit_with_no_sample_objects_moves_the_cursor_and_counts_as_no_samples_sent() {
        let (_root, repo) = repo();
        save_main(&repo, &xml(1, 2, "plain"));
        let set = set_id(&repo);
        let commit = user_commit(&repo, &set, "main", "plain");
        let server = MockServer::start(vec![
            repo_state_with(true, false),
            ok(json!({ "saved": 1 })),
            missing(&objects_of(&repo, &repo.log(&set, "main").unwrap())),
            limits(1 << 20),
            ok(json!({ "stored": 1, "known": 0 })),
            ok(json!({ "inserted": 1 })),
            missing(&[]),
            ok(json!({ "inserted": 1 })),
        ]);
        adopted(&repo, &server, &set);

        let report = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap();

        assert_eq!(report.branches[0].samples, Default::default());
        let state = repo.pushed(&set).unwrap().unwrap().branches["main"].clone();
        assert_eq!(state.samples, Some(commit));
    }
}

#[test]
fn an_unreadable_save_is_pushed_as_its_raw_leaf_with_no_document_fields() {
    let (_root, repo) = repo();
    std::fs::write(set_path(&repo), [MARKER, &[0xff, 0xfe, b'x']].concat()).unwrap();
    let save = repo.record_save(&set_path(&repo)).unwrap().unwrap();
    let set = set_id(&repo);
    user_commit(&repo, &set, "main", "unreadable");
    let recorded = repo.read_save(&save).unwrap();
    let objects = objects_of(&repo, &[save]);
    assert_eq!(
        objects,
        [(recorded.raw.unwrap(), ObjectKind::Blob)],
        "the file's bytes are the save's only object"
    );
    let max_bytes = 1 << 20;
    let server = MockServer::start(vec![
        projects(&["Album"]),
        (201, json!({ "id": REPO_ID, "sets": [] }).to_string()),
        repo_state(),
        (201, json!({ "ditSetId": set, "sessionId": 11 }).to_string()),
        ok(json!({ "saved": 1 })),
        missing(&objects),
        limits(max_bytes),
        ok(json!({ "stored": 1, "known": 0 })),
        ok(json!({ "inserted": 1 })),
        missing(&[]),
        ok(json!({ "inserted": 1 })),
    ]);

    push(&repo, &remote_to(&server), &PushOptions::default()).unwrap();

    assert_eq!(
        body(&server, 4)["saves"],
        json!([{
            "hash": save.to_string(),
            "xmlHash": null,
            "tree": null,
            "side": null,
            "raw": recorded.raw.unwrap().to_string(),
            "fileUpdatedAt": recorded.file_updated_at,
            "machineName": recorded.machine,
            "meta": null,
            "viewOnly": false,
            "unreadable": true,
            "samples": [],
        }])
    );
    assert_eq!(
        body(&server, 8)["commits"][0]["saves"],
        json!([{ "hash": save.to_string(), "objects": hexes(&ids_of(&objects)) }])
    );
}

#[test]
fn a_saves_only_push_sends_the_adopt_and_the_saves_and_leaves_the_commits_for_the_next_push() {
    let (_root, repo) = repo();
    let save = save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    let commit = user_commit(&repo, &set, "main", "first idea");
    let objects = objects_of(&repo, &[save]);
    let server = MockServer::start(vec![
        ok(json!({ "ditSetId": set, "sessionId": 11 })),
        ok(json!({ "saved": 1 })),
        // The push after it, which sends everything.
        repo_state(),
        missing(&objects),
        limits(1 << 20),
        ok(json!({ "stored": objects.len(), "known": 0 })),
        ok(json!({ "inserted": 1 })),
        missing(&[]),
        ok(json!({ "inserted": 1 })),
    ]);
    bind_to(&repo, &server);
    let options = PushOptions {
        saves_only: true,
        ..Default::default()
    };

    let report = push(&repo, &remote_to(&server), &options).unwrap();

    assert_eq!(
        paths(&server),
        ["POST /api/repos/3/sets", "POST /api/repos/3/saves"]
    );
    assert_eq!(report.branches.len(), 1);
    let sent = &report.branches[0];
    assert_eq!(
        (sent.saves, sent.commits, sent.lineage, sent.segments),
        (1, 0, 0, 0)
    );
    assert_eq!(sent.samples, Default::default());
    assert_eq!(
        repo.pushed(&set).unwrap().unwrap().branches["main"],
        PushedBranch {
            saves: vec![save],
            ..Default::default()
        }
    );
    assert_eq!(
        pending(&repo, None).unwrap(),
        [Pending {
            set_id: set.clone(),
            branch: "main".into(),
            saves: 0,
            commits: 1,
            samples: 0,
        }]
    );

    let report = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap();

    assert_eq!(
        paths(&server)[2..],
        [
            "GET /api/repos/3",
            "POST /api/repos/3/objects/missing",
            "GET /api/uploads/limits",
            "POST /api/repos/3/objects",
            "POST /api/repos/3/commits",
            "POST /api/repos/3/objects/missing",
            "POST /api/repos/3/commits",
        ]
    );
    let sent = &report.branches[0];
    assert_eq!((sent.saves, sent.commits, sent.lineage), (0, 1, 1));
    assert_eq!(
        repo.pushed(&set).unwrap().unwrap().branches["main"],
        PushedBranch {
            commit: Some(commit),
            saves: vec![save],
            lineage: Some(commit),
            ..Default::default()
        }
    );
}

/// The body of a time span the hub is sent for `main`, by this machine.
fn wire_span(start: i64, end: i64, source: &str) -> Value {
    json!({
        "branch": "main",
        "machineName": "Studio iMac",
        "startedAt": start,
        "endedAt": end,
        "source": source,
    })
}

fn span(start: i64, end: i64, source: Source) -> Segment {
    Segment { start, end, source }
}

#[test]
fn time_spans_go_up_after_the_saves_and_only_those_ending_after_the_cursor_go_again() {
    let (_root, repo) = repo();
    let save = save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    repo.upsert_segment(&set, "main", &span(1_000, 5_000, Source::Script))
        .unwrap();
    repo.upsert_segment(&set, "main", &span(10_000, 12_000, Source::Saves))
        .unwrap();
    let server = MockServer::start(vec![
        repo_state(),
        ok(json!({ "saved": 1 })),
        ok(json!({})),
        repo_state(),
        ok(json!({})),
        repo_state(),
    ]);
    adopted(&repo, &server, &set);

    let report = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap();

    assert_eq!(
        paths(&server),
        [
            "GET /api/repos/3",
            "POST /api/repos/3/saves",
            "POST /api/repos/3/segments",
        ]
    );
    assert_eq!(
        body(&server, 2),
        json!({
            "ditSetId": set,
            "segments": [
                wire_span(1_000, 5_000, "script"),
                wire_span(10_000, 12_000, "saves"),
            ],
        })
    );
    assert_eq!(report.branches[0].segments, 2);
    assert_eq!(
        repo.pushed(&set).unwrap().unwrap().branches["main"],
        PushedBranch {
            saves: vec![save],
            segments_through: Some(12_000),
            ..Default::default()
        }
    );

    // The span still open grows, and another begins.
    repo.upsert_segment(&set, "main", &span(10_000, 13_000, Source::Saves))
        .unwrap();
    repo.upsert_segment(&set, "main", &span(20_000, 21_000, Source::Title))
        .unwrap();
    let report = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap();

    assert_eq!(
        paths(&server)[3..],
        ["GET /api/repos/3", "POST /api/repos/3/segments"]
    );
    assert_eq!(
        body(&server, 4),
        json!({
            "ditSetId": set,
            "segments": [
                wire_span(10_000, 13_000, "saves"),
                wire_span(20_000, 21_000, "title"),
            ],
        })
    );
    assert_eq!(report.branches, []);
    assert_eq!(
        repo.pushed(&set).unwrap().unwrap().branches["main"].segments_through,
        Some(21_000)
    );

    push(&repo, &remote_to(&server), &PushOptions::default()).unwrap();

    assert_eq!(paths(&server)[5..], ["GET /api/repos/3"]);
}

#[test]
fn a_branch_whose_saves_are_not_on_the_hub_yet_sends_no_time_spans_before_them() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    let fork = user_commit(&repo, &set, "main", "first idea");
    let main_objects = objects_of(&repo, &repo.log(&set, "main").unwrap());
    let file = repo.checkout_new_branch(&fork, "idea").unwrap();
    repo.upsert_segment(&set, "idea", &span(1_000, 2_000, Source::Title))
        .unwrap();
    let server = MockServer::start(vec![
        repo_state(),
        ok(json!({ "saved": 1 })),
        missing(&main_objects),
        limits(1 << 20),
        ok(json!({ "stored": main_objects.len(), "known": 0 })),
        ok(json!({ "inserted": 1 })),
        missing(&[]),
        ok(json!({ "inserted": 1 })),
        repo_state(),
        ok(json!({ "saved": 1 })),
        ok(json!({})),
    ]);
    adopted(&repo, &server, &set);

    push(&repo, &remote_to(&server), &PushOptions::default()).unwrap();

    assert!(
        !paths(&server).contains(&"POST /api/repos/3/segments".to_string()),
        "{:?}",
        paths(&server)
    );
    let pushed = repo.pushed(&set).unwrap().unwrap();
    assert_eq!(
        pushed
            .branches
            .get("idea")
            .and_then(|branch| branch.segments_through),
        None
    );

    write_set(&file, &xml(1, 2, "elsewhere"));
    repo.record_save(&file).unwrap();
    push(&repo, &remote_to(&server), &PushOptions::default()).unwrap();

    assert_eq!(
        paths(&server)[8..],
        [
            "GET /api/repos/3",
            "POST /api/repos/3/saves",
            "POST /api/repos/3/segments",
        ]
    );
    assert_eq!(body(&server, 9)["branch"], json!("idea"));
    let spans = body(&server, 10);
    assert_eq!(spans["segments"].as_array().unwrap().len(), 1);
    assert_eq!(spans["segments"][0]["branch"], json!("idea"));
    assert_eq!(spans["segments"][0]["source"], json!("title"));
    assert_eq!(
        repo.pushed(&set).unwrap().unwrap().branches["idea"].segments_through,
        Some(2_000)
    );
}

/// The machine name a push sends with the time spans when the machine is called `name`.
fn machine_name_sent_with_spans(name: String) -> Value {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    repo.upsert_segment(&set, "main", &span(1_000, 2_000, Source::Log))
        .unwrap();
    let server = MockServer::start(vec![repo_state(), ok(json!({ "saved": 1 })), ok(json!({}))]);
    adopted(&repo, &server, &set);
    let remote = Remote::new(
        Client::new(Instance::parse(&server.url).unwrap(), name),
        Token::new(TOKEN.to_string()),
    );

    push(&repo, &remote, &PushOptions::default()).unwrap();

    body(&server, 2)["segments"][0]["machineName"].clone()
}

#[test]
fn a_machine_name_over_64_characters_is_trimmed_and_cut_to_64_for_the_time_spans() {
    assert_eq!(
        machine_name_sent_with_spans(format!("  {}  ", "é".repeat(70))),
        json!("é".repeat(64))
    );
    assert_eq!(
        machine_name_sent_with_spans("m".repeat(70)),
        json!("m".repeat(64))
    );
}

#[test]
fn a_machine_name_is_cut_to_64_utf16_units_without_splitting_a_character_for_the_time_spans() {
    // 33 characters of two units each is 66 units: 32 whole characters fit.
    assert_eq!(
        machine_name_sent_with_spans("𝄞".repeat(33)),
        json!("𝄞".repeat(32))
    );
}

/// Records the repo as pushed in full to `server` by a dit that sent no lineage: the head and the saves of `main`
/// are recorded, the lineage cursor is not.
fn pushed_before_lineage(repo: &Repo, server: &MockServer, set: &str) {
    bind_to(repo, server);
    repo.write_pushed(
        set,
        &PushedSet {
            instance: server.url.clone(),
            repo_id: REPO_ID,
            session_id: 11,
            branches: [(
                "main".to_string(),
                PushedBranch {
                    commit: Some(repo.history(set, "main").unwrap()[0].id),
                    saves: repo.log(set, "main").unwrap(),
                    ..Default::default()
                },
            )]
            .into(),
        },
    )
    .unwrap();
}

#[test]
fn a_repo_pushed_before_lineage_existed_sends_the_lineage_of_every_commit_once() {
    let (_root, repo) = repo();
    let save_one = save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    let one = user_commit(&repo, &set, "main", "first idea");
    let save_two = save_main(&repo, &xml(1, 2, "second"));
    let two = user_commit(&repo, &set, "main", "second idea");
    let asked = [
        (save_one, ObjectKind::Save),
        (one, ObjectKind::Commit),
        (save_two, ObjectKind::Save),
        (two, ObjectKind::Commit),
    ];
    // The hub already holds the first save.
    let lacking = asked[1..].to_vec();
    let max_bytes = 1 << 20;
    let pack = packs_of(&repo, &lacking, max_bytes);
    assert_eq!(pack.len(), 1);
    let server = MockServer::start(vec![
        repo_state(),
        missing(&lacking),
        limits(max_bytes),
        ok(json!({ "stored": lacking.len(), "known": 0 })),
        ok(json!({ "inserted": 2 })),
        repo_state(),
    ]);
    pushed_before_lineage(&repo, &server, &set);

    let report = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap();

    assert_eq!(
        paths(&server),
        [
            "GET /api/repos/3",
            "POST /api/repos/3/objects/missing",
            "GET /api/uploads/limits",
            "POST /api/repos/3/objects",
            "POST /api/repos/3/commits",
        ]
    );
    assert_eq!(
        body(&server, 1),
        json!({ "hashes": hexes(&ids_of(&asked)) })
    );
    {
        let requests = server.requests();
        assert_eq!(requests[3].body, pack[0]);
        assert_eq!(
            record_kinds(&requests[3].body),
            [(one, 5), (save_two, 4), (two, 5)]
        );
    }
    let reposted = body(&server, 4);
    assert_eq!(reposted["ditSetId"], json!(set));
    assert_eq!(reposted["branch"], json!("main"));
    let commits = reposted["commits"].as_array().unwrap();
    assert_eq!(
        commits
            .iter()
            .map(|commit| commit["hash"].clone())
            .collect::<Vec<_>>(),
        [json!(one.to_string()), json!(two.to_string())]
    );
    assert_eq!(
        commits
            .iter()
            .map(|commit| commit["lineageObjects"].clone())
            .collect::<Vec<_>>(),
        [
            json!(hexes(&[save_one, one])),
            json!(hexes(&[save_two, two]))
        ]
    );
    assert_eq!(report.branches.len(), 1);
    let sent = &report.branches[0];
    assert_eq!((sent.saves, sent.commits, sent.lineage), (0, 0, 2));
    assert_eq!(
        repo.pushed(&set).unwrap().unwrap().branches["main"],
        PushedBranch {
            commit: Some(two),
            saves: vec![save_one, save_two],
            lineage: Some(two),
            ..Default::default()
        }
    );

    let report = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap();

    assert_eq!(paths(&server)[5..], ["GET /api/repos/3"]);
    assert_eq!(report.branches, []);
}

#[test]
fn a_lineage_the_hub_refuses_fails_the_push_and_leaves_the_cursor_unset() {
    let (_root, repo) = repo();
    save_main(&repo, &xml(1, 2, "first"));
    let set = set_id(&repo);
    let commit = user_commit(&repo, &set, "main", "first idea");
    let server = MockServer::start(vec![
        repo_state(),
        missing(&[]),
        (
            400,
            json!({ "error": "The hub does not hold those objects.", "code": "lineage_not_held" })
                .to_string(),
        ),
    ]);
    pushed_before_lineage(&repo, &server, &set);

    let error = push(&repo, &remote_to(&server), &PushOptions::default()).unwrap_err();

    assert!(
        matches!(
            &error,
            PushError::Remote(RemoteError::Refused {
                status: 400,
                code: Some(code),
                ..
            }) if code == "lineage_not_held"
        ),
        "{error:?}"
    );
    let state = repo.pushed(&set).unwrap().unwrap().branches["main"].clone();
    assert_eq!((state.commit, state.lineage), (Some(commit), None));
}

/// A hub that, like the real one, refuses a second save at a millisecond of the session another save holds.
fn hub_refusing_saves_that_share_a_time() -> MockServer {
    let mut held = HashSet::new();
    MockServer::route(move |request| match request.path_only() {
        "/api/repos/3" => Reply::json(200, repo_state().1),
        "/api/repos/3/saves" => {
            let body = request.json();
            let saves = body["saves"].as_array().unwrap();
            if saves
                .iter()
                .any(|save| !held.insert(save["fileUpdatedAt"].as_i64().unwrap()))
            {
                return Reply::json(409, refused(409, "A save already holds that time").1);
            }
            Reply::json(200, json!({ "saved": saves.len() }).to_string())
        }
        "/api/repos/3/objects/missing" => Reply::json(200, json!({ "missing": [] }).to_string()),
        "/api/uploads/limits" => Reply::json(200, limits(1 << 20).1),
        _ => Reply::json(200, json!({ "inserted": 1 }).to_string()),
    })
}

#[test]
fn backfilled_copies_that_shared_a_time_push_without_a_409() {
    let (_root, repo) = repo();
    write_set(&set_path(&repo), &xml(1, 2, "now"));
    let at = std::time::UNIX_EPOCH + std::time::Duration::from_secs(5000);
    for (name, document) in [("a", "first"), ("b", "second"), ("c", "third")] {
        let path = repo.root().join(format!("Backup/Song [{name}].tset"));
        write_set(&path, &xml(1, 2, document));
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(at)
            .unwrap();
    }
    std::fs::File::options()
        .write(true)
        .open(set_path(&repo))
        .unwrap()
        .set_modified(at)
        .unwrap();
    let outcome = repo.backfill_set(&set_path(&repo), "Ada").unwrap();
    let server = hub_refusing_saves_that_share_a_time();
    adopted(&repo, &server, &outcome.set_id);

    push(&repo, &remote_to(&server), &PushOptions::default()).unwrap();

    let sent: Vec<i64> = server
        .requests()
        .iter()
        .filter(|request| request.path_only() == "/api/repos/3/saves")
        .flat_map(|request| {
            request.json()["saves"]
                .as_array()
                .unwrap()
                .iter()
                .map(|save| save["fileUpdatedAt"].as_i64().unwrap())
                .collect::<Vec<_>>()
        })
        .collect();
    assert_eq!(sent.len(), 4);
    assert_eq!(sent.iter().collect::<HashSet<_>>().len(), 4);
}
