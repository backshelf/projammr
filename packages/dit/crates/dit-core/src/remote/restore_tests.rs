//! `restore` against a scripted hub whose objects are those of another repo, the "other computer": the other repo makes
//! the commits, this computer's repo is a copy of it from before some of them.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use super::restore::{Progress, RestoreError, restore};
use super::test_support::*;
use super::{PushOptions, push};
use crate::repo::test_support::*;
use crate::repo::{RemoteBinding, Repo};
use crate::store::{ObjectId, ObjectRead};

const REPO_ID: i64 = 3;

/// What a test can do to the hub's answers.
#[derive(Default)]
struct Control {
    /// Objects the hub reports as not held.
    hidden: HashSet<ObjectId>,
    /// An object whose record carries the frame of another object (its id, then the other's).
    tampered: Option<(ObjectId, ObjectId)>,
    /// Cut the end off every fetch answer.
    truncate: bool,
    /// How many hashes the hub names as missing besides the hidden ones, when it refuses a fetch.
    phantoms: usize,
    /// The branch the hub says commits are on.
    branch: Option<String>,
}

struct World {
    _roots: [tempfile::TempDir; 2],
    /// The other computer.
    other: Repo,
    /// This computer, bound to the hub.
    here: Repo,
    set: String,
    commits: [ObjectId; 3],
    saves: [ObjectId; 3],
    server: MockServer,
    control: Arc<Mutex<Control>>,
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

/// A repeatable pseudo-random text of `len` characters, which does not compress into one chunk.
fn noise(len: usize) -> String {
    let mut state = 0x2545_f491_4f6c_dd1d_u64;
    (0..len)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (b'a' + (state % 26) as u8) as char
        })
        .collect()
}

/// The hub's reply to `request`, serving objects from `store`.
fn answer(
    request: &Recorded,
    store: &crate::store::Store,
    views: &[(i64, Value)],
    control: &Control,
) -> Reply {
    let path = request.path_only();
    if let Some(id) = path.strip_prefix("/api/commits/") {
        let id: i64 = id.parse().unwrap();
        return match views.iter().find(|(known, _)| *known == id) {
            Some((_, view)) => {
                let mut view = view.clone();
                if let Some(branch) = &control.branch {
                    view["branch"] = json!(branch);
                }
                Reply::json(200, view.to_string())
            }
            None => Reply::json(404, json!({"error": "No such commit."}).to_string()),
        };
    }
    if path == "/api/sessions/11/commits" {
        let rows: Vec<Value> = views.iter().rev().map(|(_, view)| view.clone()).collect();
        return Reply::json(200, json!(rows).to_string());
    }
    if path == "/api/repos/3/objects/fetch" {
        let body = request.json();
        let mut asked = Vec::new();
        for hash in body["hashes"].as_array().unwrap() {
            let id: ObjectId = hash.as_str().unwrap().parse().unwrap();
            if !asked.contains(&id) {
                asked.push(id);
            }
        }
        let mut out = Vec::new();
        let mut missing = Vec::new();
        for id in asked {
            if control.hidden.contains(&id) {
                missing.push(id.to_string());
                continue;
            }
            let Ok((kind, _)) = store.get(&id) else {
                missing.push(id.to_string());
                continue;
            };
            // A tampered object's record carries another object's frame.
            let frame_of = match control.tampered {
                Some((tampered, other)) if tampered == id => other,
                _ => id,
            };
            let frame = store.raw(&frame_of).unwrap();
            out.extend_from_slice(id.as_bytes());
            out.push(kind.as_byte());
            out.extend_from_slice(&(frame.len() as u32).to_le_bytes());
            out.extend_from_slice(&frame);
        }
        if !missing.is_empty() || control.phantoms > 0 {
            missing.extend((0..control.phantoms).map(|at| format!("{at:064x}")));
            let body = json!({
                "error": "The repo does not hold some of those objects.",
                "code": "objects_missing",
                "details": { "hashes": missing },
            });
            return Reply::json(409, body.to_string());
        }
        if control.truncate {
            out.truncate(out.len().saturating_sub(5));
        }
        return Reply::bytes(200, out);
    }
    let body = match path {
        "/api/repos/3" => {
            json!({"id": REPO_ID, "sets": [], "pushSamples": false, "pushSamplesForced": false})
        }
        "/api/repos/3/sets" => json!({"ditSetId": "x", "sessionId": 11}),
        "/api/repos/3/saves" => json!({"saved": 1}),
        "/api/repos/3/segments" => json!({"recorded": 0}),
        "/api/repos/3/objects/missing" => json!({"missing": []}),
        "/api/repos/3/commits" => json!({"inserted": 1}),
        "/api/uploads/limits" => json!({"maxBytes": 1 << 20}),
        other => return Reply::json(404, json!({"error": other}).to_string()),
    };
    Reply::json(200, body.to_string())
}

