//! Signing in and out of the hub while the daemon runs. Gated like `watch.rs`: it needs a real watcher.

#![cfg(any(target_os = "macos", target_os = "linux"))]

use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use dit_core::remote::Machine;
use dit_core::remote::test_support::{MockServer, Recorded, Reply, remote_to};
use dit_core::{Registry, RemoteBinding, Repo, RepoList};
use dit_daemon::queue::QueueOptions;
use dit_daemon::runner::{Hub, Options, start};
use dit_daemon::{Config, SystemClock};
use dit_daw_ableton::Ableton;
use serde_json::json;

const PROJECT: &str = "Contract Fixtures Project";
const SET: &str = "Empty Set.als";

fn hub() -> MockServer {
    MockServer::route(|request: &Recorded| {
        let body = match request.path_only() {
            "/api/repos/3" => {
                json!({"id": 3, "sets": [], "pushSamples": false, "pushSamplesForced": false})
            }
            "/api/repos/3/objects/missing" => json!({"missing": []}),
            "/api/repos/3/commits" => json!({"inserted": 1}),
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

fn hub_for(server: &MockServer) -> Hub {
    Hub {
        remote: Arc::new(remote_to(server)),
        machine: Machine {
            id: "mach-1234567890abcdef".into(),
            name: "Studio".into(),
            platform: "macOS".into(),
            app_version: "0.0.0".into(),
        },
    }
}

fn count(server: &MockServer, method: &str, path: &str) -> usize {
    server
        .requests()
        .iter()
        .filter(|r| r.method == method && r.path_only().starts_with(path))
        .count()
}

fn wait(what: &str, mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(60);
    while !done() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[test]
fn the_app_signs_in_and_out_without_restarting_the_daemon() {
    if std::env::var_os("DIT_SKIP_FS_TESTS").is_some() {
        return;
    }
    let root = tempfile::tempdir().unwrap().keep().canonicalize().unwrap();
    let dir = root.join(PROJECT);
    fs::create_dir(&dir).unwrap();
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../dit-daw-ableton/fixtures")
        .join(PROJECT);
    fs::copy(source.join(SET), dir.join(SET)).unwrap();
    let repo = Repo::init(&dir, &Ableton).unwrap();
    repo.record_save(&dir.join(SET)).unwrap();
    let (first, second) = (hub(), hub());
    repo.bind_remote(&RemoteBinding {
        instance: first.url.clone(),
        repo: 3,
    })
    .unwrap();
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
        clock: Arc::new(SystemClock),
        lock_wait: Duration::from_secs(2),
    };
    let options = Options {
        tick: Duration::from_millis(250),
        poll: Duration::from_secs(3600),
        queue: QueueOptions { debounce_ms: 100 },
        ..Options::default()
    };
    let Ok(running) = start(config, options) else {
        eprintln!("skipped: this platform cannot start a watcher here");
        return;
    };
    assert!(!running.has_hub());
    // Let the launch finish tracking the repo before signing in.
    std::thread::sleep(Duration::from_secs(2));
    assert_eq!(count(&first, "POST", "/api/repos/3/saves"), 0);

    running.attach_hub(hub_for(&first)).unwrap();
    assert!(running.has_hub());
    wait(
        "the tracked repo's save and a beat at the first hub",
        || {
            count(&first, "POST", "/api/repos/3/saves") >= 1
                && count(&first, "PUT", "/api/machines/") >= 1
        },
    );

    running.detach_hub();
    assert!(!running.has_hub());
    let beats = count(&first, "PUT", "/api/machines/");
    std::thread::sleep(Duration::from_secs(1));
    assert_eq!(
        count(&first, "PUT", "/api/machines/"),
        beats,
        "no beat after signing out"
    );

    repo.bind_remote(&RemoteBinding {
        instance: second.url.clone(),
        repo: 3,
    })
    .unwrap();
    running.attach_hub(hub_for(&second)).unwrap();
    wait("a beat at the second hub", || {
        count(&second, "PUT", "/api/machines/") >= 1
    });
    running.stop();
}

#[test]
fn a_held_repo_is_not_pushed_when_a_hub_is_attached_until_released() {
    if std::env::var_os("DIT_SKIP_FS_TESTS").is_some() {
        return;
    }
    let root = tempfile::tempdir().unwrap().keep().canonicalize().unwrap();
    let dir = root.join(PROJECT);
    fs::create_dir(&dir).unwrap();
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../dit-daw-ableton/fixtures")
        .join(PROJECT);
    fs::copy(source.join(SET), dir.join(SET)).unwrap();
    let repo = Repo::init(&dir, &Ableton).unwrap();
    repo.record_save(&dir.join(SET)).unwrap();
    let server = hub();
    repo.bind_remote(&RemoteBinding {
        instance: server.url.clone(),
        repo: 3,
    })
    .unwrap();
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
        clock: Arc::new(SystemClock),
        lock_wait: Duration::from_secs(2),
    };
    let options = Options {
        tick: Duration::from_millis(250),
        poll: Duration::from_secs(3600),
        queue: QueueOptions { debounce_ms: 100 },
        ..Options::default()
    };
    let Ok(running) = start(config, options) else {
        eprintln!("skipped: this platform cannot start a watcher here");
        return;
    };
    // Let the launch finish tracking the repo before signing in.
    std::thread::sleep(Duration::from_secs(2));

    running.hold(&dir);
    running.attach_hub(hub_for(&server)).unwrap();
    wait("a beat at the hub", || {
        count(&server, "PUT", "/api/machines/") >= 1
    });
    std::thread::sleep(Duration::from_secs(1));
    assert_eq!(count(&server, "POST", "/api/repos/3/saves"), 0);

    running.release(&dir);
    wait("the released repo's save", || {
        count(&server, "POST", "/api/repos/3/saves") >= 1
    });
    running.stop();
}
