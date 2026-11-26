//! The backfill window's behaviour, over real folders, a scripted hub and a run that needs no hub: what Find lists,
//! what Check proposes and removes, and what closing, quitting, sleeping and the cli do to a run.

use std::fs::{self, OpenOptions};
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant, SystemTime};

use dit_core::remote::test_support::{MockServer, Recorded, Reply, remote_to};
use dit_daemon::backfill::{FolderPlan, FolderStatus, SetPlan, Totals};
use serde_json::json;

use super::*;
use crate::backfill::view::Step;

const FIXTURES: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../packages/dit/crates/dit-daw-ableton/fixtures/Contract Fixtures Project"
);

/// The hub the window asks, answering the reads Check makes from what the test says.
struct FakeHost {
    hub: Mutex<Option<MockServer>>,
    standing: Mutex<Vec<Option<BackfillState>>>,
}

impl FakeHost {
    fn serving(candidates: serde_json::Value) -> Arc<Self> {
        let host = Arc::new(FakeHost {
            hub: Mutex::new(None),
            standing: Mutex::new(Vec::new()),
        });
        host.serve(candidates);
        host
    }

    fn away() -> Arc<Self> {
        Arc::new(FakeHost {
            hub: Mutex::new(None),
            standing: Mutex::new(Vec::new()),
        })
    }

    /// Answers like a hub with the project 4 and the sessions `candidates`.
    fn serve(&self, candidates: serde_json::Value) {
        let server = MockServer::route(move |request: &Recorded| {
            let path = request.path_only().trim_start_matches("/api");
            match path {
                "/me/projects" => Reply::json(
                    200,
                    json!([{ "id": 2, "name": "Watching", "role": "viewer" }, { "id": 4, "name": "Alex", "role": "owner" }, { "id": 9, "name": "Collabs", "role": "editor" }])
                        .to_string(),
                ),
                "/projects/4/sessions/dit-candidates" => {
                    Reply::json(200, json!({ "sessions": candidates }).to_string())
                }
                "/uploads/limits" => Reply::json(
                    200,
                    json!({ "maxBytes": 1_000_000_000, "audioTypes": ["wav"] }).to_string(),
                ),
                "/projects/4/tracks/summary" => Reply::json(
                    200,
                    json!([{ "id": 11, "title": "Science", "archivedAt": null }]).to_string(),
                ),
                "/projects/4/repos/storage-check" => Reply::json(
                    200,
                    json!({ "bytes": 1234, "held": 0, "remainingBytes": 99999 }).to_string(),
                ),
                _ => Reply::json(404, json!({ "message": "no such route" }).to_string()),
            }
        });
        *lock(&self.hub) = Some(server);
    }

    fn last_standing(&self) -> Option<BackfillState> {
        lock(&self.standing).last().copied().flatten()
    }
}

impl Host for FakeHost {
    fn remote(&self) -> Result<Remote, RemoteError> {
        match &*lock(&self.hub) {
            Some(server) => Ok(remote_to(server)),
            None => Err(RemoteError::Unreachable {
                host: "hub.test".to_string(),
                reason: "connection refused".to_string(),
            }),
        }
    }

    fn host(&self) -> Option<String> {
        Some("hub.test".to_string())
    }

    fn standing(&self, standing: Option<BackfillState>) {
        lock(&self.standing).push(standing);
    }
}

/// A run that goes as the test lets it: each folder commits until `finish` is set, and a pause stops it where it is.
#[derive(Default)]
struct FakeEngine {
    run: Mutex<Fake>,
    pause: AtomicBool,
    finish: AtomicBool,
    /// A folder that fails instead of finishing.
    failing: Mutex<Option<PathBuf>>,
    /// The next start fails as a state file that cannot be written does: before any run is recorded.
    fail_without_state: AtomicBool,
    started: Mutex<Vec<Plan>>,
}

#[derive(Default)]
struct Fake {
    status: Option<RunStatus>,
    plan: Option<Plan>,
}

impl FakeEngine {
    fn set(&self, path: &Path, state: FolderState, out: &mut dyn FnMut(Event)) {
        let mut fake = lock(&self.run);
        if let Some(folder) = fake
            .status
            .as_mut()
            .and_then(|status| status.folders.iter_mut().find(|f| f.path == path))
        {
            folder.state = state.clone();
            if state == FolderState::Done {
                folder.totals = Some(Totals {
                    first_save: Some(1_552_348_800_000),
                    saves: 7,
                    sets: 2,
                    bytes: 10,
                });
            }
        }
        drop(fake);
        out(Event::Folder {
            path: path.to_path_buf(),
            state,
        });
    }

