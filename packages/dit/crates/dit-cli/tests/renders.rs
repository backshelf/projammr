//! `dit renders` as the dit app answers it (the cli handed the app's render engine) and as it runs with no app and a
//! hub to upload to.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use dit_cli::RemoteSource;
use dit_core::remote::test_support::{MockServer, Reply, remote_to};
use dit_core::remote::{Remote, RemoteError, TokenStore};
use dit_daemon::renders::ledger::{Ledger, ProposalFile, ProposalState};
use dit_daemon::renders::{RenderControl, RenderEvent};
use dit_ipc::{Env, Run};
use tempfile::TempDir;

/// The cli's surroundings: a config folder in a temp dir and, when given, a hub the connection goes to.
struct Source {
    _dir: TempDir,
    config: PathBuf,
    server: Option<MockServer>,
}

impl RemoteSource for Source {
    fn config_path(&self) -> Result<PathBuf, RemoteError> {
        Ok(self.config.clone())
    }

    fn tokens(&self) -> Result<Box<dyn TokenStore>, RemoteError> {
        Err(RemoteError::NoKeyring)
    }

    fn open(&self) -> Result<Remote, RemoteError> {
        match &self.server {
            Some(server) => Ok(remote_to(server)),
            None => Err(RemoteError::NoInstance),
        }
    }
}

impl Source {
    fn new(server: Option<MockServer>) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("dit").join("config.toml");
        Source {
            _dir: dir,
            config,
            server,
        }
    }

    fn ledger_path(&self) -> PathBuf {
        Ledger::beside(&self.config)
    }

    /// A proposal of one file for session 5, in `state`.
    fn propose(&self, state: ProposalState) -> u64 {
        let folder = self.config.parent().unwrap().join("Bounces");
        fs::create_dir_all(&folder).unwrap();
        let path = folder.join("Canopy v3.wav");
        fs::write(&path, vec![3u8; 2048]).unwrap();
        Ledger::update(&self.ledger_path(), |ledger| {
            let id = ledger.propose(
                "Canopy v3",
                vec![ProposalFile {
                    path,
                    size: 2048,
                    mtime_ms: 5_000,
                    fingerprint: None,
                }],
                0,
            );
            let proposal = ledger.by_id_mut(id).unwrap();
            proposal.state = state;
            proposal.session_id = Some(5);
            proposal.upload.chosen = Some(0);
            id
        })
        .unwrap()
    }

    fn state_of(&self, id: u64) -> ProposalState {
        Ledger::load(&self.ledger_path())
            .unwrap()
            .by_id(id)
            .unwrap()
            .state
    }

    /// Runs `dit <args>` as the app would, with `renders` as its render engine.
    fn handle(
        &self,
        args: &[&str],
        renders: Option<&dyn RenderControl>,
    ) -> (dit_ipc::Done, String) {
        let run = Run {
            cwd: self.config.parent().unwrap().to_path_buf(),
            env: Env::default(),
            argv: args.iter().map(|arg| arg.to_string()).collect(),
        };
        let mut stderr = Vec::new();
        let done = dit_cli::handle(run, &mut stderr, self, renders, None);
        (done, String::from_utf8(stderr).unwrap())
    }
}

/// An app's render engine that records what it was asked.
#[derive(Default)]
struct App {
    asked: Mutex<Vec<String>>,
}

fn card(id: u64, state: ProposalState) -> RenderEvent {
    let mut ledger = Ledger::default();
    let id_in_ledger = ledger.propose(
        format!("Render {id}"),
        vec![ProposalFile {
            path: "/b/Mix.wav".into(),
            size: 1024,
            mtime_ms: 0,
            fingerprint: None,
        }],
        0,
    );
    let proposal = ledger.by_id_mut(id_in_ledger).unwrap();
    proposal.id = id;
    proposal.state = state;
    proposal.session_id = Some(5);
    RenderEvent::of(proposal)
}

impl RenderControl for App {
    fn renders(&self) -> Vec<RenderEvent> {
        vec![card(7, ProposalState::Uploading)]
    }

    fn accept_render(&self, id: u64, set_session: Option<i64>) -> Result<RenderEvent, String> {
        self.asked
            .lock()
            .unwrap()
            .push(format!("accept {id} {set_session:?}"));
        if id == 7 {
            Ok(card(7, ProposalState::Uploading))
        } else {
            Err(format!("There is no render {id}."))
        }
    }

    fn reject_render(&self, id: u64, never_here: bool) -> Result<RenderEvent, String> {
        self.asked
            .lock()
            .unwrap()
            .push(format!("reject {id} {never_here}"));
        Ok(card(id, ProposalState::Rejected))
    }

    fn set_scope(
        &self,
        _: Vec<std::path::PathBuf>,
        _: Vec<std::path::PathBuf>,
    ) -> Result<(), String> {
        Ok(())
    }

    fn set_max_upload_mb(&self, _: u64) {}
}