/// The other computer makes a base save and three commits, each of a new document; this computer is a copy of its
/// repo after the first `local` commits (after the base save when `local` is 0).
fn world(local: usize, documents: [String; 3]) -> World {
    let other_root = tempfile::tempdir().unwrap();
    let other = Repo::init(
        &project(other_root.path()),
        &crate::repo::test_support::TEST_DAW,
    )
    .unwrap();
    let here_root = tempfile::tempdir().unwrap();
    let here_dir = here_root.path().join("Song Project");

    save_main(&other, &xml(1, 2, "base"));
    let set = set_id(&other);
    if local == 0 {
        copy_dir(other.root(), &here_dir);
    }
    let mut commits = Vec::new();
    let mut saves = Vec::new();
    for (at, document) in documents.iter().enumerate() {
        saves.push(save_main(&other, document));
        commits.push(user_commit(&other, &set, "main", &format!("idea {at}")));
        if local == at + 1 {
            copy_dir(other.root(), &here_dir);
        }
    }
    let commits: [ObjectId; 3] = commits.try_into().unwrap();
    let saves: [ObjectId; 3] = saves.try_into().unwrap();

    let views: Vec<(i64, Value)> = (0..3)
        .map(|at| {
            let commit = other.read_commit(&commits[at]).unwrap();
            (
                10 + at as i64,
                json!({
                    "id": 10 + at,
                    "hash": commits[at].to_string(),
                    "parentHash": commit.parent.map(|parent| parent.to_string()),
                    "saveHash": saves[at].to_string(),
                    "message": commit.message,
                    "kind": "user",
                    "committedAt": commit.at,
                    "branch": "main",
                    "ditSetId": set,
                    "repoId": REPO_ID,
                    "sessionId": 11,
                    "sessionName": "Song",
                }),
            )
        })
        .collect();
    let control = Arc::new(Mutex::new(Control::default()));
    let server = {
        let store = other.store().clone();
        let control = control.clone();
        MockServer::route(move |request: &Recorded| {
            let control = control.lock().unwrap();
            answer(request, &store, &views, &control)
        })
    };
    let here = Repo::open(&here_dir, &registry()).unwrap();
    here.bind_remote(&RemoteBinding {
        instance: server.url.clone(),
        repo: REPO_ID,
    })
    .unwrap();
    World {
        _roots: [other_root, here_root],
        other,
        here,
        set,
        commits,
        saves,
        server,
        control,
    }
}

fn documents() -> [String; 3] {
    [xml(1, 2, "one"), xml(3, 4, "two"), xml(5, 6, "three")]
}

fn here_repos(world: &World) -> Vec<PathBuf> {
    vec![world.here.root().to_path_buf()]
}

fn run(
    world: &World,
    commit: i64,
    name: Option<&str>,
) -> (Result<super::Restored, RestoreError>, Vec<Progress>) {
    let mut seen = Vec::new();
    let result = restore(
        &here_repos(world),
        &registry(),
        &remote_to(&world.server),
        commit,
        name,
        &mut |progress| seen.push(progress),
    );
    (result, seen)
}

fn paths(server: &MockServer) -> Vec<String> {
    server
        .requests()
        .iter()
        .map(|request| format!("{} {}", request.method, request.path_only()))
        .collect()
}