    fn running(&self) -> bool {
        lock(&self.run)
            .status
            .as_ref()
            .is_some_and(|status| status.running)
    }

    fn go(&self, out: &mut dyn FnMut(Event)) -> Result<Summary, BackfillError> {
        {
            let mut fake = lock(&self.run);
            if let Some(status) = &mut fake.status {
                status.running = true;
                status.paused = false;
            }
        }
        let folders: Vec<(PathBuf, FolderState)> = lock(&self.run)
            .status
            .iter()
            .flat_map(|status| status.folders.iter())
            .map(|folder| (folder.path.clone(), folder.state.clone()))
            .collect();
        for (path, state) in folders {
            if state == FolderState::Done {
                continue;
            }
            self.set(&path, FolderState::Committing { done: 1, of: 2 }, out);
            loop {
                if self.pause.load(Ordering::SeqCst) {
                    self.set(&path, FolderState::Paused, out);
                    if let Some(status) = &mut lock(&self.run).status {
                        status.paused = true;
                        status.running = false;
                    }
                    out(Event::Paused);
                    return Err(BackfillError::Paused);
                }
                if self.finish.load(Ordering::SeqCst) {
                    break;
                }
                thread::sleep(Duration::from_millis(2));
            }
            if lock(&self.failing).as_deref() == Some(path.as_path()) {
                let reason = "hub.test refused the push: Storage is full.".to_string();
                self.set(&path, FolderState::Failed(reason), out);
            } else {
                self.set(&path, FolderState::Done, out);
            }
        }
        let mut fake = lock(&self.run);
        let status = fake.status.as_mut().expect("a run has a status");
        status.running = false;
        Ok(status.summary())
    }
}

impl Engine for FakeEngine {
    fn start(&self, plan: Plan, out: &mut dyn FnMut(Event)) -> Result<Summary, BackfillError> {
        if self.running() {
            return Err(BackfillError::Busy);
        }
        if self.fail_without_state.load(Ordering::SeqCst) {
            return Err(BackfillError::State(
                "can't write the state file".to_string(),
            ));
        }
        lock(&self.started).push(plan.clone());
        {
            let mut fake = lock(&self.run);
            let status = RunStatus {
                folders: plan
                    .folders
                    .iter()
                    .map(|folder| FolderStatus {
                        path: folder.path.clone(),
                        state: FolderState::Waiting,
                        totals: None,
                    })
                    .collect(),
                paused: false,
                running: true,
            };
            fake.status = Some(status);
            fake.plan = Some(plan);
        }
        self.go(out)
    }

    fn resume(&self, out: &mut dyn FnMut(Event)) -> Result<Summary, BackfillError> {
        if self.running() {
            return Err(BackfillError::Busy);
        }
        self.go(out)
    }

    fn status(&self) -> Result<Option<RunStatus>, BackfillError> {
        Ok(lock(&self.run).status.clone())
    }

    fn plan(&self) -> Result<Option<Plan>, BackfillError> {
        Ok(lock(&self.run).plan.clone())
    }

    fn pause(&self) {
        self.pause.store(true, Ordering::SeqCst);
    }

    fn clear_pause(&self) {
        self.pause.store(false, Ordering::SeqCst);
    }

    fn last_project(&self) -> Result<Option<i64>, BackfillError> {
        Ok(None)
    }
}

struct Rig {
    _dir: tempfile::TempDir,
    /// The folder the roots name.
    root: PathBuf,
    /// The two project folders, canonical: `science Project` (newest) and `halogen Project`.
    science: PathBuf,
    halogen: PathBuf,
    backfill: Arc<Backfill>,
    engine: Arc<FakeEngine>,
    host: Arc<FakeHost>,
}

/// A project folder with `sets` copied from the fixtures, the first one a file saved at `saved`.
fn project(path: &Path, sets: &[&str], saved: SystemTime) {
    fs::create_dir_all(path).unwrap();
    for set in sets {
        let file = path.join(set);
        fs::copy(Path::new(FIXTURES).join(set), &file).unwrap();
        OpenOptions::new()
            .write(true)
            .open(&file)
            .unwrap()
            .set_modified(saved)
            .unwrap();
    }
}