#[test]
fn through_the_app_the_list_is_the_apps_and_has_no_stale_line() {
    let source = Source::new(None);
    let app = App::default();

    let (done, _) = source.handle(&["renders"], Some(&app));

    assert_eq!(done.code, 0);
    assert_eq!(done.stdout, "7 uploading Render 7 (1 file, 1.0 KB)\n");
    assert!(
        !source.ledger_path().exists(),
        "the ledger is the app's to read, not the cli's"
    );

    let (json, _) = source.handle(&["renders", "--json"], Some(&app));
    let cards: serde_json::Value = serde_json::from_str(&json.stdout).unwrap();
    assert_eq!(cards[0]["id"], 7);
    assert_eq!(cards[0]["state"], "uploading");
}

#[test]
fn through_the_app_accept_and_reject_are_the_apps_to_do() {
    let source = Source::new(None);
    let app = App::default();

    let (accepted, _) = source.handle(&["renders", "accept", "7", "--set", "12"], Some(&app));
    let (rejected, _) = source.handle(&["renders", "reject", "7", "--never-here"], Some(&app));
    let (missing, _) = source.handle(&["renders", "accept", "8"], Some(&app));

    assert_eq!(accepted.code, 0);
    assert_eq!(
        accepted.stdout,
        "Adding Render 7 to session 5: the dit app is uploading it.\n"
    );
    assert_eq!(rejected.code, 0);
    assert!(
        rejected
            .stdout
            .starts_with("Rejected Render 7 as not a bounce.")
    );
    assert!(rejected.stdout.contains("/b"), "{}", rejected.stdout);
    assert_eq!(missing.code, 1);
    assert_eq!(missing.refusal.as_deref(), Some("There is no render 8."));
    assert_eq!(
        *app.asked.lock().unwrap(),
        ["accept 7 Some(12)", "reject 7 true", "accept 8 None"]
    );
}

