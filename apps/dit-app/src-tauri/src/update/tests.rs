//! The flow against a local `latest.json` stand-in: a loopback server that serves a release the way GitHub does, signed
//! with a key made for the test, and a throwaway `.app` for the install to replace.

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use minisign::KeyPair;
use serde_json::{Value, json};
use tauri::App;
use tauri::test::{MockRuntime, mock_builder, mock_context, noop_assets};
use tauri_plugin_updater::UpdaterExt;

use super::*;

/// The version the mock app reports.
const RUNNING: &str = "0.1.0";

/// A cadence a test can wait through.
const QUICK: Cadence = Cadence {
    every: Duration::from_millis(150),
    tick: Duration::from_millis(10),
    idle_poll: Duration::from_millis(10),
};

/// What the app around the flow does, written down.
#[derive(Default)]
struct Recorder {
    shown: Mutex<Vec<UpdateState>>,
    idle: AtomicBool,
    relaunched: AtomicBool,
}

impl Recorder {
    fn idle(idle: bool) -> Arc<Recorder> {
        let recorder = Recorder::default();
        recorder.idle.store(idle, Ordering::SeqCst);
        Arc::new(recorder)
    }

    fn shown(&self) -> Vec<UpdateState> {
        lock(&self.shown).clone()
    }

    fn relaunched(&self) -> bool {
        self.relaunched.load(Ordering::SeqCst)
    }
}

impl Shell for Recorder {
    fn show(&self, state: UpdateState) {
        lock(&self.shown).push(state);
    }

    fn is_idle(&self) -> bool {
        self.idle.load(Ordering::SeqCst)
    }

    fn relaunch(&self) {
        self.relaunched.store(true, Ordering::SeqCst);
    }
}

/// A minisign key pair as the release config and the signer carry it: both halves base64 of the minisign text.
struct Key {
    pair: KeyPair,
}

impl Key {
    fn new() -> Key {
        Key {
            pair: KeyPair::generate_unencrypted_keypair().unwrap(),
        }
    }

    fn public(&self) -> String {
        STANDARD.encode(self.pair.pk.to_box().unwrap().to_string())
    }

    fn sign(&self, bytes: &[u8]) -> String {
        let signature = minisign::sign(
            Some(&self.pair.pk),
            &self.pair.sk,
            bytes,
            Some("timestamp:1\tfile:dit.app.tar.gz"),
            None,
        )
        .unwrap();
        STANDARD.encode(signature.to_string())
    }
}

/// The feed on a loopback port: what it serves, and how often each path was asked for.
struct Feed {
    base: String,
    files: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    hits: Arc<Mutex<HashMap<String, usize>>>,
}

impl Feed {
    fn start() -> Feed {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let feed = Feed {
            base: format!("http://{}", listener.local_addr().unwrap()),
            files: Arc::default(),
            hits: Arc::default(),
        };
        let (files, hits) = (feed.files.clone(), feed.hits.clone());
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                answer(stream, &files, &hits);
            }
        });
        feed
    }

    fn url(&self, path: &str) -> String {
        format!("{}/{path}", self.base)
    }

    fn put(&self, path: &str, bytes: Vec<u8>) {
        lock(&self.files).insert(path.to_string(), bytes);
    }

    /// Publishes `version` with the bundle `bytes` and the signature `signature`, as the release's `latest.json`.
    fn release(&self, version: &str, bytes: Vec<u8>, signature: String) {
        let target = tauri_plugin_updater::target().unwrap();
        let manifest = json!({
            "version": version,
            "pub_date": "2026-10-22T09:00:00Z",
            "platforms": {
                target: { "signature": signature, "url": self.url("dit-macos-arm64.app.tar.gz") },
            },
        });
        self.put("latest.json", manifest.to_string().into_bytes());
        self.put("dit-macos-arm64.app.tar.gz", bytes);
    }

    fn hits(&self, path: &str) -> usize {
        lock(&self.hits).get(path).copied().unwrap_or(0)
    }
}

