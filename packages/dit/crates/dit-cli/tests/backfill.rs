//! `dit backfill <folder>...` as the dit app answers it: the cli is handed the app's backfill run, the hub is a mock
//! that answers the project list, the sessions a set could join, the tracks and the storage check, and the run itself
//! is a fake that records the plan it was handed and says how it ended.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, SystemTime};

use dit_cli::RemoteSource;
use dit_core::RepoList;
use dit_core::remote::test_support::{MockServer, Reply, remote_to};
use dit_core::remote::{Remote, RemoteError, SetTarget, TokenStore};
use dit_daemon::backfill::{
    BackfillControl, BackfillError, Event, FolderPlan, FolderState, FolderStatus, Plan, RunStatus,
    State, Summary, Totals,
};
use dit_ipc::{Env, Run};
use serde_json::{Value, json};
use tempfile::TempDir;

const FIXTURES: &str = "../dit-daw-ableton/fixtures/Contract Fixtures Project";

/// The cli's surroundings: a config folder in a temp dir and a mock hub the connection goes to.
struct Bench {
    root: TempDir,
    server: MockServer,
}

impl RemoteSource for Bench {
    fn config_path(&self) -> Result<PathBuf, RemoteError> {
        Ok(self.config())
    }

    fn tokens(&self) -> Result<Box<dyn TokenStore>, RemoteError> {
        Err(RemoteError::NoKeyring)
    }

    fn open(&self) -> Result<Remote, RemoteError> {
        Ok(remote_to(&self.server))
    }
}

/// What the mock hub says besides the sessions: the projects the account is in and what the storage check answers.
struct Hub {
    projects: Value,
    sessions: Value,
    tracks: Value,
    bytes: u64,
    remaining: Option<u64>,
}

impl Hub {
    fn one_project(sessions: Value) -> Self {
        Hub {
            projects: json!([{ "id": 3, "name": "Album" }]),
            sessions,
            tracks: json!([]),
            bytes: 5_000,
            remaining: None,
        }
    }
}

impl Bench {
    fn start(root: TempDir, hub: Hub) -> Self {
        let server = MockServer::route(move |request| {
            let path = request.path_only();
            let body = if path == "/api/me/projects" {
                hub.projects.clone()
            } else if path.ends_with("/sessions/dit-candidates") {
                json!({ "sessions": hub.sessions })
            } else if path.ends_with("/tracks/summary") {
                hub.tracks.clone()
            } else if path == "/api/uploads/limits" {
                json!({ "maxBytes": 1024, "audioTypes": [], "pushSamplesEverywhere": false })
            } else if path.ends_with("/repos/storage-check") {
                json!({ "bytes": hub.bytes, "held": 0, "remainingBytes": hub.remaining })
            } else {
                return Reply::json(404, "{}");
            };
            Reply::json(200, body.to_string())
        });
        Bench { root, server }
    }

    fn config(&self) -> PathBuf {
        self.root
            .path()
            .join("config")
            .join("dit")
            .join("config.toml")
    }

    fn repos(&self) -> PathBuf {
        self.config().with_file_name("repos.toml")
    }

    /// Runs `dit <args>` from the temp folder as the app would, with `control` as its backfill run, and gives what the
    /// command printed with what it wrote to `stderr`.
    fn handle(&self, args: &[&str], control: &Fake, stderr: &mut dyn Write) -> dit_ipc::Done {
        let run = Run {
            cwd: self.root.path().to_path_buf(),
            env: Env::default(),
            argv: args.iter().map(|arg| arg.to_string()).collect(),
        };
        dit_cli::handle(run, stderr, self, None, Some(control))
    }

    fn run(&self, args: &[&str], control: &Fake) -> (dit_ipc::Done, String) {
        let mut stderr = Vec::new();
        let done = self.handle(args, control, &mut stderr);
        (done, String::from_utf8(stderr).unwrap())
    }
}

/// A project folder under `root` holding copies of the named fixture sets, each last modified `modified` seconds after
/// the epoch; the folder's canonical path.
fn project(root: &Path, name: &str, sets: &[&str], modified: u64) -> PathBuf {
    let folder = root.join(name);
    fs::create_dir(&folder).unwrap();
    for set in sets {
        let file = folder.join(set);
        fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join(FIXTURES)
                .join(set),
            &file,
        )
        .unwrap();
        fs::File::options()
            .write(true)
            .open(&file)
            .unwrap()
            .set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(modified))
            .unwrap();
    }
    folder.canonicalize().unwrap()
}