#[test]
fn a_commit_made_elsewhere_is_fetched_and_checked_out_with_its_ancestors() {
    let world = world(0, documents());

    let (restored, progress) = run(&world, 12, None);
    let restored = restored.unwrap();

    let name = format!("restore-{}", &world.commits[2].to_string()[..7]);
    assert_eq!(restored.branch, name);
    assert_eq!(restored.commit, world.commits[2]);
    let expected = world
        .other
        .materialise(&world.other.read_save(&world.saves[2]).unwrap())
        .unwrap();
    assert_eq!(fs::read(&restored.file).unwrap(), expected);
    assert_eq!(
        restored.file.file_name().unwrap().to_string_lossy(),
        format!("Song @{name}.tset")
    );
    assert_eq!(
        world.here.read_ref(&world.set, &name).unwrap(),
        Some(world.commits[2])
    );
    // The chain is here, parent by parent, and the branch's history reads through it.
    let history = world.here.history(&world.set, &name).unwrap();
    assert_eq!(
        history.iter().map(|entry| entry.id).collect::<Vec<_>>(),
        [world.commits[2], world.commits[1], world.commits[0]]
    );
    assert_eq!(history[0].commit.parent, Some(world.commits[1]));
    assert_eq!(history[0].saves.len(), 1);
    // The first save of the branch is the new file.
    assert_eq!(world.here.log(&world.set, &name).unwrap().len(), 1);

    // A few requests for the whole chain, never one per object.
    let fetches = paths(&world.server)
        .into_iter()
        .filter(|path| path == "POST /api/repos/3/objects/fetch")
        .count();
    assert_eq!(fetches, restored.requests);
    assert!(
        restored.requests <= 6 && restored.requests < restored.fetched,
        "{} requests for {} objects",
        restored.requests,
        restored.fetched
    );
    assert_eq!(paths(&world.server)[0], "GET /api/commits/12");

    let fetching: Vec<usize> = progress
        .iter()
        .filter_map(|step| match step {
            Progress::Fetching { objects } => Some(*objects),
            Progress::Writing => None,
        })
        .collect();
    assert_eq!(fetching.len(), restored.requests);
    assert!(fetching.windows(2).all(|pair| pair[0] < pair[1]));
    assert_eq!(progress.last(), Some(&Progress::Writing));
}

#[test]
fn only_the_ancestors_this_computer_lacks_are_fetched() {
    let world = world(2, documents());

    let (restored, _) = run(&world, 12, Some("from-elsewhere"));
    let restored = restored.unwrap();

    assert_eq!(restored.branch, "from-elsewhere");
    let objects: Vec<_> = paths(&world.server);
    assert!(objects.contains(&"POST /api/repos/3/objects/fetch".to_string()));
    let history = world.here.history(&world.set, "from-elsewhere").unwrap();
    assert_eq!(history.len(), 3);
    // The commit it forks from is this computer's own and was not fetched again.
    assert!(restored.fetched < 8, "{}", restored.fetched);
}

#[test]
fn a_commit_already_here_needs_no_fetch() {
    let world = world(3, documents());

    let (restored, progress) = run(&world, 11, Some("back"));
    let restored = restored.unwrap();

    assert_eq!(paths(&world.server), ["GET /api/commits/11"]);
    assert_eq!((restored.fetched, restored.requests), (0, 0));
    assert_eq!(
        world.here.read_ref(&world.set, "back").unwrap(),
        Some(world.commits[1])
    );
    assert_eq!(progress, [Progress::Writing]);
    let expected = world
        .other
        .materialise(&world.other.read_save(&world.saves[1]).unwrap())
        .unwrap();
    assert_eq!(fs::read(&restored.file).unwrap(), expected);
}

#[test]
fn an_incomplete_chain_is_refused_before_anything_is_written() {
    let world = world(0, documents());
    world
        .control
        .lock()
        .unwrap()
        .hidden
        .insert(world.commits[1]);

    let (restored, _) = run(&world, 12, Some("never"));

    match restored {
        Err(RestoreError::Incomplete(missing)) => assert_eq!(missing, [world.commits[1]]),
        other => panic!("{other:?}"),
    }
    assert!(!world.here.store().contains(&world.commits[2]));
    assert!(!world.here.store().contains(&world.saves[2]));
    assert!(world.here.branch_files(&world.set).unwrap().is_empty());
    assert!(!world.here.root().join("Song @never.tset").exists());
}

#[test]
fn a_refusal_naming_thousands_of_missing_hashes_is_an_incomplete_chain_with_every_one() {
    let world = world(0, documents());
    {
        let mut control = world.control.lock().unwrap();
        control.hidden.insert(world.commits[1]);
        control.phantoms = 4_999;
    }

    let (restored, _) = run(&world, 12, Some("never"));

    match restored {
        Err(RestoreError::Incomplete(missing)) => {
            assert_eq!(missing.len(), 5_000);
            assert_eq!(missing.iter().collect::<HashSet<_>>().len(), 5_000);
            assert!(missing.contains(&world.commits[1]));
        }
        other => panic!("{other:?}"),
    }
    assert!(!world.here.store().contains(&world.commits[2]));
    assert!(world.here.branch_files(&world.set).unwrap().is_empty());
}

#[test]
fn an_object_that_is_not_what_its_id_says_is_refused_before_anything_is_written() {
    let world = world(0, documents());
    world.control.lock().unwrap().tampered = Some((world.commits[2], world.commits[1]));

    let (restored, _) = run(&world, 12, Some("never"));

    assert!(
        matches!(
            restored,
            Err(RestoreError::BadAnswer(_) | RestoreError::Store(_))
        ),
        "{restored:?}"
    );
    assert!(!world.here.store().contains(&world.commits[2]));
    assert!(world.here.branch_files(&world.set).unwrap().is_empty());
}