fn answer(
    mut stream: TcpStream,
    files: &Mutex<HashMap<String, Vec<u8>>>,
    hits: &Mutex<HashMap<String, usize>>,
) {
    let mut request = [0u8; 4096];
    let read = stream.read(&mut request).unwrap_or(0);
    let head = String::from_utf8_lossy(&request[..read]);
    let path = head
        .split_whitespace()
        .nth(1)
        .unwrap_or("/")
        .trim_start_matches('/')
        .to_string();
    *lock(hits).entry(path.clone()).or_default() += 1;
    let body = lock(files).get(&path).cloned();
    let _ = match body {
        Some(body) => {
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream
                .write_all(head.as_bytes())
                .and_then(|()| stream.write_all(&body))
        }
        None => stream
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"),
    };
}

/// A throwaway `Fake.app` whose `Contents/version` says which build it is.
fn fake_app(dir: &Path, version: &str) -> PathBuf {
    let app = dir.join("Fake.app");
    fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
    fs::write(app.join("Contents/MacOS/dit"), "#!/bin/sh\n").unwrap();
    fs::write(app.join("Contents/version"), version).unwrap();
    app
}

fn version_of(app: &Path) -> String {
    fs::read_to_string(app.join("Contents/version")).unwrap()
}

/// What a release carries: `Fake.app` of `version`, tarred and gzipped as `dit.app.tar.gz` is.
fn bundle_of(version: &str) -> Vec<u8> {
    let dir = tempfile::tempdir().unwrap();
    fake_app(dir.path(), version);
    let archive = dir.path().join("bundle.tar.gz");
    let status = Command::new("tar")
        // Without this macOS adds an AppleDouble `._Fake.app` the unpacking cannot place.
        .env("COPYFILE_DISABLE", "1")
        .arg("-czf")
        .arg(&archive)
        .arg("-C")
        .arg(dir.path())
        .arg("Fake.app")
        .status()
        .unwrap();
    assert!(status.success());
    fs::read(archive).unwrap()
}

/// An app running as [`RUNNING`] whose updater reads `feed`, trusts `key` and would replace `installed`.
struct Harness {
    _app: App<MockRuntime>,
    updates: Arc<Updates>,
    shell: Arc<Recorder>,
}

fn harness(feed: &Feed, key: &Key, installed: &Path, idle: bool, cadence: Cadence) -> Harness {
    let mut context = mock_context(noop_assets());
    context.config_mut().plugins.0.insert(
        CONFIG_KEY.to_string(),
        json!({
            "pubkey": key.public(),
            "endpoints": [feed.url("latest.json")],
            "dangerousInsecureTransportProtocol": true,
        }),
    );
    let plugin = plugin::<MockRuntime>(context.config()).expect("the config carries a feed");
    let app = mock_builder().plugin(plugin).build(context).unwrap();
    let handle = app.handle().clone();
    let executable = installed.join("Contents/MacOS/dit");
    let shell = Recorder::idle(idle);
    let updates = Updates::with(
        shell.clone(),
        move || {
            handle
                .updater_builder()
                .executable_path(&executable)
                .timeout(CHECK_TIMEOUT)
                .build()
        },
        cadence,
    );
    Harness {
        _app: app,
        updates,
        shell,
    }
}

/// Polls `until` for up to five seconds.
fn eventually(what: &str, mut until: impl FnMut() -> bool) {
    let by = Instant::now() + Duration::from_secs(5);
    while !until() {
        assert!(Instant::now() < by, "timed out waiting for {what}");
        thread::sleep(Duration::from_millis(5));
    }
}

fn check(harness: &Harness) {
    tauri::async_runtime::block_on(harness.updates.check());
}

fn offered(version: &str) -> UpdateState {
    UpdateState::Available {
        version: version.to_string(),
    }
}

#[test]
fn a_newer_release_is_offered_by_its_version() {
    let key = Key::new();
    let feed = Feed::start();
    feed.release("0.2.0", bundle_of("0.2.0"), key.sign(&bundle_of("0.2.0")));
    let dir = tempfile::tempdir().unwrap();
    let app = fake_app(dir.path(), RUNNING);
    let harness = harness(&feed, &key, &app, true, QUICK);

    check(&harness);

    assert_eq!(harness.shell.shown(), vec![offered("0.2.0")]);
    assert_eq!(
        feed.hits("dit-macos-arm64.app.tar.gz"),
        0,
        "an offer downloads nothing"
    );
}

