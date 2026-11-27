//! `dit cover set`: uploading a local image and pinning it on a track, collection, or project.

use std::fs;
use std::path::PathBuf;

use dit_cli::RemoteSource;
use dit_core::remote::test_support::{MockServer, Reply, remote_to};
use dit_core::remote::{Remote, RemoteError, TokenStore};
use dit_ipc::{Env, Run};
use serde_json::{Value, json};
use tempfile::TempDir;

struct Source {
    _dir: TempDir,
    config: PathBuf,
    server: MockServer,
}

impl RemoteSource for Source {
    fn config_path(&self) -> Result<PathBuf, RemoteError> {
        Ok(self.config.clone())
    }

    fn tokens(&self) -> Result<Box<dyn TokenStore>, RemoteError> {
        Err(RemoteError::NoKeyring)
    }

    fn open(&self) -> Result<Remote, RemoteError> {
        Ok(remote_to(&self.server))
    }
}

impl Source {
    fn new(server: MockServer) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("dit").join("config.toml");
        fs::create_dir_all(config.parent().unwrap()).unwrap();
        Source {
            _dir: dir,
            config,
            server,
        }
    }

    fn run(&self, cwd: &std::path::Path, args: &[&str]) -> (dit_ipc::Done, String) {
        let run = Run {
            cwd: cwd.to_path_buf(),
            env: Env::default(),
            argv: args.iter().map(|arg| arg.to_string()).collect(),
        };
        let mut stderr = Vec::new();
        let done = dit_cli::handle(run, &mut stderr, self, None, None);
        (done, String::from_utf8(stderr).unwrap())
    }
}

#[test]
fn cover_set_uploads_and_pins_track_artwork_in_json_and_text() {
    let server = MockServer::route(|req| match (req.method.as_str(), req.path_only()) {
        ("GET", "/api/tracks/9") => Reply::json(200, r#"{"id":9,"projectId":3}"#),
        ("POST", "/api/images/upload") => Reply::json(
            201,
            r#"{"id":42,"name":"cover.jpg","assetPath":"images/cover.jpg","size":12,"projectId":3}"#,
        ),
        ("PUT", "/api/images/parent/track/9") => {
            assert_eq!(req.json(), json!({ "imageId": 42 }));
            Reply::json(
                200,
                r#"{"id":42,"name":"cover.jpg","assetPath":"images/cover.jpg","size":12,"projectId":3}"#,
            )
        }
        other => panic!("unexpected request {other:?}"),
    });
    let source = Source::new(server);
    let file = source._dir.path().join("cover.jpg");
    fs::write(&file, [0xFF, 0xD8, 0xFF, 0xE0, 0, 1, 2, 3, 4, 5, 6, 7]).unwrap();

    let (done, _) = source.run(
        source._dir.path(),
        &["cover", "set", "cover.jpg", "--track", "9", "--json"],
    );

    assert_eq!(done.code, 0, "{:?}", done.refusal);
    let parsed: Value = serde_json::from_str(&done.stdout).unwrap();
    assert_eq!(parsed["target"]["kind"], "track");
    assert_eq!(parsed["target"]["id"], 9);
    assert_eq!(parsed["image"]["id"], 42);
    assert_eq!(parsed["image"]["assetPath"], "images/cover.jpg");

    let (text, _) = source.run(
        source._dir.path(),
        &["cover", "set", "cover.jpg", "--track", "9"],
    );
    assert_eq!(text.code, 0, "{:?}", text.refusal);
    assert_eq!(
        text.stdout,
        "Set cover image #42 (images/cover.jpg) on track #9.\n"
    );
}

#[test]
fn cover_set_refuses_missing_file_before_touching_hub() {
    let server = MockServer::route(|req| panic!("unexpected request {}", req.path_only()));
    let source = Source::new(server);

    let (done, _) = source.run(
        source._dir.path(),
        &["cover", "set", "missing.png", "--project", "3"],
    );

    assert_eq!(done.code, 1);
    assert!(
        done.refusal
            .as_deref()
            .unwrap_or_default()
            .contains("missing.png"),
        "{:?}",
        done.refusal
    );
}