fn rig_with(host: impl FnOnce(&Path) -> Arc<FakeHost>) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("Music");
    let now = SystemTime::now();
    let science = root.join("science Project");
    project(
        &science,
        &["Arranged Set.als", "Empty Set.als"],
        now - Duration::from_secs(60),
    );
    let backups = science.join("Backup");
    fs::create_dir(&backups).unwrap();
    fs::copy(
        Path::new(FIXTURES).join("Arranged Set.als"),
        backups.join("Empty Set [2024-03-01 120000].als"),
    )
    .unwrap();
    let halogen = root.join("halogen Project");
    project(
        &halogen,
        &["Volatile Set.als"],
        now - Duration::from_secs(3600),
    );
    fs::create_dir_all(root.join("notes")).unwrap();
    let (science, halogen) = (
        science.canonicalize().unwrap(),
        halogen.canonicalize().unwrap(),
    );
    let host = host(&science);
    let engine = Arc::new(FakeEngine::default());
    let registry = dit_daws::registry();
    let recorder = Recorder {
        registry: registry.clone(),
        author: "me".to_string(),
        machine: Arc::new(|| "Studio".to_string()),
    };
    let backfill = Backfill::new(
        host.clone(),
        engine.clone(),
        registry,
        recorder,
        dir.path().join("repos.toml"),
    );
    Rig {
        root,
        science,
        halogen,
        backfill,
        engine,
        host,
        _dir: dir,
    }
}

/// A rig whose hub knows the session "science123", which last recorded the folder's `Arranged Set.als`.
fn rig() -> Rig {
    rig_with(|science| {
        FakeHost::serving(json!([{
            "id": 812,
            "name": "science123",
            "trackId": 11,
            "trackTitle": "Science",
            "localFilepath": science.join("Arranged Set.als").display().to_string(),
            "fingerprints": [],
            "lastSaveAt": "2024-03-01T12:00:00.000Z",
        }]))
    })
}

fn wait_for(backfill: &Backfill, what: &str, ready: impl Fn(&View) -> bool) -> View {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let view = backfill.view();
        if ready(&view) {
            return view;
        }
        assert!(Instant::now() < deadline, "{what}: {view:#?}");
        thread::sleep(Duration::from_millis(10));
    }
}

impl Rig {
    /// Find with the root, until the walk has ended.
    fn found(&self) -> View {
        self.backfill
            .set_roots(vec![self.root.display().to_string()])
            .unwrap();
        wait_for(&self.backfill, "the walk ends", |view| {
            !view.searching && !view.folders.is_empty()
        })
    }

    /// Next on both folders, until the hub has answered.
    fn checked(&self) -> View {
        self.found();
        self.backfill
            .check(vec![
                self.science.display().to_string(),
                self.halogen.display().to_string(),
            ])
            .unwrap();
        wait_for(&self.backfill, "check ends", |view| {
            view.can_start || view.hub_error.is_some()
        })
    }

    /// Next, then Start, and wait for the run to be going.
    fn started(&self) -> View {
        self.checked();
        self.going()
    }

    /// Start on what Check read, and wait for the run to be going.
    fn going(&self) -> View {
        self.backfill.begin().unwrap();
        wait_for(&self.backfill, "the run goes", |view| {
            view.run.as_ref().is_some_and(|run| {
                run.running
                    && run
                        .folders
                        .iter()
                        .any(|folder| matches!(folder.state, view::FolderView::Committing { .. }))
            })
        })
    }
}

#[test]
fn find_lists_the_project_folders_under_the_roots_newest_first() {
    let rig = rig();
    let view = rig.found();

    assert_eq!(view.step, Step::Find);
    assert_eq!(
        view.folders
            .iter()
            .map(|folder| (folder.name.as_str(), folder.sets, folder.already))
            .collect::<Vec<_>>(),
        [("science Project", 2, false), ("halogen Project", 1, false)],
        "the folder named for no project is not listed, the newest is first"
    );
    assert_eq!(
        view.chosen.as_ref().map(|chosen| chosen.name.as_str()),
        Some("science Project"),
        "a folder stays chosen whenever any is listed"
    );
    let sets = &view.chosen.unwrap().sets;
    assert_eq!(
        sets.iter()
            .map(|set| (set.name.as_str(), set.copies))
            .collect::<Vec<_>>(),
        [("Arranged Set", 0), ("Empty Set", 1)]
    );
    assert!(sets.iter().all(|set| set.target.is_none()));
}