#[test]
fn a_release_that_is_not_newer_is_no_offer() {
    let key = Key::new();
    let feed = Feed::start();
    feed.release(RUNNING, bundle_of(RUNNING), key.sign(&bundle_of(RUNNING)));
    let dir = tempfile::tempdir().unwrap();
    let app = fake_app(dir.path(), RUNNING);
    let harness = harness(&feed, &key, &app, true, QUICK);

    check(&harness);

    assert_eq!(harness.shell.shown(), vec![UpdateState::None]);
    assert!(harness.updates.install().is_err());
}

#[test]
fn a_feed_that_cannot_be_read_changes_nothing() {
    let key = Key::new();
    let feed = Feed::start();
    let dir = tempfile::tempdir().unwrap();
    let app = fake_app(dir.path(), RUNNING);
    let harness = harness(&feed, &key, &app, true, QUICK);

    check(&harness);

    assert_eq!(harness.shell.shown(), vec![]);
}

#[test]
fn the_click_waits_for_idle_then_installs_and_relaunches() {
    let key = Key::new();
    let feed = Feed::start();
    let bundle = bundle_of("0.2.0");
    feed.release("0.2.0", bundle.clone(), key.sign(&bundle));
    let dir = tempfile::tempdir().unwrap();
    let app = fake_app(dir.path(), RUNNING);
    let harness = harness(&feed, &key, &app, false, QUICK);
    check(&harness);

    let job = harness
        .updates
        .install()
        .unwrap()
        .expect("a click starts the work");

    // The bundle comes down and is verified, and then nothing happens while a push is in flight.
    eventually("the download", || {
        feed.hits("dit-macos-arm64.app.tar.gz") == 1
    });
    thread::sleep(QUICK.idle_poll * 10);
    assert_eq!(version_of(&app), RUNNING);
    assert!(!harness.shell.relaunched());
    assert_eq!(
        harness.shell.shown(),
        vec![
            offered("0.2.0"),
            UpdateState::Installing {
                version: "0.2.0".to_string()
            }
        ]
    );

    harness.shell.idle.store(true, Ordering::SeqCst);
    job.join().unwrap();

    assert_eq!(version_of(&app), "0.2.0");
    assert!(harness.shell.relaunched());
}

#[test]
fn a_second_click_while_one_is_under_way_starts_nothing() {
    let key = Key::new();
    let feed = Feed::start();
    let bundle = bundle_of("0.2.0");
    feed.release("0.2.0", bundle.clone(), key.sign(&bundle));
    let dir = tempfile::tempdir().unwrap();
    let app = fake_app(dir.path(), RUNNING);
    let harness = harness(&feed, &key, &app, false, QUICK);
    check(&harness);

    let job = harness.updates.install().unwrap().unwrap();
    assert!(harness.updates.install().unwrap().is_none());
    harness.shell.idle.store(true, Ordering::SeqCst);
    job.join().unwrap();

    assert_eq!(feed.hits("dit-macos-arm64.app.tar.gz"), 1);
}

#[test]
fn a_release_signed_by_another_key_is_refused_and_nothing_is_replaced() {
    let key = Key::new();
    let stranger = Key::new();
    let feed = Feed::start();
    let bundle = bundle_of("0.2.0");
    feed.release("0.2.0", bundle.clone(), stranger.sign(&bundle));
    let dir = tempfile::tempdir().unwrap();
    let app = fake_app(dir.path(), RUNNING);
    let harness = harness(&feed, &key, &app, true, QUICK);
    check(&harness);

    harness.updates.install().unwrap().unwrap().join().unwrap();

    assert_eq!(version_of(&app), RUNNING);
    assert!(!harness.shell.relaunched());
    assert_eq!(
        harness.shell.shown().last(),
        Some(&UpdateState::Failed {
            version: "0.2.0".to_string(),
            message: "Couldn't update to 0.2.0. Try again later.".to_string(),
        })
    );
}