/// A hub of one session (5, project 3) that takes whatever is sent it.
fn hub(no_track: bool) -> MockServer {
    MockServer::route(move |request| match request.path_only() {
        "/api/sessions/5" => Reply::json(
            200,
            r#"{"id":5,"projectId":3,"track":{"id":9,"title":"Canopy"}}"#,
        ),
        "/api/sessions/5/commits" => Reply::json(200, "[]"),
        "/api/assets/lookup" => Reply::json(200, "[]"),
        "/api/assets/upload" => Reply::json(201, r#"{"id":77}"#),
        "/api/sessions/5/renders" if no_track => {
            Reply::json(409, r#"{"error":"no track","code":"session_has_no_track"}"#)
        }
        "/api/sessions/5/renders" => Reply::json(201, r#"{"trackId":9,"attached":true}"#),
        other => panic!("unexpected request {other}"),
    })
}

#[test]
fn with_no_app_accept_uploads_here_and_writes_the_ledger() {
    let source = Source::new(Some(hub(false)));
    let id = source.propose(ProposalState::Proposed);

    let (done, stderr) = source.handle(&["renders", "accept", &id.to_string()], None);

    assert_eq!(done.code, 0, "{:?}", done.refusal);
    assert_eq!(done.stdout, "Added Canopy v3 to session 5.\n");
    assert_eq!(stderr, "Uploading Canopy v3.wav…\n");
    assert_eq!(source.state_of(id), ProposalState::Added);
    let held = Ledger::load(&source.ledger_path())
        .unwrap()
        .by_id(id)
        .unwrap()
        .clone();
    assert_eq!(held.upload.asset_id, Some(77));
    let server = source.server.as_ref().unwrap();
    let uploads = server
        .requests()
        .iter()
        .filter(|request| request.path_only() == "/api/assets/upload")
        .count();
    assert_eq!(uploads, 1);
}

#[test]
fn with_no_app_accept_into_a_session_with_no_track_keeps_the_upload_and_fails() {
    let source = Source::new(Some(hub(true)));
    let id = source.propose(ProposalState::Proposed);

    let (done, _) = source.handle(&["renders", "accept", &id.to_string()], None);

    assert_eq!(done.code, 1);
    assert_eq!(
        done.stdout,
        "Uploaded Canopy v3, but its session has no track yet.\n"
    );
    assert!(
        done.refusal.as_deref().unwrap().contains("no track yet"),
        "{:?}",
        done.refusal
    );
    assert_eq!(source.state_of(id), ProposalState::Proposed);
}

#[test]
fn with_no_app_and_a_hub_that_does_not_answer_the_render_is_queued() {
    // A server with no replies closes its port at once.
    let server = MockServer::start_replies(Vec::new());
    let source = Source::new(Some(server));
    std::thread::sleep(std::time::Duration::from_millis(100));
    let id = source.propose(ProposalState::Proposed);

    let (done, _) = source.handle(&["renders", "accept", &id.to_string()], None);

    assert_eq!(done.code, 1);
    assert_eq!(done.stdout, "Queued Canopy v3.\n");
    assert!(done.refusal.as_deref().unwrap().contains("stays queued"));
    assert_eq!(source.state_of(id), ProposalState::QueuedOffline);
}

#[test]
fn with_no_app_the_list_ends_with_the_stale_line() {
    let source = Source::new(None);
    source.propose(ProposalState::Proposed);

    let (done, _) = source.handle(&["renders"], None);

    assert_eq!(
        done.stdout,
        "1 proposed Canopy v3 (1 file, 2.0 KB)\nThe dit app isn't running; this list may be out of date.\n"
    );
}

fn write_wav(path: &std::path::Path, seconds: u32, mtime_secs: u64) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    let sample_rate: u32 = 8_000;
    let data_size: u32 = sample_rate * seconds;
    let mut bytes = Vec::with_capacity(44 + 64);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_size).to_le_bytes());
    bytes.extend_from_slice(b"WAVE");
    bytes.extend_from_slice(b"fmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&8u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_size.to_le_bytes());
    bytes.extend_from_slice(&[0x80u8; 64]);
    fs::write(path, bytes).unwrap();
    let mtime = std::time::UNIX_EPOCH + std::time::Duration::from_secs(mtime_secs);
    fs::File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(mtime)
        .unwrap();
}

#[test]
fn renders_add_uploads_directly_to_track_and_supports_session_primary() {
    let server = MockServer::route(|req| match (req.method.as_str(), req.path_only()) {
        ("GET", "/api/tracks/9") => Reply::json(200, r#"{"id":9,"projectId":3}"#),
        ("GET", "/api/sessions/5") => Reply::json(
            200,
            r#"{"id":5,"projectId":3,"track":{"id":9,"title":"Canopy"}}"#,
        ),
        ("GET", "/api/sessions/5/commits") => Reply::json(200, "[]"),
        ("POST", "/api/assets/lookup") => Reply::json(200, "[]"),
        ("POST", "/api/assets/upload") => Reply::json(201, r#"{"id":77}"#),
        ("POST", "/api/tracks/9/audios") => Reply::json(
            201,
            r#"{"audios":[{"id":501,"assetId":77,"version":1,"isPrimary":true}]}"#,
        ),
        ("POST", "/api/sessions/5/renders") => Reply::json(
            201,
            r#"{"trackId":9,"attached":true,"audios":[{"id":502,"assetId":77,"version":2,"isPrimary":false}]}"#,
        ),
        ("PATCH", "/api/track-audios/502/primary") => {
            Reply::json(200, r#"{"message":"Primary set"}"#)
        }
        other => panic!("unexpected request {other:?}"),
    });
    let source = Source::new(Some(server));
    let bounce = source.config.parent().unwrap().join("Canopy v1.wav");
    write_wav(&bounce, 60, 1_700_000_000);

    let (direct, stderr) = source.handle(
        &[
            "renders",
            "add",
            "Canopy v1.wav",
            "--track",
            "9",
            "--primary",
            "--json",
        ],
        None,
    );
    assert_eq!(direct.code, 0, "{:?}", direct.refusal);
    assert_eq!(stderr, "Uploading Canopy v1.wav…\n");
    let json: serde_json::Value = serde_json::from_str(&direct.stdout).unwrap();
    assert_eq!(json["trackId"], 9);
    assert_eq!(json["assetId"], 77);
    assert_eq!(json["trackAudioId"], 501);
    assert_eq!(json["version"], 1);
    assert_eq!(json["isPrimary"], true);
    assert_eq!(json["deduplicated"], false);

    let (via_session, _) = source.handle(
        &[
            "renders",
            "add",
            "Canopy v1.wav",
            "--track",
            "9",
            "--session",
            "5",
            "--primary",
        ],
        None,
    );
    assert_eq!(via_session.code, 0, "{:?}", via_session.refusal);
    assert!(
        via_session
            .stdout
            .contains("Added Canopy v1.wav to track #9 via session #5"),
        "{}",
        via_session.stdout
    );
    assert!(
        source
            .server
            .as_ref()
            .unwrap()
            .requests()
            .iter()
            .any(|r| r.method == "PATCH" && r.path_only() == "/api/track-audios/502/primary"),
        "primary flag pins the audio when attaching via session"
    );
}

#[test]
fn renders_scan_validates_confidence_and_reports_empty_scan() {
    let server = MockServer::route(|req| panic!("unexpected request {}", req.path_only()));
    let source = Source::new(Some(server));
    let bounces = source.config.parent().unwrap().join("Bounces");
    fs::create_dir_all(&bounces).unwrap();

    let (bad, _) = source.handle(
        &["renders", "scan", "Bounces", "--min-confidence", "1.5"],
        None,
    );
    assert_eq!(bad.code, 1);
    assert!(
        bad.refusal
            .as_deref()
            .unwrap_or_default()
            .contains("--min-confidence")
    );

    let (empty, _) = source.handle(&["renders", "scan", "Bounces", "--dry-run", "--json"], None);
    assert_eq!(empty.code, 0, "{:?}", empty.refusal);
    let parsed: serde_json::Value = serde_json::from_str(&empty.stdout).unwrap();
    assert_eq!(parsed["applied"], false);
    assert_eq!(parsed["matches"], serde_json::json!([]));
}