/// A run that records what it was asked and ends as told.
struct Fake {
    plan: Mutex<Option<Plan>>,
    /// What `status` says before the run starts, and after.
    before: Option<RunStatus>,
    after: Option<RunStatus>,
    events: Vec<Event>,
    ending: Mutex<Option<Result<Summary, BackfillError>>>,
    started: Mutex<bool>,
    paused: AtomicUsize,
}

impl Fake {
    fn new() -> Self {
        Fake {
            plan: Mutex::new(None),
            before: None,
            after: None,
            events: Vec::new(),
            ending: Mutex::new(None),
            started: Mutex::new(false),
            paused: AtomicUsize::new(0),
        }
    }

    fn ending(self, ending: Result<Summary, BackfillError>) -> Self {
        *self.ending.lock().unwrap() = Some(ending);
        self
    }

    fn plan(&self) -> Option<Plan> {
        self.plan.lock().unwrap().clone()
    }

    fn pauses(&self) -> usize {
        self.paused.load(Ordering::SeqCst)
    }
}

impl BackfillControl for Fake {
    fn start(&self, plan: Plan, out: &mut dyn FnMut(Event)) -> Result<Summary, BackfillError> {
        *self.plan.lock().unwrap() = Some(plan);
        *self.started.lock().unwrap() = true;
        for event in &self.events {
            out(event.clone());
        }
        self.ending
            .lock()
            .unwrap()
            .take()
            .unwrap_or_else(|| Ok(Summary::default()))
    }

    fn status(&self) -> Result<Option<RunStatus>, BackfillError> {
        Ok(if *self.started.lock().unwrap() {
            self.after.clone()
        } else {
            self.before.clone()
        })
    }

    fn pause(&self) {
        self.paused.fetch_add(1, Ordering::SeqCst);
    }
}

/// A stderr nobody is reading any more.
struct Gone;

