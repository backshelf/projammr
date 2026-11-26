//! The watcher against the real filesystem event stream (FSEvents on macOS, inotify on Linux).
//!
//! These are the only tests in the crate that depend on timing outside the process, so they are written not to
//! flake: every wait has a generous deadline, and the end-to-end test rewrites the set again every 8 seconds
//! (with a different tempo, so each write is a change) until a save is recorded, since an event written before the
//! stream is live is simply lost. They skip, saying so, where the platform cannot watch (a watcher that will not
//! start, such as inotify's instance limit in a container) or when `DIT_SKIP_FS_TESTS` is set, which a CI runner
//! with an unreliable filesystem can do.

#![cfg(any(target_os = "macos", target_os = "linux"))]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

use dit_core::remote::Machine;
use dit_core::remote::test_support::{MockServer, Recorded, Reply, remote_to};
use dit_core::{Daw, Registry, RemoteBinding, Repo, RepoList};
use dit_daemon::event::{DaemonEvent, Origin};
use dit_daemon::fswatch::{FsEvent, Fswatch};
use dit_daemon::queue::QueueOptions;
use dit_daemon::runner::{Hub, Options, start};
use dit_daemon::{Config, SystemClock};
use dit_daw_ableton::Ableton;
use serde_json::json;

const PROJECT: &str = "Contract Fixtures Project";
const SET: &str = "Empty Set.als";

fn skip() -> bool {
    if std::env::var_os("DIT_SKIP_FS_TESTS").is_some() {
        eprintln!("skipped: DIT_SKIP_FS_TESTS is set");
        return true;
    }
    false
}

#[test]
fn a_file_created_under_a_subscribed_folder_is_reported_with_its_real_path() {
    if skip() {
        return;
    }
    let Ok(fswatch) = Fswatch::new() else {
        eprintln!("skipped: this platform cannot start a watcher here");
        return;
    };
    let dir = tempfile::tempdir().unwrap().keep().canonicalize().unwrap();
    let (sender, events) = mpsc::channel::<FsEvent>();
    let Ok(_subscription) = fswatch.subscribe(&dir, |_| true, sender) else {
        eprintln!("skipped: the folder could not be watched");
        return;
    };
    let target = dir.join("created.txt");
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut seen = false;
    while Instant::now() < deadline && !seen {
        // A stream that is not live yet loses what is written; writing again is the remedy, not a longer sleep.
        fs::write(&target, format!("{:?}", Instant::now())).unwrap();
        let window = Instant::now() + Duration::from_secs(5);
        while Instant::now() < window {
            if let Ok(event) = events.recv_timeout(Duration::from_millis(200))
                && event.path == target
            {
                seen = true;
                break;
            }
        }
    }
    assert!(seen, "no event for {}", target.display());
}

/// Rewrites `path` with its tempo set to `bpm`, as Live would on a save.
fn set_tempo(path: &Path, bpm: &str) {
    let xml = String::from_utf8(Ableton.decode(&fs::read(path).unwrap()).unwrap()).unwrap();
    let tempo = xml.find("<Tempo>").expect("the set has a tempo");
    let value = tempo + xml[tempo..].find("<Manual Value=\"").unwrap() + "<Manual Value=\"".len();
    let end = value + xml[value..].find('"').unwrap();
    let edited = format!("{}{bpm}{}", &xml[..value], &xml[end..]);
    fs::write(path, Ableton.encode(edited.as_bytes()).unwrap()).unwrap();
}

fn fixture() -> (PathBuf, Repo, Config, PathBuf) {
    let root = tempfile::tempdir().unwrap().keep().canonicalize().unwrap();
    let dir = root.join(PROJECT);
    fs::create_dir(&dir).unwrap();
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../dit-daw-ableton/fixtures")
        .join(PROJECT);
    fs::copy(source.join(SET), dir.join(SET)).unwrap();
    let repo = Repo::init(&dir, &Ableton).unwrap();
    repo.record_save(&dir.join(SET)).unwrap();
    let home = root.join("home");
    fs::create_dir(&home).unwrap();
    let repos_file = home.join("repos.toml");
    RepoList::update(&repos_file, |list| {
        list.bootstrapped = true;
        list.add(&dir);
    })
    .unwrap();
    let config = Config {
        registry: Registry::new(vec![&Ableton]).unwrap(),
        home,
        repos_file,
        clock: std::sync::Arc::new(SystemClock),
        lock_wait: Duration::from_secs(2),
    };
    (dir, repo, config, root)
}