#[test]
fn a_folder_that_is_a_repo_already_is_listed_and_cannot_be_checked() {
    let rig = rig();
    fs::create_dir(rig.halogen.join(".dit")).unwrap();
    let view = rig.found();

    let halogen = view
        .folders
        .iter()
        .find(|folder| folder.name == "halogen Project")
        .unwrap();
    assert!(halogen.already);
    let refused = rig.backfill.check(vec![rig.halogen.display().to_string()]);
    assert_eq!(
        refused,
        Err("halogen Project is in dit already.".to_string())
    );
}

#[test]
fn roots_that_are_not_folders_are_refused_and_changing_them_searches_again() {
    let rig = rig();
    assert_eq!(
        rig.backfill.set_roots(vec!["/nowhere/at/all".to_string()]),
        Err("/nowhere/at/all isn't a folder dit can read.".to_string())
    );
    rig.found();
    rig.backfill.set_roots(Vec::new()).unwrap();
    let view = rig.backfill.view();
    assert!(view.folders.is_empty() && !view.searching && view.roots.is_empty());
}

#[test]
fn check_reads_the_sets_and_proposes_where_each_goes() {
    let rig = rig();
    let view = rig.checked();

    assert_eq!(view.step, Step::Check);
    assert_eq!(view.hub_error, None);
    assert!(view.can_start);
    assert_eq!(
        view.storage,
        Some(view::Storage {
            bytes: 1234,
            remaining: Some(99_999)
        }),
        "both folders go to one project: its objects are asked about once"
    );
    assert_eq!(
        view.projects.iter().map(|p| p.id).collect::<Vec<_>>(),
        [4, 9]
    );
    assert!(rig.science.join(".dit").is_dir(), "Check records into .dit");
    let chosen = view.chosen.unwrap();
    assert_eq!(
        chosen.project,
        Some(4),
        "the first project when none was used"
    );
    assert_eq!(chosen.new_track, "science");
    let targets: Vec<_> = chosen
        .sets
        .iter()
        .map(|set| (set.name.as_str(), set.target.clone(), set.saves))
        .collect();
    assert_eq!(
        targets,
        [
            ("Arranged Set", Some(Target::Session { id: 812 }), Some(1)),
            ("Empty Set", Some(Target::Track { id: 11 }), Some(2)),
        ],
        "the set the session last recorded matches it, and the other goes on its track; the copy is a save"
    );
    let matched = chosen.sets[0].matched.as_ref().unwrap();
    assert_eq!(
        (matched.session_id, matched.name.as_str()),
        (812, "science123")
    );
    assert_eq!(
        chosen.sessions[0].taken_by,
        Some(chosen.sets[0].file.clone())
    );
}

#[test]
fn a_hub_that_does_not_answer_leaves_the_line_and_start_off_until_it_does() {
    let rig = rig_with(|_| FakeHost::away());
    let view = rig.checked();

    assert_eq!(
        view.hub_error.as_deref(),
        Some("Can't reach hub.test to check your sessions.")
    );
    assert!(!view.can_start);
    assert_eq!(view.storage, None);
    assert!(
        view.folders
            .iter()
            .all(|folder| folder.state == view::FolderView::Checked),
        "the sets are read all the same"
    );

    rig.host.serve(json!([]));
    rig.backfill
        .check(vec![
            rig.science.display().to_string(),
            rig.halogen.display().to_string(),
        ])
        .unwrap();
    let view = wait_for(&rig.backfill, "the hub answers", |view| view.can_start);
    assert_eq!(view.hub_error, None);
}

