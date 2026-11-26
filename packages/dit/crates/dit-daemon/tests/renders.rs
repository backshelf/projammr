//! The render engine against the real filesystem event stream: an audio file bounced into a project folder is seen,
//! settles and is held as a render waiting to be proposed.
//!
//! The 60 s hold and everything after it are covered with a clock in hand in the crate's unit tests; this is the
//! one test that needs the platform's watcher to deliver the file. It is gated like `watch.rs`: it skips, saying so,
//! where the platform cannot watch or when `DIT_SKIP_FS_TESTS` is set, and every wait has a generous deadline.

#![cfg(any(target_os = "macos", target_os = "linux"))]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use dit_core::remote::Machine;
use dit_core::remote::test_support::{MockServer, Recorded, Reply, remote_to};
use dit_core::repo::PushedSet;
use dit_core::{Registry, RemoteBinding, Repo, RepoList};
use dit_daemon::event::DaemonEvent;
use dit_daemon::renders::RenderOptions;
use dit_daemon::renders::ledger::Ledger;
use dit_daemon::runner::{Hub, Options, start};
use dit_daemon::{Config, RenderState, SystemClock};
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

/// A project folder whose set the hub knows as session 11, under a home that holds it.
fn fixture(instance: &str) -> (PathBuf, Config, PathBuf) {
    let root = tempfile::tempdir().unwrap().keep().canonicalize().unwrap();
    let dir = root.join(PROJECT);
    fs::create_dir(&dir).unwrap();
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../dit-daw-ableton/fixtures")
        .join(PROJECT);
    fs::copy(source.join(SET), dir.join(SET)).unwrap();
    let repo = Repo::init(&dir, &Ableton).unwrap();
    repo.record_save(&dir.join(SET)).unwrap();
    repo.bind_remote(&RemoteBinding {
        instance: instance.to_string(),
        repo: 3,
    })
    .unwrap();
    let set = repo.sets().unwrap().into_keys().next().unwrap();
    repo.write_pushed(
        &set,
        &PushedSet {
            instance: instance.to_string(),
            repo_id: 3,
            session_id: 11,
            branches: Default::default(),
        },
    )
    .unwrap();
    let repos_file = root.join("repos.toml");
    RepoList::update(&repos_file, |list| {
        list.bootstrapped = true;
        list.add(&dir);
    })
    .unwrap();
    let config = Config {
        registry: Registry::new(vec![&Ableton]).unwrap(),
        home: root.clone(),
        repos_file,
        clock: Arc::new(SystemClock),
        lock_wait: Duration::from_secs(2),
    };
    (dir, config, root)
}

#[test]
fn a_bounce_written_into_a_project_folder_is_held_as_a_waiting_render() {
    if skip() {
        return;
    }
    let server = hub();
    let (dir, config, root) = fixture(&server.url);
    let ledger_path = root.join("renders.json");
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
        renders: Some(RenderOptions {
            ledger_path: ledger_path.clone(),
            max_upload_mb: 0,
            export_dirs: Vec::new(),
            roots: Vec::new(),
            excluded: Vec::new(),
        }),
        ..Options::default()
    };
    let Ok(running) = start(config, options) else {
        eprintln!("skipped: this platform cannot start a watcher here");
        return;
    };
    let bounces = dir.join("Bounces");
    fs::create_dir(&bounces).unwrap();
    let bounce = bounces.join("Empty Set v2.wav");

    let deadline = Instant::now() + Duration::from_secs(90);
    let mut waiting = None;
    let mut attempt = 0u8;
    while waiting.is_none() && Instant::now() < deadline {
        // An event written before the stream is live is lost; writing again is the remedy, not a longer sleep.
        attempt += 1;
        fs::write(&bounce, vec![attempt; 4096]).unwrap();
        let window = Instant::now() + Duration::from_secs(10);
        while waiting.is_none() && Instant::now() < window {
            if let Ok(DaemonEvent::Render(card)) =
                running.events().recv_timeout(Duration::from_millis(200))
                && card.state == RenderState::Waiting
            {
                waiting = Some(card);
            }
        }
    }

    let card = waiting.expect("the bounce was never seen");
    assert_eq!(card.name, "Empty Set v2");
    assert_eq!(card.files.len(), 1);
    assert_eq!(card.files[0].path, bounce);
    let held = Ledger::load(&ledger_path).unwrap();
    assert_eq!(held.proposals.len(), 1);
    assert_eq!(
        running.renders().len(),
        1,
        "the panel's list is the ledger's"
    );
    assert_eq!(running.renders()[0].id, card.id);
    running.stop();
}

#[test]
fn without_render_options_the_app_has_no_render_engine() {
    let (_dir, config, _root) = fixture("http://127.0.0.1:1");
    let Ok(running) = start(
        config,
        Options {
            poll: Duration::from_secs(3600),
            ..Options::default()
        },
    ) else {
        eprintln!("skipped: this platform cannot start a watcher here");
        return;
    };

    assert!(running.render_control().is_none());
    assert!(running.renders().is_empty());
    assert_eq!(
        running.accept_render(1, None).unwrap_err(),
        "The render engine is not running."
    );
    running.stop();
}
