#![cfg(unix)]
//! The built `dit` against a socket: with an app answering on it the command runs there, with none it runs here,
//! and either way the terminal sees the same bytes.

use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use dit_cli::RemoteSource;
use dit_core::remote::{self, RemoteError, TokenStore};
use dit_ipc::{Done, Handler, Run, Server, Serving};
use serde_json::Value;
use tempfile::TempDir;

const PROJECT: &str = "Contract Fixtures Project";

/// A project folder and a home folder, under a path short enough for a socket.
struct Fixture {
    _root: TempDir,
    dir: PathBuf,
    home: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::Builder::new()
            .prefix("dit")
            .tempdir_in("/tmp")
            .unwrap();
        let dir = root.path().join(PROJECT);
        fs::create_dir(&dir).unwrap();
        let source = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../dit-daw-ableton/fixtures")
            .join(PROJECT);
        for name in ["Empty Set.als", "Arranged Set.als"] {
            fs::copy(source.join(name), dir.join(name)).unwrap();
        }
        let home = root.path().join("h");
        fs::create_dir(&home).unwrap();
        Fixture {
            _root: root,
            dir,
            home,
        }
    }

    /// The config folder the built `dit` finds under this home.
    fn config_folder(&self) -> PathBuf {
        if cfg!(target_os = "macos") {
            self.home.join("Library/Application Support/dit")
        } else {
            self.home.join("dit")
        }
    }

    fn socket(&self) -> PathBuf {
        self.config_folder().join("dit.sock")
    }

    /// Runs the built `dit` as `author` on `machine`.
    fn dit_as(&self, author: &str, machine: &str, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_dit"))
            .current_dir(&self.dir)
            .args(args)
            .env("HOME", &self.home)
            .env("XDG_CONFIG_HOME", &self.home)
            .env("DIT_AUTHOR", author)
            .env("DIT_MACHINE", machine)
            .output()
            .unwrap()
    }

    fn dit(&self, args: &[&str]) -> Output {
        self.dit_as("tester", "test", args)
    }

    /// An app on this home's socket that answers with `dit_cli::handle`, for the config this home has. Its own
    /// environment is not the caller's: the caller's travels with the request.
    fn app(&self) -> (Serving, Arc<App>) {
        let app = Arc::new(App {
            config: self.config_folder().join("config.toml"),
            runs: AtomicUsize::new(0),
        });
        let serving = Server::claim(&self.socket())
            .unwrap()
            .expect("no other app")
            .serve(app.clone());
        (serving, app)
    }
}

struct App {
    config: PathBuf,
    runs: AtomicUsize,
}

impl RemoteSource for App {
    fn config_path(&self) -> Result<PathBuf, RemoteError> {
        Ok(self.config.clone())
    }

    fn tokens(&self) -> Result<Box<dyn TokenStore>, RemoteError> {
        remote::system_tokens()
    }
}

/// The app's handler: the cli's own entry, with the app's remote source.
impl Handler for App {
    fn run(&self, run: Run, stderr: &mut dyn Write) -> Done {
        self.runs.fetch_add(1, Ordering::SeqCst);
        dit_cli::handle(run, stderr, self, None, None)
    }

    fn show_panel(&self) {}
}

fn json(output: &Output) -> Value {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn a_command_through_the_app_prints_the_bytes_a_local_run_prints() {
    let fixture = Fixture::new();
    fixture.dit(&["init"]);
    // A set that is gone warns on stderr while the rest of the command goes on.
    fs::remove_file(fixture.dir.join("Empty Set.als")).unwrap();

    let commands: [&[&str]; 4] = [
        &["status", "--json"],
        &["status", "Empty Set"],
        &["log", "--json"],
        &["whoami"],
    ];
    let local: Vec<Output> = commands.iter().map(|args| fixture.dit(args)).collect();
    let (app, served_by) = fixture.app();
    let through_app: Vec<Output> = commands.iter().map(|args| fixture.dit(args)).collect();
    drop(app);

    assert_eq!(served_by.runs.load(Ordering::SeqCst), commands.len());
    for ((args, local), served) in commands.iter().zip(&local).zip(&through_app) {
        assert_eq!(served.stdout, local.stdout, "{args:?} stdout");
        assert_eq!(served.stderr, local.stderr, "{args:?} stderr");
        assert_eq!(served.status.code(), local.status.code(), "{args:?} code");
    }
    assert!(
        String::from_utf8_lossy(&local[1].stderr).contains("file is missing"),
        "the status warning exercised stderr"
    );
    assert_eq!(
        local[3].status.code(),
        Some(1),
        "whoami with no instance fails"
    );
}

#[test]
fn the_app_answers_with_the_environment_of_the_command_that_asked() {
    let fixture = Fixture::new();
    let (_app, served_by) = fixture.app();

    assert!(fixture.dit_as("ada", "studio", &["init"]).status.success());
    let commit = fixture.dit_as(
        "ada",
        "studio",
        &["commit", "-m", "first", "--no-push", "Arranged Set"],
    );
    assert!(commit.status.success());
    let log = json(&fixture.dit(&["log", "--json", "Arranged Set"]));

    assert_eq!(served_by.runs.load(Ordering::SeqCst), 3);
    assert_eq!(log["commits"][0]["author"], "ada");
    assert_ne!(
        log["commits"][0]["author"].as_str(),
        std::env::var("DIT_AUTHOR").ok().as_deref(),
        "not the app's own environment"
    );
    let registry = dit_core::Registry::new(vec![&dit_daw_ableton::Ableton]).unwrap();
    let repo = dit_core::Repo::open(&fixture.dir, &registry).unwrap();
    let save = log["commits"][0]["saves"][0]["id"].as_str().unwrap();
    assert_eq!(
        repo.read_save(&save.parse().unwrap()).unwrap().machine,
        "studio"
    );
}

#[test]
fn a_socket_nothing_listens_on_runs_the_command_here() {
    let fixture = Fixture::new();
    fs::create_dir_all(fixture.config_folder()).unwrap();
    // A crashed app's socket file.
    drop(UnixListener::bind(fixture.socket()).unwrap());

    let output = fixture.dit(&["init"]);

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(fixture.dir.join(".dit").is_dir());
}

#[test]
fn an_app_of_another_protocol_version_stops_the_command_and_nothing_runs_here() {
    let fixture = Fixture::new();
    fs::create_dir_all(fixture.config_folder()).unwrap();
    let listener = UnixListener::bind(fixture.socket()).unwrap();
    let old_app = std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut line = String::new();
        BufReader::new(&stream).read_line(&mut line).unwrap();
        let mut stream = stream;
        writeln!(
            stream,
            r#"{{"id":1,"error":"The dit app speaks protocol 9; this dit speaks 1."}}"#
        )
        .unwrap();
    });

    let output = fixture.dit(&["init"]);
    old_app.join().unwrap();

    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    assert_eq!(
        String::from_utf8_lossy(&output.stderr).trim_end(),
        "The dit app speaks protocol 9; this dit speaks 1."
    );
    assert!(
        !fixture.dir.join(".dit").exists(),
        "the command was not run without the app"
    );
}