#[test]
fn back_removes_what_check_made_and_the_next_check_keeps_the_corrections() {
    let rig = rig();
    let view = rig.checked();
    let empty = view.chosen.unwrap().sets[1].file.clone();
    rig.backfill
        .set_target(
            &rig.science.display().to_string(),
            &empty,
            &Target::NewTrack {
                name: "  mine ".to_string(),
            },
        )
        .unwrap();

    rig.backfill.back().unwrap();

    let view = rig.backfill.view();
    assert_eq!(view.step, Step::Find);
    assert!(!rig.science.join(".dit").exists(), "Check's .dit is gone");
    assert!(!rig.halogen.join(".dit").exists());
    assert_eq!(view.folders.len(), 2, "every folder is listed again");

    rig.backfill
        .check(vec![rig.science.display().to_string()])
        .unwrap();
    let view = wait_for(&rig.backfill, "check ends", |view| view.can_start);
    assert_eq!(
        view.chosen.unwrap().sets[1].target,
        Some(Target::NewTrack {
            name: "mine".to_string()
        }),
        "the correction stands, trimmed"
    );
}

#[test]
fn a_session_is_matched_to_at_most_one_set() {
    let rig = rig();
    let view = rig.checked();
    let empty = view.chosen.unwrap().sets[1].file.clone();

    let refused = rig.backfill.set_target(
        &rig.science.display().to_string(),
        &empty,
        &Target::Session { id: 812 },
    );
    assert_eq!(
        refused,
        Err("That session is matched to another set already.".to_string())
    );
    let unknown = rig.backfill.set_target(
        &rig.science.display().to_string(),
        &empty,
        &Target::Track { id: 99 },
    );
    assert_eq!(unknown, Err("That track isn't in the project.".to_string()));
}

#[test]
fn closing_on_find_or_check_leaves_nothing_behind() {
    let rig = rig();
    rig.checked();
    assert!(rig.science.join(".dit").is_dir());

    rig.backfill.closed();

    let view = rig.backfill.view();
    assert_eq!(view.step, Step::Find);
    assert!(view.roots.is_empty() && view.folders.is_empty());
    assert!(!rig.science.join(".dit").exists());
    assert!(!rig.halogen.join(".dit").exists());
}

#[test]
fn start_brings_the_checked_folders_in_newest_first_where_the_window_says() {
    let rig = rig();
    let view = rig.checked();
    let empty = view.chosen.unwrap().sets[1].file.clone();
    rig.backfill
        .set_target(
            &rig.science.display().to_string(),
            &empty,
            &Target::NewTrack {
                name: "mine".to_string(),
            },
        )
        .unwrap();

    let view = rig.going();

    assert_eq!(view.step, Step::BringIn);
    assert_eq!(
        view.folders
            .iter()
            .map(|folder| folder.name.as_str())
            .collect::<Vec<_>>(),
        ["science Project", "halogen Project"]
    );
    let started = lock(&rig.engine.started);
    let plan = &started[0];
    assert_eq!(plan.folders[0].path, rig.science);
    assert_eq!(plan.folders[0].project_id, 4);
    assert!(
        plan.folders[0].created_dit,
        "the run knows Check made the .dit"
    );
    assert_eq!(
        plan.folders[0]
            .sets
            .iter()
            .map(|set| set.target.clone())
            .collect::<Vec<_>>(),
        [
            SetTarget::Session(812),
            SetTarget::NewTrack("mine".to_string())
        ]
    );
    drop(started);
    assert_eq!(
        rig.host.last_standing(),
        Some(BackfillState::Running),
        "the menu says Running"
    );
    rig.engine.finish.store(true, Ordering::SeqCst);
}

#[test]
fn closing_on_bring_in_pauses_the_run_and_reopening_shows_it_paused() {
    let rig = rig();
    rig.started();

    rig.backfill.closed();
    let view = wait_for(&rig.backfill, "the run pauses", |view| {
        view.run
            .as_ref()
            .is_some_and(|run| run.paused && !run.running)
    });
    assert_eq!(view.step, Step::BringIn);
    assert_eq!(rig.host.last_standing(), Some(BackfillState::Paused));

    // A window opened later asks for the run again.
    rig.backfill.open();
    let view = rig.backfill.view();
    assert_eq!(view.step, Step::BringIn);
    assert!(
        view.run.unwrap().paused,
        "it shows Resume, not a run that goes"
    );
    assert!(!rig.science.join("never").exists());

    rig.backfill.resume().unwrap();
    wait_for(&rig.backfill, "the run goes again", |view| {
        view.run
            .as_ref()
            .is_some_and(|run| run.running && !run.paused)
    });
    rig.engine.finish.store(true, Ordering::SeqCst);
    let view = wait_for(&rig.backfill, "the run ends", |view| {
        view.step == Step::Done
    });
    assert_eq!(view.summary.map(|summary| summary.projects), Some(2));
    assert_eq!(rig.host.last_standing(), None, "nothing is left to say");
}

