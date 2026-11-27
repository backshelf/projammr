//! The backfill run against a scripted hub: Check, bringing a folder in, resuming at the set a stopped run was on,
//! pausing between sets and in the middle of a push, folders that fail alone, and the folder's owner being told.

use std::fs;
use std::panic::{self, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use dit_core::remote::test_support::MockServer;
use dit_core::remote::{Remote, SetTarget};
use dit_core::{Repo, RepoList};
use tempfile::TempDir;

use super::driver::{BackfillError, Config, Driver, Event, Owner};
use super::run::{self, Checked, Doubt, Recorder};
use super::state::{FolderPlan, FolderState, Plan, RunLock, SetPlan, Summary};
use super::test_hub::{Hub, hub};
use crate::test_support::{registry, set_mtime, write_set};

/// What the owner was told, and how many requests the hub had been sent when it was.
type Calls = Arc<Mutex<Vec<(String, usize)>>>;

struct Log {
    calls: Calls,
    hub: Arc<Mutex<Hub>>,
}

impl Log {
    fn note(&self, call: &str, folder: &Path) {
        let name = folder.file_name().unwrap().to_string_lossy();
        let requests = self.hub.lock().unwrap().requests.len();
        self.calls
            .lock()
            .unwrap()
            .push((format!("{call} {name}"), requests));
    }
}

impl Owner for Log {
    fn hold(&self, folder: &Path) {
        self.note("hold", folder);
    }
    fn release(&self, folder: &Path) {
        self.note("release", folder);
    }
    fn join(&self, folder: &Path) {
        self.note("join", folder);
    }
}

struct World {
    home: TempDir,
    root: PathBuf,
    server: MockServer,
    hub: Arc<Mutex<Hub>>,
    remote: Remote,
    calls: Calls,
    recorder: Recorder,
    driver: Driver,
}

/// A document no compressor shrinks much, so a set's objects take real bytes on the wire.
fn noise(seed: u64, len: usize) -> String {
    let mut state = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
    (0..len)
        .map(|_| {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            char::from(b'a' + ((state >> 33) % 26) as u8)
        })
        .collect()
}

fn doc(text: &str) -> String {
    format!("<doc>\n<t id=\"1\"/>\n{text}")
}

impl World {
    fn new() -> Self {
        let home = tempfile::tempdir().unwrap();
        let root = home.path().canonicalize().unwrap().join("Music");
        fs::create_dir_all(&root).unwrap();
        let (server, hub, remote) = hub();
        let calls = Calls::default();
        let recorder = Recorder {
            registry: registry(),
            author: "ada".to_string(),
            machine: Arc::new(|| "Studio iMac".to_string()),
        };
        let mut config = Config::new(
            recorder.clone(),
            super::state::State::beside(&home.path().join("config.toml")),
            home.path().join("repos.toml"),
        );
        config.owner = Arc::new(Log {
            calls: calls.clone(),
            hub: hub.clone(),
        });
        config.retry = |_| Duration::from_millis(10);
        config.progress_every = Duration::ZERO;
        World {
            home,
            root,
            server,
            hub,
            remote,
            calls,
            recorder,
            driver: Driver::new(config),
        }
    }

    /// A project folder `<name> Project` whose sets are the given (name, document) pairs, each saved at a later time
    /// than the last.
    fn project(&self, name: &str, sets: &[(&str, String)]) -> PathBuf {
        let dir = self.root.join(format!("{name} Project"));
        fs::create_dir_all(&dir).unwrap();
        for (at, (file, body)) in sets.iter().enumerate() {
            write_set(
                &dir.join(format!("{file}.fset")),
                body,
                50_000_000 + at as i64 * 1_000,
            );
        }
        dir
    }

    /// A `Backup/` copy of the set `set`, saved at `mtime_ms`.
    fn copy(&self, dir: &Path, set: &str, number: u32, body: &str, mtime_ms: i64) {
        let backup = dir.join("Backup");
        fs::create_dir_all(&backup).unwrap();
        let path = backup.join(format!("{set}-{number}.fset"));
        write_set(&path, body, mtime_ms);
        set_mtime(&path, mtime_ms);
    }

    fn check(&self, dir: &Path) -> Checked {
        run::check(&self.recorder, dir, &AtomicBool::new(false), &mut |_, _| {}).unwrap()
    }

    /// The plan that brings each of `folders` in as new sessions on one new track.
    fn plan(&self, folders: &[&Path]) -> Plan {
        Plan {
            folders: folders
                .iter()
                .map(|folder| {
                    let checked = self.check(folder);
                    FolderPlan {
                        path: checked.path.clone(),
                        project_id: 4,
                        created_dit: checked.created_dit,
                        sets: checked
                            .sets
                            .iter()
                            .map(|set| SetPlan {
                                set_id: set.set_id.clone().expect("a recorded set"),
                                file: set.file.clone(),
                                target: SetTarget::NewTrack("science".to_string()),
                            })
                            .collect(),
                    }
                })
                .collect(),
        }
    }

    fn run(&self, plan: Plan) -> (Result<Summary, BackfillError>, Vec<Event>) {
        let mut events = Vec::new();
        let result = self
            .driver
            .start(&self.remote, plan, &mut |event| events.push(event));
        (result, events)
    }

    fn state_of(&self, dir: &Path) -> FolderState {
        let status = self.driver.status().unwrap().expect("a run");
        let canonical = dir.canonicalize().unwrap();
        status
            .folders
            .into_iter()
            .find(|folder| folder.path == canonical)
            .expect("the folder is in the run")
            .state
    }

    fn calls(&self) -> Vec<String> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .map(|(call, _)| call.clone())
            .collect()
    }
}