#[test]
fn a_body_that_stops_short_is_a_failed_fetch() {
    let world = world(0, documents());
    world.control.lock().unwrap().truncate = true;

    let (restored, _) = run(&world, 12, Some("never"));

    assert!(
        matches!(restored, Err(RestoreError::BadAnswer(_))),
        "{restored:?}"
    );
    assert!(world.here.branch_files(&world.set).unwrap().is_empty());
}

#[test]
fn a_commit_of_a_repo_this_computer_does_not_track_says_so() {
    let world = world(0, documents());
    let (result, _) = {
        let mut ignore = |_: Progress| {};
        (
            restore(
                &[],
                &registry(),
                &remote_to(&world.server),
                12,
                None,
                &mut ignore,
            ),
            (),
        )
    };
    assert_eq!(
        result.unwrap_err().to_string(),
        "Not tracked by dit on this computer."
    );

    // Bound to another hub repo.
    world
        .here
        .bind_remote(&RemoteBinding {
            instance: world.server.url.clone(),
            repo: 99,
        })
        .unwrap();
    let (restored, _) = run(&world, 12, None);
    assert!(matches!(restored, Err(RestoreError::NotTracked)));
    assert_eq!(paths(&world.server).len(), 2, "only the two commit reads");
}

#[test]
fn a_commit_the_hub_does_not_know_is_the_hubs_refusal() {
    let world = world(0, documents());

    let (restored, _) = run(&world, 99, None);

    match restored {
        Err(RestoreError::Remote(super::RemoteError::Refused { status: 404, .. })) => {}
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_commit_of_a_branch_this_computer_lacks_is_refused_before_any_fetch() {
    let world = world(0, documents());
    world.control.lock().unwrap().branch = Some("elsewhere".to_string());

    let (restored, _) = run(&world, 12, None);

    assert!(matches!(
        restored,
        Err(RestoreError::BranchNotHere(branch)) if branch == "elsewhere"
    ));
    assert_eq!(paths(&world.server), ["GET /api/commits/12"]);
}

#[test]
fn a_taken_name_offers_another() {
    let world = world(0, documents());
    fs::write(world.here.root().join("Song @fix.tset"), b"mine").unwrap();

    let (restored, _) = run(&world, 12, Some("fix"));
    match restored {
        Err(RestoreError::BranchFileExists { path, suggestion }) => {
            assert_eq!(path, world.here.root().join("Song @fix.tset"));
            assert_eq!(suggestion, "fix-2");
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(
        fs::read(world.here.root().join("Song @fix.tset")).unwrap(),
        b"mine"
    );

    let (restored, _) = run(&world, 12, Some("fix-2"));
    restored.unwrap();
    let (again, _) = run(&world, 12, Some("fix-2"));
    match again {
        Err(RestoreError::BranchExists { name, suggestion }) => {
            assert_eq!(name, "fix-2");
            assert_eq!(suggestion, "fix-3");
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_large_leaf_is_fetched_with_its_chunks() {
    let big = format!(
        "<doc>\n<track id=\"1\" name=\"a\"/>\n<blob>{}",
        noise(900_000)
    );
    let world = world(0, [xml(1, 2, "one"), xml(3, 4, "two"), big]);

    let (restored, _) = run(&world, 12, None);
    let restored = restored.unwrap();

    let expected = world
        .other
        .materialise(&world.other.read_save(&world.saves[2]).unwrap())
        .unwrap();
    assert_eq!(fs::read(&restored.file).unwrap(), expected);
    assert!(restored.requests <= 6, "{}", restored.requests);
}

#[test]
fn a_save_that_holds_its_file_whole_restores_those_bytes() {
    let other_root = tempfile::tempdir().unwrap();
    let other = Repo::init(
        &project(other_root.path()),
        &crate::repo::test_support::TEST_DAW,
    )
    .unwrap();
    save_main(&other, &xml(1, 2, "base"));
    let set = set_id(&other);
    let here_root = tempfile::tempdir().unwrap();
    let here_dir = here_root.path().join("Song Project");
    copy_dir(other.root(), &here_dir);
    // The test DAW's marker, then bytes that are not UTF-8: the file decodes and cannot be split. Large enough to
    // be chunked.
    let bytes = [
        crate::repo::test_support::MARKER,
        &[0xff, 0xfe],
        noise(700_000).as_bytes(),
    ]
    .concat();
    fs::write(set_path(&other), &bytes).unwrap();
    let save = other.record_save(&set_path(&other)).unwrap().unwrap();
    assert!(other.read_save(&save).unwrap().raw.is_some());
    let commit = user_commit(&other, &set, "main", "odd file");
    let view = json!({
        "id": 40, "hash": commit.to_string(), "parentHash": null, "saveHash": save.to_string(),
        "message": "odd file", "kind": "user", "committedAt": 0, "branch": "main",
        "ditSetId": set, "repoId": REPO_ID, "sessionId": 11, "sessionName": "Song",
    });
    let server = {
        let store = other.store().clone();
        MockServer::route(move |request: &Recorded| {
            answer(request, &store, &[(40, view.clone())], &Control::default())
        })
    };
    let here = Repo::open(&here_dir, &registry()).unwrap();
    here.bind_remote(&RemoteBinding {
        instance: server.url.clone(),
        repo: REPO_ID,
    })
    .unwrap();

    let restored = restore(
        &[here_dir],
        &registry(),
        &remote_to(&server),
        40,
        Some("odd"),
        &mut |_| {},
    )
    .unwrap();

    assert_eq!(fs::read(&restored.file).unwrap(), bytes);
}

#[test]
fn the_new_branch_pushes_after_its_fork() {
    let world = world(1, documents());
    let (restored, _) = run(&world, 12, Some("from-elsewhere"));
    restored.unwrap();
    // A save on the new branch, as the daemon would record when Live saves the file.
    let file = world.here.root().join("Song @from-elsewhere.tset");
    write_set(&file, &xml(7, 8, "mine"));
    world.here.record_save(&file).unwrap();
    let before = world.server.requests().len();

    let report = push(
        &world.here,
        &remote_to(&world.server),
        &PushOptions::default(),
    )
    .unwrap();

    let branch = report
        .branches
        .iter()
        .find(|branch| branch.branch == "from-elsewhere")
        .expect("the new branch is pushed");
    assert_eq!(branch.saves, 2, "the file as restored, then the edit");
    assert_eq!(
        branch.commits, 0,
        "the restored commits are the hub's already"
    );
    let requests = world.server.requests();
    let posted: Vec<Value> = requests[before..]
        .iter()
        .filter(|request| request.path_only() == "/api/repos/3/commits")
        .flat_map(|request| request.json()["commits"].as_array().unwrap().clone())
        .collect();
    assert!(
        posted.iter().all(
            |commit| commit["hash"] != json!(world.commits[1].to_string())
                && commit["hash"] != json!(world.commits[2].to_string())
        ),
        "a commit the hub made is not sent back"
    );
}

#[test]
fn a_long_foreign_chain_takes_a_bounded_number_of_requests() {
    let other_root = tempfile::tempdir().unwrap();
    let other = Repo::init(
        &project(other_root.path()),
        &crate::repo::test_support::TEST_DAW,
    )
    .unwrap();
    save_main(&other, &xml(1, 2, "base"));
    let set = set_id(&other);
    let here_root = tempfile::tempdir().unwrap();
    let here_dir = here_root.path().join("Song Project");
    copy_dir(other.root(), &here_dir);
    let mut views = Vec::new();
    for at in 0..20 {
        let save = save_main(&other, &xml(at, at + 1, &format!("take {at}")));
        let commit = user_commit(&other, &set, "main", &format!("idea {at}"));
        let read = other.read_commit(&commit).unwrap();
        views.push((
            100 + at as i64,
            json!({
                "id": 100 + at, "hash": commit.to_string(),
                "parentHash": read.parent.map(|p| p.to_string()), "saveHash": save.to_string(),
                "message": read.message, "kind": "user", "committedAt": read.at, "branch": "main",
                "ditSetId": set, "repoId": REPO_ID, "sessionId": 11, "sessionName": "Song",
            }),
        ));
    }
    let server = {
        let store = other.store().clone();
        let views = views.clone();
        MockServer::route(move |request: &Recorded| {
            answer(request, &store, &views, &Control::default())
        })
    };
    let here = Repo::open(&here_dir, &registry()).unwrap();
    here.bind_remote(&RemoteBinding {
        instance: server.url.clone(),
        repo: REPO_ID,
    })
    .unwrap();

    let restored = restore(
        &[here_dir],
        &registry(),
        &remote_to(&server),
        119,
        Some("far"),
        &mut |_| {},
    )
    .unwrap();

    assert_eq!(here.history(&set, "far").unwrap().len(), 20);
    let total = server.requests().len();
    assert!(
        restored.requests <= 4 && total <= 6,
        "{} fetches, {total} requests",
        restored.requests
    );
}