#[test]
fn quitting_and_sleeping_pause_a_run_and_quitting_waits_for_it_to_stop() {
    let rig = rig();
    rig.started();

    // The Mac sleeps: the same pause the cli's hang-up makes.
    BackfillControl::pause(rig.backfill.as_ref());
    wait_for(&rig.backfill, "sleep pauses it", |view| {
        view.run.as_ref().is_some_and(|run| run.paused)
    });
    rig.backfill.resume().unwrap();
    wait_for(&rig.backfill, "it goes again", |view| {
        view.run.as_ref().is_some_and(|run| run.running)
    });

    rig.backfill.shutdown();

    let run = rig.backfill.view().run.unwrap();
    assert!(
        run.paused && !run.running,
        "quit returned once it had stopped"
    );
    assert!(!rig.engine.running());
    assert_eq!(rig.host.last_standing(), Some(BackfillState::Paused));
}

#[test]
fn quitting_on_check_removes_what_check_made() {
    let rig = rig();
    rig.checked();
    assert!(rig.science.join(".dit").is_dir());

    rig.backfill.shutdown();

    assert!(!rig.science.join(".dit").exists());
}

#[test]
fn the_cli_and_the_window_show_one_run() {
    let rig = rig();
    rig.found();
    let plan = Plan {
        folders: vec![FolderPlan {
            path: rig.science.clone(),
            project_id: 4,
            created_dit: false,
            sets: vec![SetPlan {
                set_id: "a".to_string(),
                file: rig.science.join("Empty Set.als"),
                target: SetTarget::NewTrack("science".to_string()),
            }],
        }],
    };
    let seen = Arc::new(Mutex::new(Vec::new()));
    let cli = {
        let (backfill, seen) = (rig.backfill.clone(), seen.clone());
        thread::spawn(move || {
            BackfillControl::start(backfill.as_ref(), plan, &mut |event| {
                lock(&seen).push(event);
            })
        })
    };

    let view = wait_for(&rig.backfill, "the window sees the cli's run", |view| {
        view.step == Step::BringIn
            && view.run.as_ref().is_some_and(|run| run.running)
            && rig.engine.running()
    });
    assert_eq!(view.folders[0].name, "science Project");
    assert_eq!(rig.host.last_standing(), Some(BackfillState::Running));
    assert_eq!(
        rig.backfill.status().unwrap().map(|status| status.running),
        Some(true),
        "the cli's status is the run's"
    );

    // The window's pause stops the run the cli started, and the cli hears it.
    rig.backfill.closed();
    let ended = cli.join().unwrap();
    assert!(matches!(ended, Err(BackfillError::Paused)));
    assert!(lock(&seen).contains(&Event::Paused));
    let view = rig.backfill.view();
    assert!(view.run.unwrap().paused);
    assert_eq!(rig.host.last_standing(), Some(BackfillState::Paused));
}

#[test]
fn a_second_run_is_refused_with_the_engines_words_and_the_step_stays() {
    let rig = rig();
    rig.checked();
    // Another process holds the machine's run.
    lock(&rig.engine.run).status = Some(RunStatus {
        folders: Vec::new(),
        paused: false,
        running: true,
    });

    rig.backfill.begin().unwrap();
    let view = wait_for(&rig.backfill, "the refusal", |view| view.error.is_some());

    assert_eq!(
        view.step,
        Step::Check,
        "the folders Check read are still there"
    );
    assert!(
        view.error
            .unwrap()
            .starts_with("A backfill is running on this machine already.")
    );
}