#[test]
fn a_save_live_makes_is_recorded_by_the_running_daemon() {
    if skip() {
        return;
    }
    let (dir, repo, config, _root) = fixture();
    let set = dir.join(SET);
    let options = Options {
        tick: Duration::from_millis(250),
        poll: Duration::from_secs(3600),
        ..Options::default()
    };
    let Ok(running) = start(config, options) else {
        eprintln!("skipped: this platform cannot start a watcher here");
        return;
    };
    let tracked_by = Instant::now() + Duration::from_secs(30);
    loop {
        match running.events().recv_timeout(Duration::from_millis(200)) {
            Ok(DaemonEvent::RepoTracked { .. }) => break,
            _ if Instant::now() > tracked_by => panic!("the repo was never tracked"),
            _ => {}
        }
    }

    let mut recorded = None;
    for attempt in 0..4 {
        // Live's write: the file is replaced and the daemon sees it settle.
        set_tempo(&set, &format!("{}", 131 + attempt));
        let window = Instant::now() + Duration::from_secs(8);
        while Instant::now() < window && recorded.is_none() {
            // The launch's own catch-up may record the file too, if the write came before it finished.
            if let Ok(DaemonEvent::SaveRecorded {
                file,
                origin: Origin::Watch,
                ..
            }) = running.events().recv_timeout(Duration::from_millis(200))
            {
                recorded = Some((file, Origin::Watch));
            }
        }
        if recorded.is_some() {
            break;
        }
    }

    assert_eq!(recorded, Some((SET.to_string(), Origin::Watch)));
    let id = repo.sets().unwrap().into_keys().next().unwrap();
    assert!(repo.log(&id, "main").unwrap().len() >= 2);
    running.stop();
}

/// A hub that takes what a push and a beat send, answering by path.
fn hub() -> MockServer {
    MockServer::route(|request: &Recorded| {
        let body = match request.path_only() {
            "/api/repos/3/sets" => json!({"ditSetId": "x", "sessionId": 11}),
            "/api/repos/3/saves" => json!({"saved": 1}),
            "/api/repos/3/segments" => json!({"recorded": 0}),
            path if path.starts_with("/api/machines/") => {
                json!({"id": "m", "name": "Studio", "online": true, "openSessionId": null})
            }
            other => return Reply::json(404, json!({"error": other}).to_string()),
        };
        Reply::json(200, body.to_string())
    })
}

#[test]
fn a_save_live_makes_reaches_the_hub_and_the_beat_names_the_repo() {
    if skip() {
        return;
    }
    let (dir, repo, config, _root) = fixture();
    let server = hub();
    repo.bind_remote(&RemoteBinding {
        instance: server.url.clone(),
        repo: 3,
    })
    .unwrap();
    let set = dir.join(SET);
    let options = Options {
        tick: Duration::from_millis(250),
        poll: Duration::from_secs(3600),
        hub: Some(Hub {
            remote: Arc::new(remote_to(&server)),
            machine: Machine {
                id: "mach-1234567890abcdef".into(),
                name: "Studio".into(),
                platform: "macOS".into(),
                app_version: "0.0.0".into(),
            },
        }),
        queue: QueueOptions { debounce_ms: 200 },
        ..Options::default()
    };
    let Ok(running) = start(config, options) else {
        eprintln!("skipped: this platform cannot start a watcher here");
        return;
    };

    let saves = |server: &MockServer| {
        server
            .requests()
            .iter()
            .filter(|request| request.path_only() == "/api/repos/3/saves")
            .count()
    };
    let deadline = Instant::now() + Duration::from_secs(90);
    let mut attempt = 0;
    // The launch's catch-up pushes the first save; a rewrite the watcher sees is the second.
    while saves(&server) < 2 && Instant::now() < deadline {
        attempt += 1;
        set_tempo(&set, &format!("{}", 131 + attempt));
        let window = Instant::now() + Duration::from_secs(8);
        while saves(&server) < 2 && Instant::now() < window {
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    assert!(saves(&server) >= 2, "the save never reached the hub");

    let beat_with_repo = Instant::now() + Duration::from_secs(30);
    loop {
        let named = server
            .requests()
            .iter()
            .any(|request| request.method == "PUT" && request.json()["repoIds"] == json!([3]));
        if named {
            break;
        }
        assert!(Instant::now() < beat_with_repo, "no beat named the repo");
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(
        repo.log(&repo.sets().unwrap().into_keys().next().unwrap(), "main")
            .unwrap()
            .len()
            >= 2
    );
    running.stop();
}