fn states(events: &[Event], dir: &Path) -> Vec<FolderState> {
    let canonical = dir.canonicalize().unwrap();
    events
        .iter()
        .filter_map(|event| match event {
            Event::Folder { path, state } if *path == canonical => Some(state.clone()),
            _ => None,
        })
        .collect()
}

#[test]
fn check_reads_every_set_into_dit_with_no_commit_and_no_request() {
    let world = World::new();
    let dir = world.project("science", &[("a", doc("a")), ("b", doc("b"))]);
    world.copy(&dir, "a", 1, &doc("a before"), 1_000);
    let mut heard = Vec::new();

    let checked = run::check(
        &world.recorder,
        &dir,
        &AtomicBool::new(false),
        &mut |done, of| heard.push((done, of)),
    )
    .unwrap();

    assert!(checked.created_dit);
    assert_eq!(heard, [(0, 2), (1, 2), (2, 2)]);
    assert_eq!(checked.sets.len(), 2);
    assert_eq!(
        (checked.sets[0].copies, checked.sets[0].saves),
        (1, 2),
        "the set and its copy"
    );
    assert_eq!(checked.sets[0].fingerprints.len(), 2);
    assert_eq!((checked.sets[1].copies, checked.sets[1].saves), (0, 1));
    assert!(checked.sets.iter().all(|set| set.doubt.is_none()));
    let repo = Repo::open(&dir, &registry()).unwrap();
    for set in &checked.sets {
        let id = set.set_id.as_ref().unwrap();
        assert_eq!(repo.read_ref(id, "main").unwrap(), None, "no commit yet");
    }
    assert!(world.hub.lock().unwrap().requests.is_empty());

    let mut ids: Vec<_> = checked.objects.iter().map(|(id, _)| *id).collect();
    let listed = ids.len();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), listed, "each object once");
    for (id, size) in &checked.objects {
        assert_eq!(repo.store().frame_len(id).unwrap(), *size);
    }
}

#[test]
fn samples_are_counted_only_when_the_repo_or_the_instance_pushes_them() {
    let id = |byte: u8| dit_core::ObjectId::from_bytes([byte; 32]);
    let mut checked = Checked {
        path: PathBuf::from("/music/a Project"),
        created_dit: false,
        sets: Vec::new(),
        objects: vec![(id(1), 10)],
        samples: vec![(id(2), 500)],
        pushes_samples: false,
    };

    assert_eq!(
        checked.objects_to_send(false).collect::<Vec<_>>(),
        [(id(1), 10)]
    );
    assert_eq!(
        checked.objects_to_send(true).collect::<Vec<_>>(),
        [(id(1), 10), (id(2), 500)]
    );
    checked.pushes_samples = true;
    assert_eq!(checked.objects_to_send(false).count(), 2);
}