impl Write for Gone {
    fn write(&mut self, _: &[u8]) -> io::Result<usize> {
        Err(io::ErrorKind::BrokenPipe.into())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn status(folders: Vec<(&Path, FolderState, Option<Totals>)>) -> RunStatus {
    RunStatus {
        folders: folders
            .into_iter()
            .map(|(path, state, totals)| FolderStatus {
                path: path.to_path_buf(),
                state,
                totals,
            })
            .collect(),
        paused: false,
        running: false,
    }
}

/// The plan's folders as `(folder name, project, created .dit, [(set file, target)])`.
type Shape = (String, i64, bool, Vec<(String, SetTarget)>);

fn shape(plan: &Plan) -> Vec<Shape> {
    plan.folders
        .iter()
        .map(|folder| {
            (
                folder
                    .path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                folder.project_id,
                folder.created_dit,
                folder
                    .sets
                    .iter()
                    .map(|set| {
                        (
                            set.file.file_name().unwrap().to_string_lossy().into_owned(),
                            set.target.clone(),
                        )
                    })
                    .collect(),
            )
        })
        .collect()
}

fn a_session(id: i64, name: &str, file: &Path) -> Value {
    json!({
        "id": id,
        "name": name,
        "trackId": 4,
        "trackTitle": "Lead",
        "localFilepath": file.to_str().unwrap(),
        "fingerprints": [],
        "lastSaveAt": null,
    })
}

/// A bench with a project folder newer than another, and a session of the hub the newer one's `Empty Set.als` matches.
fn two_projects() -> (Bench, PathBuf, PathBuf) {
    let root = tempfile::tempdir().unwrap();
    let old = project(
        root.path(),
        "Old Project",
        &["Empty Set.als"],
        1_000_000_000,
    );
    let new = project(
        root.path(),
        "New Project",
        &["Empty Set.als", "Arranged Set.als"],
        1_700_000_000,
    );
    let hub = Hub::one_project(json!([a_session(9, "Opening", &new.join("Empty Set.als"))]));
    (Bench::start(root, hub), old, new)
}

#[test]
fn the_plan_has_the_newest_folder_first_and_each_set_where_the_hub_proposes() {
    let (bench, old, new) = two_projects();
    let fake = Fake::new();

    let (done, stderr) = bench.run(&["backfill", "Old Project", "New Project"], &fake);

    assert_eq!(done.code, 0, "{done:?} {stderr}");
    assert_eq!(
        shape(&fake.plan().unwrap()),
        vec![
            (
                "New Project".to_string(),
                3,
                true,
                vec![
                    ("Arranged Set.als".to_string(), SetTarget::Track(4)),
                    ("Empty Set.als".to_string(), SetTarget::Session(9)),
                ],
            ),
            (
                "Old Project".to_string(),
                3,
                true,
                vec![(
                    "Empty Set.als".to_string(),
                    SetTarget::NewTrack("Old".to_string())
                )],
            ),
        ]
    );
    assert!(new.join(".dit").is_dir() && old.join(".dit").is_dir());
    for line in [
        "Reading New Project · 2 sets",
        "Reading Old Project · 1 set",
        "Empty Set.als matches 'Opening'",
        "Needs 4.9 KB. No storage limit on this instance.",
    ] {
        assert!(stderr.lines().any(|seen| seen == line), "{line}\n{stderr}");
    }
}

#[test]
fn a_folder_named_twice_is_planned_once() {
    let (bench, _, _) = two_projects();
    let fake = Fake::new();

    bench.run(&["backfill", "Old Project", "./Old Project/"], &fake);

    assert_eq!(fake.plan().unwrap().folders.len(), 1);
}

#[test]
fn a_folder_that_is_not_a_project_folder_is_refused() {
    let (bench, _, _) = two_projects();
    fs::create_dir(bench.root.path().join("Samples")).unwrap();
    let fake = Fake::new();

    let (done, _) = bench.run(&["backfill", "Samples"], &fake);

    assert_eq!(done.code, 1);
    assert_eq!(
        done.refusal.as_deref(),
        Some("Samples isn't a Live project folder.")
    );
    assert!(fake.plan().is_none());
}

fn finished(new: &Path, old: &Path) -> RunStatus {
    status(vec![
        (
            new,
            FolderState::Done,
            Some(Totals {
                // 1 March 2019.
                first_save: Some(1_551_398_400_000),
                saves: 37,
                sets: 2,
                bytes: 2_469_606_195,
            }),
        ),
        (
            old,
            FolderState::Failed("the hub said no".to_string()),
            None,
        ),
    ])
}

#[test]
fn json_has_one_object_with_a_done_folder_and_a_failed_one() {
    let (bench, old, new) = two_projects();
    let mut fake = Fake::new();
    fake.after = Some(finished(&new, &old));

    let (done, _) = bench.run(&["backfill", "Old Project", "New Project", "--json"], &fake);

    let result: Value = serde_json::from_str(&done.stdout).expect("stdout is one JSON document");
    assert_eq!(
        result,
        json!({
            "folders": [
                {
                    "folder": "New Project",
                    "path": new.to_str().unwrap(),
                    "state": "done",
                    "sets": 2,
                    "saves": 37,
                    "bytes": 2_469_606_195u64,
                },
                {
                    "folder": "Old Project",
                    "path": old.to_str().unwrap(),
                    "state": "failed",
                    "error": "the hub said no",
                },
            ],
            "summary": { "firstSave": 1_551_398_400_000i64, "saves": 37, "sets": 2, "projects": 1 },
            "paused": false,
        })
    );
    assert_eq!(done.code, 1, "a failed folder fails the command");
    assert_eq!(
        done.refusal.as_deref(),
        Some("1 folder could not be brought in.")
    );
}

#[test]
fn text_says_what_was_brought_in_what_failed_and_how_far_back_the_history_goes() {
    let (bench, old, new) = two_projects();
    let mut fake = Fake::new();
    fake.after = Some(finished(&new, &old));

    let (done, _) = bench.run(&["backfill", "Old Project", "New Project"], &fake);

    assert_eq!(
        done.stdout,
        "brought in New Project: 2 sets, 37 saves, 2.3 GB\n\
         failed Old Project: the hub said no\n\
         history goes back to March 2019: 37 saves across 2 sets in 1 project\n"
    );
}

/// A bench and a run that stopped on request with the newer folder part way and the older one not reached.
fn paused() -> (Bench, Fake) {
    let (bench, old, new) = two_projects();
    let mut fake = Fake::new().ending(Err(BackfillError::Paused));
    fake.after = Some(status(vec![
        (&new, FolderState::Paused, None),
        (&old, FolderState::Waiting, None),
    ]));
    (bench, fake)
}

#[test]
fn a_paused_run_prints_where_it_stands_and_fails_the_command_with_the_pause() {
    let (bench, fake) = paused();

    let (done, _) = bench.run(&["backfill", "Old Project", "New Project", "--json"], &fake);

    let result: Value = serde_json::from_str(&done.stdout).unwrap();
    assert_eq!(result["paused"], true);
    assert_eq!(result["folders"][0]["state"], "paused");
    assert_eq!(result["folders"][1]["state"], "waiting");
    assert_eq!(done.code, 1);
    assert_eq!(
        done.refusal.as_deref(),
        Some("Paused. Run the same command to carry on where it stopped.")
    );
}

#[test]
fn a_paused_run_in_text_says_to_run_the_same_command() {
    let (bench, fake) = paused();

    let (done, _) = bench.run(&["backfill", "Old Project", "New Project"], &fake);

    assert_eq!(done.stdout, "paused; run the same command to carry on\n");
}

#[test]
fn a_sign_in_the_hub_refused_pauses_the_run_the_same_way() {
    let (bench, _, _) = two_projects();
    let fake = Fake::new().ending(Err(BackfillError::SignedOut {
        host: "hub.example".to_string(),
    }));

    let (done, _) = bench.run(&["backfill", "Old Project"], &fake);

    assert_eq!(done.code, 1);
    assert_eq!(
        done.refusal.as_deref(),
        Some("Signed out of hub.example. Run dit login, then carry on.")
    );
    assert!(
        done.stdout
            .contains("paused; run the same command to carry on")
    );
}

#[test]
fn another_run_on_the_machine_is_an_error_and_leaves_no_dit_folder_behind() {
    let (bench, old, _) = two_projects();
    let fake = Fake::new().ending(Err(BackfillError::Busy));

    let (done, _) = bench.run(&["backfill", "Old Project"], &fake);

    assert_eq!(done.code, 1);
    assert_eq!(done.stdout, "");
    assert!(
        done.refusal
            .as_deref()
            .is_some_and(|message| message.starts_with("A backfill is running"))
    );
    assert!(!old.join(".dit").exists());
}

#[test]
fn progress_goes_to_stderr_as_the_run_reports_it() {
    let (bench, _, new) = two_projects();
    let mut fake = Fake::new();
    fake.events = vec![
        Event::Folder {
            path: new.clone(),
            state: FolderState::Committing { done: 0, of: 2 },
        },
        Event::Folder {
            path: new.clone(),
            state: FolderState::Failed("broke".to_string()),
        },
    ];

    let (_, stderr) = bench.run(&["backfill", "New Project"], &fake);

    assert!(stderr.contains("New Project: reading sets\n"), "{stderr}");
    assert!(stderr.contains("New Project: failed: broke\n"), "{stderr}");
}

#[test]
fn a_stderr_that_cannot_be_written_to_pauses_the_run_once() {
    let (bench, _, new) = two_projects();
    let mut fake = Fake::new().ending(Err(BackfillError::Paused));
    fake.events = (0..=2)
        .map(|done| Event::Folder {
            path: new.clone(),
            state: FolderState::Committing { done, of: 2 },
        })
        .collect();

    let done = bench.handle(&["backfill", "New Project"], &fake, &mut Gone);

    assert_eq!(fake.pauses(), 1);
    assert_eq!(done.code, 1);
}

#[test]
fn a_run_that_nobody_hung_up_on_is_never_paused() {
    let (bench, _, _) = two_projects();
    let fake = Fake::new();

    bench.run(&["backfill", "New Project"], &fake);

    assert_eq!(fake.pauses(), 0);
}

fn make_repo(folder: &Path) {
    dit_core::Repo::init(folder, &dit_daw_ableton::Ableton).unwrap();
}

#[test]
fn a_folder_already_in_dit_is_skipped_and_with_nothing_left_the_command_says_so() {
    let (bench, old, _) = two_projects();
    make_repo(&old);
    let fake = Fake::new();

    let (done, stderr) = bench.run(&["backfill", "Old Project"], &fake);

    assert_eq!(done.code, 1);
    assert_eq!(
        done.refusal.as_deref(),
        Some("Everything here is already in dit.")
    );
    assert!(
        stderr.contains("skipping Old Project: already in dit"),
        "{stderr}"
    );
    assert!(fake.plan().is_none());
}

#[test]
fn a_folder_in_dit_is_skipped_while_the_others_go_on() {
    let (bench, old, _) = two_projects();
    make_repo(&old);
    let fake = Fake::new();

    bench.run(&["backfill", "Old Project", "New Project"], &fake);

    let names: Vec<_> = shape(&fake.plan().unwrap())
        .into_iter()
        .map(|folder| folder.0)
        .collect();
    assert_eq!(names, ["New Project"]);
}

#[test]
fn a_folder_on_the_list_of_repos_is_in_dit_even_with_no_dit_folder() {
    let (bench, old, _) = two_projects();
    RepoList::update(&bench.repos(), |list| list.add(&old)).unwrap();
    let fake = Fake::new();

    let (done, _) = bench.run(&["backfill", "Old Project"], &fake);

    assert_eq!(
        done.refusal.as_deref(),
        Some("Everything here is already in dit.")
    );
}

#[test]
fn a_folder_the_stopped_run_holds_is_that_run_being_resumed() {
    let (bench, old, _) = two_projects();
    make_repo(&old);
    let mut fake = Fake::new();
    fake.before = Some(status(vec![(&old, FolderState::Paused, None)]));

    let (done, _) = bench.run(&["backfill", "Old Project"], &fake);

    assert_eq!(done.code, 0, "{done:?}");
    let plan = shape(&fake.plan().unwrap());
    assert_eq!(plan.len(), 1);
    assert!(
        !plan[0].2,
        "the .dit/ was there before this Check: not made by it"
    );
}

#[test]
fn a_held_folder_that_reached_the_list_of_repos_is_done_not_resumed() {
    let (bench, old, _) = two_projects();
    make_repo(&old);
    RepoList::update(&bench.repos(), |list| list.add(&old)).unwrap();
    let mut fake = Fake::new();
    fake.before = Some(status(vec![(&old, FolderState::Done, None)]));

    let (done, _) = bench.run(&["backfill", "Old Project"], &fake);

    assert_eq!(
        done.refusal.as_deref(),
        Some("Everything here is already in dit.")
    );
}

#[test]
fn not_enough_storage_refuses_the_run_and_removes_the_dit_folders_check_made() {
    let root = tempfile::tempdir().unwrap();
    let old = project(
        root.path(),
        "Old Project",
        &["Empty Set.als"],
        1_000_000_000,
    );
    let mut hub = Hub::one_project(json!([]));
    hub.remaining = Some(1_000);
    let bench = Bench::start(root, hub);
    let fake = Fake::new();

    let (done, _) = bench.run(&["backfill", "Old Project"], &fake);

    assert_eq!(done.code, 1);
    assert_eq!(
        done.refusal.as_deref(),
        Some(
            "These folders need 4.9 KB and you have 1000 B left. Run it again with fewer folders."
        )
    );
    assert!(fake.plan().is_none());
    assert!(!old.join(".dit").exists());
    assert!(
        old.join("Empty Set.als").is_file(),
        "the set is never touched"
    );
}

#[test]
fn enough_storage_is_said_with_what_is_left() {
    let root = tempfile::tempdir().unwrap();
    project(
        root.path(),
        "Old Project",
        &["Empty Set.als"],
        1_000_000_000,
    );
    let mut hub = Hub::one_project(json!([]));
    hub.remaining = Some(10_000_000);
    let bench = Bench::start(root, hub);

    let (_, stderr) = bench.run(&["backfill", "Old Project"], &Fake::new());

    assert!(
        stderr.contains("Needs 4.9 KB of your 9.5 MB left.\n"),
        "{stderr}"
    );
}

#[test]
fn several_projects_and_no_flag_asks_which() {
    let root = tempfile::tempdir().unwrap();
    project(
        root.path(),
        "Old Project",
        &["Empty Set.als"],
        1_000_000_000,
    );
    let mut hub = Hub::one_project(json!([]));
    hub.projects = json!([{ "id": 3, "name": "Album" }, { "id": 5, "name": "Single" }]);
    let bench = Bench::start(root, hub);
    let fake = Fake::new();

    let (done, _) = bench.run(&["backfill", "Old Project"], &fake);

    assert_eq!(
        done.refusal.as_deref(),
        Some("You're in several projects (Album 3, Single 5). Run dit backfill --project <id>.")
    );
    assert!(!bench.root.path().join("Old Project/.dit").exists());

    let (done, _) = bench.run(&["backfill", "Old Project", "--project", "5"], &fake);
    assert_eq!(done.code, 0, "{done:?}");
    assert_eq!(fake.plan().unwrap().folders[0].project_id, 5);
}

#[test]
fn a_project_the_account_is_not_in_is_refused() {
    let (bench, _, _) = two_projects();

    let (done, _) = bench.run(&["backfill", "Old Project", "--project", "8"], &Fake::new());

    assert_eq!(done.refusal.as_deref(), Some("You're not in project 8."));
}

#[test]
fn an_account_with_no_projects_says_so() {
    let root = tempfile::tempdir().unwrap();
    project(
        root.path(),
        "Old Project",
        &["Empty Set.als"],
        1_000_000_000,
    );
    let mut hub = Hub::one_project(json!([]));
    hub.projects = json!([]);
    let bench = Bench::start(root, hub);

    let (done, _) = bench.run(&["backfill", "Old Project"], &Fake::new());

    assert_eq!(
        done.refusal,
        Some(format!("You have no projects on {}.", bench.server.host()))
    );
}

#[test]
fn the_project_the_last_backfill_used_is_the_default_among_several() {
    let root = tempfile::tempdir().unwrap();
    project(
        root.path(),
        "Old Project",
        &["Empty Set.als"],
        1_000_000_000,
    );
    let mut hub = Hub::one_project(json!([]));
    hub.projects = json!([{ "id": 3, "name": "Album" }, { "id": 5, "name": "Single" }]);
    let bench = Bench::start(root, hub);
    State::update(&State::beside(&bench.config()), |state| {
        state.plan.folders.push(FolderPlan {
            path: PathBuf::from("/music/Earlier Project"),
            project_id: 5,
            created_dit: false,
            sets: Vec::new(),
        });
    })
    .unwrap();
    let fake = Fake::new();

    bench.run(&["backfill", "Old Project"], &fake);

    assert_eq!(fake.plan().unwrap().folders[0].project_id, 5);
}

#[test]
fn a_folder_with_no_sets_is_skipped_with_a_note_and_leaves_no_dit_folder() {
    let root = tempfile::tempdir().unwrap();
    let empty = project(root.path(), "Silent Project", &[], 0);
    project(
        root.path(),
        "Old Project",
        &["Empty Set.als"],
        1_000_000_000,
    );
    let bench = Bench::start(root, Hub::one_project(json!([])));
    let fake = Fake::new();

    let (_, stderr) = bench.run(&["backfill", "Silent Project", "Old Project"], &fake);

    assert!(
        stderr.contains("skipping Silent Project: it has no sets to bring in.\n"),
        "{stderr}"
    );
    assert!(!empty.join(".dit").exists());
    assert_eq!(fake.plan().unwrap().folders.len(), 1);
}

#[test]
fn a_set_that_cannot_be_read_is_noted_and_kept() {
    let root = tempfile::tempdir().unwrap();
    let folder = project(
        root.path(),
        "Old Project",
        &["Empty Set.als"],
        1_000_000_000,
    );
    fs::write(folder.join("Broken.als"), b"<Ableton><LiveSet>").unwrap();
    let bench = Bench::start(root, Hub::one_project(json!([])));
    let fake = Fake::new();

    let (_, stderr) = bench.run(&["backfill", "Old Project"], &fake);

    assert!(
        stderr.contains("Broken.als couldn't be read; it's stored as it is.\n"),
        "{stderr}"
    );
    let plan = shape(&fake.plan().unwrap());
    assert!(plan[0].3.iter().any(|set| set.0 == "Broken.als"));
}

#[test]
fn create_new_and_no_fuzzy_match_control_how_existing_tracks_are_proposed() {
    let root = tempfile::tempdir().unwrap();
    let folder = project(
        root.path(),
        "Night Drive Project",
        &["Empty Set.als"],
        1_000_000_000,
    );
    // "Night Drive Extended" is a fuzzy match to "Night Drive" (above default 0.6, below 0.95).
    let mut hub = Hub::one_project(json!([]));
    hub.tracks = json!([{ "id": 9, "title": "Night Drive Extended", "archivedAt": null }]);
    let bench = Bench::start(root, hub);

    let default_fake = Fake::new();
    bench.run(&["backfill", "Night Drive Project"], &default_fake);
    assert_eq!(
        shape(&default_fake.plan().unwrap())[0].3[0].1,
        SetTarget::Track(9),
        "default fuzzy matching links close titles"
    );
    fs::remove_dir_all(folder.join(".dit")).unwrap();

    let exact_fake = Fake::new();
    bench.run(
        &["backfill", "--no-fuzzy-match", "Night Drive Project"],
        &exact_fake,
    );
    assert_eq!(
        shape(&exact_fake.plan().unwrap())[0].3[0].1,
        SetTarget::NewTrack("Night Drive".to_string()),
        "--no-fuzzy-match rejects non-exact fuzzy matches"
    );
    fs::remove_dir_all(folder.join(".dit")).unwrap();

    let fresh_fake = Fake::new();
    bench.run(
        &["backfill", "--create-new", "Night Drive Project"],
        &fresh_fake,
    );
    assert_eq!(
        shape(&fresh_fake.plan().unwrap())[0].3[0].1,
        SetTarget::NewTrack("Night Drive".to_string()),
        "--create-new always creates a fresh track"
    );
    fs::remove_dir_all(folder.join(".dit")).unwrap();

    let strict_fake = Fake::new();
    bench.run(
        &[
            "backfill",
            "--match-threshold",
            "0.95",
            "Night Drive Project",
        ],
        &strict_fake,
    );
    assert_eq!(
        shape(&strict_fake.plan().unwrap())[0].3[0].1,
        SetTarget::NewTrack("Night Drive".to_string()),
        "--match-threshold raises the fuzzy bar"
    );
}

#[test]
fn invalid_match_threshold_or_concurrency_is_refused() {
    let (bench, _, _) = two_projects();
    let (bad_thresh, _) = bench.run(
        &["backfill", "--match-threshold", "1.5", "New Project"],
        &Fake::new(),
    );
    assert_eq!(bad_thresh.code, 1);
    assert!(
        bad_thresh
            .refusal
            .as_deref()
            .unwrap_or_default()
            .contains("--match-threshold"),
        "{:?}",
        bad_thresh.refusal
    );

    let (bad_conc, _) = bench.run(
        &["backfill", "--concurrency", "8", "New Project"],
        &Fake::new(),
    );
    assert_eq!(bad_conc.code, 1);
    assert!(
        bad_conc
            .refusal
            .as_deref()
            .unwrap_or_default()
            .contains("--concurrency"),
        "{:?}",
        bad_conc.refusal
    );
}

#[test]
fn json_manifest_includes_repo_track_and_session_ids_from_persisted_state() {
    let (bench, old, new) = two_projects();
    State::update(&State::beside(&bench.config()), |state| {
        state.plan.folders.push(FolderPlan {
            path: new.clone(),
            project_id: 4,
            created_dit: false,
            sets: Vec::new(),
        });
        state.folders.push(dit_daemon::backfill::state::FolderRun {
            state: FolderState::Done,
            manifest: Some(dit_daemon::backfill::FolderManifest {
                repo_id: 42,
                track_id: Some(77),
                track_title: Some("New Song".to_string()),
                matched_existing: true,
                session_ids: vec![101, 102],
            }),
            ..Default::default()
        });
    })
    .unwrap();

    let mut fake = Fake::new();
    fake.after = Some(finished(&new, &old));
    let (done, _) = bench.run(&["backfill", "Old Project", "New Project", "--json"], &fake);
    let result: Value = serde_json::from_str(&done.stdout).unwrap();
    assert_eq!(result["folders"][0]["folder"], "New Project");
    assert_eq!(result["folders"][0]["repoId"], 42);
    assert_eq!(result["folders"][0]["trackId"], 77);
    assert_eq!(result["folders"][0]["trackTitle"], "New Song");
    assert_eq!(result["folders"][0]["matchedExisting"], true);
    assert_eq!(result["folders"][0]["sessionIds"], json!([101, 102]));
}