#[test]
fn a_run_a_quit_left_stopped_opens_as_paused_and_reads_in_the_menu() {
    let rig = rig();
    lock(&rig.engine.run).status = Some(RunStatus {
        folders: vec![
            FolderStatus {
                path: rig.science.clone(),
                state: FolderState::Done,
                totals: Some(Totals {
                    first_save: Some(1),
                    saves: 3,
                    sets: 2,
                    bytes: 4,
                }),
            },
            FolderStatus {
                path: rig.halogen.clone(),
                state: FolderState::Uploading { sent: 1, of: 9 },
                totals: None,
            },
        ],
        paused: false,
        running: false,
    });

    rig.backfill.load();
    assert_eq!(rig.host.last_standing(), Some(BackfillState::Paused));

    rig.backfill.open();
    let view = rig.backfill.view();
    assert_eq!(view.step, Step::BringIn);
    let run = view.run.unwrap();
    assert!(!run.running);
    assert_eq!(
        view.folders
            .iter()
            .map(|folder| folder.state.clone())
            .collect::<Vec<_>>(),
        [
            view::FolderView::Done,
            view::FolderView::Uploading { sent: 1, of: 9 }
        ]
    );
}

#[test]
fn a_finished_run_with_a_failed_folder_opens_on_done_until_it_is_dismissed() {
    let rig = rig();
    lock(&rig.engine.run).status = Some(RunStatus {
        folders: vec![FolderStatus {
            path: rig.science.clone(),
            state: FolderState::Failed("hub.test refused the push: Storage is full.".to_string()),
            totals: None,
        }],
        paused: false,
        running: false,
    });

    rig.backfill.open();
    let view = rig.backfill.view();
    assert_eq!(view.step, Step::Done);
    assert_eq!(
        rig.host.last_standing(),
        None,
        "a finished run says nothing in the menu"
    );
    assert_eq!(
        view.folders[0].state,
        view::FolderView::Failed {
            reason: "hub.test refused the push: Storage is full.".to_string()
        }
    );

    rig.backfill.closed();
    rig.backfill.open();
    assert_eq!(
        rig.backfill.view().step,
        Step::Find,
        "dismissed: a new backfill"
    );
}

#[test]
fn a_run_that_ends_shows_what_it_brought_in_and_where_to_see_the_rest() {
    let rig = rig();
    rig.started();
    *lock(&rig.engine.failing) = Some(rig.halogen.clone());
    rig.engine.finish.store(true, Ordering::SeqCst);

    let view = wait_for(&rig.backfill, "the run ends", |view| {
        view.step == Step::Done
    });

    let summary = view.summary.unwrap();
    assert_eq!((summary.saves, summary.sets, summary.projects), (7, 2, 1));
    assert_eq!(
        view.sessions_path.as_deref(),
        Some("/project/4/session/all?inDit=false")
    );
    assert_eq!(
        view.folders[1].state,
        view::FolderView::Failed {
            reason: "hub.test refused the push: Storage is full.".to_string()
        },
        "the failed folder stays listed with its reason"
    );
}

#[test]
fn try_again_proposes_a_session_another_run_took_as_a_new_session() {
    let rig = rig();
    rig.started();
    *lock(&rig.engine.failing) = Some(rig.science.clone());
    rig.engine.finish.store(true, Ordering::SeqCst);
    wait_for(&rig.backfill, "the run ends", |view| {
        view.step == Step::Done
    });
    // The hub no longer lists session 812 as free.
    rig.host.serve(json!([]));
    *lock(&rig.engine.failing) = None;

    rig.backfill
        .retry(&rig.science.display().to_string())
        .unwrap();
    wait_for(&rig.backfill, "the run ends again", |view| {
        view.step == Step::Done && view.run.as_ref().is_some_and(|run| !run.running)
    });

    let started = lock(&rig.engine.started);
    assert_eq!(started.len(), 2);
    let science = &started[1].folders[0];
    assert_eq!(
        science.sets[0].target,
        SetTarget::Track(11),
        "812 is gone: the set is a new session on the folder's other sets' track"
    );
}

#[test]
fn a_folder_cannot_be_retried_unless_it_failed() {
    let rig = rig();
    rig.started();
    rig.engine.finish.store(true, Ordering::SeqCst);
    wait_for(&rig.backfill, "the run ends", |view| {
        view.step == Step::Done
    });

    assert_eq!(
        rig.backfill.retry(&rig.science.display().to_string()),
        Err("That folder didn't fail.".to_string())
    );
}

#[test]
fn moving_a_folder_to_another_project_proposes_its_sets_again() {
    let rig = rig();
    rig.checked();

    // Project 9 has no routes on the scripted hub: the answer is the hub's refusal, and nothing changes.
    let refused = rig
        .backfill
        .set_project(&rig.science.display().to_string(), 9);
    assert!(refused.is_err());
    let view = rig.backfill.view();
    assert_eq!(view.chosen.unwrap().project, Some(4));
    assert!(view.can_start, "a refused move leaves the check as it was");

    assert_eq!(
        rig.backfill
            .set_project(&rig.science.display().to_string(), 77),
        Err("That project isn't one of yours.".to_string())
    );
}