#[test]
fn a_second_check_finds_the_folder_a_repo_and_discard_removes_only_what_check_made() {
    let world = World::new();
    let dir = world.project("science", &[("a", doc("a"))]);
    let first = world.check(&dir);
    let again = world.check(&dir);

    assert!(first.created_dit);
    assert!(!again.created_dit);
    assert_eq!(again.objects, first.objects, "recording twice records once");

    run::discard(&dir).unwrap();
    assert!(!dir.join(".dit").exists());
    assert!(dir.join("a.fset").exists());
    run::discard(&dir).unwrap();
}

#[test]
fn a_set_the_dit_module_cannot_read_is_stored_whole_and_marked() {
    let world = World::new();
    let dir = world.project(
        "science",
        &[("a", doc("fine")), ("b", doc("<broken/> not a document"))],
    );

    let checked = world.check(&dir);

    assert_eq!(checked.sets[0].doubt, None);
    assert_eq!(checked.sets[1].doubt, Some(Doubt::Unreadable));
    assert!(checked.sets[1].set_id.is_some(), "it is still brought in");
}

#[test]
fn check_stops_when_cancelled_and_leaves_what_it_recorded() {
    let world = World::new();
    let dir = world.project("science", &[("a", doc("a")), ("b", doc("b"))]);
    let cancel = AtomicBool::new(false);

    // Cancelled as the first set is read: the check is read again before the second.
    let result = run::check(&world.recorder, &dir, &cancel, &mut |done, _| {
        if done == 0 {
            cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    });

    assert!(matches!(result, Err(run::CheckError::Cancelled)));
    let repo = Repo::open(&dir, &registry()).unwrap();
    assert_eq!(
        repo.sets().unwrap().len(),
        1,
        "the first set stays recorded"
    );
}

#[test]
fn a_folder_is_brought_in_and_the_summary_goes_back_to_the_oldest_save() {
    let world = World::new();
    let dir = world.project("science", &[("a", doc("a")), ("b", doc("b"))]);
    world.copy(&dir, "a", 1, &doc("a 2019"), 1_000);
    world.copy(&dir, "a", 2, &doc("a 2020"), 2_000);
    let mut plan = world.plan(&[&dir]);
    plan.folders[0].sets[0].target = SetTarget::Session(7);

    let (result, events) = world.run(plan);

    let summary = result.unwrap();
    assert_eq!(
        summary,
        Summary {
            first_save: Some(1_000),
            saves: 4,
            sets: 2,
            projects: 1,
        },
        "the oldest save is the oldest copy's time, not the commit's"
    );
    assert_eq!(world.state_of(&dir), FolderState::Done);
    let states = states(&events, &dir);
    assert_eq!(
        states.first(),
        Some(&FolderState::Committing { done: 0, of: 2 })
    );
    assert!(states.contains(&FolderState::Committing { done: 2, of: 2 }));
    assert!(
        states.iter().any(
            |state| matches!(state, FolderState::Uploading { sent, of } if sent > &0 && sent <= of)
        ),
        "{states:?}"
    );
    assert_eq!(states.last(), Some(&FolderState::Done));

    let hub = world.hub.lock().unwrap();
    assert_eq!(hub.repos.keys().collect::<Vec<_>>(), ["science Project"]);
    assert_eq!(hub.adopts.len(), 2);
    assert!(
        hub.adopts.iter().all(|adopt| adopt.quiet),
        "no activity entries"
    );
    assert_eq!(hub.adopts[0].session, Some(7), "the matched session");
    assert_eq!(hub.adopts[1].session, None);
    assert_eq!(hub.adopts[1].track, Some(501), "a new track, made first");
    assert_eq!(hub.tracks, 1, "two sets sent to one new track share it");
    assert!(hub.count("/repos/1/commits") >= 1);
    assert!(hub.held() > 0);

    let repo = Repo::open(&dir, &registry()).unwrap();
    let sets = repo.sets().unwrap();
    for set_id in sets.keys() {
        let head = repo.read_ref(set_id, "main").unwrap().expect("a commit");
        assert_eq!(repo.read_commit(&head).unwrap().message, "Brought into dit");
        assert_eq!(repo.read_commit(&head).unwrap().author, "ada");
    }
    let listed = RepoList::load(&world.home.path().join("repos.toml")).unwrap();
    assert!(listed.repos.contains(&dir.canonicalize().unwrap()));
}

#[test]
fn the_owner_holds_a_folder_before_any_request_and_joins_it_after_the_last() {
    let world = World::new();
    let dir = world.project("science", &[("a", doc("a"))]);
    let plan = world.plan(&[&dir]);

    let (result, _) = world.run(plan);
    result.unwrap();

    let calls = world.calls.lock().unwrap().clone();
    let names: Vec<&str> = calls.iter().map(|(call, _)| call.as_str()).collect();
    assert_eq!(
        names,
        [
            "hold science Project",
            "release science Project",
            "join science Project"
        ]
    );
    assert_eq!(calls[0].1, 0, "held before the hub was asked anything");
    let total = world.hub.lock().unwrap().requests.len();
    assert_eq!(calls[1].1, total);
    assert_eq!(calls[2].1, total);
}

#[test]
fn a_killed_run_resumes_at_the_set_it_was_on() {
    let world = World::new();
    let dir = world.project(
        "science",
        &[("a", doc("a")), ("b", doc("b")), ("c", doc("c"))],
    );
    let plan = world.plan(&[&dir]);

    // The process dies as the second set is brought in.
    let killed = panic::catch_unwind(AssertUnwindSafe(|| {
        world
            .driver
            .start(&world.remote, plan.clone(), &mut |event| {
                if let Event::Folder {
                    state: FolderState::Committing { done: 2, .. },
                    ..
                } = event
                {
                    panic!("killed");
                }
            })
    }));
    assert!(killed.is_err());
    assert!(
        world.hub.lock().unwrap().requests.is_empty(),
        "it died before the hub was asked anything"
    );
    assert!(
        !RunLock::held(&super::state::State::beside(
            &world.home.path().join("config.toml")
        ))
        .unwrap(),
        "a dead run frees the machine's lock"
    );
    let status = world.driver.status().unwrap().unwrap();
    assert!(!status.running && !status.paused);

    let (result, events) = world.run(plan);

    assert_eq!(result.unwrap().sets, 3);
    let states = states(&events, &dir);
    assert_eq!(
        states.first(),
        Some(&FolderState::Committing { done: 2, of: 3 }),
        "the two sets already brought in are not read again"
    );
    assert!(!states.contains(&FolderState::Committing { done: 1, of: 3 }));
    assert_eq!(states.last(), Some(&FolderState::Done));
}

#[test]
fn pausing_between_sets_resumes_at_the_next_one() {
    let world = World::new();
    let dir = world.project(
        "science",
        &[("a", doc("a")), ("b", doc("b")), ("c", doc("c"))],
    );
    let plan = world.plan(&[&dir]);
    let mut events = Vec::new();

    let result = world.driver.start(&world.remote, plan, &mut |event| {
        if matches!(
            &event,
            Event::Folder {
                state: FolderState::Committing { done: 1, .. },
                ..
            }
        ) {
            world.driver.pause();
        }
        events.push(event);
    });

    assert!(matches!(result, Err(BackfillError::Paused)), "{result:?}");
    assert_eq!(events.last(), Some(&Event::Paused));
    assert_eq!(world.state_of(&dir), FolderState::Paused);
    let status = world.driver.status().unwrap().unwrap();
    assert!(status.paused && !status.running);
    assert!(world.hub.lock().unwrap().requests.is_empty());
    assert_eq!(
        world.calls(),
        ["hold science Project", "release science Project"]
    );

    let mut resumed = Vec::new();
    let summary = world
        .driver
        .resume(&world.remote, &mut |event| resumed.push(event))
        .unwrap();

    assert_eq!(summary.sets, 3);
    let states = states(&resumed, &dir);
    assert_eq!(
        states.first(),
        Some(&FolderState::Committing { done: 1, of: 3 })
    );
    assert_eq!(world.state_of(&dir), FolderState::Done);
    assert!(!world.driver.status().unwrap().unwrap().paused);
}

#[test]
fn pausing_in_the_middle_of_a_push_resumes_without_sending_what_the_hub_holds() {
    let world = World::new();
    let dir = world.project(
        "science",
        &[
            ("a", doc(&noise(1, 6_000))),
            ("b", doc(&noise(2, 6_000))),
            ("c", doc(&noise(3, 6_000))),
        ],
    );
    let checked = world.check(&dir);
    // Packs split under the instance's limit: one large object each.
    let largest = checked.objects.iter().map(|(_, size)| *size).max().unwrap();
    world.hub.lock().unwrap().max_bytes = largest as usize + 37;
    let plan = world.plan(&[&dir]);
    let mut paused = false;
    let mut first = Vec::new();

    let result = world.driver.start(&world.remote, plan, &mut |event| {
        if let Event::Folder {
            state: FolderState::Uploading { sent, .. },
            ..
        } = &event
            && *sent > 0
            && !paused
        {
            paused = true;
            world.driver.pause();
        }
        first.push(event);
    });

    assert!(matches!(result, Err(BackfillError::Paused)), "{result:?}");
    let (held_at_pause, packs_at_pause) = {
        let hub = world.hub.lock().unwrap();
        assert_eq!(hub.count("/repos/1/commits"), 0, "paused before any commit");
        (hub.held(), hub.packs)
    };
    assert!(packs_at_pause >= 1);
    assert!(
        held_at_pause < checked.objects.len(),
        "paused with objects still to send: {held_at_pause} of {}",
        checked.objects.len()
    );
    assert_eq!(world.state_of(&dir), FolderState::Paused);
    let first_of = states(&first, &dir)
        .into_iter()
        .find_map(|state| match state {
            FolderState::Uploading { of, .. } => Some(of),
            _ => None,
        })
        .unwrap();

    let mut resumed = Vec::new();
    world
        .driver
        .resume(&world.remote, &mut |event| resumed.push(event))
        .unwrap();

    let resumed_of = states(&resumed, &dir)
        .into_iter()
        .find_map(|state| match state {
            FolderState::Uploading { of, .. } => Some(of),
            _ => None,
        })
        .unwrap();
    assert!(
        resumed_of < first_of,
        "the hub's storage check counts only what it does not hold: {resumed_of} of {first_of}"
    );
    let hub = world.hub.lock().unwrap();
    assert!(
        hub.objects.values().all(|times| *times == 1),
        "no object was sent twice: {:?}",
        hub.objects.values().filter(|times| **times > 1).count()
    );
    assert!(hub.held() >= checked.objects.len());
    assert!(hub.count("/repos/1/commits") >= 1);
    assert_eq!(world.state_of(&dir), FolderState::Done);
}

#[test]
fn a_refused_storage_cap_fails_that_folder_and_the_next_runs() {
    let world = World::new();
    let full = world.project("a", &[("one", doc("one"))]);
    let fits = world.project("b", &[("two", doc("two"))]);
    world
        .hub
        .lock()
        .unwrap()
        .full
        .insert("a Project".to_string());
    let plan = world.plan(&[&full, &fits]);

    let (result, events) = world.run(plan);

    let summary = result.unwrap();
    assert_eq!((summary.projects, summary.sets), (1, 1));
    assert_eq!(
        world.state_of(&full),
        FolderState::Failed(format!(
            "{} refused the push: Storage is full: 5 GB of 5 GB.",
            world.server.host()
        ))
    );
    assert_eq!(world.state_of(&fits), FolderState::Done);
    assert!(matches!(
        states(&events, &full).last(),
        Some(FolderState::Failed(_))
    ));
    assert_eq!(
        world.calls(),
        [
            "hold a Project",
            "release a Project",
            "hold b Project",
            "release b Project",
            "join b Project"
        ],
        "a failed folder is not joined"
    );
    let listed = RepoList::load(&world.home.path().join("repos.toml")).unwrap();
    assert!(!listed.repos.contains(&full.canonicalize().unwrap()));
    assert!(listed.repos.contains(&fits.canonicalize().unwrap()));
    assert!(full.join(".dit").exists(), "its saves stay in .dit/");
}

#[test]
fn a_hub_that_is_away_makes_the_folder_wait_and_it_carries_on_when_it_is_back() {
    let world = World::new();
    let dir = world.project("science", &[("a", doc("a"))]);
    let plan = world.plan(&[&dir]);
    world.hub.lock().unwrap().down = true;

    let hub = world.hub.clone();
    let mut events = Vec::new();
    let result = world.driver.start(&world.remote, plan, &mut |event| {
        if matches!(
            &event,
            Event::Folder {
                state: FolderState::WaitingForHub,
                ..
            }
        ) {
            hub.lock().unwrap().down = false;
        }
        events.push(event);
    });

    result.unwrap();
    let states = states(&events, &dir);
    assert!(states.contains(&FolderState::WaitingForHub), "{states:?}");
    assert_eq!(states.last(), Some(&FolderState::Done));
}

#[test]
fn a_session_taken_in_the_meantime_fails_the_folder_after_its_other_sets_are_sent() {
    let world = World::new();
    let dir = world.project("science", &[("a", doc("a")), ("b", doc("b"))]);
    let mut plan = world.plan(&[&dir]);
    plan.folders[0].sets[0].target = SetTarget::Session(7);
    let taken_set = plan.folders[0].sets[0].set_id.clone();
    world.hub.lock().unwrap().taken.insert(7);

    let (result, _) = world.run(plan);

    result.unwrap();
    let FolderState::Failed(message) = world.state_of(&dir) else {
        panic!("the folder should have failed");
    };
    assert!(message.contains("1 of 2 sets"), "{message}");
    assert!(message.contains("already belongs to a repo"), "{message}");
    let hub = world.hub.lock().unwrap();
    assert_eq!(hub.saves.len(), 1, "only the adopted set was sent");
    assert_ne!(hub.saves[0].1, taken_set);
}

#[test]
fn a_folder_that_moved_fails_by_name_and_the_run_goes_on() {
    let world = World::new();
    let gone = world.project("gone", &[("a", doc("a"))]);
    let there = world.project("there", &[("b", doc("b"))]);
    let plan = world.plan(&[&gone, &there]);
    fs::remove_dir_all(&gone).unwrap();

    let (result, _) = world.run(plan);

    assert_eq!(result.unwrap().projects, 1);
    let status = world.driver.status().unwrap().unwrap();
    assert_eq!(
        status.folders[0].state,
        FolderState::Failed("gone Project moved or was deleted.".to_string())
    );
    assert_eq!(status.folders[1].state, FolderState::Done);
}

#[test]
fn a_sign_in_the_hub_refuses_pauses_the_run_where_it_is() {
    let world = World::new();
    let dir = world.project("science", &[("a", doc("a"))]);
    let plan = world.plan(&[&dir]);
    world.hub.lock().unwrap().signed_out = true;

    let (result, _) = world.run(plan);

    assert!(
        matches!(&result, Err(BackfillError::SignedOut { host }) if *host == world.server.host()),
        "{result:?}"
    );
    assert_eq!(world.state_of(&dir), FolderState::Paused);
    assert!(world.driver.status().unwrap().unwrap().paused);
}

#[test]
fn a_second_run_on_the_machine_is_refused_while_one_holds_the_lock() {
    let world = World::new();
    let dir = world.project("science", &[("a", doc("a"))]);
    let plan = world.plan(&[&dir]);
    let state = super::state::State::beside(&world.home.path().join("config.toml"));
    let lock = RunLock::take(&state).unwrap().unwrap();

    let (result, _) = world.run(plan.clone());
    assert!(matches!(result, Err(BackfillError::Busy)), "{result:?}");
    assert!(
        world.driver.status().unwrap().is_none(),
        "the refused run wrote nothing"
    );
    assert!(world.hub.lock().unwrap().requests.is_empty());

    drop(lock);
    let (result, _) = world.run(plan);
    result.unwrap();
}

#[test]
fn nothing_to_bring_in_is_refused_before_anything_is_written() {
    let world = World::new();

    let (result, _) = world.run(Plan::default());

    assert!(matches!(result, Err(BackfillError::Nothing)));
    assert!(world.driver.status().unwrap().is_none());
}

#[test]
fn a_finished_folder_is_not_brought_in_again_by_the_same_plan() {
    let world = World::new();
    let dir = world.project("science", &[("a", doc("a"))]);
    let plan = world.plan(&[&dir]);
    world.run(plan.clone()).0.unwrap();
    let asked = world.hub.lock().unwrap().requests.len();

    let (result, events) = world.run(plan);

    assert_eq!(result.unwrap().sets, 1, "the summary still counts it");
    assert_eq!(world.hub.lock().unwrap().requests.len(), asked);
    assert!(events.is_empty());
}

#[test]
fn a_folder_that_fails_after_its_track_was_made_reuses_the_track_on_the_next_try() {
    let world = World::new();
    let dir = world.project("science", &[("a", doc("a"))]);
    let plan = world.plan(&[&dir]);
    assert!(matches!(
        plan.folders[0].sets[0].target,
        SetTarget::NewTrack(_)
    ));
    world.hub.lock().unwrap().fail_adopt = true;

    world.run(plan.clone()).0.unwrap();

    assert!(matches!(world.state_of(&dir), FolderState::Failed(_)));
    assert_eq!(world.hub.lock().unwrap().tracks, 1);
    world.hub.lock().unwrap().fail_adopt = false;

    world.run(plan).0.unwrap();

    assert_eq!(world.state_of(&dir), FolderState::Done);
    let hub = world.hub.lock().unwrap();
    assert_eq!(hub.tracks, 1, "no second track of the same title");
    assert_eq!(hub.adopts.last().unwrap().track, Some(501));
}

#[test]
fn a_folders_bytes_add_up_across_a_pause_and_a_resume() {
    let world = World::new();
    let dir = world.project(
        "science",
        &[
            ("a", doc(&noise(1, 6_000))),
            ("b", doc(&noise(2, 6_000))),
            ("c", doc(&noise(3, 6_000))),
        ],
    );
    let checked = world.check(&dir);
    let largest = checked.objects.iter().map(|(_, size)| *size).max().unwrap();
    world.hub.lock().unwrap().max_bytes = largest as usize + 37;
    let plan = world.plan(&[&dir]);
    let mut paused = false;

    let result = world.driver.start(&world.remote, plan, &mut |event| {
        if let Event::Folder {
            state: FolderState::Uploading { sent, .. },
            ..
        } = &event
            && *sent > 0
            && !paused
        {
            paused = true;
            world.driver.pause();
        }
    });
    assert!(matches!(result, Err(BackfillError::Paused)), "{result:?}");

    let mut resumed = Vec::new();
    world
        .driver
        .resume(&world.remote, &mut |event| resumed.push(event))
        .unwrap();

    let resumed_sent = states(&resumed, &dir)
        .into_iter()
        .filter_map(|state| match state {
            FolderState::Uploading { sent, .. } => Some(sent),
            _ => None,
        })
        .max()
        .unwrap();
    let totals = world.driver.status().unwrap().unwrap().folders[0]
        .totals
        .clone()
        .unwrap();
    assert!(
        totals.bytes > resumed_sent,
        "the folder's bytes include what the first run sent: {} vs {resumed_sent}",
        totals.bytes
    );
}

#[test]
fn a_backup_folder_that_cannot_be_read_fails_check_instead_of_dropping_the_copies() {
    let world = World::new();
    let dir = world.project("science", &[("a", doc("a"))]);
    fs::write(dir.join("Backup"), "not a folder").unwrap();

    let result = run::check(
        &world.recorder,
        &dir,
        &AtomicBool::new(false),
        &mut |_, _| {},
    );

    assert!(
        matches!(result, Err(run::CheckError::Failed(_))),
        "{result:?}"
    );
}

#[test]
fn concurrent_backfill_pushes_independent_folders_and_persists_manifest() {
    let world = World::new();
    let alpha = world.project("alpha", &[("a", doc("alpha"))]);
    let beta = world.project("beta", &[("b", doc("beta"))]);
    let plan = world.plan(&[&alpha, &beta]);

    let mut events = Vec::new();
    let summary = world
        .driver
        .start_with_concurrency(&world.remote, plan, 2, &mut |event| events.push(event))
        .unwrap();

    assert_eq!(summary.projects, 2);
    assert_eq!(summary.sets, 2);
    assert_eq!(world.state_of(&alpha), FolderState::Done);
    assert_eq!(world.state_of(&beta), FolderState::Done);

    let state_path = super::state::State::beside(&world.home.path().join("config.toml"));
    let state = super::state::State::load(&state_path).unwrap();
    assert_eq!(state.folders.len(), 2);
    for folder in &state.folders {
        let manifest = folder
            .manifest
            .as_ref()
            .expect("manifest recorded for completed folder");
        assert!(manifest.repo_id > 0);
        assert!(manifest.track_id.is_some());
        assert_eq!(manifest.track_title.as_deref(), Some("science"));
        assert!(!manifest.matched_existing);
        assert_eq!(manifest.session_ids.len(), 1);
    }
}