#[test]
fn a_bundle_that_is_not_the_one_signed_is_refused() {
    let key = Key::new();
    let feed = Feed::start();
    feed.release("0.2.0", bundle_of("6.6.6"), key.sign(&bundle_of("0.2.0")));
    let dir = tempfile::tempdir().unwrap();
    let app = fake_app(dir.path(), RUNNING);
    let harness = harness(&feed, &key, &app, true, QUICK);
    check(&harness);

    harness.updates.install().unwrap().unwrap().join().unwrap();

    assert_eq!(version_of(&app), RUNNING);
    assert!(!harness.shell.relaunched());
    assert!(matches!(
        harness.shell.shown().last(),
        Some(UpdateState::Failed { .. })
    ));
}

#[test]
fn a_failed_update_stays_on_offer_and_the_click_tries_again() {
    let key = Key::new();
    let feed = Feed::start();
    let bundle = bundle_of("0.2.0");
    feed.release("0.2.0", bundle.clone(), key.sign(&bundle));
    let dir = tempfile::tempdir().unwrap();
    let app = fake_app(dir.path(), RUNNING);
    let harness = harness(&feed, &key, &app, true, QUICK);
    check(&harness);
    // The bundle is gone from the feed for a moment: the download fails.
    lock(&feed.files).remove("dit-macos-arm64.app.tar.gz");
    harness.updates.install().unwrap().unwrap().join().unwrap();
    assert!(matches!(
        harness.shell.shown().last(),
        Some(UpdateState::Failed { .. })
    ));
    assert_eq!(version_of(&app), RUNNING);

    feed.put("dit-macos-arm64.app.tar.gz", bundle);
    harness.updates.install().unwrap().unwrap().join().unwrap();

    assert_eq!(version_of(&app), "0.2.0");
    assert!(harness.shell.relaunched());
}

#[test]
fn the_feed_is_asked_again_every_cadence() {
    let key = Key::new();
    let feed = Feed::start();
    let dir = tempfile::tempdir().unwrap();
    let app = fake_app(dir.path(), RUNNING);
    let harness = harness(&feed, &key, &app, true, QUICK);

    harness.updates.watch();
    eventually("the launch check", || feed.hits("latest.json") == 1);
    let bundle = bundle_of("0.2.0");
    feed.release("0.2.0", bundle.clone(), key.sign(&bundle));

    eventually("the next check to find the release", || {
        harness.shell.shown().contains(&offered("0.2.0"))
    });
    assert!(feed.hits("latest.json") >= 2);
}

fn merged(base: &mut Value, over: Value) {
    match (base, over) {
        (Value::Object(base), Value::Object(over)) => {
            for (key, value) in over {
                merged(base.entry(key).or_insert(Value::Null), value);
            }
        }
        (base, over) => *base = over,
    }
}

/// The Tauri config a build runs under: the base file with each overlay `tauri build -c` or `tauri dev -c` lays on it.
fn config(overlays: &[&str]) -> tauri::Config {
    let mut config: Value = serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
    for overlay in overlays {
        merged(&mut config, serde_json::from_str(overlay).unwrap());
    }
    serde_json::from_value(config).unwrap()
}

const DEV: &str = include_str!("../../tauri.dev.conf.json");
const RELEASE: &str = include_str!("../../tauri.release.conf.json");

#[test]
fn the_dev_build_and_a_local_package_have_no_updater() {
    assert!(plugin::<MockRuntime>(&config(&[DEV])).is_none());
    assert!(plugin::<MockRuntime>(&config(&[])).is_none());
}

#[test]
fn the_release_build_has_the_feed_and_the_key_and_signs_an_update_bundle() {
    let release = config(&[RELEASE]);
    assert!(plugin::<MockRuntime>(&release).is_some());

    let updater = &release.plugins.0[CONFIG_KEY];
    assert_eq!(
        updater["endpoints"],
        json!(["https://github.com/backshelf/projammr/releases/latest/download/latest.json"])
    );
    let key = STANDARD
        .decode(updater["pubkey"].as_str().unwrap())
        .unwrap();
    assert!(
        String::from_utf8(key)
            .unwrap()
            .starts_with("untrusted comment: minisign public key")
    );
    let overlay: Value = serde_json::from_str(RELEASE).unwrap();
    assert_eq!(overlay["bundle"]["createUpdaterArtifacts"], json!(true));
}