#[test]
fn closing_check_keeps_the_stale_writer_counters_counting_up() {
    let rig = rig();
    rig.checked();
    let (epoch, find_epoch) = {
        let inner = lock(&rig.backfill.inner);
        (inner.epoch, inner.find_epoch)
    };

    rig.backfill.forget();

    let inner = lock(&rig.backfill.inner);
    assert!(
        inner.epoch > epoch,
        "a Check thread of the old epoch must not match the next one"
    );
    assert!(inner.find_epoch > find_epoch);
}

#[test]
fn a_set_pick_made_while_the_hub_is_being_asked_is_refused() {
    let rig = rig();
    let view = rig.checked();
    let file = view.chosen.unwrap().sets[1].file.clone();
    lock(&rig.backfill.inner).asking = true;

    let refused = rig.backfill.set_target(
        &rig.science.display().to_string(),
        &file,
        &Target::NewTrack {
            name: "mine".to_string(),
        },
    );

    assert!(refused.is_err());
}

#[test]
fn a_run_the_state_file_never_kept_is_not_left_waiting() {
    let rig = rig();
    rig.checked();
    rig.engine.fail_without_state.store(true, Ordering::SeqCst);

    rig.backfill.begin().unwrap();

    let view = wait_for(&rig.backfill, "start fails", |view| view.error.is_some());
    assert!(view.run.is_none(), "no waiting run is left to resume");
}

#[test]
fn ready_refuses_to_start_when_two_sets_claim_the_same_session() {
    let rig = rig();
    rig.checked();
    {
        let mut inner = lock(&rig.backfill.inner);
        let target = SetTarget::Session(812);
        let halogen_set = inner.entries[1].checked().unwrap().sets[0].file.clone();
        inner.entries[1].targets.insert(halogen_set, target);
    }

    assert!(!rig.backfill.view().can_start);
    assert_eq!(
        rig.backfill.begin(),
        Err("Two sets are matched to the same session.".to_string())
    );
}

#[test]
fn concurrent_set_project_calls_preserve_both_folders_changes() {
    let rig = rig();
    rig.checked();
    let server = MockServer::route(move |request: &Recorded| {
        let path = request.path_only().trim_start_matches("/api");
        match path {
            "/me/projects" => Reply::json(
                200,
                json!([
                    { "id": 4, "name": "Alex", "role": "owner" },
                    { "id": 9, "name": "Collabs", "role": "editor" }
                ])
                .to_string(),
            ),
            "/projects/4/sessions/dit-candidates" | "/projects/9/sessions/dit-candidates" => {
                Reply::json(200, json!({ "sessions": [] }).to_string())
            }
            "/projects/4/tracks/summary" | "/projects/9/tracks/summary" => {
                Reply::json(200, json!([]).to_string())
            }
            "/uploads/limits" => Reply::json(
                200,
                json!({ "maxBytes": 1_000_000_000, "audioTypes": ["wav"] }).to_string(),
            ),
            "/projects/4/repos/storage-check" | "/projects/9/repos/storage-check" => Reply::json(
                200,
                json!({ "bytes": 400, "held": 0, "remainingBytes": 600 }).to_string(),
            ),
            _ => Reply::json(404, json!({ "message": "no such route" }).to_string()),
        }
    });
    *lock(&rig.host.hub) = Some(server);

    let b1 = rig.backfill.clone();
    let b2 = rig.backfill.clone();
    let science = rig.science.display().to_string();
    let halogen = rig.halogen.display().to_string();
    let t1 = thread::spawn(move || b1.set_project(&science, 9));
    let t2 = thread::spawn(move || b2.set_project(&halogen, 9));
    assert_eq!(t1.join().unwrap(), Ok(()));
    assert_eq!(t2.join().unwrap(), Ok(()));

    let projects: Vec<Option<i64>> = lock(&rig.backfill.inner)
        .entries
        .iter()
        .map(|entry| entry.project)
        .collect();
    assert_eq!(projects, [Some(9), Some(9)]);
}
